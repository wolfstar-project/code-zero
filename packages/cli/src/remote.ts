import type { RunMode, TaskResult, TerminalState } from '@code-zero/shared';

import { readCredentials, type StoredCredential } from './credentials.js';

/** What a remote run needs, resolved before anything is sent. */
export interface RemoteRunRequest {
  origin: string;
  repository: string;
  mode: RunMode;
  trigger: 'feedback' | 'proactive';
  feedback?: string;
}

export interface RemoteRunOptions {
  /** Injected so the tests drive this without a network, like every other adapter here. */
  fetch?: typeof globalThis.fetch;
  credentials?: () => Promise<Record<string, StoredCredential>>;
  now?: () => number;
}

/**
 * A refusal a person can act on, rather than a status code.
 *
 * `signed-out` and `expired` are separated because the remedy differs in wording only for the
 * reader — both end at `zero login`, but being told a session expired is the difference between
 * "this is broken" and "this is normal".
 */
type RemoteRunFailure =
  | { kind: 'signed-out' }
  | { kind: 'expired' }
  | { kind: 'refused'; message: string };

export type RemoteRunOutcome =
  | { ok: true; result: TaskResult }
  | { ok: false; failure: RemoteRunFailure };

/**
 * Queue a run on a deployment's control plane and wait for its result.
 *
 * The session from `zero login` is presented as a bearer token, which is what Better Auth's bearer
 * plugin accepts — the same credential the browser carries as a cookie, so a run started here is
 * attributed to the person who signed in rather than to a shared operator token.
 *
 * `/rpc/**` rather than `/api/v1/**`: only the RPC transport resolves a session, because it is the
 * same-origin surface. Its CSRF guard reads `Sec-Fetch-Mode`, a header a browser attaches on its
 * own and a non-browser client has to state, which is what this sends.
 *
 * The call is deliberately synchronous with the run: `tasks.create` answers with the finished
 * result, so `--remote` reports and exits exactly like a local run instead of leaving an operator
 * to go find out what happened.
 */
export async function runRemotely(
  request: RemoteRunRequest,
  options: RemoteRunOptions = {},
): Promise<RemoteRunOutcome> {
  const store = await (options.credentials ?? readCredentials)();
  const credential = store[request.origin];
  if (!credential) return { ok: false, failure: { kind: 'signed-out' } };

  const expiresAt = Date.parse(credential.expiresAt);
  const now = (options.now ?? Date.now)();
  if (Number.isNaN(expiresAt) || expiresAt <= now)
    return { ok: false, failure: { kind: 'expired' } };

  const send = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await send(`${request.origin}/rpc/tasks/create`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'content-type': 'application/json',
        // The transport's CSRF guard exists for browsers; a CLI states what a browser would send.
        'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({
        json: {
          repository: request.repository,
          mode: request.mode,
          trigger: request.trigger,
          ...(request.feedback === undefined ? {} : { feedback: request.feedback }),
        },
      }),
    });
  } catch (error) {
    return {
      ok: false,
      failure: { kind: 'refused', message: `${request.origin} is unreachable: ${String(error)}` },
    };
  }

  const payload: unknown = await response.json().catch(() => undefined);
  const body = unwrap(payload);
  if (response.status === 401) return { ok: false, failure: { kind: 'expired' } };
  if (!response.ok) {
    // The deployment's own message names the rule it refused on — an unlisted repository, a mode
    // the account was not granted — which is the one thing the operator has to act on.
    const message = readString(body, 'message') ?? `The control plane refused the run.`;
    return { ok: false, failure: { kind: 'refused', message } };
  }
  if (!isTaskResult(body))
    return {
      ok: false,
      failure: { kind: 'refused', message: 'The control plane answered with an unusable result.' },
    };
  return { ok: true, result: body };
}

/** The RPC transport wraps both results and errors in `json`. */
function unwrap(payload: unknown): unknown {
  return isRecord(payload) && 'json' in payload ? payload.json : payload;
}

const TERMINAL_STATES = new Set(['completed', 'needs-human', 'failed']);

function isTerminalState(state: string): state is TerminalState {
  return TERMINAL_STATES.has(state);
}

/**
 * Checked, not asserted: this is a remote answer, and the caller maps `state` onto an exit code CI
 * reads and renders `plan` for a human to read. A queued or in-progress answer has neither — `/rpc`
 * only resolves once the run reaches one of these three states — so accepting one here would let a
 * non-terminal response report exit code `0` (no entry in the caller's exit-code table means no
 * exit code) and throw while rendering a plan that was never populated. A shape short either field
 * must not be able to reach the caller as a result.
 */
function isTaskResult(value: unknown): value is TaskResult {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.state === 'string' &&
    isTerminalState(value.state) &&
    Array.isArray(value.plan)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  return typeof entry === 'string' && entry.length > 0 ? entry : undefined;
}

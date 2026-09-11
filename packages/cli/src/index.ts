#!/usr/bin/env node
import { access, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as p from '@clack/prompts';
import { CodeZero } from '@code-zero/agent';
import { discoverChecks, knownLockfiles, loadConfig, mayModifyRepository } from '@code-zero/config';
import {
  isModelConfigured,
  isSubscriptionModelProvider,
  isSubscriptionProviderEnabled,
  modelFromEnvironment,
  modelProviderCredentialKind,
  subscriptionProbeCommand,
  subscriptionProviderDescriptor,
  type SubscriptionModelProviderKind,
} from '@code-zero/models';
import { createRunner, LocalRunner, runnerOptionsFromPolicy, type Runner } from '@code-zero/runner';
import {
  evidenceFromResult,
  renderEvidenceMarkdown,
  version,
  type RunMode,
  type TaskResult,
} from '@code-zero/shared';

import { parseCliArguments } from './args.js';
import {
  credentialSummaries,
  credentialsPath,
  forgetCredential,
  normalizeOrigin,
  saveCredential,
} from './credentials.js';
import { pollDeviceToken, requestDeviceCode } from './login.js';
import { runRemotely } from './remote.js';
import {
  claudeCodeProcessSpawner,
  claudeCodeRefusalReason,
  environmentForModel,
} from './subscription-isolation.js';

const cwd = process.cwd();

/**
 * Exit codes are part of the contract.
 *
 * `0` means the run reached a clean conclusion, `1` means it failed, and `2` means a human has to
 * look. A run whose verification did not pass never exits `0`, so CI cannot mistake it for success.
 */
const exitCodes = { completed: 0, failed: 1, 'needs-human': 2 } as const;

await main().catch((error: unknown) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const args = parseCliArguments(process.argv.slice(2));

  if (args.version) {
    console.log(version);
    return;
  }

  if (args.help || args.command === 'help') {
    showHelp();
    return;
  }

  if (args.command === 'init') {
    await initializeProject();
    return;
  }

  if (args.command === 'doctor') {
    await runDoctor(args.json);
    return;
  }

  if (args.command === 'login') {
    await signIn(args.url);
    return;
  }

  if (args.command === 'logout') {
    await signOut(args.url);
    return;
  }

  if (args.command === 'review' || args.command === 'fix' || args.command === 'run') {
    await runAgent(args.command, args.feedback, args.proactive, args.json, args.remote, args.url);
    return;
  }

  throw new Error(
    `Unknown command: ${args.command}. Run zero --help to see the available commands.`,
  );
}

function showHelp(): void {
  p.intro(`Code Zero v${version}`);
  p.note(
    [
      'zero init',
      'zero --version',
      'zero doctor [--json]',
      'zero login [--url <deployment>]',
      'zero logout [--url <deployment>]',
      'zero review (--feedback <text> | --proactive) [--json]',
      'zero fix (--feedback <text> | --proactive) [--json]',
      'zero run (--feedback <text> | --proactive) [--remote [--url <origin>]] [--json]',
    ].join('\n'),
    'Commands',
  );
  p.note(['0  concluded', '1  failed', '2  needs a human'].join('\n'), 'Exit codes');
  p.outro('Use --feedback or --proactive for non-interactive environments.');
}

/**
 * Which deployment `login` and `logout` act on.
 *
 * `--url` wins, then `CODE_ZERO_URL`, then the local development origin the README documents.
 * There is deliberately no built-in hosted default: a wrong one would send an operator's device
 * code to a host nobody in this repository controls, so a cloud-managed deployment is named
 * explicitly exactly like a self-hosted one.
 */
function resolveDeploymentOrigin(url: string | undefined): string {
  return normalizeOrigin(url ?? process.env.CODE_ZERO_URL?.trim() ?? 'http://localhost:3000');
}

/**
 * Sign this machine in through the RFC 8628 device flow.
 *
 * The CLI never sees a password: it prints a short code, the operator approves it in a browser
 * they are already signed into, and only then does a session token come back. Polling honours the
 * interval the deployment asked for, and backs off further whenever it answers `slow_down`, so a
 * long approval does not turn into a self-inflicted rate limit.
 */
async function signIn(url: string | undefined): Promise<void> {
  const origin = resolveDeploymentOrigin(url);
  p.intro(`Code Zero · login`);

  const request = await requestDeviceCode(origin);
  p.note(
    [
      `Open  ${request.verificationUriComplete ?? request.verificationUri}`,
      `Code  ${request.userCode}`,
    ].join('\n'),
    origin,
  );

  const spinner = p.spinner();
  spinner.start('Waiting for approval');

  const deadline = Date.now() + request.expiresInSeconds * 1_000;
  let intervalMs = request.intervalSeconds * 1_000;

  try {
    while (Date.now() < deadline) {
      await delay(intervalMs);
      // Clack installs a SIGINT handler that stops the spinner, but nothing interrupts this loop:
      // without the check it would keep polling until approval or the ten-minute deadline, so
      // Ctrl-C would appear to do nothing. Checked after the delay because that is where the
      // signal lands.
      if (spinner.isCancelled) {
        p.log.info('Sign-in cancelled.');
        return;
      }

      const outcome = await pollDeviceToken(origin, request.deviceCode);

      if (outcome.kind === 'token') {
        await saveCredential(origin, {
          accessToken: outcome.token.accessToken,
          expiresAt: new Date(Date.now() + outcome.token.expiresInSeconds * 1_000).toISOString(),
        });
        spinner.stop('Approved');
        p.log.success(`Signed in to ${origin}`);
        p.outro(`Token stored in ${credentialsPath()}`);
        return;
      }

      if (outcome.kind === 'denied') {
        spinner.stop('Denied');
        throw new Error('The request was denied in the browser.');
      }

      if (outcome.kind === 'expired') {
        spinner.stop('Expired');
        throw new Error('The code expired before it was approved. Run zero login again.');
      }

      // The server only says "too fast", never how much slower; RFC 8628 prescribes adding to the
      // interval rather than guessing a new one.
      if (outcome.kind === 'slowDown') intervalMs += request.intervalSeconds * 1_000;
    }

    spinner.stop('Expired');
    throw new Error('The code expired before it was approved. Run zero login again.');
  } catch (error) {
    // `spinner.stop` is idempotent, and the throws above have already called it; this covers a
    // transport failure mid-poll, which would otherwise leave the spinner running over the error.
    spinner.stop('Failed');
    throw error;
  }
}

/** Forget a stored session. Without `--url` this forgets every deployment, not just one. */
async function signOut(url: string | undefined): Promise<void> {
  p.intro('Code Zero · logout');
  const origin = url === undefined ? undefined : resolveDeploymentOrigin(url);
  const forgotten = await forgetCredential(origin);

  if (forgotten)
    p.log.success(origin ? `Signed out of ${origin}` : 'Signed out of every deployment');
  else p.log.info(origin ? `No stored session for ${origin}` : 'No stored sessions');

  p.outro('Done.');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function initializeProject(): Promise<void> {
  p.intro('Code Zero · init');
  const target = join(cwd, '.code-zero.yml');

  if (await exists(target)) {
    throw new Error('.code-zero.yml already exists');
  }

  await copyFile(join(import.meta.dirname, '../../../.code-zero.example.yml'), target);
  p.log.success(`Created ${target}`);
  p.outro('Configuration ready.');
}

async function runDoctor(asJson: boolean): Promise<void> {
  const config = await loadConfig(cwd);
  // Checkout inspection goes through the runner boundary like every other repository access. A
  // read-only local runner is used deliberately so doctor can still diagnose a checkout whose
  // container isolation is misconfigured.
  const inspector = new LocalRunner(cwd);
  const lockfiles: string[] = [];
  for (const lockfile of knownLockfiles)
    if (await inspector.exists(lockfile)) lockfiles.push(lockfile);
  const checks =
    config.checks.length > 0
      ? config.checks
      : discoverChecks({
          packageJson: await inspector.read('package.json').catch(() => null),
          lockfiles,
        });
  // Reflects the same refusal `runAgent` applies: under container isolation, claude-code is not
  // "configured" unless a container image for its CLI is also set, even if the enable flag is on.
  const modelEnvironment = environmentForModel(config, process.env);
  const modelConfigured = isModelConfigured(config.model.provider, modelEnvironment);
  const status = {
    node: process.version,
    gitRepository: await exists(join(cwd, '.git')),
    modelConfigured,
    modelProvider: config.model.provider,
    modelCredentialKind: modelProviderCredentialKind(config.model.provider),
    // Only probed once the operator opted this host in; an unset flag is already the answer, and
    // doctor must not be the thing that first spawns a vendor CLI.
    ...(isSubscriptionModelProvider(config.model.provider) && modelConfigured
      ? { modelCli: await probeSubscriptionCli(inspector, config.model.provider) }
      : {}),
    mode: config.mode,
    isolation: config.runner.isolation,
    network: config.permissions.network,
    // Which deployments `zero login` holds a session for. Origins and expiry only, never a token.
    sessions: await credentialSummaries(),
    checks,
  };

  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  p.intro('Code Zero · doctor');
  p.log.info(`Node ${status.node}`);
  logCheck('Git repository', status.gitRepository);
  logCheck('Model configured', status.modelConfigured);
  p.log.info(`Model provider: ${status.modelProvider} (${status.modelCredentialKind})`);
  if (status.sessions.length === 0) p.log.info('No stored sessions. Run zero login to sign in.');
  else
    for (const session of status.sessions) logCheck(`Session ${session.origin}`, !session.expired);
  if (!status.modelConfigured && isSubscriptionModelProvider(config.model.provider)) {
    if (
      config.model.provider === 'claude-code' &&
      config.runner.isolation === 'container' &&
      !process.env.CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE
    )
      p.log.warn(
        'Container isolation is required but no CODE_ZERO_CLAUDE_CODE_CONTAINER_IMAGE is set, so claude-code is refused rather than run unisolated on the host.',
      );
    else
      p.log.warn(
        `Set ${subscriptionProviderDescriptor(config.model.provider).enableEnvironmentVariable}=true to enable this host's subscription session.`,
      );
  }
  if (status.modelCli) {
    logCheck(`${status.modelCli.executable} CLI installed`, status.modelCli.installed);
    if (!status.modelCli.installed)
      p.log.warn(
        `Install it and run \`${status.modelCli.loginCommand}\`, or point ${status.modelCli.pathVariable} at the executable.`,
      );
  }
  logCheck(
    `Isolated runner (${status.isolation}, network ${status.network})`,
    status.isolation === 'container',
  );
  logCheck(
    checks.length > 0
      ? `Verification checks: ${checks.join(', ')}`
      : 'No verification checks found',
    checks.length > 0,
  );
  p.log.info(`Mode: ${status.mode}`);
  p.outro(
    status.gitRepository && status.modelConfigured && status.modelCli?.installed !== false
      ? 'Ready to run.'
      : 'Setup incomplete.',
  );
}

/**
 * Prove the vendor CLI is installed and runnable before a run depends on it.
 *
 * The probe goes through the runner like every other command execution, and asks only for a
 * version, so a diagnostic can never start a session or touch the checkout. It cannot tell whether
 * the session is still authenticated — only a real call can, and that failure is translated into
 * the matching `login` instruction by the models package.
 */
async function probeSubscriptionCli(
  inspector: Runner,
  provider: SubscriptionModelProviderKind,
): Promise<{
  executable: string;
  installed: boolean;
  pathVariable: string;
  loginCommand: string;
}> {
  const descriptor = subscriptionProviderDescriptor(provider);
  // The configured override itself, read the same way `subscriptionProbeCommand` resolves it
  // before quoting — not derived from the quoted command string below, which may wrap the path in
  // single or double quotes and can contain embedded spaces; splitting that string on the first
  // space would report a truncated, quote-mangled path instead of the real one.
  const executable = process.env[descriptor.executableEnvironmentVariable] ?? descriptor.executable;
  let command: string;
  try {
    command = subscriptionProbeCommand(provider, process.env);
  } catch {
    // An executable override that cannot be expressed as a single probe token (it contains both
    // quote characters) is not "installed" from doctor's point of view — report the same
    // diagnostic shape a failed probe would, rather than letting doctor itself throw and skip its
    // JSON document entirely.
    return {
      executable,
      installed: false,
      pathVariable: descriptor.executableEnvironmentVariable,
      loginCommand: descriptor.loginCommand,
    };
  }
  const result = await inspector.check(command, 15_000).catch(() => undefined);
  return {
    executable,
    installed: result?.exitCode === 0,
    pathVariable: descriptor.executableEnvironmentVariable,
    loginCommand: descriptor.loginCommand,
  };
}

/**
 * Hand the run to a deployment's control plane instead of executing it here.
 *
 * The repository is this checkout's path, because the common case is a control plane running on
 * the same machine. It is the deployment's allow-list that decides whether the path may be
 * targeted at all, so a path this CLI happens to be sitting in cannot become one a run reaches.
 *
 * The exit code comes from the same table a local run uses: a remote run that needs a human still
 * exits 2, and one that failed still exits 1, so CI reads both the same way.
 */
async function runOnControlPlane(
  command: 'review' | 'fix' | 'run',
  origin: string,
  mode: RunMode,
  proactive: boolean,
  feedback: string | undefined,
  asJson: boolean,
): Promise<void> {
  if (!asJson) p.intro(`Code Zero · ${command} on ${origin}`);

  const outcome = await runRemotely({
    origin,
    repository: cwd,
    mode,
    trigger: proactive ? 'proactive' : 'feedback',
    ...(feedback === undefined ? {} : { feedback }),
  });

  if (!outcome.ok) {
    const message =
      outcome.failure.kind === 'signed-out'
        ? `No session for ${origin}. Run \`zero login --url ${origin}\` first.`
        : outcome.failure.kind === 'expired'
          ? `The session for ${origin} has expired. Run \`zero login --url ${origin}\` again.`
          : outcome.failure.message;
    if (asJson) console.error(message);
    else p.log.error(message);
    process.exitCode = 1;
    return;
  }

  if (asJson) console.log(JSON.stringify(outcome.result, null, 2));
  else {
    p.log.info(`Task ${outcome.result.id} · ${origin}`);
    report(outcome.result, mode);
  }
  process.exitCode = exitCodes[outcome.result.state];
}

async function runAgent(
  command: 'review' | 'fix' | 'run',
  providedFeedback: string | undefined,
  proactive: boolean,
  asJson: boolean,
  remote = false,
  url?: string,
): Promise<void> {
  const feedback = proactive
    ? undefined
    : (providedFeedback ?? (await promptForFeedback(command, asJson)));
  if (!proactive && feedback === undefined) return;

  const config = await loadConfig(cwd);
  const mode: RunMode = command === 'review' ? 'observe' : command === 'fix' ? 'fix' : config.mode;

  if (remote) {
    await runOnControlPlane(
      command,
      resolveDeploymentOrigin(url),
      mode,
      proactive,
      feedback,
      asJson,
    );
    return;
  }

  if (!asJson && providedFeedback !== undefined) p.intro(`Code Zero · ${command}`);

  // The boundary is created read-only unless both the mode and repository policy allow writing, so
  // a mistake in the runtime cannot turn a review into an edit.
  const runner = createRunner(
    cwd,
    runnerOptionsFromPolicy(config, mayModifyRepository(config, mode)),
  );

  // Refuses claude-code under container isolation when no CLI container image is configured,
  // rather than silently spawning it unisolated on the host. Reported to modelFromEnvironment as a
  // refusal reason, not by disabling the enable flag: the flag would also skip fallback selection,
  // turning a configured CODE_ZERO_MODEL_FALLBACK_PROVIDER into a run that fails outright instead
  // of degrading to it.
  const refusalReason =
    config.model.provider === 'claude-code'
      ? claudeCodeRefusalReason(config, process.env)
      : undefined;
  const spawnClaudeCodeProcess =
    config.model.provider === 'claude-code' &&
    refusalReason === undefined &&
    isSubscriptionProviderEnabled('claude-code', process.env)
      ? claudeCodeProcessSpawner(config, process.env)
      : undefined;

  const agent = new CodeZero({
    model: modelFromEnvironment(config.model, process.env, spawnClaudeCodeProcess, refusalReason),
    runner,
    config,
    onEvent: (event) => {
      if (asJson) console.error(`[${event.state}] ${event.message}`);
      else p.log.step(event.message);
    },
  });
  const result = await agent.run({
    repository: cwd,
    mode,
    trigger: proactive ? 'proactive' : 'feedback',
    ...(feedback === undefined ? {} : { feedback }),
  });

  if (asJson) console.log(JSON.stringify(result, null, 2));
  else report(result, mode);

  process.exitCode = exitCodes[result.state];
}

function report(result: TaskResult, mode: RunMode): void {
  p.note(renderEvidenceMarkdown(evidenceFromResult(result, { mode })), 'Evidence');
  if (result.state === 'failed') p.cancel(result.summary);
  else if (result.state === 'needs-human') p.log.warn(result.summary);
  else p.outro(result.summary);
}

async function promptForFeedback(
  command: 'review' | 'fix' | 'run',
  asJson: boolean,
): Promise<string | undefined> {
  if (asJson || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Missing --feedback <text> in a non-interactive environment');
  }

  p.intro(`Code Zero · ${command}`);
  const feedback = await p.text({
    message: 'What should Code Zero work on?',
    placeholder: 'Describe the feedback or requested change',
    validate: (value) => ((value ?? '').trim().length === 0 ? 'Feedback is required.' : undefined),
  });

  if (p.isCancel(feedback) || feedback === undefined) {
    p.cancel('Operation cancelled.');
    return undefined;
  }

  return feedback.trim();
}

function logCheck(label: string, passed: boolean): void {
  if (passed) p.log.success(label);
  else p.log.warn(label);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

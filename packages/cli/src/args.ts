import { parse } from '@bomb.sh/args';

export interface CliArguments {
  command: string;
  feedback?: string;
  /**
   * Deployment origin the session and remote commands act on. Absent means "resolve it from the
   * environment".
   */
  url?: string;
  /**
   * Run on a deployment's control plane instead of in this checkout.
   *
   * A flag rather than an inference from `CODE_ZERO_URL`: that variable already selects which
   * deployment `login` and `logout` act on, so treating its presence as "run somewhere else" would
   * silently move an operator's run to another machine and another checkout the first time they
   * set it.
   */
  remote: boolean;
  proactive: boolean;
  help: boolean;
  json: boolean;
  version: boolean;
}

const knownOptions = new Set([
  '_',
  'feedback',
  'help',
  'json',
  'proactive',
  'remote',
  'url',
  'version',
]);
const agentCommands = new Set(['review', 'fix', 'run']);
/** The two commands that talk to a deployment rather than to a checkout. */
const sessionCommands = new Set(['login', 'logout']);

export function parseCliArguments(argv: string[]): CliArguments {
  const parsed = parse(argv, {
    alias: {
      h: 'help',
      v: 'version',
    },
    boolean: ['help', 'json', 'proactive', 'remote', 'version'],
    default: {
      help: false,
      json: false,
      proactive: false,
      remote: false,
      version: false,
    },
    string: ['feedback', 'url'],
  });

  const unknownOption = Object.keys(parsed).find((option) => !knownOptions.has(option));
  if (unknownOption) throw new Error(`Unknown option: --${unknownOption}`);

  const [rawCommand = 'help', ...positionals] = parsed._;
  const command = String(rawCommand);
  if (positionals.length > 0) {
    throw new Error(`Unexpected positional argument: ${String(positionals[0])}`);
  }

  const feedback = parsed.feedback?.trim() || undefined;
  if (feedback !== undefined && !agentCommands.has(command)) {
    throw new Error('--feedback is only valid with review, fix, or run');
  }
  if (parsed.proactive && !agentCommands.has(command))
    throw new Error('--proactive is only valid with review, fix, or run');
  if (parsed.proactive && feedback !== undefined)
    throw new Error('--proactive cannot be combined with --feedback');
  if (parsed.json && command !== 'doctor' && !agentCommands.has(command)) {
    throw new Error('--json is only valid with doctor, review, fix, or run');
  }

  if (parsed.remote && !agentCommands.has(command))
    throw new Error('--remote is only valid with review, fix, or run');

  const url = parsed.url?.trim() || undefined;
  if (url !== undefined && !sessionCommands.has(command) && !parsed.remote)
    throw new Error('--url is only valid with login, logout, or a --remote run');

  return {
    command,
    ...(feedback === undefined ? {} : { feedback }),
    ...(url === undefined ? {} : { url }),
    remote: parsed.remote,
    proactive: parsed.proactive,
    help: parsed.help,
    json: parsed.json,
    version: parsed.version,
  };
}

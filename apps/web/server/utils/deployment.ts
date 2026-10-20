import {
  defaultDeploymentConfig,
  DEPLOYMENT_CONFIG_FILE,
  describeDeploymentConfigIssues,
  editionFromEnvironment,
  LEGACY_DEPLOYMENT_CONFIG_FILE,
  loadDeploymentFile,
  locateDeploymentConfig,
  settingsSourceFromEnvironment,
  type DeploymentConfig,
  type DeploymentConfigIssue,
  type DeploymentFile,
  type Edition,
  type SettingsSource,
} from '@code-zero/config';

/**
 * Which product this deployment is, and where its settings come from, as its environment says.
 *
 * Both are bootstrap values the process reads before anything else, so they live in the
 * environment beside `DATABASE_URL`, where only whoever runs the deployment can change them. No
 * request reaches them: the settings page can show them, never move them.
 */
export interface DeploymentIdentity {
  edition: Edition;
  source: SettingsSource;
  /** Why the environment could not be read. While any is present, every run is refused. */
  issues: readonly DeploymentConfigIssue[];
}

/**
 * Read the edition and the settings source from the environment.
 *
 * An edition this process does not recognise is treated as the managed cloud, the locked one:
 * nothing becomes editable because a variable was mistyped, and the issue it carries keeps every run
 * refused until it is corrected.
 */
export function deploymentIdentity(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): DeploymentIdentity {
  const edition = editionFromEnvironment(environment);
  const resolved: Edition = edition.ok ? edition.value : 'cloud';
  const source = settingsSourceFromEnvironment(environment, resolved);
  return {
    edition: resolved,
    source: source.ok ? source.value : 'file',
    issues: [...(edition.ok ? [] : edition.issues), ...(source.ok ? [] : source.issues)],
  };
}

/** The instance configuration file as this process read it, and where it was found. */
export interface LoadedDeploymentFile extends DeploymentFile {
  path: string;
  /** True when it was found under its old name, `code-zero.deployment.yml`. */
  legacy: boolean;
}

/**
 * Read the instance configuration file — `config.yml`, or the path `CODE_ZERO_CONFIG` names.
 *
 * One file, decided once. When both `config.yml` and the old `code-zero.deployment.yml` exist and
 * neither is named, nothing is read: the control-plane policy keeps its closed defaults and the
 * settings are refused, rather than one file silently winning over the other.
 */
export async function readDeploymentFile(
  environment: Readonly<Record<string, string | undefined>>,
  directory: string,
  edition: Edition,
): Promise<LoadedDeploymentFile> {
  const located = await locateDeploymentConfig(environment, directory);
  if (!located.ok)
    return {
      config: structuredClone(defaultDeploymentConfig),
      issues: located.issues,
      settings: { ok: false, issues: located.issues },
      declaresSettings: false,
      path: `${directory}/${DEPLOYMENT_CONFIG_FILE}`,
      legacy: false,
    };
  return { ...(await loadDeploymentFile(located.value.path, edition)), ...located.value };
}

/**
 * The instance configuration, read once per process and awaited by every reader.
 *
 * Deployment policy changes when the process restarts. What changes while it runs — repositories,
 * and settings kept in the dashboard — lives in the store instead.
 */
let pending: Promise<LoadedDeploymentFile> | undefined;

export function deploymentFile(): Promise<LoadedDeploymentFile> {
  pending ??= readDeploymentFile(process.env, process.cwd(), deploymentIdentity().edition).then(
    (file) => {
      if (file.issues.length > 0)
        // Reported rather than thrown: a refused control-plane field falls back to its own closed
        // default, and the process starting with a loud complaint beats a dashboard that will not
        // load at all. Every issue names its path, so the fix is one edit.
        console.error(
          `[config] ${file.path} has problems; the defaults stand where a value was refused:\n${describeDeploymentConfigIssues(file.issues)}`,
        );
      if (file.legacy)
        console.warn(
          `[config] ${file.path} uses the old name ${LEGACY_DEPLOYMENT_CONFIG_FILE}; rename it to ${DEPLOYMENT_CONFIG_FILE}.`,
        );
      return file;
    },
  );
  return pending;
}

/** The control-plane and polling half of the instance configuration. */
export async function deploymentConfig(): Promise<DeploymentConfig> {
  return (await deploymentFile()).config;
}

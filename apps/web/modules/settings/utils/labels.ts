import type { ServiceName } from '@code-zero/api';
import type { NetworkPolicy, RunMode } from '@code-zero/shared';

import type { SettingsError } from './form';

// Spelled out rather than interpolated, so `i18n:report` can verify every key exists.

export const MODE_LABEL_KEYS: Readonly<Record<RunMode, string>> = {
  observe: 'dashboard.settings.modes.observe',
  suggest: 'dashboard.settings.modes.suggest',
  fix: 'dashboard.settings.modes.fix',
  autonomous: 'dashboard.settings.modes.autonomous',
};

export const NETWORK_LABEL_KEYS: Readonly<Record<NetworkPolicy, string>> = {
  none: 'dashboard.settings.network.none',
  restricted: 'dashboard.settings.network.restricted',
  full: 'dashboard.settings.network.full',
};

export const SERVICE_LABEL_KEYS: Readonly<Record<ServiceName, string>> = {
  model: 'dashboard.settings.services.model',
  sandbox: 'dashboard.settings.services.sandbox',
  database: 'dashboard.settings.services.database',
  mail: 'dashboard.settings.services.mail',
};

/** Why a save was refused. */
export const SAVE_ERROR_KEYS: Readonly<Record<SettingsError, string>> = {
  forbidden: 'dashboard.settings.form.forbidden',
  unauthorized: 'dashboard.settings.form.unauthorized',
  unavailable: 'dashboard.settings.error.unavailable',
  invalid: 'dashboard.settings.form.invalid',
  precondition: 'dashboard.settings.form.precondition',
  generic: 'dashboard.settings.form.generic',
};

/** An ISO timestamp as the dashboard prints times: UTC, to the second. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${date.toISOString().slice(0, 19).replace('T', ' ')}Z`;
}

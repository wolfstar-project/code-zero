import type { ControlPlaneAccess } from '@code-zero/api';
import { describe, expect, it } from 'vitest';

import { createControlPlaneAccessCache } from '../../server/utils/access.js';

describe('createControlPlaneAccessCache', () => {
  it('resolves once and shares the same answer with every later caller', async () => {
    let loads = 0;
    const access: ControlPlaneAccess = { principals: new Map() };
    const controlPlaneAccess = createControlPlaneAccessCache(() => {
      loads += 1;
      return Promise.resolve(access);
    });

    await expect(controlPlaneAccess()).resolves.toBe(access);
    await expect(controlPlaneAccess()).resolves.toBe(access);
    expect(loads).toBe(1);
  });

  it('retries after a failed load instead of replaying the same rejection forever', async () => {
    // A transient failure — the config file briefly unreadable during a rolling deploy, say — must
    // not wedge every later call behind it for the rest of the process's life.
    let loads = 0;
    const access: ControlPlaneAccess = { principals: new Map() };
    const controlPlaneAccess = createControlPlaneAccessCache(() => {
      loads += 1;
      return loads === 1 ? Promise.reject(new Error('config unreadable')) : Promise.resolve(access);
    });

    await expect(controlPlaneAccess()).rejects.toThrow('config unreadable');
    await expect(controlPlaneAccess()).resolves.toBe(access);
    // A third call finds the second's success already cached, not a third load.
    await expect(controlPlaneAccess()).resolves.toBe(access);
    expect(loads).toBe(2);
  });

  it('does not start a second load while the first is still in flight', async () => {
    let loads = 0;
    let resolve!: (access: ControlPlaneAccess) => void;
    const first = new Promise<ControlPlaneAccess>((res) => {
      resolve = res;
    });
    const controlPlaneAccess = createControlPlaneAccessCache(() => {
      loads += 1;
      return first;
    });

    const a = controlPlaneAccess();
    const b = controlPlaneAccess();
    resolve({ principals: new Map() });

    await Promise.all([a, b]);
    expect(loads).toBe(1);
  });
});

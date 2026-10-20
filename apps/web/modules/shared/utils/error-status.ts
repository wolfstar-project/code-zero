/**
 * Reads both Nuxt-normalized (`status`) and raw h3 (`statusCode`) shapes so callers stay correct
 * no matter which layer produced the error.
 */
export function resolveErrorStatus(error: { status?: number; statusCode?: number }): number {
  return error.status ?? error.statusCode ?? 500;
}

export function isNotFoundStatus(status: number): boolean {
  return status === 404;
}

export function isServerErrorStatus(status: number): boolean {
  return status >= 500;
}

/**
 * Whether this code is running inside a Cloudflare Worker.
 *
 * Read from the runtime rather than from the build: the Worker identifies itself in
 * `navigator.userAgent`, and every other host this app builds for (Node, Vercel) does not, so one
 * bundle never needs to be told where it is. What differs there is not a preference but a limit —
 * a Worker holds no process-wide timers and no connection that outlives a request.
 */
export function isCloudflareWorker(): boolean {
  return globalThis.navigator?.userAgent === 'Cloudflare-Workers';
}

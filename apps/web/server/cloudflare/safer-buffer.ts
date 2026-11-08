/**
 * Stands in for `safer-buffer`, which cannot load in a Worker.
 *
 * `safer-buffer` copies the properties of `require('buffer')` with `buffer.hasOwnProperty(key)`, and
 * under `nodejs_compat` that module is a namespace without the method, so the copy throws while the
 * bundle starts. What the package adds on every runtime this app targets is one thing: a `Buffer`
 * without `allocUnsafe` and `allocUnsafeSlow`, so a caller cannot get uninitialised memory by
 * mistake. This keeps exactly that, and nothing of the fallbacks for Node versions older than 4.5.
 * `nuxt.config.ts` aliases the package here on Cloudflare.
 */
import { Buffer as NodeBuffer } from 'node:buffer';

const UNINITIALISED = new Set(['allocUnsafe', 'allocUnsafeSlow']);

export const Buffer = Object.assign(
  Object.fromEntries(Object.entries(NodeBuffer).filter(([key]) => !UNINITIALISED.has(key))),
  { from: NodeBuffer.from.bind(NodeBuffer), alloc: NodeBuffer.alloc.bind(NodeBuffer) },
  { prototype: NodeBuffer.prototype },
);

export default { Buffer };

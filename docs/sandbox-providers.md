# Hosted sandbox provider evaluation

Code Zero v0.3 defines the vendor-neutral lifecycle in `packages/runner`: provision a credential-free request, expose the resulting checkout only as a `Runner`, stop it explicitly, and expire bounded leases. A provider adapter owns its client and credentials privately. No SDK response or secret is copied into agent state, task history, lease snapshots, or logs.

## Evaluation

| Provider                                                         | Relevant primitives                                                                          | Fit                                                                                                              | Adapter note                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [ViteHub](https://vitehub.dev/)                                  | Workspace, Sandbox, KV, Queue, Workflow, Schedule                                            | Strongest match for a portable control-plane vocabulary and persistent workspaces paired with isolated execution | Preferred first portability pilot. Keep Workspace identifiers inside the adapter and expose only `Runner` operations.                    |
| [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) | Workers, Durable Objects, Containers, command/file lifecycle, persistent storage and backups | Strong deployment-native option for a Cloudflare control plane                                                   | Map one lease to a Durable Object/container lifecycle. Inject bindings into the adapter; never serialize them.                           |
| [Vercel Sandbox](https://vercel.com/docs/sandbox)                | Ephemeral Firecracker microVMs, commands, snapshots, network policy and explicit stop        | Strong isolated execution option for a Vercel deployment                                                         | Map `provision`, command/file operations, and `stop` to `@vercel/sandbox`; keep token/project/team configuration private to the adapter. |

## Decision

The core does not select a vendor. `SandboxProvider` and `RunnerPool` are the stable boundary; deployment packages can add ViteHub, Cloudflare, or Vercel implementations without changing the agent or server procedures. The first production adapter should pilot ViteHub because its Workspace/Sandbox split most directly represents Code Zero's need for a durable checkout plus replaceable execution. Cloudflare and Vercel remain deployment-specific adapters behind the same tests.

Every adapter must prove:

- no credential appears in `SandboxRequest`, `SandboxLease`, `TaskResult`, stored task JSON, or captured output;
- observe/suggest mounts are mechanically read-only;
- network policy is applied rather than merely recorded;
- CPU, memory, command timeout, output, active-count, per-repository, and lease-duration limits are enforced;
- `release` is idempotent and an expiry sweep stops abandoned sandboxes;
- repository reads, writes, git inspection, and commands still flow only through `Runner`.

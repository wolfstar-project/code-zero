# Source-control providers

Code Zero integrates with source-control platforms through `packages/source-control`: a
provider-neutral boundary with one adapter per platform. The agent runtime consumes only shared
contracts (`ReviewInput`, `FeedbackItem`, `PullRequestRef`); provider payload shapes, URLs, IDs,
event names, and credentials never cross the boundary. One deployment may connect repositories
from several providers at once: inbound deliveries are routed to the adapter that recognizes
their headers, and each configured provider keeps its own webhook secret.

The find → fix → verify workflow is identical on every provider. What differs is what each
platform can express, and the boundary makes those differences explicit instead of guessing.

## Contracts

- `SourceControlProvider` — one platform: webhook recognition, authentication, event
  normalization, and status publishing.
- `ProviderCapabilities` — what the adapter can actually deliver. Flags describe the webhook and
  API surface the adapter consumes, not the platform's brochure.
- `ChangeRequestRef` — a provider-neutral pull-/merge-request reference. `baseSha` is present
  only when the provider's payload carries a diff base.
- `runOutcome` — the provider-neutral meaning of a finished run (`success`, `failure`,
  `neutral`, `action-required`), derived from the evidence bundle in exactly one place.
- `StatusPublication` — what was actually reported, including a `degraded` note whenever an
  outcome had no native equivalent on the platform.

## Capability matrix

| Capability             | GitHub      | GitLab        | Bitbucket Cloud | Bitbucket Data Center | Gitea / Forgejo |
| ---------------------- | ----------- | ------------- | --------------- | --------------------- | --------------- |
| Webhook authentication | HMAC-SHA256 | shared token  | HMAC-SHA256     | HMAC-SHA256           | HMAC-SHA256     |
| Status reporting       | check runs  | commit status | build status    | build status          | commit status   |
| Neutral conclusion     | native      | degraded      | degraded        | degraded              | degraded        |
| Action-required        | native      | degraded      | degraded        | degraded              | degraded        |
| Review submissions     | yes         | notes only    | comments only   | comments only         | yes             |
| Formal change requests | yes         | no text       | no text         | no text               | yes             |
| Inline comment anchors | yes         | yes           | yes             | not delivered         | not delivered   |
| Bot author detection   | yes         | no            | no              | no                    | no              |
| Diff base in payload   | yes         | no            | yes             | yes                   | yes             |

Notes on explicit degradation:

- **Statuses.** Only GitHub can express `neutral` and `action_required`. Elsewhere a neutral
  outcome (for example, incorrect feedback rejected with evidence) is reported as the platform's
  success state, and action-required maps to the platform's blocking state (`failed` on GitLab
  and Bitbucket, `warning` on Gitea). Every mapping is returned in `StatusPublication.degraded`
  so callers can surface it; a failed verification is never presented as success anywhere.
- **Diff base.** GitLab merge-request webhooks carry no base commit. The adapter never invents
  one: the run receives no pull-request range and falls back to runner-side diff discovery.
- **Formal change requests.** GitLab approvals/"request changes", Bitbucket's
  `changes_request_created`, and Bitbucket Data Center's `needs_work` arrive without text, so
  there is no claim to validate and the events are ignored. Reviewer text arrives as comments.
- **Bots.** Only GitHub payloads mark bot authors, so `allowBots: false` filters bots there and
  is documented as unenforceable elsewhere. Self-replies are prevented on every provider through
  `ignoreAuthors`.

## Webhook routing

Deliveries are identified by provider headers, not by URL:

| Provider              | Event header                        | Authentication header                                  |
| --------------------- | ----------------------------------- | ------------------------------------------------------ |
| GitHub                | `X-GitHub-Event`                    | `X-Hub-Signature-256` (`sha256=`)                      |
| GitLab                | `X-Gitlab-Event`                    | `X-Gitlab-Token` (constant-time)                       |
| Bitbucket Cloud       | `X-Event-Key`                       | `X-Hub-Signature` (`sha256=`)                          |
| Bitbucket Data Center | `X-Event-Key`                       | `X-Hub-Signature` (`sha256=`)                          |
| Gitea / Forgejo       | `X-Gitea-Event` / `X-Forgejo-Event` | `X-Gitea-Signature` / `X-Forgejo-Signature` (bare hex) |

Gitea and Forgejo also send GitHub compatibility headers; the registry consults their adapter
first and the GitHub adapter declines deliveries carrying a Gitea or Forgejo header. The two
Bitbucket products are distinguished by event-key shape (`pullrequest:*` versus `pr:*`).

Regardless of provider, a webhook can never escalate a run: parsed events produce `observe`-mode
input unless the deployment's own policy chooses otherwise, and an unverifiable delivery is
rejected before its payload is parsed.

## Status credentials

Status publishing reads one fixed environment variable per provider; credentials are sent only
as an `Authorization` header and are redacted from any error raised.

| Provider              | Variable                      | Notes                                    |
| --------------------- | ----------------------------- | ---------------------------------------- |
| GitHub                | `GITHUB_TOKEN`                | Checks API                               |
| GitLab                | `GITLAB_TOKEN`                | `baseUrl` for GitLab Self-Managed        |
| Bitbucket Cloud       | `BITBUCKET_CLOUD_TOKEN`       | access token with repository write scope |
| Bitbucket Data Center | `BITBUCKET_DATA_CENTER_TOKEN` | `baseUrl` required                       |
| Gitea / Forgejo       | `GITEA_TOKEN`                 | `baseUrl` required                       |

The two Bitbucket products keep separate variables because a deployment may connect both with
distinct credentials; a shared variable would force one publication path to authenticate with
the other product's token.

## Conformance

Every adapter must pass the same conformance suite (`src/conformance.ts`), driven by authentic
signed fixtures per provider: recognition, constant-time authentication with forgery and
tampering rejection, proactive and feedback normalization, self-reply suppression, junk-payload
tolerance, observe-by-default input, credential-free status publishing, and explicit degradation
of unsupported conclusions. New provider adapters start by supplying fixtures to this suite.

## forges

`packages/forge` (`@code-zero/forge`) is the boundary that replaces `packages/source-control`. It
is built on the [`forges`](https://forges.link) library (0.1.x), which owns signature
verification, payload normalization, and every API call, so Code Zero no longer maintains a
hand-written adapter per platform. It is not wired into `packages/api` or `apps/web` yet; until it
is, `packages/source-control` stays the boundary those two use.

It connects to six forges: GitHub, GitLab, Gitea, Forgejo, Bitbucket Cloud, and Azure DevOps.
`forges` supports more (Gitee, Tangled, Cursor Origin, Pushin.eu, Cloudflare Artifacts); a
connection to any of them is refused. Bitbucket Data Center has no `forges` provider, so it is the
one platform `packages/source-control` covers that this boundary does not.

### Contracts and operations

- `createForgeRegistry(connections)` — one `forges` provider per connection
  (`{ kind, instance, baseUrl?, auth, webhookSecret?, readOnly? }`, plus `organization` on Azure
  DevOps), routed by forge and instance host. Two connections to the same instance are refused.
  `list()` reports each connection's derived `ForgeCapabilities` and never its credentials.
- `connectionsFromEnvironment(env)` — the same connections from `FORGES_<KIND>_<FIELD>[_<SUFFIX>]`
  variables through `forges/env`. The factories hold the credentials; each connection also lists
  their values, read from the same environment object, so the registry can redact them even when
  that object is not `process.env`. Every set that does not become a connection is reported with a
  reason that never contains one.
- `ingestDelivery(registry, kind, { headers, body }, options)` — verifies the delivery with
  `webhooks.verify`/`webhooks.ingest` and translates its events into `ReviewEvent` and
  `IssueEvent`. A forged, unsigned, or unparseable delivery is a typed `rejected` outcome, never
  a thrown error. Head and base commits, issue text, labels, and the issue's author are read from
  the forge's own record of the thread (`threads.get`), not from the payload that announced it.
  `ignoreAuthors` and `allowBots: false` apply to the feedback's author and to the issue's author;
  issue events are ignored unless `issues.requireLabel` is passed, and then only for an open
  issue carrying that label.
- `listOpenChangeRequests(registry, repository, { maxPages, perPage })` — the poller's discovery,
  bounded by an explicit page limit that it reports as `truncated` when it runs out.
- `publishOutcome(registry, changeRequest, bundle)` — reports `runOutcome(bundle)` through
  `checks.report`, compares the state the forge recorded with the one asked for, and returns
  `degraded` for every mapping. Without a status surface it falls back to a comment, and says so.
- `upsertProgressComment`, `publishEvidenceComment`, `publishIssueValidationComment` — one comment
  per purpose, edited in place through `threads.upsertComment` and its hidden key. Bodies are
  redacted, bounded to the forge's comment limit, and rewritten into its Markdown dialect.
- `publishIssuePullRequest(registry, request)` — `prepareIssuePullRequest` decides first; then a
  commit on a fresh `issues.branchPrefix` branch (`contents.commitFiles` with `createFrom`, which
  fails when the branch exists) and a pull request against the base. Every step is checked with
  the provider before it is attempted, and a missing one is an explicit `unsupported` outcome.

### Capability matrix

Derived from `provider.support()` for a token connection (Basic on Bitbucket), as the
`capabilities.test.ts` suite pins it for `forges` 0.1.0. A read-only or anonymous connection
reports every write unsupported.

| Capability                     | GitHub   | GitLab   | Gitea    | Forgejo  | Bitbucket   | Azure DevOps |
| ------------------------------ | -------- | -------- | -------- | -------- | ----------- | ------------ |
| Webhooks (`webhooks.ingest`)   | native   | native   | native   | native   | native      | native       |
| Change-request reads           | native   | native   | native   | native   | native      | native       |
| Issue reads                    | native   | native   | native   | native   | unsupported | native       |
| Discovery (`threads.listPage`) | native   | native   | native   | native   | native      | native       |
| Status reporting               | native   | native   | native   | native   | native      | native       |
| Change-request comments        | native   | native   | native   | native   | native      | native       |
| Issue comments                 | native   | native   | native   | native   | unsupported | experimental |
| Stable comments (upsert)       | emulated | emulated | emulated | emulated | emulated    | emulated     |
| Pull-request creation          | native   | native   | native   | native   | native      | native       |
| Commit files (`commitFiles`)   | —        | —        | —        | —        | —           | —            |

`contents.commitFiles` is documented on forges.link but not shipped in `forges` 0.1.x, so
`publishIssuePullRequest` is `unsupported` on every forge today. The package reads the
declaration directly rather than calling `can()`, which throws for a verb the release does not
know, so issue-to-PR lights up on the release that ships it without a change here.

### Behaviour by forge

| Behaviour                   | GitHub                                     | GitLab                   | Gitea / Forgejo                               | Bitbucket                              | Azure DevOps               |
| --------------------------- | ------------------------------------------ | ------------------------ | --------------------------------------------- | -------------------------------------- | -------------------------- |
| Credentials                 | token, GitHub App                          | token                    | token                                         | token, Basic                           | token (as Basic), Basic    |
| Webhook authentication      | `X-Hub-Signature-256`                      | `X-Gitlab-Token`         | `X-Gitea-Signature` / `X-Forgejo-…`           | `X-Hub-Signature`                      | Basic `Authorization`      |
| Status surface              | check run with an App, else status         | commit status            | commit status                                 | build status                           | commit status              |
| Neutral outcome             | degraded to success; native on a check run | degraded to success      | degraded to success                           | degraded (`STOPPED`, reads as failure) | native (`notApplicable`)   |
| Action-required outcome     | degraded to failure                        | degraded to failure      | degraded to failure                           | degraded to failure                    | degraded to failure        |
| Feedback text in deliveries | reviews, inline, comments                  | notes (no inline anchor) | reviews (review comments arrive without text) | not delivered                          | not delivered              |
| New push starts a review    | yes                                        | yes (with `oldrev`)      | yes                                           | no (reported as `edited`)              | no (reported as `edited`)  |
| Issues                      | yes                                        | yes                      | yes                                           | no issue tracker                       | work items, project-scoped |

Notes on explicit degradation:

- **Statuses.** `forges` has no action-required state, so it is reported as a failure everywhere:
  a run waiting for a human must not let the change request proceed. A neutral outcome is
  reported as neutral, and whatever the forge records instead is returned in
  `StatusPublication.degraded`. Commit statuses carry a short description and no report, so the
  evidence travels as a separate comment.
- **Feedback without text.** `forges` 0.1 normalizes Bitbucket and Azure DevOps pull-request
  comments, and Gitea/Forgejo review comments, without their text. Such events are ignored with a
  reason rather than validated against nothing; the author filters still apply to them.
- **Pushes.** Bitbucket and Azure DevOps report a push to an open pull request as `edited`, the
  same action as a title change, so it does not start a proactive review there. The poller
  notices the new head on those forges.
- **Azure DevOps.** A repository ref's `owner` is `organization/project`. Service hooks are not
  signed: set the webhook secret to the `user:password` the subscription sends, and every other
  delivery fails verification.

### Environment

| Variable                                                   | Effect                                               |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| `FORGES_<KIND>_TOKEN`                                      | token credential                                     |
| `FORGES_<KIND>_BASE_URL`, `_INSTANCE`                      | self-hosted API URL and the instance host refs carry |
| `FORGES_<KIND>_WEBHOOK_SECRET`                             | webhook secret (`user:password` on Azure DevOps)     |
| `FORGES_<KIND>_READ_ONLY`                                  | `1` or `true` refuses every write                    |
| `FORGES_GITHUB_APP_ID`, `_PRIVATE_KEY`, `_INSTALLATION_ID` | GitHub App credentials                               |
| `FORGES_BITBUCKET_USERNAME`, `_PASSWORD`                   | Basic credentials (Atlassian email and API token)    |
| `FORGES_AZURE_DEVOPS_ORGANIZATION`                         | required for Azure DevOps                            |

`<KIND>` is `GITHUB`, `GITLAB`, `GITEA`, `FORGEJO`, `BITBUCKET`, or `AZURE_DEVOPS`. A suffix after
the field (`FORGES_GITHUB_TOKEN_WORK`) starts a second connection to another instance.

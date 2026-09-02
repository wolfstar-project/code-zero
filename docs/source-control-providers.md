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

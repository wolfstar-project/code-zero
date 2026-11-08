# Onboarding: organization, GitHub App installation, repository selection

Status: proposed. Decisions marked **(owner)** were made by the project owner on 2026-11-08; the rest
are the author's calls and are open to change in review.

## Why

A person who signs in to the managed cloud today lands on an empty dashboard. Nothing tells them to
create an organization, and nothing connects their code. The cloud also has no checkout on disk, so
the existing `repository` table (an allow-list of `checkout_path` values, global to the deployment)
cannot describe what a customer wants reviewed.

The goal is one guided path: sign in, create an organization, install the Code Zero GitHub App, and
choose which of the repositories the installation can see Code Zero should watch.

## Flow

1. A signed-in user with no organization is sent to `/onboarding`. **(owner: every registered user,
   wizard required)**
2. **Organization.** They name it. The slug is derived and editable. They become its owner.
3. **Install.** The wizard sends them to the GitHub App's install page with a signed `state`. GitHub
   returns to `/onboarding/github/callback` with `installation_id` and a user authorization `code`.
4. **Choose repositories.** The wizard lists the repositories the installation can see. They tick the
   ones to watch and pick `observe` or `suggest` (never a writable mode).
5. Done: the dashboard shows the organization's repositories.

A user who already has an organization is not redirected. `/onboarding` stays reachable to add
another installation or more repositories.

## Goals

- One path from first sign-in to a watched repository, with no operator involvement.
- An installation belongs to exactly one organization, and only someone who controls it on GitHub
  can attach it.
- Self-hosted behavior is unchanged: the `repository` table, `checkout_path`, and the poller stay as
  they are.

## Non-goals

- Creating the GitHub App itself (a one-time owner action, see below).
- GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps onboarding. The tables carry a `provider` column
  so they can follow; the wizard is GitHub only.
- Running reviews. Selecting a repository records intent; execution on the cloud is separate work.
- Billing and plan limits.

## Anti-goals

- Never store an installation token or the app private key in the database. The private key is a
  Worker secret; installation tokens are minted per request by the `forges` provider.
- Never let a user attach an installation they cannot prove they control, even if they know its id.

## Data model **(owner: organization-scoped, no checkout)**

Two new tables in `packages/database`, with a checked-in migration. `repository` is untouched.

`forge_installation`

| column                          | notes                                                       |
| ------------------------------- | ----------------------------------------------------------- |
| `id`                            | text primary key, `crypto.randomUUID()` in application code |
| `organization_id`               | references `organization.id`, cascade                       |
| `provider`                      | text, default `github`                                      |
| `external_id`                   | the provider's installation id, as text                     |
| `account_login`, `account_type` | the GitHub user or organization the app is installed on     |
| `created_by_user_id`            | references `user.id`, set null on delete                    |
| `suspended_at`                  | set from the `suspend` webhook, null while active           |
| timestamps                      | `timestampColumns`                                          |

Unique on `(provider, external_id)`: one installation, one organization.

`organization_repository`

| column                      | notes                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- |
| `id`                        | text primary key                                                                |
| `organization_id`           | references `organization.id`, cascade                                           |
| `installation_id`           | references `forge_installation.id`, cascade                                     |
| `provider`, `owner`, `name` | coordinates on the provider                                                     |
| `external_id`               | the provider's repository id, so a rename does not lose the row                 |
| `mode`                      | `observe` or `suggest`, checked where rows are written, as `repository.mode` is |
| timestamps                  | `timestampColumns`                                                              |

Unique on `(organization_id, provider, owner, name)`.

## API

New procedures in `packages/api`, behind the existing `authenticated` middleware, session principals
only. Each checks organization membership itself (the active organization on a session is a claim,
not a grant), the way `settings.organization.*` does.

| procedure                                               | role needed                             | does                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `installations.start`                                   | owner or admin                          | returns the GitHub App install URL carrying a signed `state` bound to the user and organization                                   |
| `installations.complete`                                | owner or admin                          | verifies `state`, verifies control of `installation_id`, stores the row                                                           |
| `installations.list`                                    | member                                  | the organization's installations                                                                                                  |
| `installations.repositories`                            | owner or admin                          | the repositories the installation can see, from the provider, never cached in the database                                        |
| `organizationRepositories.select` / `.remove` / `.list` | owner or admin to write, member to read | the selected repositories; `select` names repositories by provider id and takes owner and name from what the installation can see |

`packages/api` defines the contracts structurally, as it does for `RepositoryAdmin`:

```ts
interface InstallationProvider {
  installUrl(state: string): string;
  /** Proves the user controls the installation and returns its account. */
  verify(input: { installationId: string; userCode: string }): Promise<InstalledAccount>;
  repositories(installationId: string): Promise<VisibleRepository[]>;
}
```

`apps/web` implements it over `@code-zero/forge`, which `apps/web` does not import yet; adding that
dependency is the first step of wiring it in (see `packages/forge` in `CLAUDE.md`). Creating the
organization uses the Better Auth organization client, as `useOrganizations()` already does.

## Proving control of an installation

An `installation_id` arrives in a query string, so it is attacker-controlled. Claiming it without a
check would let anyone attach another customer's installation by guessing an id.

`installations.complete` therefore needs the user authorization `code` GitHub sends back when the
app is configured to request user authorization during installation. It exchanges the code for a user
token with the app's client id and secret, lists `GET /user/installations`, and accepts the id only if
it appears there. `state` is signed with a Worker secret, bound to the person and the organization it
was issued for, and expires in ten minutes, which closes the cross-site request forgery path. It is
not single use: replaying one inside its window attaches the same installation again, which is a
no-op, so a nonce store would add state without closing anything.

Resolved: from `app.code-zero.dev` the Worker used to get HTTP 525 on every request to a host that is
not behind Cloudflare, `https://github.com/login/oauth/access_token` included. The cause was the
`code-zero.dev` zone's origin TLS compliance setting (`origin_tls_compliance_modes`), which required a
post-quantum hybrid key exchange (`pqh`). Hosts behind Cloudflare negotiate it; GitHub, Wikipedia and
AWS do not. The zone now keeps `fips` only. Anything that makes the Worker call a non-Cloudflare host
(GitHub, a model provider, a mail API) depends on that setting staying without `pqh`.

## GitHub App **(owner: to be created)**

The owner creates the app once, from a manifest this repository will carry. It needs:

- Repository permissions: Metadata (read), Contents (read), Pull requests (read and write), Checks
  (read and write), Issues (read). The writable ones can be dropped to read-only for an `observe`
  only launch.
- Subscribed events: `installation`, `installation_repositories`, `pull_request`.
- Request user authorization during installation, with the callback
  `https://app.code-zero.dev/onboarding/github/callback`.
- A webhook at `https://app.code-zero.dev/webhooks/github`, with a secret.

Worker configuration, all secrets: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`, `ONBOARDING_STATE_SECRET`. Variable:
`GITHUB_APP_SLUG`. Organization policy: `AUTH_ENABLE_ORGANIZATIONS=true` and
`AUTH_ALLOW_ORGANIZATION_CREATION=true` on the cloud edition.

## Slices

Each slice is its own pull request and is useful on its own.

1. **Schema and API.** Tables, migration, the `InstallationProvider` contract, the procedures, and
   unit tests against a fake provider and the in-memory store. No UI, no secrets.
2. **Provider.** `apps/web` depends on `@code-zero/forge` and implements `InstallationProvider`, plus
   the signed state and the `installation` webhook handler that keeps `suspended_at` and removed
   repositories current.
3. **Wizard.** `/onboarding` and its callback route, the redirect for users without an organization,
   the `onboarding` message file in `en` and `it`, and the organization policy variables.
4. **Manifest and docs.** The GitHub App manifest, the deployment guide, and the checklist of Worker
   secrets.

## Left to the builder

Component structure and styling inside the existing design system, exact copy, pagination of the
repository list (`reposPage` is paged), and how the wizard resumes after a reload.

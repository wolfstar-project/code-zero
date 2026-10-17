# Code Zero v2 — brainstorming e piani di ristrutturazione

Stato: **decisioni prese** (2026-10-17, vedi §10). Scritta prima di toccare codice: ogni sezione termina con le
decisioni prese per default e le domande aperte. Le risposte alle domande in fondo cambiano il piano
esecutivo (docs/plans/<data>-<sottoprogetto>.md), che verrà scritto solo dopo.

Fonti consultate: stato del repo su `feat/dashboard-live-control` (c51178d), `docs/PLAN.md`
(2026-09-05), supastarter.dev/nuxt, forges.link (introduction, installation, providers, data-model,
webhooks, env, capability-matrix, github), pullfrog (repo, action.yml, package.json, docs),
Blacksmith [code]smith (overview, pricing), Dokploy (pricing, blog licenza), harlan-agent-kit, Better
Auth (passkey, 2fa, admin), skilld.dev.

---

## 0. Diagnosi: cosa non va oggi

| Area           | Problema osservato                                                                                                                                                                                                                                        | Evidenza                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Dashboard      | Le viste esistono solo per `/`, `/audit`, `/organizations`; nessuna pagina per repository, runner, modelli, findings, impostazioni, membri, sicurezza.                                                                                                    | `apps/dashboard/app/pages`                                                       |
| Dashboard      | Logica di controllo (`poller`, `store`, `overview`, `access`, `repositories`) vive in `server/utils` dell'app, non in `packages/api`: non testabile fuori da Nitro e non riusabile da un worker o dall'Action.                                            | `apps/dashboard/server/utils/*` (11 file)                                        |
| Dashboard      | `modules/*` dell'app sono moduli Nuxt "feature" ma condividono tipi duplicati con `packages/api` (`types/dashboard.ts`, `types/audit.ts`).                                                                                                                | `apps/dashboard/modules/*/types`                                                 |
| Auth           | Organizzazioni, inviti e device flow ci sono, ma dietro flag ambiente valutati **a build time** (`authConfigFromEnvironment()` in `nuxt.config.ts`): cambiare policy richiede rebuild. Mancano passkey, 2FA, admin/impersonation, ruoli org con permessi. | `nuxt.config.ts`, `packages/auth/src/auth.ts`                                    |
| Auth           | Gli inviti passano da `@octopi-ai/better-enrollment` **e** dal plugin `organization` di Better Auth: due modelli (invite/inviteUse + invitation) per lo stesso concetto.                                                                                  | `packages/database/src/schema/{enrollment,organization}.ts`                      |
| Source control | Adapter GitHub/GitLab/Bitbucket/Gitea scritti a mano (16 file + 9 test), con un solo endpoint webhook GitHub nell'app. Da sostituire con `forges`.                                                                                                        | `packages/source-control/src/providers`, `server/routes/webhooks/github.post.ts` |
| Repo           | `packages/github/` è una cartella residua (solo `dist`, nessun `package.json`, non tracciata): da rimuovere.                                                                                                                                              | `git ls-files packages/github` vuoto                                             |
| Esecuzione     | Il poller e l'esecuzione dei run girano **dentro il processo Nitro**: impossibile su serverless (Cloudflare/Vercel), e un run lungo muore con l'HMR in dev. `docs/PLAN.md` lo segnala come rischio.                                                       | `server/plugins/poller.ts`, `docs/PLAN.md` "Rischi"                              |
| Store          | Task e audit in KV (`fs-lite`/Upstash) mentre auth è in Postgres: due store, nessuna transazione, `list()` legge tutto a ogni overview.                                                                                                                   | `packages/api/src/storage.ts`, `docs/PLAN.md`                                    |
| Config         | Quattro file `.env` per quattro processi più `code-zero.deployment.yml`: corretto per principio, ma l'onboarding self-host è lungo. Nessun `docker compose up` che funzioni da solo.                                                                      | `.env.example`, `apps/dashboard/.env.example`                                    |
| Stile          | Token oklch in `main.css` + `uno.theme.ts` ben fatti, ma duplicati fra dashboard e marketing; nessun `packages/ui`, nessun `DESIGN.md`.                                                                                                                   | `apps/dashboard/app/assets/css/main.css`, `docs/PLAN.md` "Cosa resta"            |
| Business       | Nessun concetto di edizione (self-hosted vs cloud), piani, entitlement, billing. `@better-auth/infra` è l'unico hook "cloud".                                                                                                                             | `packages/auth/src/auth.ts`                                                      |

Cosa invece **è solido e si tiene**: `packages/agent` (state machine), `packages/runner` (boundary
di esecuzione e sandbox), `packages/models`, `packages/config`, `packages/shared`, toolchain (aube,
turbo, tsdown, oxlint/oxfmt, knip, tsgo), i18n centralizzato, mail con Maizzle, i token di design.

Decisione di fondo: **"quasi da zero" = riscrivere il bordo (apps, api, auth, database,
source-control) e la struttura del workspace; non riscrivere il runtime.** Il runtime ha test
deterministici e nessuna dipendenza da HTTP: rifarlo è costo senza guadagno.

---

## 1. Struttura target del workspace (modello supastarter)

```
apps/
  web/            # dashboard + auth + billing UI + API host (era apps/dashboard)
  marketing/      # sito pubblico, prerender, copy in packages/i18n
  docs/           # Docus, include docs/*.md
  mail-preview/   # Maizzle dev-only
packages/
  core/           # runtime: agent, runner, models, config, shared  (resta com'è, 5 pacchetti)
  forge/          # NUOVO: wrapper di `forges` + contratti Code Zero (sostituisce source-control)
  database/       # schema Drizzle (auth + org + billing + tasks + audit + repos), migrazioni
  auth/           # Better Auth options factory: org, passkey, 2FA, admin, magic link, device, bearer
  api/            # oRPC router + control-plane operations + scheduler (senza Nitro)
  worker/         # NUOVO: esecuzione dei run fuori dal processo HTTP (Docker/Node long-running)
  action/         # NUOVO: GitHub Action / GitLab CI component autonomi (modello pullfrog)
  edition/        # NUOVO: entitlement, piani, feature flag self-hosted vs cloud
  payments/       # NUOVO (solo cloud): provider Stripe/Polar/Lemonsqueezy dietro un contratto
  ui/             # NUOVO: token oklch, UnoCSS preset, componenti base condivisi (web+marketing+docs)
  mail/           # template transazionali (resta)
  i18n/           # locali (resta)
  cli/            # `zero` (resta; parla con api via oRPC client)
  build-env/      # resta
tooling/
  oxc/            # resta
  tsconfig/       # NUOVO: tsconfig.base per app, pacchetto, nuxt-layer
docs/             # architettura, provider, piani
.agents/skills/   # skill del progetto (vedi §7)
```

Note:

- `agent/runner/models/config/shared` si spostano sotto `packages/core/*` (Q1); i nomi npm non
  cambiano, quindi gli import restano identici.
- `apps/dashboard` diventa `apps/web` (Q2).
- Un pacchetto per capability, mai `utils`. Regola già in `code-zero-architecture`; si conferma.

---

## 2. Piano A — Auth e organizzazioni complete

Obiettivo: parità con supastarter su auth, con la policy di Code Zero (observe by default, fail
closed).

**Plugin Better Auth da registrare in `packages/auth`:**

| Capacità                                 | Plugin                            | Note                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email+password, verifica email, reset    | core                              | già presente                                                                                                                                                                                                    |
| OAuth GitHub, GitLab, Google             | core `socialProviders`            | GitLab/Google sono nuovi; GitHub serve anche per collegare l'account al forge                                                                                                                                   |
| Magic link                               | `magicLink`                       | via `packages/mail`                                                                                                                                                                                             |
| Passkey                                  | `@better-auth/passkey`            | tabella `passkey`; rpID = host della web app                                                                                                                                                                    |
| 2FA TOTP + backup codes + trusted device | `twoFactor`                       | `issuer: "Code Zero"`, OTP via mail opzionale                                                                                                                                                                   |
| Organizzazioni, membri, inviti, team     | `organization`                    | ruoli `owner/admin/member` + `createAccessControl` con statement Code Zero: `repository:{read,write,configure}`, `task:{create,approve,cancel}`, `policy:{write}`, `billing:{manage}`, `member:{invite,remove}` |
| Admin globale, ban, impersonation        | `admin`                           | sostituisce il check `role=admin` manuale in `packages/api/src/access.ts`                                                                                                                                       |
| API key per CI/macchine                  | `apiKey`                          | sostituisce `CODE_ZERO_CONTROL_PLANE_TOKENS` (token in env): chiavi per-organizzazione, revocabili dalla UI, con rate limit                                                                                     |
| Device flow per `zero login`             | `deviceAuthorization` + `bearer`  | già presente                                                                                                                                                                                                    |
| Multi-sessione, ultimo metodo di login   | `multiSession`, `lastLoginMethod` | già presenti                                                                                                                                                                                                    |
| OAuth proxy per preview                  | `oAuthProxy`                      | già presente                                                                                                                                                                                                    |
| Cloud: sentinel/dash                     | `@better-auth/infra`              | solo edizione cloud (vedi Piano F)                                                                                                                                                                              |

**Decisioni:**

- **Tenere** `@octopi-ai/better-enrollment` per gli inviti (Q3): è più completo degli inviti base
  di Better Auth (link pubblici con limite d'uso, scadenza, prova di possesso della mailbox). Il
  plugin `organization` resta per org, membri e ruoli; il suo flusso di invito nativo non si espone
  nella UI, così il modello utente è uno solo.
- Policy auth letta **a runtime** dal file di deployment (`code-zero.deployment.yml: auth:`) e dal
  DB (impostazioni istanza), non più a build time. La pagina di login chiede al server quali metodi
  sono attivi (`auth.capabilities` in oRPC) invece di leggerli da `appConfig`.
- Multi-tenant per default: ogni risorsa (repository, task, policy, chiave API, audit) ha
  `organizationId`. Self-hosted single-user = un'org creata al primo avvio (onboarding wizard).

**Pagine web (apps/web):**
`/login`, `/signup`, `/forgot`, `/reset`, `/verify`, `/two-factor`, `/passkey`,
`/invite/[id]`, `/onboarding`, `/settings/account`, `/settings/security` (passkey, 2FA, sessioni),
`/settings/api-keys`, `/org/[slug]/settings/{general,members,billing,policies}`, `/admin/{users,orgs,audit}`.

---

## 3. Piano B — Stile e UI condivisi

- Creare `packages/ui`: `theme.css` (i token oklch attuali, light/dark), `uno.preset.ts`
  (shortcuts `panel`, `btn-*`, `input-field`, `label-upper`, preset a11y/rtl), componenti base in
  Vue (`CzButton`, `CzPanel`, `CzBadge`, `CzTable`, `CzDialog`, `CzForm*`, `CzEmpty`, `CzTimeline`),
  esportati come **Nuxt layer** (`packages/ui/nuxt.config.ts`) così web, marketing e docs lo
  estendono con `extends: ['@code-zero/ui']`.
- **Non** adottare Nuxt UI: lo stile corrente è UnoCSS + token custom e il piano 2026-09 lo
  conferma; Nuxt UI porterebbe un secondo sistema di token. (Q4)
- `DESIGN.md` nella root del pacchetto: contratto verificabile (griglia 32px, raggio 0, font Inter,
  accent verde oklch, nessun gradiente oltre `--cz-grid`), usato dalla skill
  `wolfstar-agent-kit:nuxt-frontend-review` prima di ogni merge UI.
- Skill UI da usare in esecuzione: `impeccable` (audit/polish), `web-design-guidelines` (review),
  `accessibility`, `core-web-vitals`/`performance` (marketing e docs), `baseline-ui` (deslop),
  `nuxt-frontend-design` del kit. Già installate in `.agents/skills`.

---

## 4. Piano C — Multi-forge con `forges`

`forges` (ESM-only, Node ≥ 22.18, zero dipendenze, `fetch` globale) copre GitHub, GitLab,
Bitbucket, Forgejo, Gitea, Gitee, Azure DevOps, Cursor Origin, Tangled, Pushin, Cloudflare
Artifacts, con `forge.can('writes.comment')` per degradare in modo esplicito, `webhooks.ingest`
per la verifica firma, `forges/env` per la configurazione, `forges/fake` e `forges/testing` per i
test deterministici.

**Nuovo pacchetto `packages/forge`** (sostituisce `packages/source-control`):

```
src/
  index.ts          # createForgeRegistry(config) → { get(kind, instance), list() }
  contracts.ts      # ChangeRequestRef, ReviewEvent, RunOutcome, StatusPublication (si tengono: shared le usa)
  ingest.ts         # ForgeEvent (forges) → ReviewTrigger/ReviewEvent di Code Zero; filtro ignoreAuthors/allowBots
  publish.ts        # RunOutcome → checks.report (fallback commit status), writes.comment con l'evidence
  issue-to-pr.ts    # contents.commitFiles({createFrom}) + writes.create(kind:'pull_request')
  capabilities.ts   # mappa forge.can(...) → ProviderCapabilities (il contratto resta onesto)
  env.ts            # providersFromEnv + variabili CODE_ZERO_* legacy → FORGES_* (compat)
  fake.ts           # re-export di forges/fake con fixture Code Zero
```

- Un endpoint webhook per forge: `apps/web/server/routes/webhooks/[forge].post.ts` →
  `registry.get(forge).webhooks.ingest({headers, body})`.
- Credenziali: per-organizzazione nel DB (`forge_connection`: kind, instance, baseUrl, auth
  cifrata, webhookSecret) **oppure** da env `FORGES_*` per il self-host minimale. Cifratura con
  chiave `CODE_ZERO_ENCRYPTION_KEY` (AES-GCM, `node:crypto`/WebCrypto, funziona su Workers).
- GitHub App (appId/privateKey/installationId) come percorso consigliato per cloud; PAT per
  self-host.
- Tutti i pacchetti diventano **ESM-only** (Q5), allineati a `forges` che non pubblica CJS.
- Matrice capacità da esporre in `docs/source-control-providers.md` generata dalla matrice di
  forges, non mantenuta a mano.

---

## 5. Piano D — `packages/action`: esecuzione autonoma senza dashboard (modello pullfrog)

Il pacchetto rende Code Zero usabile come **GitHub Action** (e componente GitLab CI) senza alcun
control plane: il run gira nel CI del repository target con la chiave del cliente.

```
packages/action/
  action.yml            # using: node24, main: dist/entry.mjs, post: dist/post.mjs, post-if: always()
  src/entry.ts          # legge inputs, risolve trigger (@code-zero mention, label, PR aperta, CI rossa, prompt)
  src/post.ts           # revoca token, carica evidence come artifact, chiude il commento di progresso
  src/run.ts            # compone agent+runner(local)+models+forge(github token del job) → runTask
  src/inputs.ts         # schema zod degli input
  src/report.ts         # commento di progresso aggiornato + check run con l'evidence
  templates/code-zero.yml  # workflow pronto, scritto da `zero init --action`
```

Input (allineati a pullfrog ma con la policy Code Zero): `mode` (observe|suggest|fix, default
observe), `prompt`/`prompt_file`, `model`, `timeout`, `push` (disabled|restricted|enabled), `shell`,
`output_schema`, `token`. Output: `result`, `evidence_path`.

Decisioni:

- **Come pullfrog** (Q6): l'Action offre due harness. `code-zero` (il runtime interno, default per
  `observe`) e gli agent esterni `claude-code`, `codex`, `opencode`, scelti dal modello
  configurato. Gli agent esterni girano con token del job a scadenza, env ripulito, shell e push
  governati dagli input `shell`/`push`, e l'evidence passa sempre dal verificatore Code Zero.
- Token GitHub del job (`${{ github.token }}`) usato tramite `forges/github` con `auth.token`.
- Il **worker** (`packages/worker`) e l'Action condividono `runTask` da `packages/api` (o un nuovo
  `packages/engine` se `api` deve restare senza dipendenze dal runtime: oggi `api` importa già
  `agent/runner/models`, quindi si usa `api`).
- Opzionale: l'Action può **riportare** al control plane (`CODE_ZERO_URL` + API key) per
  comparire nella dashboard. Questo è anche il modo in cui una dashboard **serverless** esegue
  run: li delega all'Action o al worker (Piano G).

---

## 6. Piano E — Coerenza del codice

- Un solo stile di modulo: ESM, `exports` espliciti, `tsdown` con `scripts/tsdown.config.ts`.
- Una sola fonte dei tipi wire: gli schemi zod del router oRPC in `packages/api`; le app importano
  `RouterClient<typeof router>`; sparisce `modules/*/types`.
- Un solo store: Postgres via Drizzle per **tutto** (task, eventi, audit, repository, connessioni
  forge, chiavi). Il KV resta solo per cache/lock (claim dei webhook) con driver unstorage.
  Cloudflare è solo per il cloud managed (Q7) e usa Postgres via Hyperdrive; D1 **no**. Il self-host
  serverless (Vercel, Netlify) usa Postgres gestito (Neon, Supabase, RDS).
- Convenzioni: `packages/<x>/src/index.ts` esporta solo contratti e factory; nessun `src/` cross
  import; test accanto al sorgente; `README.md` per pacchetto con "owns / never does".
- Skill `wolfstar-agent-kit:pkg-conform` e `improve-ts-pkg-architecture` come gate in CI
  (`scripts/check-repository.mjs` già esiste: estendere).
- Hook del kit (modello harlan-agent-kit): `aube`-only guard, `check` prima di commit/push, PR
  solo via skill `pr`. Da installare in `.claude/hooks.json`.

---

## 7. Piano F — Modello di business (Dokploy + pullfrog allo stato iniziale)

| Edizione                                                   | Chi                     | Cosa include                                                                                                    | Prezzo (ipotesi)                                      |
| ---------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Self-hosted (OSS, Apache-2.0)**                          | tutti                   | tutto il runtime, dashboard, auth completa, multi-forge, Action, worker Docker, 1 org illimitata                | gratis                                                |
| **Cloud Free**                                             | personal, repo pubblici | come self-hosted, hosting gestito, 30 run/mese                                                                  | gratis (come pullfrog)                                |
| **Cloud Pro**                                              | team, repo privati      | run illimitati a costo per run o per seat, GitHub App condivisa, sandbox gestite, 2FA obbligatoria, audit 90 gg | 30 $/org/mese + costo modello pass-through (pullfrog) |
| **Enterprise** (cloud dedicato o self-hosted con supporto) | aziende                 | SSO/SAML+SCIM, RBAC fine, audit illimitato, white-label, SLA, supporto prioritario, istanza dedicata            | contatto (Q10)                                        |

Decisioni:

- Licenza: **tutto Apache-2.0** (Q8), incluse le feature Enterprise. Si monetizza hosting,
  supporto, SLA e contratti, non il codice.
- `packages/edition`: `edition()` → `'self-hosted' | 'cloud'` da env; `entitlements(org)` →
  limiti (run/mese, seat, retention) letti dal piano; in self-hosted ritorna sempre "illimitato".
  Tutto il gating passa da qui, mai da `if (process.env.X)` sparsi.
- `packages/payments`: contratto `PaymentProvider` (`createCheckout`, `portal`, `webhook`) con
  **solo Stripe** (Q9); tabelle `subscription`, `usage_event`. Caricato solo in cloud.
- Metering: ogni run scrive un `usage_event` (token in/out, minuti sandbox, provider); in cloud
  alimenta la fattura, in self-host alimenta la pagina "Costi" della dashboard.

---

## 8. Piano G — Deploy: Docker e serverless (Cloudflare, Vercel, Netlify)

Il vincolo è uno: **l'esecuzione dei run (git, comandi, sandbox) non può vivere in una funzione
serverless**. Quindi il sistema si divide in due processi con un contratto chiaro:

```
apps/web (Nitro)          packages/worker (Node/Docker)        packages/action (CI del cliente)
  UI, auth, oRPC   ───►   claim task da Postgres (SKIP LOCKED)   run in GitHub Actions / GitLab CI
  webhook ingest           esegue con runner local/sandbox       riporta con API key (opzionale)
  scheduler: enqueue       pubblica evidence via forge
  SSE/polling overview     heartbeat → runner visibili in UI
```

| Target                                  | apps/web                   | Esecuzione                                                        | Store                  |
| --------------------------------------- | -------------------------- | ----------------------------------------------------------------- | ---------------------- |
| Docker Compose (self-host default)      | container `web`            | container `worker` (scala a N)                                    | `postgres` nel compose |
| Node bare-metal                         | `.output/`                 | `zero worker` dalla CLI                                           | Postgres esterno       |
| Vercel                                  | preset `vercel`            | Vercel Sandbox adapter **oppure** worker remoto **oppure** Action | Neon/Postgres          |
| Cloudflare (**solo cloud managed**, Q7) | preset `cloudflare-module` | Cloudflare Sandbox/Containers adapter                             | Hyperdrive→Postgres    |
| Netlify                                 | preset `netlify`           | worker remoto o Action                                            | Postgres               |

- `docker-compose.yml` + `Dockerfile` multi-stage (web, worker) nella root; `zero doctor` verifica
  tutto. "Primo avvio" = `docker compose up` → onboarding wizard a `/onboarding`.
- Il poller attuale diventa un task del worker (o un Cron Trigger su Cloudflare / Vercel Cron che
  chiama `POST /api/v1/internal/poll` firmato).
- ViteHub resta per KV/Queue dove già c'è; non è un requisito.

---

## 9. Sequenza proposta (fasi, non ancora task)

| Fase | Contenuto                                                                                                                                                                                  | Dipende da |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 0    | Pulizia (`packages/github`), `tooling/tsconfig`, rinomina `apps/web`, `packages/ui` layer con i token attuali                                                                              | —          |
| 1    | `packages/database` v2: schema unico (auth+org+passkey+2FA+admin+apiKey, repository, forge_connection, task, task_event, audit, usage_event, subscription), migrazioni; `packages/edition` | 0          |
| 2    | `packages/auth` v2 + pagine auth/settings/org/admin in `apps/web`; onboarding wizard                                                                                                       | 1          |
| 3    | `packages/forge` su `forges`; webhook per forge; rimozione `source-control`                                                                                                                | 1          |
| 4    | `packages/api` v2: router per dominio (`auth`, `orgs`, `repos`, `forges`, `tasks`, `runs`, `audit`, `billing`), scheduler su Postgres, nessun Nitro dentro; `packages/worker`              | 1, 3       |
| 5    | `apps/web` dashboard: pagine repository, task, run, approvals, runner, modelli, costi, policy; SSE                                                                                         | 2, 4       |
| 6    | `packages/action` + template workflow + `zero init --action`                                                                                                                               | 4          |
| 7    | Docker Compose, Dockerfile, preset Cloudflare/Vercel verificati, docs deployment                                                                                                           | 4, 5       |
| 8    | `packages/payments` + piani cloud + metering UI                                                                                                                                            | 1, 5       |
| 9    | Marketing e docs: pricing reale, pagina "self-host vs cloud", confronto con Codesmith/pullfrog                                                                                             | 8          |

Ogni fase chiude con `aube run check:repo && lint:ci && typecheck && test && build` verdi e una PR
separata (refactor e feature in PR distinte).

---

## 10. Decisioni (risposte del 2026-10-17)

| #   | Tema               | Decisione                                                                                                  |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Q1  | Layout runtime     | Spostare `agent/runner/models/config/shared` in `packages/core/*`. I nomi npm restano `@code-zero/<nome>`. |
| Q2  | Nome app           | `apps/dashboard` diventa `apps/web` (`@code-zero/web`).                                                    |
| Q3  | Inviti             | Tenere `@octopi-ai/better-enrollment`: migliore degli inviti base di Better Auth.                          |
| Q4  | UI kit             | UnoCSS e token attuali in `packages/ui`, niente Nuxt UI.                                                   |
| Q5  | Moduli             | Tutti i pacchetti ESM-only.                                                                                |
| Q6  | Action             | Come pullfrog: harness `code-zero`, `claude-code`, `codex`, `opencode`.                                    |
| Q7  | Cloudflare         | Solo per il cloud managed. Il self-host gira su Docker e su serverless (Vercel, Netlify, Node).            |
| Q8  | Licenza            | Tutto Apache-2.0.                                                                                          |
| Q9  | Pagamenti          | Stripe.                                                                                                    |
| Q10 | Prezzi             | Free 30 run/mese, Pro 30 $/org/mese + pass-through, più Enterprise.                                        |
| Q11 | Forge              | GitHub, GitLab, Gitea/Forgejo, Bitbucket, più Azure DevOps.                                                |
| Q12 | Skill              | Dal catalogo skilld.dev, le migliori per progetto, UI, performance, codebase e stile.                      |
| Q13 | Chat panel         | Dopo la v2.                                                                                                |
| Q14 | Slack/Discord, MCP | Dopo la v2.                                                                                                |
| Q15 | Branch             | `feat/v2-foundation` da `origin/main`.                                                                     |

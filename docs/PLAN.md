# Piano: dashboard funzionante per code-zero

Riferimento: [wolfstar-agent-kit](https://github.com/wolfstar-project/wolfstar-agent-kit),
pacchetto `packages/wolfstar-github-agent` (servizio locale + dashboard Nuxt).
Stato verificato il 2026-09-05 su `main` (`8087c6d`).

## Cosa funziona oggi (verificato, non letto)

- `turbo run build --filter=@code-zero/dashboard` compila 13 pacchetti e produce `.output/`.
- Con `AUTH_E2E_MEMORY=true` il bundle parte senza Postgres: `/login` 200, signup via
  `/api/auth/sign-up/email`, `/` renderizza "Control Plane" con la sessione.
- `POST /api/v1/tasks` con bearer token esegue un run in-process, lo salva nel KV `fs-lite`
  (`.data/kv/tasks/*`) e `GET /api/v1/dashboard` lo restituisce con eventi e verdetto.

## Cosa non funziona (perché la dashboard sembra "vuota")

1. **Niente la alimenta.** I task nascono solo da un webhook GitHub (serve URL pubblico, secret,
   `CODE_ZERO_CHECKOUT_PATH`) o da una chiamata API con token. La UI non ha un form per creare un
   task né un pulsante per approvarne uno, anche se `tasks.create` e `approvals.decide` esistono
   nel router. `zero run` da CLI non scrive nello stesso store, quindi i run locali non compaiono.
2. **Niente si aggiorna da solo.** `index.vue` usa `useQuery` senza `refetchInterval`, niente SSE.
   `tasks.create` blocca la risposta HTTP fino a fine run, quindi Queued e Running non si vedono mai.
3. **Avvio difficile.** Per default servono Postgres, `NUXT_BETTER_AUTH_SECRET`, token, repo
   allow-list. `aube run build --filter=...` salta turbo e fallisce su `@code-zero/auth/dist`
   mancante: il comando giusto è `aube exec turbo run build --filter=...`. `aube` non è su npm,
   solo via mise o GitHub release.
4. **Sidebar con 9 voci inerti** (tasks, runners, models, approvals, findings, repositories,
   policies, integrations, settings). Solo `/` e `/audit` esistono.
5. **Nessun contratto di design.** Il kit lavora con `DESIGN.md` e la skill `nuxt-frontend-review`
   che avvia la pagina e la confronta col contratto. Qui non c'è nulla da confrontare.

## Decisione: ristrutturare, non riscrivere

I pacchetti (`agent`, `runner`, `api`, `source-control`, `models`, `config`) sono solidi, testati e
indipendenti dall'HTTP. Riscriverli è lavoro senza guadagno. Si rifà il **bordo**: come i task
entrano, come lo stato esce, come si avvia in dev. Dal riferimento si prendono quattro idee:

| Idea del riferimento                                  | Dove finisce in code-zero                     |
| ----------------------------------------------------- | --------------------------------------------- |
| Uno snapshot server-side spinto via SSE a ogni cambio | `server/api/events.get.ts` + store che emette |
| Il servizio trova lavoro da solo (poll dei repo)      | Nitro plugin `server/plugins/poller.ts`       |
| Il task torna subito Queued, il run continua in coda  | `tasks.create` ritorna dopo `store.save`      |
| `DESIGN.md` + review nel browser prima del merge      | `apps/dashboard/DESIGN.md` + skill del kit    |

Non si prende: monorepo separato, Nuxt UI (qui c'è UnoCSS con tema già fatto), mock server di
dev, tre provider agent, tray, routine.

## Fasi

Ogni fase chiude quando `aube run lint:ci && aube run typecheck && aube test && aube run build`
passano e il criterio "fatto quando" è dimostrato in browser o con `curl`.

### Fase 0: avvio in un comando (mezza giornata)

- `apps/dashboard`: script `dev:solo` = `nuxt dev` con `AUTH_E2E_MEMORY=true`,
  `AUTH_ENABLE_SIGNUP=true`, token `dev:dev`, modes `dev:observe|suggest|fix`, repo allow-list
  dalla env `CODE_ZERO_REPOSITORIES`. Nessun Postgres.
- README: sezione "Primo avvio" con i tre comandi (install, `aube exec turbo run build`, `dev:solo`).
- `bin/check` copiato dal kit, più hook `pre-commit-push` e `oxlint` on save in `.claude/`.

Fatto quando: da clone pulito, `mise install && aube install && aube run dev:solo` apre la
dashboard e il signup funziona.

### Fase 1: stato vivo (1 giorno)

- `TaskStore.save` emette su un `EventEmitter` di processo (`server/utils/store.ts`, 10 righe).
- `server/api/events.get.ts`: SSE con `createEventStream` di h3, push dell'overview a ogni
  evento, heartbeat 15 s.
- `app/composables/useLiveOverview.ts`: `EventSource` nativo, a ogni messaggio
  `queryClient.invalidateQueries` sull'overview. Riconnessione a 1.5 s. Badge "stale" se l'ultimo
  messaggio è più vecchio di 30 s (come `isSnapshotStale` del riferimento).
- `operations.createTask` ritorna il record Queued dopo il primo `store.save`; il run prosegue nello
  scheduler. Il webhook fa lo stesso: risponde `accepted` con l'id senza aspettare.

Fatto quando: un `curl` che crea un task fa comparire la riga Queued, poi Running con gli eventi
che scorrono nella Timeline, poi Completed, senza premere Refresh.

### Fase 2: la UI fa le cose che il router già sa fare (1 giorno)

- Inspector: pulsanti Approve e Reject su `needs-human` (`approvals.decide`), con commento.
- Header: "New task" con form repository (select dall'allow-list), mode, trigger. Chiama
  `tasks.create`. In `observe` non serve alcuna chiave modello, quindi funziona anche in `dev:solo`.
- Sidebar: eliminare le 9 voci senza pagina. Restano Control Plane e Audit Log.
- `DESIGN.md` scritto dai token già in `uno.theme.ts` e `main.css`. Poche regole, ognuna deve poter
  bocciare un cambiamento.

Fatto quando: la skill `nuxt-frontend-review` gira `dev:solo`, esercita approve, reject e new task
a 1440 e 375, light e dark, e non trova rifiuti duri. Screenshot nella PR.

### Fase 3: il servizio trova lavoro da solo (2 giorni)

- `server/plugins/poller.ts`: ogni `CODE_ZERO_POLL_INTERVAL_SECONDS` (default 60) legge le PR
  aperte dei repo configurati con l'adapter GitHub di `packages/source-control`, e per ogni head
  SHA non ancora visto crea un task `proactive` in `observe` (o nel mode di policy del repo).
- Mappa repo → checkout locale in `CODE_ZERO_REPOSITORIES` (`owner/name=/path`), come i
  `trustedCheckoutRoots` del riferimento. Un task per SHA, dedup nello store.
- Worktree per task (`git worktree add` in una cartella temporanea, rimossa a fine run) così due
  run sullo stesso repo non si pestano. Il runner già limita cosa può eseguire.
- Il plugin non parte in `dev:solo` senza repo configurati, e si ferma su `nitroApp.hooks.hook('close')`.

Fatto quando: con un repo reale configurato, un push su una PR fa comparire un task entro un
ciclo di poll senza webhook, e due PR sullo stesso repo girano in worktree distinti.

### Fase 4: la CLI scrive dove legge la dashboard (mezza giornata)

- `zero run` con `CODE_ZERO_URL` e sessione da `zero login` chiama `tasks.create` invece di
  eseguire in locale, e stampa l'id e il link alla dashboard. Senza URL resta il comportamento attuale.

Fatto quando: `zero run --proactive` da terminale compare nella Board entro un secondo.

### Fase 5: pulizia (mezza giornata)

- `.env.example` del dashboard riordinato: prima i 5 valori per `dev:solo`, poi il resto.
- `docs/architecture.md`: sezione "Live state" che descrive SSE e poller.
- Test: uno per l'emitter dello store, uno per `events.get`, uno Playwright per approve.

## Stato al 2026-09-05

Fasi 0-5 eseguite. Cosa è cambiato rispetto al piano, e perché:

- **Fase 0** — `dev:solo` legge `apps/dashboard/.env.solo` con `--dotenv`, invece di variabili
  inline. Il file è versionato: non contiene nulla che valga la pena tenere fuori dal repository.
  `bin/check` del kit non è stato copiato: `aube run lint:ci`, `typecheck` e `test` fanno già
  quel lavoro, e gli hook husky esistono già.
- **Fase 1** — fatta come previsto. Il contratto di `tasks.create` non è stato cambiato: il record
  viene salvato prima di essere schedulato, quindi la board lo vede comunque comparire subito, e
  cambiarlo avrebbe rotto i chiamanti REST e i run su serverless.
- **Fase 2** — approvazioni e form fatti. Il repository si digita invece di sceglierlo da una
  lista: l'allow-list sono percorsi di checkout lato server, che i record persistiti tengono
  deliberatamente fuori portata. `DESIGN.md` non è stato scritto.
- **Fase 3** — fatta. Niente worktree: lo scheduler limita già a un run per repository, che era la
  ragione per cui il piano li voleva.
- **Fase 4** — `--remote` è un flag esplicito, non l'inferenza da `CODE_ZERO_URL` che il piano
  proponeva: quella variabile sceglie già su quale deployment agiscono `login` e `logout`, e
  dedurne "esegui altrove" sposterebbe il run di qualcuno in silenzio.
- **Fase 5** — fatta, tranne il riordino di `.env.example`, reso inutile da `.env.solo`.

Trovato strada facendo: l'allow-list dei repository esisteva solo se erano configurati anche i
token operatore, quindi un deployment con sole sessioni non poteva creare nessun task. Corretto.

## Cosa resta

| Cosa                                     | Perché non è stato fatto                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| Review visiva con `nuxt-frontend-review` | l'ambiente di sviluppo non ha un host di automazione browser    |
| `DESIGN.md`                              | previsto in Fase 2, non scritto                                 |
| Un test Playwright per l'approvazione    | coperto da 7 test di componente; l'e2e resta da aggiungere      |
| Un test della route `/api/events`        | verificata dal vivo; il pezzo testabile è l'emitter dello store |
| Una passata del poller su GitHub vero    | nessuna credenziale qui, e i test non devono toccare la rete    |

## Rimandato, e quando

| Cosa                                   | Quando                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| Pagine Runners, Models, Findings, ecc. | quando lo store ha dati che quelle pagine mostrerebbero      |
| Nuxt UI al posto di UnoCSS             | mai, salvo richiesta: il tema esiste e passa i test          |
| Provider multipli nella stessa istanza | già supportato via policy; nessuna UI finché non serve       |
| Postgres per i task al posto del KV    | quando due istanze devono condividere lo stesso store        |
| Riscrittura completa da zero           | se le fasi 1-3 mostrano che `packages/api` non regge la coda |

## Rischi

- **Run lunghi dentro `nuxt dev`**: HMR riavvia Nitro e uccide il run. Mitigazione: `dev:solo` in
  `observe`, run veri solo su `.output/` o con `nuxt dev --no-fork`.
- **KV `fs-lite` senza scrittura atomica**: `list()` legge tutte le chiavi a ogni overview. Va bene
  fino a qualche migliaio di task; poi Postgres (già in repo per l'auth).
- **`tasks.create` che non attende più** cambia il contratto REST: chi lo usa in CI deve fare poll
  su `tasks.get`. Documentare nel changelog, versione 0.5.

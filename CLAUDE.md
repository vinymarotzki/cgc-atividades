# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

The application lives at the repository root — `package.json`, `src/`, `.env.local`
and every config file sit directly under the repo root, no subdirectory. This repo is
a standalone split-out of the "Atividades do CGC" product, which used to live inside
`cgc-checklist` alongside the "Checklist de Simulados" product; the two now share no
code, only conventions (this file mirrors parts of `cgc-checklist`'s `CLAUDE.md`,
since both started as one codebase). See "Architecture" for how the two apps still
talk to each other over HTTP.

## Commands

```bash
npm install
npm run dev        # next dev
npm run build      # next build
npm run lint       # eslint .
```

There is no test suite and no test runner configured, and no `db:seed` script — unlike
cgc-checklist, this repo's default groups are created lazily by `ensureDefaultGroups()`
(`src/lib/cgc/groups.ts`), called on every read, not by a seed script.

Local access always needs the token in the URL on the very first visit, e.g.
`http://localhost:3000/?sasi-token=TOKEN`. After that first load the token lives in
`sessionStorage` and the URL is clean — see "Auth". There is **no** localhost bypass:
local development also needs `AUTH_USER_ENDPOINT` set in `.env.local`, otherwise every
token is rejected.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript strict, Tailwind 3, Turso/libSQL
(`@libsql/client`), deployed on Vercel. Path alias `@/*` maps to `src/*`. No `xlsx`
dependency here (that stays in cgc-checklist, for its own report exports) and no
shadcn `Button` usage currently, despite `shadcn` being a dependency.

The config is `next.config.js` (CommonJS) — `output: "standalone"` plus a conditional
webpack watch-poll tweak for `WATCHPACK_POLLING=true` (Docker on Windows: a bind mount
through WSL2 doesn't propagate inotify events, only polling detects file changes for
hot-reload).

## Architecture

This repo owns the **Atividades do CGC** product: a read-only mirror of messages
coming from the external SASI ("Bone") API, with status/comments/history kept local
because the API token cannot write.

Routes: `/atividades-cgc`, `/atividades-cgc/historico`.
API: `/api/cgc/groups`, `/api/cgc/activities`, `/api/cgc/observations`,
`/api/cgc/history`, `/api/cgc/cron-sync` (background sync, called by an external cron
since Vercel Hobby's native cron is limited to once a day), `/api/cgc/webhook`
(receives the SASI-side webhook registered manually in the SASI admin panel).

Also: `/api/controle/cgc` and `/api/controle/cgc/activities` — routes protected by a
`CONTROLE_PROXY_SECRET` shared secret (not user auth) that exist purely so the sibling
`cgc-checklist` app's `/controle` report page can show CGC data without this app's
database or the SASI API being reachable from that repo. `cgc-checklist` proxies to
these two routes via its own
`/api/controle/cgc*`, reading this app's URL from its server-only `CGC_APP_URL` env
var. Keep these two routes read-only and free of anything sensitive (no
`profileFields`, no raw SASI tokens) since they're intentionally unauthenticated.

Groups themselves are read-only from the UI (seeded via `ensureDefaultGroups()` or
created directly through the API) — the selection screen has no create/edit/delete
affordance, only "Abrir", and always renders the five seeded groups in the fixed order
CGC, AVA, NUPPAE, NGOA, CIPA (unknown groups sort last).

Every page is a client component (`"use client"`) that fetches its own `/api/...`
route. No server component fetches data, and no page talks to the SASI API directly —
the API token never reaches the browser.

### Auth

`src/lib/token.ts` is the single source for the token, on both client and server. The
URL only ever carries `?sasi-token=` (`TOKEN_PARAM`) on the very first request — after
that the token travels through `sessionStorage` on the client and the `x-sasi-token`
header (`TOKEN_HEADER`) on every internal request. The URL never shows the token again.
One rule, no exceptions:

- on first load, the token is read **only** from `?sasi-token=`; there is no `?token=`
  fallback;
- an absent param, a different param name, or an empty/whitespace value all mean
  "user without access" — `readSasiToken`/`readSasiTokenHeader` return `null` and the
  caller must refuse;
- there is **no** host bypass. localhost follows the exact same rule as production, so
  what is tested locally is what the end user gets.

`src/hooks/useSasiToken.ts` is the client-side entry point: every page calls
`useSasiToken()` instead of reading `sasi-token` from `useSearchParams()` directly. On
mount, if the URL carries `sasi-token`, the hook saves it to `sessionStorage` and
strips the param from the address bar via `router.replace`; otherwise it falls back to
whatever is already in `sessionStorage`. Internal links no longer carry the token —
they're plain paths — and internal `fetch` calls attach it with `sasiAuthHeaders(token)`
instead of a query string. Losing `sessionStorage` (closing the tab) means losing
access until the user opens a fresh `?sasi-token=` link.

Server side, `authenticateToken` (`src/lib/auth.ts`) validates the token against
`AUTH_USER_ENDPOINT`; without that env var *every* token is rejected, in every
environment. This is the same external endpoint cgc-checklist validates against —
one login, two apps.

`src/lib/api-auth.ts` provides `requireAuth`, reading the token through
`readSasiTokenHeader` (never from the URL) and also returning the raw token so it can
be forwarded as a Bearer credential to the SASI API. The `/api/controle/cgc*` routes
are the deliberate exception — they skip `requireAuth` on purpose, since they're meant
to be called cross-repo by cgc-checklist's server (authenticated instead via
`CONTROLE_PROXY_SECRET`, not a user `sasi-token` — that server has none of its own to
forward).

### Database

`src/lib/db.ts` holds a lazy singleton client plus `initDb()`, which creates every
table with `CREATE TABLE IF NOT EXISTS` and migrates older schemas via `ALTER TABLE`
wrapped in `try/catch` (a thrown "duplicate column" is the "already migrated" signal).
`initDb()` is called at the top of route handlers — there is no migration tool.

This is this repo's own Turso database (separate from cgc-checklist's — see
`scripts/migrate-cgc-data.mjs` in cgc-checklist for the one-time data copy from the
old shared database). Tables: `cgc_groups`, `cgc_activity_status`, `cgc_history`,
`cgc_observations`, `cgc_group_totals`, `cgc_message_cache`, `cgc_message_cache_sync`.

`cgc_history` is denormalized on purpose (it stores group/description/priority/deadline
alongside the change) because the source message lives in the SASI API and can leave
the query window.

### SASI API integration (`src/lib/sasi-api/`, `src/lib/cgc/`)

`src/lib/sasi-api/client.ts` is the single network layer — nothing else may build a URL
or auth header for `api.bone.sasi.io`. Contract facts that constrain the code:

- Base URL has **no** `/api` prefix; the machine-readable spec is at `/api-json`.
- `GET /provider/messages` returns a **bare array**, no envelope and no total; the total
  comes from a separate `GET /provider/messages/count`.
- `limit` maxes at 100 (default 10), `page` is 1-based.
- The provider token (`pat_`, scope `READ_MESSAGES`) is accepted **only** on
  `/provider/messages*`; `/provider/statuses`, `/categories`, `/channels` return 401.
  This is a *different* credential than the personal `sasi-token` used to log into the
  app (validated against `AUTH_USER_ENDPOINT`, a different host): `resolveSasiToken`
  therefore prefers `SASI_API_TOKEN` from `.env.local` over the user's own token —
  the user's token authenticates them locally but is not accepted by the Bone API.
- There is no deadline/SLA field anywhere in the spec, and `raw.priority` is a boolean.
  Both the deadline and the real priority are read out of the dynamic `data_fields[]`.
- Messages come back newest-first (highest `id`/`created_at` on page 1) — confirmed
  empirically against channel `33397`, not documented in the spec. `group-totals.ts`
  (below) depends on this holding.

A **group** (`cgc_groups`) is a local entity, not an API concept: it stores filters under
the exact query-param names of `/provider/messages` (`category_ids`, `team_name`,
`channel_ids`, `app_ids`). The five seeded groups (CGC, AVA, NGOA, NUPPAE, CIPA) all read the
same channel `33397`; what separates them is `data_field_value`, a value *inside* the
message. Since the API cannot filter by form content, `/api/cgc/activities` scans pages
server-side up to `SASI_CGC_SCAN_CAP` (default 500) and filters after mapping.

`src/lib/cgc/group-totals.ts` keeps the "solicitadas" count shown on the group
selection screen in sync with the API, without rescanning on every load: it persists
`total` and `last_message_id` per group in `cgc_group_totals`, and on each sync only
fetches pages newer than that high-water mark (stopping as soon as a page has nothing
new), then re-checks only after a 2-minute TTL. Groups sharing the same base query
(all four seeded ones share channel `33397`) are scanned together in one pass instead
of one scan per group. Known gap: this only detects new messages, not deleted ones —
the total never shrinks on its own.

Field names for channel 33397 are pinned in `src/lib/cgc/field-map.ts`
(`selecione_time` → group, `prioridades` → priority, `prazo_de_entrega` → deadline,
`descreva` → description) and overridable by env so a rename does not need a deploy.
`src/lib/cgc/mapper.ts` must never throw on missing or unexpected data — a missing field
becomes `null` and the UI shows an empty state. Do **not** surface `profileFields`: it
carries the sender's phone, e-mail and birth date.

Status for CGC activities is local (`cgc_activity_status`, keyed by SASI message id,
default `NAO_INICIADO`) because `READ_MESSAGES` cannot write; the SASI-side status is
mapped to the same vocabulary in `CgcActivity.sasiStatus` and is informational only.
`recordHistory` swallows exceptions by design so history writes can never block a status
change or comment — the cost is that a failed write is silent.

The CGC list auto-refreshes every 15s (`REFRESH_INTERVAL_MS`) and on tab focus; combined
with field routing this repeats the page scan, so raise the interval if it becomes costly.

`src/app/api/cgc/cron-sync/route.ts` and `src/app/api/cgc/webhook/route.ts` both call
`syncAllGroups` (`src/lib/cgc/message-cache.ts`) to run the same scan-and-cache pass
outside of a browser poll — the cron route is protected by `CGC_CRON_SECRET` (header
`x-cron-secret`), the webhook route by a separate `CGC_WEBHOOK_SECRET` (header
`x-webhook-secret` or `?secret=` query param, since the SASI admin panel's webhook
config may not support a custom header) so the two credentials can be rotated
independently. `src/lib/sasi-api/notify.ts` sends a push via a *third* SASI host
(`api.sasi.io`, not `api.bone.sasi.io`) and credential (`SASI_NOTIFY_TOKEN`, a Bearer
JWT) — it's a no-op with no error until that token is configured, so the feature stays
off without needing a separate flag.

### Status vocabulary

`src/lib/checklist-status.ts` is the single source for statuses and their colors:
`SEM_STATUS`, `NAO_INICIADO`, `EM_ANDAMENTO`, `CONCLUIDO`, `IMPEDIDO` (only the middle
three are offered in the selector). Reuse it rather than defining a parallel palette —
this is a copy of the same file cgc-checklist keeps, kept identical by convention
even though the repos no longer share code. `src/lib/cgc/colors.ts` layers a fixed
brand color per seeded group (`getCgcGroupColor`: CGC `#004AAD`, AVA `#B57EDC`,
NUPPAE `#FF3131`, NGOA `#FF751F`, CIPA `#457A00`) on top of `getCategoryColor`'s hash-based fallback for
anything else.

### Styling

Screens are styled with inline styles, so media queries cannot live there. All
responsive behavior sits in named classes in `src/app/globals.css`. Add responsive
rules there, not inline.

Icons are `lucide-react` components (e.g. `<Search size={14} />`), not emoji. Match
that for new UI instead of introducing emoji.

## Git workflow

`main` is currently the only branch — this repo has a remote
(`github.com/vinymarotzki/cgc-atividades`) but isn't yet using the `develop`/`FIX/`
branch + PR flow below. It mirrors cgc-checklist's workflow exactly, ready to adopt
once the first feature branch is needed.

`main` and `develop` are meant to be the only long-lived branches. Every change —
feature, fix, chore, anything — gets its own branch off `develop`, named
`FIX/<what-it-does-in-english>` (kebab-case, e.g. `FIX/add-lucide-icons`,
`FIX/group-totals-sync`), regardless of whether the change is actually a bug fix —
`FIX/` is the fixed prefix for all of them.

Work happens on that branch, then opens a real GitHub pull request into `develop`
(`gh pr create`) — no direct merges. The PR body has a `## Summary` section, written
as a tidy summary of what changed, not a raw diff dump. The PR is left for merging
(by the user or a reviewer), not merged automatically as part of doing the work.
`develop` is promoted to `main` afterward, as its own separate, deliberate step — not
per-branch/per-PR.

## Conventions

The product is Brazilian Portuguese: UI strings, code comments and doc comments are
written in pt-BR, and comments explain *why* a decision was made (especially where an
API limitation forced it). Match that when editing.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# riftbound-db

An exhaustive index of Riftbound cards where a small group of friends records what they
own and, above all, **who lent what to whom**.

## Status

Working: schema, card loader, 1189 cards, Discord sign-in, the admin approval queue, the
card browser with collection entry built in, and the decklist check. The loan ledger UI is not built yet, though the ledger
itself is what collection entry already writes to. Read
[docs/design.md](docs/design.md) first: it covers what makes loan tracking hard, the
class diagram, and the open questions. The schema in
[db/migrations/0001_init.sql](db/migrations/0001_init.sql) is the single
source of truth for the data model.

## Stack

- **Next.js** (App Router, TypeScript, Tailwind), following the conventions of the
  sibling `mariosbierkelder` repo.
- **Plain Postgres** with row-level security, self-hosted. The domain is append-only:
  nothing in the ledger is ever updated or deleted.
- **Auth.js** with the Discord provider, since the playgroup already lives there.
- **Docker Compose on Hetzner**: Postgres, the Next.js standalone build, and Caddy for
  automatic TLS. Postgres is not published to the host.
- Card data is **vendored** into `data/cards/*.json` and committed. The app never calls a
  third-party API at request time.
- **Cardmarket** for price snapshots, treated as historical and non-authoritative.

**Registration is open, membership is approved.** Anyone with a Discord account can
register, but a new account is `pending` and sees nothing at all, not even the card list,
until an admin approves it. See [docs/design.md §3](docs/design.md).

Two database roles: the app connects as `app_user` and is subject to RLS; migrations and
the card loader connect as the owner and bypass it. `app_user` must never own the tables.

`app_user`'s password is set by `make db-migrate` from `APP_USER_PASSWORD`, and
`DATABASE_URL` is built from the same variable, so the role and the connection string
cannot drift apart. Generate a URL-safe value with `openssl rand -hex 32`: a password
containing `@`, `:` or `/` would break the connection URL.

## Getting started

```bash
cp .env.example .env          # POSTGRES_PASSWORD, APP_USER_PASSWORD, AUTH_SECRET, Discord
make db-migrate               # starts Postgres and applies db/migrations/ IN ORDER
make load                     # load the committed card data into Postgres
make dev
```

`make db-migrate` must run before `make load`: the loader upserts into tables the
migrations create. Card data is already committed, so `make cards` is only needed when
Riot ships a new set.

Migrations are tracked in a `schema_migrations` table, so each file in `db/migrations/`
runs exactly once and `make db-migrate` is safe to re-run: it applies what is pending and
skips the rest. Each migration and the record of it are one transaction, so a failure
leaves neither a half-applied schema nor a false record.

`make` on its own lists every target.

### The host needs no Node

`make load`, `make cards` and `make collisions` run inside a pinned `node:22-alpine`
container on the compose network, so a fresh server needs only Docker. That also keeps
the box and your laptop on the same Node.

The container runs as root and writes `node_modules/` into the bind mount, which is
harmless on a server but leaves root-owned files on a workstation. If you have Node
installed locally, bypass the container with `make NODE= load` and set
`LOADER_DATABASE_URL` to the published loopback port instead.

## Deploying to Hetzner

`APP_URL` in `.env` decides how the site is reached, and its scheme decides whether Caddy
provisions a certificate. There are three ways to run it, in increasing order of effort:

| `APP_URL` | TLS | Needs |
|---|---|---|
| `http://203.0.113.10` | none | nothing at all |
| `https://203.0.113.10.sslip.io` | Let's Encrypt | nothing, but see the caveat |
| `https://riftbound.example.org` | Let's Encrypt | a real A record |

**Plain IP, no TLS.** Works immediately with no domain and no DNS. Traffic is
unencrypted, so it is for getting something running and for a trusted group on a trusted
network, not for a launch. Auth.js takes its cookie policy from `APP_URL`, so an `http://`
value keeps the session cookie non-secure and login still works.

**sslip.io** resolves `<ip>.sslip.io` to the IP embedded in the name, so it is a real
public hostname with zero setup and Let's Encrypt will issue for it. The caveat: sslip.io
is **not** on the Public Suffix List, so Let's Encrypt treats every `*.sslip.io` name as
one registered domain sharing a single quota of 50 certificates per week with everyone
else on the internet using it. It may simply fail. Cheap to try, not something to depend
on.

**A real hostname** is the only option that is both encrypted and reliable. Worth doing
before anyone else is invited.

```bash
# on the box
cp .env.example .env          # set APP_URL and POSTGRES_PASSWORD at minimum
make up                       # builds and starts Postgres, app and Caddy
make db-migrate
make load
```

Then log in once with Discord to create your pending row, and promote yourself:

```bash
make promote DISCORD_ID=<your discord user id>
```

Nothing works before that step: a fresh database has no admin, so nobody can approve
anyone, including you.

Whatever `APP_URL` is, the Discord application's redirect URI has to match it exactly:
`$APP_URL/api/auth/callback/discord`.

Subsequent releases are `make deploy` (pull, rebuild, migrate). `make backup` writes a
timestamped `pg_dump` to `backups/`; put it on a cron and copy it off the box, because a
Hetzner volume is not a backup.

`make db-reset` destroys the database but deliberately leaves Caddy's volume alone: it
holds the TLS certificates, and Let's Encrypt rate-limits reissuance.

## Layout

```
app/page.tsx                 sign in, and where you are in the approval flow
app/admin/                   approval queue: approve, reject, suspend
app/cards/                   browsing and collection entry: one page, ?edit=1 toggles
app/collection/              redirect, kept so old links work
app/decklist/                paste a list, see what is missing, or claim it as owned
lib/decklist.ts              the parser (pure; tests/decklist.ts covers it)
lib/queries.ts               every read the pages do
lib/db.ts                    asPerson(): the transaction wrapper RLS depends on
docs/design.md               the plan: difficulties, class diagram, roadmap
db/migrations/               schema, the single source of truth
scripts/fetch-cards.ts       Riot's gallery feed -> vendored JSON (deterministic)
scripts/load-cards.ts        vendored JSON -> Postgres (idempotent upserts)
data/cards/*.json            1189 cards, committed; a new set is a reviewable diff
data/manifest.json           provenance: build id, source URL, fetch time, checksums
docker-compose.yml           Postgres + app + Caddy
Dockerfile                   Next.js standalone build
Caddyfile                    TLS and reverse proxy
```

## Card data

`make cards` scrapes the current `buildId` from `playriftbound.com` and pulls Riot's own
card gallery feed. No key, no authentication. `make determinism` proves the transform is
byte-stable, which is what makes a new set arrive as a reviewable diff rather than an
opaque blob.

| Source | Use |
|---|---|
| `playriftbound.com/_next/data/{BUILD_ID}/{LOCALE}/card-gallery.json` | **Primary.** Riot's own feed. 1189 cards over 5 sets. `BUILD_ID` changes on every Riot deploy and is scraped automatically. |
| [Riot developer portal](https://developer.riotgames.com/docs/riftbound) | Policy: official English card text must be displayed unmodified. |
| [Cardmarket](https://www.cardmarket.com/) | Price snapshots (P4). Paid, not on the critical path. |
| [Scrydex](https://scrydex.com/pricing) | Rejected: no free tier, $29/month minimum. |

The feed is an internal implementation detail of Riot's website with no deprecation
policy, and the domain has already moved once (`riftbound.leagueoflegends.com` now
redirects to `playriftbound.com`). Vendoring is what makes that survivable: if the feed
breaks, new sets cannot be ingested and the running site is unaffected.

### Card identity

`card.id` is `slug(name)`, so every printing collapses to one oracle row and "do I own
Void Gate" does not depend on which set it came from. Two genuinely different cards
sharing a name would break that, so `make collisions` reports every id whose printings
disagree on rules text. It needs no database.

Comparing raw text is useless here: alternate-art printings drop parenthetical reminder
text, which flags 83 of 935 names. Normalising that away leaves 18, and those 18 have been
checked: every one is the same card printed more than once, so `slug(name)` collapsing them
is correct and **no `card_alias` rows are needed**. The check stays in place for future
sets, where a genuine name clash would show up the same way.

## Licensing

Prices come from **Cardmarket**.

Card art is Riot intellectual property, served from `cmsassets.rgpub.io`. Images are
referenced by URL and cached locally under `data/images/` (gitignored); nothing is
redistributed from this repository.

Access is approval-gated, which lowers the exposure, but the Riot disclaimer, the
official-card-text requirement and the source attributions in
[docs/design.md §6](docs/design.md) still apply.

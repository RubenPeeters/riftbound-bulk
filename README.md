# riftbound-db

An exhaustive index of Riftbound cards where a small group of friends records what they
own and, above all, **who lent what to whom**.

## Status

Design complete, application not yet scaffolded. Read
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

## Getting started

```bash
cp .env.example .env          # fill in POSTGRES_PASSWORD, AUTH_SECRET, Discord creds
make scaffold                 # once, creates the Next.js app
make install
make db-migrate               # starts Postgres and applies db/migrations/
make cards                    # fetch and vendor card data from Riot's feed
make load                     # load it into Postgres
make dev
```

`make` on its own lists every target.

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
docs/design.md               the plan: difficulties, class diagram, roadmap
db/migrations/               schema, the single source of truth
docker-compose.yml           Postgres + app + Caddy
Dockerfile                   Next.js standalone build
Caddyfile                    TLS and reverse proxy
scripts/fetch-cards.ts       third-party API -> vendored JSON (must be deterministic)
scripts/load-cards.ts        vendored JSON -> Postgres
data/cards/*.json            committed card data; a new set is a reviewable diff
```

## Card data sources

| Source | Use |
|---|---|
| `playriftbound.com/_next/data/{BUILD_ID}/{LOCALE}/card-gallery.json` | **Primary.** Riot's own card gallery feed. No key, no auth. 1189 cards across 5 sets, verified 2026-09-08. `BUILD_ID` is scraped from the page and changes on every Riot deploy. |
| [Riot developer portal](https://developer.riotgames.com/docs/riftbound) | Policy: official English card text must be displayed unmodified. |
| [Cardmarket](https://www.cardmarket.com/) | Price snapshots (P4). Paid, not on the critical path. |
| [Scrydex](https://scrydex.com/pricing) | Rejected: no free tier, $29/month minimum. |

Prices come from **Cardmarket**.

Card art is Riot intellectual property. Images are referenced by URL and cached locally
under `data/images/` (gitignored); nothing is redistributed from this repository.

Access is approval-gated, which lowers the exposure, but the Riot disclaimer, the
official-card-text requirement and the source attributions in
[docs/design.md §6](docs/design.md) still apply.

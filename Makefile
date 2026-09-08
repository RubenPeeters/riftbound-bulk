#################################################################################
# GLOBALS                                                                       #
#################################################################################

PROJECT_NAME = riftbound-db
SHELL := /bin/bash

# Scripts run in a pinned Node container so the host needs no toolchain: the server has
# Docker for Postgres anyway, and the laptop and the box then run the same Node.
# Override with `make NODE= load` to use a host-installed Node instead.
NODE ?= docker compose run --rm tools

.DEFAULT_GOAL := help

#################################################################################
# SETUP                                                                         #
#################################################################################

## Install Node dependencies
.PHONY: install
install: node_modules

# Real target, not phony: anything needing dependencies declares it, so `make load` on a
# fresh clone installs rather than failing on a missing package. `touch` bumps the mtime
# because npm does not always update the directory's own timestamp.
node_modules: package.json
	$(NODE) npm install
	@touch node_modules

## Scaffold the Next.js app (run once, on an empty repo)
.PHONY: scaffold
scaffold:
	@test ! -f next.config.mjs || { echo "Next.js app already scaffolded"; exit 1; }
	@echo ">>> create-next-app merges into the existing package.json; re-run 'make install' after."
	npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*"
	npm install pg next-auth@beta
	@echo ">>> Now set output: 'standalone' in next.config.mjs (the Dockerfile needs it)"

#################################################################################
# CARD DATA                                                                     #
#################################################################################

## Fetch card data and vendor it into data/cards/ as reviewable JSON
.PHONY: cards
cards: node_modules
	$(NODE) npx --yes tsx scripts/fetch-cards.ts --out data/cards

## Load vendored card data into Postgres (connects as the owner, bypassing RLS)
.PHONY: load
load: node_modules
	$(NODE) npx --yes tsx scripts/load-cards.ts --in data/cards

## Report card ids whose printings disagree on rules text. Needs no database.
.PHONY: collisions
collisions: node_modules
	$(NODE) npx --yes tsx scripts/load-cards.ts --in data/cards --dry-run

## Confirm the fetcher is deterministic: two runs must be byte-identical
.PHONY: determinism
determinism:
	@$(MAKE) --no-print-directory cards >/dev/null && sha256sum data/cards/*.json > /tmp/rb-h1
	@$(MAKE) --no-print-directory cards >/dev/null && sha256sum data/cards/*.json > /tmp/rb-h2
	@diff -q /tmp/rb-h1 /tmp/rb-h2 && echo "deterministic: identical output across runs"

#################################################################################
# DATABASE                                                                      #
#################################################################################

# Migrations and the loader connect as the OWNER, which bypasses RLS by design.
# The application connects as app_user via DATABASE_URL, which does not.
PSQL = docker compose exec -T db psql -v ON_ERROR_STOP=1 -U $(POSTGRES_USER) -d $(POSTGRES_DB)
POSTGRES_USER ?= riftbound
POSTGRES_DB   ?= riftbound

## Start Postgres and wait for it to accept connections
.PHONY: db-up
db-up:
	docker compose up -d --wait db

## Apply every migration in db/migrations in order
.PHONY: db-migrate
db-migrate: db-up
	@for f in db/migrations/*.sql; do echo "-> $$f"; $(PSQL) -f - < $$f; done

## Drop and rebuild the database from scratch. Destroys all card and ledger data.
.PHONY: db-reset
db-reset:
	docker compose rm -sf db
	docker volume rm -f riftbound-db_pgdata
	$(MAKE) db-migrate

## Open a psql shell as the owner
.PHONY: db-shell
db-shell:
	docker compose exec db psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

## Promote a Discord account to admin: make promote DISCORD_ID=123
.PHONY: promote
promote:
	@test -n "$(DISCORD_ID)" || { echo "usage: make promote DISCORD_ID=<discord user id>"; exit 1; }
	@$(PSQL) -c "update person set state='approved', role='admin', approved_at=now() \
	             where discord_id='$(DISCORD_ID)'" 

## Dump the database to backups/ with a timestamp
.PHONY: backup
backup:
	@mkdir -p backups
	docker compose exec -T db pg_dump -U $(POSTGRES_USER) -Fc $(POSTGRES_DB) \
	  > backups/riftbound-$$(date +%Y%m%d-%H%M%S).dump
	@ls -lh backups | tail -1

#################################################################################
# DEVELOPMENT                                                                   #
#################################################################################

## Run the dev server
.PHONY: dev
dev:
	npm run dev

## Production build
.PHONY: build
build:
	npm run build

## Lint
.PHONY: lint
lint: node_modules
	$(NODE) npm run lint

## Typecheck without emitting
.PHONY: typecheck
typecheck: node_modules
	$(NODE) npx --yes tsc --noEmit

## Run tests (ledger invariants live here)
.PHONY: test
test: node_modules
	$(NODE) npx --yes vitest run

## Cross-check allocate_lend() against an independent recomputation
.PHONY: allocation-oracle
allocation-oracle:
	python3 tests/allocation_oracle.py

## Everything CI runs
.PHONY: check
check: lint typecheck test allocation-oracle

## Remove build output and caches
.PHONY: clean
clean:
	rm -rf .next out node_modules/.cache

#################################################################################
# DEPLOYMENT (Hetzner)                                                          #
#################################################################################

## Build and start the full stack (Postgres, app, Caddy)
.PHONY: up
up:
	docker compose up -d --build

## Stop the stack, keeping data
.PHONY: down
down:
	docker compose down

## Tail logs from every service
.PHONY: logs
logs:
	docker compose logs -f --tail=100

## Deploy the current commit: pull, rebuild, migrate
.PHONY: deploy
deploy:
	git pull --ff-only
	docker compose up -d --build
	$(MAKE) db-migrate

#################################################################################
# SELF-DOCUMENTING HELP                                                         #
#################################################################################

help:
	@echo "$(PROJECT_NAME) — available rules:"
	@echo
	@awk 'BEGIN { FS = ":" } \
	     /^## / { doc = substr($$0, 4); next } \
	     /^[a-zA-Z_-]+:/ && doc { printf "  \033[36m%-16s\033[0m %s\n", $$1, doc; doc = "" }' \
	     $(MAKEFILE_LIST)

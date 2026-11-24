# Speak-Ez Sessions (SEZS) top-level targets. Loopback only. No production deploy.
SHELL := /bin/bash
SEZS_APP := $(CURDIR)/apps/sezs
ENV_SCRIPT := $(CURDIR)/scripts/env/sezs_session_env.sh
FUND_SCRIPT := $(CURDIR)/scripts/env/sezs_session_fund.sh
CIRCUIT_DIR := $(CURDIR)/circuits/sezs-ticket-v2
SESSION ?= $(SEZS_SESSION_ROOT)

.PHONY: build test docs circuits schema codegen deploy-local deploy event-roles event-curate orch-test env-up env-down env-fund env-seed env-health e2e help narration-lint narration-validate diagrams flows-derive walkthrough-render walkthrough-preview walkthrough-timeline

help:
	@echo "Targets: build test docs circuits schema codegen deploy-local deploy env-up env-down env-fund env-seed env-health e2e orch-test narration-lint narration-validate diagrams flows-derive studio studio-serve studio-takes walkthrough-render walkthrough-preview"

build:
	cd $(SEZS_APP) && pnpm exec tsc --noEmit --pretty false || true
	cd $(SEZS_APP) && NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 pnpm exec next build

test:
	cd $(SEZS_APP) && node --test dev/splash/*.test.mjs server/*.test.mjs src/frost/*.test.mjs src/pay/*.test.mjs src/ticket/v2/*.test.mjs src/event/*.test.mjs

docs:
	cd websites/sezs-docs && python3 scripts/sync-from-source.py
	cd websites/sezs-docs && pnpm build

# Rebuild Halo2 params/vkbody in-tree when rustc and zk-cosmwasm are available.
# Artifacts are gitignored because they are large. upgrade-v2 reads only these
# in-tree paths (no sezs-lab fallback).
circuits:
	@if [[ -f "$(CIRCUIT_DIR)/artifacts/sezs_consume_v2.params" && -f "$(CIRCUIT_DIR)/artifacts/sezs_consume_v2.vkbody" && "$(SEZS_REBUILD_CIRCUITS)" != "1" ]]; then \
	  echo "in-tree circuit artifacts already present (set SEZS_REBUILD_CIRCUITS=1 to rebuild)"; \
	  ls -l "$(CIRCUIT_DIR)/artifacts/sezs_consume_v2.params" "$(CIRCUIT_DIR)/artifacts/sezs_consume_v2.vkbody"; \
	else \
	  echo "building sezs-v2-keygen (feature keygen) in-tree"; \
	  cargo build --manifest-path "$(CIRCUIT_DIR)/Cargo.toml" --release -p sezs-ticket-v2 --features keygen --bin sezs-v2-keygen; \
	  cargo run --manifest-path "$(CIRCUIT_DIR)/Cargo.toml" --release -p sezs-ticket-v2 --features keygen --bin sezs-v2-keygen -- "$(CIRCUIT_DIR)/artifacts"; \
	fi
	@test -f "$(CIRCUIT_DIR)/artifacts/sezs_consume_v2.params"
	@test -f "$(CIRCUIT_DIR)/artifacts/sezs_consume_v2.vkbody"

env-up:
	SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(ENV_SCRIPT) up
	SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(FUND_SCRIPT)

env-fund:
	SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(FUND_SCRIPT)

env-seed:
	SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(ENV_SCRIPT) seed

env-down:
	SEZS_SESSION_FORCE_DOWN=$${SEZS_SESSION_FORCE_DOWN:-1} SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(ENV_SCRIPT) down
	SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(ENV_SCRIPT) teardown-check || true

env-health:
	SEZS_SESSION_ROOT="$(or $(SESSION),$(SEZS_SESSION_ROOT))" bash $(ENV_SCRIPT) health

e2e:
	cd $(SEZS_APP) && node --test e2e/*.e2e.mjs

# --- schema / codegen / local cw-orch deploy (see docs/DEPLOY.md) ---
.PHONY: schema codegen deploy-local deploy event-roles event-curate orch-test kms-local-test

schema:
	bash $(CURDIR)/scripts/schema.sh

codegen: schema
	true; \
	node $(CURDIR)/scripts/codegen.mjs

deploy-local:
	true; \
	NETWORK=local bash $(CURDIR)/scripts/deploy.sh

# Apply coordinator / usher terp1 addresses to the existing local event.
# Requires SEZS_COORDINATOR and SEZS_USHER. Does not run a new deploy.
event-roles:
	true; \
	NETWORK=local bash $(CURDIR)/scripts/event-roles.sh

# Write lantern-night metadata and upsert sponsors on the existing local event.
# Does not run a new deploy. Loopback only.
event-curate:
	true; \
	NETWORK=local bash $(CURDIR)/scripts/event-curate.sh

# `make deploy NETWORK=local` (default). Refuses mainnet/testnet unless
# SEZS_DEPLOY_CONFIRM_MAINNET=1. Never broadcasts from this target to a
# public node without that confirm var.
NETWORK ?= local
deploy:
	true; \
	NETWORK=$(NETWORK) bash $(CURDIR)/scripts/deploy.sh

orch-test:
	cargo test --manifest-path $(CURDIR)/packages/Cargo.toml --workspace -- --nocapture

# Loopback-only cw-orch-kms granter/grantee deploy+curate. Never mainnet.
kms-local-test:
	bash $(CURDIR)/scripts/kms-local-test.sh


# --- demo narration and flow diagrams (local only) ---
NARRATION_DIR := $(CURDIR)/docs/guides/narration
PATH_TOOLS := $(HOME)/.local/bin:$(PATH)

.PHONY: narration-lint narration-validate diagrams flows-derive

narration-lint:
	export PATH="$(PATH_TOOLS)"; \
	python3 $(CURDIR)/scripts/narration-lint.py $(NARRATION_DIR)

narration-validate:
	export PATH="$(PATH_TOOLS)"; \
	python3 $(CURDIR)/scripts/narration-validate.py $(NARRATION_DIR)

diagrams:
	export PATH="$(PATH_TOOLS)"; \
	bash $(CURDIR)/scripts/diagrams-render.sh

flows-derive:
	export PATH="$(PATH_TOOLS)"; \
	bash $(CURDIR)/scripts/flows-derive.sh
	$(MAKE) diagrams

# --- recording studio (static page, local only) ---
.PHONY: studio studio-serve studio-takes studio-lint

studio:
	export PATH="$(PATH_TOOLS)"; \
	python3 $(CURDIR)/scripts/studio-generate.py
	export PATH="$(PATH_TOOLS)"; \
	python3 $(CURDIR)/scripts/studio-lint.py

studio-lint:
	export PATH="$(PATH_TOOLS)"; \
	python3 $(CURDIR)/scripts/studio-lint.py

studio-serve:
	bash $(CURDIR)/scripts/studio-serve.sh

studio-takes:
	export PATH="$(PATH_TOOLS)"; \
	bash $(CURDIR)/scripts/studio-takes.sh
	$(MAKE) studio

# --- walkthrough videos (Remotion, local only, loopback UI) ---
WALKTHROUGHS := $(CURDIR)/e2e/walkthroughs
GUIDE ?= install

.PHONY: walkthrough-timeline walkthrough-render walkthrough-preview walkthrough-capture-stub

walkthrough-timeline:
	export PATH="$(PATH_TOOLS)"; \
	cd $(WALKTHROUGHS) && pnpm exec tsx scripts/build-timeline.ts --guide=$(GUIDE)

walkthrough-render:
	export PATH="$(PATH_TOOLS)"; \
	bash $(WALKTHROUGHS)/scripts/render.sh $(GUIDE)

walkthrough-preview:
	export PATH="$(PATH_TOOLS)"; \
	bash $(WALKTHROUGHS)/scripts/preview.sh

walkthrough-capture-stub:
	export PATH="$(PATH_TOOLS)"; \
	cd $(WALKTHROUGHS) && pnpm exec tsx scripts/capture-trail-clicks.ts --guide=$(GUIDE)

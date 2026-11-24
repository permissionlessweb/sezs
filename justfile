# Speak-Ez Sessions. The only operator entry point.
# Defaults are reproducible on a clean clone. Local-dev recipes are optional.
set shell := ["bash", "-eu", "-c"]
set dotenv-load := false

root := justfile_directory()
app := root / "apps/sezs"
dep := "python3 " + quote(root / "tools/deps/dep.py")

# ---------------------------------------------------------------------------
# Help (default)
# ---------------------------------------------------------------------------

default: help

help:
    @echo "Reproducible (clean clone):"
    @echo "  just install            Corepack + pnpm install --frozen-lockfile"
    @echo "  just typecheck          tsc --noEmit"
    @echo "  just build              typecheck + Next.js production build"
    @echo "  just test               app unit tests"
    @echo "  just check-crates       cargo check -p sezs-orch workspace"
    @echo "  just test-crates        cargo test  (orch workspace)"
    @echo "  just build-contracts    cargo test/check of contracts/"
    @echo "  just optimize           terp-optimizer (Docker) + checksums"
    @echo "  just check              typecheck + lint + unit tests + cargo check"
    @echo "  just deps-validate | deps-branch-check | deps-patch-git"
    @echo ""
    @echo "Optional local-dev (loopback; not required for a clean build):"
    @echo "  just env-up env-down env-fund env-seed env-health"
    @echo "  just deploy-local event-roles event-curate e2e"
    @echo "  just circuits           rebuild ticket circuit artifacts"
    @echo "  just deps-patch-local   requires SEZS_CRATES_ROOT; do not commit"

# ---------------------------------------------------------------------------
# Install / JS
# ---------------------------------------------------------------------------

install:
    cd "{{root}}" && corepack enable
    cd "{{root}}" && corepack prepare pnpm@10.18.3 --activate
    cd "{{root}}" && pnpm install --frozen-lockfile

install-update:
    cd "{{root}}" && corepack enable
    cd "{{root}}" && corepack prepare pnpm@10.18.3 --activate
    cd "{{root}}" && pnpm install --no-frozen-lockfile

typecheck:
    cd "{{app}}" && pnpm exec tsc --noEmit --pretty false

build: typecheck
    cd "{{app}}" && NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BASE_PATH=/alpha/sezs pnpm exec next build

test:
    cd "{{app}}" && node --test dev/splash/*.test.mjs server/*.test.mjs src/frost/*.test.mjs src/pay/*.test.mjs src/ticket/v2/*.test.mjs src/event/*.test.mjs

# Loopback server e2e needs a static export built with the public alpha base path.
test-loopback-e2e:
    cd "{{app}}" && NEXT_PUBLIC_BASE_PATH=/alpha/sezs node --test server/session-loopback.e2e.test.mjs

lint:
    cd "{{root}}" && pnpm exec turbo run lint --continue --filter=@sezs/app... || true

# ---------------------------------------------------------------------------
# Rust crates (orch)
# ---------------------------------------------------------------------------

check-crates:
    cargo check --manifest-path "{{root}}/crates/Cargo.toml" --workspace

test-crates:
    cargo test --manifest-path "{{root}}/crates/Cargo.toml" --workspace -- --nocapture

# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------

build-contracts:
    cargo test --manifest-path "{{root}}/contracts/Cargo.toml" --workspace --lib
    cargo check --manifest-path "{{root}}/contracts/Cargo.toml" --workspace --lib --target wasm32-unknown-unknown

optimize:
    bash "{{root}}/tools/optimize.sh"

# Alias used in docs
build-contracts-optimized: optimize

# ---------------------------------------------------------------------------
# Dep switcher
# ---------------------------------------------------------------------------

deps-config:
    {{dep}} config

deps-status:
    {{dep}} status

deps-validate:
    {{dep}} validate

deps-branch-check:
    {{dep}} branch-check

deps-patch-git:
    {{dep}} switch patch-git

deps-patch-git-dry-run:
    {{dep}} switch patch-git --dry-run

# Opt-in. Requires SEZS_CRATES_ROOT. Do not commit the result.
deps-patch-local:
    {{dep}} switch patch-local

deps-patch-local-dry-run:
    {{dep}} switch patch-local --dry-run

# ---------------------------------------------------------------------------
# Aggregate check
# ---------------------------------------------------------------------------

check: typecheck test check-crates build-contracts

# ---------------------------------------------------------------------------
# Docs site
# ---------------------------------------------------------------------------

docs:
    cd "{{root}}/websites/sezs-docs" && python3 scripts/sync-from-source.py
    cd "{{root}}/websites/sezs-docs" && pnpm build

# ---------------------------------------------------------------------------
# Circuits (optional; needs the zakura git pins and Rust)
# ---------------------------------------------------------------------------

circuits:
    #!/usr/bin/env bash
    set -euo pipefail
    CIRCUIT_DIR="{{root}}/circuits/sezs-ticket-v2"
    if [[ -f "$CIRCUIT_DIR/artifacts/sezs_consume_v2.params" && -f "$CIRCUIT_DIR/artifacts/sezs_consume_v2.vkbody" && "${SEZS_REBUILD_CIRCUITS:-}" != "1" ]]; then
      echo "in-tree circuit artifacts already present (set SEZS_REBUILD_CIRCUITS=1 to rebuild)"
      ls -l "$CIRCUIT_DIR/artifacts/sezs_consume_v2.params" "$CIRCUIT_DIR/artifacts/sezs_consume_v2.vkbody"
    else
      echo "building sezs-v2-keygen (feature keygen) in-tree"
      cargo build --manifest-path "$CIRCUIT_DIR/Cargo.toml" --release -p sezs-ticket-v2 --features keygen --bin sezs-v2-keygen
      cargo run --manifest-path "$CIRCUIT_DIR/Cargo.toml" --release -p sezs-ticket-v2 --features keygen --bin sezs-v2-keygen -- "$CIRCUIT_DIR/artifacts"
    fi
    test -f "$CIRCUIT_DIR/artifacts/sezs_consume_v2.params"
    test -f "$CIRCUIT_DIR/artifacts/sezs_consume_v2.vkbody"

# ---------------------------------------------------------------------------
# Schema / codegen
# ---------------------------------------------------------------------------

schema:
    bash "{{root}}/scripts/schema.sh"

codegen: schema
    node "{{root}}/scripts/codegen.mjs"

# ---------------------------------------------------------------------------
# Optional loopback deploy (not the default build path)
# ---------------------------------------------------------------------------

deploy-local:
    NETWORK="${NETWORK:-local}" bash "{{root}}/scripts/deploy.sh"

NETWORK := "local"

deploy:
    NETWORK="{{NETWORK}}" bash "{{root}}/scripts/deploy.sh"

event-roles:
    NETWORK="${NETWORK:-local}" bash "{{root}}/scripts/event-roles.sh"

event-curate:
    NETWORK="${NETWORK:-local}" bash "{{root}}/scripts/event-curate.sh"

test-orch: test-crates

test-kms-local:
    bash "{{root}}/scripts/kms-local-test.sh"

# ---------------------------------------------------------------------------
# Optional loopback session environment
# ---------------------------------------------------------------------------

env-up:
    bash "{{root}}/scripts/env/sezs_session_env.sh" up
    bash "{{root}}/scripts/env/sezs_session_fund.sh"

env-fund:
    bash "{{root}}/scripts/env/sezs_session_fund.sh"

env-seed:
    bash "{{root}}/scripts/env/sezs_session_env.sh" seed

env-down:
    SEZS_SESSION_FORCE_DOWN="${SEZS_SESSION_FORCE_DOWN:-1}" bash "{{root}}/scripts/env/sezs_session_env.sh" down
    bash "{{root}}/scripts/env/sezs_session_env.sh" teardown-check || true

env-health:
    bash "{{root}}/scripts/env/sezs_session_env.sh" health

e2e:
    cd "{{app}}" && node --test e2e/*.e2e.mjs

# ---------------------------------------------------------------------------
# Optional narration / studio / walkthroughs (local only)
# ---------------------------------------------------------------------------

narration-lint:
    python3 "{{root}}/scripts/narration-lint.py" "{{root}}/docs/guides/narration"

narration-validate:
    python3 "{{root}}/scripts/narration-validate.py" "{{root}}/docs/guides/narration"

diagrams:
    bash "{{root}}/scripts/diagrams-render.sh"

flows-derive:
    bash "{{root}}/scripts/flows-derive.sh"
    just diagrams

studio:
    python3 "{{root}}/scripts/studio-generate.py"
    python3 "{{root}}/scripts/studio-lint.py"

studio-lint:
    python3 "{{root}}/scripts/studio-lint.py"

studio-serve:
    bash "{{root}}/scripts/studio-serve.sh"

studio-takes:
    bash "{{root}}/scripts/studio-takes.sh"
    just studio

GUIDE := "install"

walkthrough-timeline:
    cd "{{root}}/e2e/walkthroughs" && pnpm exec tsx scripts/build-timeline.ts --guide={{GUIDE}}

walkthrough-render:
    bash "{{root}}/e2e/walkthroughs/scripts/render.sh" {{GUIDE}}

walkthrough-preview:
    bash "{{root}}/e2e/walkthroughs/scripts/preview.sh"

walkthrough-capture-stub:
    cd "{{root}}/e2e/walkthroughs" && pnpm exec tsx scripts/capture-trail-clicks.ts --guide={{GUIDE}}

# ZIP-style specs: typecheck and simulate Quint models (P1, P2, P3).
# Symbolic verify (`quint verify`) needs Apalache and is optional.
specs-quint:
    quint typecheck docs/specs/quint/ticket_lifecycle.qnt
    quint typecheck docs/specs/quint/usher_authority.qnt
    quint typecheck docs/specs/quint/door_consume.qnt
    quint test docs/specs/quint/ticket_lifecycle.qnt
    quint test docs/specs/quint/usher_authority.qnt
    quint test docs/specs/quint/door_consume.qnt
    quint run --invariants P1_admit_at_most_once P1_count_agrees P3_cancel_refund_exclusive --max-steps=30 docs/specs/quint/ticket_lifecycle.qnt
    quint run --init=initAuth --step=stepAuth --invariants P2_ushers_cannot_issue_or_forge --max-steps=30 docs/specs/quint/usher_authority.qnt
    quint run --init=initDoor --step=stepDoor --invariants P1_door_consume_once P2_door_not_issued_by_usher --max-steps=30 docs/specs/quint/door_consume.qnt

# Speak-Ez Sessions (SEZS) justfile. Loopback only. No production deploy.

help:
    @echo "recipes: build test docs circuits env-up env-down env-fund env-seed env-health e2e"

build:
    make build

test:
    make test

docs:
    make docs

circuits:
    make circuits

env-up:
    make env-up

env-fund:
    make env-fund

env-seed:
    make env-seed

env-down:
    make env-down

env-health:
    make env-health

e2e:
    make e2e

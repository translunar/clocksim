# clocksim

Client-side Allan deviation / error-growth teaching simulator for gyros, accelerometers and clocks.
Design: `docs/superpowers/specs/2026-08-22-clocksim-design.md`.

## Develop
    npm install
    npm test
    npm run dev

## Fixtures
Test oracles are generated offline with Python:
    python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
    .venv/bin/python tools/gen_fixtures.py

## Deploy
    ./scripts/deploy.sh   # copies dist/ into ~/Projects/translunar.github.io/tools/clocksim/

## Conventions
Engine is SI only; datasheet units convert in `src/engine/units.ts`. Noise coefficients and their
ADEV asymptotes are tabulated in the implementation plan (`docs/superpowers/plans/`).

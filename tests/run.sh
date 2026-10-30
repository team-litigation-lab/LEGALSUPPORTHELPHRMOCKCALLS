#!/usr/bin/env bash
# Starts the Gemini stand-in and `wrangler dev` (with a test passphrase and the stand-in as Google),
# then runs the two-browser tests: a live call, and an agent-caller call.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8799}
rm -rf .wrangler/test-state
node tests/mock-gemini.js > .wrangler-mock.log 2>&1 & MOCK=$!
printf 'ADMIN_PASSPHRASE=test-pass\nGEMINI_API_KEY20=test-key\nGEMINI_BASE=http://127.0.0.1:9911\nLIVE_WS_URL=ws://127.0.0.1:9911/live\n' > .dev.vars.test
setsid npx wrangler dev --port "$PORT" --env-file .dev.vars.test --persist-to .wrangler/test-state > .wrangler-test.log 2>&1 & PID=$!
# wrangler runs in its own process group, so its workerd children stop with it.
trap 'kill -- -$PID $MOCK 2>/dev/null; rm -f .dev.vars.test' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
export BASE="http://127.0.0.1:$PORT" PASS=test-pass
node tests/e2e-live.js
node tests/e2e-ai.js

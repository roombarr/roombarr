#!/bin/bash
# Block npm/pnpm/yarn/npx/pnpx invocations. This repo is bun-only.
# Catches chained/wrapped invocations that permissions.deny prefix matching misses
# (e.g. `cd apps/api && npm i`, `bash -c "pnpm build"`).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

if echo "$COMMAND" | grep -Eq '(^|[^A-Za-z0-9_./-])(npm|pnpm|yarn|npx|pnpx)([[:space:]]|$)'; then
  echo "Blocked: command uses a non-bun package manager. This repo is bun-only — use \`bun\` instead of npm/pnpm/yarn, and \`bunx\` instead of npx/pnpx." >&2
  echo "Command was: $COMMAND" >&2
  exit 2
fi

exit 0

#!/bin/bash
# Block direct edits to bun.lock. The lockfile is generated — it should only
# change via `bun install`, `bun add`, or `bun remove`.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$(basename "$FILE_PATH")" == "bun.lock" ]]; then
  echo "Blocked: $FILE_PATH is the bun lockfile — let bun manage it. Use \`bun install\`, \`bun add <pkg>\`, or \`bun remove <pkg>\` instead of editing bun.lock directly." >&2
  exit 2
fi

exit 0

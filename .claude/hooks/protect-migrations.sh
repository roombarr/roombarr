#!/bin/bash
# Block direct edits to Drizzle-managed migration files.
# Migrations must be (re)generated via `bun run db:generate`, not hand-edited.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" == *"drizzle/"* ]]; then
  echo "Blocked: $FILE_PATH is under drizzle/ — these files are Drizzle-generated. Run \`bun run db:generate\` (or the appropriate Drizzle command) instead of editing migration files directly." >&2
  exit 2
fi

exit 0

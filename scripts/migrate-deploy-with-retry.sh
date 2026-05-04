#!/usr/bin/env bash
set -euo pipefail

MAX_RETRIES=${MAX_RETRIES:-5}
DELAY_SECONDS=${DELAY_SECONDS:-5}

# ---------------------------------------------------------------------------
# resolve_failed_migrations
# If prisma migrate deploy reports P3009 (failed migration in DB), extract
# the migration name(s) and mark them as --applied so the next deploy can run.
# This handles the "schema already existed" baseline case.
# ---------------------------------------------------------------------------
resolve_failed_migrations() {
  local output="$1"
  # P3009: prior run left a FAILED record — extract name from "The `<name>` migration..." line
  if echo "$output" | grep -q "P3009"; then
    while IFS= read -r line; do
      migration=$(echo "$line" | sed -n "s/.*The \`\(.*\)\` migration.*/\1/p")
      if [[ -n "$migration" ]]; then
        echo "Resolving P3009 failed migration as applied: $migration"
        npx prisma migrate resolve --applied "$migration"
      fi
    done <<< "$output"
    return 0
  fi
  # P3018: migration failed mid-run (e.g. schema already exists) — extract from "Migration name: <name>" line
  if echo "$output" | grep -q "P3018"; then
    migration=$(echo "$output" | grep "Migration name:" | sed -n "s/.*Migration name: \(.*\)/\1/p" | tr -d '[:space:]')
    if [[ -n "$migration" ]]; then
      echo "Resolving P3018 failed migration as applied: $migration"
      npx prisma migrate resolve --applied "$migration"
      return 0
    fi
  fi
  return 1  # unrecognised error — nothing resolved
}

attempt=1
while [[ "$attempt" -le "$MAX_RETRIES" ]]; do
  echo "Running prisma migrate deploy (attempt ${attempt}/${MAX_RETRIES})"

  output=$(npx prisma migrate deploy 2>&1) && {
    echo "$output"
    echo "Migrations applied successfully"
    break
  }

  echo "$output"

  # Auto-resolve stuck P3009 failures (schema-already-exists baseline case)
  if resolve_failed_migrations "$output"; then
    echo "Failed migrations resolved — retrying immediately"
    attempt=$((attempt + 1))
    continue
  fi

  if [[ "$attempt" -eq "$MAX_RETRIES" ]]; then
    echo "Migration failed after ${MAX_RETRIES} attempts"
    exit 1
  fi

  sleep "$DELAY_SECONDS"
  DELAY_SECONDS=$((DELAY_SECONDS * 2))
  attempt=$((attempt + 1))
done

npx prisma generate
npm run build

#!/usr/bin/env bash
set -euo pipefail

MAX_RETRIES=${MAX_RETRIES:-5}
DELAY_SECONDS=${DELAY_SECONDS:-5}

attempt=1
while [[ "$attempt" -le "$MAX_RETRIES" ]]; do
  echo "Running prisma migrate deploy (attempt ${attempt}/${MAX_RETRIES})"
  if npx prisma migrate deploy; then
    echo "Migrations applied successfully"
    break
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

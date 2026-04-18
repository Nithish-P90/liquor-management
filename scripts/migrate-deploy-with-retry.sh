#!/usr/bin/env bash

set -euo pipefail

MAX_ATTEMPTS="${PRISMA_MIGRATE_MAX_ATTEMPTS:-5}"

if ! [[ "$MAX_ATTEMPTS" =~ ^[0-9]+$ ]] || [[ "$MAX_ATTEMPTS" -lt 1 ]]; then
  echo "Invalid PRISMA_MIGRATE_MAX_ATTEMPTS: $MAX_ATTEMPTS"
  exit 1
fi

attempt=1
while [[ "$attempt" -le "$MAX_ATTEMPTS" ]]; do
  echo "Running prisma migrate deploy (attempt ${attempt}/${MAX_ATTEMPTS})..."
  if npx prisma migrate deploy; then
    echo "Prisma migrate deploy succeeded."
    exit 0
  fi

  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "Prisma migrate deploy failed after ${MAX_ATTEMPTS} attempts."
    exit 1
  fi

  # Exponential backoff: 2,4,8,16...
  wait_secs=$((2 ** attempt))
  echo "Prisma migrate deploy failed (likely transient lock/timeout). Retrying in ${wait_secs}s..."
  sleep "$wait_secs"
  attempt=$((attempt + 1))
done

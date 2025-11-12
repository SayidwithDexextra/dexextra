#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env.local"
# Choose which Vercel environments to sync; remove any you don't want
ENVIRONMENTS=("production")

# Resolve vercel command (use local CLI if available, else fallback to npx)
if command -v vercel >/dev/null 2>&1; then
  VCMD=(vercel)
else
  VCMD=(npx -y vercel@latest)
fi

# Extra args for headless auth if VERCEL_TOKEN is set
EXTRA_ARGS=()
if [ -n "${VERCEL_TOKEN:-}" ]; then
  EXTRA_ARGS+=(--token "$VERCEL_TOKEN")
fi

# Resolve project/org context from env or .vercel/project.json; refuse to create/link
PROJECT_ID="${VERCEL_PROJECT_ID:-${VERCEL_PROJECT:-}}"
ORG_ID="${VERCEL_SCOPE:-${VERCEL_ORG_ID:-}}"

if [ -z "$PROJECT_ID" ] || [ -z "$ORG_ID" ]; then
  if [ -f ".vercel/project.json" ]; then
    FILE_PROJECT_ID="$(sed -n 's/.*\"projectId\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' .vercel/project.json | head -n1)"
    FILE_ORG_ID="$(sed -n 's/.*\"orgId\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' .vercel/project.json | head -n1)"
    if [ -z "$PROJECT_ID" ] && [ -n "$FILE_PROJECT_ID" ]; then
      PROJECT_ID="$FILE_PROJECT_ID"
    fi
    if [ -z "$ORG_ID" ] && [ -n "$FILE_ORG_ID" ]; then
      ORG_ID="$FILE_ORG_ID"
    fi
  fi
fi

if [ -z "$PROJECT_ID" ] || [ -z "$ORG_ID" ]; then
  echo "Not linked to an existing Vercel project. Refusing to create a new one."
  echo "Set VERCEL_PROJECT_ID and VERCEL_ORG_ID (or VERCEL_SCOPE), or ensure .vercel/project.json exists."
  exit 1
fi

# Export identifiers so Vercel CLI resolves the correct project/scope without extra flags
export VERCEL_PROJECT_ID="$PROJECT_ID"
export VERCEL_ORG_ID="$ORG_ID"
# Optional: honor existing VERCEL_SCOPE if set; otherwise, set it to org id for consistency
export VERCEL_SCOPE="${VERCEL_SCOPE:-$ORG_ID}"

# Helper to call vercel with optional extra args safely under `set -u`
run_vercel() {
  if [ "${#EXTRA_ARGS[@]}" -gt 0 ]; then
    "${VCMD[@]}" "${EXTRA_ARGS[@]}" "$@"
  else
    "${VCMD[@]}" "$@"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE in project root."
  exit 1
fi

echo "Syncing environment variables from $ENV_FILE to target project ..."
echo "Target: project=$PROJECT_ID org=$ORG_ID"

# Read file line-by-line
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  # strip CR for Windows-formatted files
  line="${raw_line%$'\r'}"

  # skip comments/blank lines
  case "$line" in
    ''|\#*) continue ;;
  esac

  # handle lines starting with 'export '
  case "$line" in
    export\ *) line="${line#export }" ;;
  esac

  # ensure it looks like KEY=VALUE
  if [[ "$line" != *=* ]]; then
    continue
  fi

  key="${line%%=*}"
  value="${line#*=}"

  # trim whitespace around key (keep value exact)
  key="$(printf '%s' "$key" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  # guard empty key
  if [ -z "$key" ]; then
    continue
  fi

  for env in "${ENVIRONMENTS[@]}"; do
    # Upsert: remove existing (ignore if not present), then add
    run_vercel env rm "$key" "$env" -y >/dev/null 2>&1 || true
    printf '%s' "$value" | run_vercel env add "$key" "$env" >/dev/null
    echo "Synced $key -> $env"
  done
done < "$ENV_FILE"

echo "Done."



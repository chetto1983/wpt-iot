#!/usr/bin/env bash
# Phase 33 enforcement: zero hardcoded process-indication hex in component source.
# Exemption: app/global-error.tsx (topmost error boundary — Tailwind may not load;
# intentional inline hex documented in UI-SPEC.md §global-error.tsx exemption).
#
# Exit 0: no matches found (clean — all hex migrated to CSS tokens)
# Exit 1: matches found (migration incomplete)
#
# Usage (from wpt-iot/ or any subdirectory):
#   bash scripts/grep-hardcoded-process-hex.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND="$REPO_ROOT/apps/frontend/src"

PATTERN='#dc3545|#1ABC9C|rgb\(220,\s*53,\s*69\)|#f59e0b|#f97316'
SCOPE=(
  "$FRONTEND/components/anomaly"
  "$FRONTEND/components/pwa"
  "$FRONTEND/components/dashboard"
  "$FRONTEND/components/cycles"
  "$FRONTEND/app/(app)"
)
EXCLUDE="$FRONTEND/app/global-error.tsx"

# Filter scope to only existing directories/files to avoid grep no-such-file errors
EXISTING_SCOPE=()
for s in "${SCOPE[@]}"; do
  if [ -e "$s" ]; then
    EXISTING_SCOPE+=("$s")
  fi
done

if [ ${#EXISTING_SCOPE[@]} -eq 0 ]; then
  echo "[INFO] No scope directories found — nothing to scan."
  exit 0
fi

MATCHES=$(grep -rn --include="*.tsx" --include="*.ts" -E "$PATTERN" \
  "${EXISTING_SCOPE[@]}" 2>/dev/null \
  | grep -v "$EXCLUDE" || true)

if [ -n "$MATCHES" ]; then
  echo "[FAIL] Hardcoded process-indication hex found:"
  echo "$MATCHES"
  exit 1
else
  echo "[PASS] No hardcoded process-indication hex in component source."
  exit 0
fi

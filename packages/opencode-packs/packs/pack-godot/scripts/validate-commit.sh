#!/usr/bin/env bash
# Pre-commit validation hook for godot-opencode (Phase 3.5).
# - Validates staged .json tables parse (blocks on bad JSON).
# - GDScript quick check: conflict markers + obvious type-consistency slips.
# - Optionally blocks on test failure (--run-tests or VALIDATE_COMMIT_RUN_TESTS=1).
# Gracefully degrades when optional tools (python3/bun/godot) are missing.
set -euo pipefail

RUN_TESTS=0
if [[ "${1:-}" == "--run-tests" ]]; then
  RUN_TESTS=1
fi
if [[ "${VALIDATE_COMMIT_RUN_TESTS:-}" == "1" ]]; then
  RUN_TESTS=1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

STAGED="$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)"
if [[ -z "$STAGED" ]]; then
  echo "validate-commit: no staged changes, ok"
  exit 0
fi

fail() {
  echo "validate-commit: $*" >&2
  exit 1
}

json_ok() {
  local file="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$file" 2>/dev/null
    return $?
  fi
  if command -v bun >/dev/null 2>&1; then
    bun -e 'const f=Bun.file(process.argv[2]); JSON.parse(await f.text())' -- "$file" 2>/dev/null
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'require("fs"); JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$file" 2>/dev/null
    return $?
  fi
  echo "validate-commit: warning: no JSON parser available, skipping $file" >&2
  return 0
}

JSON_FAILED=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in
    *.json)
      if [[ -f "$file" ]]; then
        if ! json_ok "$file"; then
          echo "validate-commit: invalid JSON: $file" >&2
          JSON_FAILED=1
        fi
      fi
      ;;
  esac
done <<<"$STAGED"
if [[ "$JSON_FAILED" == "1" ]]; then
  fail "staged JSON validation failed"
fi

GD_FAILED=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in
    *.gd)
      if [[ -f "$file" ]]; then
        if grep -qE '^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|)' "$file"; then
          echo "validate-commit: conflict markers in $file" >&2
          GD_FAILED=1
        fi
        # Obvious type-consistency slips: int := quoted string, String := bare number.
        if grep -qE 'var\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*int\s*=\s*"' "$file"; then
          echo "validate-commit: type mismatch (int := string) in $file" >&2
          GD_FAILED=1
        fi
        if grep -qE 'var\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*String\s*=\s*[0-9]' "$file"; then
          echo "validate-commit: type mismatch (String := number) in $file" >&2
          GD_FAILED=1
        fi
      fi
      ;;
  esac
done <<<"$STAGED"
if [[ "$GD_FAILED" == "1" ]]; then
  fail "staged GDScript check failed"
fi

if [[ "$RUN_TESTS" == "1" ]]; then
  if command -v bun >/dev/null 2>&1; then
    echo "validate-commit: running bun tests..."
    if ! bun test ./packages/plugin/test/ ./companion/tests/; then
      fail "tests failed, commit blocked"
    fi
  else
    echo "validate-commit: warning: bun not found, skipping tests" >&2
  fi
fi

echo "validate-commit: ok"
exit 0

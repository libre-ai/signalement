#!/bin/sh
set -eu

fail() {
  printf '%s\n' 'Bootstrap checkout preparation refused' >&2
  exit 1
}

[ "${GITHUB_ACTIONS:-}" = true ] || fail
[ "${GITHUB_REF:-}" = refs/heads/main ] || fail
case "${GITHUB_SHA:-}" in
  ''|*[!0-9a-f]*) fail ;;
esac
[ "${#GITHUB_SHA}" -eq 40 ] || fail
[ "$(git symbolic-ref -q HEAD 2>/dev/null)" = refs/heads/main ] || fail
[ "$(git rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" = "$GITHUB_SHA" ] || fail

# Checkout adds one tracking ref. Reject every other shape before changing any ref;
# otherwise preparation could conceal history the publication scanner must reject.
actual=$(git for-each-ref --format='%(refname) %(objectname) %(symref)' 2>/dev/null) || fail
expected=$(printf 'refs/heads/main %s \nrefs/remotes/origin/main %s ' "$GITHUB_SHA" "$GITHUB_SHA")
[ "$actual" = "$expected" ] || fail

# Compare-and-swap both admitted refs in one transaction. Never prune broadly.
if ! printf 'start\nverify refs/heads/main %s\ndelete refs/remotes/origin/main %s\nprepare\ncommit\n' \
  "$GITHUB_SHA" "$GITHUB_SHA" | git update-ref --stdin >/dev/null 2>&1; then
  fail
fi

#!/usr/bin/env bash
# Fails when a commit in BASE..HEAD has an author or committer email that is
# not a GitHub noreply address, or a message (a Co-authored-by line, for
# example) that contains any other email address.
#
# Output names only commit SHAs and the failing field, never an address, because
# this repository's CI logs are public.
#
#   scripts/check-commit-identity.sh <base> <head>
#   scripts/check-commit-identity.test.sh          # its tests
set -euo pipefail

NOREPLY='^([0-9]+\+[A-Za-z0-9-]+(\[bot\])?@users\.noreply\.github\.com|noreply@github\.com)$'
# AI-assistant attribution lines may also name this address.
ATTRIBUTION='^noreply@anthropic\.com$'
EMAIL_LIKE='[]A-Za-z0-9._%+[-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'

if [[ $# -ne 2 ]]; then
  echo 'Usage: scripts/check-commit-identity.sh <base> <head>' >&2
  exit 2
fi
base=$(git rev-parse --verify --quiet "$1^{commit}") || {
  echo 'Unknown base commit' >&2
  exit 2
}
head=$(git rev-parse --verify --quiet "$2^{commit}") || {
  echo 'Unknown head commit' >&2
  exit 2
}

commits=$(git rev-list "$base..$head")
if [[ -z $commits ]]; then
  echo 'No commits between base and head' >&2
  exit 1
fi

failed=0
count=0
for sha in $commits; do
  count=$((count + 1))
  short=${sha:0:10}
  # %ae and %ce are the recorded addresses; .mailmap does not change them.
  if [[ ! $(git show -s --format=%ae "$sha") =~ $NOREPLY ]]; then
    echo "Commit $short: the author email is not a GitHub noreply address"
    failed=1
  fi
  if [[ ! $(git show -s --format=%ce "$sha") =~ $NOREPLY ]]; then
    echo "Commit $short: the committer email is not a GitHub noreply address"
    failed=1
  fi
  while IFS= read -r email; do
    if [[ ! $email =~ $NOREPLY && ! $email =~ $ATTRIBUTION ]]; then
      echo "Commit $short: the message contains an email address other than a GitHub noreply address"
      failed=1
      break
    fi
  done < <(git show -s --format=%B "$sha" | grep -oE -- "$EMAIL_LIKE" || true)
done

if [[ $failed -ne 0 ]]; then
  echo 'Commit with a GitHub noreply address (<id>+<login>@users.noreply.github.com) as both'
  echo 'author and committer, keep other email addresses out of commit messages, then rewrite'
  echo 'the commits above and push again.'
  exit 1
fi
echo "All commits use GitHub noreply addresses ($count checked)."

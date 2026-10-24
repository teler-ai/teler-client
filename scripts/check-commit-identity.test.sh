#!/usr/bin/env bash
# Tests scripts/check-commit-identity.sh against commits in a throwaway repository.
set -euo pipefail

check="$(cd "$(dirname "$0")" && pwd)/check-commit-identity.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Ignore this machine's git configuration: its identity, hooks and signing.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=Tester GIT_COMMITTER_NAME=Tester

NOREPLY=12345+someone@users.noreply.github.com
OTHER=someone@example.com

git init -q "$work/repo"
cd "$work/repo"

# commit <parent> <author email> <committer email> <message>: prints the new SHA.
commit() {
  git checkout -q --detach "$1"
  GIT_AUTHOR_EMAIL=$2 GIT_COMMITTER_EMAIL=$3 git commit -q --allow-empty -m "$4"
  git rev-parse HEAD
}

failures=0
# expect <name> <exit status> <base> <head> [<text>...]: the output must contain
# each text, or must not contain one written as !text.
expect() {
  local name=$1 want=$2 base=$3 head=$4 output status=0
  shift 4
  output=$("$check" "$base" "$head" 2>&1) || status=$?
  local problems=()
  [[ $status -eq $want ]] || problems+=("exited $status, expected $want")
  [[ $output != *example.com* && $output != *EXAMPLE.COM* ]] || problems+=('printed an address')
  for text in "$@"; do
    if [[ $text == '!'* ]]; then
      [[ $output != *"${text:1}"* ]] || problems+=("printed '${text:1}'")
    else
      [[ $output == *"$text"* ]] || problems+=("missing '$text'")
    fi
  done
  if [[ ${#problems[@]} -eq 0 ]]; then
    echo "ok - $name"
  else
    echo "not ok - $name: ${problems[*]}"
    printf '  %s\n' "$output"
    failures=$((failures + 1))
  fi
}

GIT_AUTHOR_EMAIL=$NOREPLY GIT_COMMITTER_EMAIL=$NOREPLY git commit -q --allow-empty -m 'chore: base'
base=$(git rev-parse HEAD)

good=$(commit "$base" "$NOREPLY" "$NOREPLY" 'feat: noreply author and committer')
expect 'noreply author and committer pass' 0 "$base" "$good" '(1 checked)'

bot=$(commit "$base" '41898282+github-actions[bot]@users.noreply.github.com' noreply@github.com \
  'chore: a bot commit')
expect "a bot's noreply author and GitHub's committer pass" 0 "$base" "$bot"

trailers=$(printf 'feat: x\n\nCo-Authored-By: %s\nCo-authored-by: %s' \
  'Assistant <noreply@anthropic.com>' "Someone <$NOREPLY>")
trailer=$(commit "$base" "$NOREPLY" "$NOREPLY" "$trailers")
expect 'attribution and noreply co-author lines pass' 0 "$base" "$trailer"

versions=$(commit "$base" "$NOREPLY" "$NOREPLY" 'chore: pin @scope/tool@1.2.3 and actions/x@v5.0.0')
expect 'package and action versions in the message pass' 0 "$base" "$versions"

author=$(commit "$base" "$OTHER" "$NOREPLY" 'feat: other author')
expect 'another author email fails' 1 "$base" "$author" "Commit ${author:0:10}: the author email"

committer=$(commit "$base" "$NOREPLY" "$OTHER" 'feat: other committer')
expect 'another committer email fails' 1 "$base" "$committer" \
  "Commit ${committer:0:10}: the committer email"

coauthor=$(commit "$base" "$NOREPLY" "$NOREPLY" "$(printf 'feat: x\n\nCo-authored-by: Someone <%s>' "$OTHER")")
expect 'another co-author email fails' 1 "$base" "$coauthor" "Commit ${coauthor:0:10}: the message"

upper=$(commit "$base" "$NOREPLY" "$NOREPLY" 'feat: thanks SOMEONE@EXAMPLE.COM')
expect 'an upper-case email in the message fails' 1 "$base" "$upper" "Commit ${upper:0:10}: the message"

lookalike=$(commit "$base" "$NOREPLY.example.com" "$NOREPLY" 'feat: lookalike')
expect 'a noreply lookalike fails' 1 "$base" "$lookalike" "Commit ${lookalike:0:10}: the author email"

no_id=$(commit "$base" someone@users.noreply.github.com "$NOREPLY" 'feat: no id')
expect 'a noreply address without the account id fails' 1 "$base" "$no_id" \
  "Commit ${no_id:0:10}: the author email"

printf '%s <%s> <%s>\n' Someone "$NOREPLY" "$OTHER" >.mailmap
expect 'a .mailmap entry does not hide another author' 1 "$base" "$author" \
  "Commit ${author:0:10}: the author email"
rm .mailmap

mixed=$(commit "$author" "$NOREPLY" "$NOREPLY" 'feat: a good commit after a bad one')
expect 'only the failing commit is named' 1 "$base" "$mixed" "Commit ${author:0:10}: the author email" \
  "!${mixed:0:10}"

expect 'an empty range fails' 1 "$base" "$base" 'No commits'
expect 'an unknown commit fails' 2 0000000000000000000000000000000000000000 "$good" 'Unknown base'

if [[ $failures -ne 0 ]]; then
  echo "$failures failed"
  exit 1
fi

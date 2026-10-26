#!/bin/sh
# Refuse to publish secrets or owner-specific data.
#
#   scripts/check-secrets.sh             every file that would be published: tracked files plus untracked files that
#                                        .gitignore does not exclude (works outside a git repository too)
#   scripts/check-secrets.sh --staged    only the files staged for commit
#   scripts/check-secrets.sh FILE...     only these files (even ignored ones)
#
# As a pre-commit hook:  ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit   (it then checks staged files)
#
# Flags: public IPv4 addresses (loopback, 0.0.0.0, private ranges 10.x / 172.16–31.x / 192.168.x and the
# documentation ranges 192.0.2.x, 198.51.100.x, 203.0.113.x are fine), upload tokens (lsj_…), 训记 keys (xjllm_… / xjtpl_…), private keys, real LSJ_TOKEN or "token" values,
# ssh targets like root@host, built Shortcuts (*.shortcut) and owner-only files (CLAUDE.local.md, deploy/.deploy.env,
# deploy/local/). Your own host names and other private words go in deploy/local/secret-patterns (gitignored),
# one extended regex per line. Exit status 1 when anything is found.
set -eu
cd "$(dirname "$0")/.."

OCTET='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
IPV4="(^|[^0-9A-Za-z.])($OCTET\\.){3}$OCTET([^0-9A-Za-z.]|$)"
N='[0-9]{1,3}'
# removed from a matching line before it is checked again: addresses and hosts that are fine to publish
ALLOW="s/(^|[^0-9A-Za-z.])((127|10)\\.$N\\.$N\\.$N|172\\.(1[6-9]|2[0-9]|3[01])\\.$N\\.$N|192\\.168\\.$N\\.$N|(192\\.0\\.2|198\\.51\\.100|203\\.0\\.113)\\.$N)([^0-9A-Za-z.]|$)/\\1\\6/g; s/0\\.0\\.0\\.0//g; s/[A-Za-z0-9._-]*@[A-Za-z0-9.-]*example\\.(com|org|net)//g"
# name<TAB>regex; each regex is written so that this file does not match itself
RULES='upload token	lsj_[A-Za-z0-9_-]{20,}
训记 key	xj(llm|tpl)_[A-Za-z0-9_-]{8,}
private key	-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----
LSJ_TOKEN value	LSJ_TOKEN=[A-Za-z0-9_-]{16,}
token value	"token" *: *"[A-Za-z0-9_-]{16,}"
ssh target	(^|[^A-Za-z0-9._-])root@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
EXTRA=deploy/local/secret-patterns

list_files() {
  if [ "$#" -gt 0 ]; then
    for f in "$@"; do printf '%s\n' "$f"; done
  elif [ "$MODE" = staged ]; then
    git diff --cached --name-only --diff-filter=ACMR
  elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard
  else
    # not a repository yet: a throwaway git dir lets git apply .gitignore exactly as it will after `git init`
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/check-secrets.XXXXXX")
    git init -q --bare "$tmp/g"
    git --git-dir="$tmp/g" --work-tree=. ls-files --others --exclude-standard
    rm -rf "$tmp"
  fi
}

MODE=all
case "${1:-}" in
  --staged) MODE=staged; shift ;;
  -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
esac
[ "$(basename "$0")" = pre-commit ] && MODE=staged

found=0
report() {  # file, line number, rule; the matched text itself is not printed (CI logs are public)
  echo "$1:$2: $3"
  found=1
}

files=$(list_files "$@")
[ -n "$files" ] || exit 0
TAB=$(printf '\t')
NL='
'
OLDIFS=$IFS
IFS=$NL
for f in $files; do
  IFS=$OLDIFS
  [ -f "$f" ] || { IFS=$NL; continue; }
  case "$f" in
    CLAUDE.local.md|*/CLAUDE.local.md|deploy/.deploy.env|deploy/local/*) report "$f" 0 "owner-only file (keep it out of the repository)" ;;
    *.shortcut) report "$f" 0 "built Shortcut (it contains the server address; build it at deploy time)" ;;
  esac
  case "$f" in
    *.woff2|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.shortcut|*.db) IFS=$NL; continue ;;
  esac
  for n in $(grep -nIE "$IPV4" "$f" | sed -E "$ALLOW" | sed -E "$ALLOW" | grep -E "$IPV4" | cut -d: -f1); do
    report "$f" "$n" "IP address"
  done
  printf '%s\n' "$RULES" | while IFS=$TAB read -r name re; do
    grep -nIE -- "$re" "$f" | sed -E "$ALLOW" | grep -E -- "$re" | cut -d: -f1 | while read -r n; do echo "$f:$n: $name"; done
  done | grep . && found=1
  if [ -f "$EXTRA" ]; then
    grep -v '^[[:space:]]*#' "$EXTRA" | grep . | while read -r re; do
      grep -nIE -- "$re" "$f" | cut -d: -f1 | while read -r n; do echo "$f:$n: private pattern from $EXTRA"; done
    done | grep . && found=1
  fi
  IFS=$NL
done
IFS=$OLDIFS

if [ "$found" -ne 0 ]; then
  echo "check-secrets: possible secrets or owner-specific data above. Remove them, or move them to CLAUDE.local.md / deploy/local/." >&2
  exit 1
fi
echo "check-secrets: ok"

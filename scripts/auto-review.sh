#!/bin/bash
# Claude's scheduled processing: runs `/fitness-review auto <user>` for every active account that has something to do
# (records waiting for review, messages, decisions on proposals, a stale daily report, a weekly report due).
# Meant for launchd (deploy/auto-review.plist.example) on the computer that runs Claude Code; see deploy/README.md.
#
# Environment (all optional):
#   LSJ_CLAUDE       the claude binary                (default: ~/.local/bin/claude, then `claude` on PATH)
#   LSJ_AUTO_TIMES   the scheduled times, for the page's 「下次处理」 (default: "15:00 23:30"; keep in step with the plist)
#   LSJ_AUTO_LOGS    log directory                    (default: ~/Library/Logs/lianshiji)
#   LSJ_AUTO_FORCE=1 run Claude even when the precheck finds nothing to do
# Pass usernames as arguments to run only those accounts.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
TIMES=${LSJ_AUTO_TIMES:-"15:00 23:30"}
LOGDIR=${LSJ_AUTO_LOGS:-$HOME/Library/Logs/lianshiji}
CLAUDE=${LSJ_CLAUDE:-$HOME/.local/bin/claude}
[ -x "$CLAUDE" ] || CLAUDE=$(command -v claude || true)
mkdir -p "$LOGDIR"
LOG="$LOGDIR/auto-$(date +%Y-%m-%d).log"
exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') start"

# One run at a time (a run can take a while; launchd may also fire a missed slot on wake).
LOCK="$LOGDIR/.auto-review.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK" || exit 0
  else echo "another run is in progress, skipping"; exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

if [ -z "$CLAUDE" ]; then echo "FAIL claude not found (set LSJ_CLAUDE)"; exit 1; fi
# A long-lived token for unattended runs (`claude setup-token`), kept out of the keychain so a locked Mac doesn't stop it.
TOKEN_FILE=$HOME/.config/lianshiji/claude-oauth-token
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -r "$TOKEN_FILE" ]; then
  CLAUDE_CODE_OAUTH_TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE"); export CLAUDE_CODE_OAUTH_TOKEN
fi

# The next scheduled time, for meta/status.auto.next (shown on the page as 「下次处理约 23:30」).
next_iso() {
  python3 - "$TIMES" <<'PY'
import sys
from datetime import datetime, timedelta
now = datetime.now().astimezone()
cands = []
for t in sys.argv[1].split():
    h, m = map(int, t.split(':'))
    for add in (0, 1):
        d = (now + timedelta(days=add)).replace(hour=h, minute=m, second=0, microsecond=0)
        if d > now + timedelta(minutes=5):
            cands.append(d)
print(min(cands).isoformat(timespec='minutes') if cands else '')
PY
}

# Accounts: the arguments, or every active one.
if [ $# -gt 0 ]; then USERS="$*"
else
  # the network from this Mac to the server drops now and then: try three times before giving up
  for TRY in 1 2 3; do
    USERS=$(bin/lsj users 2>/dev/null | python3 -c 'import json,sys; print(" ".join(u["username"] for u in json.load(sys.stdin) if not u.get("disabled")))' 2>/dev/null) && break
    USERS=""; sleep 30
  done
  [ -n "$USERS" ] || { echo "FAIL cannot list users (server unreachable?)"; exit 1; }
fi

# Is there anything for Claude to do for this account? Prints a reason, or nothing.
precheck() {
  python3 - "$1" <<'PY'
import json, subprocess, sys, time
from datetime import date, timedelta
u = sys.argv[1]
def lsj(*a):
    # exit code 2 is the server or the network (this Mac's link to it drops now and then): try three times
    for k in range(3):
        r = subprocess.run(['bin/lsj', *a, '-u', u], capture_output=True, text=True)
        if r.returncode != 2: break
        time.sleep(20)
    return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else None
p = lsj('pending')
if p is None:   # unreachable: say so, never a silent "nothing to do"
    print('ERROR cannot read pending'); sys.exit(0)
acc = p[0] if isinstance(p, list) and p else p if isinstance(p, dict) else {}
why = []
n = sum(len(acc.get(k) or []) for k in ('meals', 'workouts', 'body'))
if n: why.append(f'{n} records')
if acc.get('messages'): why.append(f'{len(acc["messages"])} messages')
if acc.get('inbox'): why.append(f'{len(acc["inbox"])} decisions')
prof = (acc.get('profile') or {}).get('data') or {}
if prof.get('needsReview'): why.append('profile changed')
pl = acc.get('plan') or {}
pd = pl.get('data') if isinstance(pl.get('data'), dict) else pl
if not pl and prof.get('goal'): why.append('first plan')   # a new friend: their first plan is made now
elif pl and prof.get('goal') and not isinstance((pd.get('diet') or {}).get('kcal'), (int, float)):
    why.append('diet targets (first plan)')   # a plan the person built from a template on the page: Claude fills in the diet
d = lsj('day')
if d:
    today = d.get('date')
    if d.get('reportStale'): why.append(f'report {today}')
    y = lsj('day', (date.fromisoformat(today) - timedelta(days=1)).isoformat()) if today else None
    if y and y.get('reportStale'): why.append(f'report {y.get("date")}')
    if today:
        t = date.fromisoformat(today)
        mon = t - timedelta(days=t.isoweekday() - 1 + 7)  # last full week's Monday
        reps = lsj('list', 'reports', '--order', 'createdAt', '--desc', '--limit', '40') or []
        ids = {r.get('id') for r in reps}
        plans = sorted((r.get('data') or {}).get('date') or '' for r in reps if str(r.get('id', '')).startswith('plan-'))
        if f'weekly-{mon.isoformat()}' not in ids and plans and plans[0] and plans[0] <= mon.isoformat():
            why.append(f'weekly {mon.isoformat()}')
print(', '.join(why))
PY
}

NEXT=$(next_iso)
TIMES_JSON=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1].split()))' "$TIMES")
STATUS=0
for U in $USERS; do
  WHY=$(precheck "$U")
  case "$WHY" in ERROR*) echo "$U: precheck failed ($WHY), skipping this run"; STATUS=1; continue ;; esac
  if [ -z "$WHY" ] && [ "${LSJ_AUTO_FORCE:-0}" != 1 ]; then echo "$U: nothing to do"
  else
    echo "$U: running ($WHY)"
    # A new account (no plan yet) gets its first plan in this run, so plan and profile stay writable; otherwise no plan writes.
    case "$WHY" in *"first plan"*) DENY="" ;; *) DENY=plan,plan_history,profile ;; esac
    OUT=$(LSJ_DENY_COLLECTIONS=$DENY "$CLAUDE" -p "/fitness-review auto $U" \
      --permission-mode dontAsk --no-session-persistence \
      --allowedTools "Bash(bin/lsj *)" "Bash(bin/xunji *)" "Bash(date *)" "Bash(date)" "Bash(ls *)" "Bash(mkdir *)" \
                     "Read" "Glob" "Grep" "Write" "Edit" 2>&1)
    RC=$?
    printf '%s\n' "$OUT" | tail -40
    case "$OUT" in *"Failed to authenticate"*)
      echo "$U: Claude could not sign in from the scheduled job (the login works in a terminal, so most likely the keychain is locked while the Mac is unattended). Fix: run \`claude setup-token\` once and save the token to $HOME/.config/lianshiji/claude-oauth-token (chmod 600); this script passes it as CLAUDE_CODE_OAUTH_TOKEN." ;;
    esac
    LAST=$(printf '%s\n' "$OUT" | grep -E '^(OK|FAIL) ' | tail -1)
    echo "$U: exit $RC, ${LAST:-no result line}"
    case "$LAST" in OK*) ;; *) STATUS=1 ;; esac
  fi
  # Tell the page when the next run is (merge: keeps what the run itself wrote in auto.ok/at).
  if [ -n "$NEXT" ]; then
    printf '{"user": "%s", "ops": [{"op": "merge", "collection": "meta", "id": "status", "data": {"auto": {"next": "%s", "times": %s}}}]}' \
      "$U" "$NEXT" "$TIMES_JSON" | bin/lsj batch - -u "$U" >/dev/null || echo "$U: could not write auto.next"
  fi
done
echo "=== $(date '+%F %T') done (status $STATUS)"
exit $STATUS

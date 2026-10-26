#!/bin/sh
# Push the app code (app/server.py, app/xunji_import.py, app/webpush.py and app/web/) to the server and restart the service.
#   deploy/deploy.sh        deploy
#   deploy/deploy.sh -n     print the target and the remote command, change nothing
# The target comes from the environment or deploy/.deploy.env (gitignored; start from deploy/deploy.env.example).
# Variables already set in the environment win over the file.
#   LSJ_DEPLOY_HOST     ssh target, e.g. root@fitness.example.com   (required)
#   LSJ_DEPLOY_KEY      ssh private key                              (optional; adds -o IdentitiesOnly=yes)
#   LSJ_DEPLOY_DIR      install dir on the server                    (default /opt/lianshiji)
#   LSJ_DEPLOY_SERVICE  systemd unit to restart                      (default lianshiji)
# Only the code is pushed. The systemd unit, nginx config, cron file and env file are installed by hand (deploy/README.md).
set -eu
cd "$(dirname "$0")/.."

DRY=
[ "${1:-}" = -n ] && DRY=1

env_host=${LSJ_DEPLOY_HOST-}; env_key=${LSJ_DEPLOY_KEY-}; env_dir=${LSJ_DEPLOY_DIR-}; env_svc=${LSJ_DEPLOY_SERVICE-}
if [ -f deploy/.deploy.env ]; then
  . ./deploy/.deploy.env
fi
HOST=${env_host:-${LSJ_DEPLOY_HOST:-}}
KEY=${env_key:-${LSJ_DEPLOY_KEY:-}}
DIR=${env_dir:-${LSJ_DEPLOY_DIR:-/opt/lianshiji}}
SVC=${env_svc:-${LSJ_DEPLOY_SERVICE:-lianshiji}}
if [ -z "$HOST" ]; then
  echo "deploy.sh: set LSJ_DEPLOY_HOST in deploy/.deploy.env or the environment (see deploy/deploy.env.example)" >&2
  exit 1
fi
case $KEY in "~/"*) KEY=$HOME/${KEY#??} ;; esac

if [ -n "$KEY" ]; then set -- -i "$KEY" -o IdentitiesOnly=yes; else set --; fi
REMOTE="mkdir -p '$DIR' && tar -C '$DIR' -xzf - && chown -R root:root '$DIR' && chmod -R a+rX '$DIR' && systemctl restart '$SVC' && sleep 1 && systemctl is-active '$SVC'"

if [ -n "$DRY" ]; then
  echo "push app/server.py, app/xunji_import.py, app/webpush.py and app/web/ to $HOST:$DIR, then restart $SVC"
  echo "ssh $* $HOST \"$REMOTE\""
  exit 0
fi
# server.py imports xunji_import.py and webpush.py from its own directory: they always go together
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -C app -czf - server.py xunji_import.py webpush.py web | ssh "$@" "$HOST" "$REMOTE"

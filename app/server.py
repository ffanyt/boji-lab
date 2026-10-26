#!/usr/bin/env python3
"""薄肌研究所 server: serves the page, a per-user JSON document store and photo storage.

Standard library only. Runs behind nginx (TLS) on 127.0.0.1.
Auth: people log in with username + password and get a session cookie; admins manage accounts and make invites, with
which friends sign up themselves (/join, POST /api/join); anyone can close their own account (DELETE /api/me).
Claude's CLI sends a bearer token and names the user it acts for in the X-LSJ-User header.

Config (environment): LSJ_TOKEN (CLI token, required), LSJ_DATA, LSJ_WEB, LSJ_HOST, LSJ_PORT,
LSJ_ADMIN_USER / LSJ_PASSWORD (first admin of an empty database), LSJ_TZ (default Asia/Shanghai),
LSJ_DAY_START_HOUR (default 5: 00:00-04:59 still counts as the day before; each person can pick their own in
profile/prefs), LSJ_COOKIE_SECURE (default 1), LSJ_PUBLIC_URL (optional: the site address invite links use, e.g.
https://fitness.example.com; unset, the Host of the admin's request).
The page's 「从训记同步」 reads the person's last days from 训记 (app/xunji_import.py, next to this file) with the training
key they saved, and 「写进训记」 (accepting a template proposal) sends Claude's prepared Agent template change with their
template key (table xunji_keys). Those, and checking a key when it is saved, are the only outbound connections the server
makes, and only when someone presses a button.
Decisions on Claude's proposals (POST /api/inbox/<id>/accept|decline) and undoing what Claude changed
(POST /api/log/<id>/undo) are for the person on the page only: the CLI token can't decide for them.
Web Push (/api/push/…): the server wakes a person's subscribed devices with empty pushes signed with VAPID (app/webpush.py,
next to this file; key pair in LSJ_DATA/vapid.json) and the service worker fetches the message from /api/push/next.
Those pushes are the other outbound connections; the sender is LSJ_PUSH_CONTACT (default mailto:noreply@lianshiji.invalid).
"""
import bisect
import contextlib
import copy
import email.utils
import getpass
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import shutil
import socket
import sqlite3
import sys
import threading
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import xunji_import as xj  # noqa: E402  (app/xunji_import.py: the 训记 mapping, shared with bin/xunji)
import webpush  # noqa: E402  (app/webpush.py: VAPID signing and the empty push request)

DATA = os.environ.get('LSJ_DATA', '/var/lib/lianshiji')
WEB = os.environ.get('LSJ_WEB', os.path.join(HERE, 'web'))
TOKEN = os.environ['LSJ_TOKEN']
BOOT_ADMIN = os.environ.get('LSJ_ADMIN_USER', 'admin')
BOOT_PASSWORD = os.environ.get('LSJ_PASSWORD')  # only used to create the first admin
HOST = os.environ.get('LSJ_HOST', '127.0.0.1')
PORT = int(os.environ.get('LSJ_PORT', '8780'))
# The session cookie is marked Secure (HTTPS only). Set LSJ_COOKIE_SECURE=0 to log in over plain http when testing locally.
COOKIE_SECURE = os.environ.get('LSJ_COOKIE_SECURE', '1').strip().lower() not in ('0', 'false', 'no', 'off')
TZ_NAME = os.environ.get('LSJ_TZ', 'Asia/Shanghai')


def env_hour(name, default):
    raw = os.environ.get(name, str(default)).strip()
    if not re.fullmatch(r'[0-9]{1,2}', raw) or int(raw) > 23:
        raise SystemExit(f'{name} must be an hour 0-23, got {raw!r}')
    return int(raw)


DAY_START_HOUR = env_hour('LSJ_DAY_START_HOUR', 5)  # for night owls: with 5, a day runs 05:00 → 04:59


def load_tz(name):
    """The configured time zone; a fixed +08:00 when this Python has no tz database for it."""
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception as e:  # ImportError, ZoneInfoNotFoundError, ValueError for odd names
        print(f'LSJ_TZ={name!r} not available ({e.__class__.__name__}): using a fixed +08:00', file=sys.stderr, flush=True)
        return timezone(timedelta(hours=8), '+08:00')


LOCAL_TZ = load_tz(TZ_NAME)

COLLECTIONS = {'meals', 'workouts', 'body', 'water', 'sleep', 'days', 'health', 'reports', 'plan', 'plan_history', 'profile', 'meta',
               'todos', 'inbox', 'messages', 'log', 'progress'}
ID_RE = re.compile(r'[A-Za-z0-9_\-.~:@+]{1,200}')  # used with fullmatch
PHOTO_RE = re.compile(r'[0-9a-f]{32}')
USERNAME_RE = re.compile(r'[a-z0-9_.-]{2,32}')
FONT_RE = re.compile(r'/fonts/[\w\-.]+\.woff2')
IMAGE_RE = re.compile(r'/(icons|splash)/[A-Za-z0-9_-]{1,80}\.(png|svg)')  # home-screen icons and iOS launch screens
IMAGE_TYPES = {'png': 'image/png', 'svg': 'image/svg+xml'}
ASSET_RE = re.compile(r'/([A-Za-z0-9_-]{1,64})\.(js|css)')  # the page's scripts and styles (app.js, app.css, login.js …)
ASSET_TYPES = {'js': 'text/javascript; charset=utf-8', 'css': 'text/css; charset=utf-8'}
PHOTO_TYPES = {  # magic prefix -> (content type, extension)
    b'\xff\xd8\xff': ('image/jpeg', 'jpg'),
    b'\x89PNG\r\n\x1a\n': ('image/png', 'png'),
    b'GIF8': ('image/gif', 'gif'),
}
EXT_TYPES = {'jpg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
MAX_PHOTO = 20 * 1024 * 1024    # one uploaded photo
MAX_JSON = 1024 * 1024          # one JSON request body
MAX_LOGIN_BODY = 4 * 1024       # login and password-change bodies
MAX_DOC = 256 * 1024            # one stored document
MAX_BATCH = 200                 # writes in one batch
MAX_DEPTH = 32                  # nesting of objects and arrays in a request body
MAX_TOKENS = 10                 # upload tokens per person
NIGHT_GAP = timedelta(hours=3)  # sleep samples closer than this belong to the same night
LOGIN_WINDOW = 600              # seconds that a failed password attempt counts against the limits below
LOGIN_MAX_PAIR = 5              # … per (username, IP)
LOGIN_MAX_USER = 30             # … per username from all IPs (looser, so one attacker can't lock the owner out)
LOGIN_MAX_IP = 20               # … per IP across all usernames
LOGIN_FAIL_DELAY = 0.5          # seconds a wrong password waits before answering
XUNJI_KEY_RE = re.compile(r'[!-~]{8,200}')  # a 训记 key: printable ASCII, no spaces
XUNJI_EVERY = 60                # seconds between two web syncs of one person
XUNJI_TIMEOUT = 10              # seconds for one 训记 request during a web sync …
XUNJI_BUDGET = 30               # … and for the whole sync
XUNJI_MAX_WAIT = 5              # when 训记 says "too frequent", wait and retry only if it asks for at most this many seconds
XUNJI_DAYS = 3                  # a web sync reads the person's today and the two days before
XUNJI_PAUSE = 0.3               # seconds between 训记 requests
XUNJI_KINDS = ('train', 'template')  # the two 训记 keys: training (read-only, sync) and Agent template (「写进训记」)
XUNJI_TPL_EVERY = 10            # seconds between two 「写进训记」 of one person
XUNJI_RESPONSE_MAX = 4096       # characters of 训记's answer kept in inbox result.response
PLAN_ROOTS = ('diet', 'training', 'phase', 'summary', 'notes')  # where a proposal or an undo may change plan/current
PUSH_KINDS = ('report', 'proposal', 'reply', 'remind')  # profile/prefs.push[kind] false turns one kind off
PUSH_CONTACT = os.environ.get('LSJ_PUSH_CONTACT', 'mailto:noreply@lianshiji.invalid').strip()  # VAPID "sub"
PUSH_MAX_SUBS = 5               # subscribed devices per person (a new one replaces the oldest)
PUSH_PER_MINUTE = 6             # messages per person per minute
PUSH_KEEP = 50                  # messages kept per person in push_queue
PUSH_TITLE_MAX, PUSH_BODY_MAX, PUSH_URL_MAX = 40, 120, 200
PUSH_TIMEOUT = 5                # seconds for one request to a push service …
PUSH_WAIT = 7                   # … and for all of one send, which go out in parallel
PUSH_TTL = 86400                # the push service keeps an undelivered push this long; so does /api/push/next
PUSH_AGAIN = 120                # seconds a delivered message is still handed out (another device woken by the same push)
PUSH_LATER_MIN, PUSH_LATER_MAX = 10, 900   # seconds a delayed reminder (POST /api/push/later: the rest timer) may wait
PUSH_LATER_BODY_MAX = 80        # its body is shorter than a sent message's
PUSH_LATER_PER_MINUTE = 10      # delayed reminders a person may schedule per minute
# Push services we send to (host or a subdomain of it): Chrome / Edge / Opera (FCM), Firefox, Safari and iOS, Windows.
# Only these, so a subscription can't make the server POST to an arbitrary address.
PUSH_HOSTS = ('fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com')
INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no 0/O or 1/I: easy to read out and type; case doesn't matter
INVITE_LEN = 12                 # shown as XXXX-XXXX-XXXX
INVITE_MAX_USES = 50            # accounts one invite can make
INVITE_MAX_DAYS = 90            # how long it can stay valid (default INVITE_DAYS)
INVITE_DAYS = 14
INVITE_NOTE_MAX = 40
INVITE_LIST_MAX = 200           # invites listed for the admin, newest first
INVALID_INVITE = '邀请码不对或已失效'   # the one answer for a code that is wrong, used up, expired or revoked
JOIN_WINDOW, JOIN_MAX_FAILS = 600, 10   # failed sign-ups (wrong codes and the rest) per address in 10 minutes
JOIN_HOUR, JOIN_MAX_DONE = 3600, 5      # accounts made from one address per hour
# The address invite links point to. Unset: the Host the admin's browser used (https unless LSJ_COOKIE_SECURE=0).
PUBLIC_URL = os.environ.get('LSJ_PUBLIC_URL', '').strip().rstrip('/')
COOKIE = 'lsj'
SESSION_DAYS = 365
PBKDF2_ROUNDS = 200_000
STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/login': ('login.html', 'text/html; charset=utf-8'),
    '/join': ('login.html', 'text/html; charset=utf-8'),      # the same page: login.js shows the sign-up form there
    '/privacy': ('privacy.html', 'text/html; charset=utf-8'),  # 你的数据怎么处理: no login needed
    '/manifest.webmanifest': ('manifest.webmanifest', 'application/manifest+json'),
    '/icon.svg': ('icon.svg', 'image/svg+xml'),
    '/icon-180.png': ('icon-180.png', 'image/png'),
}
PUBLIC_POSTS = (['login'], ['join'], ['join', 'check'])  # writes without a login: still same-origin JSON only
# Scripts only from our own files (no inline scripts or handlers); style attributes are still allowed.
CSP = ("default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; "
       "script-src 'self'; connect-src 'self'; font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'")

write_lock = threading.Lock()
_local = threading.local()


def iso_utc(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def now_iso():
    return iso_utc(datetime.now(timezone.utc))


def day_of(dt, start=None):
    """The day a moment belongs to: local date, with 00:00 to the day start (DAY_START_HOUR unless given) still counting
    as the day before."""
    return (dt.astimezone(LOCAL_TZ) - timedelta(hours=DAY_START_HOUR if start is None else start)).date().isoformat()


def today(start=None):
    return day_of(datetime.now(timezone.utc), start)


def month_day(day):
    return f'{int(day[5:7])}/{int(day[8:10])}'


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


# ---------------------------------------------------------------- JSON

def _refuse_constant(name):
    raise ValueError(f'{name} is not valid JSON')


def loads_request(text):
    """JSON from a client. NaN and Infinity are refused: stored, they would break every reader. So are nesting deeper
    than MAX_DEPTH (merging and storing it could run out of stack) and text that isn't valid Unicode ("\ud800")."""
    obj = json.loads(text, parse_constant=_refuse_constant)
    stack = [(obj, 1)]
    while stack:
        o, depth = stack.pop()
        if isinstance(o, str):
            o.encode('utf-8')  # a lone surrogate raises UnicodeEncodeError, a ValueError
        elif isinstance(o, (dict, list)):
            if depth > MAX_DEPTH:
                raise ValueError(f'nested deeper than {MAX_DEPTH} levels')
            stack.extend((v, depth + 1) for v in ([*o, *o.values()] if isinstance(o, dict) else o))
    return obj


def loads_stored(text):
    """JSON from the database. Documents stored before NaN was refused read it back as null."""
    return json.loads(text, parse_constant=lambda name: None)


def dumps(obj, **kw):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, **kw)


def conn():
    c = getattr(_local, 'c', None)
    if c is None:
        c = sqlite3.connect(os.path.join(DATA, 'data.db'), timeout=10, isolation_level=None)
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('PRAGMA busy_timeout=5000')
        _local.c = c
    return c


# ---------------------------------------------------------------- passwords & ids

def hash_password(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8', 'surrogatepass'), salt, PBKDF2_ROUNDS)
    return f'pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}'


def check_password(pw, stored):
    try:
        _, rounds, salt, dk = stored.split('$')
        got = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8', 'surrogatepass'), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(got.hex(), dk)
    except (ValueError, AttributeError):
        return False


# Checked against when the username doesn't exist, so a wrong username takes as long as a wrong password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def temp_password():
    a = 'abcdefghjkmnpqrstuvwxyz23456789'
    return '-'.join(''.join(secrets.choice(a) for _ in range(4)) for _ in range(3))


def new_uid():
    return 'u' + secrets.token_hex(8)


def as_bytes(s):
    return s.encode('utf-8', 'surrogatepass')


def token_hash(tok):
    return hashlib.sha256(as_bytes(tok)).hexdigest()


class AttemptLimiter:
    """Failed password attempts in a sliding window: per (username, IP), per username and per IP. Thread-safe.
    An attempt is recorded before the password is checked, so parallel guesses can't all slip past the limit,
    and taken back when the password was right."""

    def __init__(self, window, per_pair, per_user, per_ip):
        self.window, self.per_pair, self.per_user, self.per_ip = window, per_pair, per_user, per_ip
        self.lock = threading.Lock()
        self.hits = {}  # key -> [times]
        self.pruned = 0.0

    def clear(self):
        with self.lock:
            self.hits.clear()

    def _prune(self, cutoff):
        for k in [k for k, ts in self.hits.items() if not ts or ts[-1] <= cutoff]:
            del self.hits[k]

    def attempt(self, user, ip):
        """Records an attempt and returns a handle for succeeded(), or None when a limit is reached (don't check the password)."""
        now = time.time()
        cutoff = now - self.window
        keys = ((('pair', user, ip), self.per_pair), (('user', user), self.per_user), (('ip', ip), self.per_ip))
        with self.lock:
            if now - self.pruned > 60:
                self._prune(cutoff)
                self.pruned = now
            recent = {}
            for k, cap in keys:
                recent[k] = [t for t in self.hits.get(k, ()) if t > cutoff]
                if len(recent[k]) >= cap:
                    return None
            for k, _ in keys:
                self.hits[k] = recent[k] + [now]
            return user, ip, now

    def succeeded(self, handle):
        user, ip, t = handle
        with self.lock:
            self.hits.pop(('pair', user, ip), None)  # the owner got in from here: forget their typos
            for k in (('user', user), ('ip', ip)):
                ts = self.hits.get(k)
                if ts and t in ts:
                    ts.remove(t)


PASSWORD_LIMIT = AttemptLimiter(LOGIN_WINDOW, LOGIN_MAX_PAIR, LOGIN_MAX_USER, LOGIN_MAX_IP)


class WindowLimit:
    """At most `cap` events per key in a sliding window of `window` seconds. Thread-safe. take() records the event up
    front, so parallel requests can't all slip past the cap, and returns a handle for give_back() (the event didn't count
    after all), or None when the cap is reached."""

    def __init__(self, window, cap):
        self.window, self.cap = window, cap
        self.lock = threading.Lock()
        self.hits = {}  # key -> [times]
        self.pruned = 0.0

    def clear(self):
        with self.lock:
            self.hits.clear()

    def wait(self, key):
        """Whole seconds until take(key) can succeed again (0: now)."""
        now = time.time()
        with self.lock:
            ts = [t for t in self.hits.get(key, ()) if t > now - self.window]
            return 0 if len(ts) < self.cap else max(1, math.ceil(ts[len(ts) - self.cap] + self.window - now))

    def take(self, key):
        now = time.time()
        cutoff = now - self.window
        with self.lock:
            if now - self.pruned > 60:
                for k in [k for k, ts in self.hits.items() if not ts or ts[-1] <= cutoff]:
                    del self.hits[k]
                self.pruned = now
            ts = [t for t in self.hits.get(key, ()) if t > cutoff]
            self.hits[key] = ts
            if len(ts) >= self.cap:
                return None
            ts.append(now)
            return key, now

    def give_back(self, handle):
        key, t = handle
        with self.lock:
            ts = self.hits.get(key)
            if ts and t in ts:
                ts.remove(t)


JOIN_FAILS = WindowLimit(JOIN_WINDOW, JOIN_MAX_FAILS)   # /api/join and /api/join/check that didn't go through
JOIN_DONE = WindowLimit(JOIN_HOUR, JOIN_MAX_DONE)       # accounts made with an invite


def is_loopback(addr):
    try:
        ip = ipaddress.ip_address(str(addr).split('%', 1)[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_loopback


# ---------------------------------------------------------------- schema & migration

ACCOUNT_TABLES = ('tokens', 'xunji_keys', 'push_subs', 'push_queue')  # removed when an account is disabled or deleted


def init_db():
    os.makedirs(os.path.join(DATA, 'photos'), exist_ok=True)
    c = conn()
    cols = [r[1] for r in c.execute("PRAGMA table_info(docs)").fetchall()]
    legacy = bool(cols) and 'uid' not in cols
    if legacy:  # single-user layout from the first version: keep a copy before touching it
        os.makedirs(os.path.join(DATA, 'backups'), exist_ok=True)
        dst = sqlite3.connect(os.path.join(DATA, 'backups', f'pre-multiuser-{int(time.time())}.db'))
        c.backup(dst)
        dst.close()
        c.execute('ALTER TABLE docs RENAME TO docs_v1')
    c.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,'
              ' role TEXT NOT NULL, pw_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0,'
              ' disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_seen TEXT)')
    if 'invite_id' not in [r[1] for r in c.execute('PRAGMA table_info(users)').fetchall()]:
        c.execute('ALTER TABLE users ADD COLUMN invite_id TEXT')  # the invite an account signed up with (NULL: made by an admin)
    c.execute('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, uid TEXT NOT NULL, created_at TEXT NOT NULL,'
              ' expires_at INTEGER NOT NULL, last_seen TEXT, ua TEXT)')
    # Invites (POST /api/admin/invites): the code is shown once when it is made; only its hash is kept, like upload tokens.
    # Times are ISO UTC strings like everywhere else (now_iso()), so they compare as text.
    c.execute('CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, code_hash TEXT UNIQUE NOT NULL, note TEXT NOT NULL,'
              ' max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL, created_by TEXT,'
              ' created_at TEXT NOT NULL, revoked_at TEXT)')
    c.execute('CREATE TABLE IF NOT EXISTS docs (uid TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,'
              ' version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (uid, col, id))')
    c.execute('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)')
    # Upload-only tokens a person creates for their phone (e.g. an iOS Shortcut sending Apple Health sleep).
    c.execute('CREATE TABLE IF NOT EXISTS tokens (token_hash TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL,'
              ' scope TEXT NOT NULL, created_at TEXT NOT NULL, last_used TEXT)')
    # The 训记 keys a person saved: kind "train" (read-only, the page's 「从训记同步」) and "template" (the Agent template
    # folder, 「写进训记」). Never returned, logged or exported.
    migrate_xunji_keys(c)
    c.execute('CREATE TABLE IF NOT EXISTS xunji_keys (uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,'
              ' kind TEXT NOT NULL, key TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (uid, kind))')
    # Web Push: the devices a person subscribed (an endpoint belongs to one account at a time) and the messages their
    # service worker fetches (GET /api/push/next). sent: how many devices took the push, NULL while sending.
    c.execute('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, uid TEXT NOT NULL, p256dh TEXT NOT NULL,'
              ' auth TEXT NOT NULL, ua TEXT, created_at TEXT NOT NULL)')
    c.execute('CREATE INDEX IF NOT EXISTS push_subs_uid ON push_subs (uid)')
    c.execute('CREATE TABLE IF NOT EXISTS push_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, at TEXT NOT NULL,'
              ' kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, delivered_at TEXT, sent INTEGER)')
    c.execute('CREATE INDEX IF NOT EXISTS push_queue_uid ON push_queue (uid, at)')
    # upload tokens, 训记 keys and push subscriptions end with the account: disabling deletes them (this also clears ones
    # left from before that rule)
    for table in ACCOUNT_TABLES:
        c.execute(f'DELETE FROM {table} WHERE uid NOT IN (SELECT id FROM users WHERE disabled=0)')  # noqa: S608 (fixed names)
    if c.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0:
        if not BOOT_PASSWORD:
            raise SystemExit('no users yet: set LSJ_PASSWORD (and optionally LSJ_ADMIN_USER) to create the first admin')
        c.execute('INSERT INTO users (id, username, name, role, pw_hash, created_at) VALUES (?,?,?,?,?,?)',
                  (new_uid(), BOOT_ADMIN, BOOT_ADMIN, 'admin', hash_password(BOOT_PASSWORD), now_iso()))
        print(f'created admin account "{BOOT_ADMIN}"', flush=True)
    if legacy:
        admin = c.execute("SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").fetchone()[0]
        c.execute('INSERT INTO docs (uid, col, id, data, version, updated_at) SELECT ?, col, id, data, version, updated_at FROM docs_v1', (admin,))
        c.execute('DROP TABLE docs_v1')
        c.execute("DELETE FROM kv WHERE k='rev'")
        pdir = os.path.join(DATA, 'photos')
        os.makedirs(os.path.join(pdir, admin), exist_ok=True)
        for name in os.listdir(pdir):
            if os.path.isfile(os.path.join(pdir, name)):
                os.replace(os.path.join(pdir, name), os.path.join(pdir, admin, name))
        print(f'migrated single-user data to {admin}', flush=True)
    # meta/xunji.keys tells the page which keys are stored: bring it in line (after a migration or keys cleared above)
    for (uid,) in c.execute("SELECT DISTINCT uid FROM xunji_keys UNION SELECT uid FROM docs WHERE col='meta' AND id='xunji'").fetchall():
        refresh_key_flags(uid)


def migrate_xunji_keys(c):
    """The first xunji_keys held one training key per person (uid, train_key, updated_at): move those rows over to the
    (uid, kind, key, updated_at) layout as kind "train", in one transaction."""
    cols = [r[1] for r in c.execute('PRAGMA table_info(xunji_keys)').fetchall()]
    if 'train_key' not in cols:
        return
    try:
        c.execute('BEGIN IMMEDIATE')
        c.execute('ALTER TABLE xunji_keys RENAME TO xunji_keys_v1')
        c.execute('CREATE TABLE xunji_keys (uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,'
                  ' kind TEXT NOT NULL, key TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (uid, kind))')
        n = c.execute("INSERT INTO xunji_keys (uid, kind, key, updated_at) SELECT uid, 'train', train_key, updated_at "
                      "FROM xunji_keys_v1").rowcount
        c.execute('DROP TABLE xunji_keys_v1')
        c.execute('COMMIT')
    except Exception:
        if c.in_transaction:
            c.execute('ROLLBACK')
        raise
    print(f'xunji_keys: {n} training key(s) moved to the two-kind layout', flush=True)


class ApiError(Exception):
    def __init__(self, status, code, message, extra=None, zh=None):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra or {}
        self.zh = zh  # Chinese text for the Shortcut's notification (ingest routes only)


# ---------------------------------------------------------------- documents

def check_path(col, doc_id=None, need_id=False):
    if not isinstance(col, str):
        raise ApiError(400, 'invalid_argument', 'collection must be a string')
    if col not in COLLECTIONS:
        raise ApiError(404, 'not_found', 'unknown collection')
    if doc_id is None and not need_id:
        return
    if not isinstance(doc_id, str) or not ID_RE.fullmatch(doc_id):
        raise ApiError(400, 'invalid_argument', 'bad document id')


def parse_version(v, what='ifVersion'):
    """None, or the version a write expects (0 = must not exist yet): a non-negative whole number, not true/false or 2.9."""
    if v is None:
        return None
    if isinstance(v, int) and not isinstance(v, bool) and v >= 0:
        return v
    if isinstance(v, str) and re.fullmatch(r'"?[0-9]{1,15}"?', v.strip()):
        return int(v.strip().strip('"'))
    raise ApiError(400, 'invalid_argument', f'{what} must be a version number (0 = only create)')


def row_out(col, row):
    doc_id, data, version, updated_at = row
    return {'collection': col, 'id': doc_id, 'version': version, 'updatedAt': updated_at, 'data': loads_stored(data)}


def get_doc(c, uid, col, doc_id):
    r = c.execute('SELECT id, data, version, updated_at FROM docs WHERE uid=? AND col=? AND id=?', (uid, col, doc_id)).fetchone()
    return row_out(col, r) if r else None


def doc_data(c, uid, col, doc_id):
    """The stored data of a document, {} when there is none."""
    d = get_doc(c, uid, col, doc_id)
    return d['data'] if d and isinstance(d['data'], dict) else {}


def prefs_of(c, uid):
    """profile/prefs: the person's settings from the page. Written by the page, so read every field defensively."""
    return doc_data(c, uid, 'profile', 'prefs')


def day_start_of(c, uid):
    """The hour this person's day starts: profile/prefs.dayStartHour (0-12), else DAY_START_HOUR."""
    h = prefs_of(c, uid).get('dayStartHour')
    return int(h) if is_num(h) and h == int(h) and 0 <= h <= 12 else DAY_START_HOUR


def notify_on(prefs, what):
    """Whether a reminder (plan, weigh, water) goes into the Shortcut's notification: on unless notify[what] is false."""
    n = prefs.get('notify')
    return not (isinstance(n, dict) and n.get(what) is False)


def is_delete(v):
    return isinstance(v, dict) and len(v) == 1 and v.get('__delete__') is True


def strip_deletes(obj):
    """An object written where nothing exists yet: {"__delete__": true} markers have nothing to delete, so drop them."""
    return {k: strip_deletes(v) if isinstance(v, dict) else v for k, v in obj.items() if not is_delete(v)}


def deep_merge(base, patch):
    out = dict(base)
    for k, v in patch.items():
        if is_delete(v):
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        elif isinstance(v, dict):
            out[k] = strip_deletes(v)
        else:
            out[k] = v
    return out


WRITE_OPS = ('set', 'update', 'merge', 'delete')


def apply_write(c, uid, op, col, doc_id, data=None, if_version=None):
    """One write inside an open transaction. Returns the new doc (or None for delete)."""
    if not isinstance(op, str) or op not in WRITE_OPS:
        raise ApiError(400, 'invalid_argument', 'op must be set, update, merge or delete')
    check_path(col, doc_id, need_id=True)
    want = parse_version(if_version)
    cur = get_doc(c, uid, col, doc_id)
    if want is not None and (cur['version'] if cur else 0) != want:
        raise ApiError(409, 'conflict', 'document changed', {'collection': col, 'id': doc_id,
                                                            'version': cur['version'] if cur else None})
    if op == 'delete':
        c.execute('DELETE FROM docs WHERE uid=? AND col=? AND id=?', (uid, col, doc_id))
        return None
    if not isinstance(data, dict):
        raise ApiError(400, 'invalid_argument', 'document body must be a JSON object')
    if op == 'update':
        if cur is None:
            raise ApiError(404, 'not_found', 'update needs an existing document')
        data = deep_merge(cur['data'], data)
    elif op == 'merge' and cur:  # update if it exists, otherwise create
        data = deep_merge(cur['data'], data)
    else:  # set, or merge creating the document
        data = strip_deletes(data)
    body = dumps(data, separators=(',', ':'))
    if len(body.encode()) > MAX_DOC:
        raise ApiError(413, 'too_large', f'document over {MAX_DOC // 1024} KiB')
    version = (cur['version'] + 1) if cur else 1
    ts = now_iso()
    c.execute('INSERT INTO docs (uid, col, id, data, version, updated_at) VALUES (?,?,?,?,?,?) '
              'ON CONFLICT(uid, col, id) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at',
              (uid, col, doc_id, body, version, ts))
    return {'collection': col, 'id': doc_id, 'version': version, 'updatedAt': ts, 'data': data}


def bump_rev(c, uid):
    c.execute("INSERT INTO kv (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1", ('rev:' + uid,))


def run_writes(uid, ops):
    """Apply writes all together or not at all. `ops` is a list of {op, collection, id, data, ifVersion}, or a
    function(c) returning one: it runs inside the transaction, so what it reads can't change before the writes land."""
    with write_lock:
        c = conn()
        try:
            c.execute('BEGIN IMMEDIATE')
            if callable(ops):
                ops = ops(c)
            out = []
            for i, o in enumerate(ops):
                if not isinstance(o, dict):
                    raise ApiError(400, 'invalid_argument', f'write {i + 1} is not an object', {'index': i})
                try:
                    out.append(apply_write(c, uid, o.get('op'), o.get('collection'), o.get('id'), o.get('data'), o.get('ifVersion')))
                except ApiError as e:
                    e.extra.setdefault('index', i)
                    raise
            if out:
                bump_rev(c, uid)
            c.execute('COMMIT')
            return out
        except Exception:
            if c.in_transaction:  # BEGIN itself may have failed: don't hide that error behind "no transaction is active"
                c.execute('ROLLBACK')
            raise


OPS = {
    'eq': lambda a, b: a == b, 'ne': lambda a, b: a != b,
    'lt': lambda a, b: a is not None and a < b, 'lte': lambda a, b: a is not None and a <= b,
    'gt': lambda a, b: a is not None and a > b, 'gte': lambda a, b: a is not None and a >= b,
}


def order_key(v):
    """Sort key for ?order=: booleans, then numbers (ints and floats together), then text."""
    if isinstance(v, bool):
        return (0, v)
    if is_num(v):
        return (1, v)
    if isinstance(v, str):
        return (2, v)
    raise ApiError(400, 'invalid_argument', 'order needs a field that holds numbers, text or true/false')


def list_docs(uid, col, qs):
    check_path(col)
    try:
        limit = int((qs.get('limit') or ['1000'])[0])
    except ValueError:
        raise ApiError(400, 'invalid_argument', 'limit must be a whole number')
    rows = conn().execute('SELECT id, data, version, updated_at FROM docs WHERE uid=? AND col=?', (uid, col)).fetchall()
    docs = [row_out(col, r) for r in rows]
    for w in qs.get('where', []):
        try:
            field, op, raw = w.split(':', 2)
            value = loads_request(raw)
            fn = OPS[op]
        except (ValueError, KeyError, RecursionError):
            raise ApiError(400, 'invalid_argument', 'where must be field:op:json, op in ' + ','.join(OPS))
        kept = []
        for d in docs:
            try:
                if fn(d['data'].get(field), value):
                    kept.append(d)
            except TypeError:
                pass
        docs = kept
    order = (qs.get('order') or [None])[0]
    desc = (qs.get('dir') or ['asc'])[0] == 'desc'
    if order:
        have = [d for d in docs if d['data'].get(order) is not None]
        missing = [d for d in docs if d['data'].get(order) is None]
        have.sort(key=lambda d: order_key(d['data'][order]), reverse=desc)
        docs = have + missing
    else:
        docs.sort(key=lambda d: d['id'])
    return docs[:max(1, min(limit, 5000))]


def rev(uid):
    r = conn().execute('SELECT v FROM kv WHERE k=?', ('rev:' + uid,)).fetchone()
    return r[0] if r else 0


def photo_dir(uid):
    return os.path.join(DATA, 'photos', uid)


def photo_path(uid, pid):
    for ext in EXT_TYPES:
        p = os.path.join(photo_dir(uid), f'{pid}.{ext}')
        if os.path.exists(p):
            return p, EXT_TYPES[ext]
    return None, None


# ---------------------------------------------------------------- users

def user_out(r, stats=False):
    out = {'id': r['id'], 'username': r['username'], 'name': r['name'], 'role': r['role'],
           'mustChange': bool(r['must_change']), 'disabled': bool(r['disabled']),
           'createdAt': r['created_at'], 'lastSeen': r['last_seen']}
    if stats:
        c = conn()
        out['records'] = c.execute("SELECT COUNT(*) FROM docs WHERE uid=? AND col IN ('meals','workouts')", (r['id'],)).fetchone()[0]
        out['pending'] = c.execute("SELECT COUNT(*) FROM docs WHERE uid=? AND col IN ('meals','workouts','body','progress') "
                                   "AND json_extract(data, '$.needsReview') = 1", (r['id'],)).fetchone()[0]
        out['dayStartHour'], out['tz'] = day_start_of(c, r['id']), TZ_NAME  # what bin/lsj and bin/xunji compute dates with
    return out


def me_out(r):
    """/api/me: the account plus the settings the page computes dates with (dayStartHour is this person's)."""
    return {**user_out(r), 'config': {'tz': TZ_NAME, 'dayStartHour': day_start_of(conn(), r['id']), 'dayStartDefault': DAY_START_HOUR}}


def _user_row(sql, args):
    c = conn()
    c.row_factory = sqlite3.Row
    try:
        return c.execute(sql, args).fetchone()
    finally:
        c.row_factory = None


def user_by_id(uid):
    return _user_row('SELECT * FROM users WHERE id=?', (uid,))


def user_by_name(username):
    return _user_row('SELECT * FROM users WHERE username=?', (username,))


def find_user(key):
    """By internal id or by username (the CLI and the admin page name people by id)."""
    return user_by_id(key) or user_by_name(key)


def all_users():
    c = conn()
    c.row_factory = sqlite3.Row
    try:
        return c.execute('SELECT * FROM users ORDER BY created_at').fetchall()
    finally:
        c.row_factory = None


def active_admins(exclude=None):
    return conn().execute("SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0 AND id != ?", (exclude or '',)).fetchone()[0]


def new_session(uid, ua):
    tok = secrets.token_urlsafe(32)
    with write_lock:
        conn().execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',
                       (token_hash(tok), uid, now_iso(), int(time.time()) + SESSION_DAYS * 86400, now_iso(), (ua or '')[:200]))
    return tok


def session_cookie(tok, max_age=SESSION_DAYS * 86400):
    secure = '; Secure' if COOKIE_SECURE else ''
    return f'{COOKIE}={tok}; Max-Age={max_age}; Path=/; HttpOnly{secure}; SameSite=Lax'


def delete_account(uid, keep_an_admin=False):
    """Remove an account and everything of it: records, sessions, upload tokens, 训记 keys, push subscriptions and queued
    messages, then its photo directory. keep_an_admin: refuse (409 last_admin) when it is the last active admin, checked
    inside the same transaction."""
    with transaction() as c:
        if keep_an_admin:
            role = c.execute('SELECT role FROM users WHERE id=?', (uid,)).fetchone()
            if role and role[0] == 'admin' and active_admins(exclude=uid) == 0:
                raise ApiError(409, 'last_admin', '你是最后一个管理员，不能注销：先把管理员交给别人')
        c.execute('DELETE FROM docs WHERE uid=?', (uid,))
        c.execute('DELETE FROM sessions WHERE uid=?', (uid,))
        for table in ACCOUNT_TABLES:
            c.execute(f'DELETE FROM {table} WHERE uid=?', (uid,))  # noqa: S608 (fixed names)
        c.execute('DELETE FROM kv WHERE k=?', ('rev:' + uid,))
        c.execute('DELETE FROM users WHERE id=?', (uid,))
    cancel_later(uid)
    shutil.rmtree(photo_dir(uid), ignore_errors=True)


# ---------------------------------------------------------------- invites (sign-up with a code from an admin)

def new_invite_code():
    """12 characters from INVITE_ALPHABET, as XXXX-XXXX-XXXX (about 60 bits)."""
    raw = ''.join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LEN))
    return '-'.join(raw[i:i + 4] for i in range(0, INVITE_LEN, 4))


def invite_code_hash(code):
    """The stored hash of a code as someone typed it (any case, with or without dashes and spaces); None when it can't be
    a code at all."""
    if not isinstance(code, str) or len(code) > 64:
        return None
    raw = re.sub(r'[\s\-_]', '', code).upper()
    if len(raw) != INVITE_LEN or any(ch not in INVITE_ALPHABET for ch in raw):
        return None
    return token_hash(raw)


INVITE_COLS = 'id, note, max_uses, uses, expires_at, created_by, created_at, revoked_at'


def invite_row(r):
    return dict(zip(('id', 'note', 'max_uses', 'uses', 'expires_at', 'created_by', 'created_at', 'revoked_at'), r))


def invite_status(inv, now=None):
    """active, or why it can't be used any more: revoked, used (up), expired."""
    if inv['revoked_at']:
        return 'revoked'
    if inv['uses'] >= inv['max_uses']:
        return 'used'
    if inv['expires_at'] <= (now or now_iso()):
        return 'expired'
    return 'active'


def usable_invite(c, code):
    """The invite this code belongs to while it can still make an account; None for a wrong, used-up, expired or revoked
    one (the caller answers all of those the same way)."""
    h = invite_code_hash(code)
    r = c.execute(f'SELECT {INVITE_COLS} FROM invites WHERE code_hash=?', (h,)).fetchone() if h else None  # noqa: S608
    inv = invite_row(r) if r else None
    return inv if inv and invite_status(inv) == 'active' else None


def invite_out(inv, names, joined, now):
    """An invite for the admin page. names: {uid: username}; joined: {invite id: [{username, name}]}."""
    status = invite_status(inv, now)
    return {'id': inv['id'], 'note': inv['note'], 'maxUses': inv['max_uses'], 'uses': inv['uses'],
            'left': inv['max_uses'] - inv['uses'] if status == 'active' else 0, 'status': status,
            'expiresAt': inv['expires_at'], 'createdAt': inv['created_at'], 'revokedAt': inv['revoked_at'],
            'createdBy': names.get(inv['created_by']), 'users': joined.get(inv['id'], [])}


def list_invites(ids=None):
    """Invites for the admin page, newest first (at most INVITE_LIST_MAX), each with the accounts that signed up with it
    and are still there."""
    c, now = conn(), now_iso()
    if ids is None:
        rows = c.execute(f'SELECT {INVITE_COLS} FROM invites ORDER BY created_at DESC, rowid DESC LIMIT ?',  # noqa: S608
                         (INVITE_LIST_MAX,)).fetchall()
    else:
        rows = [r for i in ids for r in c.execute(f'SELECT {INVITE_COLS} FROM invites WHERE id=?', (i,)).fetchall()]  # noqa: S608
    invs = [invite_row(r) for r in rows]
    names, joined = {}, {}
    for uid, username, name, invite_id in c.execute('SELECT id, username, name, invite_id FROM users ORDER BY created_at'):
        names[uid] = username
        if invite_id:
            joined.setdefault(invite_id, []).append({'username': username, 'name': name})
    return [invite_out(inv, names, joined, now) for inv in invs]


def whole_number(v, lo, hi, default, what):
    """A whole number lo..hi from a request (default when missing); 400 otherwise (true, 2.5 and "3" are refused)."""
    if v is None:
        return default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v) or not lo <= v <= hi:
        raise ApiError(400, 'invalid_argument', f'{what} 是 {lo}–{hi} 的整数')
    return int(v)


def create_invite(created_by, body):
    """POST /api/admin/invites {note?, maxUses?: 1-50 (1), days?: 1-90 (14)} → (invite, code). The code is returned
    this once; only its hash is stored."""
    note = body.get('note')
    if note is not None and not isinstance(note, str):
        raise ApiError(400, 'invalid_argument', '备注是一句话')
    note = ' '.join((note or '').split())
    if len(note) > INVITE_NOTE_MAX:
        raise ApiError(400, 'invalid_argument', f'备注最多 {INVITE_NOTE_MAX} 个字')
    max_uses = whole_number(body.get('maxUses'), 1, INVITE_MAX_USES, 1, 'maxUses（能用几次）')
    days = whole_number(body.get('days'), 1, INVITE_MAX_DAYS, INVITE_DAYS, 'days（几天内有效）')
    now = datetime.now(timezone.utc)
    code, inv_id = new_invite_code(), 'i' + secrets.token_hex(6)
    with transaction() as c:
        c.execute('INSERT INTO invites (id, code_hash, note, max_uses, uses, expires_at, created_by, created_at) '
                  'VALUES (?,?,?,?,0,?,?,?)',
                  (inv_id, invite_code_hash(code), note, max_uses, iso_utc(now + timedelta(days=days)), created_by, iso_utc(now)))
    return list_invites([inv_id])[0], code


def revoke_invite(inv_id):
    """DELETE /api/admin/invites/<id>: no more accounts with it (the ones made stay). Revoking twice is fine."""
    if not isinstance(inv_id, str) or not re.fullmatch(r'i[0-9a-f]{12}', inv_id):
        raise ApiError(404, 'not_found', '没有这个邀请')
    with transaction() as c:
        if not c.execute('SELECT 1 FROM invites WHERE id=?', (inv_id,)).fetchone():
            raise ApiError(404, 'not_found', '没有这个邀请')
        c.execute('UPDATE invites SET revoked_at=? WHERE id=? AND revoked_at IS NULL', (now_iso(), inv_id))
    return list_invites([inv_id])[0]


def push_wanted(c, uid, kind):
    """Whether this person wants pushes of this kind (profile/prefs.push[kind] false turns it off)."""
    wanted = prefs_of(c, uid).get('push')
    return not (isinstance(wanted, dict) and wanted.get(kind) is False)


def tell_admins_about(name, username, note):
    """「新朋友注册了：<name>」 to every active admin's devices (kind remind, unless they turned reminders off), from a
    thread of its own so signing up doesn't wait for the push services."""
    def run():
        try:
            c = conn()
            admins = [r[0] for r in c.execute("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at")]
            title = short(f'新朋友注册了：{name}', PUSH_TITLE_MAX)
            text = short(f'用户名 {username}' + (f'，邀请备注「{note}」' if note else '') + '。在「我的 → 用户管理」里能看到', PUSH_BODY_MAX)
            for aid in admins:
                if not push_wanted(c, aid, 'remind'):
                    continue
                try:
                    send_push(aid, 'remind', title, text, '/#me')
                except ApiError as e:  # one a minute too many for that admin: the account is there anyway
                    print(f'new-account push to an admin not sent: {e.code}', file=sys.stderr, flush=True)
        except Exception:
            print('new-account push failed', file=sys.stderr, flush=True)
            traceback.print_exc()
            sys.stderr.flush()
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


# ---------------------------------------------------------------- Apple Health sleep

# Checked in order: a value naming a stage must not fall through to the generic "asleep".
SLEEP_WORDS = [
    ('inbed', ('inbed', 'in bed', '床')),
    ('awake', ('awake', '清醒', '醒着')),
    ('deep', ('deep', '深')),
    ('rem', ('rem', '快速动眼', '快速眼动')),
    ('core', ('core', '核心', '浅')),
    ('asleep', ('asleep', 'sleep', '睡')),
]
SLEEP_NUMERIC = {0: 'inbed', 1: 'asleep', 2: 'awake', 3: 'core', 4: 'deep', 5: 'rem'}  # HKCategoryValueSleepAnalysis


def sleep_kind(v):
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.strip().isdigit()):
        try:
            return SLEEP_NUMERIC.get(int(v))
        except (ValueError, OverflowError):
            return None
    s = str(v).strip().lower()
    return next((k for k, words in SLEEP_WORDS if any(w in s for w in words)), None)


def parse_ts(v):
    """A Shortcuts / ISO 8601 time as an aware datetime in LOCAL_TZ. Times without an offset are taken as local."""
    s = str(v).strip().replace('Z', '+00:00')
    dt = None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        for fmt in ('%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%d %H:%M:%S %z', '%Y-%m-%d %H:%M:%S%z', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M'):
            try:
                dt = datetime.strptime(s, fmt)
                break
            except ValueError:
                pass
    if dt is None or not 1970 <= dt.year <= 2200:
        raise ValueError(f'unreadable time {v!r}')
    return (dt if dt.tzinfo else dt.replace(tzinfo=LOCAL_TZ)).astimezone(LOCAL_TZ)


def union_minutes(intervals):
    total, cur = 0.0, None
    for s, e in sorted(intervals):
        if cur and s <= cur[1]:
            cur[1] = max(cur[1], e)
        else:
            if cur:
                total += (cur[1] - cur[0]).total_seconds()
            cur = [s, e]
    if cur:
        total += (cur[1] - cur[0]).total_seconds()
    return total / 60


def summarize_sleep(samples):
    """Main night from Apple Health sleep samples. Overlapping sources (Watch + iPhone) are merged, not added.
    All times are local (LOCAL_TZ): the date is the local wake-up day."""
    rows, unknown = [], set()
    for x in samples:
        if not isinstance(x, dict):
            continue
        kind = sleep_kind(x.get('value', x.get('type', '')))
        try:
            s, e = parse_ts(x.get('start') or x.get('startDate')), parse_ts(x.get('end') or x.get('endDate'))
        except (ValueError, TypeError):
            continue
        if kind is None:
            unknown.add(str(x.get('value'))[:40])
            continue
        if e > s:
            rows.append((s, e, kind))
    if not rows:
        raise ApiError(400, 'no_sleep', 'no sleep samples found', {'unknownValues': sorted(unknown)})
    rows.sort()
    sessions, cur = [], [rows[0]]  # samples less than NIGHT_GAP apart belong to the same night
    for r in rows[1:]:
        if r[0] - max(x[1] for x in cur) < NIGHT_GAP:
            cur.append(r)
        else:
            sessions.append(cur)
            cur = [r]
    sessions.append(cur)
    asleep_kinds = ('core', 'deep', 'rem', 'asleep')

    def asleep_of(sess):
        return union_minutes([(s, e) for s, e, k in sess if k in asleep_kinds])
    best = max(sessions, key=asleep_of)
    if any(k in ('core', 'deep', 'rem') for _, _, k in best):
        asleep_kinds = ('core', 'deep', 'rem')  # the Watch's stages win over an iPhone's coarse "asleep" block
    asleep_iv = [(s, e) for s, e, k in best if k in asleep_kinds]
    if not asleep_iv:
        raise ApiError(400, 'no_sleep', 'only in-bed or awake samples, no sleep', {'unknownValues': sorted(unknown)})
    start, end = min(s for s, _ in asleep_iv), max(e for _, e in asleep_iv)
    mins = {k: round(union_minutes([(s, e) for s, e, kk in best if kk == k])) for k in ('core', 'deep', 'rem', 'awake', 'inbed')}
    first = min(s for s, _, _ in best)
    last = max(e for _, e, _ in best)
    return {
        'date': end.date().isoformat(),
        'asleep': round(union_minutes(asleep_iv)), 'core': mins['core'], 'deep': mins['deep'], 'rem': mins['rem'],
        'awake': mins['awake'], 'inBed': mins['inbed'] or round((last - first).total_seconds() / 60),
        'bedtime': start.strftime('%H:%M'), 'wake': end.strftime('%H:%M'),
        'start': start.isoformat(), 'end': end.isoformat(), 'samples': len(best),
    }, sorted(unknown)


def fmt_hm(m):
    m = int(round(m))  # stored nights (e.g. from a screenshot) may hold fractional minutes
    return f'{m // 60} 小时 {m % 60} 分' if m >= 60 else f'{m} 分'


def fuller_night_stored(old, night):
    """Whether the stored night started no later than `night` and has more sleep, i.e. `night` is a partial copy of it
    (a sync whose look-back window began part-way through the night). A stored night without a start counts as earlier."""
    if not is_num(old.get('asleep')) or old['asleep'] <= night['asleep']:
        return False
    try:
        return parse_ts(old['start']) <= parse_ts(night['start'])
    except (KeyError, ValueError, TypeError):
        return True


MANUAL_NIGHT = '睡眠：这晚你手动改过，没覆盖'


def sleep_writes(c, uid, night, now, problems):
    """Writes that store one night: sleep/<wake day>, and body/<wake day>.sleep unless the person typed that in.
    Nothing when the person edited or cleared that night on the page (source manual), or when a fuller copy of the
    night is already stored (both noted in `problems`)."""
    day = night['date']
    stored = doc_data(c, uid, 'sleep', day)
    if stored.get('source') == 'manual':
        problems.append(MANUAL_NIGHT)
        return []
    if fuller_night_stored(stored, night):
        problems.append('睡眠：已有更完整的一晚，没覆盖')
        return []
    ops = [{'op': 'set', 'collection': 'sleep', 'id': day, 'data': {**night, 'source': 'apple-health', 'syncedAt': now}}]
    if doc_data(c, uid, 'body', day).get('sleepSource') != 'manual':
        ops.append({'op': 'merge', 'collection': 'body', 'id': day,
                    'data': {'date': day, 'sleep': round(night['asleep'] / 60, 1), 'sleepSource': 'apple-health', 'updatedAt': now}})
    return ops


# ---------------------------------------------------------------- Apple Health: everything else

# metric → (low, high) sanity range after unit conversion (bodyfat in %)
HEALTH_METRICS = {'weight': (25, 300), 'steps': (0, 150000), 'active': (0, 8000), 'rhr': (25, 150), 'hrv': (3, 300),
                  'bodyfat': (3, 70)}
# Single samples (heart rate in bpm, active energy in kcal), not stored per day: matched to workouts logged on the page
WORKOUT_METRICS = {'hr': (30, 230), 'kcals': (0, 2000)}
WORKOUT_LOOKBACK = timedelta(days=3)  # a workout gets samples when it started at most this long ago …
WORKOUT_MAX_LEN = timedelta(hours=5)  # … and lasted at most this long (not a session finished the next morning)
WORKOUT_MIN_HR = 5                    # heart rate samples a workout needs for a heartRate
WORKOUT_LINES = 2                     # workouts named in the Shortcut's notification
SCALE_METRICS = ('weight', 'bodyfat')  # from a scale: by the person's day (day start), the day's first reading
INGEST_ERRORS = {  # error code → the Shortcut's notification
    'bad_token': '同步令牌不对或已经撤销：在薄肌研究所「我的 → Apple 健康同步」重新生成，再改快捷指令第一行',
    'forbidden': '这个令牌不能上传健康数据',
    'unauthenticated': '快捷指令里没有同步令牌：在薄肌研究所「我的 → Apple 健康同步」生成，再填到快捷指令第一行',
    'invalid_argument': '同步失败：快捷指令发来的数据格式不对',
    'too_large': '同步失败：一次发的数据太多',
    'length_required': '同步失败：快捷指令发来的数据格式不对',
    'no_sleep': '同步失败：没找到睡眠数据',
    'internal': '同步失败：服务器出错了，稍后再试',
}
HEALTH_FIELDS = (('steps', 'steps'), ('active', 'activeKcal'), ('rhr', 'restingHR'), ('hrv', 'hrv'), ('weight', 'weight'),
                 ('bodyfat', 'bodyFat'))  # metric → health doc field
HEALTH_NAMES = {'weight': '体重', 'steps': '步数', 'active': '活动能量', 'rhr': '静息心率', 'hrv': 'HRV', 'sleep': '睡眠',
                'bodyfat': '体脂率', 'hr': '心率明细', 'kcals': '活动能量明细'}


def health_value(metric, v):
    """A number from a Shortcuts value such as 72.4, "72.4 kg", "8,213" or "2,100 千焦". Body fat comes as a fraction
    (0.185) or a percentage (18.5, "18.5%"): up to 1 it is a fraction; it is returned as a percentage."""
    s = str(v).strip().lower().replace(',', '').replace('，', '')
    m = re.search(r'-?\d+(?:\.\d+)?', s)
    if not m:
        return None
    x = float(m.group())
    if metric == 'weight' and ('lb' in s or '磅' in s):
        x *= 0.45359
    if metric in ('active', 'kcals') and ('kj' in s or '千焦' in s):
        x /= 4.184
    if metric == 'bodyfat' and x <= 1 and '%' not in s:
        x *= 100
    lo, hi = HEALTH_METRICS.get(metric) or WORKOUT_METRICS[metric]
    return x if lo <= x <= hi else None


def lines(v):
    """A Shortcuts "合并文本" list (one item per line) or a JSON list → list of strings."""
    if isinstance(v, list):
        return [str(x) for x in v]
    return [x for x in str(v or '').replace('\r', '').split('\n') if x.strip()]


def summarize_health(body, day_start=None):
    """Per-day numbers from parallel value/date lists ({"steps_v": "...", "steps_s": "..."}).
    Steps and active energy are summed per calendar day (the Shortcut groups them by calendar day, so Watch and iPhone
    aren't double counted), resting heart rate and HRV are the calendar day's average. Weight is the first reading of
    the day as the person counts it (day_start, default DAY_START_HOUR: a 01:30 weigh-in belongs to the day before), and
    so is body fat (the same scale), as a percentage with one decimal."""
    days, problems = {}, []
    for metric in HEALTH_METRICS:
        vals, starts = lines(body.get(metric + '_v')), lines(body.get(metric + '_s'))
        if not vals:
            continue
        if len(vals) != len(starts):
            problems.append(f'{HEALTH_NAMES[metric]}的值和日期数量对不上')
            continue
        per = {}
        for v, t in zip(vals, starts):
            x = health_value(metric, v)
            try:
                ts = parse_ts(t)
            except (ValueError, TypeError):
                continue
            if x is not None:
                d = day_of(ts, day_start) if metric in SCALE_METRICS else ts.date().isoformat()
                per.setdefault(d, []).append((ts, x))
        for d, rows in per.items():
            xs = [x for _, x in sorted(rows)]
            if metric in ('steps', 'active'):
                val = round(sum(xs))
            elif metric in SCALE_METRICS:
                val = round(xs[0], 1)
            else:
                val = round(sum(xs) / len(xs))
            days.setdefault(d, {})[metric] = val
            days[d].setdefault('n', {})[metric] = len(rows)
    return days, problems


def health_request(body):
    """The ingest body as {"<metric>_v": …, "<metric>_s": …, "sleep_e": …} and the metric a one-metric request names."""
    if not isinstance(body, dict):
        raise ApiError(400, 'invalid_argument', 'send a JSON object')
    if 'metric' not in body:
        return body, None
    m = str(body['metric']).strip().lower()
    if m not in HEALTH_METRICS and m not in WORKOUT_METRICS and m != 'sleep':
        raise ApiError(400, 'invalid_argument', 'metric must be one of sleep, ' + ', '.join([*HEALTH_METRICS, *WORKOUT_METRICS]),
                       zh=f'同步失败：不认识的数据类型「{m[:20]}」')
    return {m + '_v': body.get('v'), m + '_s': body.get('s'), m + '_e': body.get('e'), m + '_src': body.get('src')}, m


def night_from_lists(body, problems):
    """The main night from the sleep_v / sleep_s / sleep_e line lists → (summary or None, unknown values).
    Problems are noted rather than raised: the other metrics in the request may still be fine."""
    vals, starts, ends = (lines(body.get('sleep_' + k)) for k in 'vse')
    if not (vals or starts or ends):
        return None, []
    if not len(vals) == len(starts) == len(ends):
        problems.append('睡眠的值、开始和结束日期数量对不上')
        return None, []
    try:
        return summarize_sleep([{'value': v, 'start': s, 'end': e} for v, s, e in zip(vals, starts, ends)])
    except ApiError as e:
        problems.append('没找到睡眠数据' if e.code == 'no_sleep' else e.message)
        return None, e.extra.get('unknownValues', [])


def weight_is_manual(body, key='weight'):
    """Whether body.weight (or body.bodyFat: key) was typed in by the person: then the scale doesn't overwrite it. That
    includes a value the person cleared on the page ({weight: null, weightSource: "manual"}): it stays cleared."""
    src, w = body.get(key + 'Source'), body.get(key)
    if src == 'manual':
        return True
    if src is None:  # typed before weightSource existed
        return w is not None
    if key + 'Auto' in body:  # edited after the scale wrote it
        auto = body[key + 'Auto']
        return not (w == auto or (is_num(w) and is_num(auto) and abs(w - auto) < 0.05))
    return False  # an older automatic weight (weightSource apple-health, no weightAuto)


def health_writes(c, uid, days, night, now, problems):
    """The writes for one ingest. A sync looks back a few days, so its oldest day can start part-way through:
    a fuller stored value is never replaced (steps/active only grow; rhr/hrv/weight/bodyfat need at least as many samples).
    Merged into health/<day>, so what the page added there (ignore) and any other field stays. Weight and body fat also
    go into body/<day> (with weightAuto / bodyFatAuto) unless the person typed their own in."""
    ops = []
    for d in sorted(days):
        h = days[d]
        old = doc_data(c, uid, 'health', d)
        doc, n = {'date': d, 'source': 'apple-health', 'syncedAt': now}, {}
        for m, key in HEALTH_FIELDS:
            v = h.get(m)
            if v is None:
                continue
            if m in ('steps', 'active'):
                if is_num(old.get(key)) and old[key] > v:
                    continue
            else:
                if is_num(old.get(key)) and h['n'][m] < (old.get('n') or {}).get(m, 0):
                    continue
                n[m] = h['n'][m]
            doc[key] = v
        if n:
            doc['n'] = n
        ops.append({'op': 'merge', 'collection': 'health', 'id': d, 'data': doc})
        body, scale = doc_data(c, uid, 'body', d), {}
        for key in ('weight', 'bodyFat'):
            if doc.get(key) is not None and not weight_is_manual(body, key):
                scale.update({key: doc[key], key + 'Source': 'apple-health', key + 'Auto': doc[key]})
        if scale:
            ops.append({'op': 'merge', 'collection': 'body', 'id': d, 'data': {'date': d, **scale, 'updatedAt': now}})
    if night:
        ops += sleep_writes(c, uid, night, now, problems)
    return ops


# ---------------------------------------------------------------- Apple Watch samples → workouts logged on the page

def workout_samples(body, problems):
    """hr / kcals samples from the _v / _s line lists → {metric: [(time, value, source), …] by time}. The times are
    absolute (aware), so they compare with a workout's startedAt (UTC) whatever zone the phone wrote them in. The source
    names (_src, one per line, optional) are used only when there is one per value; otherwise they are quietly left out
    (source None) and every sample counts."""
    out = {}
    for metric in WORKOUT_METRICS:
        vals, starts = lines(body.get(metric + '_v')), lines(body.get(metric + '_s'))
        if not vals:
            continue
        if len(vals) != len(starts):
            problems.append(f'{HEALTH_NAMES[metric]}的值和日期数量对不上')
            continue
        srcs = [x.strip() for x in lines(body.get(metric + '_src'))]
        if len(srcs) != len(vals):
            srcs = [None] * len(vals)
        rows = []
        for v, t, src in zip(vals, starts, srcs):
            x = health_value(metric, v)
            if x is None:
                continue
            try:
                rows.append((parse_ts(t), x, src))
            except (ValueError, TypeError):
                pass
        if rows:
            out[metric] = sorted(rows, key=lambda r: r[0])
    return out


def from_watch(rows):
    """One workout's samples, from the Watch when some are: the iPhone in the pocket writes active energy (and sometimes
    heart rate) too, and summed the two would add up. A source whose name holds "Watch" or 「手表」 is a Watch; with
    several, the one with the most samples here. No Watch samples (or no source names): all of them."""
    count = {}
    for _, _, src in rows:
        if src and ('watch' in src.lower() or '手表' in src):
            count[src] = count.get(src, 0) + 1
    if not count:
        return rows
    watch = max(count, key=count.get)
    return [r for r in rows if r[2] == watch]


def workout_window(d, since):
    """(startedAt, endedAt) of a workout that Apple Watch samples can go to, else None: logged on the page (not imported
    from 训记), finished (no status active), started after `since` and no longer than WORKOUT_MAX_LEN."""
    if not isinstance(d, dict) or d.get('source') == 'xunji' or d.get('status') == 'active':
        return None
    try:
        start, end = parse_ts(d['startedAt']), parse_ts(d['endedAt'])
    except (KeyError, ValueError, TypeError):
        return None
    return (start, end) if since <= start <= end <= start + WORKOUT_MAX_LEN else None


def workout_updates(c, uid, samples, now=None):
    """Heart rate and active energy from the Watch for the person's workouts → (writes, matched).
    A workout with a window (workout_window) gets the samples that started between its startedAt and endedAt (only the
    Watch's when it has some: from_watch): heartRate {avg, max, min, n, source: "apple-health", at} from at least
    WORKOUT_MIN_HR of them, and their energy summed into kcal with kcalSource "apple-health". A sync looks back two days, so it may have caught only part of a workout: a stored
    apple-health value is replaced only by one from as many samples (heart rate) or with more energy, and a value put
    there otherwise is never touched. The writes update those fields only (needsReview, review and the rest stay), on
    the version read here. matched: [(start, data with the new values)] of the workouts that got samples, oldest first."""
    now = now or datetime.now(timezone.utc)
    at, since = iso_utc(now), now - WORKOUT_LOOKBACK
    times = {m: [r[0] for r in rows] for m, rows in samples.items()}
    ops, matched = [], []
    for doc_id, raw, version in c.execute("SELECT id, data, version FROM docs WHERE uid=? AND col='workouts'", (uid,)).fetchall():
        d = loads_stored(raw)
        win = workout_window(d, since)
        if win is None:
            continue
        got = {m: from_watch(rows[bisect.bisect_left(times[m], win[0]):bisect.bisect_right(times[m], win[1])])
               for m, rows in samples.items()}
        if not any(got.values()):
            continue
        patch, hr, old = {}, [x for _, x, _ in got.get('hr', [])], d.get('heartRate')
        if len(hr) >= WORKOUT_MIN_HR and (old is None or (isinstance(old, dict) and old.get('source') == 'apple-health')):
            new = {'avg': round(sum(hr) / len(hr)), 'max': round(max(hr)), 'min': round(min(hr)), 'n': len(hr)}
            old = old or {}
            if any(old.get(k) != v for k, v in new.items()) and new['n'] >= (old['n'] if is_num(old.get('n')) else 0):
                patch['heartRate'] = {**new, 'source': 'apple-health', 'at': at}
        kcal, src = round(sum(x for _, x, _ in got.get('kcals', []))), d.get('kcalSource')
        if kcal > 0 and (d.get('kcal') is None or src == 'apple-health'):
            if src != 'apple-health' or not is_num(d.get('kcal')) or kcal > d['kcal']:
                patch.update(kcal=kcal, kcalSource='apple-health')
        if patch:
            ops.append({'op': 'update', 'collection': 'workouts', 'id': doc_id, 'data': patch, 'ifVersion': version})
        matched.append((win[0], {**d, **patch}))
    return ops, sorted(matched, key=lambda m: m[0])


def workout_line(d, start):
    """「训练心率：3/02 背 二头 均 131 · 最高 162 · 消耗 240 kcal」 (or 「训练消耗：3/02 … 240 kcal」) for the
    notification; None with neither. An older title 「A · 胸 肩 三头」 loses its plan-day id, as on the page."""
    hr, kcal = d.get('heartRate'), d.get('kcal')
    day = d.get('date') if isinstance(d.get('date'), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', d['date']) else start.date().isoformat()
    title = str(d.get('title') or '').strip()
    m = re.fullmatch(r'([A-Za-z0-9]{1,3})\s*[·•]\s*(.+)', title)
    if m and m.group(1) == d.get('planDayId'):
        title = m.group(2).strip()
    name = f'{month_day(day)} {short(title or "训练", 20)}'
    kcal_txt = f'{round(kcal)} kcal' if is_num(kcal) else ''
    if not (isinstance(hr, dict) and is_num(hr.get('avg'))):
        return f'训练消耗：{name} {kcal_txt}' if kcal_txt else None
    line = f'训练心率：{name} 均 {round(hr["avg"])}' + (f' · 最高 {round(hr["max"])}' if is_num(hr.get('max')) else '')
    return line + (f' · 消耗 {kcal_txt}' if kcal_txt else '')


def workout_heart(uid, samples, problems, now=None):
    """Put the Watch's samples on the person's workouts → (notification lines, ids written). Read without holding the
    write lock, then write on the versions read: when the page saved one of them in between, the writes are refused as a
    whole (409) and everything is read and matched once more."""
    for attempt in (1, 2):
        ops, matched = workout_updates(conn(), uid, samples, now)
        try:
            if ops:
                run_writes(uid, ops)
            break
        except ApiError as e:
            if e.status != 409:
                raise
            if attempt == 2:
                problems.append('训练心率：训练记录刚被改过，下次同步再算')
                return [], []
    said = [x for x in (workout_line(d, start) for start, d in matched) if x]
    return said[-WORKOUT_LINES:], [o['id'] for o in ops]


WATER_HOURS = (5, 21)   # hours after the person's day starts when they drink: 10:00 → 02:00 with a 05:00 day start
MAX_REMINDERS = 2


def trained_days(c, uid):
    """{date: planDayId or ''} for every day with a workout (the latest workout of the day wins), and {date: plan} picks."""
    trained, picks = {}, {}
    for col, target in (('workouts', trained), ('days', picks)):
        rows = c.execute('SELECT data FROM docs WHERE uid=? AND col=? ORDER BY updated_at', (uid, col)).fetchall()
        for (data,) in rows:
            d = loads_stored(data)
            if col == 'workouts' and isinstance(d, dict) and d.get('status') == 'active':
                continue  # still being logged on the page (训练中)
            if isinstance(d, dict) and isinstance(d.get('date'), str):
                target[d['date']] = (d.get('planDayId') or '') if col == 'workouts' else d.get('plan')
    return trained, picks


def planned_today(plan, day, trained, picks):
    """The plan day id the user should train on `day`, or None on a rest day (days pick → rotation → schedule)."""
    pick = picks.get(day)
    if pick:
        return None if pick == 'rest' else pick
    tr = plan.get('training') if isinstance(plan.get('training'), dict) else {}
    scheduled = (tr.get('schedule') or {}).get(str(date.fromisoformat(day).isoweekday()))
    rotation = [r for r in tr.get('rotation') or [] if isinstance(r, str)]
    if not scheduled or not rotation:
        return scheduled
    last = None
    for d in sorted(set(trained) | set(picks)):
        if d >= day:
            break
        pid = picks.get(d) if picks.get(d) in rotation else trained.get(d)
        if pid in rotation:
            last = pid
    return rotation[(rotation.index(last) + 1) % len(rotation)] if last else scheduled


def reminders(c, uid, now=None):
    """Up to two short nudges for the Shortcut's notification, about the user's current day: train, weigh, drink.
    Each can be turned off in profile/prefs.notify; the day starts at the person's own hour."""
    now = (now or datetime.now(timezone.utc)).astimezone(LOCAL_TZ)
    prefs, start_hour = prefs_of(c, uid), day_start_of(c, uid)
    day = day_of(now, start_hour)
    plan = doc_data(c, uid, 'plan', 'current')
    tips = []
    trained, picks = trained_days(c, uid)
    plan_day = None if day in trained or not notify_on(prefs, 'plan') else planned_today(plan, day, trained, picks)
    if plan_day:
        names = {d.get('id'): d.get('name') for d in (plan.get('training') or {}).get('days') or [] if isinstance(d, dict)}
        tip = f'今天练 {plan_day}' + (f'（{names[plan_day]}）' if names.get(plan_day) else '')
        before = [d for d in set(trained) | {d for d, p in picks.items() if p and p != 'rest'} if d < day]
        if before:
            gap = (date.fromisoformat(day) - date.fromisoformat(max(before))).days
            if gap >= 3:
                tip += f'，已经 {gap} 天没练了'
        tips.append(tip)
    start = datetime.combine(date.fromisoformat(day), datetime.min.time(), LOCAL_TZ) + timedelta(hours=start_hour)
    hours = (now - start).total_seconds() / 3600
    if hours < 11 and notify_on(prefs, 'weigh') and not is_num(doc_data(c, uid, 'body', day).get('weight')):
        tips.append('还没称体重，空腹称一下')
    target = (plan.get('diet') or {}).get('water') if isinstance(plan.get('diet'), dict) else None
    if is_num(target) and target > 0 and notify_on(prefs, 'water'):
        share = min(1, max(0, (hours - WATER_HOURS[0]) / (WATER_HOURS[1] - WATER_HOURS[0])))
        drunk = doc_data(c, uid, 'water', day).get('total')
        drunk = drunk if is_num(drunk) else 0
        due = round(target * share / 100) * 100
        if due - drunk >= 500:
            tips.append(f'水喝了 {drunk} ml，这个点该到 {due} 左右')
    return tips[:MAX_REMINDERS]


def health_message(c, uid, day, problems, unknown, trains=()):
    """The Shortcut's notification: everything stored for `day` (so the Shortcut's last block shows it all), then problems,
    then a line per workout the Watch's samples went to (`trains`)."""
    h, sl = doc_data(c, uid, 'health', day), doc_data(c, uid, 'sleep', day)
    bits = []
    if is_num(h.get('weight')):
        bits.append(f'体重 {h["weight"]} kg')
    if is_num(h.get('bodyFat')):
        bits.append(f'体脂 {h["bodyFat"]}%')
    if is_num(sl.get('asleep')):
        bits.append(f'睡眠 {sl.get("bedtime", "")}–{sl.get("wake", "")} {fmt_hm(sl["asleep"])}')
    for k, name, unit in (('steps', '步数', ' 步'), ('activeKcal', '活动', ' kcal'), ('restingHR', '静息心率', ''), ('hrv', 'HRV', ' ms')):
        if is_num(h.get(k)):
            bits.append(f'{name} {h[k]:,}{unit}')
    msg = f'已同步 {month_day(day)}：' + (' · '.join(bits) or '无')
    if problems:
        msg += '。' + '；'.join(problems)
    if unknown:
        msg += f'。有 {len(unknown)} 种睡眠数据没认出来：{"、".join(unknown)}'
    for line in trains:
        msg += '\n' + line
    tips = reminders(c, uid)
    if tips:
        msg += '\n提醒：' + '；'.join(tips)
    return msg


# ---------------------------------------------------------------- Web Push
# Only empty pushes: the push service wakes the person's service worker, which asks GET /api/push/next what to show.
# So nothing about the person passes through the push service, and there is no payload encryption to get right.

_vapid_lock = threading.Lock()
_vapid_cache = {}  # vapid.json path → (private key, public key base64url)


@contextlib.contextmanager
def transaction():
    """The connection inside BEGIN IMMEDIATE … COMMIT (ROLLBACK on any error), holding write_lock."""
    with write_lock:
        c = conn()
        c.execute('BEGIN IMMEDIATE')
        try:
            yield c
            c.execute('COMMIT')
        except BaseException:
            if c.in_transaction:
                c.execute('ROLLBACK')
            raise


def vapid_keys():
    """(private key, public key as base64url) from LSJ_DATA/vapid.json, created (mode 0600) the first time they are
    needed. A broken file is an error, not a reason for new keys: every subscription is tied to the public key."""
    path = os.path.join(DATA, 'vapid.json')
    with _vapid_lock:
        if path in _vapid_cache:
            return _vapid_cache[path]
        try:
            with open(path, encoding='utf-8') as f:
                stored = json.load(f)
        except FileNotFoundError:
            stored = {**webpush.new_keys(), 'createdAt': now_iso()}
            tmp = f'{path}.{os.getpid()}.tmp'
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                os.fchmod(f.fileno(), 0o600)
                json.dump(stored, f)
            os.replace(tmp, path)
            print(f'created the Web Push (VAPID) key pair in {path}', flush=True)
        d = webpush.private_from_b64(stored['private'])
        public = webpush.b64u(webpush.encode_point(webpush.public_key(d)))
        if stored.get('public') != public:
            raise ValueError(f'{path}: the public key does not belong to the private key')
        _vapid_cache[path] = (d, public)
        return d, public


def push_service_ok(host):
    host = (host or '').lower().rstrip('.')
    return any(host == h or host.endswith('.' + h) for h in PUSH_HOSTS)


def parse_subscription(body):
    """(endpoint, p256dh, auth) from a browser's PushSubscription JSON ({endpoint, keys: {p256dh, auth}}): an https
    endpoint of a known push service, the device's P-256 key and its 16-byte auth secret. ApiError 400 otherwise."""
    endpoint = body.get('endpoint')
    keys = body.get('keys') if isinstance(body.get('keys'), dict) else {}
    if not isinstance(endpoint, str) or not endpoint or len(endpoint) > 1000 or any(ch.isspace() for ch in endpoint):
        raise ApiError(400, 'invalid_argument', '订阅里没有推送地址')
    try:
        u = urlsplit(endpoint)
        port = u.port
    except ValueError:
        raise ApiError(400, 'invalid_argument', '推送地址不对')
    if u.scheme != 'https' or not u.hostname or u.username or u.password or port not in (None, 443):
        raise ApiError(400, 'invalid_argument', '推送地址必须是 https')
    if not push_service_ok(u.hostname):
        raise ApiError(400, 'unknown_push_service', '不认识这个推送服务')
    try:
        p256dh, auth = keys.get('p256dh'), keys.get('auth')
        webpush.decode_point(webpush.unb64u(p256dh))
        if len(webpush.unb64u(auth)) != 16:
            raise ValueError('auth is not 16 bytes')
    except ValueError:
        raise ApiError(400, 'invalid_argument', '订阅里的密钥不对')
    return endpoint, p256dh.strip().rstrip('='), auth.strip().rstrip('=')


def push_count(c, uid):
    return c.execute('SELECT COUNT(*) FROM push_subs WHERE uid=?', (uid,)).fetchone()[0]


def push_subscribe(uid, endpoint, p256dh, auth, ua):
    """Store one device. The same endpoint replaces its row (also one another account had: the device is theirs now);
    beyond PUSH_MAX_SUBS a person's oldest device goes. Returns how many devices this person has."""
    with transaction() as c:
        c.execute('DELETE FROM push_subs WHERE endpoint=?', (endpoint,))
        c.execute('INSERT INTO push_subs (endpoint, uid, p256dh, auth, ua, created_at) VALUES (?,?,?,?,?,?)',
                  (endpoint, uid, p256dh, auth, (ua or '')[:200], now_iso()))
        c.execute('DELETE FROM push_subs WHERE uid=? AND rowid NOT IN (SELECT rowid FROM push_subs WHERE uid=? '
                  'ORDER BY created_at DESC, rowid DESC LIMIT ?)', (uid, uid, PUSH_MAX_SUBS))
        return push_count(c, uid)


def push_request(body):
    """(kind, title, text, url) of POST /api/push/send. One line each; url a path on this site. ApiError 400 otherwise."""
    kind = body.get('kind')
    if kind not in PUSH_KINDS:
        raise ApiError(400, 'invalid_argument', 'kind 只能是 ' + '、'.join(PUSH_KINDS))
    title, text, url = body.get('title'), body.get('body'), body.get('url')
    if not isinstance(title, str) or not title.strip():
        raise ApiError(400, 'invalid_argument', '标题不能是空的')
    if text is not None and not isinstance(text, str):
        raise ApiError(400, 'invalid_argument', 'body 是一句话')
    title, text = ' '.join(title.split()), ' '.join((text or '').split())
    if len(title) > PUSH_TITLE_MAX:
        raise ApiError(400, 'invalid_argument', f'标题最多 {PUSH_TITLE_MAX} 个字')
    if len(text) > PUSH_BODY_MAX:
        raise ApiError(400, 'invalid_argument', f'正文最多 {PUSH_BODY_MAX} 个字')
    url = '/' if url in (None, '') else url
    if not isinstance(url, str) or len(url) > PUSH_URL_MAX or not re.fullmatch(r'/(?![/\\])[^\s\\]*', url):
        raise ApiError(400, 'invalid_argument', 'url 只能是站内路径，以 / 开头，比如 /#claude')
    return kind, title, text, url


def push_one(endpoint, key, public):
    """(status, answer, error) for one device: error is None when the push service answered, else timeout / network."""
    try:
        status, raw = webpush.push(endpoint, key, public, PUSH_CONTACT, ttl=PUSH_TTL, timeout=PUSH_TIMEOUT)
        return status, raw, None
    except socket.timeout:
        return None, b'', 'timeout'
    except Exception as e:  # unreachable, TLS, a broken answer: the push service didn't take it
        return None, b'', 'network' if isinstance(e, OSError) else e.__class__.__name__


def send_push(uid, kind, title, text, url):
    """Queue a message for this person and wake each of their devices with an empty push, all at once (one request at
    most PUSH_TIMEOUT seconds, the whole send PUSH_WAIT). A device the push service doesn't know any more (404 / 410)
    is removed; other failures go to the journal (the push service and the status, never the endpoint).
    At most PUSH_PER_MINUTE messages a minute per person (429). Nothing is queued when the person has no device.
    → {queued, id, sent, failed, subs, results: [{device, service, status, ok, removed?, error?}]}"""
    now = datetime.now(timezone.utc)
    with transaction() as c:
        subs = [r[0] for r in c.execute('SELECT endpoint FROM push_subs WHERE uid=? ORDER BY created_at, rowid', (uid,))]
        if not subs:
            return {'queued': False, 'sent': 0, 'failed': 0, 'subs': 0, 'results': []}
        recent = c.execute('SELECT COUNT(*) FROM push_queue WHERE uid=? AND at > ?',
                           (uid, iso_utc(now - timedelta(seconds=60)))).fetchone()[0]
        if recent >= PUSH_PER_MINUTE:
            raise ApiError(429, 'rate_limited', f'一分钟最多发 {PUSH_PER_MINUTE} 条通知，过一会儿再发', {'retryAfter': 60})
        qid = c.execute('INSERT INTO push_queue (uid, at, kind, title, body, url) VALUES (?,?,?,?,?,?)',
                        (uid, iso_utc(now), kind, title, text, url)).lastrowid
        c.execute('DELETE FROM push_queue WHERE uid=? AND id NOT IN (SELECT id FROM push_queue WHERE uid=? ORDER BY id DESC LIMIT ?)',
                  (uid, uid, PUSH_KEEP))
    key, public = vapid_keys()
    answers = [None] * len(subs)

    def run(i, endpoint):
        answers[i] = push_one(endpoint, key, public)
    threads = [threading.Thread(target=run, args=(i, e), daemon=True) for i, e in enumerate(subs)]
    for t in threads:
        t.start()
    deadline = time.monotonic() + PUSH_WAIT
    for t in threads:
        t.join(max(0, deadline - time.monotonic()))
    results, gone, sent, unsure = [], [], 0, False
    for endpoint, answer in zip(subs, answers):
        status, raw, error = answer or (None, b'', 'timeout')
        host = urlsplit(endpoint).hostname
        row = {'device': hashlib.sha256(endpoint.encode()).hexdigest()[:12], 'service': host, 'status': status,
               'ok': status is not None and 200 <= status < 300}
        if row['ok']:
            sent += 1
        elif status in (404, 410):  # the subscription expired or the person turned notifications off on that device
            gone.append(endpoint)
            row['removed'] = True
        else:
            row['error'] = error or 'refused'
            unsure = unsure or error == 'timeout'  # it may still arrive
            print(f'push to {host} failed: ' + (f'HTTP {status} {short(raw.decode("utf-8", "replace"), 120)}' if status else error),
                  file=sys.stderr, flush=True)
        results.append(row)
    with transaction() as c:
        for endpoint in gone:
            c.execute('DELETE FROM push_subs WHERE endpoint=? AND uid=?', (endpoint, uid))
        if sent or not unsure:  # sent = 0: no device will ask for this message, so /next never hands it out
            c.execute('UPDATE push_queue SET sent=? WHERE id=?', (sent, qid))
    return {'queued': True, 'id': qid, 'sent': sent, 'failed': len(subs) - sent, 'subs': len(subs), 'results': results}


def next_push(uid, mark=True):
    """What a service worker woken by a push shows: the oldest message not handed out yet (from the last PUSH_TTL
    seconds, and not one that no device took), now marked delivered; else the newest one handed out in the last
    PUSH_AGAIN seconds (another of the person's devices woken by the same push); else None."""
    now = datetime.now(timezone.utc)
    with transaction() as c:
        row = c.execute('SELECT id, at, kind, title, body, url FROM push_queue WHERE uid=? AND delivered_at IS NULL '
                        'AND (sent IS NULL OR sent > 0) AND at >= ? ORDER BY id LIMIT 1',
                        (uid, iso_utc(now - timedelta(seconds=PUSH_TTL)))).fetchone()
        if row and mark:
            c.execute('UPDATE push_queue SET delivered_at=? WHERE id=?', (iso_utc(now), row[0]))
        if not row:
            row = c.execute('SELECT id, at, kind, title, body, url FROM push_queue WHERE uid=? AND delivered_at >= ? '
                            'ORDER BY delivered_at DESC, id DESC LIMIT 1', (uid, iso_utc(now - timedelta(seconds=PUSH_AGAIN)))).fetchone()
    return dict(zip(('id', 'at', 'kind', 'title', 'body', 'url'), row)) if row else None


# Delayed reminders (POST /api/push/later): the page schedules 「休息完了」 for when a rest timer ends, so the phone
# buzzes even with the page in the background. One per person, in this process's memory only (a restart forgets them),
# sent through send_push like any other remind.
_later_lock = threading.Lock()
_later = {}  # uid → (id, threading.Timer): the one reminder this person has pending
LATER_POSTS = WindowLimit(60, PUSH_LATER_PER_MINUTE)


def later_request(body):
    """(delay, title, text, url) of POST /api/push/later: delaySec a whole number of seconds PUSH_LATER_MIN–PUSH_LATER_MAX,
    title and url as for a sent message, body at most PUSH_LATER_BODY_MAX. ApiError 400 otherwise."""
    delay = body.get('delaySec')
    if isinstance(delay, bool) or not isinstance(delay, int) or not PUSH_LATER_MIN <= delay <= PUSH_LATER_MAX:
        raise ApiError(400, 'invalid_argument', f'delaySec 是 {PUSH_LATER_MIN}–{PUSH_LATER_MAX} 的整数（秒）')
    _, title, text, url = push_request({**body, 'kind': 'remind'})
    if len(text) > PUSH_LATER_BODY_MAX:
        raise ApiError(400, 'invalid_argument', f'正文最多 {PUSH_LATER_BODY_MAX} 个字')
    return delay, title, text, url


def push_later(uid, delay, title, text, url):
    """Send 「remind」 title / text to this person delay seconds from now, replacing whatever they had pending (its id
    is void from here on). → the reminder's id, for DELETE /api/push/later/<id>."""
    rid = secrets.token_urlsafe(9)
    timer = threading.Timer(delay, fire_later, args=(uid, rid, title, text, url))
    timer.daemon = True
    with _later_lock:
        old = _later.pop(uid, None)
        _later[uid] = (rid, timer)
        timer.start()
    if old:
        old[1].cancel()
    return rid


def cancel_later(uid, rid=None):
    """Drop this person's pending reminder (with rid: only when it is that one). → whether there was one to drop."""
    with _later_lock:
        cur = _later.get(uid)
        if not cur or (rid is not None and cur[0] != rid):
            return False
        del _later[uid]
    cur[1].cancel()
    return True


def fire_later(uid, rid, title, text, url):
    """The timer's thread: send the reminder unless it was cancelled or replaced meanwhile, the person turned reminders
    off since, or they have no device any more (send_push queues nothing then). Failures go to the journal."""
    with _later_lock:
        cur = _later.get(uid)
        if not cur or cur[0] != rid:
            return
        del _later[uid]
    try:
        if not push_wanted(conn(), uid, 'remind'):
            return
        send_push(uid, 'remind', title, text, url)
    except ApiError as e:
        print(f'delayed push not sent: {e.code}', file=sys.stderr, flush=True)
    except Exception:
        print('delayed push failed', file=sys.stderr, flush=True)
        traceback.print_exc()
        sys.stderr.flush()


# ---------------------------------------------------------------- 训记 web sync

XUNJI_ERRORS = {  # xunji_import error kind → (status, code, what the page shows)
    'invalid_key': (400, 'xunji_key_invalid', '训记 key 不对或已失效，请在训记 App 里重新申请'),
    'busy': (503, 'xunji_busy', '训记那边限频了，过一会儿再试'),
    'timeout': (504, 'xunji_timeout', '训记那边太慢，这次没同步完，过一会儿再试'),
    'network': (502, 'xunji_unreachable', '连不上训记，过一会儿再试'),
    'vip': (502, 'xunji_vip', '训记说这个账号要开会员才能用开放接口'),
}
XUNJI_OTHER = (502, 'xunji_error', '训记返回了看不懂的结果，过一会儿再试')


class Cooldown:
    """At most one go per key every `every` seconds. Thread-safe."""

    def __init__(self, every):
        self.every, self.lock, self.last = every, threading.Lock(), {}

    def clear(self):
        with self.lock:
            self.last.clear()

    def take(self, key):
        """0 when a go is allowed now (and recorded), else the whole seconds left to wait."""
        now = time.monotonic()
        with self.lock:
            if key in self.last and now - self.last[key] < self.every:
                return math.ceil(self.every - (now - self.last[key]))
            self.last[key] = now
            return 0


XUNJI_LIMIT = Cooldown(XUNJI_EVERY)
XUNJI_KEY_LIMIT = Cooldown(5)   # checking a newly saved key with 训记
XUNJI_TPL_LIMIT = Cooldown(XUNJI_TPL_EVERY)   # 「写进训记」
XUNJI_SUBMITTING = set()        # inbox ids being sent to 训记 right now (a second tap waits for the first)
XUNJI_SUBMITTING_LOCK = threading.Lock()


def xunji_key(uid, kind='train'):
    r = conn().execute('SELECT key FROM xunji_keys WHERE uid=? AND kind=?', (uid, kind)).fetchone()
    return r[0] if r else None


def xunji_key_times(uid):
    """{kind: when it was saved} for the keys this person stored."""
    return dict(conn().execute('SELECT kind, updated_at FROM xunji_keys WHERE uid=?', (uid,)).fetchall())


def key_flags_op(c, uid, extra=None):
    """The merge that makes meta/xunji.keys say which keys are stored ({train, template}), plus `extra` fields; None when
    nothing would change. Someone who never stored a key and has no flags yet gets no meta/xunji just for this."""
    have = {r[0] for r in c.execute('SELECT kind FROM xunji_keys WHERE uid=?', (uid,)).fetchall()}
    flags = {k: k in have for k in XUNJI_KINDS}
    cur = doc_data(c, uid, 'meta', 'xunji').get('keys')
    data = dict(extra or {})
    if cur != flags and (have or isinstance(cur, dict)):
        data['keys'] = flags
    return {'op': 'merge', 'collection': 'meta', 'id': 'xunji', 'data': data} if data else None


def refresh_key_flags(uid):
    run_writes(uid, lambda c: [op for op in [key_flags_op(c, uid)] if op])


def save_xunji_key(uid, key, kind='train', extra=None):
    """Store a key (replacing the one of that kind) and update meta/xunji.keys (and `extra` fields) in the same write."""
    def writes(c):
        c.execute('INSERT INTO xunji_keys (uid, kind, key, updated_at) VALUES (?,?,?,?) ON CONFLICT(uid, kind) DO UPDATE '
                  'SET key=excluded.key, updated_at=excluded.updated_at', (uid, kind, key, now_iso()))
        return [op for op in [key_flags_op(c, uid, extra)] if op]
    run_writes(uid, writes)


def delete_xunji_key(uid, kind):
    """Remove one kind of key; True when there was one."""
    removed = []

    def writes(c):
        removed.append(c.execute('DELETE FROM xunji_keys WHERE uid=? AND kind=?', (uid, kind)).rowcount)
        return [op for op in [key_flags_op(c, uid)] if op]
    run_writes(uid, writes)
    return removed[0] > 0


def xunji_failed(e):
    """The ApiError for a failed 训记 call. The journal gets the kind and HTTP status only: never the key or 训记's text."""
    print(f'训记 call failed: {e.kind}' + (f' (HTTP {e.status})' if e.status else ''), file=sys.stderr, flush=True)
    status, code, msg = XUNJI_ERRORS.get(e.kind, XUNJI_OTHER)
    return ApiError(status, code, msg)


def web_sync_op(at, ok, new=0, updated=0, error=None):
    """Merge meta/xunji.webSync, what the page shows about its last sync. dayMap, lastSync*, templates stay as they are."""
    data = {'webSync': {'at': at, 'ok': ok, 'new': new, 'updated': updated, 'error': error or {'__delete__': True}}}
    if ok:
        data['linked'] = True
    return {'op': 'merge', 'collection': 'meta', 'id': 'xunji', 'data': data}


def xunji_sessions(key, days, deadline):
    """{workout id: (训记 day, raw session)} for these 训记 days: the light list first, the full detail when it lists any.
    One request gets at most XUNJI_TIMEOUT seconds, and all of them must end by `deadline` (time.monotonic())."""
    def fetch(ds, full):
        left = deadline - time.monotonic()
        if left < 1:
            raise xj.XunjiError('timeout', 'the web sync ran out of time')
        trains = xj.fetch_trains(key, ds, full, timeout=min(XUNJI_TIMEOUT, left), max_wait=min(XUNJI_MAX_WAIT, left - XUNJI_TIMEOUT - 1))
        if XUNJI_PAUSE:
            time.sleep(XUNJI_PAUSE)
        return trains
    sessions = {}
    for ds in days:
        if fetch(ds, False):
            for t in fetch(ds, True):
                if t.get('localid') is not None:
                    sessions[f'xj-{t["localid"]}'] = (ds, t)  # listed on two days: the later one wins
    return sessions


def xunji_web_sync(uid, key, now=None):
    """The page's 「从训记同步」: the person's 训记 sessions from two days before their today up to now, written with
    bin/xunji's mapping and write rules (xunji_import.merge_session). It never deletes a workout: bin/xunji does that,
    after two reads 10 minutes apart. Raises xj.XunjiError when 训记 fails; then nothing is written."""
    now = now or datetime.now(timezone.utc)
    start_hour = day_start_of(conn(), uid)
    first = date.fromisoformat(day_of(now, start_hour)) - timedelta(days=XUNJI_DAYS - 1)
    last = now.astimezone(LOCAL_TZ).date()  # 训记 files a session under its calendar day: after midnight that is the next one
    days = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]
    sessions = xunji_sessions(key, days, time.monotonic() + XUNJI_BUDGET)
    stamp = now.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    report = {'ok': True, 'new': [], 'updated': [], 'remapped': [], 'unchanged': 0, 'range': [days[0], days[-1]]}

    def writes(c):  # inside the transaction: what is stored can't change before the writes land
        meta = doc_data(c, uid, 'meta', 'xunji')
        day_map = meta['dayMap'] if isinstance(meta.get('dayMap'), dict) else {}
        plan = doc_data(c, uid, 'plan', 'current')
        ops = []
        for doc_id, (_, t) in sorted(sessions.items(), key=lambda kv: (kv[1][0], kv[0])):
            cur = get_doc(c, uid, 'workouts', doc_id)
            # every session here is recent: a new one or a 训记 edit asks Claude for a review
            body, change, label = xj.merge_session(t, cur, day_map, plan, True, stamp, LOCAL_TZ, start_hour)
            if body is None:
                report['unchanged'] += 1
                continue
            ops.append({'op': 'set', 'collection': 'workouts', 'id': doc_id, 'data': body, 'ifVersion': cur['version'] if cur else 0})
            report[change].append(label)
        return ops + [web_sync_op(stamp, True, len(report['new']), len(report['updated']))]
    run_writes(uid, writes)
    return report


def remap_xunji(uid):
    """POST /api/xunji/remap: every imported workout's planDayId and targets worked out again from what is stored
    (mine.planDayId, else meta/xunji.dayMap by its title; the plan's targets), without asking 训记. Only records that
    change are written; reviews and needsReview stay as they are. Returns {"remapped": [ids]}."""
    now, changed = now_iso(), []

    def writes(c):
        meta = doc_data(c, uid, 'meta', 'xunji')
        day_map = meta['dayMap'] if isinstance(meta.get('dayMap'), dict) else {}
        plan = doc_data(c, uid, 'plan', 'current')
        ops = []
        rows = c.execute("SELECT id, data, version, updated_at FROM docs WHERE uid=? AND col='workouts' AND id LIKE 'xj-%' "
                         "ORDER BY id", (uid,)).fetchall()
        for r in rows:
            w = row_out('workouts', r)
            d = w['data']
            if not isinstance(d, dict) or d.get('source') != 'xunji':
                continue
            fields = xj.remap(d, day_map, plan)
            if fields is None:
                continue
            ops.append({'op': 'set', 'collection': 'workouts', 'id': w['id'], 'data': {**d, **fields, 'updatedAt': now},
                        'ifVersion': w['version']})
            changed.append(w['id'])
        return ops
    run_writes(uid, writes)
    return {'remapped': changed}


# ---------------------------------------------------------------- the person's decisions: proposals and undo
# Claude proposes (inbox/<id>: a plan change, an Agent template change for 训记, or a question) and records what it changed
# on its own (log/<id> with undo.changes). Only the person decides, on the page: these run for a page login only.

class Stale(Exception):
    """plan/current doesn't hold what a proposal (or an undo) expects any more."""


def same_json(a, b):
    """Deep equality of JSON values: true is not 1, 2 equals 2.0, the order of object keys doesn't matter."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if is_num(a) and is_num(b):
        return a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same_json(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same_json(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def plan_path(path):
    """A change's dotted path as its segments, e.g. "diet.restDay.kcal" or "training.days.B.exercises". The root is one
    of PLAN_ROOTS; inside training.days the next segment is a training day's id; other arrays are replaced whole, so no
    path goes into one. Raises ValueError for anything else."""
    if not isinstance(path, str) or len(path) > 200:
        raise ValueError('path must be text')
    segs = path.split('.')
    if segs[0] not in PLAN_ROOTS or not all(segs) or len(segs) > 8:
        raise ValueError(f'bad path {path!r}')
    return segs


def _in_days(segs, i):
    """Whether the container at depth i of this path is the training.days array (its segment i is then a day id)."""
    return segs[:i] == ['training', 'days']


def plan_value(segs, v):
    """A value as it is stored at a path: a whole training day (training.days.<id>) always carries its id."""
    if len(segs) == 3 and _in_days(segs, 2) and isinstance(v, dict) and 'id' not in v:
        return {'id': segs[2], **v}
    return v


def plan_get(plan, segs):
    """The value at a path; None when it, or anything above it, is missing. Raises Stale when the path runs through
    something that isn't an object (or through an array other than training.days)."""
    cur = plan
    for i, seg in enumerate(segs):
        if cur is None:
            return None
        if isinstance(cur, list) and _in_days(segs, i):
            cur = next((d for d in cur if isinstance(d, dict) and d.get('id') == seg), None)
        elif isinstance(cur, dict):
            cur = cur.get(seg)
        else:
            raise Stale('.'.join(segs))
    return cur


def plan_put(plan, segs, value):
    """Set the value at a path (None removes it, or removes that training day), creating missing objects on the way.
    Changes `plan` in place. Raises Stale when the path runs through something that isn't an object."""
    cur = plan
    for i, seg in enumerate(segs[:-1]):
        if isinstance(cur, list) and _in_days(segs, i):
            nxt = next((d for d in cur if isinstance(d, dict) and d.get('id') == seg), None)
            if nxt is None:
                if value is None:
                    return
                nxt = {'id': seg}
                cur.append(nxt)
        elif isinstance(cur, dict):
            nxt = cur.get(seg)
            if nxt is None:
                if value is None:
                    return
                nxt = [] if _in_days(segs, i + 1) else {}
                cur[seg] = nxt
        else:
            raise Stale('.'.join(segs))
        cur = nxt
    last = segs[-1]
    if isinstance(cur, list) and _in_days(segs, len(segs) - 1):
        at = next((j for j, d in enumerate(cur) if isinstance(d, dict) and d.get('id') == last), None)
        if value is None:
            if at is not None:
                del cur[at]
        elif at is None:
            cur.append(value)
        else:
            cur[at] = value
    elif isinstance(cur, dict):
        if value is None:
            cur.pop(last, None)
        else:
            cur[last] = value
    else:
        raise Stale('.'.join(segs))


def parse_changes(changes, need):
    """[(segments, change)] for a proposal's or an undo's changes; ValueError when one is malformed or lacks a key in
    `need` ("from" / "to"; their value may be null)."""
    if not isinstance(changes, list) or not 1 <= len(changes) <= 50:
        raise ValueError('changes must be a list of 1-50 changes')
    out = []
    for ch in changes:
        if not isinstance(ch, dict) or any(k not in ch for k in need):
            raise ValueError('a change needs ' + ' and '.join(need))
        out.append((plan_path(ch.get('path')), ch))
    return out


def changed_plan(plan, parsed, expect, write):
    """A copy of the plan with every change's `write` value set, when every path now holds its `expect` value (accept a
    proposal: expect "from", write "to"; undo: expect "to", write "from", in reverse order). Raises Stale otherwise."""
    for segs, ch in parsed:
        if not same_json(plan_get(plan, segs), plan_value(segs, ch.get(expect))):
            raise Stale('.'.join(segs))
    new = copy.deepcopy(plan)
    for segs, ch in (parsed if write == 'to' else list(reversed(parsed))):
        plan_put(new, segs, copy.deepcopy(plan_value(segs, ch.get(write))))
    return new


def drop_custom(plan, parsed):
    """Forget the person's own edits (plan.custom) at these paths and below them: they agreed to Claude's values there.
    An edit above a changed path (custom has training.days.B, the change is training.days.B.exercises) stays, but the
    change goes into its `was` too, so 「恢复建议值」 later goes back to the suggestion including what they agreed to."""
    custom = plan.get('custom')
    if not isinstance(custom, dict):
        return
    paths = ['.'.join(segs) for segs, _ in parsed]
    for k in [k for k in custom if any(k == p or k.startswith(p + '.') for p in paths)]:
        del custom[k]
    for k, ent in custom.items():
        if not isinstance(ent, dict) or ent.get('was') is None:
            continue
        ks = k.split('.')
        for segs, ch in parsed:
            if len(segs) > len(ks) and segs[:len(ks)] == ks:
                tmp = {}
                try:
                    plan_put(tmp, ks, copy.deepcopy(plan_value(ks, ent['was'])))
                    plan_put(tmp, segs, copy.deepcopy(plan_value(segs, ch.get('to'))))
                except Stale:
                    continue
                ent['was'] = plan_get(tmp, ks)
    if not custom:
        del plan['custom']


def short(text, n=40):
    text = ' '.join(str(text or '').split())
    return text if len(text) <= n else text[:n - 1] + '…'


def new_log_id(now=None):
    """YYYYMMDD-HHMMSS-<4 random hex>, local time."""
    return (now or datetime.now(timezone.utc)).astimezone(LOCAL_TZ).strftime('%Y%m%d-%H%M%S-') + secrets.token_hex(2)


def log_op(at, kind, text, ref=None):
    data = {'at': at, 'kind': kind, 'text': short(text, 200)}
    if ref:
        data['ref'] = ref  # what the line is about: inbox/<id> or log/<id>
    return {'op': 'set', 'collection': 'log', 'id': new_log_id(), 'data': data, 'ifVersion': 0}


def open_inbox(c, uid, inbox_id):
    """inbox/<id>, which must still wait for the person (status open)."""
    check_path('inbox', inbox_id, need_id=True)
    doc = get_doc(c, uid, 'inbox', inbox_id)
    if not doc or not isinstance(doc['data'], dict):
        raise ApiError(404, 'not_found', '没有这条提案')
    status = doc['data'].get('status')
    if status != 'open':
        raise ApiError(409, 'not_open', '这条已经处理过了', {'status': status})
    return doc


def decided_op(inbox, status, now, **fields):
    """The inbox record after the person's decision: Claude reads it next time (needsReview)."""
    return {'op': 'update', 'collection': 'inbox', 'id': inbox['id'], 'ifVersion': inbox['version'],
            'data': {'status': status, 'decidedAt': now, 'needsReview': True, **fields}}


STALE_PLAN = '计划已经变了，等 Claude 重新出提案'


def accept_plan(uid, inbox_id):
    """Accept a plan proposal: every change's `from` must equal what plan/current holds now (deep comparison); then all of
    them go into plan/current in one write (updatedAt now; version and plan_history untouched) and plan.custom forgets
    those paths. One change that doesn't match → nothing in the plan changes, the proposal becomes stale (409)."""
    now, state = now_iso(), {}

    def writes(c):
        inbox = open_inbox(c, uid, inbox_id)
        title = short(inbox['data'].get('title') or '计划改动')
        ref = 'inbox/' + inbox_id
        try:
            parsed = parse_changes(inbox['data'].get('changes'), ('to',))
        except ValueError as e:
            state['bad'] = '提案里有看不懂的改动，等 Claude 重新出'
            return [decided_op(inbox, 'failed', now, result={'ok': False, 'at': now, 'error': state['bad'], 'detail': str(e)[:200]}),
                    log_op(now, 'decision', f'你同意了：{title}，但提案有问题，计划没改', ref)]
        pdoc = get_doc(c, uid, 'plan', 'current')
        plan = pdoc['data'] if pdoc and isinstance(pdoc['data'], dict) else {}
        try:
            new = changed_plan(plan, parsed, 'from', 'to')
        except Stale:
            state['stale'] = True
            return [decided_op(inbox, 'stale', now), log_op(now, 'decision', f'你同意了：{title}，但计划已经变了，没改', ref)]
        drop_custom(new, parsed)
        new['updatedAt'] = now
        return [decided_op(inbox, 'accepted', now),
                {'op': 'set', 'collection': 'plan', 'id': 'current', 'data': new, 'ifVersion': pdoc['version'] if pdoc else 0},
                log_op(now, 'decision', f'你同意了：{title}', ref)]
    out = run_writes(uid, writes)
    if state.get('stale'):
        raise ApiError(409, 'stale', STALE_PLAN, {'inbox': out[0], 'log': [out[1]]})
    if state.get('bad'):
        raise ApiError(400, 'bad_proposal', state['bad'], {'inbox': out[0], 'log': [out[1]]})
    return {'ok': True, 'inbox': out[0], 'plan': out[1], 'log': [out[2]]}


def answer_question(uid, inbox_id, body):
    """Accept on a question means answering it: {"text": "…"} (an option or the person's own words)."""
    text = body.get('text', body.get('answer'))
    if not isinstance(text, str) or not text.strip():
        raise ApiError(400, 'invalid_argument', '回答不能是空的')
    text, now = text.strip()[:500], now_iso()

    def writes(c):
        inbox = open_inbox(c, uid, inbox_id)
        q = inbox['data'].get('q') or inbox['data'].get('title')
        return [decided_op(inbox, 'answered', now, answer={'text': text, 'at': now}),
                log_op(now, 'decision', f'你回答了：{short(q, 30)} → {short(text, 60)}', 'inbox/' + inbox_id)]
    out = run_writes(uid, writes)
    return {'ok': True, 'inbox': out[0], 'log': [out[1]]}


def decline_inbox(uid, inbox_id):
    now = now_iso()

    def writes(c):
        inbox = open_inbox(c, uid, inbox_id)
        d = inbox['data']
        text = (f'你没回答：{short(d.get("q") or d.get("title"))}' if d.get('kind') == 'question'
                else f'你没同意：{short(d.get("title") or "Claude 的提案")}')
        return [decided_op(inbox, 'declined', now), log_op(now, 'decision', text, 'inbox/' + inbox_id)]
    out = run_writes(uid, writes)
    return {'ok': True, 'inbox': out[0], 'log': [out[1]]}


def undo_log(uid, log_id):
    """Undo what Claude changed on its own (log/<id>.undo.changes): every path must still hold the `to` Claude wrote;
    then all go back to `from` in one write, the entry gets undone: {at} and a new line says so. Otherwise 409 stale
    and nothing is written."""
    check_path('log', log_id, need_id=True)
    now = now_iso()

    def writes(c):
        entry = get_doc(c, uid, 'log', log_id)
        if not entry or not isinstance(entry['data'], dict):
            raise ApiError(404, 'not_found', '没有这条记录')
        d = entry['data']
        if d.get('undone'):
            raise ApiError(409, 'already_undone', '已经撤回过了')
        undo = d.get('undo') if isinstance(d.get('undo'), dict) else {}
        try:
            parsed = parse_changes(undo.get('changes'), ('from', 'to'))
        except ValueError:
            raise ApiError(400, 'cannot_undo', '这条不能撤回')
        pdoc = get_doc(c, uid, 'plan', 'current')
        plan = pdoc['data'] if pdoc and isinstance(pdoc['data'], dict) else {}
        try:
            new = changed_plan(plan, parsed, 'to', 'from')
        except Stale:
            raise ApiError(409, 'stale', '计划之后又改过，这条撤回不了')
        new['updatedAt'] = now
        return [{'op': 'update', 'collection': 'log', 'id': log_id, 'data': {'undone': {'at': now}}, 'ifVersion': entry['version']},
                {'op': 'set', 'collection': 'plan', 'id': 'current', 'data': new, 'ifVersion': pdoc['version'] if pdoc else 0},
                log_op(now, 'decision', f'你撤回了：{short(d.get("text"), 80)}', 'log/' + log_id)]
    out = run_writes(uid, writes)
    return {'ok': True, 'undone': out[0], 'plan': out[1], 'log': [out[2]]}


# ---- 「写进训记」: accepting an Agent template proposal sends it to 训记 with the person's template key

TEMPLATE_ERRORS = {  # xunji_import error kind → (status, code, what the page shows; the proposal is then failed)
    'invalid_key': (400, 'xunji_key_invalid', '训记模版 key 不对或已失效：在训记 App 里重新申请，再到「我的 → 训记」里存'),
    'busy': (503, 'xunji_busy', '训记那边限频了，这次没写进去：Claude 下次处理时会重新准备'),
    'timeout': (504, 'xunji_timeout', '训记那边太慢，不确定写进去没有：Claude 下次处理时会核对'),
    'network': (502, 'xunji_unreachable', '连不上训记，这次没写进去：Claude 下次处理时会重新准备'),
    'vip': (502, 'xunji_vip', '训记说这个账号要开会员才能用开放接口'),
}
TEMPLATE_CONFLICT = (409, 'xunji_conflict', '训记里的模版变了，等 Claude 重新准备')
TEMPLATE_OTHER = (502, 'xunji_error', '训记返回了看不懂的结果：Claude 下次处理时会核对')


def xunji_says(text, key=None):
    """What 训记 said in a refusal ("训记 HTTP 400: {…}"), short: its message field when it sent JSON. Never the key."""
    raw = text.split(': ', 1)[-1].split('\n→', 1)[0]
    try:
        data = json.loads(raw)
        raw = next((str(data[k]) for k in ('message', 'msg', 'error', 'detail') if isinstance(data, dict) and data.get(k)), raw)
    except ValueError:
        pass
    if key:
        raw = raw.replace(key, '***')
    return short(raw, 120)


def template_failure(e, key):
    """(status, code, reason) for a failed 训记 template change. The journal gets the kind and HTTP status only."""
    print(f'训记 template change failed: {e.kind}' + (f' (HTTP {e.status})' if e.status else ''), file=sys.stderr, flush=True)
    text = str(e)
    if 'conflict' in text.lower() or '冲突' in text:
        return TEMPLATE_CONFLICT
    if e.kind in TEMPLATE_ERRORS:
        return TEMPLATE_ERRORS[e.kind]
    if e.kind == 'http':
        return 502, 'xunji_rejected', '训记没接受这次修改：' + xunji_says(text, key)
    return TEMPLATE_OTHER


def clip_response(data):
    """训记's answer as JSON text, at most XUNJI_RESPONSE_MAX characters."""
    try:
        text = dumps(data, separators=(',', ':'))
    except (TypeError, ValueError):
        text = str(data)
    return text[:XUNJI_RESPONSE_MAX]


def folder_fields(folder, now):
    """meta/xunji fields from an Agent folder answer: agentTemplates [{template_id, name, version?}] and when."""
    found = xj.agent_templates(folder)
    if found is None:  # a shape we don't know: keep a short copy for Claude, show an empty list
        return {'agentTemplates': [], 'agentTemplatesAt': now, 'agentTemplatesRaw': clip_response(folder)[:2000]}
    return {'agentTemplates': found, 'agentTemplatesAt': now, 'agentTemplatesRaw': {'__delete__': True}}


def templates_state(c, uid, d, response, folder, now):
    """meta/xunji.templatesState after a change went into 训记: {plan day id: {name, template_id?, at, planUpdatedAt}} for
    every upsert the proposal's `days` ties to a plan day; a deleted template's day is dropped."""
    mutation = d.get('mutation') if isinstance(d.get('mutation'), dict) else {}
    days = d.get('days') if isinstance(d.get('days'), dict) else {}
    plan_updated = doc_data(c, uid, 'plan', 'current').get('updatedAt')
    made = xj.created_ids(response)
    by_name, listed = {}, (xj.agent_templates(folder) if folder is not None else None) or []
    for t in listed:
        if t.get('name') and t.get('template_id') is not None:
            by_name.setdefault(t['name'], []).append(t['template_id'])
    state = {}
    for u in mutation.get('upserts') or []:
        if not isinstance(u, dict):
            continue
        day = next((days[str(u[k])] for k in ('client_id', 'template_id') if u.get(k) is not None and str(u[k]) in days), None)
        if not isinstance(day, str) or not day:
            continue
        tid = u.get('template_id') or made.get(u.get('client_id'))
        if tid is None and len(by_name.get(u.get('name'), [])) == 1:
            tid = by_name[u['name']][0]
        state[day] = {'name': u.get('name'), 'template_id': tid if tid is not None else {'__delete__': True},
                      'at': now, 'planUpdatedAt': plan_updated}
    gone = {str(x.get('template_id') if isinstance(x, dict) else x) for x in mutation.get('deletes') or []}
    old = doc_data(c, uid, 'meta', 'xunji').get('templatesState')
    for day, entry in (old.items() if isinstance(old, dict) else []):
        if day not in state and isinstance(entry, dict) and str(entry.get('template_id')) in gone:
            state[day] = {'__delete__': True}
    return state


def templates_text(mutation):
    """「写进训记：胸 三头、背 二头；删了 1 个旧模版」"""
    mutation = mutation if isinstance(mutation, dict) else {}
    names = [str(u.get('name')) for u in mutation.get('upserts') or [] if isinstance(u, dict)]
    bits = ['、'.join(names)] if names else []
    if mutation.get('deletes'):
        bits.append(f'删了 {len(mutation["deletes"])} 个旧模版')
    fu = mutation.get('folder_update')
    if isinstance(fu, dict) and fu.get('name'):
        bits.append(f'文件夹改名为「{fu["name"]}」')
    return '写进训记：' + ('；'.join(bits) or '模版改动')


def finish_xunji(uid, inbox_id, ok, error=None, response=None, folder=None):
    """Record how a 「写进训记」 went: the proposal (accepted / failed with the reason), and on success meta/xunji
    (templatesState, agentTemplates) and a log line of what went into 训记. Written whatever the proposal's status is
    now: 训记 has (or hasn't) changed either way."""
    now = now_iso()

    def writes(c):
        inbox = get_doc(c, uid, 'inbox', inbox_id)
        d = inbox['data'] if inbox and isinstance(inbox['data'], dict) else {}
        title = short(d.get('title') or '把计划写进训记')
        ref = 'inbox/' + inbox_id
        result = {'ok': ok, 'at': now, **({'response': clip_response(response)} if ok else {'error': error})}
        ops = [{'op': 'merge', 'collection': 'inbox', 'id': inbox_id,
                'data': {'status': 'accepted' if ok else 'failed', 'decidedAt': now, 'needsReview': True, 'result': result}}]
        if not ok:
            return ops + [log_op(now, 'decision', f'你同意了：{title}，但没写进训记：{error}', ref)]
        meta = {'templatesState': templates_state(c, uid, d, response, folder, now)}
        if folder is not None:
            meta.update(folder_fields(folder, now))
        return ops + [{'op': 'merge', 'collection': 'meta', 'id': 'xunji', 'data': meta},
                      log_op(now, 'decision', f'你同意了：{title}', ref),
                      log_op(now, 'xunji', templates_text(d.get('mutation')), ref)]
    out = run_writes(uid, writes)
    if not ok:
        return {'ok': False, 'inbox': out[0], 'log': out[1:]}
    return {'ok': True, 'inbox': out[0], 'meta': out[1], 'log': out[2:]}


def accept_xunji(uid, inbox_id):
    """「写进训记」: check the proposal's mutation (训记's limits; not the movement names: Claude checked those), then send
    it to 训记 with the person's template key, confirmed, under a mutation_id tied to this proposal. At most one go per
    person every XUNJI_TPL_EVERY seconds. Success → accepted; any failure → failed with the reason (409/4xx/5xx)."""
    inbox = open_inbox(conn(), uid, inbox_id)  # first look; finish_xunji records the outcome in its own transaction
    key = xunji_key(uid, 'template')
    if not key:
        raise ApiError(400, 'no_template_key', '还没存训记模版 key：在「我的 → 训记」里填')
    mutation = inbox['data'].get('mutation')
    _, problems = xj.summarize_mutation(mutation)
    if problems:
        error = '提案没通过检查：' + '；'.join(problems)
        out = finish_xunji(uid, inbox_id, False, error=short(error, 300))
        raise ApiError(400, 'invalid_mutation', out['inbox']['data']['result']['error'], {'inbox': out['inbox'], 'log': out['log']})
    with XUNJI_SUBMITTING_LOCK:
        if inbox_id in XUNJI_SUBMITTING:
            raise ApiError(409, 'busy', '正在写进训记，稍等')
        wait = XUNJI_TPL_LIMIT.take(uid)
        if wait:
            raise ApiError(429, 'rate_limited', f'刚写过训记，{wait} 秒后再试', {'retryAfter': wait})
        XUNJI_SUBMITTING.add(inbox_id)
    try:
        try:
            response = xj.mutate_agent_templates(key, mutation, xj.mutation_id(inbox_id, mutation),
                                                 timeout=XUNJI_TIMEOUT, max_wait=XUNJI_MAX_WAIT)
        except xj.XunjiError as e:
            status, code, error = template_failure(e, key)
            out = finish_xunji(uid, inbox_id, False, error=error)
            raise ApiError(status, code, error, {'inbox': out['inbox'], 'log': out['log']})
        folder = None
        try:  # what the folder holds now, for the page
            if XUNJI_PAUSE:
                time.sleep(XUNJI_PAUSE)
            folder = xj.read_agent_templates(key, timeout=XUNJI_TIMEOUT, max_wait=0)
        except xj.XunjiError as e:
            print(f'训记 template read after a change failed: {e.kind}', file=sys.stderr, flush=True)
        return finish_xunji(uid, inbox_id, True, response=response, folder=folder)
    finally:
        with XUNJI_SUBMITTING_LOCK:
            XUNJI_SUBMITTING.discard(inbox_id)


def accept_inbox(uid, inbox_id, body):
    check_path('inbox', inbox_id, need_id=True)
    kind = doc_data(conn(), uid, 'inbox', inbox_id).get('kind')
    if kind == 'xunji':
        return accept_xunji(uid, inbox_id)
    if kind == 'question':
        return answer_question(uid, inbox_id, body)
    return accept_plan(uid, inbox_id)  # kind plan (and 404 / not open from inside)


class Handler(BaseHTTPRequestHandler):
    server_version = 'lianshiji'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        pass  # nginx keeps the access log

    # ---- helpers ----
    def client_ip(self):
        """The client's address. X-Real-IP (set by nginx) is believed only when the connection comes from this machine."""
        peer = self.client_address[0]
        real = (self.headers.get('X-Real-IP') or '').strip()
        return real[:64] if real and is_loopback(peer) else peer

    def session_token(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
        except cookies.CookieError:
            return None
        return jar[COOKIE].value if COOKIE in jar else None

    def resolve_auth(self):
        """Sets self.user (the person whose data this request touches) and self.service (bearer token).
        self.session_hash is set only for a page login (session cookie); self.scope only for an upload token."""
        self.user, self.service, self.session_hash, self.scope = None, False, None, None
        h = self.headers.get('Authorization', '').strip()
        if h.startswith('lsj_'):  # an upload token pasted into the Shortcut without "Bearer "
            h = 'Bearer ' + h
        if h.startswith('Bearer '):
            tok = h[7:].strip()
            if hmac.compare_digest(as_bytes(tok), as_bytes(TOKEN)):
                self.service = True
                key = self.headers.get('X-LSJ-User')
                if key:
                    u = find_user(key)
                    if not u:
                        raise ApiError(404, 'no_such_user', f'no user {key}')
                    self.user = u
                return
            th = token_hash(tok)
            row = conn().execute('SELECT uid, scope FROM tokens WHERE token_hash=?', (th,)).fetchone()
            u = user_by_id(row[0]) if row else None
            if not u or u['disabled']:
                raise ApiError(401, 'bad_token', 'unknown or revoked token')
            self.user, self.scope = u, row[1]
            with write_lock:
                conn().execute('UPDATE tokens SET last_used=? WHERE token_hash=?', (now_iso(), th))
            return
        tok = self.session_token()
        if not tok:
            return
        c = conn()
        row = c.execute('SELECT uid, expires_at, last_seen FROM sessions WHERE token_hash=?', (token_hash(tok),)).fetchone()
        if not row or row[1] < time.time():
            return
        u = user_by_id(row[0])
        if not u or u['disabled']:
            return
        self.user, self.session_hash = u, token_hash(tok)
        if not row[2] or row[2] < now_iso()[:15]:  # touch at most every ~10 minutes
            with write_lock:
                c.execute('UPDATE sessions SET last_seen=? WHERE token_hash=?', (now_iso(), self.session_hash))
                c.execute('UPDATE users SET last_seen=? WHERE id=?', (now_iso(), u['id']))

    def check_browser_request(self, method, parts):
        """CSRF guard for the page (session cookie; login and the sign-up with an invite too). Writes must come from our
        own origin and carry JSON, or an image for a photo upload. Bearer-token clients (CLI, Shortcut) don't use cookies
        and skip this."""
        if method in ('GET', 'HEAD') or not (self.session_hash or parts in PUBLIC_POSTS):
            return
        origin, site = self.headers.get('Origin'), self.headers.get('Sec-Fetch-Site')
        if origin is not None or site is not None:  # browsers send at least one; curl and old browsers neither
            want = ('https://' if COOKIE_SECURE else 'http://') + (self.headers.get('Host') or '').strip()
            if (origin or '').strip().lower() != want.lower() and (site or '').strip().lower() not in ('same-origin', 'none'):
                raise ApiError(403, 'cross_site', 'request from another site refused')
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if parts == ['photos']:  # the raw image
            if ctype.startswith('image/') or ctype == 'application/octet-stream':
                return
            raise ApiError(415, 'unsupported_type', 'send the photo with an image/* Content-Type')
        if (ctype or self.unread) and ctype != 'application/json':
            raise ApiError(415, 'unsupported_type', 'send JSON with Content-Type: application/json')

    def send(self, status, body=b'', ctype='application/json; charset=utf-8', headers=None):
        self.responded = True
        self.send_response(status)
        if status not in (204, 304):
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if ctype.startswith('text/html'):
            self.send_header('Content-Security-Policy', CSP)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if self.unread:  # a body we never read would be taken for the next request: end the connection instead
            self.send_header('Connection', 'close')
        self.end_headers()
        if self.command != 'HEAD' and status not in (204, 304):
            self.wfile.write(body)

    def json(self, status, obj, headers=None):
        self.send(status, dumps(obj).encode(), headers=headers)

    def body_length(self):
        """Content-Length of the request. A body we can't frame safely is refused (and the connection closed)."""
        if self.headers.get('Transfer-Encoding'):
            raise ApiError(411, 'length_required', 'send the body with a Content-Length')
        vals = [v.strip() for v in self.headers.get_all('Content-Length') or []]
        if not vals:
            return 0
        if len(set(vals)) != 1 or not re.fullmatch(r'[0-9]{1,15}', vals[0]):
            raise ApiError(400, 'invalid_argument', 'bad Content-Length')
        return int(vals[0])

    def read_body(self, limit):
        n = self.unread
        if n > limit:
            raise ApiError(413, 'too_large', 'body too large')
        self.unread = 0
        return self.rfile.read(n) if n else b''

    def read_json(self, limit=MAX_JSON):
        raw = self.read_body(limit)
        if not raw:
            return None
        try:
            return loads_request(raw.decode('utf-8-sig'))
        except UnicodeDecodeError:
            raise ApiError(400, 'invalid_argument', 'body is not UTF-8')
        except (ValueError, RecursionError):
            raise ApiError(400, 'invalid_argument', f'body is not valid JSON (no NaN or Infinity, at most {MAX_DEPTH} levels deep)')

    def read_obj(self, limit=MAX_JSON):
        """A JSON object body ({} when empty)."""
        body = self.read_json(limit)
        if body is None:
            return {}
        if not isinstance(body, dict):
            raise ApiError(400, 'invalid_argument', 'send a JSON object')
        return body

    def if_version(self):
        return parse_version(self.headers.get('If-Match'), 'If-Match')

    # ---- dispatch ----
    def do_GET(self):
        self.route('GET')

    def do_HEAD(self):
        self.route('GET')

    def do_POST(self):
        self.route('POST')

    def do_PUT(self):
        self.route('PUT')

    def do_PATCH(self):
        self.route('PATCH')

    def do_DELETE(self):
        self.route('DELETE')

    def route(self, method):
        self.unread, self.responded, path = 1, False, ''  # unread stays non-zero until we know the body's length
        try:
            url = urlparse(self.path)
            path, qs = url.path, parse_qs(url.query)
            self.unread = self.body_length()
            self.resolve_auth()
            if path.startswith('/api/'):
                return self.api(method, [unquote(p) for p in path[5:].strip('/').split('/')], qs)
            return self.page(method, path)
        except ApiError as e:
            self.fail(path, e.status, {'code': e.code, 'message': e.message, **e.extra}, e.zh)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:  # keep the server alive; the details go to the journal, not to the client
            print(f'{method} {path}: unexpected error', file=sys.stderr, flush=True)
            traceback.print_exc()
            sys.stderr.flush()
            self.fail(path, 500, {'code': 'internal', 'message': '服务器出错了，稍后再试'})

    def fail(self, path, status, err, zh=None):
        if self.responded:  # the response had already started: nothing sensible can follow it
            self.close_connection = True
            return
        out = {'error': err}
        if path.startswith('/api/ingest/'):  # the Shortcut shows "message" in its notification
            out['message'] = zh or INGEST_ERRORS.get(err['code']) or '同步失败：' + err['message']
        try:
            self.json(status, out)
        except OSError:
            self.close_connection = True

    def page(self, method, path):
        if method != 'GET':
            raise ApiError(405, 'method_not_allowed', 'method not allowed')
        logged_in = self.session_hash is not None  # a page login is a session cookie, not an upload or CLI token
        if FONT_RE.fullmatch(path):
            return self.static(path[1:], 'font/woff2', cache=True)
        m = IMAGE_RE.fullmatch(path)
        if m:  # icons and launch screens (app/web/icons/, app/web/splash/): no login, cached for a week
            return self.static(path[1:], IMAGE_TYPES[m.group(2)], cache=True)
        if path == '/shortcut':  # the signed 「同步健康」 Shortcut, built by deploy/make-shortcut.py
            if not logged_in:
                return self.send(302, headers={'Location': '/login'})
            return self.static('lianshiji-health.shortcut', 'application/octet-stream', cache=False,
                               headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote('同步健康.shortcut')})
        if path == '/sw.js':  # the service worker (push notifications): it may control the whole site
            return self.static('sw.js', ASSET_TYPES['js'], cache=False, headers={'Service-Worker-Allowed': '/'})
        m = ASSET_RE.fullmatch(path)
        if m:  # revalidated on every load, so a deploy never leaves an old script running against a new server
            return self.static(path[1:], ASSET_TYPES[m.group(2)], cache=False)
        if path not in STATIC:
            return self.send(404, b'not found', 'text/plain; charset=utf-8')
        if path == '/' and not logged_in:
            return self.send(302, headers={'Location': '/login'})
        name, ctype = STATIC[path]
        return self.static(name, ctype, cache=not ctype.startswith('text/html'))  # pages revalidate on every load

    def static(self, name, ctype, cache, headers=None):
        """A file from WEB. cache=False: the browser revalidates each time (ETag / Last-Modified → 304)."""
        p = os.path.join(WEB, name)
        if not os.path.isfile(p):
            return self.send(404, b'not found', 'text/plain; charset=utf-8')
        with open(p, 'rb') as f:
            body = f.read()
            mtime = os.fstat(f.fileno()).st_mtime
        etag = '"' + hashlib.sha256(body).hexdigest()[:24] + '"'
        hdrs = {'Cache-Control': 'public, max-age=604800' if cache else 'no-cache', 'ETag': etag,
                'Last-Modified': email.utils.formatdate(mtime, usegmt=True), **(headers or {})}
        if self.not_modified(etag, mtime):
            return self.send(304, b'', ctype, hdrs)
        self.send(200, body, ctype, hdrs)

    def not_modified(self, etag, mtime):
        inm = self.headers.get('If-None-Match')
        if inm is not None:
            tags = [t.strip() for t in inm.split(',')]
            return '*' in tags or etag in tags or 'W/' + etag in tags
        ims = self.headers.get('If-Modified-Since')
        if ims:
            try:
                return int(mtime) <= email.utils.parsedate_to_datetime(ims).timestamp()
            except (TypeError, ValueError, IndexError, OverflowError):
                return False
        return False

    def api(self, method, parts, qs):
        head = parts[0] if parts else ''
        self.check_browser_request(method, parts)
        if parts == ['login'] and method == 'POST':
            return self.login()
        if parts in (['join'], ['join', 'check']) and method == 'POST':
            return self.join(parts[1:])
        if parts == ['logout'] and method == 'POST':
            if self.session_hash:
                with write_lock:
                    conn().execute('DELETE FROM sessions WHERE token_hash=?', (self.session_hash,))
            return self.json(200, {'ok': True}, {'Set-Cookie': session_cookie('', 0)})
        if self.scope is not None:  # upload-only tokens reach the two upload endpoints, nothing else
            if self.user and parts == ['ingest', 'sleep'] and method == 'POST':
                return self.ingest_sleep(self.user['id'])
            if self.user and parts == ['ingest', 'health'] and method == 'POST':
                return self.ingest_health(self.user['id'])
            raise ApiError(403, 'forbidden', 'this token can only upload Apple Health data')
        if head == 'admin':
            return self.admin(method, parts[1:])
        if not self.user:
            if self.service:
                raise ApiError(400, 'user_required', 'send X-LSJ-User with the username to act for')
            raise ApiError(401, 'unauthenticated', 'login required')
        uid = self.user['id']
        if head == 'me':
            if self.service:
                raise ApiError(403, 'forbidden', 'the CLI token cannot manage accounts or tokens')
            return self.me(method, parts[1:])
        if self.user['must_change'] and not self.service:
            raise ApiError(403, 'must_change_password', 'set a new password first')
        if head == 'rev' and method == 'GET':
            return self.json(200, {'rev': rev(uid)})
        if head in ('inbox', 'log') and len(parts) == 3 and method == 'POST':
            return self.decide(head, parts[1], parts[2], uid)
        if head == 'push':
            return self.push(method, parts[1:], uid)
        if head == 'xunji':
            if self.service:
                raise ApiError(403, 'forbidden', 'the 训记 keys, web sync and remap are for the page only')
            return self.xunji(method, parts[1:], uid, qs)
        if head == 'c' and len(parts) == 2 and method == 'GET':
            return self.json(200, {'docs': list_docs(uid, parts[1], qs), 'rev': rev(uid)})
        if head == 'd' and len(parts) == 3:
            col, doc_id = parts[1], parts[2]
            check_path(col, doc_id, need_id=True)
            if method == 'GET':
                d = get_doc(conn(), uid, col, doc_id)
                if not d:
                    raise ApiError(404, 'not_found', 'no such document')
                return self.json(200, d)
            op = {'PUT': 'set', 'PATCH': 'update', 'DELETE': 'delete'}.get(method)
            if not op:
                raise ApiError(405, 'method_not_allowed', 'method not allowed')
            data = self.read_json() if op != 'delete' else None
            out = run_writes(uid, [{'op': op, 'collection': col, 'id': doc_id, 'data': data, 'ifVersion': self.if_version()}])
            return self.json(200, out[0] or {'deleted': True})
        if head == 'batch' and method == 'POST':
            ops = self.read_json()
            if not isinstance(ops, list) or not 1 <= len(ops) <= MAX_BATCH:
                raise ApiError(400, 'invalid_argument', f'batch takes a list of 1-{MAX_BATCH} writes')
            return self.json(200, {'results': run_writes(uid, ops)})
        if head == 'photos':
            return self.photos(method, parts[1:], uid)
        if head == 'export' and method == 'GET':
            return self.export(uid)
        raise ApiError(404, 'not_found', 'no such endpoint')

    # ---- auth & account ----
    def check_password_limited(self, username, password, stored):
        """check_password behind the attempt limiter (login and password change share it). Raises 429 when limited."""
        attempt = PASSWORD_LIMIT.attempt(username, self.client_ip())
        if attempt is None:
            raise ApiError(429, 'rate_limited', 'too many wrong passwords, wait 10 minutes')
        if check_password(password, stored):
            PASSWORD_LIMIT.succeeded(attempt)
            return True
        time.sleep(LOGIN_FAIL_DELAY)
        return False

    def login(self):
        body = self.read_obj(MAX_LOGIN_BODY)
        username = str(body.get('username', '')).strip().lower()[:64]
        u = user_by_name(username) if username else None  # by username only, never by internal id
        # an unknown user is checked against a dummy hash, so the answer takes as long either way
        ok = self.check_password_limited(username, str(body.get('password', '')), u['pw_hash'] if u else DUMMY_HASH)
        if not (ok and u and not u['disabled']):
            raise ApiError(401, 'wrong_password', 'wrong username or password')
        tok = new_session(u['id'], self.headers.get('User-Agent'))
        with write_lock:
            conn().execute('UPDATE users SET last_seen=? WHERE id=?', (now_iso(), u['id']))
        self.json(200, user_out(u), {'Set-Cookie': session_cookie(tok)})

    def join(self, parts):
        """POST /api/join/check {code} → {ok, note?}, and POST /api/join {code, username, name, password} → a member
        account, logged in right away (the session cookie /api/login sets) → {ok, me}. No login needed. A wrong, used-up,
        expired or revoked code all get the same 400 invalid_invite. Per address: JOIN_MAX_FAILS failed tries in
        JOIN_WINDOW seconds, then 429 (a try is counted up front and given back when it goes through, like the login
        limits); JOIN_MAX_DONE accounts an hour."""
        ip = self.client_ip()
        attempt = JOIN_FAILS.take(ip)
        if attempt is None:
            wait = JOIN_FAILS.wait(ip)
            raise ApiError(429, 'rate_limited', '试得太多了，过一会儿再试', {'retryAfter': wait})
        try:
            if parts == ['check']:
                self.join_check()
            else:
                self.join_create(ip)
        except ApiError as e:
            if e.code == 'invalid_invite':
                time.sleep(LOGIN_FAIL_DELAY)
            raise
        JOIN_FAILS.give_back(attempt)

    def join_check(self):
        inv = usable_invite(conn(), self.read_obj(MAX_LOGIN_BODY).get('code'))
        if not inv:
            raise ApiError(400, 'invalid_invite', INVALID_INVITE)
        self.json(200, {'ok': True, **({'note': inv['note']} if inv['note'] else {})})

    def join_create(self, ip):
        body = self.read_obj(MAX_LOGIN_BODY)
        code, password = body.get('code'), body.get('password')
        username = str(body.get('username', '')).strip().lower()
        name = ' '.join(str(body.get('name') or '').split())[:40] or username
        if not usable_invite(conn(), code):  # first look; checked again in the transaction that uses it up
            raise ApiError(400, 'invalid_invite', INVALID_INVITE)
        if not USERNAME_RE.fullmatch(username):
            raise ApiError(400, 'bad_username', '用户名是 2–32 位小写字母、数字或 _ . -')
        if not isinstance(password, str) or len(password) < 8:
            raise ApiError(400, 'weak_password', '密码至少 8 位')
        if find_user(username):
            raise ApiError(409, 'username_taken', '这个用户名已经有人用了')
        done = JOIN_DONE.take(ip)
        if done is None:
            raise ApiError(429, 'rate_limited', '这个网络这一小时注册的账号太多了，过一会儿再试', {'retryAfter': JOIN_DONE.wait(ip)})
        uid, pw_hash, now = new_uid(), hash_password(password), now_iso()
        try:
            with transaction() as c:
                inv = usable_invite(c, code)
                if not inv:
                    raise ApiError(400, 'invalid_invite', INVALID_INVITE)
                if find_user(username):
                    raise ApiError(409, 'username_taken', '这个用户名已经有人用了')
                c.execute('UPDATE invites SET uses=uses+1 WHERE id=?', (inv['id'],))
                c.execute('INSERT INTO users (id, username, name, role, pw_hash, must_change, created_at, last_seen, invite_id) '
                          'VALUES (?,?,?,?,?,0,?,?,?)', (uid, username, name, 'member', pw_hash, now, now, inv['id']))
        except Exception:
            JOIN_DONE.give_back(done)
            raise
        print(f'new account {username} ({uid}) signed up with invite {inv["id"]}', flush=True)
        if self.session_hash:  # someone logged in on this browser signed up anew: that login ends here
            with write_lock:
                conn().execute('DELETE FROM sessions WHERE token_hash=?', (self.session_hash,))
        tok = new_session(uid, self.headers.get('User-Agent'))
        tell_admins_about(name, username, inv['note'])
        self.json(200, {'ok': True, 'me': me_out(user_by_id(uid))}, {'Set-Cookie': session_cookie(tok)})

    def delete_me(self, u):
        """DELETE /api/me {password}: the person closes their own account (page login only; /api/me refuses the CLI
        token). Everything goes: records, photos, upload tokens, 训记 keys, push subscriptions, sessions. The last active
        admin can't (409 last_admin). A wrong password is a 400 and counts against the login limits."""
        body = self.read_obj(MAX_LOGIN_BODY)
        if u['role'] == 'admin' and active_admins(exclude=u['id']) == 0:
            raise ApiError(409, 'last_admin', '你是最后一个管理员，不能注销：先把管理员交给别人')
        if not self.check_password_limited(u['username'], str(body.get('password', '')), u['pw_hash']):
            raise ApiError(400, 'wrong_password', '密码不对')
        print(f'account {u["username"]} ({u["id"]}) deleted by its owner', flush=True)
        delete_account(u['id'], keep_an_admin=True)
        return self.json(200, {'deleted': True}, {'Set-Cookie': session_cookie('', 0)})

    def site(self):
        """This site's address for links: LSJ_PUBLIC_URL, else the Host the request came to."""
        if PUBLIC_URL:
            return PUBLIC_URL
        host = (self.headers.get('Host') or '').strip()
        if not re.fullmatch(r'[A-Za-z0-9.\-]{1,253}(:[0-9]{1,5})?|\[[0-9A-Fa-f:.]{2,45}\](:[0-9]{1,5})?', host):
            host = f'{HOST}:{PORT}'
        return ('https://' if COOKIE_SECURE else 'http://') + host

    def invites(self, method, parts):
        """The admin's invites: GET list, POST make one (the code and link are in this answer only), DELETE /<id> revoke."""
        if not parts and method == 'GET':
            return self.json(200, {'invites': list_invites()})
        if not parts and method == 'POST':
            invite, code = create_invite(self.user['id'], self.read_obj())
            return self.json(200, {'invite': invite, 'code': code, 'link': f'{self.site()}/join?code={code}'})
        if len(parts) == 1 and method == 'DELETE':
            self.read_obj()
            return self.json(200, {'ok': True, 'invite': revoke_invite(parts[0])})
        raise ApiError(404, 'not_found', 'no such endpoint')

    def me(self, method, parts):
        u = self.user
        c = conn()
        if not parts and method == 'GET':
            out = me_out(u)
            out['sessions'] = c.execute('SELECT COUNT(*) FROM sessions WHERE uid=? AND expires_at > ?', (u['id'], int(time.time()))).fetchone()[0]
            return self.json(200, out)
        if not parts and method == 'PATCH':
            name = str(self.read_obj().get('name', '')).strip()[:40]
            if not name:
                raise ApiError(400, 'invalid_argument', 'name is empty')
            with write_lock:
                c.execute('UPDATE users SET name=? WHERE id=?', (name, u['id']))
            return self.json(200, me_out(user_by_id(u['id'])))
        if parts == ['password'] and method == 'POST':
            body = self.read_obj(MAX_LOGIN_BODY)
            new = str(body.get('new', ''))
            if not self.check_password_limited(u['username'], str(body.get('current', '')), u['pw_hash']):
                raise ApiError(400, 'wrong_password', 'current password is wrong')
            if len(new) < 8:
                raise ApiError(400, 'weak_password', 'password needs at least 8 characters')
            with write_lock:
                c.execute('UPDATE users SET pw_hash=?, must_change=0 WHERE id=?', (hash_password(new), u['id']))
                c.execute('DELETE FROM sessions WHERE uid=? AND token_hash != ?', (u['id'], self.session_hash or ''))
            return self.json(200, me_out(user_by_id(u['id'])))
        if not parts and method == 'DELETE':
            return self.delete_me(u)
        if parts == ['logout-others'] and method == 'POST':
            with write_lock:
                n = c.execute('DELETE FROM sessions WHERE uid=? AND token_hash != ?', (u['id'], self.session_hash or '')).rowcount
            return self.json(200, {'removed': n})
        if parts == ['tokens'] and method == 'GET':
            rows = c.execute('SELECT token_hash, name, created_at, last_used FROM tokens WHERE uid=? ORDER BY created_at', (u['id'],)).fetchall()
            return self.json(200, {'tokens': [{'id': r[0][:16], 'name': r[1], 'createdAt': r[2], 'lastUsed': r[3]} for r in rows]})
        if parts == ['tokens'] and method == 'POST':
            name = str(self.read_obj().get('name', '')).strip()[:40] or '快捷指令'
            if c.execute('SELECT COUNT(*) FROM tokens WHERE uid=?', (u['id'],)).fetchone()[0] >= MAX_TOKENS:
                raise ApiError(400, 'too_many_tokens', 'revoke an old token first')
            tok = 'lsj_' + secrets.token_urlsafe(24)
            with write_lock:
                c.execute('INSERT INTO tokens VALUES (?,?,?,?,?,NULL)', (token_hash(tok), u['id'], name, 'ingest', now_iso()))
            return self.json(200, {'token': tok, 'id': token_hash(tok)[:16], 'name': name})
        if len(parts) == 2 and parts[0] == 'tokens' and method == 'DELETE' and re.fullmatch(r'[0-9a-f]{16}', parts[1]):
            with write_lock:
                n = c.execute('DELETE FROM tokens WHERE uid=? AND substr(token_hash, 1, 16)=?', (u['id'], parts[1])).rowcount
            return self.json(200, {'deleted': n > 0})
        raise ApiError(404, 'not_found', 'no such endpoint')

    def ingest_sleep(self, uid):
        """The older one-request sleep upload: {"samples": [{"value", "start", "end"}, …]}."""
        body = self.read_json()
        samples = body.get('samples') if isinstance(body, dict) else body
        if not isinstance(samples, list):
            raise ApiError(400, 'invalid_argument', 'send {"samples": [{"value", "start", "end"}, …]}')
        night, unknown = summarize_sleep(samples)
        problems, now = [], now_iso()
        run_writes(uid, lambda c: sleep_writes(c, uid, night, now, problems))
        md = month_day(night['date'])
        if MANUAL_NIGHT in problems:
            msg = f'{md} 的睡眠你手动改过，这次没覆盖'
        elif problems:  # a fuller copy of this night was already stored
            kept = doc_data(conn(), uid, 'sleep', night['date'])
            msg = f'{md} 已有更完整的睡眠记录（{kept.get("bedtime", "")}–{kept.get("wake", "")}，睡了 {fmt_hm(kept["asleep"])}），这次没覆盖'
        else:
            msg = f'已同步 {md} 的睡眠：{night["bedtime"]}–{night["wake"]}，睡了 {fmt_hm(night["asleep"])}'
            if night['deep']:
                msg += f'，深睡 {fmt_hm(night["deep"])}'
        if unknown:
            msg += f'。有 {len(unknown)} 种数据没认出来：{"、".join(unknown)}'
        return self.json(200, {'ok': True, 'message': msg, 'sleep': night, 'problems': problems, 'unknownValues': unknown})

    def ingest_health(self, uid):
        """One Shortcut, everything at once: sleep_v/_s/_e plus weight, steps, active, rhr, hrv, bodyfat, hr, kcals as _v/_s
        line lists (or one metric per request: {"metric", "v", "s", "e", "src"}). hr and kcals are single samples, with
        their source names in hr_src / kcals_src (optional), that only go onto workouts (workout_updates), never into
        health/<day>."""
        body, sent = health_request(self.read_json())
        start_hour = day_start_of(conn(), uid)
        days, problems = summarize_health(body, start_hour)
        night, unknown = night_from_lists(body, problems)
        samples = workout_samples(body, problems)
        if not days and night is None and not samples:
            if problems:
                raise ApiError(400, 'no_data', '没有收到可用的健康数据：' + '；'.join(problems))
            # nothing new for this metric (no HRV reading yet today, no scale): not an error. No Watch, no samples: not news
            if sent not in WORKOUT_METRICS:
                problems.append(f'这次没有新的{HEALTH_NAMES.get(sent, "健康")}数据')
        elif days or night:
            now = now_iso()
            run_writes(uid, lambda c: health_writes(c, uid, days, night, now, problems))
        trains, written = workout_heart(uid, samples, problems) if samples else ([], [])
        latest = max([*days, *([night['date']] if night else [])], default=today(start_hour))
        msg = health_message(conn(), uid, latest, problems, unknown, trains)
        return self.json(200, {'ok': True, 'message': msg, 'days': days, 'problems': problems, 'unknownValues': unknown,
                               'workouts': written})

    def admin(self, method, parts):
        if self.service:
            if parts == ['users'] and method == 'GET':
                return self.json(200, {'users': [user_out(r, stats=True) for r in all_users()]})
            raise ApiError(403, 'forbidden', 'the CLI token can only list users')
        if not self.user:
            raise ApiError(401, 'unauthenticated', 'login required')
        if self.user['role'] != 'admin' or self.user['must_change']:
            raise ApiError(403, 'forbidden', 'admins only')
        me = self.user['id']
        c = conn()
        if parts == ['users'] and method == 'GET':
            return self.json(200, {'users': [user_out(r, stats=True) for r in all_users()]})
        if parts and parts[0] == 'invites':
            return self.invites(method, parts[1:])
        if parts == ['users'] and method == 'POST':
            body = self.read_obj()
            username = str(body.get('username', '')).strip().lower()
            name = str(body.get('name', '')).strip()[:40] or username
            role = 'admin' if body.get('role') == 'admin' else 'member'
            if not USERNAME_RE.fullmatch(username):
                raise ApiError(400, 'bad_username', 'username: 2-32 of a-z 0-9 _ . -')
            if find_user(username):
                raise ApiError(409, 'username_taken', 'username already exists')
            pw = temp_password()
            uid = new_uid()
            with write_lock:
                c.execute('INSERT INTO users (id, username, name, role, pw_hash, must_change, created_at) VALUES (?,?,?,?,?,1,?)',
                          (uid, username, name, role, hash_password(pw), now_iso()))
            return self.json(200, {'user': user_out(user_by_id(uid)), 'password': pw})
        if len(parts) >= 2 and parts[0] == 'users':
            target = find_user(parts[1])
            if not target:
                raise ApiError(404, 'not_found', 'no such user')
            tid = target['id']
            if parts[2:] == ['reset'] and method == 'POST':
                pw = temp_password()
                with write_lock:
                    c.execute('UPDATE users SET pw_hash=?, must_change=1 WHERE id=?', (hash_password(pw), tid))
                    c.execute('DELETE FROM sessions WHERE uid=?', (tid,))
                return self.json(200, {'user': user_out(user_by_id(tid)), 'password': pw})
            if len(parts) == 2 and method == 'PATCH':
                body = self.read_obj()
                sets, args = [], []
                if 'name' in body and str(body['name']).strip():
                    sets.append('name=?'); args.append(str(body['name']).strip()[:40])
                if 'role' in body:
                    role = 'admin' if body['role'] == 'admin' else 'member'
                    if tid == me and role != 'admin':
                        raise ApiError(400, 'self', 'you cannot remove your own admin role')
                    if role != 'admin' and target['role'] == 'admin' and active_admins(exclude=tid) == 0:
                        raise ApiError(400, 'last_admin', 'keep at least one admin')
                    sets.append('role=?'); args.append(role)
                if 'disabled' in body:
                    off = bool(body['disabled'])
                    if tid == me and off:
                        raise ApiError(400, 'self', 'you cannot disable yourself')
                    if off and target['role'] == 'admin' and active_admins(exclude=tid) == 0:
                        raise ApiError(400, 'last_admin', 'keep at least one admin')
                    sets.append('disabled=?'); args.append(1 if off else 0)
                if not sets:
                    raise ApiError(400, 'invalid_argument', 'nothing to change')
                with write_lock:
                    c.execute(f'UPDATE users SET {", ".join(sets)} WHERE id=?', (*args, tid))  # noqa: S608 (fixed column names)
                    if body.get('disabled'):  # signed out everywhere; upload tokens, 训记 keys and push subscriptions go too
                        c.execute('DELETE FROM sessions WHERE uid=?', (tid,))  # (re-enabling doesn't bring them back)
                        for table in ACCOUNT_TABLES:
                            c.execute(f'DELETE FROM {table} WHERE uid=?', (tid,))  # noqa: S608 (fixed names)
                if body.get('disabled'):
                    refresh_key_flags(tid)  # meta/xunji.keys: none stored any more
                    cancel_later(tid)
                return self.json(200, {'user': user_out(user_by_id(tid), stats=True)})
            if len(parts) == 2 and method == 'DELETE':
                if tid == me:
                    raise ApiError(400, 'self', 'you cannot delete yourself')
                if target['role'] == 'admin' and active_admins(exclude=tid) == 0:
                    raise ApiError(400, 'last_admin', 'keep at least one admin')
                delete_account(tid)
                return self.json(200, {'deleted': True})
        raise ApiError(404, 'not_found', 'no such endpoint')

    # ---- decisions ----
    def decide(self, col, doc_id, action, uid):
        """The person's own decisions: accept or decline one of Claude's proposals (inbox), undo what Claude changed
        (log). A page login only: Claude's CLI token can't agree to its own proposals, an upload token can't either."""
        if self.service or not self.session_hash:
            raise ApiError(403, 'forbidden', '只有本人在网页上才能做这个决定')
        body = self.read_obj()
        if col == 'inbox' and action == 'accept':
            return self.json(200, accept_inbox(uid, doc_id, body))
        if col == 'inbox' and action == 'decline':
            return self.json(200, decline_inbox(uid, doc_id))
        if col == 'log' and action == 'undo':
            return self.json(200, undo_log(uid, doc_id))
        raise ApiError(404, 'not_found', 'no such endpoint')

    # ---- 训记 ----
    def xunji_kind(self, raw):
        kind = 'train' if raw in (None, '') else raw
        if kind not in XUNJI_KINDS:
            raise ApiError(400, 'invalid_argument', 'kind 只能是 train（训练 key）或 template（模版 key）')
        return kind

    def xunji(self, method, parts, uid, qs=None):
        """Which 训记 keys are saved, saving or removing one, 「从训记同步」 and remapping imported workouts. The keys
        themselves never leave the server."""
        c = conn()
        if not parts and method == 'GET':
            saved = xunji_key_times(uid)
            return self.json(200, {'hasKey': 'train' in saved, 'keyUpdatedAt': saved.get('train'),
                                   'hasTemplateKey': 'template' in saved, 'templateKeyUpdatedAt': saved.get('template'),
                                   'webSync': doc_data(c, uid, 'meta', 'xunji').get('webSync')})
        if parts == ['key'] and method == 'PUT':
            body = self.read_obj(MAX_LOGIN_BODY)
            kind = self.xunji_kind(body.get('kind'))
            key = body.get('key')
            key = key.strip() if isinstance(key, str) else ''
            if not XUNJI_KEY_RE.fullmatch(key):
                raise ApiError(400, 'invalid_argument', '训记 key 应该是 8–200 个字符，不含空格')
            wait = XUNJI_KEY_LIMIT.take(uid)
            if wait:
                raise ApiError(429, 'rate_limited', f'试得太快了，{wait} 秒后再试', {'retryAfter': wait})
            out, extra = {'ok': True, 'kind': kind, 'verified': True}, None
            try:
                if kind == 'train':  # one light read of today: 训记 says right away whether it knows the key
                    xj.fetch_trains(key, today(day_start_of(c, uid)), False, timeout=XUNJI_TIMEOUT, max_wait=0)
                else:  # read the Agent folder: checks the key and shows the page what is in there
                    extra = folder_fields(xj.read_agent_templates(key, timeout=XUNJI_TIMEOUT, max_wait=0), now_iso())
                    out['agentTemplates'] = extra['agentTemplates']
            except xj.XunjiError as e:
                err = xunji_failed(e)
                if e.kind == 'invalid_key':
                    raise err
                out = {'ok': True, 'kind': kind, 'verified': False, 'message': 'key 已保存，但这次没能验证：' + err.message}
            save_xunji_key(uid, key, kind, extra)
            out['keyUpdatedAt'] = xunji_key_times(uid).get(kind)
            return self.json(200, out)
        if parts == ['key'] and method == 'DELETE':
            body = self.read_obj()
            kind = self.xunji_kind(((qs or {}).get('kind') or [None])[0] or body.get('kind'))
            return self.json(200, {'deleted': delete_xunji_key(uid, kind), 'kind': kind})
        if parts == ['remap'] and method == 'POST':
            self.read_obj()
            return self.json(200, remap_xunji(uid))
        if parts == ['sync'] and method == 'POST':
            self.read_obj()
            key = xunji_key(uid)
            if not key:
                raise ApiError(400, 'no_xunji_key', '还没保存训记训练 key：在「我的 → 训记」里填')
            wait = XUNJI_LIMIT.take(uid)
            if wait:
                raise ApiError(429, 'rate_limited', f'刚同步过，{wait} 秒后再试', {'retryAfter': wait})
            try:
                return self.json(200, xunji_web_sync(uid, key))
            except xj.XunjiError as e:
                err = xunji_failed(e)
                run_writes(uid, [web_sync_op(now_iso(), False, error=err.message)])
                raise err
        raise ApiError(404, 'not_found', 'no such endpoint')

    # ---- Web Push ----
    def push(self, method, parts, uid):
        """The page subscribes its device, sends itself a test and schedules / cancels the rest timer's reminder
        (/later); the service worker fetches what to show (/next); Claude (CLI token, X-LSJ-User names the person) or
        an admin sends (/send). The public key is for anyone logged in."""
        c = conn()
        if parts == ['key'] and method == 'GET':
            return self.json(200, {'key': vapid_keys()[1], 'subs': push_count(c, uid)})
        if parts == ['send'] and method == 'POST':
            body = self.read_obj()
            target = self.push_target(body)
            kind, title, text, url = push_request(body)
            if not push_wanted(c, target['id'], kind):  # the person turned this kind off
                return self.json(200, {'queued': False, 'sent': 0, 'failed': 0, 'subs': push_count(c, target['id']),
                                       'skipped': 'off', 'results': []})
            return self.json(200, send_push(target['id'], kind, title, text, url))
        if self.service or not self.session_hash:
            raise ApiError(403, 'forbidden', 'push subscriptions, test pushes and /api/push/next are for the page only')
        if parts == ['subscribe'] and method == 'POST':
            endpoint, p256dh, auth = parse_subscription(self.read_obj())
            n = push_subscribe(uid, endpoint, p256dh, auth, self.headers.get('User-Agent'))
            return self.json(200, {'ok': True, 'subs': n, 'key': vapid_keys()[1]})
        if parts == ['subscribe'] and method == 'DELETE':
            endpoint = self.read_obj().get('endpoint')
            if not isinstance(endpoint, str) or not endpoint:
                raise ApiError(400, 'invalid_argument', 'send {"endpoint": "…"}')
            with write_lock:
                n = c.execute('DELETE FROM push_subs WHERE uid=? AND endpoint=?', (uid, endpoint)).rowcount
            return self.json(200, {'deleted': n > 0, 'subs': push_count(c, uid)})
        if parts == ['test'] and method == 'POST':
            self.read_obj()
            return self.json(200, send_push(uid, 'test', '通知开好了', '日报写好、有提案等你拍板、回复了你的留言时，会这样提醒你', '/'))
        if parts == ['later'] and method == 'POST':  # the rest timer: one pending reminder per person, in memory
            delay, title, text, url = later_request(self.read_obj())
            skipped = 'nosub' if not push_count(c, uid) else 'off' if not push_wanted(c, uid, 'remind') else None
            if skipped:  # no device, or reminders turned off: nothing to schedule (a new request still replaces the old)
                cancel_later(uid)
                return self.json(200, {'id': None, 'skipped': skipped})
            if LATER_POSTS.take(uid) is None:
                raise ApiError(429, 'rate_limited', f'一分钟最多安排 {PUSH_LATER_PER_MINUTE} 次提醒，过一会儿再试',
                               {'retryAfter': LATER_POSTS.wait(uid)})
            return self.json(200, {'id': push_later(uid, delay, title, text, url)})
        if len(parts) == 2 and parts[0] == 'later' and method == 'DELETE':
            cancel_later(uid, parts[1])  # gone already, someone else's, never existed: all the same to the page
            return self.json(200, {'ok': True})
        if parts == ['next'] and method == 'GET':
            msg = next_push(uid, mark=self.command != 'HEAD')
            if not msg:
                return self.send(204, headers={'Cache-Control': 'no-store'})
            return self.json(200, msg, {'Cache-Control': 'no-store'})
        raise ApiError(404, 'not_found', 'no such endpoint')

    def push_target(self, body):
        """Whom /api/push/send is for: the CLI token's X-LSJ-User; for an admin on the page X-LSJ-User or "user" (else
        themselves). Nobody else sends."""
        if self.service:
            return self.user
        if self.session_hash and self.user['role'] == 'admin':
            key = self.headers.get('X-LSJ-User') or body.get('user')
            if not key:
                return self.user
            u = find_user(str(key))
            if not u:
                raise ApiError(404, 'no_such_user', f'no user {key}')
            return u
        raise ApiError(403, 'forbidden', '只有 Claude（CLI 令牌）或管理员能发通知')

    # ---- photos & export ----
    def photos(self, method, parts, uid):
        if method == 'POST' and not parts:
            body = self.read_body(MAX_PHOTO)
            if not body:
                raise ApiError(400, 'invalid_argument', 'empty upload')
            kind = next((v for k, v in PHOTO_TYPES.items() if body.startswith(k)), None)
            if kind is None and body[:4] == b'RIFF' and body[8:12] == b'WEBP':
                kind = ('image/webp', 'webp')
            if kind is None:
                raise ApiError(415, 'unsupported_type', 'only JPEG, PNG, WebP or GIF')
            pid = secrets.token_hex(16)
            d = photo_dir(uid)
            os.makedirs(d, exist_ok=True)
            tmp = os.path.join(d, f'.{pid}.tmp')
            with open(tmp, 'wb') as f:
                f.write(body)
            os.replace(tmp, os.path.join(d, f'{pid}.{kind[1]}'))
            return self.json(200, {'id': pid, 'url': f'/api/photos/{pid}', 'sizeBytes': len(body), 'contentType': kind[0]})
        if len(parts) == 1 and PHOTO_RE.fullmatch(parts[0]):
            p, ctype = photo_path(uid, parts[0])
            if method == 'GET':
                if not p:
                    raise ApiError(404, 'not_found', 'no such photo')
                with open(p, 'rb') as f:
                    return self.send(200, f.read(), ctype, {'Cache-Control': 'private, max-age=31536000, immutable'})
            if method == 'DELETE':
                if p:
                    try:
                        os.remove(p)
                    except FileNotFoundError:
                        p = None
                return self.json(200, {'deleted': bool(p)})
        raise ApiError(404, 'not_found', 'no such endpoint')

    def export(self, uid):
        rows = conn().execute('SELECT col, id, data, version, updated_at FROM docs WHERE uid=? ORDER BY col, id', (uid,)).fetchall()
        out = {'exportedAt': now_iso(), 'user': {'username': self.user['username'], 'name': self.user['name']}, 'collections': {}}
        for col, doc_id, data, version, updated_at in rows:
            out['collections'].setdefault(col, []).append({'id': doc_id, 'version': version, 'updatedAt': updated_at, 'data': loads_stored(data)})
        fname = f'lianshiji-{self.user["username"]}-{datetime.now(LOCAL_TZ).date().isoformat()}.json'
        body = dumps(out, indent=1).encode()
        self.send(200, body, 'application/json; charset=utf-8',
                  {'Content-Disposition': f"attachment; filename*=UTF-8''{quote(fname)}"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # socketserver listens with a backlog of 5; on Linux a burst of new connections past that (a page loading its
    # files at once, several people syncing) can be reset instead of queued
    request_queue_size = 128


def main():
    init_db()
    if len(sys.argv) == 3 and sys.argv[1] == '--reset-password':  # recovery when no admin can log in
        u = find_user(sys.argv[2].lower())
        if not u:
            raise SystemExit(f'no user {sys.argv[2]}')
        pw = temp_password()
        conn().execute('UPDATE users SET pw_hash=?, must_change=1, disabled=0 WHERE id=?', (hash_password(pw), u['id']))
        conn().execute('DELETE FROM sessions WHERE uid=?', (u['id'],))
        print(f'{u["username"]}: temporary password {pw} (must be changed at next login)')
        return
    if len(sys.argv) >= 3 and sys.argv[1] == '--set-xunji-key':  # a 训记 key, read from stdin
        # server.py --set-xunji-key <user> [--kind train|template]: the training key (「从训记同步」, the default) or
        # the Agent template key (「写进训记」). Not checked with 训记 here: the page checks a key when it is saved there.
        rest = sys.argv[3:]
        if rest not in ([], ['--kind', 'train'], ['--kind', 'template']):
            raise SystemExit('usage: server.py --set-xunji-key <user> [--kind train|template]')
        kind = rest[1] if rest else 'train'
        u = find_user(sys.argv[2].lower())
        if not u:
            raise SystemExit(f'no user {sys.argv[2]}')
        if u['disabled']:
            raise SystemExit(f'{u["username"]} is disabled')
        key = (getpass.getpass(f'训记 {kind} key: ') if sys.stdin.isatty() else sys.stdin.read()).strip()
        if not XUNJI_KEY_RE.fullmatch(key):
            raise SystemExit('a 训记 key is 8-200 printable characters without spaces')
        save_xunji_key(u['id'], key, kind)
        print('ok')
        return
    srv = Server((HOST, PORT), Handler)
    print(f'lianshiji listening on {HOST}:{PORT}, data in {DATA}, time zone {TZ_NAME}, day starts {DAY_START_HOUR}:00', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()

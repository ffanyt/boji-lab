"""Shared test plumbing: load app/server.py with a throwaway data dir and run it on a random port.

Stdlib only, synthetic data only. Run from the repo root:  python3 -m unittest discover -s tests -v
(set LSJ_REPO=/path/to/repo when the tests live somewhere else)
"""
import importlib.machinery
import importlib.util
import json
import os
import socket
import tempfile
import threading
import urllib.error
import urllib.request
from urllib.parse import urlparse

REPO = os.environ.get('LSJ_REPO') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SERVICE_TOKEN = 'test-service-token'
ADMIN_PW = 'Admin-pass-123'

_server_mod = None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None   # surface 302s to the test instead of following them


# no proxies: the test server is on 127.0.0.1 and a developer's HTTP proxy must not see it
_open = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect).open


def load_module(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def server_module():
    """Import app/server.py once. It reads its config from the environment at import time."""
    global _server_mod
    if _server_mod is None:
        os.environ['LSJ_TOKEN'] = SERVICE_TOKEN
        os.environ['LSJ_PASSWORD'] = ADMIN_PW
        os.environ['LSJ_DATA'] = tempfile.mkdtemp(prefix='lsj-test-')
        os.environ['LSJ_TZ'] = 'Asia/Shanghai'
        os.environ['LSJ_DAY_START_HOUR'] = '5'
        os.environ.pop('LSJ_COOKIE_SECURE', None)
        _server_mod = load_module('lsj_server', os.path.join(REPO, 'app', 'server.py'))
    return _server_mod


def xunji_module():
    return load_module('lsj_xunji', os.path.join(REPO, 'bin', 'xunji'))


class LiveServer:
    """A fresh database + HTTP server per test class."""

    def __init__(self):
        self.srv_mod = server_module()
        self.data = tempfile.mkdtemp(prefix='lsj-test-')
        self.srv_mod.DATA = self.data
        self.srv_mod._local.__dict__.clear()      # drop the cached sqlite connection of this thread
        self.srv_mod.PASSWORD_LIMIT.clear()
        self.srv_mod.JOIN_FAILS.clear()            # sign-up limits per address (everything here comes from 127.0.0.1)
        self.srv_mod.JOIN_DONE.clear()
        self.srv_mod.LATER_POSTS.clear()           # delayed reminders: the limit and any timer a previous class left
        with self.srv_mod._later_lock:
            for _, timer in self.srv_mod._later.values():
                timer.cancel()
            self.srv_mod._later.clear()
        self.srv_mod.LOGIN_FAIL_DELAY = 0          # wrong passwords answer at once in tests
        self.srv_mod.init_db()
        self.httpd = self.srv_mod.Server(('127.0.0.1', 0), self.srv_mod.Handler)
        self.port = self.httpd.server_address[1]
        self.base = f'http://127.0.0.1:{self.port}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class Client:
    """Tiny HTTP client. Keeps the session cookie by hand (the server marks it Secure, so cookiejar won't send it over http)."""

    def __init__(self, base, bearer=None, act_as=None):
        self.base, self.bearer, self.act_as, self.cookie = base, bearer, act_as, None
        self.headers = None   # response headers of the last request

    def req(self, method, path, body=None, headers=None, raw=False):
        h = {}
        data = None
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        elif body is not None:
            data = json.dumps(body).encode()
            h['Content-Type'] = 'application/json'
        if self.bearer:
            h['Authorization'] = 'Bearer ' + self.bearer
        if self.act_as:
            h['X-LSJ-User'] = self.act_as
        if self.cookie:
            h['Cookie'] = self.cookie
        h.update(headers or {})
        r = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with _open(r, timeout=20) as resp:
                status, payload, hdrs = resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as e:
            status, payload, hdrs = e.code, e.read(), e.headers
        self.headers = hdrs
        sc = hdrs.get('Set-Cookie')
        if sc and sc.startswith('lsj='):
            self.cookie = sc.split(';', 1)[0]
        if raw:
            return status, payload
        try:
            return status, json.loads(payload or b'null')
        except ValueError:
            return status, payload

    def login(self, username, password, headers=None):
        return self.req('POST', '/api/login', {'username': username, 'password': password}, headers)


def raw_http(base, data, timeout=3):
    """Send raw bytes on one connection; return (everything received, whether the server closed the connection)."""
    u = urlparse(base)
    s = socket.create_connection((u.hostname, u.port), timeout=timeout)
    try:
        s.sendall(data)
        chunks, closed = [], False
        try:
            while True:
                b = s.recv(65536)
                if not b:
                    closed = True
                    break
                chunks.append(b)
        except socket.timeout:
            pass
        return b''.join(chunks), closed
    finally:
        s.close()

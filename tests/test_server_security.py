"""Login hardening, CSRF, cookie flags and upload tokens following the account's state."""
import threading
import unittest

from helpers import ADMIN_PW, SERVICE_TOKEN, Client, LiveServer, raw_http

JPEG = b'\xff\xd8\xff\xe0' + b'\0' * 64


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.S = cls.live.srv_mod
        cls.admin = Client(cls.live.base)
        assert cls.admin.login('admin', ADMIN_PW)[0] == 200

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def setUp(self):
        self.S.PASSWORD_LIMIT.clear()

    def member(self, username, pw='Member-pass-123'):
        st, out = self.admin.req('POST', '/api/admin/users', {'username': username})
        self.assertEqual(st, 200, out)
        c = Client(self.live.base)
        self.assertEqual(c.login(username, out['password'])[0], 200)
        self.assertEqual(c.req('POST', '/api/me/password', {'current': out['password'], 'new': pw})[0], 200)
        return c, out['user']['id']


def ip(addr):
    return {'X-Real-IP': addr}   # the test client connects from 127.0.0.1, so the server believes this header


def in_parallel(calls):
    """Run the calls at once (password hashing releases the GIL); return their results in order."""
    out = [None] * len(calls)

    def run(i):
        out[i] = calls[i]()
    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(calls))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


class LoginLimits(Base):
    def test_parallel_guesses_dont_lock_the_owner_out_from_another_ip(self):
        self.member('dora', 'Dora-pass-123')
        codes = in_parallel([lambda: Client(self.live.base).login('dora', 'wrong', ip('198.51.100.1'))[0]] * 40)
        self.assertEqual(sorted(codes), [401] * 5 + [429] * 35)   # exactly five reached the password check
        self.assertEqual(Client(self.live.base).login('dora', 'Dora-pass-123', ip('203.0.113.9'))[0], 200)

    def test_per_user_cap_across_ips(self):
        self.member('eve', 'Eve-pass-1234')
        codes = in_parallel([lambda n=n: Client(self.live.base).login('eve', 'wrong', ip(f'198.51.100.{n % 6}'))[0] for n in range(30)])
        self.assertEqual(codes, [401] * 30)
        self.assertEqual(Client(self.live.base).login('eve', 'Eve-pass-1234', ip('203.0.113.10'))[0], 429)

    def test_per_ip_cap_across_users(self):
        codes = in_parallel([lambda n=n: Client(self.live.base).login(f'ghost{n % 5}', 'x', ip('198.51.100.77'))[0] for n in range(20)])
        self.assertEqual(codes, [401] * 20)
        self.assertEqual(Client(self.live.base).login('admin', ADMIN_PW, ip('198.51.100.77'))[0], 429)
        self.assertEqual(Client(self.live.base).login('admin', ADMIN_PW, ip('198.51.100.78'))[0], 200)

    def test_unknown_user_is_checked_against_the_dummy_hash(self):
        seen = []
        real = self.S.check_password

        def spy(pw, stored):
            seen.append(stored)
            return real(pw, stored)
        self.S.check_password = spy
        try:
            self.assertEqual(Client(self.live.base).login('no-such-user', 'x')[0], 401)
        finally:
            self.S.check_password = real
        self.assertEqual(seen, [self.S.DUMMY_HASH])

    def test_disabled_user_cannot_log_in(self):
        _, uid = self.member('fay', 'Fay-pass-1234')
        self.assertEqual(self.admin.req('PATCH', f'/api/admin/users/{uid}', {'disabled': True})[0], 200)
        st, out = Client(self.live.base).login('fay', 'Fay-pass-1234')
        self.assertEqual((st, out['error']['code']), (401, 'wrong_password'))

    def test_login_by_internal_id_is_refused(self):
        _, uid = self.member('gus', 'Gus-pass-1234')
        self.assertEqual(Client(self.live.base).login(uid, 'Gus-pass-1234')[0], 401)
        self.assertEqual(Client(self.live.base).login('gus', 'Gus-pass-1234')[0], 200)

    def test_login_body_is_capped(self):
        st, out = Client(self.live.base).req('POST', '/api/login', {'username': 'admin', 'password': 'x' * 5000})
        self.assertEqual((st, out['error']['code']), (413, 'too_large'))
        self.assertEqual(Client(self.live.base).req('POST', '/api/login', [1])[0], 400)

    def test_wrong_current_password_is_limited(self):
        c, _ = self.member('hal', 'Hal-pass-1234')
        codes = [c.req('POST', '/api/me/password', {'current': 'nope', 'new': 'Whatever-123'}, ip('198.51.100.5'))[0]
                 for _ in range(6)]
        self.assertEqual(codes, [400] * 5 + [429])
        st, out = c.req('POST', '/api/me/password', {'current': 'Hal-pass-1234', 'new': 'Hal-pass-5678'}, ip('198.51.100.6'))
        self.assertEqual(st, 200, out)
        self.assertEqual(out['config']['tz'], 'Asia/Shanghai')

    def test_untrusted_peer_cannot_pick_its_ip(self):
        fake = type('H', (), {'client_address': ('192.0.2.1', 1), 'headers': {'X-Real-IP': '10.9.9.9'}})()
        self.assertEqual(self.S.Handler.client_ip(fake), '192.0.2.1')


class Cookies(Base):
    def test_secure_flag_follows_config(self):
        c = Client(self.live.base)
        c.login('admin', ADMIN_PW)
        self.assertIn('; Secure', c.headers['Set-Cookie'])
        self.assertIn('HttpOnly', c.headers['Set-Cookie'])
        self.S.COOKIE_SECURE = False
        try:
            c.login('admin', ADMIN_PW)
            self.assertNotIn('Secure', c.headers['Set-Cookie'])
        finally:
            self.S.COOKIE_SECURE = True


class Csrf(Base):
    def origin(self):
        return 'https://127.0.0.1:%d' % self.live.port

    def put(self, client, headers=None, body=None):
        return client.req('PUT', '/api/d/meals/csrf', body or {'desc': 'x'}, headers)[0]

    def test_cross_site_writes_are_refused(self):
        self.assertEqual(self.put(self.admin, {'Origin': 'https://evil.example'}), 403)
        self.assertEqual(self.put(self.admin, {'Origin': 'null'}), 403)
        self.assertEqual(self.put(self.admin, {'Sec-Fetch-Site': 'cross-site'}), 403)
        self.assertEqual(self.put(self.admin, {'Sec-Fetch-Site': 'same-site'}), 403)
        st, out = self.admin.req('POST', '/api/admin/users/admin/reset', None, {'Origin': 'http://evil.example'})
        self.assertEqual((st, out['error']['code']), (403, 'cross_site'))
        self.assertEqual(Client(self.live.base).login('admin', ADMIN_PW, {'Origin': 'https://evil.example'})[0], 403)

    def test_same_origin_writes_pass(self):
        self.assertEqual(self.put(self.admin, {'Origin': self.origin()}), 200)
        self.assertEqual(self.put(self.admin, {'Sec-Fetch-Site': 'same-origin'}), 200)
        self.assertEqual(self.put(self.admin, {'Origin': self.origin(), 'Sec-Fetch-Site': 'same-origin'}), 200)
        self.assertEqual(self.put(self.admin), 200)          # neither header (curl, old browsers)
        self.assertEqual(self.admin.req('GET', '/api/c/meals', headers={'Origin': 'https://evil.example'})[0], 200)  # reads aren't writes

    def test_http_origin_when_cookie_is_not_secure(self):
        self.assertEqual(self.put(self.admin, {'Origin': 'http://127.0.0.1:%d' % self.live.port}), 403)
        self.S.COOKIE_SECURE = False
        try:
            self.assertEqual(self.put(self.admin, {'Origin': 'http://127.0.0.1:%d' % self.live.port}), 200)
        finally:
            self.S.COOKIE_SECURE = True

    def test_json_endpoints_need_json(self):
        for ctype in ('text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'):
            st, out = self.admin.req('PUT', '/api/d/meals/ct', b'{"desc": "x"}', {'Content-Type': ctype})
            self.assertEqual((st, out['error']['code']), (415, 'unsupported_type'), ctype)
        self.assertEqual(self.admin.req('PUT', '/api/d/meals/ct', b'{"a": 1}', {'Content-Type': 'application/json; charset=utf-8'})[0], 200)
        st, _ = self.admin.req('POST', '/api/me/logout-others', None, {'Content-Type': 'text/plain'})   # a body-less form post
        self.assertEqual(st, 415)
        self.assertEqual(self.admin.req('DELETE', '/api/d/meals/ct')[0], 200)                    # no body, no type: fine

    def test_photos_take_images(self):
        st, out = self.admin.req('POST', '/api/photos', JPEG, {'Content-Type': 'image/jpeg', 'Origin': self.origin()})
        self.assertEqual(st, 200, out)
        self.assertEqual(self.admin.req('POST', '/api/photos', JPEG, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.admin.req('DELETE', '/api/photos/' + out['id'], None, {'Origin': self.origin()})[0], 200)

    def test_bearer_clients_are_unaffected(self):
        cli = Client(self.live.base, bearer=SERVICE_TOKEN, act_as='admin')
        self.assertEqual(cli.req('PUT', '/api/d/meals/cli', {'a': 1}, {'Origin': 'https://evil.example'})[0], 200)
        self.assertEqual(cli.req('PUT', '/api/d/meals/cli', b'{"a": 2}', {'Content-Type': 'text/plain'})[0], 200)
        tok = self.admin.req('POST', '/api/me/tokens', {'name': 'csrf'})[1]['token']
        st, _ = Client(self.live.base, bearer=tok).req('POST', '/api/ingest/health', b'{"metric": "steps", "v": "10", "s": "2026-10-01T09:00:00+08:00"}',
                                                       {'Content-Type': 'text/plain', 'Origin': 'https://evil.example'})
        self.assertEqual(st, 200)

    def test_logout_from_the_page_still_works(self):
        c = Client(self.live.base)
        c.login('admin', ADMIN_PW)
        st, _ = c.req('POST', '/api/logout', None, {'Origin': self.origin()})
        self.assertEqual(st, 200)
        self.assertEqual(c.req('GET', '/api/me')[0], 401)


class UploadTokensFollowTheAccount(Base):
    def test_disable_removes_tokens_for_good(self):
        c, uid = self.member('ivy')
        tok = c.req('POST', '/api/me/tokens', {'name': 'phone'})[1]['token']
        up = Client(self.live.base, bearer=tok)
        sample = {'metric': 'steps', 'v': '10', 's': '2026-10-01T09:00:00+08:00'}
        self.assertEqual(up.req('POST', '/api/ingest/health', sample)[0], 200)
        self.admin.req('PATCH', f'/api/admin/users/{uid}', {'disabled': True})
        self.assertEqual(up.req('POST', '/api/ingest/health', sample)[0], 401)
        self.admin.req('PATCH', f'/api/admin/users/{uid}', {'disabled': False})
        self.assertEqual(up.req('POST', '/api/ingest/health', sample)[0], 401)      # re-enabling doesn't revive it
        n = self.S.conn().execute('SELECT COUNT(*) FROM tokens WHERE uid=?', (uid,)).fetchone()[0]
        self.assertEqual(n, 0)

    def test_delete_removes_tokens(self):
        c, uid = self.member('jon')
        c.req('POST', '/api/me/tokens', {'name': 'phone'})
        self.assertEqual(self.admin.req('DELETE', f'/api/admin/users/{uid}')[0], 200)
        n = self.S.conn().execute('SELECT COUNT(*) FROM tokens WHERE uid=?', (uid,)).fetchone()[0]
        self.assertEqual(n, 0)

    def test_startup_clears_tokens_of_disabled_or_missing_accounts(self):
        c, uid = self.member('kim')
        c.req('POST', '/api/me/tokens', {'name': 'phone'})
        self.admin.req('POST', '/api/me/tokens', {'name': 'kept'})
        db = self.S.conn()
        db.execute("UPDATE users SET disabled=1 WHERE id=?", (uid,))     # disabled the old way, tokens left behind
        db.execute("INSERT INTO tokens VALUES ('h-orphan', 'u-gone', 'x', 'ingest', '2026-01-01T00:00:00Z', NULL)")
        self.S.init_db()
        owners = {r[0] for r in db.execute('SELECT uid FROM tokens')}
        self.assertNotIn(uid, owners)
        self.assertNotIn('u-gone', owners)
        self.assertIn(self.S.find_user('admin')['id'], owners)
        db.execute("UPDATE users SET disabled=0 WHERE id=?", (uid,))

    def test_upload_token_reaches_nothing_but_ingest(self):
        tok = self.admin.req('POST', '/api/me/tokens', {'name': 'scope'})[1]['token']
        up = Client(self.live.base, bearer=tok)
        for method, path in (('GET', '/'), ('GET', '/shortcut')):
            self.assertEqual(up.req(method, path, raw=True)[0], 302, path)
        for method, path in (('GET', '/api/admin/users'), ('GET', '/api/export'), ('POST', '/api/me/tokens'), ('GET', '/api/rev')):
            self.assertEqual(up.req(method, path)[0], 403, path)


class RawHttp(Base):
    def test_unread_body_closes_the_connection(self):
        smuggled = b'GET /api/rev HTTP/1.1\r\nHost: x\r\n\r\n'
        req = (b'PUT /api/d/meals/x HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n'
               % len(smuggled)) + smuggled
        got, closed = raw_http(self.live.base, req)
        self.assertTrue(got.startswith(b'HTTP/1.1 401'), got[:40])
        self.assertEqual(got.count(b'HTTP/1.1 '), 1)             # the body was not taken for a second request
        self.assertTrue(closed)

    def test_bad_content_lengths(self):
        for cl in (b'-5', b'abc', b'1, 2'):
            got, closed = raw_http(self.live.base, b'POST /api/login HTTP/1.1\r\nHost: x\r\nContent-Length: ' + cl + b'\r\n\r\n')
            self.assertTrue(got.startswith(b'HTTP/1.1 400'), (cl, got[:40]))
            self.assertTrue(closed)
        got, closed = raw_http(self.live.base, b'POST /api/login HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n')
        self.assertTrue(got.startswith(b'HTTP/1.1 411'), got[:40])
        self.assertTrue(closed)

    def test_keep_alive_still_works_after_a_read_body(self):
        body = b'{"username": "nobody", "password": "x"}'
        one = b'POST /api/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s' % (len(body), body)
        got, _ = raw_http(self.live.base, one + b'GET /login HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')
        self.assertEqual(got.count(b'HTTP/1.1 '), 2)
        self.assertIn(b'HTTP/1.1 401', got)
        self.assertIn(b'HTTP/1.1 200', got)

    def test_non_ascii_bearer_token_is_401(self):
        req = 'GET /api/rev HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer 令牌\r\nConnection: close\r\n\r\n'.encode('utf-8')
        got, _ = raw_http(self.live.base, req)
        self.assertTrue(got.startswith(b'HTTP/1.1 401'), got[:40])


if __name__ == '__main__':
    unittest.main()

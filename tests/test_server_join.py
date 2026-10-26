"""Invites and signing up with them (/api/admin/invites, /api/join/check, /api/join), closing one's own account
(DELETE /api/me), and the pages that need no login (/join, /privacy, icons). Synthetic data only; push services are a
fake (webpush._http is replaced), so nothing leaves this machine."""
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import unittest

from helpers import ADMIN_PW, SERVICE_TOKEN, Client, LiveServer

JPEG = b'\xff\xd8\xff\xe0' + b'\0' * 64
CODE_RE = r'[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}'   # no 0/O, no 1/I
INVALID = {'code': 'invalid_invite', 'message': '邀请码不对或已失效'}


def ip(addr):
    return {'X-Real-IP': addr}   # the test client connects from 127.0.0.1, so the server believes this header


def in_parallel(calls):
    out = [None] * len(calls)

    def run(i):
        out[i] = calls[i]()
    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(calls))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.S = cls.live.srv_mod
        cls.admin = Client(cls.live.base)
        assert cls.admin.login('admin', ADMIN_PW)[0] == 200
        cls.admin_id = cls.S.find_user('admin')['id']
        cls.cli = Client(cls.live.base, bearer=SERVICE_TOKEN, act_as='admin')

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def setUp(self):
        self.S.PASSWORD_LIMIT.clear()
        self.S.JOIN_FAILS.clear()
        self.S.JOIN_DONE.clear()
        self.log = io.StringIO()   # what the server prints (the journal)
        quiet = contextlib.redirect_stdout(self.log)
        quiet.__enter__()
        self.addCleanup(quiet.__exit__, None, None, None)
        self.addr = 0

    def next_ip(self):
        """A fresh client address, so the per-address sign-up limits don't get in a test's way."""
        self.addr += 1
        return ip(f'198.51.100.{self.addr}')

    def invite(self, **body):
        st, out = self.admin.req('POST', '/api/admin/invites', body)
        self.assertEqual(st, 200, out)
        return out

    def check(self, code, headers=None):
        return Client(self.live.base).req('POST', '/api/join/check', {'code': code}, headers or self.next_ip())

    def join(self, code, username, password='Friend-pass-1', name='朋友', headers=None, client=None):
        c = client or Client(self.live.base)
        st, out = c.req('POST', '/api/join', {'code': code, 'username': username, 'name': name, 'password': password},
                        headers or self.next_ip())
        return c, st, out

    def invites(self):
        st, out = self.admin.req('GET', '/api/admin/invites')
        self.assertEqual(st, 200, out)
        return {i['id']: i for i in out['invites']}

    def expire(self, invite_id):
        self.S.conn().execute("UPDATE invites SET expires_at='2020-01-01T00:00:00Z' WHERE id=?", (invite_id,))


class Invites(Base):
    def test_made_listed_and_revoked_by_an_admin(self):
        before = time.time()
        out = self.invite(note='  给 小王  ', maxUses=3, days=7)
        code, inv = out['code'], out['invite']
        self.assertRegex(code, '^' + CODE_RE + '$')
        self.assertEqual(out['link'], f'https://127.0.0.1:{self.live.port}/join?code={code}')
        self.assertEqual({k: inv[k] for k in ('note', 'maxUses', 'uses', 'left', 'status', 'createdBy', 'users', 'revokedAt')},
                         {'note': '给 小王', 'maxUses': 3, 'uses': 0, 'left': 3, 'status': 'active', 'createdBy': 'admin',
                          'users': [], 'revokedAt': None})
        expires = self.S.datetime.fromisoformat(inv['expiresAt'].replace('Z', '+00:00')).timestamp()
        self.assertAlmostEqual(expires - before, 7 * 86400, delta=60)
        st, listed = self.admin.req('GET', '/api/admin/invites')
        self.assertEqual(listed['invites'][0], inv)
        self.assertNotIn(code, json.dumps(listed))                        # the code is shown once, when it is made
        rows = self.S.conn().execute('SELECT * FROM invites').fetchall()
        self.assertNotIn(code.replace('-', ''), json.dumps(rows))          # only its hash is stored
        self.assertIn(hashlib.sha256(code.replace('-', '').encode()).hexdigest(), json.dumps(rows))
        st, out = self.admin.req('DELETE', f'/api/admin/invites/{inv["id"]}')
        self.assertEqual((st, out['invite']['status'], out['invite']['left']), (200, 'revoked', 0), out)
        revoked_at = out['invite']['revokedAt']
        self.assertTrue(revoked_at)
        st, out = self.admin.req('DELETE', f'/api/admin/invites/{inv["id"]}')   # twice is fine and changes nothing
        self.assertEqual((st, out['invite']['revokedAt']), (200, revoked_at))
        for bad in ('i000000000000', 'nope', '..'):
            self.assertEqual(self.admin.req('DELETE', f'/api/admin/invites/{bad}')[0], 404, bad)

    def test_defaults_and_fresh_codes(self):
        a, b = self.invite(), self.invite()
        self.assertNotEqual(a['code'], b['code'])
        self.assertEqual((a['invite']['note'], a['invite']['maxUses'], a['invite']['left']), ('', 1, 1))
        expires = self.S.datetime.fromisoformat(a['invite']['expiresAt'].replace('Z', '+00:00')).timestamp()
        self.assertAlmostEqual(expires - time.time(), 14 * 86400, delta=60)
        self.assertEqual(list(self.invites())[:2], [b['invite']['id'], a['invite']['id']])   # newest first

    def test_bad_values(self):
        for body in ({'maxUses': 0}, {'maxUses': 51}, {'maxUses': True}, {'maxUses': 2.5}, {'maxUses': '3'},
                     {'days': 0}, {'days': 91}, {'days': None, 'maxUses': -1}, {'note': 123}, {'note': 'x' * 41}):
            st, out = self.admin.req('POST', '/api/admin/invites', body)
            self.assertEqual((st, out['error']['code']), (400, 'invalid_argument'), body)
        self.assertEqual(self.invite(maxUses=50, days=90, note='x' * 40)['invite']['maxUses'], 50)

    def test_admins_only(self):
        _, st, _ = self.join(self.invite()['code'], 'plainmember', 'Member-pass-1')
        member = Client(self.live.base)
        self.assertEqual(member.login('plainmember', 'Member-pass-1')[0], 200)
        inv = self.invite()['invite']
        for method, path in (('GET', '/api/admin/invites'), ('POST', '/api/admin/invites'), ('DELETE', f'/api/admin/invites/{inv["id"]}')):
            self.assertEqual(member.req(method, path, {} if method == 'POST' else None)[0], 403, path)
            self.assertEqual(self.cli.req(method, path, {} if method == 'POST' else None)[0], 403, path)   # not Claude either
            self.assertEqual(Client(self.live.base).req(method, path)[0], 401, path)
        st, out = self.admin.req('POST', '/api/admin/invites', {}, {'Origin': 'https://evil.example'})
        self.assertEqual((st, out['error']['code']), (403, 'cross_site'))
        self.assertEqual(self.invites()[inv['id']]['status'], 'active')

    def test_link_address(self):
        old = self.S.PUBLIC_URL, self.S.COOKIE_SECURE
        try:
            self.S.PUBLIC_URL = 'https://fitness.example.com'
            out = self.invite()
            self.assertEqual(out['link'], 'https://fitness.example.com/join?code=' + out['code'])
            self.S.PUBLIC_URL, self.S.COOKIE_SECURE = '', False
            self.assertTrue(self.invite()['link'].startswith(f'http://127.0.0.1:{self.live.port}/join?code='))
        finally:
            self.S.PUBLIC_URL, self.S.COOKIE_SECURE = old


class Check(Base):
    def test_a_good_code_and_its_note(self):
        out = self.invite(note='健身房的朋友')
        self.assertEqual(self.check(out['code']), (200, {'ok': True, 'note': '健身房的朋友'}))
        self.assertEqual(self.check(out['code'].lower().replace('-', ' '))[0], 200)       # typed by hand
        self.assertEqual(self.check(self.invite()['code']), (200, {'ok': True}))         # no note, no "note"
        self.assertEqual(self.invites()[out['invite']['id']]['uses'], 0)                 # checking doesn't use it

    def test_every_bad_code_gets_the_same_answer(self):
        used, expired, revoked = self.invite(), self.invite(), self.invite()
        self.assertEqual(self.join(used['code'], 'firstcomer')[1], 200)
        self.expire(expired['invite']['id'])
        self.admin.req('DELETE', f'/api/admin/invites/{revoked["invite"]["id"]}')
        for code in ('ABCD-EFGH-JKMN', used['code'], expired['code'], revoked['code'], '', None, 123, 'O0O0-1111-IIII', 'x' * 100):
            st, out = self.check(code)
            self.assertEqual((st, out), (400, {'error': INVALID}), code)


class Join(Base):
    def test_sign_up_logs_in(self):
        out = self.invite(note='同事', maxUses=2)
        c, st, res = self.join(out['code'].lower(), ' Newbie ', name='  小 新  ')
        self.assertEqual(st, 200, res)
        me = res['me']
        self.assertTrue(res['ok'])
        self.assertEqual((me['username'], me['name'], me['role'], me['mustChange']), ('newbie', '小 新', 'member', False))
        self.assertEqual(me['config']['tz'], 'Asia/Shanghai')
        cookie = c.headers['Set-Cookie']
        self.assertTrue(cookie.startswith('lsj=') and 'HttpOnly' in cookie and 'Max-Age=31536000' in cookie, cookie)
        self.assertEqual(c.req('GET', '/api/me')[1]['username'], 'newbie')
        self.assertEqual(c.req('PUT', '/api/d/meals/m1', {'desc': '面'})[0], 200)       # a full login, no password change first
        self.assertEqual(Client(self.live.base).login('newbie', 'Friend-pass-1')[0], 200)
        inv = self.invites()[out['invite']['id']]
        self.assertEqual((inv['uses'], inv['left'], inv['status'], inv['users']), (1, 1, 'active', [{'username': 'newbie', 'name': '小 新'}]))
        row = self.S.conn().execute('SELECT invite_id, must_change FROM users WHERE username=?', ('newbie',)).fetchone()
        self.assertEqual(row, (out['invite']['id'], 0))
        self.assertIn('newbie', self.log.getvalue())                                     # one line in the journal

    def test_name_defaults_to_the_username(self):
        _, st, res = self.join(self.invite()['code'], 'noname', name='   ')
        self.assertEqual((st, res['me']['name']), (200, 'noname'))

    def test_failures_leave_the_invite_unused(self):
        out = self.invite()
        code = out['code']
        for username, password, status, err in (('a', 'Friend-pass-1', 400, 'bad_username'),
                                                ('has space', 'Friend-pass-1', 400, 'bad_username'),
                                                ('名字', 'Friend-pass-1', 400, 'bad_username'),
                                                ('shorty', 'short', 400, 'weak_password'),
                                                ('shorty', 12345678, 400, 'weak_password'),
                                                ('admin', 'Friend-pass-1', 409, 'username_taken'),
                                                ('ADMIN', 'Friend-pass-1', 409, 'username_taken'),
                                                (self.admin_id, 'Friend-pass-1', 409, 'username_taken')):
            _, st, res = self.join(code, username, password)
            self.assertEqual((st, res['error']['code']), (status, err), username)
        _, st, res = self.join('ABCD-EFGH-JKMN', 'someone')
        self.assertEqual((st, res), (400, {'error': INVALID}))
        self.assertEqual(self.invites()[out['invite']['id']]['uses'], 0)
        self.assertEqual(self.join(code, 'shorty')[1], 200)

    def test_used_up_expired_or_revoked(self):
        once, expired, revoked = self.invite(), self.invite(maxUses=5), self.invite(maxUses=5)
        self.assertEqual(self.join(once['code'], 'onlyone')[1], 200)
        self.expire(expired['invite']['id'])
        self.admin.req('DELETE', f'/api/admin/invites/{revoked["invite"]["id"]}')
        for code in (once['code'], expired['code'], revoked['code']):
            _, st, res = self.join(code, 'latecomer')
            self.assertEqual((st, res), (400, {'error': INVALID}), code)
        self.assertIsNone(self.S.find_user('latecomer'))
        self.assertEqual(self.invites()[once['invite']['id']]['status'], 'used')
        self.assertEqual(self.invites()[expired['invite']['id']]['status'], 'expired')

    def test_the_last_use_goes_to_one_of_two(self):
        code = self.invite()['code']
        a, b = self.next_ip(), self.next_ip()
        got = in_parallel([lambda: self.join(code, 'racer1', headers=a)[1], lambda: self.join(code, 'racer2', headers=b)[1]])
        self.assertEqual(sorted(got), [200, 400])
        self.assertEqual(sum(self.S.find_user(n) is not None for n in ('racer1', 'racer2')), 1)

    def test_one_username_in_parallel(self):
        out = self.invite(maxUses=5)
        a, b = self.next_ip(), self.next_ip()
        got = in_parallel([lambda: self.join(out['code'], 'twin', headers=a)[1], lambda: self.join(out['code'], 'twin', headers=b)[1]])
        self.assertEqual(sorted(got), [200, 409])
        self.assertEqual(self.invites()[out['invite']['id']]['uses'], 1)

    def test_same_origin_json_only(self):
        code = self.invite()['code']
        origin = f'https://127.0.0.1:{self.live.port}'
        for path in ('/api/join/check', '/api/join'):
            for h in ({'Origin': 'https://evil.example'}, {'Sec-Fetch-Site': 'cross-site'}, {'Origin': 'null'}):
                st, out = Client(self.live.base).req('POST', path, {'code': code, 'username': 'csrf', 'password': 'Friend-pass-1'}, h)
                self.assertEqual((st, out['error']['code']), (403, 'cross_site'), (path, h))
            st, out = Client(self.live.base).req('POST', path, json.dumps({'code': code}).encode(), {'Content-Type': 'text/plain'})
            self.assertEqual((st, out['error']['code']), (415, 'unsupported_type'), path)
        self.assertEqual(self.check(code, {'Origin': origin, 'Sec-Fetch-Site': 'same-origin'})[0], 200)
        _, st, _ = self.join(code, 'sameorigin', headers={'Origin': origin, 'X-Real-IP': '198.51.100.200'})
        self.assertEqual(st, 200)

    def test_signing_up_on_a_logged_in_browser_ends_that_login(self):
        browser = Client(self.live.base)
        browser.login('admin', ADMIN_PW)
        old = browser.cookie
        _, st, _ = self.join(self.invite()['code'], 'switcher', client=browser)
        self.assertEqual(st, 200)
        self.assertEqual(browser.req('GET', '/api/me')[1]['username'], 'switcher')
        stale = Client(self.live.base)
        stale.cookie = old
        self.assertEqual(stale.req('GET', '/api/me')[0], 401)
        self.assertEqual(self.admin.req('GET', '/api/me')[0], 200)                       # the admin's other logins stay


class Limits(Base):
    def test_ten_failed_tries_per_address(self):
        code = self.invite(maxUses=5)['code']
        a = ip('203.0.113.7')
        for i in range(10):
            st = (self.check('ABCD-EFGH-JKMN', a)[0] if i % 2 else
                  Client(self.live.base).req('POST', '/api/join', {'code': 'ABCD-EFGH-JKMN', 'username': f'x{i}', 'password': 'Friend-pass-1'}, a)[0])
            self.assertEqual(st, 400, i)
        st, out = self.check(code, a)                                                    # now even a good code waits
        self.assertEqual((st, out['error']['code']), (429, 'rate_limited'))
        self.assertGreater(out['error']['retryAfter'], 0)
        self.assertEqual(self.join(code, 'blocked', headers=a)[1], 429)
        self.assertEqual(self.check(code, ip('203.0.113.8'))[0], 200)                    # another address is fine
        self.assertIsNone(self.S.find_user('blocked'))

    def test_tries_that_go_through_dont_count(self):
        code = self.invite()['code']
        a = ip('203.0.113.9')
        self.assertEqual([self.check(code, a)[0] for _ in range(15)], [200] * 15)

    def test_parallel_guesses_stop_at_ten(self):
        a = ip('203.0.113.10')
        got = in_parallel([lambda: self.check('ABCD-EFGH-JKMN', a)[0]] * 25)
        self.assertEqual(sorted(got), [400] * 10 + [429] * 15)

    def test_five_accounts_an_hour_per_address(self):
        out = self.invite(maxUses=10)
        a = ip('203.0.113.11')
        self.assertEqual([self.join(out['code'], f'batch{i}', headers=a)[1] for i in range(5)], [200] * 5)
        _, st, res = self.join(out['code'], 'batch5', headers=a)
        self.assertEqual((st, res['error']['code']), (429, 'rate_limited'))
        self.assertIsNone(self.S.find_user('batch5'))
        self.assertEqual(self.join(out['code'], 'batch5', headers=ip('203.0.113.12'))[1], 200)
        self.assertEqual(self.invites()[out['invite']['id']]['uses'], 6)


class AdminsHearOfNewcomers(Base):
    def setUp(self):
        super().setUp()
        self.W = self.S.webpush
        self.calls = []
        saved = self.W._http
        self.W._http = lambda url, headers, timeout: (self.calls.append(url), (201, b''))[1]
        self.addCleanup(setattr, self.W, '_http', saved)
        db = self.S.conn()
        db.execute('DELETE FROM push_subs')
        db.execute('DELETE FROM push_queue')
        self.cli.req('DELETE', '/api/d/profile/prefs')
        key = self.W.b64u(self.W.encode_point(self.W.public_key(self.W.new_private_key())))
        st, out = self.admin.req('POST', '/api/push/subscribe', {'endpoint': 'https://fcm.googleapis.com/fcm/send/admin-phone',
                                                                  'keys': {'p256dh': key, 'auth': self.W.b64u(os.urandom(16))}})
        self.assertEqual(st, 200, out)
        self.threads = []
        real = self.S.tell_admins_about
        self.S.tell_admins_about = lambda *a: self.threads.append(real(*a))
        self.addCleanup(setattr, self.S, 'tell_admins_about', real)

    def queued(self):
        for t in self.threads:
            t.join(10)
        return self.S.conn().execute('SELECT uid, kind, title, body, url FROM push_queue ORDER BY id').fetchall()

    def test_every_admin_gets_a_push(self):
        _, st, res = self.join(self.invite(note='同事')['code'], 'pushy', name='小推')
        self.assertEqual(st, 200, res)
        rows = self.queued()
        self.assertEqual(len(rows), 1)
        uid, kind, title, body, url = rows[0]
        self.assertEqual((uid, kind, title, url), (self.admin_id, 'remind', '新朋友注册了：小推', '/#me'))
        self.assertIn('pushy', body)
        self.assertIn('同事', body)
        self.assertEqual(self.calls, ['https://fcm.googleapis.com/fcm/send/admin-phone'])

    def test_not_when_the_admin_turned_reminders_off(self):
        self.cli.req('PUT', '/api/d/profile/prefs', {'push': {'remind': False}})
        self.assertEqual(self.join(self.invite()['code'], 'quiet')[1], 200)
        self.assertEqual(self.queued(), [])
        self.assertEqual(self.calls, [])


class CloseAccount(Base):
    def friend(self, username, password='Friend-pass-1'):
        c, st, res = self.join(self.invite()['code'], username, password)
        self.assertEqual(st, 200, res)
        return c, res['me']['id']

    def count(self, table, uid):
        return self.S.conn().execute(f'SELECT COUNT(*) FROM {table} WHERE uid=?', (uid,)).fetchone()[0]  # noqa: S608

    def test_a_member_closes_their_account(self):
        c, uid = self.friend('leaver')
        self.assertEqual(c.req('PUT', '/api/d/meals/m1', {'desc': '秘密的晚饭'})[0], 200)
        st, photo = c.req('POST', '/api/photos', JPEG, {'Content-Type': 'image/jpeg'})
        self.assertEqual(st, 200, photo)
        tok = c.req('POST', '/api/me/tokens', {'name': 'phone'})[1]['token']
        self.S.save_xunji_key(uid, 'fake-train-key-123', 'train')
        db = self.S.conn()
        db.execute("INSERT INTO push_subs VALUES ('https://fcm.googleapis.com/fcm/send/leaver', ?, 'k', 'a', NULL, '2026-10-16T00:00:00Z')", (uid,))
        db.execute("INSERT INTO push_queue (uid, at, kind, title, body, url) VALUES (?, '2026-10-16T00:00:00Z', 'report', 't', 'b', '/')", (uid,))
        other = Client(self.live.base)
        self.assertEqual(other.login('leaver', 'Friend-pass-1')[0], 200)
        photo_dir = self.S.photo_dir(uid)
        self.assertTrue(os.path.isdir(photo_dir))

        st, out = c.req('DELETE', '/api/me', {'password': 'wrong-password'})
        self.assertEqual((st, out['error']['code']), (400, 'wrong_password'))
        self.assertEqual(c.req('GET', '/api/d/meals/m1')[0], 200)                       # nothing happened
        old = c.cookie
        st, out = c.req('DELETE', '/api/me', {'password': 'Friend-pass-1'})
        self.assertEqual((st, out), (200, {'deleted': True}))
        self.assertIn('Max-Age=0', c.headers['Set-Cookie'])

        self.assertIsNone(self.S.find_user('leaver'))
        for table in ('docs', 'sessions', 'tokens', 'xunji_keys', 'push_subs', 'push_queue'):
            self.assertEqual(self.count(table, uid), 0, table)
        self.assertIsNone(db.execute('SELECT v FROM kv WHERE k=?', ('rev:' + uid,)).fetchone())
        self.assertFalse(os.path.exists(photo_dir))
        for cookie in (old, other.cookie):
            gone = Client(self.live.base)
            gone.cookie = cookie
            self.assertEqual(gone.req('GET', '/api/me')[0], 401)
        st = Client(self.live.base, bearer=tok).req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '10', 's': '2026-10-01T09:00:00+08:00'})[0]
        self.assertEqual(st, 401)
        self.assertEqual(Client(self.live.base).login('leaver', 'Friend-pass-1')[0], 401)
        log = self.log.getvalue()
        self.assertIn(f'account leaver ({uid}) deleted by its owner', log)
        self.assertNotIn('秘密', log)
        self.assertEqual(self.join(self.invite()['code'], 'leaver')[1], 200)            # the name is free again

    def test_wrong_passwords_are_limited(self):
        c, _ = self.friend('fumbler')
        codes = [c.req('DELETE', '/api/me', {'password': 'nope'}, ip('198.51.100.66'))[0] for _ in range(6)]
        self.assertEqual(codes, [400] * 5 + [429])
        self.assertIsNotNone(self.S.find_user('fumbler'))

    def test_the_last_admin_stays(self):
        st, out = self.admin.req('DELETE', '/api/me', {'password': ADMIN_PW})
        self.assertEqual((st, out['error']['code']), (409, 'last_admin'))
        self.assertEqual(self.admin.req('GET', '/api/me')[0], 200)

    def test_an_admin_can_go_while_another_remains(self):
        st, out = self.admin.req('POST', '/api/admin/users', {'username': 'admin2', 'role': 'admin'})
        self.assertEqual(st, 200, out)
        second = Client(self.live.base)
        second.login('admin2', out['password'])
        second.req('POST', '/api/me/password', {'current': out['password'], 'new': 'Admin2-pass-123'})
        st, out = second.req('DELETE', '/api/me', {'password': 'Admin2-pass-123'})
        self.assertEqual((st, out), (200, {'deleted': True}))
        self.assertIsNone(self.S.find_user('admin2'))
        self.assertEqual(self.admin.req('DELETE', '/api/me', {'password': ADMIN_PW})[0], 409)   # and now admin is the last

    def test_only_the_person_on_the_page(self):
        c, uid = self.friend('stayer')
        tok = c.req('POST', '/api/me/tokens', {'name': 'phone'})[1]['token']
        self.assertEqual(Client(self.live.base, bearer=SERVICE_TOKEN, act_as='stayer').req('DELETE', '/api/me', {'password': 'Friend-pass-1'})[0], 403)
        self.assertEqual(Client(self.live.base, bearer=tok).req('DELETE', '/api/me', {'password': 'Friend-pass-1'})[0], 403)
        self.assertEqual(Client(self.live.base).req('DELETE', '/api/me', {'password': 'Friend-pass-1'})[0], 401)
        st, out = c.req('DELETE', '/api/me', {'password': 'Friend-pass-1'}, {'Origin': 'https://evil.example'})
        self.assertEqual((st, out['error']['code']), (403, 'cross_site'))
        st, out = c.req('DELETE', '/api/me', b'{"password": "Friend-pass-1"}', {'Content-Type': 'text/plain'})
        self.assertEqual(st, 415)
        self.assertIsNotNone(self.S.find_user('stayer'))


class Pages(Base):
    def get(self, path):
        anon = Client(self.live.base)
        st, body = anon.req('GET', path, raw=True)
        return st, body.decode('utf-8', 'replace'), anon.headers

    def test_join_and_privacy_need_no_login(self):
        for path, want in (('/join', '有邀请码'), ('/join?code=ABCD-EFGH-JKMN', '注册'), ('/privacy', 'Anthropic'), ('/login', '/join')):
            st, body, h = self.get(path)
            self.assertEqual(st, 200, path)
            self.assertIn(want, body, path)
            self.assertTrue(h['Content-Type'].startswith('text/html'), path)
            self.assertEqual(h['Cache-Control'], 'no-cache', path)
            self.assertIn("script-src 'self'", h['Content-Security-Policy'])
            self.assertIsNone(re.search(r'<script(?![^>]*\bsrc=)', body), path)       # no inline scripts (the CSP would block them)
            self.assertIsNone(re.search(r'\son[a-z]+\s*=', body), path)                 # nor inline handlers

    def test_privacy_says_what_matters(self):
        _, body, _ = self.get('/privacy')
        for words in ('服务器', 'Anthropic', '管理员', '重置', '训记', 'Apple 健康', '导出', '注销', '备份', '14'):
            self.assertIn(words, body)
        self.assertNotIn('href="/app.css"', body)                                  # its own styles

    def test_icons_and_launch_screens(self):
        web = tempfile.mkdtemp(prefix='lsj-web-')
        self.addCleanup(shutil.rmtree, web, True)
        os.makedirs(os.path.join(web, 'icons'))
        os.makedirs(os.path.join(web, 'splash'))
        for name, data in (('icons/icon-192.png', b'\x89PNG\r\n\x1a\nicon'), ('icons/favicon.svg', b'<svg/>'),
                           ('splash/splash-1170x2532-dark.png', b'\x89PNG\r\n\x1a\nsplash'), ('server.py', b'secret')):
            with open(os.path.join(web, name), 'wb') as f:
                f.write(data)
        real, self.S.WEB = self.S.WEB, web
        self.addCleanup(setattr, self.S, 'WEB', real)
        for path, ctype in (('/icons/icon-192.png', 'image/png'), ('/icons/favicon.svg', 'image/svg+xml'),
                            ('/splash/splash-1170x2532-dark.png', 'image/png')):
            st, _, h = self.get(path)
            self.assertEqual((st, h['Content-Type'], h['Cache-Control']), (200, ctype, 'public, max-age=604800'), path)
            self.assertEqual(Client(self.live.base).req('GET', path, headers={'If-None-Match': h['ETag']}, raw=True)[0], 304)
        for path in ('/icons/nope.png', '/icons/../server.py', '/icons/%2e%2e/server.py', '/icons/a.jpg', '/icons/.png',
                     '/splash/sub/x.png', '/other/icon-192.png', '/icons/icon-192.png.bak', '/splash/a%20b.png'):
            self.assertEqual(self.get(path)[0], 404, path)


if __name__ == '__main__':
    unittest.main()

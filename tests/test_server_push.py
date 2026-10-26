"""Web Push on the server: the VAPID key file, subscriptions, sending (CLI token / admin, by the person's prefs), what the
service worker fetches, cleanup with the account, and /sw.js. Push services are a fake (webpush._http is replaced), so
nothing leaves this machine. Synthetic data only."""
import contextlib
import io
import json
import os
import socket
import stat
import time
import unittest
from datetime import datetime, timedelta, timezone

from helpers import ADMIN_PW, SERVICE_TOKEN, Client, LiveServer


class FakePushService:
    """Answers per endpoint: a status, or an exception to raise. Records (url, headers, timeout)."""

    def __init__(self):
        self.calls, self.answers = [], {}

    def __call__(self, url, headers, timeout):
        self.calls.append((url, headers, timeout))
        a = self.answers.get(url, 201)
        if isinstance(a, Exception):
            raise a
        return a, b'{"reason": "fake"}' if a >= 400 else b''


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.S = cls.live.srv_mod
        cls.page = Client(cls.live.base)
        assert cls.page.login('admin', ADMIN_PW)[0] == 200
        cls.uid = cls.page.req('GET', '/api/me')[1]['id']
        cls.cli = Client(cls.live.base, bearer=SERVICE_TOKEN, act_as='admin')
        cls.W = cls.S.webpush
        d = cls.W.new_private_key()
        cls.device_key = cls.W.b64u(cls.W.encode_point(cls.W.public_key(d)))

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def setUp(self):
        self.fake = FakePushService()
        self.saved = self.W._http
        self.W._http = self.fake
        db = self.S.conn()
        db.execute('DELETE FROM push_subs')
        db.execute('DELETE FROM push_queue')
        self.cli.req('DELETE', '/api/d/profile/prefs')

    def tearDown(self):
        self.W._http = self.saved

    def sub(self, name='dev1', host='fcm.googleapis.com', **over):
        body = {'endpoint': f'https://{host}/fcm/send/{name}', 'expirationTime': None,
                'keys': {'p256dh': self.device_key, 'auth': self.W.b64u(os.urandom(16))}}
        body.update(over)
        return body

    def subscribe(self, client=None, **kw):
        st, out = (client or self.page).req('POST', '/api/push/subscribe', self.sub(**kw))
        self.assertEqual(st, 200, out)
        return out

    def send(self, status=200, client=None, **body):
        st, out = (client or self.cli).req('POST', '/api/push/send', {'kind': 'report', 'title': '日报写好了', 'body': '蛋白质还差 40 g',
                                                                      'url': '/#claude', **body})
        self.assertEqual(st, status, out)
        return out

    def subs(self, uid=None):
        return [r[0] for r in self.S.conn().execute('SELECT endpoint FROM push_subs WHERE uid=? ORDER BY created_at, rowid',
                                                    (uid or self.uid,))]

    def member(self, username):
        st, out = self.page.req('POST', '/api/admin/users', {'username': username})
        self.assertEqual(st, 200, out)
        c = Client(self.live.base)
        self.assertEqual(c.login(username, out['password'])[0], 200)
        self.assertEqual(c.req('POST', '/api/me/password', {'current': out['password'], 'new': 'Member-pass-123'})[0], 200)
        return c, out['user']['id']


class Keys(Base):
    def test_made_once_private_stays_on_the_server(self):
        st, out = self.page.req('GET', '/api/push/key')
        self.assertEqual(st, 200, out)
        raw = self.W.unb64u(out['key'])
        self.assertEqual((len(out['key']), len(raw), raw[0]), (87, 65, 4))
        self.W.decode_point(raw)                                             # a point on P-256
        path = os.path.join(self.live.data, 'vapid.json')
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        with open(path) as f:
            stored = json.load(f)
        self.assertEqual(stored['public'], out['key'])
        self.assertNotIn(stored['private'], json.dumps(out))
        self.assertEqual(self.cli.req('GET', '/api/push/key')[1]['key'], out['key'])   # the CLI may read it too
        self.S._vapid_cache.clear()                                          # a restart reads the same file
        self.assertEqual(self.page.req('GET', '/api/push/key')[1], {'key': out['key'], 'subs': 0})

    def test_a_key_file_that_does_not_add_up_is_an_error(self):
        path = os.path.join(self.live.data, 'vapid.json')
        self.page.req('GET', '/api/push/key')
        with open(path) as f:
            good = f.read()
        try:
            with open(path, 'w') as f:
                json.dump({**json.loads(good), 'public': self.device_key}, f)
            self.S._vapid_cache.clear()
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(self.page.req('GET', '/api/push/key')[0], 500)
        finally:
            with open(path, 'w') as f:
                f.write(good)
            self.S._vapid_cache.clear()


class Subscribe(Base):
    def test_page_only(self):
        for method, path, body in (('POST', '/api/push/subscribe', self.sub()), ('DELETE', '/api/push/subscribe', {'endpoint': 'x'}),
                                   ('POST', '/api/push/test', {}), ('GET', '/api/push/next', None)):
            st, out = self.cli.req(method, path, body)
            self.assertEqual(st, 403, (path, out))
        self.assertEqual(self.subs(), [])
        self.assertEqual(Client(self.live.base).req('GET', '/api/push/next')[0], 401)

    def test_only_https_endpoints_of_push_services(self):
        good = self.sub()
        for bad in (self.sub(endpoint='http://fcm.googleapis.com/fcm/send/x'), self.sub(host='push.example.com'),
                    self.sub(host='fcm.googleapis.com.evil.example'), self.sub(host='127.0.0.1'),
                    self.sub(host='fcm.googleapis.com:8443'), self.sub(endpoint='https://user@fcm.googleapis.com/x'),
                    self.sub(endpoint='https://fcm.googleapis.com/a b'), self.sub(endpoint=None),
                    {**good, 'keys': {**good['keys'], 'p256dh': self.W.b64u(b'\x04' + bytes(64))}},
                    {**good, 'keys': {**good['keys'], 'auth': self.W.b64u(os.urandom(8))}}, {**good, 'keys': 'x'}):
            st, out = self.page.req('POST', '/api/push/subscribe', bad)
            self.assertEqual(st, 400, (bad, out))
        self.assertEqual(self.subs(), [])
        for host in ('updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com'):
            self.subscribe(host=host)
        self.assertEqual(len(self.subs()), 3)

    def test_same_endpoint_replaces_and_five_devices_at_most(self):
        for i in range(5):
            self.assertEqual(self.subscribe(name=f'd{i}')['subs'], i + 1)
        out = self.subscribe(name='d0')                                    # again: replaced, now the newest
        self.assertEqual(out['subs'], 5)
        self.assertEqual(out['key'], self.page.req('GET', '/api/push/key')[1]['key'])
        self.assertEqual(self.subscribe(name='d5')['subs'], 5)           # a sixth: the oldest (d1) goes
        self.assertEqual([e.rsplit('/', 1)[1] for e in self.subs()], ['d2', 'd3', 'd4', 'd0', 'd5'])
        st, out = self.page.req('DELETE', '/api/push/subscribe', {'endpoint': self.sub(name='d3')['endpoint']})
        self.assertEqual((st, out), (200, {'deleted': True, 'subs': 4}))
        self.assertEqual(self.page.req('DELETE', '/api/push/subscribe', {'endpoint': 'https://fcm.googleapis.com/x'})[1]['deleted'], False)
        self.assertEqual(self.page.req('GET', '/api/push/key')[1]['subs'], 4)

    def test_a_device_belongs_to_the_account_that_subscribed_last(self):
        self.subscribe(name='shared')
        c, mid = self.member('push-eve')
        self.subscribe(client=c, name='shared')
        self.assertEqual((self.subs(), len(self.subs(mid))), ([], 1))
        self.assertEqual(self.send()['subs'], 0)                          # admin's pushes don't reach eve's phone


class Send(Base):
    def test_cli_sends_an_empty_push_with_vapid(self):
        self.subscribe(name='a')
        self.subscribe(name='b', host='web.push.apple.com')
        out = self.send()
        self.assertEqual({k: out[k] for k in ('queued', 'sent', 'failed', 'subs')}, {'queued': True, 'sent': 2, 'failed': 0, 'subs': 2})
        self.assertEqual([(r['service'], r['status'], r['ok']) for r in out['results']],
                         [('fcm.googleapis.com', 201, True), ('web.push.apple.com', 201, True)])
        self.assertNotIn('fcm/send', json.dumps(out))                      # endpoints are not echoed back
        key = self.W.decode_point(self.W.unb64u(self.page.req('GET', '/api/push/key')[1]['key']))
        for (url, headers, timeout), aud in zip(sorted(self.fake.calls), ('https://fcm.googleapis.com', 'https://web.push.apple.com')):
            self.assertTrue(url.startswith(aud + '/'), url)
            self.assertEqual((headers['TTL'], headers['Urgency'], headers['Content-Length'], timeout), ('86400', 'normal', '0', 5))
            t, k = headers['Authorization'][len('vapid t='):].split(', k=')
            head, claims, sig = t.split('.')
            self.assertEqual(json.loads(self.W.unb64u(head)), {'typ': 'JWT', 'alg': 'ES256'})
            c = json.loads(self.W.unb64u(claims))
            self.assertEqual((c['aud'], c['sub']), (aud, 'mailto:noreply@lianshiji.invalid'))
            self.assertLess(abs(c['exp'] - time.time() - 3600), 60)
            self.assertEqual(self.W.decode_point(self.W.unb64u(k)), key)
            self.assertTrue(self.W.verify(key, f'{head}.{claims}'.encode(), self.W.unb64u(sig)))
        row = self.S.conn().execute('SELECT uid, kind, title, body, url, delivered_at, sent FROM push_queue').fetchall()
        self.assertEqual(row, [(self.uid, 'report', '日报写好了', '蛋白质还差 40 g', '/#claude', None, 2)])

    def test_no_device(self):
        out = self.send()
        self.assertEqual(out, {'queued': False, 'sent': 0, 'failed': 0, 'subs': 0, 'results': []})
        self.assertEqual(self.S.conn().execute('SELECT COUNT(*) FROM push_queue').fetchone()[0], 0)
        self.assertEqual(self.fake.calls, [])

    def test_the_persons_prefs_decide(self):
        self.subscribe()
        self.cli.req('PUT', '/api/d/profile/prefs', {'push': {'report': False, 'reply': True}})
        out = self.send()
        self.assertEqual((out['queued'], out['skipped'], out['subs']), (False, 'off', 1))
        self.assertEqual(self.fake.calls, [])
        for kind in ('proposal', 'reply', 'remind'):                       # unset and true are on
            self.assertTrue(self.send(kind=kind)['queued'], kind)
        self.assertEqual(len(self.fake.calls), 3)

    def test_gone_devices_are_removed_other_failures_logged(self):
        for name in ('ok', 'gone', 'broken', 'down', 'slow'):
            self.subscribe(name=name)
        base = 'https://fcm.googleapis.com/fcm/send/'
        self.fake.answers = {base + 'gone': 404, base + 'expired': 410, base + 'broken': 500,
                             base + 'down': ConnectionRefusedError(), base + 'slow': socket.timeout('timed out')}
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            out = self.send()
        self.assertEqual((out['sent'], out['failed'], out['subs']), (1, 4, 5))
        self.assertEqual([r['status'] for r in out['results'] if r.get('removed')], [404])
        self.assertEqual(sorted(r.get('error') for r in out['results'] if not r['ok'] and not r.get('removed')),
                         ['network', 'refused', 'timeout'])
        self.assertEqual(len({r['device'] for r in out['results']}), 5)
        self.assertEqual(sorted(e.rsplit('/', 1)[1] for e in self.subs()), ['broken', 'down', 'ok', 'slow'])
        log = err.getvalue()
        self.assertIn('push to fcm.googleapis.com failed: HTTP 500', log)
        self.assertNotIn('fcm/send', log)                                  # never the endpoint
        self.subscribe(name='expired')
        with contextlib.redirect_stderr(io.StringIO()):
            out = self.send()
        self.assertEqual([r['status'] for r in out['results'] if r.get('removed')], [410])
        self.assertNotIn(base + 'expired', self.subs())

    def test_validation(self):
        self.subscribe()
        for body in ({'kind': 'news'}, {'kind': None}, {'title': ''}, {'title': '字' * 41}, {'body': '字' * 121}, {'body': 3},
                     {'url': 'https://evil.example/'}, {'url': '//evil.example'}, {'url': '/\\evil'}, {'url': '/a b'},
                     {'url': '/' + 'a' * 200}, {'title': ['x']}):
            self.send(400, **body)
        self.assertEqual(self.fake.calls, [])
        out = self.send(title='  日报\n写好了 ', body=None, url=None)        # one line each; no url: the start page
        self.assertTrue(out['queued'])
        row = self.S.conn().execute('SELECT title, body, url FROM push_queue').fetchone()
        self.assertEqual(row, ('日报 写好了', '', '/'))
        for url in ('/#workout=xj-123', '/#ex=杠铃卧推', '/#claude?x=1&y=2'):   # deep links: = and & are fine in a path
            self.assertTrue(self.send(url=url)['queued'], url)

    def test_who_may_send(self):
        self.assertEqual(Client(self.live.base, bearer=SERVICE_TOKEN).req('POST', '/api/push/send', {'kind': 'report', 'title': 'x'})[0], 400)
        c, mid = self.member('push-fay')
        self.subscribe(client=c, name='fay')
        self.send(403, client=c)                                           # a member on the page
        out = self.send(client=self.page, user='push-fay')                 # an admin on the page, for someone
        self.assertEqual((out['sent'], out['subs']), (1, 1))
        st, out = self.page.req('POST', '/api/push/send', {'kind': 'remind', 'title': 'x'}, {'X-LSJ-User': mid})
        self.assertEqual((st, out['subs']), (200, 1))
        self.assertEqual(self.page.req('POST', '/api/push/send', {'kind': 'remind', 'title': 'x', 'user': 'nobody'})[0], 404)
        self.assertEqual(Client(self.live.base, bearer=SERVICE_TOKEN, act_as='push-fay').req(
            'POST', '/api/push/send', {'kind': 'reply', 'title': '回复了你的留言'})[1]['sent'], 1)

    def test_six_a_minute(self):
        self.subscribe()
        for _ in range(6):
            self.send()
        out = self.send(429)
        self.assertEqual(out['error']['code'], 'rate_limited')
        self.assertEqual(self.page.req('POST', '/api/push/test', {})[0], 429)
        self.S.conn().execute("UPDATE push_queue SET at='2026-01-01T00:00:00Z'")
        self.send()

    def test_keeps_the_last_fifty(self):
        self.subscribe()
        db = self.S.conn()
        db.executemany("INSERT INTO push_queue (uid, at, kind, title, body, url) VALUES (?, '2026-01-01T00:00:00Z', 'remind', ?, '', '/')",
                       [(self.uid, f'old {i}') for i in range(60)])
        self.send()
        rows = [r[0] for r in db.execute('SELECT title FROM push_queue WHERE uid=? ORDER BY id', (self.uid,))]
        self.assertEqual((len(rows), rows[0], rows[-1]), (50, 'old 11', '日报写好了'))


class Next(Base):
    def test_what_the_service_worker_shows(self):
        self.subscribe()
        self.assertEqual(self.page.req('GET', '/api/push/next', raw=True), (204, b''))
        first = self.send(title='第一条')['id']
        second = self.send(title='第二条', kind='proposal', url='/#plan')['id']
        st, out = self.page.req('GET', '/api/push/next')
        self.assertEqual((st, out['id'], out['title'], out['body'], out['url'], out['kind']), (200, first, '第一条', '蛋白质还差 40 g', '/#claude', 'report'))
        self.assertTrue(out['at'].endswith('Z'))
        self.assertEqual(self.page.headers['Cache-Control'], 'no-store')
        self.assertEqual(self.page.req('GET', '/api/push/next')[1]['title'], '第二条')
        self.assertEqual(self.page.req('GET', '/api/push/next')[1]['id'], second)   # another device woken by the same push
        delivered = self.S.conn().execute('SELECT COUNT(*) FROM push_queue WHERE delivered_at IS NOT NULL').fetchone()[0]
        self.assertEqual(delivered, 2)
        old = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(timespec='seconds').replace('+00:00', 'Z')
        self.S.conn().execute('UPDATE push_queue SET delivered_at=?', (old,))
        self.assertEqual(self.page.req('GET', '/api/push/next')[0], 204)

    def test_only_the_persons_own_and_not_stale_or_undelivered_ones(self):
        self.subscribe()
        c, mid = self.member('push-gus')
        self.subscribe(client=c, name='gus')
        self.send(title='给管理员')
        self.assertEqual(c.req('GET', '/api/push/next')[0], 204)
        db = self.S.conn()
        db.execute("UPDATE push_queue SET at='2020-01-01T00:00:00Z'")      # older than the push service keeps a push
        self.assertEqual(self.page.req('GET', '/api/push/next')[0], 204)
        db.execute('DELETE FROM push_queue')
        self.fake.answers = {'https://fcm.googleapis.com/fcm/send/dev1': 500}
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.send()['sent'], 0)
        self.assertEqual(self.page.req('GET', '/api/push/next')[0], 204)  # no device took it: nothing will ask for it

    def test_head_does_not_take_it(self):
        self.subscribe()
        self.send()
        self.assertEqual(self.page.req('HEAD', '/api/push/next', raw=True)[0], 200)
        self.assertEqual(self.page.req('GET', '/api/push/next')[1]['title'], '日报写好了')

    def test_test_push(self):
        self.assertEqual(self.page.req('POST', '/api/push/test', {})[1], {'queued': False, 'sent': 0, 'failed': 0, 'subs': 0, 'results': []})
        self.subscribe()
        self.cli.req('PUT', '/api/d/profile/prefs', {'push': {k: False for k in ('report', 'proposal', 'reply', 'remind')}})
        st, out = self.page.req('POST', '/api/push/test', {})
        self.assertEqual((st, out['sent']), (200, 1))                     # a test goes out whatever the prefs say
        msg = self.page.req('GET', '/api/push/next')[1]
        self.assertEqual((msg['kind'], msg['title'], msg['url']), ('test', '通知开好了', '/'))


class WithTheAccount(Base):
    def test_disable_and_delete_clear_devices_and_messages(self):
        c, mid = self.member('push-hal')
        self.subscribe(client=c, name='hal')
        self.send(client=Client(self.live.base, bearer=SERVICE_TOKEN, act_as='push-hal'))
        db = self.S.conn()

        def count(table):
            return db.execute(f'SELECT COUNT(*) FROM {table} WHERE uid=?', (mid,)).fetchone()[0]  # noqa: S608
        self.assertEqual((count('push_subs'), count('push_queue')), (1, 1))
        self.page.req('PATCH', f'/api/admin/users/{mid}', {'disabled': True})
        self.assertEqual((count('push_subs'), count('push_queue')), (0, 0))
        self.page.req('PATCH', f'/api/admin/users/{mid}', {'disabled': False})
        c.login('push-hal', 'Member-pass-123')
        self.subscribe(client=c, name='hal')
        self.assertEqual(self.page.req('DELETE', f'/api/admin/users/{mid}')[0], 200)
        self.assertEqual(count('push_subs'), 0)

    def test_startup_clears_what_disabled_or_missing_accounts_left(self):
        c, mid = self.member('push-ida')
        self.subscribe(client=c, name='ida')
        self.subscribe(name='mine')
        db = self.S.conn()
        db.execute('UPDATE users SET disabled=1 WHERE id=?', (mid,))
        db.execute("INSERT INTO push_subs VALUES ('https://fcm.googleapis.com/fcm/send/orphan', 'u-gone', 'k', 'a', '', 'x')")
        db.execute("INSERT INTO push_queue (uid, at, kind, title, body, url) VALUES ('u-gone', 'x', 'remind', 't', '', '/')")
        self.S.init_db()
        self.assertEqual({r[0] for r in db.execute('SELECT uid FROM push_subs')}, {self.uid})
        self.assertEqual(db.execute("SELECT COUNT(*) FROM push_queue WHERE uid != ?", (self.uid,)).fetchone()[0], 0)
        db.execute('UPDATE users SET disabled=0 WHERE id=?', (mid,))


class Later(Base):
    """POST /api/push/later: the rest timer's 「休息完了」, sent when it is due unless cancelled or replaced. Delays are
    cut to a second here (PUSH_LATER_MIN) so the tests wait seconds, not minutes."""

    def setUp(self):
        super().setUp()
        self.real_min = self.S.PUSH_LATER_MIN
        self.S.PUSH_LATER_MIN = 1
        self.S.LATER_POSTS.clear()
        self.forget_timers()

    def tearDown(self):
        self.forget_timers()
        self.S.PUSH_LATER_MIN = self.real_min
        super().tearDown()

    def forget_timers(self):
        with self.S._later_lock:
            for _, timer in self.S._later.values():
                timer.cancel()
            self.S._later.clear()

    def pending(self, uid=None):
        """The id of this person's pending reminder, or None."""
        with self.S._later_lock:
            cur = self.S._later.get(uid or self.uid)
        return cur[0] if cur else None

    def later(self, status=200, client=None, **body):
        st, out = (client or self.page).req('POST', '/api/push/later', {'delaySec': 1, 'title': '休息完了',
                                                                        'body': '杠铃卧推 · 第 3 组 · 52.5 kg × 6', 'url': '/#today', **body})
        self.assertEqual(st, status, out)
        return out

    def wait_until(self, ok, seconds=6):
        deadline = time.monotonic() + seconds
        while not ok() and time.monotonic() < deadline:
            time.sleep(0.05)
        return ok()

    def wait_for_calls(self, n, seconds=6):
        self.wait_until(lambda: len(self.fake.calls) >= n, seconds)
        return len(self.fake.calls)

    def test_sent_when_due(self):
        self.subscribe()
        out = self.later()
        rid = out['id']
        self.assertEqual((out, len(self.fake.calls)), ({'id': rid}, 0))
        self.assertIsInstance(rid, str)
        self.assertEqual(self.pending(), rid)
        self.assertEqual(self.wait_for_calls(1), 1)                        # due a second later: one empty push went out
        self.assertIsNone(self.pending())
        msg = self.page.req('GET', '/api/push/next')[1]
        self.assertEqual((msg['kind'], msg['title'], msg['body'], msg['url']), ('remind', '休息完了', '杠铃卧推 · 第 3 组 · 52.5 kg × 6', '/#today'))
        time.sleep(0.3)
        self.assertEqual(len(self.fake.calls), 1)                          # and only once

    def test_a_new_one_replaces_the_old(self):
        self.subscribe()
        first = self.later(delaySec=1, title='第一次')['id']
        second = self.later(delaySec=2, title='第二次')['id']               # +30 s: the page deletes and posts again
        self.assertNotEqual(first, second)
        self.assertEqual(self.pending(), second)
        self.assertEqual(self.page.req('DELETE', f'/api/push/later/{first}')[1], {'ok': True})   # the old id is void …
        self.assertEqual(self.pending(), second)                           # … and doesn't touch the new one
        self.assertEqual(self.wait_for_calls(1), 1)
        time.sleep(0.5)
        self.assertEqual(len(self.fake.calls), 1)                          # the first never fired
        self.assertEqual(self.page.req('GET', '/api/push/next')[1]['title'], '第二次')

    def test_cancel(self):
        self.subscribe()
        rid = self.later()['id']
        st, out = self.page.req('DELETE', f'/api/push/later/{rid}')
        self.assertEqual((st, out), (200, {'ok': True}))
        self.assertIsNone(self.pending())
        self.assertEqual(self.page.req('DELETE', f'/api/push/later/{rid}')[1], {'ok': True})      # again: still fine
        self.assertEqual(self.page.req('DELETE', '/api/push/later/never-was')[1], {'ok': True})
        time.sleep(1.5)
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(self.page.req('GET', '/api/push/next')[0], 204)
        self.assertEqual(self.S.conn().execute('SELECT COUNT(*) FROM push_queue').fetchone()[0], 0)

    def test_someone_elses_id_cancels_nothing(self):
        self.subscribe()
        c, mid = self.member('push-jan')
        self.subscribe(client=c, name='jan')
        mine = self.later()['id']
        theirs = self.later(client=c, title='jan 的')['id']
        self.assertEqual(c.req('DELETE', f'/api/push/later/{mine}')[1], {'ok': True})
        self.assertEqual((self.pending(), self.pending(mid)), (mine, theirs))
        self.assertEqual(self.wait_for_calls(2), 2)                        # each person's own went out
        self.assertEqual(self.page.req('GET', '/api/push/next')[1]['title'], '休息完了')
        self.assertEqual(c.req('GET', '/api/push/next')[1]['title'], 'jan 的')

    def test_no_device_nothing_is_scheduled(self):
        self.assertEqual(self.later(), {'id': None, 'skipped': 'nosub'})
        self.assertIsNone(self.pending())
        self.subscribe()
        self.later()
        self.page.req('DELETE', '/api/push/subscribe', {'endpoint': self.sub()['endpoint']})
        self.assertEqual(self.later(), {'id': None, 'skipped': 'nosub'})   # the device went: the pending one too
        self.assertIsNone(self.pending())
        time.sleep(1.5)
        self.assertEqual(self.fake.calls, [])

    def test_reminders_turned_off(self):
        self.subscribe()
        self.cli.req('PUT', '/api/d/profile/prefs', {'push': {'remind': False}})
        self.assertEqual(self.later(), {'id': None, 'skipped': 'off'})
        self.cli.req('PUT', '/api/d/profile/prefs', {'push': {'report': False}})           # other kinds off: fine
        rid = self.later()['id']
        self.assertIsInstance(rid, str)
        self.cli.req('PUT', '/api/d/profile/prefs', {'push': {'remind': False}})           # turned off while pending
        time.sleep(1.5)
        self.assertEqual((self.fake.calls, self.pending()), ([], None))

    def test_page_login_only(self):
        self.subscribe()
        body = {'delaySec': 30, 'title': '休息完了'}
        self.assertEqual(Client(self.live.base).req('POST', '/api/push/later', body)[0], 401)
        self.assertEqual(Client(self.live.base).req('DELETE', '/api/push/later/x')[0], 401)
        self.assertEqual(self.cli.req('POST', '/api/push/later', body)[0], 403)              # the CLI token: page only
        self.assertEqual(self.cli.req('DELETE', '/api/push/later/x')[0], 403)
        self.assertIsNone(self.pending())
        c, mid = self.member('push-kim')                                   # a member schedules their own
        self.subscribe(client=c, name='kim')
        self.assertIsInstance(self.later(client=c, delaySec=60)['id'], str)
        self.assertIsInstance(self.pending(mid), str)

    def test_validation(self):
        self.subscribe()
        for body in ({'delaySec': 0}, {'delaySec': 901}, {'delaySec': '30'}, {'delaySec': 30.5}, {'delaySec': True},
                     {'delaySec': None}, {'title': ''}, {'title': None}, {'title': '字' * 41}, {'body': '字' * 81}, {'body': 3},
                     {'url': 'https://evil.example/'}, {'url': '//evil.example'}, {'url': '/\\x'}, {'url': '/a b'},
                     {'url': '/' + 'a' * 200}):
            self.later(400, **body)
        self.assertEqual((self.pending(), self.fake.calls), (None, []))
        self.S.PUSH_LATER_MIN = self.real_min
        self.later(400, delaySec=9)
        for delay in (10, 900):
            self.assertIsInstance(self.later(delaySec=delay)['id'], str)
        for url in ('/#workout=xj-123', '/#ex=杠铃卧推', None, ''):              # deep links; no url: the start page
            self.assertIsInstance(self.later(delaySec=60, url=url)['id'], str)
        self.assertIsInstance(self.later(delaySec=60, body=None)['id'], str)
        self.assertIsInstance(self.later(delaySec=60, body='字' * 80, title='字' * 40)['id'], str)

    def test_ten_a_minute(self):
        self.subscribe()
        for _ in range(10):
            self.later(delaySec=60)
        out = self.later(429, delaySec=60)
        self.assertEqual(out['error']['code'], 'rate_limited')
        self.assertIsNotNone(self.pending())                               # the tenth is still pending
        self.assertEqual(self.page.req('DELETE', f'/api/push/later/{self.pending()}')[1], {'ok': True})
        self.later(429, delaySec=60)                                       # deleting doesn't give the minute back
        self.S.LATER_POSTS.clear()
        self.later(delaySec=60)

    def test_disable_or_delete_drops_the_pending_one(self):
        c, mid = self.member('push-lee')
        self.subscribe(client=c, name='lee')
        self.assertIsInstance(self.later(client=c)['id'], str)
        self.page.req('PATCH', f'/api/admin/users/{mid}', {'disabled': True})
        self.assertIsNone(self.pending(mid))
        self.page.req('PATCH', f'/api/admin/users/{mid}', {'disabled': False})
        c.login('push-lee', 'Member-pass-123')
        self.subscribe(client=c, name='lee')
        self.assertIsInstance(self.later(client=c)['id'], str)
        self.assertEqual(self.page.req('DELETE', f'/api/admin/users/{mid}')[0], 200)
        self.assertIsNone(self.pending(mid))
        time.sleep(1.5)
        self.assertEqual(self.fake.calls, [])

    def test_sending_failures_stay_in_the_journal(self):
        self.subscribe()
        self.S.conn().executemany("INSERT INTO push_queue (uid, at, kind, title, body, url) VALUES (?, ?, 'remind', 'x', '', '/')",
                                  [(self.uid, self.S.now_iso())] * 6)       # six this minute already: send_push says 429
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.later()
            self.assertTrue(self.wait_until(lambda: self.pending() is None))
            time.sleep(0.2)
        self.assertEqual(self.fake.calls, [])
        self.assertIn('delayed push not sent: rate_limited', err.getvalue())
        self.assertIsNone(self.pending())


class ServiceWorker(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.real_web = cls.S.WEB
        cls.S.WEB = cls.web = os.path.join(cls.live.data, 'web')
        os.makedirs(cls.web)
        for name, text in (('sw.js', "self.addEventListener('push', () => {})"), ('index.html', '<!doctype html>')):
            with open(os.path.join(cls.web, name), 'w') as f:
                f.write(text)

    @classmethod
    def tearDownClass(cls):
        cls.S.WEB = cls.real_web
        super().tearDownClass()

    def test_served_for_the_whole_site(self):
        anon = Client(self.live.base)
        st, body = anon.req('GET', '/sw.js', raw=True)
        h = anon.headers
        self.assertEqual((st, body), (200, b"self.addEventListener('push', () => {})"))
        self.assertEqual((h['Content-Type'], h['Cache-Control'], h['Service-Worker-Allowed']),
                         ('text/javascript; charset=utf-8', 'no-cache', '/'))
        self.assertEqual(anon.req('GET', '/sw.js', headers={'If-None-Match': h['ETag']}, raw=True)[0], 304)

    def test_page_csp_allows_it(self):
        self.page.req('GET', '/', raw=True)
        csp = [p.strip() for p in self.page.headers['Content-Security-Policy'].split(';')]
        self.assertIn("worker-src 'self'", csp)
        self.assertIn("script-src 'self'", csp)


if __name__ == '__main__':
    unittest.main()

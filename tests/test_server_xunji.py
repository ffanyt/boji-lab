"""The page's 训记 link: saving the key, 「从训记同步」 (POST /api/xunji/sync) and server.py --set-xunji-key.
训记 is a fake: app/xunji_import.py's HTTP function is replaced, so nothing here reaches the real 训记."""
import contextlib
import copy
import io
import json
import os
import socket
import subprocess
import sys
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone

from helpers import ADMIN_PW, REPO, SERVICE_TOKEN, Client, LiveServer

SH = timezone(timedelta(hours=8))
KEY = 'fake-train-key-1'


def ms(day, hh=19):
    d = date.fromisoformat(day)
    return int(datetime(d.year, d.month, d.day, hh, tzinfo=SH).timestamp() * 1000)


def session(localid, day, title='胸', reps='8', hh=19):
    return {'localid': localid, 'datestr': day, 'title': title, 'note': '', 'start': ms(day, hh), 'end': ms(day, hh) + 3600000,
            'movements': [{'name': '杠铃卧推', 'exetype': '', 'restTime': 120, 'sets': [
                {'done': True, 'weight': '60', 'unit': 'kg', 'reps': reps, 'setType': ''}]}]}


class FakeXunji:
    """训记's trains API: {datestr: [sessions]}, one valid key, and `trouble` to make it fail."""

    def __init__(self):
        self.days, self.calls, self.trouble = {}, [], None

    def put(self, *sessions):
        for s in sessions:
            self.days.setdefault(s['datestr'], []).append(copy.deepcopy(s))

    def __call__(self, url, data, headers, timeout):
        body = json.loads(data)
        self.calls.append((body.get('datestr'), body.get('include_full_data'), timeout))
        if self.trouble == 'down':
            raise urllib.error.URLError('connection refused')
        if self.trouble == 'slow':
            raise socket.timeout('timed out')
        if self.trouble == 'busy':
            return 200, b'{"success": false, "message": "too frequent", "retry_after_ms": 16000}'
        if headers.get('Authorization') != 'Bearer ' + KEY:
            return 401, b'{"success": false, "message": "apikey invalid"}'
        trains = copy.deepcopy(self.days.get(body['datestr'], []))
        if not body['include_full_data']:
            trains = [{k: t[k] for k in ('localid', 'datestr', 'title')} for t in trains]
        return 200, json.dumps({'success': True, 'res': {'trains': trains}}).encode()


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.S = cls.live.srv_mod
        cls.admin = Client(cls.live.base)
        assert cls.admin.login('admin', ADMIN_PW)[0] == 200
        cls.uid = cls.admin.req('GET', '/api/me')[1]['id']
        cls.cli = Client(cls.live.base, bearer=SERVICE_TOKEN, act_as='admin')

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def setUp(self):
        self.xj = FakeXunji()
        self.saved = (self.S.xj._http, self.S.XUNJI_PAUSE, self.S.XUNJI_BUDGET)
        self.S.xj._http, self.S.XUNJI_PAUSE = self.xj, 0
        self.S.XUNJI_LIMIT.clear()
        self.S.XUNJI_KEY_LIMIT.clear()
        for col in ('workouts', 'meta', 'plan', 'profile'):
            for d in self.cli.req('GET', f'/api/c/{col}')[1]['docs']:
                self.cli.req('DELETE', f'/api/d/{col}/{d["id"]}')
        self.S.conn().execute('DELETE FROM xunji_keys')

    def tearDown(self):
        self.S.xj._http, self.S.XUNJI_PAUSE, self.S.XUNJI_BUDGET = self.saved

    def doc(self, col, doc_id):
        st, out = self.cli.req('GET', f'/api/d/{col}/{doc_id}')
        return out['data'] if st == 200 else None

    def put(self, col, doc_id, data):
        self.assertEqual(self.cli.req('PUT', f'/api/d/{col}/{doc_id}', data)[0], 200)

    def sync(self, status=200, client=None):
        self.S.XUNJI_LIMIT.clear()
        st, out = (client or self.admin).req('POST', '/api/xunji/sync', {})
        self.assertEqual(st, status, out)
        return out

    def stored_key(self, uid=None):
        return self.S.xunji_key(uid or self.uid)

    def member(self, username):
        st, out = self.admin.req('POST', '/api/admin/users', {'username': username})
        self.assertEqual(st, 200, out)
        c = Client(self.live.base)
        self.assertEqual(c.login(username, out['password'])[0], 200)
        return c, out['user']['id'], out['password']


class Keys(Base):
    def test_save_check_and_remove(self):
        self.assertEqual(self.admin.req('GET', '/api/xunji'), (200, {'hasKey': False, 'keyUpdatedAt': None, 'hasTemplateKey': False,
                                                                      'templateKeyUpdatedAt': None, 'webSync': None}))
        st, out = self.admin.req('PUT', '/api/xunji/key', {'key': f'  {KEY}\n'})      # pasted with spaces around it
        self.assertEqual((st, out['ok'], out['verified']), (200, True, True), out)
        self.assertEqual(self.xj.calls, [(self.S.today(), False, self.S.XUNJI_TIMEOUT)])   # one light read of today
        self.assertEqual(self.stored_key(), KEY)
        st, out = self.admin.req('GET', '/api/xunji')
        self.assertEqual((out['hasKey'], out['keyUpdatedAt'][:2]), (True, '20'))
        self.assertEqual(self.admin.req('DELETE', '/api/xunji/key'), (200, {'deleted': True, 'kind': 'train'}))
        self.assertIsNone(self.stored_key())
        self.assertEqual(self.admin.req('DELETE', '/api/xunji/key'), (200, {'deleted': False, 'kind': 'train'}))

    def test_bad_keys_are_refused_without_asking_xunji(self):
        for key in ('short', 'has space inside', 'x' * 201, '训记的钥匙一二三四', 12345678, None, ['a' * 10]):
            st, out = self.admin.req('PUT', '/api/xunji/key', {'key': key})
            self.assertEqual((st, out['error']['code']), (400, 'invalid_argument'), key)
        self.assertEqual(self.xj.calls, [])
        self.assertIsNone(self.stored_key())

    def test_a_key_xunji_does_not_know(self):
        with contextlib.redirect_stderr(io.StringIO()):
            st, out = self.admin.req('PUT', '/api/xunji/key', {'key': 'fake-wrong-key-9'})
        self.assertEqual((st, out['error']['code'], out['error']['message']),
                         (400, 'xunji_key_invalid', '训记 key 不对或已失效，请在训记 App 里重新申请'))
        self.assertIsNone(self.stored_key())

    def test_stored_unverified_when_xunji_cannot_be_reached(self):
        for trouble in ('down', 'busy', 'slow'):
            self.S.XUNJI_KEY_LIMIT.clear()
            self.xj.trouble = trouble
            with contextlib.redirect_stderr(io.StringIO()):
                st, out = self.admin.req('PUT', '/api/xunji/key', {'key': KEY})
            self.assertEqual((st, out['verified']), (200, False), trouble)
            self.assertTrue(out['message'].startswith('key 已保存，但这次没能验证'))
            self.assertEqual(self.stored_key(), KEY)

    def test_checking_keys_is_rate_limited(self):
        self.assertEqual(self.admin.req('PUT', '/api/xunji/key', {'key': KEY})[0], 200)
        st, out = self.admin.req('PUT', '/api/xunji/key', {'key': KEY})
        self.assertEqual((st, out['error']['code']), (429, 'rate_limited'))
        self.assertGreater(out['error']['retryAfter'], 0)

    def test_page_only(self):
        for client in (self.cli, Client(self.live.base, bearer=self.admin.req('POST', '/api/me/tokens', {'name': 'x'})[1]['token'])):
            for method, path in (('GET', '/api/xunji'), ('PUT', '/api/xunji/key'), ('POST', '/api/xunji/sync')):
                self.assertEqual(client.req(method, path, {'key': KEY})[0], 403, (path, client.bearer[:4]))
        self.assertEqual(Client(self.live.base).req('GET', '/api/xunji')[0], 401)
        self.assertIsNone(self.stored_key())

    def test_cross_site_requests_are_refused(self):
        evil = {'Origin': 'https://evil.example'}
        self.assertEqual(self.admin.req('PUT', '/api/xunji/key', {'key': KEY}, evil)[0], 403)
        self.S.save_xunji_key(self.uid, KEY)
        self.assertEqual(self.admin.req('POST', '/api/xunji/sync', {}, evil)[0], 403)
        self.assertEqual(self.admin.req('DELETE', '/api/xunji/key', None, evil)[0], 403)
        self.assertEqual(self.admin.req('PUT', '/api/xunji/key', b'{"key": "x"}', {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.xj.calls, [])
        self.assertEqual(self.stored_key(), KEY)

    def test_must_change_password_first(self):
        c, _, _ = self.member('xena')
        self.assertEqual(c.req('GET', '/api/xunji')[1]['error']['code'], 'must_change_password')

    def test_the_key_never_leaves_the_server(self):
        self.admin.req('PUT', '/api/xunji/key', {'key': KEY})
        self.xj.put(session(1, self.S.today()))
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.sync()
            self.xj.trouble = 'down'
            self.sync(502)
        seen = [self.admin.req('GET', p, raw=True)[1] for p in ('/api/xunji', '/api/export', '/api/me', '/api/admin/users', '/api/c/meta')]
        seen += [self.cli.req('GET', '/api/c/workouts', raw=True)[1], err.getvalue().encode()]
        for body in seen:
            self.assertNotIn(KEY.encode(), body)
        self.assertIn('训记 call failed: network', err.getvalue())

    def test_the_key_goes_with_the_account(self):
        c, mid, pw = self.member('yuri')
        c.req('POST', '/api/me/password', {'current': pw, 'new': 'Yuri-pass-123'})
        self.assertEqual(c.req('PUT', '/api/xunji/key', {'key': KEY})[0], 200)
        self.assertIsNone(self.stored_key())                                     # each person their own
        self.admin.req('PATCH', f'/api/admin/users/{mid}', {'disabled': True})
        self.assertIsNone(self.stored_key(mid))
        self.admin.req('PATCH', f'/api/admin/users/{mid}', {'disabled': False})
        self.assertIsNone(self.stored_key(mid))                                  # re-enabling doesn't bring it back
        self.S.save_xunji_key(mid, KEY)
        self.assertEqual(self.admin.req('DELETE', f'/api/admin/users/{mid}')[0], 200)
        self.assertIsNone(self.stored_key(mid))
        db = self.S.conn()
        db.execute("INSERT INTO xunji_keys VALUES ('u-gone', 'train', 'fake-orphan-key', 'x')")
        self.S.save_xunji_key(self.uid, KEY)
        self.S.init_db()                                                         # startup clears keys of missing accounts
        self.assertEqual([r[0] for r in db.execute('SELECT DISTINCT uid FROM xunji_keys')], [self.uid])

    def test_set_key_from_the_command_line(self):
        env = {**os.environ, 'LSJ_DATA': self.live.data, 'LSJ_TOKEN': SERVICE_TOKEN, 'LSJ_PASSWORD': ADMIN_PW}

        def run(*args, stdin):
            return subprocess.run([sys.executable, os.path.join(REPO, 'app', 'server.py'), *args], input=stdin, env=env,
                                  capture_output=True, text=True, timeout=30)
        r = run('--set-xunji-key', 'admin', stdin=KEY + '\n')
        self.assertEqual((r.returncode, r.stdout), (0, 'ok\n'), r.stderr)
        self.assertNotIn(KEY, r.stdout + r.stderr)
        self.assertEqual(self.stored_key(), KEY)
        self.assertNotEqual(run('--set-xunji-key', 'nobody', stdin=KEY).returncode, 0)
        r = run('--set-xunji-key', 'admin', stdin='two words')
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.stored_key(), KEY)


class Sync(Base):
    def setUp(self):
        super().setUp()
        self.S.save_xunji_key(self.uid, KEY)
        self.day = self.S.today()
        self.put('meta', 'xunji', {'dayMap': {'胸': 'A', '背': 'B'}, 'lastSyncDate': '2026-10-01', 'lastSyncAt': 'then',
                                   'templates': 'declined', 'imported': 7})
        self.put('plan', 'current', {'updatedAt': '2026-01-01T00:00:00Z', 'training': {'days': [
            {'id': 'A', 'exercises': [{'name': '杠铃卧推', 'sets': 4, 'reps': '6–8', 'load': 'RPE 8', 'rest': '120s'}]},
            {'id': 'B', 'exercises': [{'name': '杠铃卧推', 'sets': 3, 'reps': '10', 'load': '40kg'}]}]}})

    def days_ago(self, n):
        return (date.fromisoformat(self.day) - timedelta(days=n)).isoformat()

    def test_imports_the_last_three_days(self):
        self.xj.put(session(1, self.day), session(2, self.days_ago(2), '背'), session(3, self.days_ago(3)))
        rev = self.admin.req('GET', '/api/rev')[1]['rev']
        out = self.sync()
        self.assertEqual((sorted(out['new']), out['updated'], out['remapped'], out['unchanged'], out['range'][0]),
                         (sorted([f'{self.day} 胸', f'{self.days_ago(2)} 背']), [], [], 0, self.days_ago(2)))
        self.assertIsNone(self.doc('workouts', 'xj-3'))                          # older than the window
        w = self.doc('workouts', 'xj-1')
        self.assertEqual((w['source'], w['planDayId'], w['exercises'][0]['target'], w['needsReview'], w['date']),
                         ('xunji', 'A', '4×6–8 · RPE 8 · 休息 120s', True, self.day))
        self.assertTrue(w['xunjiHash'].startswith('r1:'))
        meta = self.doc('meta', 'xunji')
        self.assertEqual((meta['webSync']['ok'], meta['webSync']['new'], meta['webSync']['updated'], meta['linked']), (True, 2, 0, True))
        self.assertEqual((meta['dayMap'], meta['lastSyncDate'], meta['lastSyncAt'], meta['templates'], meta['imported']),
                         ({'胸': 'A', '背': 'B'}, '2026-10-01', 'then', 'declined', 7))
        self.assertGreater(self.admin.req('GET', '/api/rev')[1]['rev'], rev)
        self.assertEqual(self.admin.req('GET', '/api/xunji')[1]['webSync'], meta['webSync'])
        self.assertTrue(all(timeout <= self.S.XUNJI_TIMEOUT for _, _, timeout in self.xj.calls))
        self.assertNotIn((self.days_ago(1), True), [c[:2] for c in self.xj.calls])   # an empty light list: no full read

    def test_one_sync_a_minute(self):
        self.sync()
        st, out = self.admin.req('POST', '/api/xunji/sync', {})
        self.assertEqual((st, out['error']['code']), (429, 'rate_limited'))
        self.assertTrue(0 < out['error']['retryAfter'] <= 60)
        self.assertRegex(out['error']['message'], r'^刚同步过，\d+ 秒后再试$')

    def test_same_rules_as_bin_xunji(self):
        self.xj.put(session(1, self.day))
        self.sync()
        self.cli.req('PATCH', '/api/d/workouts/xj-1', {'needsReview': False, 'review': {'rating': 'good', 'comment': '稳'}})
        out = self.sync()
        self.assertEqual((out['new'], out['updated'], out['remapped'], out['unchanged']), ([], [], [], 1))
        self.assertFalse(self.doc('workouts', 'xj-1')['needsReview'])
        mine = {'notes': '肩有点紧', 'rpe': 8.5, 'planDayId': 'B'}                  # the page's 「我的补充」, not mirrored yet
        self.cli.req('PATCH', '/api/d/workouts/xj-1', {'mine': mine})
        out = self.sync()
        w = self.doc('workouts', 'xj-1')
        self.assertEqual((len(out['remapped']), w['planDayId'], w['mine'], w['exercises'][0]['target'], w['needsReview']),
                         (1, 'B', mine, '3×10 · 40kg', False))
        self.xj.days[self.day][0]['movements'][0]['sets'][0]['reps'] = '10'      # edited in 训记
        out = self.sync()
        w = self.doc('workouts', 'xj-1')
        self.assertEqual((len(out['updated']), w['needsReview'], w['review']['comment'], w['mine'], w['exercises'][0]['sets'][0]['reps']),
                         (1, True, '稳', mine, 10))
        self.xj.days[self.day] = []                                              # deleted in 训记: bin/xunji's job, not this one
        out = self.sync()
        self.assertIsNotNone(self.doc('workouts', 'xj-1'))
        self.assertEqual(out['new'] + out['updated'] + out['remapped'], [])

    def test_trouble(self):
        self.xj.put(session(1, self.day))
        for trouble, status, code in (('down', 502, 'xunji_unreachable'), ('slow', 504, 'xunji_timeout'), ('busy', 503, 'xunji_busy')):
            self.xj.trouble = trouble
            with contextlib.redirect_stderr(io.StringIO()):
                out = self.sync(status)
            self.assertEqual(out['error']['code'], code)
            self.assertRegex(out['error']['message'], r'[一-鿿]')
            self.assertEqual(self.doc('meta', 'xunji')['webSync']['error'], out['error']['message'])
            self.assertIsNone(self.doc('workouts', 'xj-1'))
        self.assertEqual(len([c for c in self.xj.calls if c[0] == self.days_ago(2)]), 3)   # busy: no waiting for 16 s, no retry
        self.xj.trouble = None
        self.S.save_xunji_key(self.uid, 'fake-stale-key-2')
        with contextlib.redirect_stderr(io.StringIO()):
            out = self.sync(400)
        self.assertEqual(out['error']['code'], 'xunji_key_invalid')
        meta = self.doc('meta', 'xunji')
        self.assertEqual((meta['webSync']['ok'], meta['webSync']['error'], meta['dayMap']), (False, out['error']['message'], {'胸': 'A', '背': 'B'}))
        self.S.save_xunji_key(self.uid, KEY)
        self.sync()
        self.assertNotIn('error', self.doc('meta', 'xunji')['webSync'])        # a good sync clears the old error

    def test_the_whole_sync_has_a_time_budget(self):
        self.S.XUNJI_BUDGET = 0.5
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(self.sync(504)['error']['code'], 'xunji_timeout')
        self.assertEqual(self.xj.calls, [])

    def test_no_key(self):
        self.S.conn().execute('DELETE FROM xunji_keys')
        self.assertEqual(self.sync(400)['error']['code'], 'no_xunji_key')
        self.assertEqual(self.xj.calls, [])

    def test_window_follows_the_persons_day(self):
        night = datetime(2026, 10, 16, 2, 0, tzinfo=SH)
        self.xj.put(session(5, '2026-10-16', hh=1))                             # started 01:00, filed by 训记 under the 16th
        out = self.S.xunji_web_sync(self.uid, KEY, night)
        self.assertEqual(out['range'], ['2026-10-13', '2026-10-16'])            # 05:00 start: the 15th − 2 … the calendar day
        self.assertEqual(self.doc('workouts', 'xj-5')['date'], '2026-10-15')
        self.put('profile', 'prefs', {'dayStartHour': 0})
        out = self.S.xunji_web_sync(self.uid, KEY, night)
        self.assertEqual((out['range'], out['remapped']), (['2026-10-14', '2026-10-16'], ['2026-10-16 胸（从 2026-10-15 移过来）']))
        self.assertEqual(self.doc('workouts', 'xj-5')['date'], '2026-10-16')


if __name__ == '__main__':
    unittest.main()

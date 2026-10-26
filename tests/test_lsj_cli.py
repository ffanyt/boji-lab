"""bin/lsj's command line: argument order, exit codes, the batch wrapper, LSJ_DENY_COLLECTIONS, range --only, errors.
Runs against a small in-process fake of the 薄肌研究所 API (stdlib only, random port), so it does not depend on app/server.py."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

sys.dont_write_bytecode = True
REPO = os.environ.get('LSJ_REPO') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TOKEN = 'cli-test-token'


def load():
    loader = importlib.machinery.SourceFileLoader('lsj_cli_under_test', os.path.join(REPO, 'bin', 'lsj'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


L = load()
USERS = [{'id': 'u1', 'username': 'alice', 'name': 'Alice', 'role': 'admin', 'disabled': False},          # as an older server lists it
         {'id': 'u2', 'username': 'bob', 'name': 'Bob', 'role': 'member', 'disabled': False, 'dayStartHour': 0, 'tz': 'Asia/Shanghai'}]


class Fake:
    """Per-user documents with versions, like the real server."""
    docs = {}       # (uid, col, id) -> envelope
    log = []        # (method, path, uid, body)
    missing = ()    # collections this server doesn't know (an older server)
    push = {'queued': False, 'sent': 0, 'failed': 0, 'subs': 0, 'results': []}   # what /api/push/send answers
    lock = threading.Lock()


JPEG = b'\xff\xd8\xff\xe0' + b'\0' * 16


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def err(self, status, msg):
        self.reply(status, {'error': {'code': 'x', 'message': msg}})

    def handle_any(self, method):
        url = urlparse(self.path)
        parts = [unquote(p) for p in url.path[5:].strip('/').split('/')]
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n)) if n else None
        uid = self.headers.get('X-LSJ-User')
        with Fake.lock:
            Fake.log.append((method, url.path, uid, body))
        if self.headers.get('Authorization') != 'Bearer ' + TOKEN:
            return self.err(401, 'unknown or revoked token')
        if parts == ['admin', 'users']:
            return self.reply(200, {'users': USERS})
        if parts == ['boom']:
            return self.err(500, 'internal')
        if parts == ['slow']:
            time.sleep(1)
            return self.reply(200, {})
        if not uid:
            return self.err(400, 'send X-LSJ-User')
        if parts == ['push', 'send'] and method == 'POST':
            return self.reply(200, Fake.push)
        if parts[0] == 'photos' and method == 'GET':
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(JPEG)))
            self.end_headers()
            return self.wfile.write(JPEG)
        if parts[0] in ('c', 'd') and parts[1] in Fake.missing:
            return self.err(404, 'unknown collection')
        with Fake.lock:
            if parts[0] == 'c':
                docs = [d for (u, c, _), d in sorted(Fake.docs.items()) if u == uid and c == parts[1]]
                qs = parse_qs(url.query)
                for w in qs.get('where', []):
                    f, op, raw = w.split(':', 2)
                    v = json.loads(raw)
                    fn = {'eq': lambda a, b: a == b, 'gte': lambda a, b: a is not None and a >= b,
                          'lte': lambda a, b: a is not None and a <= b, 'lt': lambda a, b: a is not None and a < b}[op]
                    docs = [d for d in docs if fn(d['data'].get(f), v)]
                return self.reply(200, {'docs': docs[:int(qs.get('limit', ['1000'])[0])]})
            if parts[0] == 'd':
                key = (uid, parts[1], parts[2])
                if method == 'GET':
                    return self.reply(200, Fake.docs[key]) if key in Fake.docs else self.err(404, 'no such document')
                op = {'PUT': 'set', 'PATCH': 'update', 'DELETE': 'delete'}[method]
                ops = [{'op': op, 'collection': parts[1], 'id': parts[2], 'data': body,
                        'ifVersion': int(self.headers['If-Match']) if self.headers.get('If-Match') else None}]
            elif parts == ['batch']:
                ops = body
            else:
                return self.err(404, 'no such endpoint')
            new, out = dict(Fake.docs), []
            for o in ops:
                key = (uid, o['collection'], o['id'])
                cur = new.get(key)
                if o.get('ifVersion') is not None and (cur['version'] if cur else 0) != o['ifVersion']:
                    return self.err(409, 'document changed')
                if o['op'] == 'delete':
                    new.pop(key, None)
                    out.append(None)
                    continue
                if o['op'] == 'update' and not cur:
                    return self.err(404, 'update needs an existing document')
                data = {**cur['data'], **o['data']} if o['op'] == 'update' else o['data']
                new[key] = {'collection': o['collection'], 'id': o['id'], 'version': (cur['version'] + 1) if cur else 1,
                            'updatedAt': '2026-10-15T00:00:00Z', 'data': data}
                out.append(new[key])
            Fake.docs = new
        if parts == ['batch']:
            return self.reply(200, {'results': out})
        return self.reply(200, out[0] or {'deleted': True})

    def do_GET(self):
        self.handle_any('GET')

    def do_PUT(self):
        self.handle_any('PUT')

    def do_PATCH(self):
        self.handle_any('PATCH')

    def do_DELETE(self):
        self.handle_any('DELETE')

    def do_POST(self):
        self.handle_any('POST')


class CliCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.httpd.daemon_threads = True
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.httpd.server_address[1]}'
        cls.tmp = tempfile.mkdtemp(prefix='lsj-cli-')
        cls.cfg = os.path.join(cls.tmp, 'config.json')
        with open(cls.cfg, 'w') as f:
            json.dump({'url': cls.url, 'token': TOKEN}, f)
        cls.env = {k: os.environ.get(k) for k in ('LSJ_CONFIG', 'LSJ_DENY_COLLECTIONS')}

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        for k, v in cls.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def setUp(self):
        os.environ['LSJ_CONFIG'] = self.cfg
        os.environ.pop('LSJ_DENY_COLLECTIONS', None)
        Fake.docs, Fake.log, Fake.missing = {}, [], ()

    def lsj(self, *argv, stdin=None):
        """(exit code, parsed stdout or text, stderr)."""
        o, e = io.StringIO(), io.StringIO()
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(stdin) if stdin is not None else old_stdin
        try:
            with contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
                L.main(list(argv))
            code = 0
        except SystemExit as x:
            code = x.code
        finally:
            sys.stdin = old_stdin
        try:
            text = json.loads(o.getvalue())
        except ValueError:
            text = o.getvalue()
        return code, text, e.getvalue()

    def writes(self):
        return [x for x in Fake.log if x[0] in ('PUT', 'PATCH', 'DELETE') or x[1] == '/api/batch']


class UserOption(CliCase):
    def test_user_before_or_after_the_command(self):
        for argv in (('-u', 'bob', 'set', 'meals', 'm1', '{"a": 1}'), ('set', 'meals', 'm1', '{"a": 1}', '-u', 'bob'),
                     ('set', '--user', 'bob', 'meals', 'm1', '{"a": 1}'), ('--user=bob', 'set', 'meals', 'm1', '{"a": 1}')):
            Fake.docs = {}
            code, _, err = self.lsj(*argv)
            self.assertEqual(code, 0, (argv, err))
            self.assertIn(('u2', 'meals', 'm1'), Fake.docs)

    def test_if_version_between_id_and_json(self):
        self.lsj('-u', 'bob', 'set', 'meals', 'm1', '{"a": 1}')
        path = os.path.join(self.tmp, 'body.json')
        with open(path, 'w') as f:
            json.dump({'a': 2}, f)
        code, res, err = self.lsj('set', 'meals', 'm1', '--if-version', '1', path, '-u', 'bob')
        self.assertEqual((code, res['version']), (0, 2), err)

    def test_json_on_stdin(self):
        code, res, _ = self.lsj('-u', 'bob', 'set', 'meals', 'm1', '-', stdin='{"a": 3}')
        self.assertEqual(code, 0)
        self.assertEqual(Fake.docs[('u2', 'meals', 'm1')]['data'], {'a': 3})

    def test_several_accounts_need_u(self):
        code, _, err = self.lsj('get', 'plan', 'current')
        self.assertEqual(code, 1)
        self.assertIn('pass -u', err)

    def test_pending_for_everyone_and_for_one(self):
        self.lsj('-u', 'alice', 'set', 'meals', 'm1', '{"date": "2026-10-15", "needsReview": true}')
        code, res, _ = self.lsj('pending')
        self.assertEqual((code, [p['user']['username'] for p in res]), (0, ['alice', 'bob']))
        self.assertEqual([len(p['meals']) for p in res], [1, 0])
        code, res, _ = self.lsj('pending', '-u', 'bob')
        self.assertEqual((code, res['user']['username'], res['plan']), (0, 'bob', None))

    def test_unknown_user(self):
        self.assertEqual(self.lsj('get', 'plan', 'current', '-u', 'carol')[0], 1)


class ExitCodes(CliCase):
    def test_usage_errors_exit_1(self):
        for argv in ((), ('bogus',), ('set', 'meals'), ('range', '2026-10-01'), ('day', 'yesterday'), ('list', 'meals', '--limit', 'x'),
                     ('set', 'meals', 'm1', 'a.json', 'b.json')):
            self.assertEqual(self.lsj(*argv)[0], 1, argv)

    def test_bad_json_exit_1_and_sends_nothing(self):
        for arg in ('{"a": NaN}', '{"a": Infinity}', '{"a": ', '/no/such/file.json', '[1, 2]'):
            code, _, err = self.lsj('-u', 'bob', 'set', 'meals', 'm1', arg)
            self.assertEqual(code, 1, (arg, err))
        self.assertEqual(self.writes(), [])

    def test_not_found_exit_4(self):
        self.assertEqual(self.lsj('-u', 'bob', 'get', 'plan', 'current')[0], 4)
        self.assertEqual(self.lsj('-u', 'bob', 'photos', 'meals', 'nope')[0], 4)
        self.assertEqual(self.lsj('-u', 'bob', 'update', 'meals', 'nope', '{"a": 1}')[0], 4)

    def test_conflict_exit_3(self):
        self.lsj('-u', 'bob', 'set', 'meals', 'm1', '{"a": 1}')
        self.assertEqual(self.lsj('-u', 'bob', 'update', 'meals', 'm1', '{"a": 2}', '--if-version', '7')[0], 3)
        self.assertEqual(self.lsj('-u', 'bob', 'batch', '[{"op": "delete", "collection": "meals", "id": "m1", "ifVersion": 5}]')[0], 3)

    def test_server_error_exit_2(self):
        c = L.Client(self.url, TOKEN)
        with self.assertRaises(L.LsjError) as e:
            c.request('GET', '/api/boom')
        self.assertEqual(e.exception.code, 2)

    def test_timeout_exit_2_without_traceback(self):
        c = L.Client(self.url, TOKEN, timeout=0.3)
        with self.assertRaises(L.LsjError) as e:
            c.request('GET', '/api/slow')
        self.assertEqual(e.exception.code, 2)
        self.assertIn('cannot reach', str(e.exception))

    def test_unreachable_exit_2(self):
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
        s.close()
        cfg = os.path.join(self.tmp, 'down.json')
        with open(cfg, 'w') as f:
            json.dump({'url': f'http://127.0.0.1:{port}', 'token': TOKEN}, f)
        os.environ['LSJ_CONFIG'] = cfg
        code, _, err = self.lsj('users')
        self.assertEqual(code, 2)
        self.assertNotIn('Traceback', err)

    def test_config_errors_exit_1(self):
        os.environ['LSJ_CONFIG'] = os.path.join(self.tmp, 'missing.json')
        self.assertEqual(self.lsj('users')[0], 1)
        bad = os.path.join(self.tmp, 'badtoken.json')
        with open(bad, 'w') as f:
            json.dump({'url': self.url, 'token': 'wrong'}, f)
        os.environ['LSJ_CONFIG'] = bad
        self.assertEqual(self.lsj('users')[0], 1)

    def test_nan_is_never_sent(self):
        with self.assertRaises(L.LsjError) as e:
            L.Client(self.url, TOKEN).request('POST', '/api/batch', [{'x': float('nan')}])
        self.assertEqual(e.exception.code, 1)
        self.assertEqual(Fake.log, [])


class BatchWrapper(CliCase):
    OPS = [{'op': 'set', 'collection': 'reports', 'id': 'daily-2026-10-15', 'data': {'kind': 'daily'}}]

    def test_wrong_user_is_refused(self):
        code, _, err = self.lsj('-u', 'bob', 'batch', json.dumps({'user': 'alice', 'ops': self.OPS}))
        self.assertEqual(code, 1)
        self.assertIn('alice', err)
        self.assertEqual(self.writes(), [])

    def test_wrapper_names_the_account(self):
        self.assertEqual(self.lsj('batch', json.dumps({'user': 'alice', 'ops': self.OPS}))[0], 0)
        self.assertIn(('u1', 'reports', 'daily-2026-10-15'), Fake.docs)
        self.assertEqual(self.lsj('batch', '-u', 'u2', json.dumps({'user': 'bob', 'ops': self.OPS}))[0], 0)  # -u by id
        self.assertIn(('u2', 'reports', 'daily-2026-10-15'), Fake.docs)

    def test_plain_list_still_works(self):
        code, res, _ = self.lsj('-u', 'bob', 'batch', json.dumps(self.OPS))
        self.assertEqual((code, res[0]['version']), (0, 1))

    def test_bad_wrappers(self):
        for payload in ({'ops': self.OPS}, {'user': 'nobody', 'ops': self.OPS}, {'user': 'bob', 'ops': {}}, {'op': 'set'},
                        [{'op': 'replace', 'collection': 'meals', 'id': 'm'}], []):
            self.assertEqual(self.lsj('-u', 'bob', 'batch', json.dumps(payload))[0], 1, payload)
        self.assertEqual(self.writes(), [])


class DenyCollections(CliCase):
    def test_writes_to_denied_collections_exit_1(self):
        os.environ['LSJ_DENY_COLLECTIONS'] = 'plan, profile'
        for argv in (('set', 'plan', 'current', '{}'), ('update', 'profile', 'main', '{"a": 1}'), ('delete', 'plan', 'current'),
                     ('batch', json.dumps([{'op': 'set', 'collection': 'meals', 'id': 'm', 'data': {}},
                                           {'op': 'merge', 'collection': 'plan', 'id': 'current', 'data': {}}]))):
            code, _, err = self.lsj('-u', 'bob', *argv)
            self.assertEqual(code, 1, argv)
            self.assertIn('LSJ_DENY_COLLECTIONS', err)
        self.assertEqual(self.writes(), [])
        self.assertEqual(self.lsj('-u', 'bob', 'set', 'reports', 'r1', '{}')[0], 0)  # others still work

    def test_client_refuses_too(self):
        c = L.Client(self.url, TOKEN, deny={'meta'}).for_user('bob')
        with self.assertRaises(L.LsjError):
            c.batch([{'op': 'set', 'collection': 'meta', 'id': 'xunji', 'data': {}}])


class RangeAndDay(CliCase):
    def test_range_only(self):
        self.lsj('-u', 'bob', 'batch', json.dumps([
            {'op': 'set', 'collection': 'health', 'id': '2026-10-14', 'data': {'date': '2026-10-14', 'steps': 5000}},
            {'op': 'set', 'collection': 'meals', 'id': 'm1', 'data': {'date': '2026-10-14'}}]))
        Fake.log = []
        code, res, _ = self.lsj('range', '2026-10-01', '2026-10-15', '--only', 'health,days', '-u', 'bob')
        self.assertEqual((code, sorted(res)), (0, ['days', 'health']))
        self.assertEqual(res['health'][0]['data']['steps'], 5000)
        self.assertEqual(sorted(p for _, p, _, _ in Fake.log if p.startswith('/api/c/')), ['/api/c/days', '/api/c/health'])
        self.assertEqual(self.lsj('range', '2026-10-01', '2026-10-15', '--only', 'plan', '-u', 'bob')[0], 1)

    def test_range_todos(self):
        self.lsj('-u', 'bob', 'set', 'todos', '2026-10-14', '{"date": "2026-10-14", "items": [{"id": "t1", "text": "买菜", "done": false}]}')
        code, res, _ = self.lsj('range', '2026-10-14', '2026-10-14', '--only', 'todos', '-u', 'bob')
        self.assertEqual((code, list(res), res['todos'][0]['data']['items'][0]['text']), (0, ['todos'], '买菜'))

    def test_range_default_is_everything(self):
        code, res, _ = self.lsj('range', '2026-10-01', '2026-10-15', '-u', 'bob')
        self.assertEqual(sorted(res), sorted(L.RANGE_COLLECTIONS))

    def test_day(self):
        self.lsj('-u', 'bob', 'batch', json.dumps([
            {'op': 'set', 'collection': 'plan', 'id': 'current', 'data': {'diet': {'kcal': 2000, 'protein': 120, 'carbs': 220, 'fat': 60}}},
            {'op': 'set', 'collection': 'workouts', 'id': 'w1', 'data': {'date': '2026-10-14', 'planDayId': 'A'}},
            {'op': 'set', 'collection': 'meals', 'id': 'm1', 'data': {'date': '2026-10-14', 'review': {'kcal': 500, 'protein': 30}}}]))
        code, res, err = self.lsj('day', '2026-10-14', '-u', 'bob')
        self.assertEqual(code, 0, err)
        self.assertEqual((res['user'], res['kind'], res['planDayId'], res['targets']['kcal'], res['intake']['kcal']),
                         ('bob', 'training', 'A', 2000, 500))
        self.assertTrue(res['reportStale'])
        self.assertEqual((res['todos'], res['planCustom']), ([], []))

    def test_day_todos_and_plan_custom(self):
        self.lsj('-u', 'bob', 'batch', json.dumps([
            {'op': 'set', 'collection': 'plan', 'id': 'current', 'data': {'diet': {'kcal': 2100}, 'custom': {'diet.kcal': {'at': 'x', 'was': 2000}}}},
            {'op': 'set', 'collection': 'todos', 'id': '2026-10-14', 'data': {'date': '2026-10-14', 'items': [{'id': 't1', 'text': '早睡', 'done': True}]}},
            {'op': 'set', 'collection': 'todos', 'id': '2026-10-13', 'data': {'date': '2026-10-13', 'items': [{'id': 't2', 'text': '别的天', 'done': False}]}}]))
        code, res, err = self.lsj('day', '2026-10-14', '-u', 'bob')
        self.assertEqual(code, 0, err)
        self.assertEqual((res['todos'], res['planCustom'], res['targets']['kcal']), ([{'id': 't1', 'text': '早睡', 'done': True}], ['diet.kcal'], 2100))

    def test_day_follows_the_accounts_day_start(self):
        code, res, err = self.lsj('day', '-u', 'bob')
        self.assertEqual(code, 0, err)
        self.assertEqual((res['dayStartHour'], res['today'], res['date']), (0, L.user_today(start=0, tz='Asia/Shanghai'), res['today']))
        code, res, err = self.lsj('day', '-u', 'alice')            # the listing has no dayStartHour: 05:00 on this computer's clock
        self.assertEqual((code, res['dayStartHour'], res['today']), (0, 5, L.user_today()))

    def test_users_and_pending_carry_the_day_start(self):
        code, res, _ = self.lsj('users')
        self.assertEqual([(u['username'], u.get('dayStartHour')) for u in res], [('alice', None), ('bob', 0)])
        code, res, _ = self.lsj('pending', '-u', 'bob')
        self.assertEqual((res['user']['dayStartHour'], res['user']['tz']), (0, 'Asia/Shanghai'))


class PendingPersona(CliCase):
    def persona(self, prefs):
        Fake.docs = {}
        if prefs is not None:
            self.lsj('-u', 'bob', 'set', 'profile', 'prefs', json.dumps(prefs))
        code, res, err = self.lsj('pending', '-u', 'bob')
        self.assertEqual(code, 0, err)
        return res['persona']

    def test_persona_from_prefs_or_the_page_style(self):
        self.assertEqual(self.persona(None), 'abstract')
        self.assertEqual(self.persona({'style': 'clean'}), 'coach')
        self.assertEqual(self.persona({'style': 'abstract'}), 'abstract')
        self.assertEqual(self.persona({'style': 'clean', 'persona': 'roast'}), 'roast')
        self.assertEqual(self.persona({'persona': 'coach'}), 'coach')
        self.assertEqual(self.persona({'style': 'clean', 'persona': 'bogus'}), 'coach')
        code, res, _ = self.lsj('pending')                       # every account carries it, next to autonomy
        self.assertEqual([(p['autonomy'], p['persona']) for p in res], [('small', 'abstract'), ('small', 'coach')])


class PendingConsent(CliCase):
    def test_consent_at_from_prefs(self):
        Fake.docs = {}
        self.assertIsNone(self.lsj('pending', '-u', 'bob')[1]['consentAt'])               # a new account: not yet
        self.lsj('-u', 'bob', 'set', 'profile', 'prefs', '{"consentAt": ""}')
        self.assertIsNone(self.lsj('pending', '-u', 'bob')[1]['consentAt'])
        self.lsj('-u', 'bob', 'set', 'profile', 'prefs', '{"consentAt": true}')
        self.assertIsNone(self.lsj('pending', '-u', 'bob')[1]['consentAt'])
        self.lsj('-u', 'bob', 'set', 'profile', 'prefs', '{"consentAt": "2026-10-16T12:00:00Z", "style": "clean"}')
        self.assertEqual(self.lsj('pending', '-u', 'bob')[1]['consentAt'], '2026-10-16T12:00:00Z')
        code, res, _ = self.lsj('pending')                                                # every account carries it
        self.assertEqual((code, [p['consentAt'] for p in res]), (0, [None, '2026-10-16T12:00:00Z']))


class TrainingInTheApp(CliCase):
    def test_train_in_from_prefs_or_the_xunji_link(self):
        Fake.docs = {}
        self.assertEqual(self.lsj('pending', '-u', 'bob')[1]['trainIn'], 'app')
        self.lsj('-u', 'bob', 'set', 'meta', 'xunji', '{"linked": true}')
        self.assertEqual(self.lsj('pending', '-u', 'bob')[1]['trainIn'], 'both')
        self.lsj('-u', 'bob', 'set', 'profile', 'prefs', '{"trainIn": "app"}')
        self.assertEqual(self.lsj('pending', '-u', 'bob')[1]['trainIn'], 'app')

    def test_a_workout_being_logged_is_not_pending_and_not_counted(self):
        Fake.docs = {}
        live = {'date': '2026-10-14', 'planDayId': 'A', 'status': 'active', 'exercises': [], 'needsReview': True}
        self.lsj('-u', 'bob', 'set', 'workouts', 'w-live', json.dumps(live))
        code, res, err = self.lsj('pending', '-u', 'bob')
        self.assertEqual((code, res['workouts']), (0, []), err)
        code, res, err = self.lsj('day', '2026-10-14', '-u', 'bob')
        self.assertEqual(code, 0, err)
        self.assertNotEqual(res['reason'], 'workout')                      # not "trained" by a half-logged session
        self.lsj('-u', 'bob', 'set', 'workouts', 'w-live', json.dumps({**live, 'status': 'done'}))
        self.assertEqual(self.lsj('day', '2026-10-14', '-u', 'bob')[1]['reason'], 'workout')


class ProgressPhotos(CliCase):
    def test_pending_and_range_have_progress(self):
        self.lsj('-u', 'bob', 'set', 'progress', '2026-10-16', '{"date": "2026-10-16", "photos": {"front": "x"}, "needsReview": true}')
        code, res, _ = self.lsj('pending', '-u', 'bob')
        self.assertEqual((code, [p['id'] for p in res['progress']]), (0, ['2026-10-16']))
        code, res, _ = self.lsj('range', '2026-10-16', '2026-10-16', '-u', 'bob')
        self.assertEqual((code, len(res['progress'])), (0, 1))

    def test_an_older_server_without_progress(self):
        Fake.missing = ('progress',)
        code, res, err = self.lsj('range', '2026-10-01', '2026-10-15', '-u', 'bob')
        self.assertEqual((code, res['progress']), (0, []), err)
        code, res, err = self.lsj('pending', '-u', 'bob')
        self.assertEqual((code, res['progress']), (0, []), err)
        self.assertEqual(self.lsj('day', '2026-10-14', '-u', 'bob')[0], 0)

    def test_photos_print_the_view(self):
        tmp = tempfile.mkdtemp(prefix='lsj-cli-photos-')
        old, L.PHOTO_DIR = L.PHOTO_DIR, tmp
        try:
            ids = {v: c * 32 for v, c in (('front', 'a'), ('side', 'b'), ('back', 'c'))}
            self.lsj('-u', 'bob', 'set', 'progress', '2026-10-16', json.dumps({'date': '2026-10-16', 'photos': {'back': ids['back'], 'front': ids['front']}}))
            code, text, err = self.lsj('photos', 'progress', '2026-10-16', '-u', 'bob')
            self.assertEqual(code, 0, err)
            self.assertEqual(text.splitlines(), [f'正面 {tmp}/u2/{ids["front"]}.jpg', f'背面 {tmp}/u2/{ids["back"]}.jpg'])
            with open(f'{tmp}/u2/{ids["front"]}.jpg', 'rb') as f:
                self.assertEqual(f.read(), JPEG)
            self.lsj('-u', 'bob', 'set', 'meals', 'm1', json.dumps({'date': '2026-10-16', 'photos': [ids['side']], 'leftovers': [ids['back']]}))
            code, text, _ = self.lsj('photos', 'meals', 'm1', '-u', 'bob')       # meals as before
            self.assertEqual(text.splitlines(), [f'{tmp}/u2/{ids["side"]}.jpg', f'剩菜 {tmp}/u2/{ids["back"]}.jpg'])
        finally:
            L.PHOTO_DIR = old


class Notify(CliCase):
    def test_sends_to_the_account(self):
        code, res, err = self.lsj('notify', '-u', 'bob', '--kind', 'report', '--title', '日报写好了', '--body', '蛋白质还差 40 g', '--url', '/#claude')
        self.assertEqual((code, res['subs']), (0, 0), err)
        sent = [(m, uid, body) for m, p, uid, body in Fake.log if p == '/api/push/send']
        self.assertEqual(sent, [('POST', 'u2', {'kind': 'report', 'title': '日报写好了', 'body': '蛋白质还差 40 g', 'url': '/#claude'})])

    def test_defaults_and_the_answer(self):
        Fake.push = {'queued': True, 'id': 3, 'sent': 1, 'failed': 0, 'subs': 1, 'results': [{'ok': True, 'status': 201}]}
        try:
            code, res, _ = self.lsj('notify', '--kind', 'remind', '--title', '该拍身材照了', '-u', 'alice')
        finally:
            Fake.push = {'queued': False, 'sent': 0, 'failed': 0, 'subs': 0, 'results': []}
        self.assertEqual((code, res['sent']), (0, 1))
        self.assertEqual([b for _, p, _, b in Fake.log if p == '/api/push/send'], [{'kind': 'remind', 'title': '该拍身材照了', 'body': '', 'url': '/'}])

    def test_deep_links_with_equals_pass(self):
        for url in ('/#workout=xj-123', '/#ex=杠铃卧推', '/#claude?x=1&y=2'):
            code, res, err = self.lsj('notify', '-u', 'bob', '--kind', 'remind', '--title', '练完了', '--url', url)
            self.assertEqual(code, 0, (url, err))
        self.assertEqual([b['url'] for _, p, _, b in Fake.log if p == '/api/push/send'], ['/#workout=xj-123', '/#ex=杠铃卧推', '/#claude?x=1&y=2'])

    def test_bad_notices_exit_1_and_send_nothing(self):
        for argv in (('--kind', 'news', '--title', 't'), ('--kind', 'report'), ('--kind', 'report', '--title', ' '),
                     ('--kind', 'report', '--title', '字' * 41), ('--kind', 'report', '--title', 't', '--body', '字' * 121),
                     ('--kind', 'report', '--title', 't', '--url', 'https://evil.example'),
                     ('--kind', 'report', '--title', 't', '--url', '//evil.example')):
            self.assertEqual(self.lsj('notify', '-u', 'bob', *argv)[0], 1, argv)
        self.assertEqual([p for _, p, _, _ in Fake.log if p == '/api/push/send'], [])


if __name__ == '__main__':
    unittest.main()

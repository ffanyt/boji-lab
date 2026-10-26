"""Request handling: bad input is a 400, never a 500; markers and NaN never get stored; errors are logged, not leaked;
the page's static files revalidate."""
import contextlib
import io
import os
import sqlite3
import tempfile
import time
import unittest

from helpers import ADMIN_PW, SERVICE_TOKEN, Client, LiveServer


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.S = cls.live.srv_mod
        cls.admin = Client(cls.live.base)
        assert cls.admin.login('admin', ADMIN_PW)[0] == 200
        cls.cli = Client(cls.live.base, bearer=SERVICE_TOKEN, act_as='admin')

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def bad(self, status_body, status=400):
        st, out = status_body
        self.assertEqual(st, status, out)
        self.assertIsInstance(out, dict, out)
        self.assertTrue(out['error']['message'])
        return out


class BadInput(Base):
    def batch(self, ops):
        return self.cli.req('POST', '/api/batch', ops)

    def test_batch_items(self):
        out = self.bad(self.batch([{'op': 'set', 'collection': 'meals', 'id': 'ok', 'data': {}}, 'nope']))
        self.assertEqual(out['error']['index'], 1)
        for item in ({'op': 'set', 'collection': 'meals', 'data': {}},                     # no id
                     {'op': 'set', 'collection': 'meals', 'id': ['a'], 'data': {}},
                     {'op': 'set', 'collection': 'meals', 'id': 7, 'data': {}},
                     {'op': 'set', 'collection': ['meals'], 'id': 'a', 'data': {}},
                     {'op': 'set', 'collection': {'x': 1}, 'id': 'a', 'data': {}},
                     {'op': 'set', 'id': 'a', 'data': {}},                                  # no collection
                     {'op': ['set'], 'collection': 'meals', 'id': 'a', 'data': {}},
                     {'op': 'set', 'collection': 'meals', 'id': 'a', 'data': [1]}):
            self.bad(self.batch([item]))
        self.bad(self.batch([]))
        self.bad(self.batch({'op': 'set'}))
        self.assertEqual(self.cli.req('GET', '/api/d/meals/ok')[0], 404)                  # nothing of a failed batch landed

    def test_if_version_must_be_a_plain_number(self):
        self.cli.req('PUT', '/api/d/meals/v', {'a': 1})
        for v in (True, 2.9, 1.0, -1, 'one', [1]):
            self.bad(self.batch([{'op': 'update', 'collection': 'meals', 'id': 'v', 'data': {'a': 2}, 'ifVersion': v}]))
        for h in ('2.9', 'abc', 'W/"1"', '-1'):
            self.bad(self.cli.req('PATCH', '/api/d/meals/v', {'a': 2}, {'If-Match': h}))
        self.assertEqual(self.cli.req('PATCH', '/api/d/meals/v', {'a': 2}, {'If-Match': '"1"'})[0], 200)
        st, out = self.batch([{'op': 'update', 'collection': 'meals', 'id': 'v', 'data': {'a': 3}, 'ifVersion': 2}])
        self.assertEqual((st, out['results'][0]['version']), (200, 3))

    def test_list_parameters(self):
        self.bad(self.cli.req('GET', '/api/c/meals?limit=abc'))
        self.bad(self.cli.req('GET', '/api/c/meals?limit=2.5'))
        self.bad(self.cli.req('GET', '/api/c/meals?where=date:eq:NaN'))
        self.cli.req('PUT', '/api/d/reports/o1', {'meta': {'a': 1}, 'w': 72})
        self.cli.req('PUT', '/api/d/reports/o2', {'meta': {'a': 2}, 'w': 71.5})
        self.cli.req('PUT', '/api/d/reports/o3', {'w': 71})
        self.bad(self.cli.req('GET', '/api/c/reports?order=meta'))
        st, out = self.cli.req('GET', '/api/c/reports?order=w')
        self.assertEqual([d['id'] for d in out['docs']], ['o3', 'o2', 'o1'])               # ints and floats sort together

    def test_bodies(self):
        h = {'Content-Type': 'application/json'}
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'\xff\xfe{"a": 1}', h))            # not UTF-8
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'{"a": NaN}', h))
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'{"a": [Infinity]}', h))
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'{"a": -Infinity}', h))
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'{"a": "\\ud800"}', h))             # lone surrogate
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'[' * 100000 + b']' * 100000, h))  # nested too deep
        self.bad(self.cli.req('PUT', '/api/d/meals/b', b'{"a":' * 900 + b'1' + b'}' * 900, h))
        self.assertEqual(self.cli.req('GET', '/api/d/meals/b')[0], 404)
        self.assertEqual(self.cli.req('PUT', '/api/d/meals/b', '﻿{"a": 1}'.encode('utf-8'), h)[0], 200)   # a BOM is fine

    def test_admin_and_me_bodies_must_be_objects(self):
        self.bad(self.admin.req('PATCH', '/api/me', [1]))
        self.bad(self.admin.req('POST', '/api/admin/users', [1]))
        self.bad(self.admin.req('PATCH', '/api/admin/users/admin', 'x'))

    def test_bearer_tokens_with_odd_characters(self):
        for tok in ('café', 'x' * 500):
            st, out = Client(self.live.base, bearer=tok).req('GET', '/api/rev')
            self.assertEqual(st, 401, out)


class DeleteMarkers(Base):
    def test_set_strips_markers(self):
        st, out = self.cli.req('PUT', '/api/d/meals/m', {'a': 1, 'gone': {'__delete__': True}, 'r': {'x': {'__delete__': True}, 'y': 2}})
        self.assertEqual(out['data'], {'a': 1, 'r': {'y': 2}})
        self.assertEqual(self.cli.req('GET', '/api/d/meals/m')[1]['data'], {'a': 1, 'r': {'y': 2}})

    def test_merge_creating_strips_markers(self):
        st, out = self.cli.req('POST', '/api/batch', [{'op': 'merge', 'collection': 'meta', 'id': 'foods',
                                                       'data': {'notes': [], 'old': {'__delete__': True}}}])
        self.assertEqual(out['results'][0]['data'], {'notes': []})

    def test_update_creating_a_parent_strips_markers(self):
        self.cli.req('PUT', '/api/d/meals/u', {'desc': 'x'})
        st, out = self.cli.req('PATCH', '/api/d/meals/u', {'review': {'kcal': 500, 'feedback': {'__delete__': True}}})
        self.assertEqual(out['data'], {'desc': 'x', 'review': {'kcal': 500}})


class Errors(Base):
    def test_unexpected_errors_are_logged_not_sent(self):
        real = self.S.list_docs

        def boom(*a):
            raise RuntimeError('db path /secret/place')
        self.S.list_docs = boom
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                st, out = self.cli.req('GET', '/api/c/meals')
        finally:
            self.S.list_docs = real
        self.assertEqual((st, out), (500, {'error': {'code': 'internal', 'message': '服务器出错了，稍后再试'}}))
        self.assertIn('Traceback', err.getvalue())
        self.assertIn('RuntimeError: db path /secret/place', err.getvalue())
        self.assertIn('GET /api/c/meals', err.getvalue())

    def test_failed_begin_is_not_masked_by_rollback(self):
        class LockedConn:
            in_transaction = False

            def execute(self, sql, *a):
                if sql.startswith('BEGIN'):
                    raise sqlite3.OperationalError('database is locked')
                if sql == 'ROLLBACK':
                    raise sqlite3.OperationalError('cannot rollback - no transaction is active')
        real = self.S.conn
        self.S.conn = LockedConn
        try:
            with self.assertRaisesRegex(sqlite3.OperationalError, 'database is locked'):
                self.S.run_writes('uX', [{'op': 'set', 'collection': 'meals', 'id': 'a', 'data': {}}])
        finally:
            self.S.conn = real

    def test_error_inside_a_transaction_rolls_back(self):
        uid = self.S.find_user('admin')['id']
        with self.assertRaises(self.S.ApiError):
            self.S.run_writes(uid, [{'op': 'set', 'collection': 'meals', 'id': 'rb', 'data': {}}, 'junk'])
        self.assertFalse(self.S.conn().in_transaction)
        self.assertIsNone(self.S.get_doc(self.S.conn(), uid, 'meals', 'rb'))


class StaticFiles(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.web = tempfile.mkdtemp(prefix='lsj-web-')
        for name, text in (('index.html', '<!doctype html><script src="/app.js"></script>'), ('login.html', '<!doctype html>login'),
                           ('app.js', 'console.log(1)'), ('app.css', 'body{}'), ('login.js', '//login')):
            with open(os.path.join(cls.web, name), 'w') as f:
                f.write(text)
        cls.real_web, cls.S.WEB = cls.S.WEB, cls.web

    @classmethod
    def tearDownClass(cls):
        cls.S.WEB = cls.real_web
        super().tearDownClass()

    def get(self, path, headers=None, client=None):
        st, body = (client or self.admin).req('GET', path, headers=headers, raw=True)
        return st, body, (client or self.admin).headers

    def test_scripts_and_styles_revalidate(self):
        for path, ctype in (('/app.js', 'text/javascript'), ('/login.js', 'text/javascript'), ('/app.css', 'text/css')):
            st, body, h = self.get(path, client=Client(self.live.base))      # no login needed
            self.assertEqual(st, 200, path)
            self.assertTrue(h['Content-Type'].startswith(ctype), h['Content-Type'])
            self.assertEqual(h['Cache-Control'], 'no-cache')
            self.assertTrue(h['ETag'].startswith('"'))
            self.assertTrue(h['Last-Modified'].endswith('GMT'))
            st, body, h2 = self.get(path, {'If-None-Match': h['ETag']})
            self.assertEqual((st, body), (304, b''))
            self.assertEqual(h2['ETag'], h['ETag'])
            self.assertEqual(self.get(path, {'If-Modified-Since': h['Last-Modified']})[0], 304)
            self.assertEqual(self.get(path, {'If-None-Match': '"stale"'})[0], 200)

    def test_changed_file_gets_a_new_etag(self):
        st, _, h = self.get('/app.js')
        p = os.path.join(self.web, 'app.js')
        with open(p, 'w') as f:
            f.write('console.log(2)')
        os.utime(p, (time.time() + 5, time.time() + 5))
        st, body, h2 = self.get('/app.js', {'If-None-Match': h['ETag']})
        self.assertEqual((st, body), (200, b'console.log(2)'))
        self.assertNotEqual(h2['ETag'], h['ETag'])

    def test_page_csp_allows_no_inline_scripts(self):
        st, _, h = self.get('/')
        self.assertEqual(st, 200)
        csp = h['Content-Security-Policy']
        script = next(p for p in csp.split(';') if p.strip().startswith('script-src'))
        self.assertEqual(script.strip(), "script-src 'self'")
        self.assertEqual(h['Cache-Control'], 'no-cache')
        self.assertEqual(self.get('/', {'If-None-Match': h['ETag']})[0], 304)
        self.assertEqual(self.get('/', client=Client(self.live.base))[0], 302)      # not logged in

    def test_unknown_and_traversal_paths(self):
        for path in ('/nope.js', '/../server.py', '/%2e%2e/server.py', '/app.js.bak', '/sub/app.js', '/fonts/../app.js'):
            self.assertEqual(self.get(path)[0], 404, path)

    def test_head(self):
        st, body = self.admin.req('HEAD', '/app.js', raw=True)
        self.assertEqual((st, body), (200, b''))


if __name__ == '__main__':
    unittest.main()

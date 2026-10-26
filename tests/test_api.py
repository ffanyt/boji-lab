"""HTTP behaviour that must never regress: account isolation, token scopes, versioned writes, Apple Health ingest."""
import unittest

from helpers import ADMIN_PW, SERVICE_TOKEN, Client, LiveServer

JPEG = b'\xff\xd8\xff\xe0' + b'\0' * 64


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.admin = Client(cls.live.base)
        st, _ = cls.admin.login('admin', ADMIN_PW)
        assert st == 200, st

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def new_member(self, username):
        st, out = self.admin.req('POST', '/api/admin/users', {'username': username, 'name': username})
        self.assertEqual(st, 200, out)
        c = Client(self.live.base)
        self.assertEqual(c.login(username, out['password'])[0], 200)
        new_pw = 'Member-pass-123'
        st, _ = c.req('POST', '/api/me/password', {'current': out['password'], 'new': new_pw})
        self.assertEqual(st, 200)
        return c


class Isolation(Base):
    def test_members_never_see_each_other(self):
        bob = self.new_member('bob')
        self.assertEqual(self.admin.req('PUT', '/api/d/meals/m1', {'date': '2026-10-15', 'desc': 'admin lunch'})[0], 200)
        st, photo = self.admin.req('POST', '/api/photos', JPEG, {'Content-Type': 'image/jpeg'})
        self.assertEqual(st, 200)

        self.assertEqual(bob.req('GET', '/api/c/meals')[1]['docs'], [])
        self.assertEqual(bob.req('GET', '/api/d/meals/m1')[0], 404)
        self.assertEqual(bob.req('GET', '/api/photos/' + photo['id'], raw=True)[0], 404)
        self.assertEqual(bob.req('GET', '/api/admin/users')[0], 403)

        cli_bob = Client(self.live.base, bearer=SERVICE_TOKEN, act_as='bob')
        self.assertEqual(cli_bob.req('GET', '/api/c/meals')[1]['docs'], [])
        cli_admin = Client(self.live.base, bearer=SERVICE_TOKEN, act_as='admin')
        self.assertEqual(len(cli_admin.req('GET', '/api/c/meals')[1]['docs']), 1)

    def test_new_member_must_change_password_first(self):
        st, out = self.admin.req('POST', '/api/admin/users', {'username': 'carol'})
        c = Client(self.live.base)
        c.login('carol', out['password'])
        st, body = c.req('GET', '/api/c/meals')
        self.assertEqual((st, body['error']['code']), (403, 'must_change_password'))

    def test_service_token_cannot_manage_accounts(self):
        cli = Client(self.live.base, bearer=SERVICE_TOKEN)
        self.assertEqual(cli.req('GET', '/api/admin/users')[0], 200)
        self.assertEqual(cli.req('POST', '/api/admin/users', {'username': 'mallory'})[0], 403)
        self.assertEqual(Client(self.live.base, bearer=SERVICE_TOKEN, act_as='admin').req('GET', '/api/me')[0], 403)
        self.assertEqual(cli.req('GET', '/api/c/meals')[1]['error']['code'], 'user_required')

    def test_wrong_service_token_is_not_a_user(self):
        self.assertEqual(Client(self.live.base, bearer='nope').req('GET', '/api/c/meals')[0], 401)


class UploadTokens(Base):
    def test_upload_token_can_only_ingest(self):
        tok = self.admin.req('POST', '/api/me/tokens', {'name': 't'})[1]['token']
        up = Client(self.live.base, bearer=tok)
        st, out = up.req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '1200', 's': '2026-10-15T09:00:00+08:00'})
        self.assertEqual(st, 200, out)
        self.assertEqual(up.req('GET', '/api/c/meals')[0], 403)
        self.assertEqual(up.req('GET', '/api/me')[0], 403)

        tid = self.admin.req('GET', '/api/me/tokens')[1]['tokens'][0]['id']
        self.admin.req('DELETE', '/api/me/tokens/' + tid)
        st, out = up.req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '1', 's': '2026-10-15T09:00:00+08:00'})
        self.assertEqual((st, out['error']['code']), (401, 'bad_token'))
        self.assertIn('message', out)                                  # the Shortcut shows this in its notification

    def test_upload_token_is_not_a_page_login(self):
        tok = self.admin.req('POST', '/api/me/tokens', {'name': 'page'})[1]['token']
        up = Client(self.live.base, bearer=tok)
        self.assertEqual(up.req('GET', '/', raw=True)[0], 302)
        self.assertEqual(up.req('GET', '/shortcut', raw=True)[0], 302)
        cli = Client(self.live.base, bearer=SERVICE_TOKEN, act_as='admin')
        self.assertEqual(cli.req('GET', '/', raw=True)[0], 302)            # nor is the CLI token


class Versioning(Base):
    def test_if_version_zero_means_create_only(self):
        self.assertEqual(self.admin.req('PUT', '/api/d/reports/r1', {'a': 1}, {'If-Match': '0'})[0], 200)
        st, out = self.admin.req('PUT', '/api/d/reports/r1', {'a': 2}, {'If-Match': '0'})
        self.assertEqual((st, out['error']['code'], out['error']['version']), (409, 'conflict', 1))

    def test_patch_merges_and_bumps_version(self):
        self.admin.req('PUT', '/api/d/meals/v1', {'desc': 'x', 'feedback': 'high', 'needsReview': True})
        st, out = self.admin.req('PATCH', '/api/d/meals/v1', {'review': {'kcal': 500}, 'needsReview': False,
                                                              'feedback': {'__delete__': True}}, {'If-Match': '1'})
        self.assertEqual(st, 200)
        self.assertEqual(out['version'], 2)
        self.assertEqual(out['data'], {'desc': 'x', 'needsReview': False, 'review': {'kcal': 500}})

    def test_patch_missing_doc_is_404_and_merge_creates(self):
        self.assertEqual(self.admin.req('PATCH', '/api/d/meals/nope', {'a': 1})[0], 404)
        st, out = self.admin.req('POST', '/api/batch', [{'op': 'merge', 'collection': 'meta', 'id': 'foods', 'data': {'notes': []}}])
        self.assertEqual((st, out['results'][0]['version']), (200, 1))

    def test_batch_is_all_or_nothing(self):
        self.admin.req('PUT', '/api/d/meals/b1', {'n': 1})
        st, _ = self.admin.req('POST', '/api/batch', [
            {'op': 'set', 'collection': 'meals', 'id': 'b2', 'data': {'n': 2}},
            {'op': 'update', 'collection': 'meals', 'id': 'b1', 'data': {'n': 9}, 'ifVersion': 7},
        ])
        self.assertEqual(st, 409)
        self.assertEqual(self.admin.req('GET', '/api/d/meals/b2')[0], 404)

    def test_rev_moves_on_every_write(self):
        r0 = self.admin.req('GET', '/api/rev')[1]['rev']
        self.admin.req('PUT', '/api/d/meals/rv', {'x': 1})
        self.assertEqual(self.admin.req('GET', '/api/rev')[1]['rev'], r0 + 1)

    def test_bad_collection_and_id(self):
        self.assertEqual(self.admin.req('GET', '/api/d/secrets/x')[0], 404)
        self.assertEqual(self.admin.req('GET', '/api/d/meals/' + 'a%2F..%2Fb')[0], 400)

    def test_bad_limit_is_400(self):
        self.assertEqual(self.admin.req('GET', '/api/c/meals?limit=abc')[0], 400)


class Ingest(Base):
    def setUp(self):
        self.tok = self.admin.req('POST', '/api/me/tokens', {'name': self.id()[-20:]})[1]['token']
        self.up = Client(self.live.base, bearer=self.tok)

    def test_sleep_writes_sleep_and_body(self):
        st, out = self.up.req('POST', '/api/ingest/health', {
            'metric': 'sleep', 'v': 'Core\nDeep', 's': '2026-10-14T23:30:00+08:00\n2026-10-15T03:00:00+08:00',
            'e': '2026-10-15T03:00:00+08:00\n2026-10-15T04:00:00+08:00'})
        self.assertEqual(st, 200, out)
        self.assertEqual(self.admin.req('GET', '/api/d/sleep/2026-10-15')[1]['data']['asleep'], 270)
        self.assertEqual(self.admin.req('GET', '/api/d/body/2026-10-15')[1]['data']['sleep'], 4.5)

    def test_partial_day_never_replaces_a_fuller_one(self):
        self.up.req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '9000', 's': '2026-10-10T12:00:00+08:00'})
        self.up.req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '300', 's': '2026-10-10T23:00:00+08:00'})
        self.assertEqual(self.admin.req('GET', '/api/d/health/2026-10-10')[1]['data']['steps'], 9000)

    def test_scale_does_not_override_typed_weight(self):
        self.admin.req('PUT', '/api/d/body/2026-10-11', {'date': '2026-10-11', 'weight': 70.0})
        self.up.req('POST', '/api/ingest/health', {'metric': 'weight', 'v': '72.0 kg', 's': '2026-10-11T07:00:00+08:00'})
        self.assertEqual(self.admin.req('GET', '/api/d/body/2026-10-11')[1]['data']['weight'], 70.0)
        self.assertEqual(self.admin.req('GET', '/api/d/health/2026-10-11')[1]['data']['weight'], 72.0)

    def test_unknown_metric_is_400_with_message(self):
        st, out = self.up.req('POST', '/api/ingest/health', {'metric': 'mood', 'v': '1', 's': '2026-10-11T07:00:00+08:00'})
        self.assertEqual(st, 400)
        self.assertIn('message', out)


class Login(Base):
    def test_rate_limit_after_five_failures_per_user_and_ip(self):
        self.live.srv_mod.PASSWORD_LIMIT.clear()
        c = Client(self.live.base)
        codes = [c.login('nobody', 'x')[0] for _ in range(6)]
        self.assertEqual(codes, [401] * 5 + [429])


if __name__ == '__main__':
    unittest.main()

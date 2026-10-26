"""Apple Health upload: partial nights, manual values, the day boundary, time zones, list checks, error messages,
Apple Watch heart rate and energy samples matched to workouts."""
import json
import time
import unittest
from datetime import datetime, timedelta, timezone

from helpers import ADMIN_PW, SERVICE_TOKEN, Client, LiveServer, raw_http

SH = timezone(timedelta(hours=8))


def night(*rows):
    """{"metric": "sleep", ...} from (value, start, end) rows."""
    return {'metric': 'sleep', 'v': '\n'.join(r[0] for r in rows), 's': '\n'.join(r[1] for r in rows),
            'e': '\n'.join(r[2] for r in rows)}


FULL = night(('Core', '2026-10-15T03:00:00+08:00', '2026-10-15T07:00:00+08:00'),
             ('Deep', '2026-10-15T07:00:00+08:00', '2026-10-15T08:00:00+08:00'),
             ('Core', '2026-10-15T08:00:00+08:00', '2026-10-15T11:00:00+08:00'))           # 8 h
TAIL = night(('Core', '2026-10-15T05:00:00+08:00', '2026-10-15T07:00:00+08:00'),
             ('Deep', '2026-10-15T07:00:00+08:00', '2026-10-15T08:00:00+08:00'),
             ('Core', '2026-10-15T08:00:00+08:00', '2026-10-15T11:00:00+08:00'))           # the last 6 h of it


class IngestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.admin = Client(cls.live.base)
        assert cls.admin.login('admin', ADMIN_PW)[0] == 200
        cls.up = Client(cls.live.base, bearer=cls.admin.req('POST', '/api/me/tokens', {'name': 'phone'})[1]['token'])

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def doc(self, col, doc_id):
        st, out = self.admin.req('GET', f'/api/d/{col}/{doc_id}')
        return out['data'] if st == 200 else None

    def ingest(self, body, path='/api/ingest/health'):
        st, out = self.up.req('POST', path, body)
        self.assertEqual(st, 200, out)
        return out


class PartialNights(IngestBase):
    def test_partial_window_does_not_replace_the_full_night(self):
        self.ingest(FULL)
        self.assertEqual(self.doc('sleep', '2026-10-15')['asleep'], 480)
        out = self.ingest(TAIL)
        self.assertIn('睡眠：已有更完整的一晚，没覆盖', out['problems'])
        self.assertIn('已有更完整的一晚', out['message'])
        self.assertIn('睡眠 03:00–11:00 8 小时 0 分', out['message'])      # the notification shows the night that was kept
        s = self.doc('sleep', '2026-10-15')
        self.assertEqual((s['asleep'], s['bedtime']), (480, '03:00'))
        self.assertEqual(self.doc('body', '2026-10-15')['sleep'], 8.0)

    def test_fuller_or_earlier_night_still_replaces(self):
        self.ingest(night(('Core', '2026-10-16T03:00:00+08:00', '2026-10-16T08:00:00+08:00')))   # synced while still asleep
        self.ingest(night(('Core', '2026-10-16T03:00:00+08:00', '2026-10-16T11:00:00+08:00')))   # the whole night later
        self.assertEqual(self.doc('sleep', '2026-10-16')['asleep'], 480)
        self.assertEqual(self.doc('body', '2026-10-16')['sleep'], 8.0)

    def test_older_sleep_endpoint_uses_the_same_rule(self):
        samples = [{'value': 'Core', 'start': '2026-10-17T03:00:00+08:00', 'end': '2026-10-17T11:00:00+08:00'}]
        self.ingest({'samples': samples}, '/api/ingest/sleep')
        samples = [{'value': 'Core', 'start': '2026-10-17T06:00:00+08:00', 'end': '2026-10-17T11:00:00+08:00'}]
        out = self.ingest({'samples': samples}, '/api/ingest/sleep')
        self.assertIn('没覆盖', out['message'])
        self.assertEqual(self.doc('sleep', '2026-10-17')['asleep'], 480)


class ManualValues(IngestBase):
    def weigh(self, kg, at):
        return self.ingest({'metric': 'weight', 'v': f'{kg} kg', 's': at})

    def test_typed_sleep_is_kept_but_the_night_is_stored(self):
        self.admin.req('PUT', '/api/d/body/2026-10-12', {'date': '2026-10-12', 'sleep': 6.5, 'sleepSource': 'manual'})
        self.ingest(night(('Core', '2026-10-12T01:00:00+08:00', '2026-10-12T09:00:00+08:00')))
        self.assertEqual(self.doc('body', '2026-10-12')['sleep'], 6.5)
        self.assertEqual(self.doc('sleep', '2026-10-12')['asleep'], 480)

    def test_auto_weight_records_weight_auto_and_keeps_updating(self):
        self.weigh(72.0, '2026-10-11T07:00:00+08:00')
        b = self.doc('body', '2026-10-11')
        self.assertEqual((b['weight'], b['weightSource'], b['weightAuto']), (72.0, 'apple-health', 72.0))
        self.weigh(71.6, '2026-10-11T07:00:00+08:00')        # same sample count: a re-read of the scale replaces it
        b = self.doc('body', '2026-10-11')
        self.assertEqual((b['weight'], b['weightAuto']), (71.6, 71.6))

    def test_weight_edited_after_the_scale_is_kept(self):
        self.weigh(72.0, '2026-10-10T07:00:00+08:00')
        st, _ = self.admin.req('PATCH', '/api/d/body/2026-10-10', {'weight': 70.4})   # an older page: no weightSource
        self.assertEqual(st, 200)
        self.weigh(72.2, '2026-10-10T07:00:00+08:00')
        self.assertEqual(self.doc('body', '2026-10-10')['weight'], 70.4)
        self.assertEqual(self.doc('health', '2026-10-10')['weight'], 72.2)

    def test_weight_source_manual_is_kept(self):
        self.admin.req('PUT', '/api/d/body/2026-10-09', {'date': '2026-10-09', 'weight': 69.9, 'weightSource': 'manual'})
        self.weigh(72.0, '2026-10-09T07:00:00+08:00')
        self.assertEqual(self.doc('body', '2026-10-09')['weight'], 69.9)

    def test_cleared_weight_stays_cleared(self):
        self.weigh(72.0, '2026-10-07T07:00:00+08:00')
        self.admin.req('PATCH', '/api/d/body/2026-10-07', {'weight': None, 'weightSource': 'manual'})   # 「清除这天体重」
        self.weigh(72.1, '2026-10-07T07:00:00+08:00')
        b = self.doc('body', '2026-10-07')
        self.assertEqual((b['weight'], b['weightSource'], b['weightAuto']), (None, 'manual', 72.0))
        self.assertEqual(self.doc('health', '2026-10-07')['weight'], 72.1)

    def test_older_automatic_weight_is_replaced(self):
        self.admin.req('PUT', '/api/d/body/2026-10-08', {'date': '2026-10-08', 'weight': 73.0, 'weightSource': 'apple-health'})
        self.weigh(72.5, '2026-10-08T07:00:00+08:00')
        self.assertEqual(self.doc('body', '2026-10-08')['weight'], 72.5)


class ManualNights(IngestBase):
    def test_edited_night_is_never_overwritten(self):
        mine = {'source': 'manual', 'date': '2026-10-20', 'bedtime': '02:00', 'wake': '09:00', 'asleep': 400, 'editedAt': '2026-10-20T03:00:00Z'}
        self.admin.req('PUT', '/api/d/sleep/2026-10-20', mine)
        self.admin.req('PUT', '/api/d/body/2026-10-20', {'date': '2026-10-20', 'sleep': 6.7, 'sleepSource': 'manual'})
        out = self.ingest(night(('Core', '2026-10-20T01:00:00+08:00', '2026-10-20T10:00:00+08:00')))   # longer, earlier: would win
        self.assertIn('睡眠：这晚你手动改过，没覆盖', out['problems'])
        self.assertIn('手动改过', out['message'])
        self.assertEqual(self.doc('sleep', '2026-10-20'), mine)
        self.assertEqual(self.doc('body', '2026-10-20')['sleep'], 6.7)

    def test_cleared_night_stays_cleared_and_body_is_left_alone(self):
        cleared = {'source': 'manual', 'date': '2026-10-21', 'cleared': True, 'editedAt': '2026-10-21T03:00:00Z'}
        self.admin.req('PUT', '/api/d/sleep/2026-10-21', cleared)
        out = self.ingest(night(('Core', '2026-10-21T01:00:00+08:00', '2026-10-21T09:00:00+08:00')))
        self.assertIn('睡眠：这晚你手动改过，没覆盖', out['problems'])
        self.assertEqual(self.doc('sleep', '2026-10-21'), cleared)
        self.assertIsNone(self.doc('body', '2026-10-21'))
        samples = [{'value': 'Core', 'start': '2026-10-21T01:00:00+08:00', 'end': '2026-10-21T09:00:00+08:00'}]
        out = self.ingest({'samples': samples}, '/api/ingest/sleep')                      # the older endpoint too
        self.assertIn('手动改过', out['message'])
        self.assertEqual(self.doc('sleep', '2026-10-21'), cleared)

    def test_restoring_auto_lets_the_next_sync_refill(self):
        self.admin.req('PUT', '/api/d/sleep/2026-10-22', {'source': 'manual', 'date': '2026-10-22', 'cleared': True})
        self.admin.req('DELETE', '/api/d/sleep/2026-10-22')                                 # 「恢复自动」
        self.ingest(night(('Core', '2026-10-22T01:00:00+08:00', '2026-10-22T09:00:00+08:00')))
        self.assertEqual((self.doc('sleep', '2026-10-22')['source'], self.doc('body', '2026-10-22')['sleep']), ('apple-health', 8.0))


class HealthDocs(IngestBase):
    def test_ignore_and_unknown_fields_survive_a_sync(self):
        self.admin.req('PUT', '/api/d/health/2026-10-03', {'date': '2026-10-03', 'steps': 300, 'activeKcal': 900,
                                                           'ignore': ['activeKcal'], 'note': 'x', 'n': {'rhr': 1}})
        self.ingest({'steps_v': '6000', 'steps_s': '2026-10-03T12:00:00+08:00', 'rhr_v': '55', 'rhr_s': '2026-10-03T06:00:00+08:00'})
        h = self.doc('health', '2026-10-03')
        self.assertEqual((h['steps'], h['activeKcal'], h['ignore'], h['note'], h['restingHR']), (6000, 900, ['activeKcal'], 'x', 55))


class DaysAndZones(IngestBase):
    def test_late_night_weigh_in_belongs_to_the_day_before(self):
        self.ingest({'metric': 'weight', 'v': '70.8 kg', 's': '2026-10-15T01:30:00+08:00'})
        self.assertEqual(self.doc('health', '2026-10-14')['weight'], 70.8)
        self.assertEqual(self.doc('body', '2026-10-14')['weight'], 70.8)
        self.assertIsNone(self.doc('body', '2026-10-15'))

    def test_steps_stay_on_the_calendar_day(self):
        self.ingest({'metric': 'steps', 'v': '321', 's': '2026-10-13T01:30:00+08:00'})
        self.assertEqual(self.doc('health', '2026-10-13')['steps'], 321)

    def test_utc_sleep_times_land_on_the_local_night(self):
        out = self.ingest(night(('Core', '2026-10-05T19:00:00Z', '2026-10-05T23:30:00Z')))   # 03:00–07:30 in Shanghai
        self.assertIn('10/6', out['message'])
        s = self.doc('sleep', '2026-10-06')
        self.assertEqual((s['bedtime'], s['wake'], s['start']), ('03:00', '07:30', '2026-10-06T03:00:00+08:00'))
        self.assertIsNone(self.doc('sleep', '2026-10-05'))

    def test_me_reports_the_config(self):
        st, me = self.admin.req('GET', '/api/me')
        self.assertEqual(me['config'], {'tz': 'Asia/Shanghai', 'dayStartHour': 5, 'dayStartDefault': 5})
        st, me = self.admin.req('PATCH', '/api/me', {'name': 'Admin'})
        self.assertEqual(me['config']['dayStartHour'], 5)


class PerUserDayStart(IngestBase):
    def tearDown(self):
        self.admin.req('DELETE', '/api/d/profile/prefs')

    def prefs(self, **kw):
        self.assertEqual(self.admin.req('PUT', '/api/d/profile/prefs', kw)[0], 200)

    def test_me_and_the_cli_listing_follow_the_prefs(self):
        self.prefs(dayStartHour=3)
        me = self.admin.req('GET', '/api/me')[1]
        self.assertEqual((me['config']['dayStartHour'], me['config']['dayStartDefault']), (3, 5))
        cli = Client(self.live.base, bearer=SERVICE_TOKEN)
        u = next(x for x in cli.req('GET', '/api/admin/users')[1]['users'] if x['username'] == 'admin')
        self.assertEqual((u['dayStartHour'], u['tz']), (3, 'Asia/Shanghai'))

    def test_bad_values_fall_back_to_the_server_default(self):
        for v in (13, -1, 4.5, '4', True, None, [4]):
            self.prefs(dayStartHour=v)
            self.assertEqual(self.admin.req('GET', '/api/me')[1]['config']['dayStartHour'], 5, v)
        self.prefs(dayStartHour=0)
        self.assertEqual(self.admin.req('GET', '/api/me')[1]['config']['dayStartHour'], 0)

    def test_weight_follows_the_persons_day_start(self):
        self.prefs(dayStartHour=0)
        self.ingest({'metric': 'weight', 'v': '70.8 kg', 's': '2026-09-15T01:30:00+08:00'})
        self.assertEqual(self.doc('body', '2026-09-15')['weight'], 70.8)       # midnight start: 01:30 is the 15th already
        self.assertIsNone(self.doc('body', '2026-09-14'))
        self.prefs(dayStartHour=3)
        self.ingest({'metric': 'weight', 'v': '70.2 kg', 's': '2026-09-17T02:30:00+08:00'})
        self.assertEqual(self.doc('body', '2026-09-16')['weight'], 70.2)


class SleepLists(IngestBase):
    def test_line_counts_must_match(self):
        body = night(('Core', '2026-10-01T03:00:00+08:00', '2026-10-01T09:00:00+08:00'),
                     ('Deep', '2026-10-01T09:00:00+08:00', '2026-10-01T10:00:00+08:00'))
        body['e'] = '2026-10-01T09:00:00+08:00'        # one end date short
        st, out = self.up.req('POST', '/api/ingest/health', body)
        self.assertEqual(st, 400)
        self.assertIn('数量对不上', out['message'])
        self.assertIsNone(self.doc('sleep', '2026-10-01'))

    def test_mismatch_is_a_problem_when_other_data_arrived(self):
        out = self.ingest({'steps_v': '5000', 'steps_s': '2026-10-02T12:00:00+08:00',
                           'sleep_v': 'Core\nCore', 'sleep_s': '2026-10-02T03:00:00+08:00', 'sleep_e': ''})
        self.assertIn('睡眠的值、开始和结束日期数量对不上', out['problems'])
        self.assertEqual(self.doc('health', '2026-10-02')['steps'], 5000)

    def test_empty_sleep_is_not_an_error(self):
        out = self.ingest({'metric': 'sleep', 'v': '', 's': '', 'e': ''})
        self.assertIn('这次没有新的睡眠数据', out['message'])


class IngestErrors(IngestBase):
    def check(self, body, status, headers=None, contains=None):
        st, out = self.up.req('POST', '/api/ingest/health', body, headers)
        self.assertEqual(st, status, out)
        self.assertIsInstance(out, dict)
        self.assertRegex(out['message'], r'[一-鿿]')        # Chinese, for the Shortcut's notification
        if contains:
            self.assertIn(contains, out['message'])
        return out

    def test_bad_bodies(self):
        self.check(b'{not json', 400, {'Content-Type': 'application/json'})
        self.check(b'{"metric": "steps", "v": "\xff\xfe", "s": "x"}', 400, {'Content-Type': 'application/json'})
        self.check(b'{"metric": "steps", "v": NaN, "s": "2026-10-01T09:00:00+08:00"}', 400, {'Content-Type': 'application/json'})
        self.check([1, 2], 400)
        self.check({'metric': 'mood', 'v': '1', 's': '2026-10-01T09:00:00+08:00'}, 400, contains='mood')

    def test_too_large_is_refused_before_reading(self):
        head = (f'POST /api/ingest/health HTTP/1.1\r\nHost: x\r\nAuthorization: {self.up.bearer}\r\n'
                f'Content-Type: application/json\r\nContent-Length: {2 * 1024 * 1024}\r\n\r\n').encode()
        got, closed = raw_http(self.live.base, head)
        status, _, payload = got.partition(b'\r\n\r\n')
        self.assertTrue(status.startswith(b'HTTP/1.1 413'), status)
        self.assertIn(b'Connection: close', status)
        self.assertTrue(closed)
        self.assertIn('太多', json.loads(payload)['message'])

    def test_bad_tokens(self):
        for tok in ('lsj_nope', 'lsj_café'):
            st, out = Client(self.live.base, bearer=tok).req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '1', 's': 'x'})
            self.assertEqual((st, out['error']['code']), (401, 'bad_token'))
            self.assertIn('同步令牌', out['message'])
        st, out = Client(self.live.base).req('POST', '/api/ingest/health', {'metric': 'steps'})
        self.assertEqual(st, 401)
        self.assertIn('同步令牌', out['message'])

    def test_internal_error_has_a_message_and_no_details(self):
        S = self.live.srv_mod
        real = S.summarize_health

        def boom(*a):
            raise RuntimeError('secret internals')
        S.summarize_health = boom
        try:
            import contextlib
            import io
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                out = self.check({'metric': 'steps', 'v': '1', 's': '2026-10-01T09:00:00+08:00'}, 500)
        finally:
            S.summarize_health = real
        self.assertEqual(out['error'], {'code': 'internal', 'message': '服务器出错了，稍后再试'})
        self.assertNotIn('secret', str(out))
        self.assertIn('RuntimeError: secret internals', err.getvalue())



class BodyFat(IngestBase):
    def fat(self, v, at):
        return self.ingest({'metric': 'bodyfat', 'v': v, 's': at})

    def test_fraction_or_percentage(self):
        for i, v in enumerate(('0.185', '18.5', '18.5%', '0.185 %', 0.185, '18.54')):   # "0.185 %" is 0.185 percent: dropped
            day = f'2026-08-{i + 1:02d}'
            out = self.fat(v, f'{day}T08:00:00+08:00')
            want = None if v == '0.185 %' else 18.5
            self.assertEqual((self.doc('health', day) or {}).get('bodyFat'), want, v)
            if want:
                self.assertIn('体脂 18.5%', out['message'])

    def test_body_gets_it_with_the_auto_value(self):
        out = self.ingest({'metric': 'weight', 'v': '72.0 kg', 's': '2026-08-10T08:00:00+08:00'})
        self.fat('0.2', '2026-08-10T08:00:05+08:00')
        b = self.doc('body', '2026-08-10')
        self.assertEqual((b['bodyFat'], b['bodyFatSource'], b['bodyFatAuto'], b['weight']), (20.0, 'apple-health', 20.0, 72.0))
        out = self.fat('0.198', '2026-08-10T07:00:00+08:00')                  # an earlier reading that day: the day's first
        self.assertIn('体重 72.0 kg · 体脂 19.8%', out['message'])
        self.assertEqual((self.doc('body', '2026-08-10')['bodyFat'], self.doc('health', '2026-08-10')['n']['bodyfat']), (19.8, 1))

    def test_typed_body_fat_is_kept(self):
        self.admin.req('PUT', '/api/d/body/2026-08-11', {'date': '2026-08-11', 'bodyFat': 17.0, 'bodyFatSource': 'manual'})
        self.fat('0.2', '2026-08-11T08:00:00+08:00')
        self.assertEqual(self.doc('body', '2026-08-11')['bodyFat'], 17.0)
        self.assertEqual(self.doc('health', '2026-08-11')['bodyFat'], 20.0)
        self.fat('0.2', '2026-08-12T08:00:00+08:00')
        self.admin.req('PATCH', '/api/d/body/2026-08-12', {'bodyFat': 21.5})       # edited after the scale, no source
        self.fat('0.19', '2026-08-12T08:00:00+08:00')
        self.assertEqual(self.doc('body', '2026-08-12')['bodyFat'], 21.5)
        self.admin.req('PATCH', '/api/d/body/2026-08-12', {'bodyFat': None, 'bodyFatSource': 'manual'})   # cleared on the page
        self.fat('0.19', '2026-08-12T08:00:00+08:00')
        self.assertIsNone(self.doc('body', '2026-08-12')['bodyFat'])

    def test_all_at_once_by_the_persons_day(self):
        out = self.ingest({'bodyfat_v': '0.21\n0.2\n0.19', 'bodyfat_s': '2026-08-14T01:30:00+08:00\n2026-08-14T09:00:00+08:00\n'
                                                                          '2026-08-14T10:00:00+08:00',
                           'weight_v': '70', 'weight_s': '2026-08-14T09:00:00+08:00'})
        self.assertEqual(out['days']['2026-08-13'], {'bodyfat': 21.0, 'n': {'bodyfat': 1}})    # 01:30: still the day before
        self.assertEqual(self.doc('health', '2026-08-14')['bodyFat'], 20.0)
        self.assertEqual(self.doc('body', '2026-08-14')['bodyFat'], 20.0)
        self.ingest({'metric': 'bodyfat', 'v': '0.25', 's': '2026-08-14T08:00:00+08:00'})      # fewer samples than stored
        self.assertEqual(self.doc('health', '2026-08-14')['bodyFat'], 20.0)

    def test_nonsense_is_dropped(self):
        out = self.fat('0.9', '2026-08-15T08:00:00+08:00')                        # 90 %
        self.assertIn('这次没有新的体脂率数据', out['message'])
        self.assertIsNone(self.doc('health', '2026-08-15'))


class Progress(IngestBase):
    def test_progress_photos_are_a_collection(self):
        data = {'date': '2026-10-16', 'photos': {'front': 'a' * 32, 'side': 'b' * 32}, 'note': '早上空腹', 'needsReview': True}
        st, out = self.admin.req('PUT', '/api/d/progress/2026-10-16', data)
        self.assertEqual(st, 200, out)
        cli = Client(self.live.base, bearer=SERVICE_TOKEN, act_as='admin')
        st, out = cli.req('GET', '/api/c/progress?where=needsReview:eq:true')
        self.assertEqual((st, [d['id'] for d in out['docs']]), (200, ['2026-10-16']))
        st, out = cli.req('PATCH', '/api/d/progress/2026-10-16', {'needsReview': False, 'review': {'comment': '腰线清楚了一点'}})
        self.assertEqual((st, out['data']['photos']['front']), (200, 'a' * 32))
        cli.req('PATCH', '/api/d/progress/2026-10-16', {'needsReview': True})
        users = cli.req('GET', '/api/admin/users')[1]['users']
        self.assertEqual(users[0]['pending'], 1)


def utc(t):
    return t.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


class WatchSamples(IngestBase):
    """hr / kcals: single samples that go onto workouts logged in 训练中 (startedAt–endedAt), never into health/."""

    def setUp(self):
        for d in self.admin.req('GET', '/api/c/workouts')[1]['docs']:
            self.admin.req('DELETE', f'/api/d/workouts/{d["id"]}')
        self.t0 = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=20)   # when the workout starts

    @staticmethod
    def day(t):  # the person's day (it starts at 05:00 in Shanghai)
        return (t.astimezone(SH) - timedelta(hours=5)).date().isoformat()

    def md(self):
        d = self.day(self.t0)
        return f'{int(d[5:7])}/{int(d[8:10])}'

    def workout(self, wid='w1', start=None, minutes=60, **kw):
        start = start or self.t0
        data = {'date': self.day(start), 'planDayId': 'A', 'title': 'A · 胸 肩 三头', 'startedAt': utc(start),
                'endedAt': utc(start + timedelta(minutes=minutes)), 'needsReview': True,
                'exercises': [{'name': '杠铃卧推', 'sets': [{'kg': 60, 'reps': 8, 'done': True},
                                                           {'kg': 45, 'reps': 8, 'done': True, 'drop': True}]}]}
        data.update(kw)
        st, out = self.admin.req('PUT', f'/api/d/workouts/{wid}', {k: v for k, v in data.items() if v is not None})
        self.assertEqual(st, 200, out)
        return out

    def send(self, metric, rows, zone=SH, t0=None, src=None):
        """rows: (minutes after the workout starts, value), the time written in `zone` (an iPhone in China: +08:00);
        src: the source names as sent (one per line), or None to leave them out."""
        t0 = t0 or self.t0
        body = {'metric': metric, 'v': '\n'.join(str(v) for _, v in rows),
                's': '\n'.join((t0 + timedelta(minutes=m)).astimezone(zone).isoformat() for m, _ in rows)}
        if src is not None:
            body['src'] = src
        return self.ingest(body)

    def get(self, wid='w1'):
        return self.admin.req('GET', f'/api/d/workouts/{wid}')[1]

    def test_samples_between_start_and_end_by_absolute_time(self):
        self.workout()
        out = self.send('hr', [(-1, 150), (0, 100), (10, 120), (20, 130), (30, 140), (60, 160), (61, 170)])
        hr = self.get()['data']['heartRate']
        self.assertEqual({k: hr[k] for k in ('avg', 'max', 'min', 'n', 'source')},
                         {'avg': 130, 'max': 160, 'min': 100, 'n': 5, 'source': 'apple-health'})   # both ends count, outside doesn't
        self.assertTrue(hr['at'].endswith('Z'))
        self.assertEqual(out['workouts'], ['w1'])
        self.assertIn(f'\n训练心率：{self.md()} 胸 肩 三头 均 130 · 最高 160', out['message'])
        out = self.send('kcals', [(-1, 50), (5, 10.4), (30, '20.3'), (60, '30 kcal'), (61, 40)], zone=timezone.utc)  # UTC times
        w = self.get()['data']
        self.assertEqual((w['kcal'], w['kcalSource']), (61, 'apple-health'))
        self.assertIn(f'训练心率：{self.md()} 胸 肩 三头 均 130 · 最高 160 · 消耗 61 kcal', out['message'])  # the Shortcut's last request
        self.assertNotIn('这次没有新的', out['message'])

    def test_only_the_heart_rate_and_energy_fields_change(self):
        review = {'rating': 'good', 'comment': '稳', 'reviewedAt': '2026-10-16T12:00:00Z'}
        before = self.workout(needsReview=False, review=review, notes='最后一组力竭')
        rev = self.admin.req('GET', '/api/rev')[1]['rev']
        self.send('hr', [(m, 120 + m) for m in range(0, 60, 10)])
        after = self.get()
        self.assertEqual(after['version'], before['version'] + 1)
        self.assertGreater(self.admin.req('GET', '/api/rev')[1]['rev'], rev)
        self.assertEqual({k: v for k, v in after['data'].items() if k != 'heartRate'}, before['data'])
        self.assertIs(after['data']['needsReview'], False)
        self.send('hr', [(m, 120 + m) for m in range(0, 60, 10)])          # the next sync sees the same samples: no write
        self.assertEqual(self.get()['version'], after['version'])
        self.workout('w2', start=self.t0 + timedelta(hours=3))              # needsReview true stays true too
        self.send('kcals', [(185, 80)])
        w2 = self.get('w2')['data']
        self.assertEqual((w2['kcal'], w2['needsReview']), (80, True))

    def test_nothing_goes_into_health(self):
        self.workout()
        self.send('hr', [(m, 130) for m in range(0, 60, 5)])
        self.send('kcals', [(m, 5) for m in range(0, 60, 5)])
        self.assertIsNotNone(self.get()['data'].get('heartRate'))
        for t in (self.t0, self.t0 + timedelta(hours=1)):
            for d in (self.day(t), t.astimezone(SH).date().isoformat()):
                self.assertIsNone(self.doc('health', d), d)

    def test_workouts_that_get_nothing(self):
        self.workout('live', status='active')                                     # still being logged
        self.workout('xj-123', source='xunji', heartRate=None, kcal=None)           # imported from 训记: has its own
        self.workout('noend', endedAt=None)                                         # no window (old manual form)
        self.workout('long', minutes=6 * 60)                                        # finished the next morning
        old = self.t0 - timedelta(days=3)                                           # started more than 3 days ago
        self.workout('old', start=old)
        rows = [(m, 130) for m in range(0, 60, 5)]
        out = self.send('hr', rows)
        self.send('hr', rows, t0=old)
        self.send('kcals', [(m, 5) for m in range(0, 60, 5)])
        for wid in ('live', 'xj-123', 'noend', 'long', 'old'):
            w = self.get(wid)['data']
            self.assertNotIn('heartRate', w, wid)
            self.assertNotIn('kcal', w, wid)
        self.assertEqual(out['workouts'], [])
        self.assertNotIn('训练心率', out['message'])

    def test_too_few_heart_rate_samples(self):
        self.workout()
        out = self.send('hr', [(0, 120), (10, 130), (20, 140), (30, 150)])
        self.assertNotIn('heartRate', self.get()['data'])
        self.assertNotIn('训练', out['message'].split('\n提醒')[0])
        out = self.send('kcals', [(10, 12.4)])                                     # energy needs no minimum
        self.assertEqual(self.get()['data']['kcal'], 12)
        self.assertIn(f'训练消耗：{self.md()} 胸 肩 三头 12 kcal', out['message'])

    def test_a_fuller_value_is_kept(self):
        self.workout()
        self.send('hr', [(m, 130) for m in range(0, 50, 5)])                      # 10 samples
        self.send('kcals', [(m, 30) for m in range(0, 50, 5)])                    # 300 kcal
        self.send('hr', [(m, 100) for m in range(30, 60, 5)])                     # a later look-back caught only the end
        self.send('kcals', [(m, 40) for m in range(30, 60, 5)])                   # 240 kcal
        w = self.get()['data']
        self.assertEqual((w['heartRate']['avg'], w['heartRate']['n'], w['kcal']), (130, 10, 300))
        self.send('hr', [(m, 140) for m in range(0, 60, 5)])                      # more samples: replaces
        self.send('kcals', [(m, 30) for m in range(0, 60, 5)])                    # 360 kcal
        w = self.get()['data']
        self.assertEqual((w['heartRate']['avg'], w['heartRate']['n'], w['kcal'], w['kcalSource']), (140, 12, 360, 'apple-health'))

    def test_values_from_elsewhere_are_left_alone(self):
        mine = {'avg': 118, 'max': 150}
        self.workout(heartRate=mine, kcal=400)
        self.workout('w2', start=self.t0 + timedelta(hours=2), kcal=None, kcalSource='manual', heartRate={'avg': 99, 'source': 'polar'})
        out = self.send('hr', [(m, 130) for m in range(0, 180, 5)])
        self.send('kcals', [(m, 5) for m in range(0, 180, 5)])
        w, w2 = self.get()['data'], self.get('w2')['data']
        self.assertEqual((w['heartRate'], w['kcal'], w.get('kcalSource')), (mine, 400, None))
        self.assertEqual(w2['heartRate'], {'avg': 99, 'source': 'polar'})
        self.assertEqual((w2['kcal'], w2['kcalSource']), (60, 'apple-health'))      # no kcal stored: filled in
        self.assertEqual(out['workouts'], [])
        self.assertIn(f'训练心率：{self.md()} 胸 肩 三头 均 118 · 最高 150 · 消耗 400 kcal', out['message'])   # what it has

    def test_kilojoules_and_units(self):
        self.workout()
        self.send('hr', [(m, f'{120 + m} count/min') for m in range(0, 60, 10)])
        self.send('kcals', [(5, '209.2 kJ'), (15, '209.2 千焦'), (25, '1,000 kcal'), (35, 'x')])   # 50 + 50 + 1000
        w = self.get()['data']
        self.assertEqual((w['heartRate']['avg'], w['kcal']), (145, 1100))

    def test_samples_matching_no_workout(self):
        out = self.send('hr', [(m, 130) for m in range(0, 60, 5)])
        self.assertNotIn('训练', out['message'].split('\n提醒')[0])
        self.assertNotIn('这次没有新的', out['message'])
        out = self.ingest({'metric': 'kcals', 'v': '', 's': ''})
        self.assertNotIn('这次没有新的', out['message'])                          # no Watch: not worth a word
        self.assertTrue(out['message'].startswith('已同步 '))

    def test_all_at_once_and_list_checks(self):
        self.workout()
        times = '\n'.join((self.t0 + timedelta(minutes=m)).isoformat() for m in range(0, 60, 10))
        out = self.ingest({'steps_v': '6000', 'steps_s': '2026-01-05T12:00:00+08:00',
                           'hr_v': '120\n125\n130\n135\n140\n145', 'hr_s': times})
        self.assertEqual(self.doc('health', '2026-01-05')['steps'], 6000)
        self.assertEqual(self.get()['data']['heartRate']['n'], 6)
        self.assertEqual(out['workouts'], ['w1'])
        st, out = self.up.req('POST', '/api/ingest/health', {'metric': 'hr', 'v': '120\n130', 's': times})
        self.assertEqual(st, 400)
        self.assertIn('心率明细的值和日期数量对不上', out['message'])

    def test_a_save_on_the_page_in_between_is_retried(self):
        self.workout(needsReview=False)
        S, calls = self.live.srv_mod, []
        real = S.workout_updates

        def racing(c, uid, samples, now=None):
            out = real(c, uid, samples, now)
            calls.append(1)
            if len(calls) == 1:                         # the page saves the workout after the samples were matched
                self.admin.req('PATCH', '/api/d/workouts/w1', {'notes': '最后一组力竭'})
            return out
        S.workout_updates = racing
        try:
            out = self.send('hr', [(m, 130) for m in range(0, 60, 5)])
        finally:
            S.workout_updates = real
        w = self.get()['data']
        self.assertEqual(len(calls), 2)
        self.assertEqual((w['notes'], w['heartRate']['n'], w['needsReview']), ('最后一组力竭', 12, False))
        self.assertEqual(out['problems'], [])

    def test_a_page_that_keeps_saving_wins(self):
        self.workout()
        S, n = self.live.srv_mod, [0]
        real = S.workout_updates

        def racing(c, uid, samples, now=None):
            out = real(c, uid, samples, now)
            n[0] += 1
            self.admin.req('PATCH', '/api/d/workouts/w1', {'notes': f'改了 {n[0]} 次'})
            return out
        S.workout_updates = racing
        try:
            out = self.send('hr', [(m, 130) for m in range(0, 60, 5)])
        finally:
            S.workout_updates = real
        self.assertEqual(n[0], 2)
        self.assertIn('训练心率：训练记录刚被改过，下次同步再算', out['problems'])
        self.assertNotIn('heartRate', self.get()['data'])

    def test_only_the_watch_counts_when_it_has_samples(self):
        self.workout()
        phone, watch, old = 'iPhone', '小林的Apple Watch', 'Old apple WATCH'
        rows = [(m, 5) for m in range(0, 60, 5)] + [(m, 1) for m in range(2, 60, 5)] + [(3, 40), (8, 40)]
        src = [watch] * 12 + [phone] * 12 + [old, old]
        out = self.send('kcals', rows, src='\n'.join(src))             # 60 from the Watch, 12 from the iPhone, 80 from an old Watch
        self.assertEqual(self.get()['data']['kcal'], 60)
        self.assertEqual(out['problems'], [])
        hr = [(m, 130) for m in range(0, 60, 10)] + [(m, 90) for m in range(5, 60, 10)]
        self.send('hr', hr, src='\n'.join(['我的手表'] * 6 + [phone] * 6))
        self.assertEqual({k: self.get()['data']['heartRate'][k] for k in ('avg', 'n')}, {'avg': 130, 'n': 6})

    def test_phone_only_or_no_sources_count_everything(self):
        self.workout()
        self.workout('w2', start=self.t0 + timedelta(hours=2))
        rows = [(m, 5) for m in range(0, 60, 5)] + [(m, 5) for m in range(120, 180, 5)]
        self.send('kcals', rows, src='\n'.join(['iPhone'] * 12 + ['小林的Apple Watch'] * 12))   # w1 had only the phone
        self.assertEqual((self.get()['data']['kcal'], self.get('w2')['data']['kcal']), (60, 60))

    def test_source_lines_that_dont_fit_are_ignored(self):
        self.workout()
        rows = [(m, 5) for m in range(0, 60, 5)]
        out = self.send('kcals', rows, src='Apple Watch\niPhone')         # 2 names for 12 values: all samples count
        self.assertEqual((self.get()['data']['kcal'], out['problems']), (60, []))
        self.workout('w2', start=self.t0 + timedelta(hours=2))
        out = self.send('kcals', [(m, 5) for m in range(120, 140, 5)], src='')
        self.assertEqual((self.get('w2')['data']['kcal'], out['problems']), (20, []))
        times = '\n'.join((self.t0 + timedelta(minutes=m)).isoformat() for m in range(0, 60, 10))
        self.ingest({'hr_v': '120\n125\n130\n100\n100\n100\n', 'hr_s': times,                # all at once: hr_src
                     'hr_src': 'Apple Watch\nApple Watch\nApple Watch\niPhone\niPhone\niPhone'})
        self.assertNotIn('heartRate', self.get()['data'])                   # 3 Watch samples: fewer than 5
        self.ingest({'hr_v': '120\n125\n130\n100\n100\n100', 'hr_s': times, 'hr_src': [1, 2]})
        self.assertEqual(self.get()['data']['heartRate']['n'], 6)

    def test_two_days_of_samples_in_one_request(self):
        self.workout()
        start = self.t0 - timedelta(hours=24)
        n = 2 * 24 * 120                                                            # every 30 s for two days
        ts = '\n'.join((start + timedelta(seconds=30 * i)).astimezone(SH).isoformat() for i in range(n))
        body = {'hr_v': '\n'.join(str(60 + i % 100) for i in range(n)), 'hr_s': ts,
                'kcals_v': '\n'.join('0.85' for _ in range(n)), 'kcals_s': ts}
        self.assertLess(len(json.dumps(body)), 1024 * 1024)
        t = time.monotonic()
        out = self.ingest(body)
        self.assertLess(time.monotonic() - t, 5)
        w = self.get()['data']
        self.assertEqual((w['heartRate']['n'], w['kcal']), (121, round(121 * 0.85)))
        self.assertEqual(out['workouts'], ['w1'])


if __name__ == '__main__':
    unittest.main()

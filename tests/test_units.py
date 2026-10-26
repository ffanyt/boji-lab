"""Pure functions in app/server.py: merge semantics, Apple Health parsing, sleep summarising, passwords, limits."""
import types
import unittest
from datetime import datetime, timedelta, timezone

from helpers import server_module

S = server_module()
CST = timezone(timedelta(hours=8))


class DeepMerge(unittest.TestCase):
    def test_nested_objects_merge_arrays_replace(self):
        base = {'a': 1, 'review': {'kcal': 500, 'items': [1, 2]}, 'photos': ['x', 'y']}
        out = S.deep_merge(base, {'review': {'kcal': 450, 'items': [3]}, 'photos': ['z']})
        self.assertEqual(out, {'a': 1, 'review': {'kcal': 450, 'items': [3]}, 'photos': ['z']})

    def test_delete_marker_removes_key(self):
        out = S.deep_merge({'feedback': 'high', 'x': 1}, {'feedback': {'__delete__': True}})
        self.assertEqual(out, {'x': 1})

    def test_delete_marker_with_other_keys_is_a_plain_value(self):
        out = S.deep_merge({}, {'k': {'__delete__': True, 'other': 1}})
        self.assertEqual(out, {'k': {'__delete__': True, 'other': 1}})

    def test_base_is_not_mutated(self):
        base = {'r': {'a': 1}}
        S.deep_merge(base, {'r': {'b': 2}})
        self.assertEqual(base, {'r': {'a': 1}})

    def test_markers_inside_a_new_parent_are_dropped(self):
        out = S.deep_merge({'x': 1}, {'review': {'kcal': 5, 'feedback': {'__delete__': True}, 'deep': {'g': {'__delete__': True}}}})
        self.assertEqual(out, {'x': 1, 'review': {'kcal': 5, 'deep': {}}})

    def test_strip_deletes(self):
        self.assertEqual(S.strip_deletes({'a': {'__delete__': True}, 'b': {'c': {'__delete__': True}, 'd': 1}, 'e': [{'__delete__': True}]}),
                         {'b': {'d': 1}, 'e': [{'__delete__': True}]})   # arrays are values, left alone


class Json(unittest.TestCase):
    def test_request_json_refuses_nan_and_infinity(self):
        for bad in ('{"a": NaN}', '{"a": Infinity}', '[-Infinity]'):
            with self.assertRaises(ValueError):
                S.loads_request(bad)
        self.assertEqual(S.loads_request('{"a": 1.5}'), {'a': 1.5})

    def test_request_json_depth_is_limited(self):
        deepest = S.loads_request('[' * S.MAX_DEPTH + ']' * S.MAX_DEPTH)     # exactly MAX_DEPTH levels is fine
        for _ in range(S.MAX_DEPTH - 1):
            deepest = deepest[0]
        self.assertEqual(deepest, [])
        with self.assertRaises(ValueError):
            S.loads_request('[' * (S.MAX_DEPTH + 1) + ']' * (S.MAX_DEPTH + 1))
        with self.assertRaises(ValueError):
            S.loads_request('{"a":' * (S.MAX_DEPTH + 1) + '1' + '}' * (S.MAX_DEPTH + 1))
        self.assertEqual(S.loads_request('{"a": {"b": [1, {"c": 2}]}}'), {'a': {'b': [1, {'c': 2}]}})

    def test_request_json_must_be_valid_unicode(self):
        for bad in ('{"a": "\\ud800"}', '{"\\udfff": 1}', '["ok", ["\\ud83d"]]'):
            with self.assertRaises(ValueError, msg=bad):
                S.loads_request(bad)
        self.assertEqual(S.loads_request('"\\ud83d\\ude00"'), '\U0001F600')   # a proper pair is fine

    def test_output_refuses_nan(self):
        with self.assertRaises(ValueError):
            S.dumps({'a': float('nan')})

    def test_stored_nan_reads_as_null(self):
        self.assertEqual(S.loads_stored('{"w": NaN, "x": 1}'), {'w': None, 'x': 1})


class Versions(unittest.TestCase):
    def test_plain_ints(self):
        self.assertIsNone(S.parse_version(None))
        self.assertEqual(S.parse_version(0), 0)
        self.assertEqual(S.parse_version(7), 7)
        self.assertEqual(S.parse_version('3'), 3)
        self.assertEqual(S.parse_version('"3"'), 3)   # If-Match in ETag quotes

    def test_rejects_bools_floats_and_junk(self):
        for bad in (True, False, 2.9, 2.0, -1, '2.9', 'abc', '', [1], {'v': 1}, '٣'):
            with self.assertRaises(S.ApiError, msg=repr(bad)) as cm:
                S.parse_version(bad)
            self.assertEqual(cm.exception.status, 400)


class CheckPath(unittest.TestCase):
    def test_types_and_ids(self):
        S.check_path('meals', 'm1', need_id=True)
        for col, doc_id in ((['meals'], 'x'), (3, 'x'), ('meals', None), ('meals', ['x']), ('meals', 5), ('meals', 'a/b'),
                            ('meals', 'abc\n'), ('meals', '')):
            with self.assertRaises(S.ApiError, msg=repr((col, doc_id))) as cm:
                S.check_path(col, doc_id, need_id=True)
            self.assertEqual(cm.exception.status, 400)
        with self.assertRaises(S.ApiError) as cm:
            S.check_path('secrets', 'x')
        self.assertEqual(cm.exception.status, 404)

    def test_order_key(self):
        vals = [3, 1.5, 'b', True, 2]
        self.assertEqual(sorted(vals, key=S.order_key), [True, 1.5, 2, 3, 'b'])   # ints and floats sort together
        with self.assertRaises(S.ApiError):
            S.order_key({'a': 1})


class HealthValues(unittest.TestCase):
    def test_units_and_separators(self):
        self.assertEqual(S.health_value('steps', '8,213'), 8213)
        self.assertAlmostEqual(S.health_value('weight', '160 lb'), 72.57, places=1)
        self.assertAlmostEqual(S.health_value('active', '2,100 千焦'), 501.9, places=0)
        self.assertEqual(S.health_value('rhr', '58 count/min'), 58)

    def test_out_of_range_and_garbage(self):
        self.assertIsNone(S.health_value('weight', '3'))
        self.assertIsNone(S.health_value('rhr', '400'))
        self.assertIsNone(S.health_value('steps', 'n/a'))

    def test_summarize_per_day(self):
        days, problems = S.summarize_health({
            'steps_v': '3000\n5000\n100', 'steps_s': '2026-10-14T09:00:00+08:00\n2026-10-14T20:00:00+08:00\n2026-10-15T08:00:00+08:00',
            'weight_v': '72.4 kg\n71.9 kg', 'weight_s': '2026-10-14T23:00:00+08:00\n2026-10-14T07:00:00+08:00',
            'rhr_v': '56\n60', 'rhr_s': '2026-10-14T01:00:00+08:00\n2026-10-14T13:00:00+08:00',
        })
        self.assertEqual(problems, [])
        self.assertEqual(days['2026-10-14']['steps'], 8000)    # summed
        self.assertEqual(days['2026-10-14']['weight'], 71.9)   # earliest reading of the day
        self.assertEqual(days['2026-10-14']['rhr'], 58)        # averaged
        self.assertEqual(days['2026-10-15']['steps'], 100)

    def test_mismatched_lists_are_reported(self):
        _, problems = S.summarize_health({'hrv_v': '40\n41', 'hrv_s': '2026-10-14T01:00:00+08:00'})
        self.assertEqual(len(problems), 1)

    def test_weight_uses_the_day_boundary_other_metrics_calendar_days(self):
        days, _ = S.summarize_health({
            # the 14th's 05:00-based day: 23:10 on the 14th, then 01:30 on the 15th; 07:00 on the 15th starts the 15th
            'weight_v': '70.2\n70.6\n70.0', 'weight_s': '2026-10-15T01:30:00+08:00\n2026-10-14T23:10:00+08:00\n2026-10-15T07:00:00+08:00',
            'steps_v': '400', 'steps_s': '2026-10-15T01:30:00+08:00',
        })
        self.assertEqual(days['2026-10-14']['weight'], 70.6)
        self.assertEqual(days['2026-10-14']['n']['weight'], 2)
        self.assertEqual(days['2026-10-15']['weight'], 70.0)
        self.assertEqual(days['2026-10-15']['steps'], 400)      # steps stay on the calendar day
        self.assertNotIn('steps', days['2026-10-14'])

    def test_utc_weight_is_converted_before_picking_the_day(self):
        days, _ = S.summarize_health({'weight_v': '70.2', 'weight_s': '2026-10-14T17:30:00Z'})   # 01:30 on the 15th in Shanghai
        self.assertEqual(list(days), ['2026-10-14'])

    def test_day_of(self):
        self.assertEqual(S.day_of(datetime(2026, 10, 15, 4, 59, tzinfo=CST)), '2026-10-14')
        self.assertEqual(S.day_of(datetime(2026, 10, 15, 5, 0, tzinfo=CST)), '2026-10-15')
        self.assertEqual(S.day_of(datetime(2026, 10, 14, 21, 0, tzinfo=timezone.utc)), '2026-10-15')   # 05:00 in Shanghai


class Sleep(unittest.TestCase):
    def sample(self, v, s, e):
        return {'value': v, 'start': s, 'end': e}

    def test_fmt_hm(self):
        self.assertEqual((S.fmt_hm(45), S.fmt_hm(480), S.fmt_hm(452.6)), ('45 分', '8 小时 0 分', '7 小时 33 分'))

    def test_kinds(self):
        self.assertEqual(S.sleep_kind('深度睡眠'), 'deep')
        self.assertEqual(S.sleep_kind('In Bed'), 'inbed')
        self.assertEqual(S.sleep_kind('核心'), 'core')
        self.assertEqual(S.sleep_kind(5), 'rem')
        self.assertIsNone(S.sleep_kind('???'))

    def test_watch_stages_win_over_phone_asleep_and_overlaps_count_once(self):
        night = [
            self.sample('Asleep', '2026-10-14T23:00:00+08:00', '2026-10-15T07:30:00+08:00'),   # iPhone, coarse
            self.sample('Core', '2026-10-14T23:30:00+08:00', '2026-10-15T02:00:00+08:00'),
            self.sample('Deep', '2026-10-15T02:00:00+08:00', '2026-10-15T03:00:00+08:00'),
            self.sample('Core', '2026-10-15T02:30:00+08:00', '2026-10-15T07:00:00+08:00'),     # overlaps deep by 30 min
        ]
        out, unknown = S.summarize_sleep(night)
        self.assertEqual(unknown, [])
        self.assertEqual(out['date'], '2026-10-15')
        self.assertEqual((out['bedtime'], out['wake']), ('23:30', '07:00'))
        self.assertEqual(out['asleep'], 450)   # 23:30–07:00, the overlap is not counted twice
        self.assertEqual(out['deep'], 60)

    def test_longest_night_wins_over_a_nap(self):
        out, _ = S.summarize_sleep([
            self.sample('Core', '2026-10-14T13:00:00+08:00', '2026-10-14T13:40:00+08:00'),
            self.sample('Core', '2026-10-15T00:10:00+08:00', '2026-10-15T06:10:00+08:00'),
        ])
        self.assertEqual(out['asleep'], 360)

    def test_no_sleep_raises_with_unknown_values(self):
        with self.assertRaises(S.ApiError) as cm:
            S.summarize_sleep([self.sample('Zzz?', '2026-10-15T00:00:00+08:00', '2026-10-15T06:00:00+08:00')])
        self.assertEqual(cm.exception.code, 'no_sleep')
        self.assertEqual(cm.exception.extra['unknownValues'], ['Zzz?'])

    def test_utc_timestamps_land_on_the_local_wake_day(self):
        out, _ = S.summarize_sleep([self.sample('Core', '2026-10-14T15:30:00Z', '2026-10-14T23:00:00Z')])
        self.assertEqual(out['date'], '2026-10-15')
        self.assertEqual((out['bedtime'], out['wake']), ('23:30', '07:00'))
        self.assertTrue(out['start'].endswith('+08:00'))

    def test_reviewer_repro_night_after_3am(self):
        # 03:00–07:30 in Shanghai, sent in UTC: used to come out as 2026-10-12 19:00–23:30
        out, _ = S.summarize_sleep([self.sample('Core', '2026-10-12T19:00:00Z', '2026-10-12T23:30:00Z')])
        self.assertEqual((out['date'], out['bedtime'], out['wake']), ('2026-10-13', '03:00', '07:30'))

    def test_other_configured_zone(self):
        old = S.LOCAL_TZ
        S.LOCAL_TZ = timezone(timedelta(hours=-5))
        try:
            out, _ = S.summarize_sleep([self.sample('Core', '2026-10-15T04:00:00Z', '2026-10-15T11:00:00Z')])
        finally:
            S.LOCAL_TZ = old
        self.assertEqual((out['date'], out['bedtime'], out['wake']), ('2026-10-15', '23:00', '06:00'))

    def test_naive_times_are_local(self):
        self.assertEqual(S.parse_ts('2026-10-15 03:00:00').utcoffset(), timedelta(hours=8))

    def test_out_of_range_times_are_unreadable(self):
        for bad in ('0001-01-01T00:00:00+08:00', '9999-12-31T23:59:59-08:00', 'soon'):
            with self.assertRaises(ValueError):
                S.parse_ts(bad)


class FullerNight(unittest.TestCase):
    night = {'start': '2026-10-15T05:00:00+08:00', 'asleep': 360}

    def test_partial_window_of_a_stored_night(self):
        self.assertTrue(S.fuller_night_stored({'start': '2026-10-15T03:00:00+08:00', 'asleep': 480}, self.night))
        self.assertTrue(S.fuller_night_stored({'start': '2026-10-14T21:00:00Z', 'asleep': 480}, self.night))  # same moment, UTC

    def test_new_night_wins(self):
        self.assertFalse(S.fuller_night_stored({}, self.night))
        self.assertFalse(S.fuller_night_stored({'start': '2026-10-15T03:00:00+08:00', 'asleep': 300}, self.night))   # shorter
        self.assertFalse(S.fuller_night_stored({'start': '2026-10-15T03:00:00+08:00', 'asleep': 360}, self.night))   # equal
        self.assertFalse(S.fuller_night_stored({'start': '2026-10-15T06:00:00+08:00', 'asleep': 480}, self.night))   # started later

    def test_stored_night_without_start_counts_as_earlier(self):
        self.assertTrue(S.fuller_night_stored({'asleep': 480, 'source': 'screenshot'}, self.night))


class ManualWeight(unittest.TestCase):
    def test_manual(self):
        self.assertTrue(S.weight_is_manual({'weight': 70.0, 'weightSource': 'manual'}))
        self.assertTrue(S.weight_is_manual({'weightSource': 'manual'}))
        self.assertTrue(S.weight_is_manual({'weight': 70.0}))                                    # typed before weightSource
        self.assertTrue(S.weight_is_manual({'weight': 70.0, 'weightSource': 'apple-health', 'weightAuto': 72.0}))   # edited

    def test_automatic(self):
        self.assertFalse(S.weight_is_manual({}))
        self.assertFalse(S.weight_is_manual({'sleep': 7.5}))
        self.assertFalse(S.weight_is_manual({'weight': 72.0, 'weightSource': 'apple-health', 'weightAuto': 72.0}))
        self.assertFalse(S.weight_is_manual({'weight': 72.0, 'weightSource': 'apple-health'}))   # older automatic doc


class Passwords(unittest.TestCase):
    def test_roundtrip(self):
        h = S.hash_password('correct horse')
        self.assertTrue(S.check_password('correct horse', h))
        self.assertFalse(S.check_password('wrong', h))
        self.assertFalse(S.check_password('x', 'garbage'))
        self.assertFalse(S.check_password('x', None))

    def test_dummy_hash_is_a_real_hash(self):
        self.assertTrue(S.DUMMY_HASH.startswith(f'pbkdf2_sha256${S.PBKDF2_ROUNDS}$'))


class Limiter(unittest.TestCase):
    def setUp(self):
        self.lim = S.AttemptLimiter(window=600, per_pair=5, per_user=30, per_ip=20)

    def fail(self, user, ip, n):
        return [self.lim.attempt(user, ip) is not None for _ in range(n)]

    def test_per_pair(self):
        self.assertEqual(self.fail('ann', '10.0.0.1', 6), [True] * 5 + [False])
        self.assertIsNotNone(self.lim.attempt('ann', '10.0.0.2'))     # the owner from elsewhere still gets in

    def test_per_user_across_ips(self):
        for i in range(6):
            self.fail('ann', f'10.0.1.{i}', 5)
        self.assertIsNone(self.lim.attempt('ann', '10.0.2.1'))

    def test_per_ip_across_users(self):
        for i in range(5):
            self.fail(f'user{i}', '10.0.0.9', 4)
        self.assertIsNone(self.lim.attempt('someone', '10.0.0.9'))
        self.assertIsNotNone(self.lim.attempt('someone', '10.0.0.10'))

    def test_success_forgets_this_pair_and_is_not_counted(self):
        self.fail('ann', '10.0.0.1', 4)
        self.lim.succeeded(self.lim.attempt('ann', '10.0.0.1'))
        self.assertEqual(self.fail('ann', '10.0.0.1', 6), [True] * 5 + [False])
        self.assertEqual(len(self.lim.hits[('user', 'ann')]), 9)    # 4 + 5 failures; the success was taken back

    def test_old_attempts_expire_and_are_pruned(self):
        self.fail('ann', '10.0.0.1', 5)
        for k in self.lim.hits:
            self.lim.hits[k] = [t - 601 for t in self.lim.hits[k]]
        self.lim.pruned = 0
        self.assertIsNotNone(self.lim.attempt('bob', '10.0.0.2'))
        self.assertNotIn(('pair', 'ann', '10.0.0.1'), self.lim.hits)
        self.assertIsNotNone(self.lim.attempt('ann', '10.0.0.1'))


class ClientIp(unittest.TestCase):
    def ip(self, peer, real):
        fake = types.SimpleNamespace(client_address=(peer, 50000), headers={'X-Real-IP': real} if real else {})
        return S.Handler.client_ip(fake)

    def test_x_real_ip_only_from_loopback(self):
        self.assertEqual(self.ip('127.0.0.1', '203.0.113.7'), '203.0.113.7')
        self.assertEqual(self.ip('::1', '203.0.113.7'), '203.0.113.7')
        self.assertEqual(self.ip('10.1.2.3', '203.0.113.7'), '10.1.2.3')
        self.assertEqual(self.ip('198.51.100.4', '127.0.0.1'), '198.51.100.4')
        self.assertEqual(self.ip('127.0.0.1', None), '127.0.0.1')


class Config(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual((S.TZ_NAME, S.DAY_START_HOUR), ('Asia/Shanghai', 5))
        self.assertEqual(datetime(2026, 7, 1, tzinfo=S.LOCAL_TZ).utcoffset(), timedelta(hours=8))
        self.assertTrue(S.COOKIE_SECURE)

    def test_tz_fallback(self):
        tz = S.load_tz('Not/A_Zone')
        self.assertEqual(datetime(2026, 1, 1, tzinfo=tz).utcoffset(), timedelta(hours=8))


if __name__ == '__main__':
    unittest.main()

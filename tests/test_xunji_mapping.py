"""The 训记 mapping in app/xunji_import.py, through bin/xunji (no network): the day boundary in a given zone, how 训记
sets become workout sets, the page's own `mine` fields, merge_session's write rules, and how 训记 answers are classified."""
import datetime as dt
import gzip
import importlib.machinery
import importlib.util
import json
import os
import socket
import sys
import time
import unittest
import urllib.error

sys.dont_write_bytecode = True
REPO = os.environ.get('LSJ_REPO') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')


def xunji_module():
    loader = importlib.machinery.SourceFileLoader('lsj_xunji_mapping', os.path.join(REPO, 'bin', 'xunji'))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


X = xunji_module()
XI = X.xi   # app/xunji_import.py
SH = dt.timezone(dt.timedelta(hours=8))


def local_ms(y, m, d, hh, mm=0):
    return int(time.mktime(dt.datetime(y, m, d, hh, mm).timetuple()) * 1000)


def sh_ms(y, m, d, hh, mm=0):
    return int(dt.datetime(y, m, d, hh, mm, tzinfo=SH).timestamp() * 1000)


class DayBoundary(unittest.TestCase):
    def test_before_five_belongs_to_the_day_before(self):
        self.assertEqual(X.session_date({'datestr': '2026-10-15', 'start': sh_ms(2026, 10, 15, 3, 30)}, SH, 5), '2026-10-14')

    def test_after_five_stays(self):
        self.assertEqual(X.session_date({'datestr': '2026-10-15', 'start': sh_ms(2026, 10, 15, 5, 0)}, SH, 5), '2026-10-15')

    def test_no_start_keeps_datestr(self):
        self.assertEqual(X.session_date({'datestr': '2026-10-15'}, SH, 5), '2026-10-15')

    def test_the_persons_day_start(self):
        t = {'datestr': '2026-10-15', 'start': sh_ms(2026, 10, 15, 3, 30)}
        self.assertEqual(X.session_date(t, SH, 0), '2026-10-15')
        self.assertEqual(X.session_date(t, SH, 3), '2026-10-15')
        self.assertEqual(X.session_date(t, SH, 4), '2026-10-14')

    def test_the_zone_is_explicit(self):
        t = {'datestr': '2026-10-15', 'start': sh_ms(2026, 10, 15, 11, 0)}       # 03:00 UTC
        self.assertEqual(X.session_date(t, SH, 5), '2026-10-15')
        self.assertEqual(X.session_date(t, dt.timezone.utc, 5), '2026-10-14')
        self.assertEqual(X.map_train(t, tz=dt.timezone.utc)['date'], '2026-10-14')

    def test_default_is_this_computers_zone_and_five(self):
        self.assertEqual(X.session_date({'datestr': '2026-10-15', 'start': local_ms(2026, 10, 15, 4, 59)}), '2026-10-14')

    def test_unreadable_start_keeps_datestr(self):
        self.assertEqual(X.session_date({'datestr': '2026-10-15', 'start': 1e30}, SH, 5), '2026-10-15')

    def test_tz_names(self):
        self.assertIsNotNone(XI.tz_of('Asia/Shanghai'))
        self.assertIsNone(XI.tz_of('Not/A_Zone'))
        self.assertIsNone(XI.tz_of(None))


class Mapping(unittest.TestCase):
    def test_sets_warmup_drop_bodyweight(self):
        t = {'datestr': '2026-10-15', 'title': '胸', 'localid': 7, 'start': local_ms(2026, 10, 15, 19), 'end': local_ms(2026, 10, 15, 20),
             'movements': [
                 {'name': '杠铃卧推', 'restTime': 120, 'sets': [
                     {'weight': '40', 'reps': '10', 'done': True, 'setType': '热'},
                     {'weight': '60', 'reps': '8', 'done': True, 'dropSets': [{'weight': '40', 'reps': '6'}]},
                 ]},
                 {'name': '引体向上', 'sets': [{'selfWeight': True, 'reps': '8', 'done': False}]},
             ]}
        doc = X.map_train(t, {'胸': 'A'}, None)
        bench, pull = doc['exercises']
        self.assertTrue(bench['sets'][0]['warmup'])
        self.assertEqual(bench['sets'][2], {'kg': 40, 'reps': 6, 'done': True, 'drop': True})   # drop follows its parent's done
        self.assertEqual(pull['sets'][0], {'kg': None, 'reps': 8, 'done': False, 'bodyweight': True})
        self.assertEqual((doc['planDayId'], doc['durationMin'], doc['date']), ('A', 60, '2026-10-15'))

    def test_hash_is_stable(self):
        self.assertEqual(X.content_hash({'b': 1, 'a': [1, 2]}), X.content_hash({'a': [1, 2], 'b': 1}))

    def test_lb_to_kg(self):
        self.assertEqual(X.to_kg('100', 'lb'), 45.4)


PLAN = {'updatedAt': '2026-10-01T00:00:00Z', 'training': {'days': [
    {'id': 'A', 'exercises': [{'name': '杠铃卧推', 'sets': 4, 'reps': '6–8', 'load': 'RPE 8', 'rest': '120s'}]},
    {'id': 'B', 'exercises': [{'name': '杠铃卧推', 'sets': 3, 'reps': '10', 'load': '40kg'}]}]}}


def session(reps='8'):
    return {'datestr': '2026-10-14', 'title': '胸', 'localid': 3, 'start': sh_ms(2026, 10, 14, 19), 'end': sh_ms(2026, 10, 14, 20),
            'movements': [{'name': '杠铃卧推', 'sets': [{'weight': '60', 'reps': reps, 'done': True}]}]}


class Mine(unittest.TestCase):
    """The page's own fields on a 训记 workout: never touched by a sync; mine.planDayId picks the plan day."""

    def test_mine_plan_day_wins_over_the_day_map(self):
        doc = X.map_train(session(), {'胸': 'A'}, PLAN, {'mine': {'planDayId': 'B'}}, SH)
        self.assertEqual((doc['planDayId'], doc['exercises'][0]['target']), ('B', '3×10 · 40kg'))

    def test_empty_mine_plan_day_means_trained_but_not_a_plan_day(self):
        doc = X.map_train(session(), {'胸': 'A'}, PLAN, {'mine': {'planDayId': ''}}, SH)
        self.assertEqual((doc['planDayId'], doc['exercises'][0]['target']), (None, ''))

    def test_without_a_mine_plan_day_the_day_map_decides(self):
        for prev in (None, {}, {'mine': {'notes': '腰有点紧'}}, {'mine': {'planDayId': None}}, {'mine': {'planDayId': 2}}, {'mine': 'x'}):
            self.assertEqual(X.map_train(session(), {'胸': 'A'}, PLAN, prev, SH)['planDayId'], 'A', prev)

    def test_merge_keeps_mine_review_and_answer(self):
        t = session()
        first, change, _ = X.merge_session(t, None, {'胸': 'A'}, PLAN, True, '2026-10-14T12:00:00Z', SH)
        self.assertEqual((change, first['needsReview'], first['planDayId']), ('new', True, 'A'))
        mine = {'notes': '最后一组借力了', 'feelings': ['疲劳'], 'rpe': 8.5, 'planDayId': 'B'}
        cur = {'version': 2, 'data': {**first, 'planDayId': 'B', 'mine': mine, 'needsReview': True,
                                      'review': {'comment': '稳'}, 'answer': {'text': 'B', 'q': '练的哪天'}}}
        body, change, label = X.merge_session(t, cur, {'胸': 'A'}, PLAN, True, '2026-10-15T12:00:00Z', SH)
        self.assertEqual((change, body['planDayId'], body['mine'], body['review'], body['answer']['text'], body['needsReview']),
                         ('remapped', 'B', mine, {'comment': '稳'}, 'B', True))
        self.assertEqual(body['exercises'][0]['target'], '3×10 · 40kg')          # targets follow the day the person picked
        again = X.merge_session(t, {'version': 3, 'data': body}, {'胸': 'A'}, PLAN, True, '2026-10-16T12:00:00Z', SH)
        self.assertEqual(again, (None, None, None))

    def test_a_xunji_edit_asks_again_but_keeps_mine(self):
        first, _, _ = X.merge_session(session(), None, {}, PLAN, True, 'now', SH)
        cur = {'version': 1, 'data': {**first, 'needsReview': False, 'mine': {'rpe': 9}}}
        body, change, label = X.merge_session(session('10'), cur, {}, PLAN, True, 'later', SH)
        self.assertEqual((change, body['needsReview'], body['mine'], body['updatedAt']), ('updated', True, {'rpe': 9}, 'later'))
        body, change, label = X.merge_session(session('10'), cur, {}, PLAN, False, 'later', SH)
        self.assertEqual((change, body['needsReview'], label), ('updated', False, '2026-10-14 胸（历史）'))


class Http(unittest.TestCase):
    """xunji_import.post against canned answers (its HTTP function replaced): what each kind of 训记 trouble becomes."""

    def setUp(self):
        self.real, self.calls = XI._http, []

    def tearDown(self):
        XI._http = self.real

    def answer(self, *answers):
        it = iter(answers)

        def fake(url, data, headers, timeout):
            self.calls.append((url, json.loads(data), headers, timeout))
            a = next(it)
            if isinstance(a, BaseException):
                raise a
            return a
        XI._http = fake

    def kind(self, *answers, max_wait=0):
        self.answer(*answers)
        with self.assertRaises(XI.XunjiError) as e:
            XI.fetch_trains('fake-key-123', '2026-10-15', False, timeout=7, max_wait=max_wait)
        return e.exception.kind

    def test_trains(self):
        self.answer((200, json.dumps({'success': True, 'res': {'trains': [{'localid': 1}]}}).encode()))
        self.assertEqual(XI.fetch_trains('fake-key-123', '2026-10-15', True, timeout=7), [{'localid': 1}])
        url, body, headers, timeout = self.calls[0]
        self.assertEqual((url, body['datestr'], body['include_full_data'], timeout), (XI.TRAINS + '/api_trains_for_llm_v2', '2026-10-15', True, 7))
        self.assertEqual(headers['Authorization'], 'Bearer fake-key-123')

    def test_gzip(self):
        self.answer((200, gzip.compress(json.dumps({'res': {'trains': []}}).encode())))
        self.assertEqual(XI.fetch_trains('fake-key-123', '2026-10-15', False), [])

    def test_kinds(self):
        self.assertEqual(self.kind((401, b'{"success": false, "message": "apikey invalid"}')), 'invalid_key')
        self.assertEqual(self.kind((200, b'{"success": false, "message": "apikey missing"}')), 'invalid_key')
        self.assertEqual(self.kind((403, b'{"success": false, "message": "VIP only"}')), 'vip')
        self.assertEqual(self.kind((500, b'oops')), 'http')
        self.assertEqual(self.kind((200, b'{"success": true, "res": {}}')), 'bad_response')
        self.assertEqual(self.kind((200, b'\x1f\x8bnot gzip')), 'bad_response')
        self.assertEqual(self.kind(urllib.error.URLError('no route')), 'network')
        self.assertEqual(self.kind(ConnectionResetError()), 'network')
        self.assertEqual(self.kind(socket.timeout('timed out')), 'timeout')
        self.assertEqual(self.kind(urllib.error.URLError(socket.timeout('timed out'))), 'timeout')

    def test_rate_limit_waits_only_within_max_wait(self):
        busy = (200, b'{"success": false, "message": "too frequent", "retry_after_ms": 16000}')
        self.assertEqual(self.kind(busy, max_wait=10), 'busy')
        self.assertEqual(len(self.calls), 1)                   # no waiting, no second request
        waits = []
        self.answer((200, b'{"message": "too frequent", "res": {"retry_after_ms": 20}}'), (200, b'{"res": {"trains": []}}'))
        self.assertEqual(XI.fetch_trains('fake-key-123', '2026-10-15', False, max_wait=1, on_wait=waits.append), [])
        self.assertEqual(waits, [0.02])
        self.calls = []
        self.assertEqual(self.kind((200, b'{"message": "too frequent", "retry_after_ms": "x"}'), max_wait=15), 'busy')   # 16 s default

    def test_the_key_is_never_in_an_error(self):
        for a in ((401, b'{"message": "apikey invalid"}'), urllib.error.URLError('down'), (500, b'x')):
            self.answer(a)
            with self.assertRaises(XI.XunjiError) as e:
                XI.fetch_trains('fake-key-123', '2026-10-15', False, max_wait=0)
            self.assertNotIn('fake-key-123', str(e.exception))


class Numbers(unittest.TestCase):
    def test_num_rejects_nan_and_infinity(self):
        for v in ('nan', 'NaN', 'inf', '-Infinity', float('nan'), float('inf'), True, None, '', 'abc'):
            self.assertIsNone(X.num(v), v)

    def test_num_parses(self):
        self.assertEqual([X.num(v) for v in ('8', ' 7.5 ', 10, '2.125', '0')], [8, 7.5, 10, 2.12, 0])


class ExerciseTypes(unittest.TestCase):
    """Every 训记 exetype in the synthetic fixture, as the page will see it."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(FIXTURES, 'xunji_session.json'), encoding='utf-8') as f:
            cls.t = json.load(f)
        cls.ex = {e['name']: e for e in X.map_train(cls.t, {'上肢 A': 'A'}, None)['exercises']}

    def test_weighted(self):
        sets = self.ex['杠铃卧推']['sets']
        self.assertEqual(sets[0], {'kg': 40, 'reps': 10, 'done': True, 'warmup': True})
        self.assertEqual(sets[1], {'kg': 60, 'reps': 8, 'done': True, 'rpe': 8})
        self.assertEqual(sets[2], {'kg': 45, 'reps': 6, 'done': True, 'drop': True})
        self.assertEqual(sets[3], {'kg': 61.2, 'reps': 6, 'done': False})  # 135 lbs
        self.assertEqual(self.ex['反手弯举']['sets'], [{'kg': 7.5, 'reps': 12, 'done': True}])

    def test_bodyweight_plus_added_weight(self):
        self.assertEqual(self.ex['双杠臂屈伸']['sets'], [
            {'kg': None, 'reps': 10, 'done': True, 'bodyweight': True},
            {'kg': 10, 'reps': 8, 'done': True, 'bodyweight': True},
            {'kg': None, 'reps': 8, 'done': True, 'bodyweight': True}])

    def test_reps_only(self):
        self.assertEqual(self.ex['卷腹']['sets'], [{'kg': None, 'reps': 15, 'done': True, 'bodyweight': True}])

    def test_assisted_keeps_the_counterweight_out_of_kg(self):
        self.assertEqual(self.ex['引体向上（辅助）']['sets'], [
            {'kg': None, 'reps': 8, 'done': True, 'bodyweight': True, 'assist': 45.5},
            {'kg': None, 'reps': 6, 'done': True, 'bodyweight': True}])

    def test_cardio(self):
        walk = self.ex['Walking']
        self.assertTrue(walk['cardio'])
        self.assertEqual(walk['sets'], [])
        self.assertEqual(walk['metrics']['calories'], '90')

    def test_session_fields(self):
        doc = X.map_train(self.t, {'上肢 A': 'A'}, None)
        self.assertEqual((doc['notes'], doc['kcal'], doc['durationMin'], doc['heartRate']),
                         ('状态不错', 320, 70, {'avg': 118, 'max': 151, 'min': 88}))
        self.assertEqual(doc['xunji']['localid'], 900001)


if __name__ == '__main__':
    unittest.main()

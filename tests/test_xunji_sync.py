"""bin/xunji sync without any network: 训记 is a stub, 薄肌研究所 an in-memory store with versions and atomic batches."""
import contextlib
import copy
import io
import datetime as dt
import glob
import importlib.machinery
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.dont_write_bytecode = True
REPO = os.environ.get('LSJ_REPO') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def load(name):
    loader = importlib.machinery.SourceFileLoader('lsj_' + name + '_sync_test', os.path.join(REPO, 'bin', name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


X = load('xunji')
L = load('lsj')
TODAY = dt.date(2026, 10, 15)
T0 = time.mktime(dt.datetime(2026, 10, 15, 12, 0).timetuple())
MIN = 60
USER = 'tester'


def local_ms(day, hh=19):
    d = dt.date.fromisoformat(day)
    return int(time.mktime(dt.datetime(d.year, d.month, d.day, hh).timetuple()) * 1000)


def session(localid, day, title='上肢 A', reps='8', weight='60'):
    return {'localid': localid, 'datestr': day, 'title': title, 'note': '', 'start': local_ms(day), 'end': local_ms(day) + 3600000,
            'truncated': False, 'movements': [
                {'index': 1, 'name': '杠铃卧推', 'exetype': '', 'restTime': 120, 'sets': [
                    {'index': 1, 'done': True, 'weight': weight, 'unit': 'kg', 'reps': reps, 'time': 0, 'selfWeight': False,
                     'rpe': '', 'note': '', 'comment': '', 'setType': ''}]}]}


class FakeXunji:
    """训记 as a dict {date: [sessions]}; records every request."""

    def __init__(self):
        self.days, self.calls = {}, []

    def put(self, *sessions):
        for s in sessions:
            self.days.setdefault(s['datestr'], []).append(copy.deepcopy(s))

    def remove(self, localid):
        for k in self.days:
            self.days[k] = [s for s in self.days[k] if s['localid'] != localid]

    def fetch(self, key, date, full):
        self.calls.append((date, full))
        trains = copy.deepcopy(self.days.get(date, []))
        return trains if full else [{k: t[k] for k in ('localid', 'datestr', 'title')} for t in trains]


class FakeLsj:
    """The few Client methods sync uses, with the server's version rules (ifVersion 0 = must not exist)."""

    def __init__(self):
        self.docs, self.batches = {}, []

    def get(self, col, doc_id):
        d = self.docs.get((col, doc_id))
        return copy.deepcopy(d)

    def list(self, col, where=(), order=None, desc=False, limit=1000):
        out = [copy.deepcopy(d) for (c, _), d in sorted(self.docs.items()) if c == col]
        for w in where:
            field, op, raw = w.split(':', 2)
            v = json.loads(raw)
            assert op == 'gte'
            out = [d for d in out if d['data'].get(field) is not None and d['data'][field] >= v]
        return out[:limit]

    def batch(self, ops):
        L.check_ops(ops)
        new = copy.deepcopy(self.docs)
        for o in ops:
            key = (o['collection'], o['id'])
            cur = new.get(key)
            if 'ifVersion' in o and (cur['version'] if cur else 0) != o['ifVersion']:
                raise L.LsjError(f'HTTP 409 conflict on {key}', 3, 409)
            if o['op'] == 'delete':
                new.pop(key, None)
            else:
                new[key] = {'collection': key[0], 'id': key[1], 'version': (cur['version'] + 1) if cur else 1,
                            'updatedAt': 'x', 'data': o['data']}
        self.docs = new
        self.batches.append(ops)
        return []

    def update(self, col, doc_id, **fields):  # what Claude's review write does
        d = self.docs[(col, doc_id)]
        d['data'].update(fields)
        d['version'] += 1

    def set(self, col, doc_id, data):
        cur = self.docs.get((col, doc_id))
        self.docs[(col, doc_id)] = {'collection': col, 'id': doc_id, 'version': (cur['version'] + 1) if cur else 1,
                                    'updatedAt': 'x', 'data': data}

    def workout(self, localid):
        d = self.docs.get(('workouts', f'xj-{localid}'))
        return d and d['data']


class SyncCase(unittest.TestCase):
    def setUp(self):
        self.cache = tempfile.mkdtemp(prefix='xunji-test-')
        self.saved = (X.CACHE, X.fetch_trains, X.post, X.FETCH_PAUSE)
        X.CACHE, X.FETCH_PAUSE = self.cache, 0
        self.xj = FakeXunji()
        X.fetch_trains = self.xj.fetch

        def no_network(*a, **k):
            raise AssertionError('tests must not reach 训记')
        X.post = no_network
        self.db = FakeLsj()
        self.db.set('meta', 'xunji', {'dayMap': {'上肢 A': 'A', '下肢 B': 'B'}})
        self.db.set('plan', 'current', {'updatedAt': '2026-10-01T00:00:00Z', 'training': {'days': [
            {'id': 'A', 'exercises': [{'name': '杠铃卧推', 'sets': 4, 'reps': '6–8', 'load': 'RPE 8', 'rest': '120s'}]},
            {'id': 'B', 'exercises': [{'name': '杠铃卧推', 'sets': 3, 'reps': '10', 'load': '40kg'}]}]}})

    def tearDown(self):
        X.CACHE, X.fetch_trains, X.post, X.FETCH_PAUSE = self.saved
        shutil.rmtree(self.cache, ignore_errors=True)

    def sync(self, minutes=0, **kw):
        kw.setdefault('days', 14)
        return X.sync(self.db, USER, 'k', today=TODAY, now=T0 + minutes * MIN, **kw)

    def review(self, localid):
        self.db.update('workouts', f'xj-{localid}', needsReview=False, review={'rating': 'good', 'comment': '稳'})


class Import(SyncCase):
    def test_new_sessions_recent_and_history(self):
        self.xj.put(session(1, '2026-10-14'), session(2, '2026-10-03'))
        r = self.sync()
        self.assertEqual(len(r['new']), 2)
        self.assertTrue(self.db.workout(1)['needsReview'])
        self.assertFalse(self.db.workout(2)['needsReview'])  # older than 7 days: history
        w = self.db.workout(1)
        self.assertEqual((w['planDayId'], w['exercises'][0]['target']), ('A', '4×6–8 · RPE 8 · 休息 120s'))
        self.assertTrue(w['xunjiHash'].startswith('r1:'))
        self.assertEqual(self.db.get('meta', 'xunji')['data']['lastSyncDate'], '2026-10-15')
        self.assertEqual(self.db.get('meta', 'xunji')['data']['dayMap'], {'上肢 A': 'A', '下肢 B': 'B'})

    def test_second_sync_changes_nothing(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        r = self.sync(minutes=30)
        self.assertEqual((r['new'], r['updated'], r['remapped'], r['unchanged']), ([], [], [], 1))
        self.assertEqual([o['collection'] for o in self.db.batches[-1]], ['meta'])


class AccountSettings(SyncCase):
    """bin/xunji takes the time zone and day start from the server's account listing (client.user)."""

    def late_session(self):
        t = session(1, '2026-10-14')
        t['start'] = int(dt.datetime(2026, 10, 14, 3, 0, tzinfo=dt.timezone(dt.timedelta(hours=8))).timestamp() * 1000)
        t['end'] = t['start'] + 3600000
        return t

    def test_day_start_and_zone_from_the_listing(self):
        self.xj.put(self.late_session())
        self.db.user = {'username': USER, 'tz': 'Asia/Shanghai', 'dayStartHour': 5}
        self.sync()
        self.assertEqual(self.db.workout(1)['date'], '2026-10-13')          # 03:00 is still the 13th with a 05:00 start
        self.db.user = {'username': USER, 'tz': 'Asia/Shanghai', 'dayStartHour': 2}
        r = self.sync(minutes=11)
        self.assertEqual(self.db.workout(1)['date'], '2026-10-14')
        self.assertIn('移过来', r['remapped'][0])

    def test_an_older_server_means_the_defaults(self):
        self.assertEqual(X.day_start_of({}), 5)
        self.assertEqual(X.day_start_of({'dayStartHour': True}), 5)
        self.assertEqual(X.day_start_of({'dayStartHour': 0}), 0)


class Mine(SyncCase):
    def test_sync_keeps_mine_and_follows_its_plan_day(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        self.review(1)
        mine = {'notes': '肩有点紧', 'feelings': ['疲劳'], 'rpe': 8.5, 'planDayId': 'B'}
        self.db.update('workouts', 'xj-1', mine=mine, planDayId='B', needsReview=True)   # what the page writes
        r = self.sync(minutes=11)
        w = self.db.workout(1)
        self.assertEqual((w['mine'], w['planDayId'], w['exercises'][0]['target'], w['needsReview']), (mine, 'B', '3×10 · 40kg', True))
        self.assertEqual((len(r['remapped']), r['updated']), (1, []))
        self.assertEqual(w['review']['comment'], '稳')
        self.db.update('workouts', 'xj-1', mine={**mine, 'planDayId': ''}, planDayId=None)
        self.sync(minutes=22)
        w = self.db.workout(1)
        self.assertEqual((w['planDayId'], w['exercises'][0]['target'], w['mine']['notes']), (None, '', '肩有点紧'))


class MovedSession(SyncCase):
    def test_moved_to_another_day_is_one_update_keeping_the_review(self):
        self.xj.put(session(1, '2026-10-13'))
        self.sync()
        self.review(1)
        self.xj.remove(1)
        self.xj.put(session(1, '2026-10-14'))
        r = self.sync(minutes=11)
        ops = [o for o in self.db.batches[-1] if o['collection'] == 'workouts']
        self.assertEqual([(o['op'], o['id']) for o in ops], [('set', 'xj-1')])
        w = self.db.workout(1)
        self.assertEqual((w['date'], w['xunji']['day']), ('2026-10-14', '2026-10-14'))
        self.assertEqual(w['review']['comment'], '稳')
        self.assertEqual((r['deleted'], r['heldBack']), ([], []))
        self.assertIn('移过来', r['updated'][0])

    def test_listed_on_two_days_the_fresher_read_wins(self):
        old = session(1, '2026-10-13')
        X.write_json_atomic(X.cache_path(USER, '2026-10-13', False), [old], mtime=T0 - MIN)   # young cache, still lists it
        X.write_json_atomic(X.cache_path(USER, '2026-10-13', True), [old], mtime=T0 - MIN)
        self.xj.put(session(1, '2026-10-14', reps='9'))
        self.sync()
        ops = [o for o in self.db.batches[-1] if o['collection'] == 'workouts']
        self.assertEqual(len(ops), 1)
        self.assertEqual(self.db.workout(1)['date'], '2026-10-14')


class PlanEdits(SyncCase):
    def test_plan_tweak_keeps_targets_and_does_not_ask_for_review(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        self.review(1)
        target = self.db.workout(1)['exercises'][0]['target']
        plan = self.db.get('plan', 'current')['data']
        self.db.set('plan', 'current', {**plan, 'updatedAt': '2026-10-15T08:00:00Z', 'diet': {'kcal': 2300}})
        r = self.sync(minutes=11)
        w = self.db.workout(1)
        self.assertEqual((w['exercises'][0]['target'], w['needsReview'], r['unchanged']), (target, False, 1))

    def test_day_map_change_remaps_without_review(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        self.review(1)
        meta = self.db.get('meta', 'xunji')['data']
        self.db.set('meta', 'xunji', {**meta, 'dayMap': {'上肢 A': 'B'}})
        r = self.sync(minutes=11)
        w = self.db.workout(1)
        self.assertEqual((w['planDayId'], w['exercises'][0]['target'], w['needsReview']), ('B', '3×10 · 40kg', False))
        self.assertEqual(len(r['remapped']), 1)
        self.assertEqual(w['review']['comment'], '稳')

    def test_xunji_edit_asks_for_review_again(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        self.review(1)
        self.xj.remove(1)
        self.xj.put(session(1, '2026-10-14', reps='10'))
        r = self.sync(minutes=11)
        w = self.db.workout(1)
        self.assertEqual((w['needsReview'], w['exercises'][0]['sets'][0]['reps'], len(r['updated'])), (True, 10, 1))
        self.assertEqual(w['review']['comment'], '稳')

    def test_old_imports_are_rewritten_without_review(self):
        t = session(1, '2026-10-14')
        doc = X.map_train(t, {'上肢 A': 'A'}, None)
        self.db.set('workouts', 'xj-1', {**doc, 'xunjiHash': '0123456789abcdef', 'needsReview': False, 'review': {'comment': '旧'}})
        self.xj.put(t)
        r = self.sync()
        w = self.db.workout(1)
        self.assertEqual((w['needsReview'], w['review']['comment'], len(r['remapped'])), (False, '旧', 1))
        self.assertTrue(w['xunjiHash'].startswith('r1:'))

    def test_session_older_than_the_plan_keeps_its_targets(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        plan = self.db.get('plan', 'current')['data']
        days = copy.deepcopy(plan['training']['days'])
        days[0]['exercises'][0]['reps'] = '3–5'
        self.db.set('plan', 'current', {**plan, 'updatedAt': '2026-10-15T08:00:00Z', 'training': {'days': days}})
        self.xj.put(session(2, '2026-10-15'))
        self.sync(minutes=11)
        self.assertEqual(self.db.workout(1)['exercises'][0]['target'], '4×6–8 · RPE 8 · 休息 120s')
        self.assertEqual(self.db.workout(2)['exercises'][0]['target'], '4×3–5 · RPE 8 · 休息 120s')


class Deletion(SyncCase):
    def test_needs_two_reads_ten_minutes_apart_and_keeps_a_copy(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        self.xj.remove(1)
        r = self.sync(minutes=11)                       # re-read: gone → only noted
        self.assertEqual((r['deleted'], len(r['heldBack'])), ([], 1))
        r = self.sync(minutes=15)                       # same read (cache 4 minutes old) → still waiting
        self.assertEqual((r['deleted'], len(r['heldBack'])), ([], 1))
        self.assertIsNotNone(self.db.workout(1))
        r = self.sync(minutes=22)                       # a second read 11 minutes later agrees → deleted
        self.assertEqual(len(r['deleted']), 1)
        self.assertIsNone(self.db.workout(1))
        trash = glob.glob(os.path.join(self.cache, 'trash', '2026-10-14-xj-1.json'))
        self.assertEqual(len(trash), 1)
        with open(trash[0], encoding='utf-8') as f:
            kept = json.load(f)
        self.assertEqual((kept['user'], kept['record']['id'], kept['record']['data']['title']), (USER, 'xj-1', '上肢 A'))
        self.assertEqual(X.load_missing(USER), {})

    def test_a_session_that_comes_back_is_not_deleted(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        self.xj.remove(1)
        self.sync(minutes=11)
        self.xj.put(session(1, '2026-10-14'))
        r = self.sync(minutes=22)
        self.assertEqual((r['deleted'], r['heldBack']), ([], []))
        self.assertIsNotNone(self.db.workout(1))
        self.assertEqual(X.load_missing(USER), {})

    def test_more_than_three_need_allow_deletes(self):
        self.xj.put(*[session(i, '2026-10-14') for i in range(1, 5)])
        self.sync()
        for i in range(1, 5):
            self.xj.remove(i)
        self.sync(minutes=11)
        r = self.sync(minutes=22)
        self.assertEqual((r['deleted'], len(r['heldBack'])), ([], 4))
        self.assertIn('--allow-deletes', r['heldBack'][0])
        r = self.sync(minutes=23, allow_deletes=True)
        self.assertEqual(len(r['deleted']), 4)
        self.assertEqual(len(glob.glob(os.path.join(self.cache, 'trash', '*.json'))), 4)

    def test_settled_cache_without_a_local_workout_is_read_again(self):
        X.write_json_atomic(X.cache_path(USER, '2026-10-05', False), [],
                            mtime=time.mktime(dt.datetime(2026, 10, 9, 12).timetuple()))  # fetched 4 days later: settled
        t = session(5, '2026-10-05')
        self.db.set('workouts', 'xj-5', {**X.map_train(t, {}, None), 'xunjiHash': X.xunji_hash(t), 'needsReview': False})
        self.xj.put(t)
        r = self.sync()
        self.assertIn(('2026-10-05', False), self.xj.calls)
        self.assertEqual((r['deleted'], r['heldBack']), ([], []))

    def test_conflict_stops_the_sync(self):
        self.xj.put(session(1, '2026-10-14'))
        self.sync()
        real = self.db.batch

        def racing(ops):  # Claude reviews the workout while the sync runs
            self.review(1)
            return real(ops)
        self.db.batch = racing
        self.xj.remove(1)
        self.xj.put(session(1, '2026-10-14', reps='12'))
        with self.assertRaises(L.LsjError) as e:
            self.sync(minutes=11)
        self.assertEqual(e.exception.code, 3)


class Cache(SyncCase):
    def test_missing_trains_is_an_error_and_nothing_is_cached(self):
        X.fetch_trains = self.saved[1]
        for answer in ({'success': True}, {'success': True, 'res': {}}, {'success': True, 'res': {'trains': None}},
                       {'success': True, 'res': {'trains': ['x']}}):
            X.post = lambda *a, answer=answer, **k: answer
            with self.assertRaises(SystemExit) as e, contextlib.redirect_stderr(io.StringIO()):
                X.read_day(USER, 'k', '2026-10-14', False, now=T0)
            self.assertEqual(e.exception.code, 2)
            self.assertFalse(os.path.exists(X.cache_path(USER, '2026-10-14', False)))

    def test_corrupt_cache_is_a_miss(self):
        p = X.cache_path(USER, '2026-10-14', True)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as f:
            f.write('[{"localid": 1, "datest')
        os.utime(p, (T0, T0))
        self.xj.put(session(1, '2026-10-14'))
        trains, _ = X.read_day(USER, 'k', '2026-10-14', True, now=T0 + 1)
        self.assertEqual([t['localid'] for t in trains], [1])
        with open(p) as f:
            self.assertEqual(json.load(f)[0]['localid'], 1)

    def test_young_cache_is_reused_and_writes_leave_no_temp_files(self):
        self.xj.put(session(1, '2026-10-14'))
        X.read_day(USER, 'k', '2026-10-14', True, now=T0)
        X.read_day(USER, 'k', '2026-10-14', True, now=T0 + 5 * MIN)
        self.assertEqual(len(self.xj.calls), 1)
        X.read_day(USER, 'k', '2026-10-14', True, now=T0 + 11 * MIN)
        self.assertEqual(len(self.xj.calls), 2)
        self.assertEqual([f for f in os.listdir(os.path.join(self.cache, USER)) if f.endswith('.tmp')], [])

    def test_failed_write_keeps_the_old_file(self):
        p = os.path.join(self.cache, 'x.json')
        X.write_json_atomic(p, [1, 2])
        with self.assertRaises(TypeError):
            X.write_json_atomic(p, [object()])
        with open(p) as f:
            self.assertEqual(json.load(f), [1, 2])
        self.assertEqual(os.listdir(self.cache), ['x.json'])

    def test_full_cache_behind_the_light_list_is_read_again(self):
        X.write_json_atomic(X.cache_path(USER, '2026-10-14', True), [], mtime=T0 - MIN)
        self.xj.put(session(1, '2026-10-14'))
        trains, _ = X.fetch_day(USER, 'k', '2026-10-14', now=T0)
        self.assertEqual([t['localid'] for t in trains], [1])


if __name__ == '__main__':
    unittest.main()

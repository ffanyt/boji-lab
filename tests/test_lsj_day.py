"""bin/lsj's `day` summary: pure functions, synthetic records, one test per rule (no server)."""
import datetime as dt
import importlib.machinery
import importlib.util
import os
import sys
import unittest

sys.dont_write_bytecode = True
REPO = os.environ.get('LSJ_REPO') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def load(name):
    loader = importlib.machinery.SourceFileLoader('lsj_' + name + '_under_test', os.path.join(REPO, 'bin', name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


L = load('lsj')
TODAY = '2026-10-15'  # a Thursday


def rec(col, doc_id, data, updated='2026-10-15T01:00:00Z'):
    return {'collection': col, 'id': doc_id, 'version': 1, 'updatedAt': updated, 'data': data}


def days_before(d, n):
    return L.add_days(d, -n)


class Builder:
    """Collects records the way `lsj range` returns them."""

    def __init__(self):
        self.r = {c: [] for c in L.RANGE_COLLECTIONS}

    def add(self, col, doc_id, data, updated='2026-10-15T01:00:00Z'):
        self.r[col].append(rec(col, doc_id, data, updated))
        return self

    def workout(self, date, plan_day=None, wid=None, created=None, **kw):
        return self.add('workouts', wid or f'w-{date}-{plan_day}', {'date': date, 'planDayId': plan_day,
                                                                    'createdAt': created or f'{date}T10:00:00Z', **kw})

    def pick(self, date, plan):
        return self.add('days', date, {'date': date, 'plan': plan})

    def health(self, date, **kw):
        return self.add('health', date, {'date': date, **kw})

    def dd(self, history=None):
        return L.DayData(self.r, history)


PLAN = {
    'updatedAt': '2026-10-01T00:00:00Z',
    'training': {'schedule': {'1': 'A', '3': 'B', '5': 'C'}, 'days': [{'id': x} for x in 'ABCD']},
    'diet': {'kcal': 2400, 'protein': 150, 'carbs': 280, 'fat': 70, 'restDay': {'kcal': 2000, 'carbs': 200}},
}


class Today(unittest.TestCase):
    def test_day_starts_at_five(self):
        self.assertEqual(L.user_today(dt.datetime(2026, 10, 15, 4, 59)), '2026-10-14')
        self.assertEqual(L.user_today(dt.datetime(2026, 10, 15, 5, 0)), '2026-10-15')

    def test_the_persons_day_start(self):
        self.assertEqual(L.user_today(dt.datetime(2026, 10, 15, 2, 0), start=0), '2026-10-15')
        self.assertEqual(L.user_today(dt.datetime(2026, 10, 15, 2, 59), start=3), '2026-10-14')
        self.assertEqual(L.user_today(dt.datetime(2026, 10, 15, 3, 0), start=3), '2026-10-15')

    def test_zone_and_start_from_the_server_listing(self):
        self.assertEqual(L.day_start_of({'dayStartHour': 2}), 2)
        for u in ({}, None, {'dayStartHour': '2'}, {'dayStartHour': True}, {'dayStartHour': 30}):
            self.assertEqual(L.day_start_of(u), 5, u)
        self.assertIsNotNone(L.zone('Asia/Shanghai'))
        self.assertIsNone(L.zone('Nope/Nowhere'))
        now = dt.datetime.now(dt.timezone.utc).astimezone(L.zone('Asia/Shanghai'))
        self.assertEqual(L.user_today(start=0, tz='Asia/Shanghai'), now.date().isoformat())

    def test_js_round_halves_up(self):
        self.assertEqual([L.js_round(x) for x in (22.5, 23.5, -0.5, 2.4999)], [23, 24, 0, 2])


class Kind(unittest.TestCase):
    def kind(self, b, d=TODAY, plan=PLAN, history=None):
        return L.day_kind(d, b.dd(history), plan, TODAY)

    def test_days_pick_rest_beats_a_workout(self):
        k = self.kind(Builder().pick(TODAY, 'rest').workout(TODAY, 'A'))
        self.assertEqual((k['kind'], k['planDayId'], k['reason']), ('rest', None, 'days'))

    def test_days_pick_id(self):
        k = self.kind(Builder().pick(TODAY, 'B').workout(TODAY, 'A'))
        self.assertEqual((k['kind'], k['planDayId'], k['reason']), ('training', 'B', 'days'))

    def test_workout_plan_day(self):
        k = self.kind(Builder().workout(TODAY, None, 'w1', '2026-10-15T09:00:00Z').workout(TODAY, 'C', 'w2'))
        self.assertEqual((k['kind'], k['planDayId'], k['reason']), ('training', 'C', 'workout'))

    def test_workout_without_plan_day(self):
        k = self.kind(Builder().workout(TODAY, None))
        self.assertEqual((k['kind'], k['planDayId'], k['reason']), ('training', None, 'workout'))

    def test_past_day_without_workout_is_rest(self):
        k = self.kind(Builder(), d='2026-10-14')  # a Wednesday: the schedule says B
        self.assertEqual((k['kind'], k['reason']), ('rest', 'past'))

    def test_schedule(self):
        k = self.kind(Builder(), d='2026-10-16')  # Friday → C
        self.assertEqual((k['kind'], k['planDayId'], k['reason']), ('training', 'C', 'schedule'))

    def test_unscheduled_is_rest(self):
        k = self.kind(Builder())  # Thursday: not in the schedule
        self.assertEqual((k['kind'], k['planDayId'], k['reason']), ('rest', None, 'default'))

    def test_no_plan(self):
        self.assertEqual(self.kind(Builder(), plan=None)['kind'], 'rest')


class Rotation(unittest.TestCase):
    PLAN = {**PLAN, 'training': {**PLAN['training'], 'rotation': ['A', 'B', 'C', 'D']}}
    FRI = '2026-10-16'  # the schedule says C

    def kind(self, b, d=FRI, history=None):
        return L.day_kind(d, b.dd(history), self.PLAN, TODAY)

    def test_next_after_last_trained_wraps(self):
        k = self.kind(Builder().workout('2026-10-14', 'D').workout('2026-10-12', 'A'))
        self.assertEqual((k['planDayId'], k['reason']), ('A', 'rotation'))
        self.assertEqual(k['rotation']['lastDate'], '2026-10-14')

    def test_days_pick_wins_over_that_dates_workout(self):
        k = self.kind(Builder().workout('2026-10-14', 'B').pick('2026-10-14', 'C'))
        self.assertEqual(k['planDayId'], 'D')

    def test_rest_pick_does_not_hide_the_workout(self):
        k = self.kind(Builder().workout('2026-10-14', 'B').pick('2026-10-14', 'rest'))
        self.assertEqual(k['planDayId'], 'C')

    def test_latest_workout_of_the_day(self):
        b = Builder().workout('2026-10-14', 'A', 'w1', '2026-10-14T08:00:00Z').workout('2026-10-14', 'C', 'w2', '2026-10-14T19:00:00Z')
        self.assertEqual(self.kind(b)['planDayId'], 'D')

    def test_ignores_days_outside_the_rotation_and_the_day_itself(self):
        b = Builder().workout('2026-10-14', 'X').workout('2026-10-13', 'B').workout(self.FRI, None)
        self.assertEqual(L.last_rotation_day(self.FRI, b.dd(), ['A', 'B', 'C', 'D']), ('2026-10-13', 'B'))

    def test_history_older_than_the_range(self):
        hist = {'workouts': [rec('workouts', 'old', {'date': '2026-08-01', 'planDayId': 'B'})]}
        self.assertEqual(self.kind(Builder(), history=hist)['planDayId'], 'C')

    def test_no_previous_day_uses_the_schedule(self):
        k = self.kind(Builder())
        self.assertEqual((k['planDayId'], k['reason']), ('C', 'rotation'))

    def test_unscheduled_day_stays_rest(self):
        self.assertEqual(self.kind(Builder().workout('2026-10-14', 'A'), d=TODAY)['kind'], 'rest')

    def test_past_days_are_not_rotated(self):
        k = self.kind(Builder().workout('2026-10-12', 'A'), d='2026-10-14')
        self.assertEqual((k['kind'], k['reason']), ('rest', 'past'))


class Targets(unittest.TestCase):
    def test_training_and_rest(self):
        self.assertEqual(L.diet_targets(PLAN, 'training'), {'kcal': 2400, 'protein': 150, 'carbs': 280, 'fat': 70})
        self.assertEqual(L.diet_targets(PLAN, 'rest'), {'kcal': 2000, 'protein': 150, 'carbs': 200, 'fat': 70})

    def test_water_from_plan(self):
        plan = {**PLAN, 'diet': {**PLAN['diet'], 'water': 3000}}
        self.assertEqual(L.water_target(TODAY, Builder().dd(), plan, {'weight': 70}), 3000)

    def test_water_from_latest_weight_rounded_half_up(self):
        b = Builder().add('body', '2026-10-10', {'date': '2026-10-10', 'weight': 80}).add('body', '2026-10-14', {'date': '2026-10-14', 'weight': 70})
        b.add('body', '2026-10-16', {'date': '2026-10-16', 'weight': 90})  # after d: ignored
        self.assertEqual(L.water_target(TODAY, b.dd(), PLAN, {'weight': 60}), 2500)  # 70 × 35 = 2450 → 2500

    def test_water_from_profile_then_default(self):
        # same as the page: 35 ml/kg kept within 1500–3500, 2000 when no weight is known
        self.assertEqual(L.water_target(TODAY, Builder().dd(), PLAN, {'weight': 60}), 2100)
        self.assertEqual(L.water_target(TODAY, Builder().dd(), PLAN, {'weight': 120}), 3500)
        self.assertEqual(L.water_target(TODAY, Builder().dd(), PLAN, {}), 2000)


class Activity(unittest.TestCase):
    def base(self):
        """Six usual rest days at 400 kcal, plus days that must not count."""
        b = Builder()
        for i in range(1, 7):
            b.health(days_before(TODAY, i), activeKcal=400, steps=8000)
        b.health(days_before(TODAY, 7), activeKcal=1500, steps=500)    # watch off most of the day
        b.health(days_before(TODAY, 8), activeKcal=60, steps=6000)     # too little to be real
        b.health(days_before(TODAY, 9), activeKcal=1500, steps=12000).workout(days_before(TODAY, 9), 'A')  # a training day
        b.health(days_before(TODAY, 29), activeKcal=1500, steps=12000)  # older than 28 days
        return b

    def test_bonus(self):
        b = self.base().health(TODAY, activeKcal=700, steps=9000)
        a = L.activity_bonus(TODAY, b.dd(), None, TODAY)
        self.assertEqual((a['baseline'], a['baselineDays'], a['extra'], a['bonus']), (400, 6, 300, 230))  # 225 → 230

    def test_bonus_goes_on_kcal_and_carbs(self):
        b = self.base().health(TODAY, activeKcal=700, steps=9000)
        s = L.day_summary(TODAY, TODAY, b.r, PLAN)
        self.assertEqual(s['kind'], 'rest')
        self.assertEqual((s['targets']['kcal'], s['targets']['carbs']), (2230, 257.5))

    def test_small_extra_gives_nothing(self):
        b = self.base().health(TODAY, activeKcal=549)
        self.assertEqual(L.activity_bonus(TODAY, b.dd(), None, TODAY)['bonus'], 0)

    def test_capped_at_600(self):
        b = self.base().health(TODAY, activeKcal=2000)
        self.assertEqual(L.activity_bonus(TODAY, b.dd(), None, TODAY)['bonus'], 600)

    def test_ignored_metrics_are_missing(self):
        b = self.base().health(TODAY, activeKcal=700, steps=9000, ignore=['activeKcal'])
        a = L.activity_bonus(TODAY, b.dd(), None, TODAY)
        self.assertEqual((a['activeKcal'], a['baselineDays'], a['bonus']), (None, 6, 0))
        b = self.base().health(TODAY, activeKcal=700, steps=9000)
        next(x for x in b.r['health'] if x['id'] == days_before(TODAY, 1))['data']['ignore'] = ['activeKcal']
        next(x for x in b.r['health'] if x['id'] == days_before(TODAY, 7))['data']['ignore'] = ['steps']   # now counts: 1500
        a = L.activity_bonus(TODAY, b.dd(), None, TODAY)
        self.assertEqual((a['baselineDays'], a['baseline'], a['bonus']), (6, 400, 230))

    def test_needs_four_same_kind_days(self):
        b = Builder()
        for i in range(1, 4):
            b.health(days_before(TODAY, i), activeKcal=400, steps=8000)
        b.health(TODAY, activeKcal=1000)
        a = L.activity_bonus(TODAY, b.dd(), None, TODAY)
        self.assertEqual((a['baseline'], a['bonus']), (None, 0))

    def test_training_day_compares_with_training_days(self):
        b = self.base().workout(TODAY, 'A').health(TODAY, activeKcal=1600)
        for i in (10, 11, 12):
            b.health(days_before(TODAY, i), activeKcal=1300 + i, steps=9000).workout(days_before(TODAY, i), 'B')
        a = L.activity_bonus(TODAY, b.dd(), None, TODAY)
        self.assertEqual((a['baselineDays'], a['baseline'], a['bonus']), (4, 1311.5, 220))  # median of 1310 1311 1312 1500; 288.5 × 0.75 → 220


class Recovery(unittest.TestCase):
    def builder(self, rhr_days=28, hrv_days=28):
        b = Builder()
        for i in range(1, 31):
            b.health(days_before(TODAY, i), restingHR=55 if i <= rhr_days + 1 else None, hrv=50 if i <= hrv_days + 1 else None)
        return b

    def set(self, b, date, **kw):
        h = next(x for x in b.r['health'] if x['id'] == date) if any(x['id'] == date for x in b.r['health']) else None
        if h is None:
            b.health(date, **kw)
        else:
            h['data'].update(kw)

    def test_rhr_two_days_running(self):
        b = self.builder()
        self.set(b, TODAY, restingHR=61)
        self.set(b, days_before(TODAY, 1), restingHR=60)
        r = L.recovery(TODAY, b.dd())
        self.assertTrue(r['recoveryLow'])
        self.assertEqual((r['rhr']['value'], r['rhr']['baseline'], r['rhr']['flag'], r['rhr']['prev']['flag']), (61, 55, True, True))

    def test_rhr_one_day_is_not_enough(self):
        b = self.builder()
        self.set(b, TODAY, restingHR=61)
        self.set(b, days_before(TODAY, 1), restingHR=58)
        r = L.recovery(TODAY, b.dd())
        self.assertEqual((r['rhr']['flag'], r['rhr']['prev']['flag'], r['recoveryLow']), (True, False, False))

    def test_hrv_three_day_mean(self):
        b = self.builder()
        for i, v in ((0, 38), (1, 40), (2, 42), (3, 50)):
            self.set(b, days_before(TODAY, i), hrv=v)
        r = L.recovery(TODAY, b.dd())
        self.assertEqual((r['hrv']['mean3'], r['hrv']['flag']), (40, True))
        self.assertFalse(r['hrv']['prev']['flag'])  # (40 + 42 + 50) / 3 = 44 > 42.5
        self.assertFalse(r['recoveryLow'])
        self.set(b, days_before(TODAY, 3), hrv=40)
        self.assertTrue(L.recovery(TODAY, b.dd())['recoveryLow'])

    def test_hrv_mean_uses_the_values_present(self):
        b = self.builder()
        self.set(b, days_before(TODAY, 1), hrv=None)
        self.set(b, days_before(TODAY, 2), hrv=40)
        self.set(b, TODAY, hrv=42)
        self.assertEqual(L.recovery_flags(TODAY, b.dd())['hrv']['mean3'], 41)

    def test_different_flags_on_the_two_days_do_not_count(self):
        b = self.builder()
        self.set(b, TODAY, restingHR=62, hrv=90)  # mean3 (90 + 30 + 30) / 3 = 50: no HRV flag today
        self.set(b, days_before(TODAY, 1), restingHR=55, hrv=30)
        self.set(b, days_before(TODAY, 2), hrv=30)
        self.set(b, days_before(TODAY, 3), hrv=30)
        r = L.recovery(TODAY, b.dd())
        self.assertEqual((r['rhr']['flag'], r['hrv']['flag'], r['hrv']['prev']['flag']), (True, False, True))
        self.assertFalse(r['recoveryLow'])

    def test_ignored_metrics_are_missing(self):
        b = self.builder()
        self.set(b, TODAY, restingHR=61)
        self.set(b, days_before(TODAY, 1), restingHR=60, ignore=['restingHR'])   # the watch was off: doesn't count
        r = L.recovery(TODAY, b.dd())
        self.assertEqual((r['rhr']['flag'], r['rhr']['prev']['value'], r['recoveryLow']), (True, None, False))
        self.set(b, TODAY, hrv=30, ignore=['hrv'])
        self.set(b, days_before(TODAY, 1), hrv=None)
        self.set(b, days_before(TODAY, 2), hrv=50)
        self.assertEqual(L.recovery_flags(TODAY, b.dd())['hrv']['mean3'], 50)
        b = self.builder()
        for i in range(1, 20):
            self.set(b, days_before(TODAY, i), ignore=['restingHR'])
        self.assertIsNone(L.recovery_flags(TODAY, b.dd())['rhr']['baseline'])     # 10 of the 28 days left

    def test_baseline_needs_fourteen_days(self):
        b = Builder()
        for i in range(1, 14):
            b.health(days_before(TODAY, i), restingHR=55)
        b.health(TODAY, restingHR=70)
        r = L.recovery_flags(TODAY, b.dd())
        self.assertEqual((r['rhr']['baseline'], r['rhr']['baselineDays'], r['rhr']['flag']), (None, 13, False))


class Intake(unittest.TestCase):
    def test_meals_and_drinks(self):
        b = Builder()
        b.add('meals', 'm1', {'date': TODAY, 'slot': 'lunch', 'review': {'kcal': 600, 'protein': 30, 'carbs': 70, 'fat': 20}})
        b.add('meals', 'm2', {'date': TODAY, 'slot': 'dinner', 'needsReview': True})
        b.add('meals', 'm3', {'date': '2026-10-14', 'review': {'kcal': 900}})
        b.add('water', TODAY, {'date': TODAY, 'total': 1250, 'entries': [
            {'t': '08:00', 'ml': 250, 'kind': 'milk'}, {'t': '09:00', 'ml': 300, 'kind': 'soy'},
            {'t': '10:00', 'ml': 500, 'kind': 'water'}, {'t': None, 'ml': 200, 'kind': 'coffee'}]})
        i = L.intake(TODAY, b.dd())
        # milk 250 ml: 162.5 kcal, P 8, C 12, F 9; soy 300 ml: 93 kcal, P 9, C 3.6, F 4.8
        self.assertEqual((i['kcal'], i['protein'], i['carbs'], i['fat']), (856, 47, 85.6, 33.8))
        self.assertEqual(i['drinks'], {'kcal': 256, 'protein': 17, 'carbs': 15.6, 'fat': 13.8})
        self.assertEqual(i['mealsReviewed'], 1)
        self.assertEqual([p['id'] for p in i['pending']], ['m2'])
        self.assertEqual(L.water_total(TODAY, b.dd()), 1250)

    def test_quick_items_count_until_the_meal_is_reviewed(self):
        b = Builder()
        b.add('meals', 'q1', {'date': TODAY, 'slot': 'snack', 'needsReview': False, 'quick': [
            {'name': '鸡胸肉', 'kcal': 120, 'protein': 24, 'carbs': 2, 'fat': 2},
            {'name': '牛奶', 'kcal': 165, 'protein': 8, 'carbs': 12, 'fat': 9}]})
        b.add('meals', 'q2', {'date': TODAY, 'quick': [{'name': '饭团', 'kcal': 200, 'protein': 5}],
                              'review': {'kcal': 210, 'protein': 6, 'carbs': 40, 'fat': 3}})   # reviewed: review wins
        i = L.intake(TODAY, b.dd())
        self.assertEqual((i['kcal'], i['protein']), (495, 38))
        self.assertEqual(i['quick'], {'kcal': 285, 'protein': 32, 'carbs': 14, 'fat': 11, 'meals': 1})
        self.assertEqual(i['pending'], [])

    def test_rule_field_by_field(self):
        b = Builder()
        b.add('meals', 'a', {'date': TODAY, 'slot': 'lunch', 'time': '12:00', 'manual': {'kcal': 650, 'protein': 40},
                             'review': {'kcal': 600, 'protein': 30, 'carbs': 70, 'fat': 20}})             # label numbers win
        b.add('meals', 'b', {'date': TODAY, 'slot': 'snack', 'time': '16:00', 'manual': {'kcal': 300}, 'needsReview': True})
        b.add('meals', 'c', {'date': TODAY, 'slot': 'dinner', 'time': '19:00', 'review': {'kcal': 500, 'protein': 25},
                             'quick': [{'name': '鸡蛋', 'kcal': 70, 'protein': 6, 'carbs': 1, 'fat': 5}]})  # review, then quick
        b.add('meals', 'd', {'date': TODAY, 'slot': 'dinner', 'time': '20:00', 'photos': ['p'], 'needsReview': True})
        b.add('meals', 'e', {'date': TODAY, 'manual': {'protein': 20}})                  # no kcal: not counted
        i = L.intake(TODAY, b.dd())
        self.assertEqual((i['kcal'], i['protein'], i['carbs'], i['fat']), (1450, 65, 71, 25))
        self.assertEqual(i['manual'], {'kcal': 950, 'protein': 40, 'carbs': 70, 'fat': 20, 'meals': 2})
        self.assertEqual(i['quick'], {'kcal': 0, 'protein': 0, 'carbs': 0, 'fat': 0, 'meals': 0})
        self.assertEqual(i['mealsReviewed'], 1)
        self.assertEqual([(p['id'], p['counted']) for p in i['pending']], [('b', True), ('d', False)])
        self.assertEqual({m['id']: m['source'] for m in i['meals']}, {'a': 'manual', 'b': 'manual', 'c': 'review', 'd': None, 'e': None})
        self.assertEqual(next(m for m in i['meals'] if m['id'] == 'a')['protein'], 40)

    def test_bad_numbers_fall_through(self):
        b = Builder().add('meals', 'a', {'date': TODAY, 'manual': {'kcal': '650', 'protein': None}, 'review': {'kcal': 600, 'protein': True},
                                         'quick': [{'protein': 10}, 'x']})
        i = L.intake(TODAY, b.dd())
        self.assertEqual((i['kcal'], i['protein'], i['mealsReviewed']), (600, 10, 1))

    def test_late_meals_come_last(self):
        b = Builder()
        for mid, slot, t in (('m1', 'late', '01:30'), ('m2', 'dinner', '19:00'), ('m3', 'late', '23:30'), ('m4', 'breakfast', '09:00'),
                             ('m5', 'snack', None), ('m6', 'late', None)):
            b.add('meals', mid, {'date': TODAY, 'slot': slot, 'time': t, 'manual': {'kcal': 100}})
        self.assertEqual([m['id'] for m in L.intake(TODAY, b.dd())['meals']], ['m4', 'm5', 'm2', 'm6', 'm3', 'm1'])
        self.assertEqual([m['id'] for m in L.intake(TODAY, b.dd(), day_start=0)['meals']], ['m1', 'm4', 'm5', 'm2', 'm6', 'm3'])

    def test_water_total_from_entries(self):
        b = Builder().add('water', TODAY, {'date': TODAY, 'entries': [{'ml': 300}, {'ml': 200}]})
        self.assertEqual(L.water_total(TODAY, b.dd()), 500)


class Attendance(unittest.TestCase):
    def test_week_and_last(self):
        b = Builder().workout('2026-10-11', 'C')              # last week
        b.workout('2026-10-12', 'A').workout('2026-10-14', 'B').workout('2026-10-14', None, 'w-extra')
        b.pick('2026-10-13', 'rest').pick(TODAY, 'A')
        a = L.attendance(TODAY, b.dd(), PLAN)
        self.assertEqual(a, {'weekDone': 3, 'weekTarget': 3, 'daysSinceLast': 0, 'lastDate': TODAY, 'lastPlanDayId': 'A'})

    def test_days_since_last(self):
        b = Builder().workout('2026-10-12', 'A')
        a = L.attendance(TODAY, b.dd(), PLAN)
        self.assertEqual((a['daysSinceLast'], a['lastDate'], a['lastPlanDayId'], a['weekDone']), (3, '2026-10-12', 'A', 1))

    def test_nothing(self):
        self.assertEqual(L.attendance(TODAY, Builder().dd(), None),
                         {'weekDone': 0, 'weekTarget': 0, 'daysSinceLast': None, 'lastDate': None, 'lastPlanDayId': None})


class Staleness(unittest.TestCase):
    def test_rules(self):
        b = Builder().add('meals', 'm1', {'date': TODAY}, updated='2026-10-15T10:00:00Z')
        b.add('meals', 'm0', {'date': '2026-10-14'}, updated='2026-10-15T12:00:00Z')  # another day
        self.assertTrue(L.report_stale(TODAY, b.dd(), None))
        self.assertTrue(L.report_stale(TODAY, b.dd(), {'updatedAt': '2026-10-15T09:00:00Z'}))
        self.assertFalse(L.report_stale(TODAY, b.dd(), {'updatedAt': '2026-10-15T10:00:00Z'}))
        b.health(TODAY, steps=100)  # an Apple Health sync after the report
        b.r['health'][-1]['updatedAt'] = '2026-10-15T11:00:00Z'
        self.assertTrue(L.report_stale(TODAY, b.dd(), {'updatedAt': '2026-10-15T10:00:00Z'}))

    def test_empty_day_with_report(self):
        self.assertFalse(L.report_stale(TODAY, Builder().dd(), {'updatedAt': '2026-10-15T09:00:00Z'}))

    def test_progress_photos_count_as_a_new_record(self):
        b = Builder().add('progress', TODAY, {'date': TODAY, 'photos': {'front': 'a' * 32}, 'needsReview': True},
                          updated='2026-10-15T11:00:00Z')
        self.assertTrue(L.report_stale(TODAY, b.dd(), {'updatedAt': '2026-10-15T10:00:00Z'}))
        self.assertFalse(L.report_stale(TODAY, b.dd(), {'updatedAt': '2026-10-15T12:00:00Z'}))


class Summary(unittest.TestCase):
    def test_whole_day(self):
        b = Builder().workout(TODAY, 'B')
        b.add('body', TODAY, {'date': TODAY, 'weight': 72.4, 'sleep': 7.5})
        b.add('sleep', TODAY, {'date': TODAY, 'source': 'apple-health', 'asleep': 430, 'deep': 60, 'bedtime': '00:40', 'wake': '08:10'})
        b.health(TODAY, steps=8000, activeKcal=500, syncedAt='2026-10-15T12:00:00Z')
        s = L.day_summary(TODAY, TODAY, b.r, PLAN, {'weight': 75}, None)
        self.assertEqual((s['kind'], s['planDayId'], s['reason']), ('training', 'B', 'workout'))
        self.assertEqual(s['targets'], {'kcal': 2400, 'protein': 150, 'carbs': 280, 'fat': 70, 'water': 2500})
        self.assertEqual(s['water'], {'total': 0, 'target': 2500})
        self.assertEqual(s['weight'], 72.4)
        self.assertEqual(s['sleep']['asleep'], 430)
        self.assertEqual(s['health']['steps'], 8000)
        self.assertTrue(s['reportStale'])
        self.assertFalse(s['recovery']['recoveryLow'])

    def test_body_composition_and_morning_feel(self):
        b = Builder().add('body', TODAY, {'date': TODAY, 'weight': 72.4, 'bodyFat': 18.5, 'bodyFatSource': 'apple-health',
                                          'waist': 81, 'arm': 34.5, 'chest': None, 'hip': 'x', 'thigh': 55,
                                          'feel': {'energy': 4, 'sore': 2, 'stress': 3, 'at': '2026-10-15T01:00:00Z', 'junk': 1}})
        s = L.day_summary(TODAY, TODAY, b.r, PLAN, None)
        self.assertEqual(s['body'], {'bodyFat': 18.5, 'waist': 81, 'arm': 34.5, 'thigh': 55})
        self.assertEqual(s['feel'], {'energy': 4, 'sore': 2, 'stress': 3, 'at': '2026-10-15T01:00:00Z'})
        s = L.day_summary(TODAY, TODAY, Builder().add('body', TODAY, {'date': TODAY, 'feel': 'x'}).r, PLAN, None)
        self.assertEqual((s['body'], s['feel']), ({}, None))

    def test_sleep_from_body_hours(self):
        b = Builder().add('body', TODAY, {'date': TODAY, 'sleep': 6.5})
        self.assertEqual(L.sleep_summary(TODAY, b.dd()), {'source': 'body', 'asleep': 390})

    def test_manual_and_cleared_nights(self):
        b = Builder().add('sleep', TODAY, {'date': TODAY, 'source': 'manual', 'bedtime': '02:10', 'wake': '09:00', 'asleep': 380, 'editedAt': 'x'})
        self.assertEqual(L.sleep_summary(TODAY, b.dd()), {'source': 'manual', 'asleep': 380, 'bedtime': '02:10', 'wake': '09:00'})
        b = Builder().add('sleep', TODAY, {'date': TODAY, 'source': 'manual', 'cleared': True}).add('body', TODAY, {'date': TODAY, 'sleep': 9})
        self.assertIsNone(L.sleep_summary(TODAY, b.dd()))

    def test_cleared_weight_is_missing(self):
        b = Builder().add('body', '2026-10-14', {'date': '2026-10-14', 'weight': 70})
        b.add('body', TODAY, {'date': TODAY, 'weight': None, 'weightSource': 'manual', 'weightAuto': 90})
        s = L.day_summary(TODAY, TODAY, b.r, PLAN, {'weight': 60})
        self.assertIsNone(s['weight'])
        self.assertEqual(L.latest_weight(TODAY, b.dd(), {'weight': 60}), 70)

    def test_todos_plan_custom_and_ignored_health(self):
        b = Builder().health(TODAY, steps=300, activeKcal=50, restingHR=58, ignore=['steps', 'activeKcal', 'junk'])
        plan = {**PLAN, 'custom': {'diet.kcal': {'at': 'x', 'was': 2300}, 'training.days.D': {'at': 'x', 'was': None}}}
        todos = {'date': TODAY, 'items': [{'id': 't1', 'text': '买鸡胸肉', 'done': False}, 'junk']}
        s = L.day_summary(TODAY, TODAY, b.r, plan, None, None, None, todos)
        self.assertEqual(s['todos'], [{'id': 't1', 'text': '买鸡胸肉', 'done': False}])
        self.assertEqual(s['planCustom'], ['diet.kcal', 'training.days.D'])
        self.assertEqual(s['health'], {'steps': None, 'activeKcal': None, 'restingHR': 58, 'hrv': None, 'syncedAt': None,
                                       'ignore': ['steps', 'activeKcal']})
        s = L.day_summary(TODAY, TODAY, Builder().r, {**PLAN, 'custom': 'x'}, None, None, None, {'items': 'x'})
        self.assertEqual((s['todos'], s['planCustom'], s['health']), ([], [], None))


if __name__ == '__main__':
    unittest.main()

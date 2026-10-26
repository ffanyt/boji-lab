"""Reminders appended to the Shortcut's notification: which plan day to train, weigh-in, water."""
import unittest
from datetime import datetime, timedelta, timezone

from helpers import ADMIN_PW, Client, LiveServer

SH = timezone(timedelta(hours=8))
PLAN = {'version': 1, 'training': {'schedule': {'1': 'A', '2': 'B', '4': 'C', '6': 'D'}, 'rotation': ['A', 'B', 'C', 'D'],
                                   'days': [{'id': 'A', 'name': '胸'}, {'id': 'B', 'name': '背'}]},
        'diet': {'kcal': 2900, 'water': 2700}}


class Reminders(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.admin = Client(cls.live.base)
        assert cls.admin.login('admin', ADMIN_PW)[0] == 200
        cls.uid = cls.admin.req('GET', '/api/me')[1]['id']
        cls.srv = cls.live.srv_mod

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def setUp(self):
        for col in ('workouts', 'days', 'body', 'water', 'plan', 'profile'):
            for d in self.admin.req('GET', f'/api/c/{col}')[1]['docs']:
                self.admin.req('DELETE', f'/api/d/{col}/{d["id"]}')
        self.put('plan', 'current', PLAN)

    def put(self, col, doc_id, data):
        st, out = self.admin.req('PUT', f'/api/d/{col}/{doc_id}', data)
        self.assertEqual(st, 200, out)

    def tips(self, when):
        return self.srv.reminders(self.srv.conn(), self.uid, when)

    def test_rotation_names_the_next_plan_day_and_the_gap(self):
        self.put('workouts', 'w1', {'date': '2026-10-01', 'planDayId': 'A'})
        # 2026-10-15 is a Thursday (schedule says C), but the last trained day was A, so B is next
        tips = self.tips(datetime(2026, 10, 15, 11, 0, tzinfo=SH))
        self.assertEqual(tips[0], '今天练 B（背），已经 14 天没练了')

    def test_no_training_reminder_on_rest_days_or_after_training(self):
        self.put('body', '2026-10-15', {'date': '2026-10-15', 'weight': 74.0})
        self.put('days', '2026-10-15', {'date': '2026-10-15', 'plan': 'rest'})
        self.assertEqual(self.tips(datetime(2026, 10, 15, 11, 0, tzinfo=SH)), [])
        self.admin.req('DELETE', '/api/d/days/2026-10-15')
        self.put('workouts', 'w2', {'date': '2026-10-15', 'planDayId': 'C'})
        self.assertEqual(self.tips(datetime(2026, 10, 15, 11, 0, tzinfo=SH)), [])

    def test_weigh_in_only_in_the_morning_and_water_by_time_of_day(self):
        self.put('days', '2026-10-15', {'date': '2026-10-15', 'plan': 'rest'})
        self.assertEqual(self.tips(datetime(2026, 10, 15, 11, 0, tzinfo=SH)), ['还没称体重，空腹称一下'])
        self.put('water', '2026-10-15', {'date': '2026-10-15', 'entries': [], 'total': 400})
        # 20:00 is 10 of the 16 drinking hours: 2700 × 10/16 ≈ 1700
        self.assertEqual(self.tips(datetime(2026, 10, 15, 20, 0, tzinfo=SH)), ['水喝了 400 ml，这个点该到 1700 左右'])

    def test_after_midnight_still_counts_as_the_same_day(self):
        self.put('days', '2026-10-15', {'date': '2026-10-15', 'plan': 'rest'})
        self.put('water', '2026-10-15', {'date': '2026-10-15', 'entries': [], 'total': 2600})
        self.assertEqual(self.tips(datetime(2026, 10, 16, 1, 30, tzinfo=SH)), [])

    def test_each_reminder_can_be_turned_off(self):
        self.put('workouts', 'w1', {'date': '2026-10-01', 'planDayId': 'A'})
        self.put('water', '2026-10-15', {'date': '2026-10-15', 'entries': [], 'total': 0})
        at = datetime(2026, 10, 15, 13, 0, tzinfo=SH)          # 8 hours in: training, weigh-in and water are all due
        self.assertEqual([t[:3] for t in self.tips(at)], ['今天练', '还没称'])
        self.put('profile', 'prefs', {'notify': {'plan': False}})
        self.assertEqual([t[:3] for t in self.tips(at)], ['还没称', '水喝了'])
        self.put('profile', 'prefs', {'notify': {'plan': False, 'weigh': False}})
        self.assertEqual([t[:3] for t in self.tips(at)], ['水喝了'])
        self.put('profile', 'prefs', {'notify': {'plan': False, 'weigh': False, 'water': False}})
        self.assertEqual(self.tips(at), [])
        self.put('profile', 'prefs', {'notify': {'plan': 0, 'weigh': None}})                  # only false turns one off
        self.assertEqual(len(self.tips(at)), 2)

    def test_the_persons_day_start(self):
        self.put('days', '2026-10-16', {'date': '2026-10-16', 'plan': 'rest'})
        self.put('body', '2026-10-15', {'date': '2026-10-15', 'weight': 74.0})
        self.put('days', '2026-10-15', {'date': '2026-10-15', 'plan': 'rest'})
        self.put('water', '2026-10-15', {'date': '2026-10-15', 'entries': [], 'total': 2700})
        at = datetime(2026, 10, 16, 1, 30, tzinfo=SH)
        self.assertEqual(self.tips(at), [])                    # 05:00 start: still the 15th: rest day, weighed, enough water
        self.put('profile', 'prefs', {'dayStartHour': 0})
        self.assertEqual(self.tips(at), ['还没称体重，空腹称一下'])   # midnight start: the 16th began 1.5 hours ago

    def test_at_most_two_and_they_reach_the_notification(self):
        up = Client(self.live.base, bearer=self.admin.req('POST', '/api/me/tokens', {'name': 't'})[1]['token'])
        st, out = up.req('POST', '/api/ingest/health', {'metric': 'steps', 'v': '100', 's': '2026-10-15T09:00:00+08:00'})
        self.assertEqual(st, 200, out)
        self.assertLessEqual(len(self.tips(datetime(2026, 10, 15, 20, 0, tzinfo=SH))), 2)


if __name__ == '__main__':
    unittest.main()

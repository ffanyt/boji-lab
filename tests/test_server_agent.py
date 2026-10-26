"""The person's decisions on Claude's work: inbox proposals (accept / decline), undoing what Claude changed (log), 「写进训记」
with the Agent template key, the two 训记 keys, remapping imported workouts, the new collections, and the CLI side
(bin/lsj pending's new fields, bin/xunji templates-mutate --propose).
训记 is a fake: app/xunji_import.py's HTTP function is replaced, so nothing here reaches the real 训记. Synthetic data only."""
import contextlib
import copy
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import urllib.error

from helpers import ADMIN_PW, REPO, SERVICE_TOKEN, Client, LiveServer, load_module, server_module

TRAIN_KEY = 'fake-train-key-1'
TPL_KEY = 'fake-template-key-1'

EX_A = [{'name': '哑铃卧推', 'sets': 4, 'reps': '8–12', 'load': '22.5kg', 'rest': '120s'}]
EX_A2 = [{'name': '哑铃卧推', 'sets': 4, 'reps': '8–12', 'load': '25kg', 'rest': '120s'}]
DAY_B = {'id': 'B', 'name': '背', 'exercises': [{'name': '高位下拉', 'sets': 4, 'reps': '8–12'}]}
PLAN = {
    'version': 3, 'updatedAt': '2026-10-01T00:00:00Z', 'phase': '第 1 阶段 · 适应期', 'summary': '先把动作练熟',
    'diet': {'kcal': 2600, 'protein': 150, 'carbs': 300, 'fat': 70, 'restDay': {'kcal': 2400}, 'water': 3000,
             'quick': [{'name': '鸡胸肉', 'kcal': 120, 'protein': 24, 'carbs': 0, 'fat': 2, 'when': 'any'}]},
    'training': {'schedule': {'1': 'A', '3': 'B'}, 'rotation': ['A', 'B'],
                 'days': [{'id': 'A', 'name': '胸', 'exercises': EX_A}, DAY_B]},
    'custom': {'diet.kcal': {'at': '2026-10-02T00:00:00Z', 'was': 2500},
               'diet.restDay': {'at': '2026-10-02T00:00:00Z', 'was': {'kcal': 2300}},
               'diet.restDay.kcal': {'at': '2026-10-02T00:00:00Z', 'was': 2300},      # below a changed path: goes
               'training.days.A': {'at': '2026-10-02T00:00:00Z', 'was': None},         # above a changed path: stays
               'training.days.B': {'at': '2026-10-02T00:00:00Z', 'was': None}},
}


def plan_proposal(changes, title='休息日热量降到 2,200'):
    return {'kind': 'plan', 'title': title, 'why': '这两周体重涨得偏快', 'createdAt': '2026-10-16T01:00:00Z', 'by': 'claude',
            'status': 'open', 'changes': changes}


class FakeXunji:
    """训记: the Agent folder (read and mutate, template key) and the trains list (training key). `trouble` makes it fail."""

    def __init__(self):
        self.calls, self.trouble = [], None
        self.folder = {'success': True, 'res': {'folder': {'name': 'Agent 模版', 'version': 7}, 'templates': [
            {'template_id': 't-101', 'name': '胸 三头', 'version': 1, 'movements': [{'name': '哑铃卧推'}]},
            {'template_id': 't-200', 'name': '背 二头', 'version': 3}]}}
        self.mutated = {'success': True, 'res': {'results': [{'client_id': 'lsj-a', 'template_id': 't-101', 'action': 'created'}]}}

    def bodies(self, kind):
        return [b for u, b, _ in self.calls if u.endswith(kind)]

    def __call__(self, url, data, headers, timeout):
        body = json.loads(data)
        self.calls.append((url, body, headers.get('Authorization')))
        auth = headers.get('Authorization')
        if self.trouble == 'down':
            raise urllib.error.URLError('connection refused')
        if 'agent_templates' in url:
            if auth != 'Bearer ' + TPL_KEY:
                return 401, b'{"success": false, "message": "apikey invalid"}'
            if url.endswith('mutate_for_llm_v1'):
                if self.trouble == 'reject':
                    return 400, json.dumps({'success': False, 'message': '动作「飞鸟」不存在 ' + TPL_KEY}).encode()
                if self.trouble == 'conflict':
                    return 409, b'{"success": false, "message": "version conflict: base_version 2 < 3"}'
                return 200, json.dumps(self.mutated).encode()
            return 200, json.dumps(self.folder).encode()
        if auth != 'Bearer ' + TRAIN_KEY:
            return 401, b'{"success": false, "message": "apikey invalid"}'
        return 200, b'{"success": true, "res": {"trains": []}}'


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.live = LiveServer()
        cls.S = cls.live.srv_mod
        cls.page = Client(cls.live.base)
        assert cls.page.login('admin', ADMIN_PW)[0] == 200
        cls.uid = cls.page.req('GET', '/api/me')[1]['id']
        cls.cli = Client(cls.live.base, bearer=SERVICE_TOKEN, act_as='admin')

    @classmethod
    def tearDownClass(cls):
        cls.live.stop()

    def setUp(self):
        self.xj = FakeXunji()
        self.saved = (self.S.xj._http, self.S.XUNJI_PAUSE)
        self.S.xj._http, self.S.XUNJI_PAUSE = self.xj, 0
        for limit in (self.S.XUNJI_LIMIT, self.S.XUNJI_KEY_LIMIT, self.S.XUNJI_TPL_LIMIT):
            limit.clear()
        for col in ('inbox', 'log', 'messages', 'plan', 'plan_history', 'meta', 'workouts', 'profile'):
            for d in self.cli.req('GET', f'/api/c/{col}')[1]['docs']:
                self.cli.req('DELETE', f'/api/d/{col}/{d["id"]}')
        self.S.conn().execute('DELETE FROM xunji_keys')

    def tearDown(self):
        self.S.xj._http, self.S.XUNJI_PAUSE = self.saved

    def env(self, col, doc_id):
        st, out = self.cli.req('GET', f'/api/d/{col}/{doc_id}')
        return out if st == 200 else None

    def doc(self, col, doc_id):
        e = self.env(col, doc_id)
        return e['data'] if e else None

    def put(self, col, doc_id, data):
        st, out = self.cli.req('PUT', f'/api/d/{col}/{doc_id}', data)
        self.assertEqual(st, 200, out)
        return out

    def logs(self):
        return sorted((d['data'] for d in self.cli.req('GET', '/api/c/log')[1]['docs']), key=lambda d: (d['at'], d['kind']))

    def rev(self):
        return self.page.req('GET', '/api/rev')[1]['rev']

    def decide(self, path, body=None, status=200, client=None):
        st, out = (client or self.page).req('POST', path, {} if body is None else body)
        self.assertEqual(st, status, out)
        return out


class Collections(Base):
    def test_inbox_messages_and_log_are_stored_per_person(self):
        self.put('inbox', 'p1', plan_proposal([]))
        self.put('log', '20261016-090000-ab12', {'at': '2026-10-16T01:00:00Z', 'kind': 'run', 'text': '看了 3 餐'})
        st, out = self.page.req('PUT', '/api/d/messages/m1760000000000', {'text': '这周出差只能练 3 天', 'createdAt': 'x',
                                                                          'status': 'new', 'needsReview': True})
        self.assertEqual(st, 200, out)
        for col, n in (('inbox', 1), ('log', 1), ('messages', 1)):
            self.assertEqual(len(self.page.req('GET', f'/api/c/{col}')[1]['docs']), n, col)
        st, out = self.cli.req('GET', '/api/c/messages?where=needsReview:eq:true')
        self.assertEqual([d['data']['text'] for d in out['docs']], ['这周出差只能练 3 天'])
        self.assertEqual(self.page.req('DELETE', '/api/d/messages/m1760000000000')[0], 200)
        other = Client(self.live.base, bearer=SERVICE_TOKEN)
        st, out = self.page.req('POST', '/api/admin/users', {'username': 'olga'})
        other.act_as = 'olga'
        self.assertEqual(other.req('GET', '/api/c/inbox')[1]['docs'], [])          # each person their own


class AcceptPlan(Base):
    def setUp(self):
        super().setUp()
        self.put('plan', 'current', copy.deepcopy(PLAN))
        self.changes = [
            {'path': 'diet.restDay', 'label': '休息日目标', 'from': {'kcal': 2400}, 'to': {'kcal': 2200},
             'fromText': '2,400 kcal', 'toText': '2,200 kcal'},
            {'path': 'training.days.A.exercises', 'label': 'A 日动作', 'from': EX_A, 'to': EX_A2},
            {'path': 'training.days.B', 'label': 'B 日', 'from': DAY_B, 'to': None},                 # remove a day
            {'path': 'training.days.C', 'label': 'C 日', 'from': None, 'to': {'name': '腿', 'exercises': []}},  # add one
            {'path': 'training.rotation', 'label': '轮换', 'from': ['A', 'B'], 'to': ['A', 'C']},
            {'path': 'notes', 'label': '说明', 'from': None, 'to': '新的说明'},
        ]

    def test_accept_changes_the_plan_in_one_write(self):
        self.put('inbox', 'p1', plan_proposal(self.changes))
        before, rev = self.env('plan', 'current'), self.rev()
        out = self.decide('/api/inbox/p1/accept')
        plan = self.doc('plan', 'current')
        self.assertEqual(plan['diet']['restDay'], {'kcal': 2200})
        self.assertEqual([d['id'] for d in plan['training']['days']], ['A', 'C'])
        self.assertEqual(plan['training']['days'][0]['exercises'], EX_A2)
        self.assertEqual(plan['training']['days'][1], {'id': 'C', 'name': '腿', 'exercises': []})
        self.assertEqual((plan['training']['rotation'], plan['notes'], plan['diet']['kcal']), (['A', 'C'], '新的说明', 2600))
        self.assertEqual(plan['version'], 3)                                               # not a new plan version
        self.assertGreater(plan['updatedAt'], PLAN['updatedAt'])
        self.assertEqual(sorted(plan['custom']), ['diet.kcal', 'training.days.A'])        # agreed paths and below: gone
        self.assertEqual(self.cli.req('GET', '/api/c/plan_history')[1]['docs'], [])
        self.assertEqual(self.env('plan', 'current')['version'], before['version'] + 1)
        inbox = self.doc('inbox', 'p1')
        self.assertEqual((inbox['status'], inbox['needsReview'], inbox['decidedAt'][:2]), ('accepted', True, '20'))
        self.assertEqual((out['ok'], out['inbox']['data']['status'], out['plan']['data'], len(out['log'])), (True, 'accepted', plan, 1))
        self.assertEqual([(x['kind'], x['text'], x['ref']) for x in self.logs()], [('decision', '你同意了：休息日热量降到 2,200', 'inbox/p1')])
        self.assertRegex(out['log'][0]['id'], r'^\d{8}-\d{6}-[0-9a-f]{4}$')
        self.assertGreater(self.rev(), rev)                                                 # the page's poll sees it
        self.assertEqual(self.decide('/api/inbox/p1/accept', status=409)['error']['code'], 'not_open')

    def test_an_edit_above_a_change_keeps_it_in_its_suggestion(self):
        plan = copy.deepcopy(PLAN)
        was_a = {'id': 'A', 'name': '胸（建议）', 'exercises': EX_A}
        plan['custom']['training.days.A'] = {'at': '2026-10-02T00:00:00Z', 'was': was_a}
        self.put('plan', 'current', plan)
        self.put('inbox', 'p1', plan_proposal([{'path': 'training.days.A.exercises', 'label': 'A 日动作', 'from': EX_A, 'to': EX_A2}]))
        self.decide('/api/inbox/p1/accept')
        custom = self.doc('plan', 'current')['custom']
        self.assertEqual(custom['training.days.A']['was'], {**was_a, 'exercises': EX_A2})   # 恢复建议值 keeps the agreed change
        self.assertIsNone(custom['training.days.B']['was'])                                    # untouched

    def test_one_change_that_no_longer_matches_changes_nothing(self):
        self.put('inbox', 'p1', plan_proposal(self.changes))
        plan = copy.deepcopy(PLAN)
        plan['diet']['restDay'] = {'kcal': 2450}                                             # the person edited it meanwhile
        self.put('plan', 'current', plan)
        before = self.env('plan', 'current')
        err = self.decide('/api/inbox/p1/accept', status=409)['error']
        self.assertEqual((err['code'], err['message'], err['inbox']['data']['status']), ('stale', '计划已经变了，等 Claude 重新出提案', 'stale'))
        self.assertEqual(self.env('plan', 'current'), before)
        inbox = self.doc('inbox', 'p1')
        self.assertEqual((inbox['status'], inbox['needsReview']), ('stale', True))
        self.assertIn('计划已经变了', self.logs()[0]['text'])
        self.assertEqual(self.decide('/api/inbox/p1/accept', status=409)['error']['code'], 'not_open')

    def test_deep_comparison(self):
        for from_, ok in ((['A', 'B'], True), (['B', 'A'], False), (['A', 'B', 'C'], False)):
            self.put('plan', 'current', copy.deepcopy(PLAN))
            self.put('inbox', 'p1', plan_proposal([{'path': 'training.rotation', 'from': from_, 'to': ['B', 'A']}]))
            self.decide('/api/inbox/p1/accept', status=200 if ok else 409)
        plan = copy.deepcopy(PLAN)
        plan['notes'] = 1
        self.put('plan', 'current', plan)
        for from_, ok in ((True, False), (1.0, True)):                                    # true is not 1; 1.0 is 1
            self.put('inbox', 'p1', plan_proposal([{'path': 'notes', 'from': from_, 'to': 2}]))
            self.decide('/api/inbox/p1/accept', status=200 if ok else 409)
        self.assertEqual(self.doc('plan', 'current')['notes'], 2)

    def test_a_path_through_a_value_is_stale(self):
        self.put('inbox', 'p1', plan_proposal([{'path': 'diet.kcal.extra', 'from': None, 'to': 1}]))
        self.assertEqual(self.decide('/api/inbox/p1/accept', status=409)['error']['code'], 'stale')

    def test_a_malformed_proposal_fails(self):
        for changes in ([{'path': 'profile.weight', 'from': None, 'to': 70}], [{'path': 'diet..kcal', 'to': 1}],
                        [{'path': 'diet.kcal', 'from': 2600}], [], 'diet.kcal'):
            self.put('inbox', 'p1', plan_proposal(changes))
            err = self.decide('/api/inbox/p1/accept', status=400)['error']
            self.assertEqual((err['code'], err['inbox']['data']['status']), ('bad_proposal', 'failed'), changes)
            self.assertTrue(self.doc('inbox', 'p1')['result']['error'])
        self.assertEqual(self.doc('plan', 'current'), PLAN)

    def test_no_such_proposal(self):
        self.assertEqual(self.decide('/api/inbox/nope/accept', status=404)['error']['code'], 'not_found')
        self.assertEqual(self.decide('/api/inbox/a%20b/accept', status=400)['error']['code'], 'invalid_argument')
        self.assertEqual(self.page.req('GET', '/api/inbox/p1/accept')[0], 404)


class Decline(Base):
    def test_decline(self):
        self.put('plan', 'current', copy.deepcopy(PLAN))
        self.put('inbox', 'p1', plan_proposal([{'path': 'diet.kcal', 'from': 2600, 'to': 2400}]))
        before = self.env('plan', 'current')
        out = self.decide('/api/inbox/p1/decline')
        self.assertEqual((out['inbox']['data']['status'], out['inbox']['data']['needsReview']), ('declined', True))
        self.assertEqual(self.env('plan', 'current'), before)
        self.assertEqual([x['text'] for x in self.logs()], ['你没同意：休息日热量降到 2,200'])
        self.assertEqual(self.decide('/api/inbox/p1/decline', status=409)['error']['code'], 'not_open')
        self.assertEqual(self.decide('/api/inbox/p1/accept', status=409)['error']['code'], 'not_open')

    def test_questions_are_answered_or_skipped(self):
        q = {'kind': 'question', 'title': '左膝', 'q': '左膝还疼吗？', 'options': ['不疼了', '还有点'], 'status': 'open', 'createdAt': 'x'}
        self.put('inbox', 'q1', q)
        self.assertEqual(self.decide('/api/inbox/q1/accept', {'text': '  '}, status=400)['error']['code'], 'invalid_argument')
        out = self.decide('/api/inbox/q1/accept', {'text': '还有点'})
        d = out['inbox']['data']
        self.assertEqual((d['status'], d['answer']['text'], d['needsReview']), ('answered', '还有点', True))
        self.put('inbox', 'q2', q)
        self.assertEqual(self.decide('/api/inbox/q2/decline')['inbox']['data']['status'], 'declined')
        self.assertEqual(sorted(x['text'] for x in self.logs()), sorted(['你回答了：左膝还疼吗？ → 还有点', '你没回答：左膝还疼吗？']))


class Undo(Base):
    def setUp(self):
        super().setUp()
        plan = copy.deepcopy(PLAN)
        plan['training']['days'][0]['exercises'] = EX_A2
        plan['diet']['water'] = 3200
        plan['diet']['note'] = 'Claude 加的'
        self.put('plan', 'current', plan)
        self.entry = {'at': '2026-10-16T01:00:00Z', 'kind': 'plan', 'text': '把 A 日哑铃卧推的计划重量从 22.5kg 调到 25kg',
                      'undo': {'changes': [{'path': 'training.days.A.exercises', 'label': 'A 日 · 哑铃卧推', 'from': EX_A, 'to': EX_A2},
                                           {'path': 'diet.water', 'from': 3000, 'to': 3200},
                                           {'path': 'diet.note', 'from': None, 'to': 'Claude 加的'}]}}
        self.put('log', '20261016-090000-ab12', self.entry)

    def test_undo_puts_the_old_values_back(self):
        out = self.decide('/api/log/20261016-090000-ab12/undo')
        plan = self.doc('plan', 'current')
        self.assertEqual((plan['training']['days'][0]['exercises'], plan['diet']['water'], 'note' in plan['diet']), (EX_A, 3000, False))
        self.assertEqual((plan['version'], sorted(plan['custom'])), (3, sorted(PLAN['custom'])))
        self.assertEqual(out['undone']['data']['undone']['at'], self.doc('log', '20261016-090000-ab12')['undone']['at'])
        self.assertEqual(out['plan']['data'], plan)
        self.assertEqual([x['text'] for x in self.logs() if x['kind'] == 'decision'],
                         ['你撤回了：把 A 日哑铃卧推的计划重量从 22.5kg 调到 25kg'])
        self.assertEqual(self.decide('/api/log/20261016-090000-ab12/undo', status=409)['error']['code'], 'already_undone')

    def test_stale_undo_writes_nothing(self):
        plan = self.doc('plan', 'current')
        plan['diet']['water'] = 3500                                                         # changed again since
        self.put('plan', 'current', plan)
        before, rev = self.env('plan', 'current'), self.rev()
        self.assertEqual(self.decide('/api/log/20261016-090000-ab12/undo', status=409)['error']['code'], 'stale')
        self.assertEqual(self.env('plan', 'current'), before)
        self.assertNotIn('undone', self.doc('log', '20261016-090000-ab12'))
        self.assertEqual((len(self.logs()), self.rev()), (1, rev))

    def test_only_entries_with_undo(self):
        self.put('log', 'l2', {'at': 'x', 'kind': 'run', 'text': '看了 3 餐'})
        self.assertEqual(self.decide('/api/log/l2/undo', status=400)['error']['code'], 'cannot_undo')
        self.put('log', 'l3', {'at': 'x', 'kind': 'plan', 'text': 'x', 'undo': {'changes': [{'path': 'diet.kcal', 'to': 1}]}})
        self.assertEqual(self.decide('/api/log/l3/undo', status=400)['error']['code'], 'cannot_undo')   # no "from"
        self.assertEqual(self.decide('/api/log/nope/undo', status=404)['error']['code'], 'not_found')


class PageOnly(Base):
    def test_tokens_cannot_decide(self):
        self.put('plan', 'current', copy.deepcopy(PLAN))
        self.put('inbox', 'p1', plan_proposal([{'path': 'diet.kcal', 'from': 2600, 'to': 2400}]))
        self.put('log', 'l1', {'at': 'x', 'kind': 'plan', 'text': 'x', 'undo': {'changes': [{'path': 'diet.kcal', 'from': 2500, 'to': 2600}]}})
        upload = Client(self.live.base, bearer=self.page.req('POST', '/api/me/tokens', {'name': 't'})[1]['token'])
        for client in (self.cli, upload):
            for path in ('/api/inbox/p1/accept', '/api/inbox/p1/decline', '/api/log/l1/undo'):
                self.assertEqual(client.req('POST', path, {})[0], 403, (path, client.bearer[:4]))
        for path in ('/api/inbox/p1/accept', '/api/log/l1/undo'):
            self.assertEqual(Client(self.live.base).req('POST', path, {})[0], 401)
            self.assertEqual(self.page.req('POST', path, {}, {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.doc('inbox', 'p1')['status'], 'open')
        self.assertEqual(self.doc('plan', 'current')['diet']['kcal'], 2600)
        self.assertNotIn('undone', self.doc('log', 'l1'))
        st, out = self.cli.req('POST', '/api/xunji/remap', {})
        self.assertEqual(st, 403)


MUT = {'upserts': [
    {'client_id': 'lsj-a', 'name': '胸 三头', 'color': '#1D4ED8', 'movements': [
        {'name': '哑铃卧推', 'sets': [{'weight': 22.5, 'reps': 10, 'unit': 'kg'}] * 3,
         'progression': {'start_reps': 8, 'reps_increment': 1, 'target_reps': 12, 'weight_increment': 2.5, 'reset_reps': 8}}]},
    {'template_id': 't-200', 'base_version': 2, 'name': '背 二头', 'movements': [
        {'name': '高位下拉', 'sets': [{'weight': 40, 'reps': 10, 'unit': 'kg'}] * 3}]}],
    'deletes': [{'template_id': 't-300'}]}


def xunji_proposal(mutation=None, title='把 2 个训练日写进训记'):
    return {'kind': 'xunji', 'title': title, 'why': '计划改了，训记里的模版还是旧的', 'createdAt': '2026-10-16T01:00:00Z',
            'by': 'claude', 'status': 'open', 'mutation': copy.deepcopy(MUT if mutation is None else mutation),
            'days': {'lsj-a': 'A', 't-200': 'B'}, 'summary': ['新建模版「胸 三头」：1 个动作']}


class XunjiAccept(Base):
    def setUp(self):
        super().setUp()
        self.S.save_xunji_key(self.uid, TPL_KEY, 'template')
        self.put('plan', 'current', copy.deepcopy(PLAN))
        self.put('meta', 'xunji', {'dayMap': {'胸日': 'A'}, 'templates': 'web', 'keys': {'train': False, 'template': True},
                                   'templatesState': {'C': {'name': '腿', 'template_id': 't-300', 'at': 'old'},
                                                      'B': {'name': '背 旧', 'template_id': 't-200', 'at': 'old', 'planUpdatedAt': 'old'}}})
        self.put('inbox', 'x1', xunji_proposal())

    def test_written_into_xunji(self):
        out = self.decide('/api/inbox/x1/accept')
        sent = self.xj.bodies('mutate_for_llm_v1')
        self.assertEqual(len(sent), 1)
        self.assertEqual({k: v for k, v in sent[0].items() if k not in ('confirmed', 'mutation_id')}, MUT)
        self.assertEqual((sent[0]['confirmed'], sent[0]['mutation_id']), (True, self.S.xj.mutation_id('x1', MUT)))
        self.assertRegex(sent[0]['mutation_id'], r'^lsj-[0-9a-f]{20}$')
        self.assertEqual({a for _, _, a in self.xj.calls}, {'Bearer ' + TPL_KEY})          # the template key only
        self.assertEqual(self.xj.bodies('sync_for_llm_v2'), [{'template_versions': {}}])  # the folder is read again after
        inbox = self.doc('inbox', 'x1')
        self.assertEqual((inbox['status'], inbox['needsReview'], inbox['result']['ok']), ('accepted', True, True))
        self.assertEqual(json.loads(inbox['result']['response']), self.xj.mutated)
        meta = self.doc('meta', 'xunji')
        st = meta['templatesState']
        self.assertEqual(sorted(st), ['A', 'B'])                                             # C's template was deleted
        self.assertEqual((st['A']['name'], st['A']['template_id'], st['A']['planUpdatedAt']), ('胸 三头', 't-101', PLAN['updatedAt']))
        self.assertEqual((st['B']['name'], st['B']['template_id'], st['B']['at']), ('背 二头', 't-200', inbox['decidedAt']))
        self.assertEqual(meta['agentTemplates'], [{'template_id': 't-101', 'name': '胸 三头', 'version': 1},
                                                  {'template_id': 't-200', 'name': '背 二头', 'version': 3}])
        self.assertEqual((meta['dayMap'], meta['templates'], meta['agentTemplatesAt']), ({'胸日': 'A'}, 'web', inbox['decidedAt']))
        self.assertEqual([(x['kind'], x['text']) for x in self.logs()],
                         [('decision', '你同意了：把 2 个训练日写进训记'), ('xunji', '写进训记：胸 三头、背 二头；删了 1 个旧模版')])
        self.assertEqual((out['inbox']['data']['status'], out['meta']['data']['templatesState'], len(out['log'])), ('accepted', st, 2))

    def test_xunji_refuses(self):
        said = {}
        for trouble, status, code in (('reject', 502, 'xunji_rejected'), ('conflict', 409, 'xunji_conflict'), ('down', 502, 'xunji_unreachable')):
            self.S.XUNJI_TPL_LIMIT.clear()
            self.xj.trouble = trouble
            self.put('inbox', 'x1', xunji_proposal())
            with contextlib.redirect_stderr(io.StringIO()) as err:
                out = self.decide('/api/inbox/x1/accept', status=status)['error']
            self.assertEqual(out['code'], code)
            inbox = self.doc('inbox', 'x1')
            self.assertEqual((inbox['status'], inbox['needsReview'], inbox['result']['ok'], inbox['result']['error']),
                             ('failed', True, False, out['message']))
            self.assertNotIn(TPL_KEY, json.dumps([out, self.logs()], ensure_ascii=False) + err.getvalue())
            self.assertIn('训记 template change failed', err.getvalue())
            said[trouble] = out['message']
        self.assertEqual(said, {'reject': '训记没接受这次修改：动作「飞鸟」不存在 ***',
                                'conflict': '训记里的模版变了，等 Claude 重新准备',
                                'down': '连不上训记，这次没写进去：Claude 下次处理时会重新准备'})
        self.assertEqual(len([x for x in self.logs() if '但没写进训记' in x['text']]), 3)
        meta = self.doc('meta', 'xunji')
        self.assertEqual((meta['templatesState']['C']['template_id'], 'agentTemplates' in meta), ('t-300', False))   # nothing written

    def test_a_template_key_is_needed(self):
        self.S.conn().execute('DELETE FROM xunji_keys')
        self.S.save_xunji_key(self.uid, TRAIN_KEY)                                           # a training key isn't enough
        err = self.decide('/api/inbox/x1/accept', status=400)['error']
        self.assertEqual((err['code'], err['message']), ('no_template_key', '还没存训记模版 key：在「我的 → 训记」里填'))
        self.assertEqual((self.doc('inbox', 'x1')['status'], self.xj.calls), ('open', []))

    def test_one_go_every_ten_seconds(self):
        self.put('inbox', 'x2', xunji_proposal(title='再写一次'))
        self.decide('/api/inbox/x1/accept')
        err = self.decide('/api/inbox/x2/accept', status=429)['error']
        self.assertEqual(err['code'], 'rate_limited')
        self.assertTrue(0 < err['retryAfter'] <= 10)
        self.assertEqual(self.doc('inbox', 'x2')['status'], 'open')
        self.S.XUNJI_TPL_LIMIT.clear()
        self.decide('/api/inbox/x2/accept')

    def test_checked_before_sending(self):
        bad = copy.deepcopy(MUT)
        bad['upserts'][0]['name'] = '胸·三头'
        bad['upserts'][1]['movements'] = [{'name': f'动作{i}', 'sets': [{'reps': 10}] * 21} for i in range(16)]
        for mutation in (bad, {'upserts': [], 'deletes': []}, 'nonsense'):
            self.put('inbox', 'x1', xunji_proposal(mutation))
            err = self.decide('/api/inbox/x1/accept', status=400)['error']
            self.assertEqual((err['code'], err['inbox']['data']['status']), ('invalid_mutation', 'failed'))
        self.put('inbox', 'x1', xunji_proposal(bad))
        msg = self.decide('/api/inbox/x1/accept', status=400)['error']['message']
        for part in ('「胸·三头」含有不允许的字符', '超过 15 个动作', '超过 20 组'):
            self.assertIn(part, msg)
        self.assertEqual(self.xj.calls, [])
        good = copy.deepcopy(MUT)
        good['upserts'][0]['movements'][0]['name'] = '不是官方名字的动作'                     # names are not checked here
        self.put('inbox', 'x1', xunji_proposal(good))
        self.decide('/api/inbox/x1/accept')

    def test_a_folder_shape_we_do_not_know(self):
        self.xj.folder = {'success': True, 'res': {'stuff': [{'a': 1}], 'n': 2}}
        self.xj.mutated = {'success': True, 'res': {'ok': 'x' * 6000}}
        self.decide('/api/inbox/x1/accept')
        meta = self.doc('meta', 'xunji')
        self.assertEqual(meta['agentTemplates'], [])
        self.assertIn('stuff', meta['agentTemplatesRaw'])
        self.assertNotIn('template_id', meta['templatesState']['A'])                         # no id known for the new one
        self.assertEqual(meta['templatesState']['B']['template_id'], 't-200')
        self.assertEqual(len(self.doc('inbox', 'x1')['result']['response']), self.S.XUNJI_RESPONSE_MAX)


class Keys(Base):
    def test_two_kinds_of_key(self):
        st, out = self.page.req('PUT', '/api/xunji/key', {'key': TPL_KEY, 'kind': 'template'})
        self.assertEqual((st, out['verified'], out['kind']), (200, True, 'template'), out)
        self.assertEqual(out['agentTemplates'][0], {'template_id': 't-101', 'name': '胸 三头', 'version': 1})
        self.assertEqual(self.xj.bodies('sync_for_llm_v2'), [{'template_versions': {}}])
        self.assertEqual((self.S.xunji_key(self.uid, 'template'), self.S.xunji_key(self.uid)), (TPL_KEY, None))
        self.S.XUNJI_KEY_LIMIT.clear()
        self.assertEqual(self.page.req('PUT', '/api/xunji/key', {'key': TRAIN_KEY})[1]['kind'], 'train')
        st, out = self.page.req('GET', '/api/xunji')
        self.assertEqual((out['hasKey'], out['hasTemplateKey'], out['templateKeyUpdatedAt'][:2]), (True, True, '20'))
        meta = self.doc('meta', 'xunji')
        self.assertEqual((meta['keys'], meta['agentTemplates'][1]['name']), ({'train': True, 'template': True}, '背 二头'))
        self.assertEqual(self.page.req('DELETE', '/api/xunji/key?kind=template'), (200, {'deleted': True, 'kind': 'template'}))
        self.assertEqual((self.S.xunji_key(self.uid, 'template'), self.S.xunji_key(self.uid)), (None, TRAIN_KEY))
        self.assertEqual(self.doc('meta', 'xunji')['keys'], {'train': True, 'template': False})
        self.assertEqual(self.page.req('DELETE', '/api/xunji/key', {'kind': 'train'})[1], {'deleted': True, 'kind': 'train'})
        self.assertEqual(self.doc('meta', 'xunji')['keys'], {'train': False, 'template': False})
        for bad in ({'key': TPL_KEY, 'kind': 'agent'}, {'key': TPL_KEY, 'kind': 3}):
            self.assertEqual(self.page.req('PUT', '/api/xunji/key', bad)[0], 400)
        self.assertEqual(self.page.req('DELETE', '/api/xunji/key?kind=both')[0], 400)

    def test_a_template_key_xunji_does_not_know(self):
        with contextlib.redirect_stderr(io.StringIO()):
            st, out = self.page.req('PUT', '/api/xunji/key', {'key': 'fake-wrong-key-9', 'kind': 'template'})
            self.assertEqual((st, out['error']['code']), (400, 'xunji_key_invalid'))
            self.assertIsNone(self.S.xunji_key(self.uid, 'template'))
            self.S.XUNJI_KEY_LIMIT.clear()
            self.xj.trouble = 'down'
            st, out = self.page.req('PUT', '/api/xunji/key', {'key': TPL_KEY, 'kind': 'template'})
        self.assertEqual((st, out['verified']), (200, False))
        self.assertEqual(self.S.xunji_key(self.uid, 'template'), TPL_KEY)
        self.assertNotIn('agentTemplates', self.doc('meta', 'xunji'))

    def test_both_go_with_the_account(self):
        st, out = self.page.req('POST', '/api/admin/users', {'username': 'pia'})
        mid = out['user']['id']
        self.S.save_xunji_key(mid, TRAIN_KEY)
        self.S.save_xunji_key(mid, TPL_KEY, 'template')
        pia = Client(self.live.base, bearer=SERVICE_TOKEN, act_as='pia')
        self.assertEqual(pia.req('GET', '/api/d/meta/xunji')[1]['data']['keys'], {'train': True, 'template': True})
        self.page.req('PATCH', f'/api/admin/users/{mid}', {'disabled': True})
        self.assertEqual((self.S.xunji_key(mid), self.S.xunji_key(mid, 'template')), (None, None))
        self.assertEqual(pia.req('GET', '/api/d/meta/xunji')[1]['data']['keys'], {'train': False, 'template': False})

    def test_old_key_table_is_migrated(self):
        data, saved = tempfile.mkdtemp(prefix='lsj-test-'), self.S.DATA
        db = sqlite3.connect(os.path.join(data, 'data.db'))
        db.execute('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,'
                   ' pw_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,'
                   ' created_at TEXT NOT NULL, last_seen TEXT)')
        db.execute("INSERT INTO users VALUES ('u1', 'mo', 'mo', 'admin', 'x', 0, 0, '2026-01-01', NULL)")
        db.execute('CREATE TABLE xunji_keys (uid TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,'
                   ' train_key TEXT NOT NULL, updated_at TEXT NOT NULL)')
        db.execute("INSERT INTO xunji_keys VALUES ('u1', 'fake-old-train-key', '2026-10-15T00:00:00Z')")
        db.commit()
        db.close()
        try:
            self.S.DATA = data
            self.S._local.__dict__.clear()
            with contextlib.redirect_stdout(io.StringIO()) as said:
                self.S.init_db()
                self.S.init_db()                                                             # once only
            self.assertEqual(said.getvalue().count('moved to the two-kind layout'), 1)
            rows = self.S.conn().execute('SELECT uid, kind, key, updated_at FROM xunji_keys').fetchall()
            self.assertEqual(rows, [('u1', 'train', 'fake-old-train-key', '2026-10-15T00:00:00Z')])
            self.assertEqual((self.S.xunji_key('u1'), self.S.xunji_key('u1', 'template')), ('fake-old-train-key', None))
            self.assertEqual(self.S.doc_data(self.S.conn(), 'u1', 'meta', 'xunji'), {'keys': {'train': True, 'template': False}})
        finally:
            self.S.DATA = saved
            self.S._local.__dict__.clear()

    def test_set_template_key_from_the_command_line(self):
        env = {**os.environ, 'LSJ_DATA': self.live.data, 'LSJ_TOKEN': SERVICE_TOKEN, 'LSJ_PASSWORD': ADMIN_PW}

        def run(*args, stdin=TPL_KEY):
            return subprocess.run([sys.executable, os.path.join(REPO, 'app', 'server.py'), '--set-xunji-key', *args], input=stdin,
                                  env=env, capture_output=True, text=True, timeout=30)
        r = run('admin', '--kind', 'template')
        self.assertEqual((r.returncode, r.stdout), (0, 'ok\n'), r.stderr)
        self.assertNotIn(TPL_KEY, r.stdout + r.stderr)
        self.assertEqual((self.S.xunji_key(self.uid, 'template'), self.S.xunji_key(self.uid)), (TPL_KEY, None))
        self.assertEqual(self.doc('meta', 'xunji')['keys'], {'train': False, 'template': True})
        self.assertNotEqual(run('admin', '--kind', 'both').returncode, 0)
        self.assertNotEqual(run('admin', '--kind').returncode, 0)


class Remap(Base):
    def test_remap_follows_mine_and_day_map(self):
        plan = copy.deepcopy(PLAN)
        plan['training']['days'] = [{'id': 'A', 'exercises': [{'name': '杠铃卧推', 'sets': 4, 'reps': '6–8', 'load': 'RPE 8', 'rest': '120s'}]},
                                    {'id': 'B', 'exercises': [{'name': '杠铃卧推', 'sets': 3, 'reps': '10', 'load': '40kg'}]}]
        self.put('plan', 'current', plan)
        self.put('meta', 'xunji', {'dayMap': {'胸日': 'A'}, 'lastSyncDate': '2026-10-15'})

        def wo(title, pid=None, **extra):
            return {'date': '2026-10-15', 'source': 'xunji', 'title': title, 'planDayId': pid, 'needsReview': False,
                    'review': {'rating': 'good', 'comment': '稳'}, 'xunjiHash': 'r1:abc',
                    'exercises': [{'name': '杠铃卧推', 'target': '', 'sets': []}, {'name': '跑步', 'cardio': True, 'metrics': {}, 'sets': []}],
                    **extra}
        self.put('workouts', 'xj-1', wo('胸日'))                                         # dayMap says A
        self.put('workouts', 'xj-2', wo('胸日', mine={'planDayId': 'B'}))                 # the person said B
        self.put('workouts', 'xj-3', wo('随便练练', mine={'planDayId': ''}))                   # not a plan day: unchanged
        self.put('workouts', 'w1', {**wo('胸日'), 'source': None})                        # recorded on the page
        before = {i: self.env('workouts', i) for i in ('xj-3', 'w1')}
        out = self.decide('/api/xunji/remap')
        self.assertEqual(out, {'remapped': ['xj-1', 'xj-2']})
        w1, w2 = self.doc('workouts', 'xj-1'), self.doc('workouts', 'xj-2')
        self.assertEqual((w1['planDayId'], w1['exercises'][0]['target'], 'target' in w1['exercises'][1]), ('A', '4×6–8 · RPE 8 · 休息 120s', False))
        self.assertEqual((w2['planDayId'], w2['exercises'][0]['target']), ('B', '3×10 · 40kg'))
        self.assertEqual((w1['needsReview'], w1['review']['comment'], w1['xunjiHash']), (False, '稳', 'r1:abc'))
        self.assertEqual({i: self.env('workouts', i) for i in ('xj-3', 'w1')}, before)
        self.assertEqual(self.decide('/api/xunji/remap'), {'remapped': []})                 # nothing left to change
        self.assertEqual(self.xj.calls, [])                                                   # 训记 is never asked


class CliSide(Base):
    """bin/lsj pending and bin/xunji templates-mutate --propose against this server (LSJ_CONFIG points at it)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.mkdtemp(prefix='lsj-agent-')
        cls.cfg = os.path.join(cls.tmp, 'config.json')
        with open(cls.cfg, 'w') as f:
            json.dump({'url': cls.live.base, 'token': SERVICE_TOKEN}, f)
        cls.old_cfg = os.environ.get('LSJ_CONFIG')
        os.environ['LSJ_CONFIG'] = cls.cfg
        cls.L = load_module('lsj_agent_test', os.path.join(REPO, 'bin', 'lsj'))
        cls.X = load_module('xunji_agent_test', os.path.join(REPO, 'bin', 'xunji'))
        cls.X.KEYS = os.path.join(cls.tmp, 'no-such-xunji.json')     # never the real key file
        cls.X.CACHE = os.path.join(cls.tmp, 'cache')
        cls.X.movement_names = lambda: ['哑铃卧推', '高位下拉']

    @classmethod
    def tearDownClass(cls):
        if cls.old_cfg is None:
            os.environ.pop('LSJ_CONFIG', None)
        else:
            os.environ['LSJ_CONFIG'] = cls.old_cfg
        super().tearDownClass()

    def xunji(self, *argv):
        """bin/xunji's main(): (exit code, stdout, stderr)."""
        o, e, old = io.StringIO(), io.StringIO(), sys.argv
        sys.argv = ['xunji', *argv]
        try:
            with contextlib.redirect_stdout(o), contextlib.redirect_stderr(e):
                self.X.main()
            code = 0
        except SystemExit as x:
            code = x.code if isinstance(x.code, int) else 1
        finally:
            sys.argv = old
        return code, o.getvalue(), e.getvalue()

    def mutation_file(self, mutation=None, name='mut.json'):
        path = os.path.join(self.tmp, name)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(MUT if mutation is None else mutation, f, ensure_ascii=False)
        return path

    def test_pending_has_what_the_person_left_for_claude(self):
        self.put('messages', 'm1', {'text': '左膝有点疼', 'status': 'new', 'needsReview': True, 'createdAt': '2026-10-16T01:00:00Z'})
        self.put('messages', 'm0', {'text': '旧的', 'status': 'done', 'needsReview': False, 'createdAt': '2026-10-15T01:00:00Z'})
        self.put('inbox', 'p1', {**plan_proposal([]), 'status': 'accepted', 'needsReview': True})
        self.put('inbox', 'p2', plan_proposal([]))
        self.put('meta', 'memory', {'items': [{'id': 'k1', 'text': '午饭常点外卖', 'kind': 'food', 'by': 'claude', 'at': 'x'}]})
        client = self.L.Client.from_config()
        p = self.L.pending_for(client.for_user('admin'))
        self.assertEqual(([d['id'] for d in p['messages']], [d['id'] for d in p['inbox']]), (['m1'], ['p1']))
        self.assertEqual((p['memory']['items'][0]['text'], p['autonomy']), ('午饭常点外卖', 'small'))
        self.put('profile', 'prefs', {'autonomy': 'ask'})
        self.assertEqual(self.L.pending_for(client.for_user('admin'))['autonomy'], 'ask')
        self.put('profile', 'prefs', {'autonomy': 'everything'})
        p = self.L.pending_for(client.for_user('admin'))
        self.assertEqual(p['autonomy'], 'small')
        self.cli.req('DELETE', '/api/d/meta/memory')
        self.assertIsNone(self.L.pending_for(client.for_user('admin'))['memory'])

    def test_propose_then_accept_on_the_page(self):
        self.put('plan', 'current', copy.deepcopy(PLAN))
        self.put('inbox', 'old-x', xunji_proposal(title='旧的模版提案'))
        self.put('inbox', 'p1', plan_proposal([]))
        code, out, err = self.xunji('templates-mutate', self.mutation_file(), '-u', 'admin', '--propose', '--title', '把 2 个训练日写进训记',
                                    '--why', '计划改了', '--days', '{"lsj-a": "A", "t-200": "B"}')
        self.assertEqual(code, 0, err)
        res = json.loads(out)
        self.assertEqual((res['user'], res['stale']), ('admin', ['old-x']))
        self.assertRegex(res['inbox'], r'^tpl-\d{8}-\d{6}-[0-9a-f]{4}$')
        self.assertIn('新建模版「胸 三头」：1 个动作', err)
        doc = self.doc('inbox', res['inbox'])
        self.assertEqual((doc['kind'], doc['status'], doc['by'], doc['mutation'], doc['days'], doc['needsReview']),
                         ('xunji', 'open', 'claude', MUT, {'lsj-a': 'A', 't-200': 'B'}, False))
        self.assertEqual(doc['summary'][0], '新建模版「胸 三头」：1 个动作')
        self.assertEqual((self.doc('inbox', 'old-x')['status'], self.doc('inbox', 'old-x')['replacedBy']), ('stale', res['inbox']))
        self.assertEqual(self.doc('inbox', 'p1')['status'], 'open')
        self.assertEqual(self.xj.calls, [])                                                   # nothing sent to 训记 yet
        self.S.save_xunji_key(self.uid, TPL_KEY, 'template')
        self.decide(f'/api/inbox/{res["inbox"]}/accept')
        self.assertEqual(self.doc('meta', 'xunji')['templatesState']['A']['template_id'], 't-101')
        self.assertEqual(self.decide('/api/inbox/old-x/accept', status=409)['error']['code'], 'not_open')

    def test_propose_refuses(self):
        self.put('plan', 'current', copy.deepcopy(PLAN))
        bad = copy.deepcopy(MUT)
        bad['upserts'][0]['movements'][0]['name'] = '飞鸟夹胸神器'
        good = ('--title', 't', '--why', 'w')
        for argv in ((self.mutation_file(bad, 'bad.json'), '--propose', *good),                         # not an official movement name
                     (self.mutation_file(), '--propose', '--why', 'w'),                     # no title
                     (self.mutation_file(), '--propose', '--title', '一' * 25, '--why', 'w'),
                     (self.mutation_file(), '--propose', *good, '--confirmed'),
                     (self.mutation_file(), '--propose', *good, '--days', '{"lsj-x": "A"}'),   # no such upsert
                     (self.mutation_file(), '--propose', *good, '--days', '{"lsj-a": "Z"}'),   # no such plan day
                     (self.mutation_file(), '--propose', *good, '--days', '["A"]'),
                     (self.mutation_file(), *good)):                                          # --title without --propose
            code, _, err = self.xunji('templates-mutate', *argv, '-u', 'admin')
            self.assertEqual(code, 1, (argv, err))
        self.put('meta', 'xunji', {'templates': 'declined'})
        code, _, err = self.xunji('templates-mutate', self.mutation_file(), '--propose', *good, '-u', 'admin')
        self.assertEqual(code, 1)
        self.assertIn('declined', err)
        self.assertEqual(self.cli.req('GET', '/api/c/inbox')[1]['docs'], [])


class MutationCheck(unittest.TestCase):
    def setUp(self):
        self.xi = server_module().xj        # app/xunji_import.py, as the server imports it

    def test_limits_and_names(self):
        lines, problems = self.xi.summarize_mutation(MUT)
        self.assertEqual(problems, [])
        self.assertEqual(lines[0], '新建模版「胸 三头」：1 个动作')
        self.assertIn('更新模版「背 二头」：1 个动作', lines)
        self.assertEqual(lines[-1], '删除模版 t-300')
        self.assertEqual(self.xi.summarize_mutation(MUT, {'哑铃卧推'})[1], ['「高位下拉」不是训记官方动作名，用 xunji movements 查正确写法'])
        many = {'upserts': [{'name': f'模版 {i}', 'movements': []} for i in range(15)]}
        self.assertEqual(self.xi.summarize_mutation(many)[1], ['一次最多 14 个模版，这里有 15 个'])
        for body in ([], {'upserts': 'x'}, {'upserts': [3]}, {'upserts': [{'name': 'a', 'movements': [5]}]}, {'folder_update': {'name': '文件夹/1'}}):
            self.assertTrue(self.xi.summarize_mutation(body)[1], body)
        self.assertEqual(self.xi.mutation_id('x1', MUT), self.xi.mutation_id('x1', json.loads(json.dumps(MUT))))
        self.assertNotEqual(self.xi.mutation_id('x1', MUT), self.xi.mutation_id('x2', MUT))

    def test_folder_shapes(self):
        A = self.xi.agent_templates
        self.assertEqual(A({'res': {'templates': [{'template_id': 1, 'name': 'a', 'base_version': 2, 'movements': [{'name': 'm'}]}]}}),
                         [{'template_id': 1, 'name': 'a', 'version': 2}])
        self.assertEqual(A({'res': {'folder': {'templates': {'t1': {'name': 'a'}, 't2': {'title': 'b', 'version': 4}}}}}),
                         [{'template_id': 't1', 'name': 'a'}, {'template_id': 't2', 'name': 'b', 'version': 4}])
        self.assertEqual(A({'res': {'agent_templates': [{'x': 'y' * 100, 'n': [1]}]}}), [{'x': 'y' * 60}])
        self.assertIsNone(A({'res': {'nothing': 1}}))
        self.assertEqual(self.xi.created_ids({'res': [{'client_id': 'c', 'template_id': 9}, {'client_id': 'd'}]}), {'c': 9})


if __name__ == '__main__':
    unittest.main()

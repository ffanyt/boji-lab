"""训记 → 薄肌研究所: how a 训记 session becomes a workout, the checks on an Agent template change, and the HTTP calls to 训记.

Shared by app/server.py (the page's 「从训记同步」 and 「写进训记」) and bin/xunji (Claude's sync, with its day cache and
deletion safety, and template proposals). Standard library only. Keys are passed in and never logged or put into an
error message.
"""
import datetime as dt
import gzip
import hashlib
import http.client
import json
import math
import re
import socket
import time
import urllib.error
import urllib.request

TRAINS = 'https://trains.xunjiapp.cn'
API = 'https://api.xunjiapp.cn'
AGENT_SYNC = TRAINS + '/api_agent_templates_sync_for_llm_v2'      # read the Agent template folder (template key)
AGENT_MUTATE = TRAINS + '/api_agent_templates_mutate_for_llm_v1'  # change it (template key)
DAY_START_HOUR = 5      # default day start: a session started before 05:00 belongs to the day before
HASH_PREFIX = 'r1:'     # xunjiHash = hash of the raw 训记 session (older imports hashed the mapped workout)
OPTIONAL_MAPPED = ('kcal', 'heartRate')  # fields map_train leaves out when 训记 has nothing for them


class XunjiError(Exception):
    """A failed 训记 call. kind: network | timeout | busy (rate limited) | invalid_key | vip | http | bad_response."""

    def __init__(self, kind, message, status=None):
        super().__init__(message)
        self.kind, self.status = kind, status


def tz_of(name):
    """A tzinfo for a zone name such as the server's LSJ_TZ; None (this computer's zone) when missing or unknown."""
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:  # ImportError, ZoneInfoNotFoundError, ValueError
        return None


# ---------------------------------------------------------------- HTTP

def _http(url, data, headers, timeout):
    """(status, raw body). Raises urllib / socket errors when 训记 can't be reached. Tests replace this."""
    req = urllib.request.Request(url, data=data, method='POST', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def post(url, body, key, timeout=40, max_wait=60, on_wait=None):
    """POST to 训记 and return the JSON answer. When 训记 says "too frequent", wait as long as it asks and retry once,
    unless that wait is longer than max_wait seconds (then XunjiError busy). on_wait(seconds) is told about the wait."""
    for attempt in (1, 2):
        try:
            status, raw = _http(url, json.dumps(body, ensure_ascii=False).encode(), {
                'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip'}, timeout)
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as e:  # includes timeouts
            reason = getattr(e, 'reason', None)
            slow = isinstance(e, socket.timeout) or isinstance(reason, socket.timeout)
            raise XunjiError('timeout' if slow else 'network', f'cannot reach 训记: {reason or e.__class__.__name__}')
        try:
            if raw[:2] == b'\x1f\x8b':
                raw = gzip.decompress(raw)
        except (OSError, EOFError):
            raise XunjiError('bad_response', '训记 sent a broken gzip response')
        text = raw.decode(errors='replace')
        try:
            data = json.loads(text)
        except ValueError:
            data = {'raw': text[:500]}
        if 'too frequent' in text:
            if attempt == 2:
                raise XunjiError('busy', '训记 kept rate-limiting')
            res = data.get('res') if isinstance(data, dict) else None
            ms = num(data.get('retry_after_ms') or (res.get('retry_after_ms') if isinstance(res, dict) else None)) if isinstance(data, dict) else None
            wait = min((ms or 16000) / 1000, 60)
            if wait > max_wait:
                raise XunjiError('busy', f'训记 rate limit (asks to wait {wait:.0f}s)')
            if on_wait:
                on_wait(wait)
            time.sleep(wait + 0.5)
            continue
        if status != 200 or (isinstance(data, dict) and data.get('success') is False):
            msg, kind = text[:400], 'http'
            if 'apikey' in text:
                msg, kind = msg + '\n→ 训记 key missing or invalid: ask the user to re-apply in the 训记 app and send the new skill file.', 'invalid_key'
            elif 'VIP' in text:
                msg, kind = msg + '\n→ this 训记 account needs a membership for the open API.', 'vip'
            raise XunjiError(kind, f'训记 HTTP {status}: {msg}', status)
        return data
    raise XunjiError('busy', '训记 kept rate-limiting')  # not reached


def trains_request(date, full):
    return {'schema_version': 'train_open_api_v2', 'datestr': date, 'include_full_data': full}


def trains_from(data, date):
    """res.trains of a 训记 answer. Anything else is an error, never "no sessions that day"."""
    res = data.get('res') if isinstance(data, dict) else None
    trains = res.get('trains') if isinstance(res, dict) else None
    if not isinstance(trains, list) or not all(isinstance(t, dict) for t in trains):
        shape = sorted(res) if isinstance(res, dict) else type(res).__name__
        raise XunjiError('bad_response', f'训记 answered {date} without a trains list (res: {shape})')
    return trains


def fetch_trains(key, date, full, timeout=40, max_wait=60, on_wait=None):
    """One day of sessions from 训记 (network): the light list, or full detail."""
    return trains_from(post(TRAINS + '/api_trains_for_llm_v2', trains_request(date, full), key, timeout, max_wait, on_wait), date)


def read_agent_templates(key, timeout=40, max_wait=60, on_wait=None):
    """The whole Agent template folder (network, template key): 训记's answer as it is."""
    return post(AGENT_SYNC, {'template_versions': {}}, key, timeout, max_wait, on_wait)


def mutation_id(ref, mutation):
    """A stable id for one submission of a mutation: 训记 can tell a retry from a new change."""
    raw = str(ref) + json.dumps(mutation, sort_keys=True, ensure_ascii=False)
    return 'lsj-' + hashlib.sha256(raw.encode('utf-8', 'surrogatepass')).hexdigest()[:20]


def mutate_agent_templates(key, mutation, mid, timeout=40, max_wait=60, on_wait=None):
    """Send a checked mutation to 训记 (network, template key), confirmed. Raises XunjiError when 训记 refuses it."""
    body = {k: v for k, v in mutation.items() if k not in ('confirmed', 'mutation_id')}
    body.update(confirmed=True, mutation_id=mid)
    return post(AGENT_MUTATE, body, key, timeout, max_wait, on_wait)


# ---------------------------------------------------------------- Agent templates

NAME_RE = re.compile(r'[一-鿿A-Za-z0-9 ]+')  # template and folder names (fullmatch)
MAX_TEMPLATES, MAX_MOVEMENTS, MAX_SETS = 14, 15, 20


def summarize_mutation(body, official=None):
    """(summary lines, problems) for an Agent template mutation {upserts, deletes, folder_update?}. Problems are the
    limits 训记 sets: names in 中文 / letters / digits / spaces, at most 14 templates, 15 movements each, 20 sets each.
    official: 训记's official movement names to check against; None skips that check (the server does: Claude checked
    the names with bin/xunji when it made the proposal)."""
    lines, problems = [], []
    if not isinstance(body, dict):
        return lines, ['模版改动的格式不对：要是一个 JSON 对象']
    fu = body.get('folder_update')
    if fu:
        name = str(fu.get('name', '')) if isinstance(fu, dict) else ''
        lines.append(f'文件夹改名为「{name}」')
        if not NAME_RE.fullmatch(name) or len(name) > 32:
            problems.append('文件夹名只能用中文、英文字母、数字和空格，最多 32 个字符')
    ups, dels = body.get('upserts') or [], body.get('deletes') or []
    if not isinstance(ups, list) or not isinstance(dels, list):
        return lines, problems + ['模版改动的格式不对：upserts 和 deletes 要是列表']
    if not (ups or dels or fu):
        problems.append('这次没有要改的模版')
    if len(ups) > MAX_TEMPLATES:
        problems.append(f'一次最多 {MAX_TEMPLATES} 个模版，这里有 {len(ups)} 个')
    for u in ups:
        if not isinstance(u, dict):
            problems.append('有一个模版的格式不对')
            continue
        mv = u.get('movements') or []
        if not isinstance(mv, list):
            problems.append(f'「{u.get("name")}」的动作要是列表')
            mv = []
        kind = '更新' if u.get('template_id') else '新建'
        lines.append(f'{kind}模版「{u.get("name")}」：{len(mv)} 个动作')
        if not NAME_RE.fullmatch(str(u.get('name', ''))):
            problems.append(f'模版名「{u.get("name")}」含有不允许的字符')
        if len(mv) > MAX_MOVEMENTS:
            problems.append(f'「{u.get("name")}」超过 {MAX_MOVEMENTS} 个动作')
        for m in mv:
            if not isinstance(m, dict):
                problems.append(f'「{u.get("name")}」里有一个动作的格式不对')
                continue
            sets = m.get('sets') or []
            if not isinstance(sets, list):
                problems.append(f'{m.get("name")} 的组要是列表')
                sets = []
            first = sets[0] if sets and isinstance(sets[0], dict) else {}
            prog = m.get('progression') if isinstance(m.get('progression'), dict) else None
            load = '自重' if first.get('selfWeight') else (f'{first["weight"]}{first.get("unit", "kg")}' if 'weight' in first else '重量第一次自己填')
            desc = f'  · {m.get("name")}：{len(sets)} 组，{load} × {first.get("reps", "")}'
            if prog:
                desc += (f'（递增：每次 +{prog.get("reps_increment")} 次到 {prog.get("target_reps")} 次后，'
                         f'加 {prog.get("weight_increment")}kg 并回到 {prog.get("reset_reps")} 次）')
            lines.append(desc)
            if len(sets) > MAX_SETS:
                problems.append(f'{m.get("name")} 超过 {MAX_SETS} 组')
            if official is not None and m.get('name') not in official:
                problems.append(f'「{m.get("name")}」不是训记官方动作名，用 xunji movements 查正确写法')
    for d in dels:
        lines.append(f'删除模版 {d.get("template_id", d) if isinstance(d, dict) else d}')
    return lines, problems


def _scalar(v):
    return v is None or isinstance(v, (str, int, float, bool))


def _walk(data, limit=2000):
    """(key it sits under, value) for everything in a JSON answer, breadth first, at most `limit` values."""
    queue, n = [(None, data)], 0
    while queue and n < limit:
        key, v = queue.pop(0)
        n += 1
        yield key, v
        if isinstance(v, dict):
            queue.extend(v.items())
        elif isinstance(v, list):
            queue.extend((key, x) for x in v)


def _template_item(x, tid=None):
    """One template as {template_id, name, version?, client_id?}; one without an id or a name keeps its short fields."""
    tid = next((x[k] for k in ('template_id', 'templateId', 'id') if _scalar(x.get(k)) and x.get(k) is not None), tid)
    name = next((x[k] for k in ('name', 'title', 'template_name') if isinstance(x.get(k), str)), None)
    ver = next((x[k] for k in ('version', 'base_version', 'template_version') if _scalar(x.get(k)) and x.get(k) is not None), None)
    if tid is None and name is None:
        return {k: (v[:60] if isinstance(v, str) else v) for k, v in list(x.items())[:8] if _scalar(v)}
    out = {'template_id': tid, 'name': name}
    if ver is not None:
        out['version'] = ver
    if isinstance(x.get('client_id'), str):
        out['client_id'] = x['client_id']
    return out


def agent_templates(data):
    """The templates in an Agent folder answer as [{template_id, name, version?}], or None when none can be found.
    训记's exact shape isn't written down here, so this is lenient: the first list of objects that carry a template_id;
    else the first list (or id-keyed object) of objects under a key that mentions "template"."""
    root = data.get('res', data) if isinstance(data, dict) else data
    found = None
    for _, v in _walk(root):
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v) and any('template_id' in x or 'templateId' in x for x in v):
            found = [_template_item(x) for x in v]
            break
    if found is None:
        for key, v in _walk(root):
            if not (isinstance(key, str) and 'template' in key.lower()):
                continue
            if isinstance(v, list) and all(isinstance(x, dict) for x in v):
                found = [_template_item(x) for x in v]
                break
            if isinstance(v, dict) and v and all(isinstance(x, dict) for x in v.values()):
                found = [_template_item(x, k) for k, x in v.items()]
                break
    return found[:50] if found is not None else None


def created_ids(data):
    """{client_id: template_id} for the templates a mutation answer says it created (when it says so)."""
    out = {}
    for _, v in _walk(data):
        if isinstance(v, dict) and isinstance(v.get('client_id'), str):
            tid = v.get('template_id', v.get('templateId', v.get('id')))
            if _scalar(tid) and tid is not None:
                out[v['client_id']] = tid
    return out


# ---------------------------------------------------------------- mapping

def num(v):
    """A finite number from 训记's strings, or None."""
    if isinstance(v, bool):
        return None
    try:
        f = float(str(v).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return int(f) if f.is_integer() else round(f, 2)


def to_kg(weight, unit):
    w = num(weight)
    if w is None:
        return None
    return round(w * 0.45359, 1) if str(unit).lower() in ('lb', 'lbs', '磅') else w


# 训记 movement types (movements[].exetype) and what a set's weight means for each:
#   '' / 'weight'   the weight lifted                         → kg
#   'plus_weight'   bodyweight plus optional added weight     → bodyweight: true, kg = added weight or None
#   'times'         bodyweight, reps only                     → bodyweight: true, kg = weight if any, else None
#   'help'          machine-assisted bodyweight (counterweight) → bodyweight: true, assist = counterweight, kg None
#   'cardio'        an Apple Health workout with metrics      → exercise {cardio: true, metrics}, no sets
BODYWEIGHT_TYPES = ('plus_weight', 'times')


def map_set(s, exetype=''):
    kg = to_kg(s.get('weight', s.get('weight_kg')), s.get('unit') or 'kg')
    out = {'kg': kg, 'reps': num(s.get('reps')), 'done': bool(s.get('done'))}
    if exetype == 'help':  # the weight is the assistance: more of it means an easier set
        out['kg'] = None
        out['bodyweight'] = True
        if kg:
            out['assist'] = kg
    elif s.get('selfWeight') or exetype in BODYWEIGHT_TYPES:
        out['bodyweight'] = True
        out['kg'] = kg or None  # added weight (dip belt, vest); 0 means none
    if s.get('setType') == '热':
        out['warmup'] = True
    if num(s.get('rpe')) is not None:
        out['rpe'] = num(s.get('rpe'))
    if out['reps'] is None and num(s.get('time')):
        out['sec'] = num(s.get('time'))  # timed set (plank and the like)
    if s.get('note') or s.get('comment'):
        out['note'] = ' '.join(x for x in (s.get('note'), s.get('comment')) if x)
    return out


def parse_note(note):
    if isinstance(note, str) and note.strip().startswith('{'):
        try:
            note = json.loads(note)
        except ValueError:
            pass
    text, kcal = '', None
    if isinstance(note, dict):
        text = str(note.get('text') or '')
        kcal = num(note.get('calorie'))
    elif isinstance(note, str):
        m = re.search(r'calorie[:：]\s*(\d+(?:\.\d+)?)', note)
        kcal = num(m.group(1)) if m else None
        text = re.sub(r'calorie[:：]\s*\d+(?:\.\d+)?', '', note).strip(' ,;，；')
    return text, kcal


def local_time(ms, tz=None):
    """A 训记 timestamp (ms) as a datetime in tz (None: this computer's zone), or None when it isn't one."""
    try:
        return dt.datetime.fromtimestamp(ms / 1000, tz)
    except (OverflowError, ValueError, OSError, TypeError):
        return None


def session_date(t, tz=None, day_start=DAY_START_HOUR):
    """训记's calendar date, moved back a day for a session started before the day start (in tz; None = this computer's)."""
    ds, start = t.get('datestr'), num(t.get('start'))
    st = local_time(start, tz) if ds and start else None
    if st and st.date().isoformat() == ds and st.hour < day_start:
        return (st.date() - dt.timedelta(days=1)).isoformat()
    return ds


def plan_targets(plan, day_id):
    """{exercise name: "4×8–12 · 22.5kg · 休息 150s"} for one plan day."""
    for d in ((plan or {}).get('training') or {}).get('days') or []:
        if isinstance(d, dict) and d.get('id') == day_id:
            return {x['name']: ' · '.join(str(v) for v in (f"{x.get('sets', '')}×{x.get('reps', '')}", x.get('load'),
                                                              f"休息 {x['rest']}" if x.get('rest') else None) if v)
                    for x in d.get('exercises') or [] if isinstance(x, dict) and x.get('name')}
    return {}


def session_targets(date, day_id, plan, prev):
    """Targets for a session's exercises. Sessions since the current plan was written get its targets; older ones keep
    what they were imported with (any plan edit moves plan.updatedAt, so recomputing them would wipe them)."""
    if not day_id:
        return {}
    if (date or '') >= ((plan or {}).get('updatedAt') or '9999')[:10]:
        return plan_targets(plan, day_id)
    if (prev or {}).get('planDayId') != day_id:
        return {}
    return {e.get('name'): e.get('target') for e in (prev or {}).get('exercises') or []
            if isinstance(e, dict) and e.get('target')}


def plan_day_of(t, day_map, prev):
    """The plan day: what the person picked on the page (mine.planDayId; "" = trained, not a plan day), else dayMap."""
    mine = (prev or {}).get('mine')
    if isinstance(mine, dict) and isinstance(mine.get('planDayId'), str):
        return mine['planDayId'] or None
    return (day_map or {}).get((t.get('title') or '').strip())


def remap(old, day_map, plan):
    """An imported workout's plan day and targets worked out again from what is stored, without asking 训记: the same
    rules as map_train (mine.planDayId, else dayMap by its title; session_targets). Returns the changed fields
    {planDayId, exercises}, or None when nothing would change."""
    day_id = plan_day_of({'title': old.get('title')}, day_map, old)
    targets = session_targets(old.get('date'), day_id, plan, old)
    before = old.get('exercises') if isinstance(old.get('exercises'), list) else []
    exercises = [{**e, 'target': targets.get(e.get('name'), '')} if isinstance(e, dict) and 'target' in e else e for e in before]
    if day_id == old.get('planDayId') and exercises == before:
        return None
    return {'planDayId': day_id, 'exercises': exercises}


def map_train(t, day_map=None, plan=None, prev=None, tz=None, day_start=DAY_START_HOUR):
    """A 训记 session as a 薄肌研究所 workout. prev: the workout already imported for it, if any."""
    exercises, by_name = [], {}
    date = session_date(t, tz, day_start)
    day_id = plan_day_of(t, day_map, prev)
    targets = session_targets(date, day_id, plan, prev)

    def ex_for(name, m):
        if name not in by_name:
            by_name[name] = {'name': name, 'target': targets.get(name, ''), 'restSec': num(m.get('restTime')) or None, 'sets': []}
            if m.get('difficulty'):
                by_name[name]['difficulty'] = m['difficulty']
            exercises.append(by_name[name])
        return by_name[name]

    for m in t.get('movements') or []:
        name = (m.get('name') or '').strip() or '未命名动作'
        etype = str(m.get('exetype') or '')
        if m.get('cardio') or (m.get('metrics') and not m.get('sets')):
            exercises.append({'name': name, 'cardio': True, 'metrics': m.get('metrics') or {}, 'sets': []})
            continue
        for s in m.get('sets') or []:
            if s.get('items'):  # a superset round: each item is one set of its own movement
                for it in s['items']:
                    ex_for((it.get('name') or name).strip(), m)['sets'].append(
                        {**map_set(it.get('set') or {}, str(it.get('exetype') or etype)), 'superset': name})
                continue
            if (s.get('metrics') or etype == 'cardio') and not (num(s.get('reps')) or num(s.get('weight'))):
                e = ex_for(name, m)
                e['cardio'] = True
                e['metrics'] = s.get('metrics') or e.get('metrics') or {}
                continue
            ex = ex_for(name, m)
            ex['sets'].append(map_set(s, etype))
            for drop in s.get('dropSets') or []:  # 训记 keeps no done flag on drop sets: they share the parent's
                ex['sets'].append({**map_set(drop, etype), 'drop': True, 'done': bool(s.get('done'))})
    text, kcal = parse_note(t.get('note'))
    start, end = num(t.get('start')), num(t.get('end'))
    hr = t.get('heartRate') or {}
    doc = {
        'date': date, 'source': 'xunji', 'title': t.get('title') or '训练', 'planDayId': day_id,
        'exercises': exercises, 'durationMin': round((end - start) / 60000) if start and end and end > start else None,
        'rpe': None, 'feelings': [], 'notes': text, 'photos': [],
        'xunji': {'localid': t.get('localid'), 'day': t.get('datestr'), 'start': start, 'end': end},
    }
    if kcal:
        doc['kcal'] = kcal
    if isinstance(hr, dict) and hr.get('avg'):
        doc['heartRate'] = {k: hr.get(k) for k in ('avg', 'max', 'min') if hr.get(k) is not None}
    return doc


def content_hash(obj):
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


def xunji_hash(t):
    """The change marker: the raw 训记 session only, so plan or dayMap edits never look like a 训记 edit."""
    return HASH_PREFIX + content_hash(t)


def iso_ms(ms):
    st = local_time(ms, dt.timezone.utc) if ms else None
    return st.isoformat(timespec='seconds').replace('+00:00', 'Z') if st else None


def merge_session(t, cur, day_map, plan, fresh, now_iso, tz=None, day_start=DAY_START_HOUR):
    """One 训记 session against the workout already imported for it (cur: the stored record, or None).
    Returns (body, change, label); body is None when nothing would change. change: "new"; "updated" = 训记's content
    changed, which asks for a (new) review when `fresh`; "remapped" = only the plan, dayMap, mine or the mapping changed,
    so the record is rewritten without asking again. review, answer, mine and anything else on the record are kept."""
    old = (cur or {}).get('data') or {}
    doc = map_train(t, day_map, plan, old, tz, day_start)
    h = xunji_hash(t)
    old_hash = old.get('xunjiHash')
    # Imports from before the raw hash existed count as unchanged: nothing tells what changed in 训记.
    edited = cur is None or (isinstance(old_hash, str) and old_hash.startswith(HASH_PREFIX) and old_hash != h)
    body = {k: v for k, v in old.items() if k not in OPTIONAL_MAPPED}
    body.update(doc)
    body['xunjiHash'] = h
    body['createdAt'] = old.get('createdAt') or iso_ms(doc['xunji']['start']) or now_iso
    body['needsReview'] = (fresh or bool(old.get('needsReview'))) if edited else bool(old.get('needsReview'))
    if cur and {k: v for k, v in body.items() if k != 'updatedAt'} == {k: v for k, v in old.items() if k != 'updatedAt'}:
        return None, None, None
    body['updatedAt'] = now_iso
    label = f'{doc["date"]} {doc["title"]}{"" if fresh else "（历史）"}'
    if cur and old.get('date') != doc['date']:
        label += f'（从 {old.get("date")} 移过来）'
    return body, ('updated' if cur and edited else 'remapped' if cur else 'new'), label

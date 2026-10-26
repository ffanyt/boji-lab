/* 薄肌研究所 · 数据 tab (v9): 本周 against last week with the latest weekly report (above the table Monday to Wednesday,
   under it after), one 7 / 30 / 90-day range, and six cards: 身体变化 (体重 with its weekly rate under the chart / 围度和体脂
   / 身材照, one switch), 睡眠和恢复 (sleep; resting HR and HRV as two numbers when 进阶显示 is on), 活动, 饮食, 训练, and
   报告 (every daily / weekly / plan report, opened in app.js's one report sheet, A.openReport). Each card's head is its
   name and a 「?」 (what the numbers are, with this person's own); then the big number and verdict, Claude's line
   (meta/insights), the charts. 动作详情 is the one sheet for an exercise (trend, every session, Claude's advice, the
   plan's line). With 进阶显示 off (profile/prefs.advanced, see advOn) there is no e1RM anywhere here: an exercise is
   followed by its heaviest set. window.LSJData.prs() gives app.js the personal records; exRows() gives its 训练历史
   the exercises.
   A pure render from the page's state, which app.js shares as window.LSJ, counted the way CLAUDE.md 「口径」 says:
   health.ignore, cleared sleep nights and cleared weights are missing data everywhere. */
(() => {
'use strict';

/* ---------- app.js state and helpers ---------- */
let A = null, S = null;
function bind() {
  const L = window.LSJ && window.LSJ.S ? window.LSJ : window.S && window.S.loaded ? window : null;
  A = L; S = L ? L.S : null;
  return !!S;
}
const has = k => typeof A?.[k] === 'function';
/* 进阶显示 (profile/prefs.advanced): app.js's answer when it has one; else the pref when it is set; else on for
   someone who said they have trained before (profile.level some / adv), off for a beginner or no answer. Off: no e1RM
   (the heaviest set instead), and the sleep card has no resting HR / HRV. */
function advOn() {
  if (has('advanced')) { try { return !!A.advanced(); } catch (e) { console.error(e); } }
  const p = has('prefs') ? A.prefs() : S?.prefs;
  if (typeof p?.advanced === 'boolean') return p.advanced;
  const lv = S?.profile?.level;
  return lv === 'some' || lv === 'adv';
}
// The person's "today" (their day start included); app.js knows it, this is only the fallback.
function tday() {
  if (has('today')) return A.today();
  const h = has('dayStartHour') ? A.dayStartHour() : 5, d = new Date();
  if (d.getHours() < h) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/* ---------- utils ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parseD = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const isoWd = s => parseD(s).getDay() || 7;
const monday = s => addDays(s, 1 - isoWd(s));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const median = xs => { const a = [...xs].sort((x, y) => x - y), n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const mean = xs => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
const f0 = n => Math.round(n).toLocaleString('en-US');
const f1 = n => (Math.round(n * 10) / 10).toFixed(1);
const f2 = n => (Math.round(n * 100) / 100).toFixed(2);
const kgTxt = n => String(Math.round(n * 100) / 100);
const sgn = (n, f = f1) => { const t = f(Math.abs(n)); return (/[1-9]/.test(t) ? (n > 0 ? '+' : '-') : '±') + t; };
const kTick = v => Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(+v.toFixed(2));
const WD = '日一二三四五六';
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const mdw = d => `${md(d)}（周${WD[parseD(d).getDay()]}）`;
const mdW = d => `${md(d)} 周${WD[parseD(d).getDay()]}`;  // short, for a narrow picker
const hmm = m => { const r = Math.round(m); return `${Math.floor(r / 60)}:${pad(r % 60)}`; };
const clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m) % 60)}`;
// "02:30" as minutes into the night: times before 15:00 count after midnight, so 23:40 < 02:30.
const nightMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); if (!m) return null; const h = +m[1]; return (h < 15 ? h + 24 : h) * 60 + +m[2]; };
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const LEVEL = ['good', 'ok', 'adjust'];

/* ---------- view state ---------- */
const RANGES = [7, 30, 90];
// The range the person picked, per account (one phone, several people); without a pick, 7 days while the daily data
// (weight, sleep, Apple Health, meals) is under two weeks old, else 30.
const rangeKey = () => 'lsj-data-range:' + (S?.me?.id || '');
function curRange() {
  const v = +lsGet(rangeKey());
  if (RANGES.includes(v)) return v;
  const f = firstDates(), daily = [f.weight, f.sleep, f.activity, f.diet].filter(Boolean).sort()[0];
  return !daily || daysBetween(daily, tday()) < 14 ? 7 : 30;
}

/* ---------- per-render memo ---------- */
let M = null;  // maps for one build: dayKind, intake, targets, baselines
const memo = (map, key, f) => { const m = M[map]; if (m.has(key)) return m.get(key); const v = f(); m.set(key, v); return v; };
function newMemo() { M = { kind: new Map(), it: new Map(), tg: new Map(), ab: new Map(), rb: new Map(), rf: new Map(), wts: null, ex: null, fd: null, cp: null }; }

const kindOf = d => memo('kind', d, () => has('dayKind') ? A.dayKind(d) : ownKind(d));
function ownKind(d) {
  const p = S.days[d]?.plan; if (typeof p === 'string' && p) return p;
  const w = S.workouts.filter(x => x.date === d); if (!w.length) return 'rest';
  return w.find(x => typeof x.planDayId === 'string' && x.planDayId)?.planDayId || 'train';
}
const isRest = d => kindOf(d) === 'rest';
const trainedOn = d => has('trainedOn') ? A.trainedOn(d) : S.workouts.some(w => w.date === d) || (typeof S.days[d]?.plan === 'string' && S.days[d].plan !== 'rest');
const planned = () => Object.values(S.plan?.training?.schedule || {}).filter(Boolean).length;

/* Health numbers: a metric the person marked 「这天不算」 (health.ignore) is missing. */
function hv(d, k) {
  const h = S.health[d]; if (!h || !isNum(h[k])) return null;
  return Array.isArray(h.ignore) && h.ignore.includes(k) ? null : h[k];
}
// Days the Watch was barely worn (activity < 100 kcal, or steps under 1000) are left out of the usual.
const worn = d => { const a = hv(d, 'activeKcal'), s = hv(d, 'steps'); return a != null && a >= 100 && !(s != null && s < 1000); };
// The usual active energy of d's kind of day: the median of the same kind of day over the 28 days before d (4+ days).
function actBase(d, rest = isRest(d)) {
  return memo('ab', d + rest, () => {
    const xs = [];
    for (let i = 1; i <= 28; i++) { const x = addDays(d, -i); if (worn(x) && isRest(x) === rest) xs.push(hv(x, 'activeKcal')); }
    return xs.length >= 4 ? median(xs) : null;
  });
}
function bonusOf(d) {
  const a = hv(d, 'activeKcal'), b = actBase(d); if (a == null || b == null) return 0;
  const extra = a - b;
  return extra < 150 ? 0 : Math.round(Math.min(600, extra * 0.75) / 10) * 10;
}
// Recovery: resting HR 5+ over its usual, or the 3-day HRV mean at or under 85% of its usual, the same signal on d and d−1.
const recBase = (d, k) => memo('rb', d + k, () => {
  const xs = []; for (let i = 1; i <= 28; i++) { const v = hv(addDays(d, -i), k); if (v != null) xs.push(v); }
  return xs.length >= 14 ? median(xs) : null;
});
const hrv3 = d => mean([0, 1, 2].map(i => hv(addDays(d, -i), 'hrv')).filter(v => v != null));
const rhrFlag = d => memo('rf', 'r' + d, () => { const v = hv(d, 'restingHR'), b = recBase(d, 'restingHR'); return v != null && b != null && v - b >= 5; });
const hrvFlag = d => memo('rf', 'h' + d, () => { const m = hrv3(d), b = recBase(d, 'hrv'); return m != null && b != null && m <= 0.85 * b; });
function recOf(d) { const y = addDays(d, -1), rhr = rhrFlag(d) && rhrFlag(y), hrv = hrvFlag(d) && hrvFlag(y); return { rhr, hrv, warn: rhr || hrv }; }

/* Food: app.js's intake() and targetsFor() (the same numbers as the 今日 meters). */
const DRINK = { milk: { kcal: 65, protein: 3.2, carbs: 4.8, fat: 3.6 }, soy: { kcal: 31, protein: 3.0, carbs: 1.2, fat: 1.6 } };
const waterOf = d => (has('waterDay') ? A.waterDay(d) : S.water[d]) || { entries: [] };
function ownIntake(d) {  // the intake rule (manual, else Claude's review, else the quick items) when app.js has none
  const meals = S.meals.filter(m => m.date === d), sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let waiting = 0, logged = 0;
  for (const m of meals) {
    const q = Array.isArray(m.quick) ? m.quick.filter(x => x && typeof x === 'object') : [];
    if (!isNum(m.manual?.kcal) && !isNum(m.review?.kcal) && !q.length) waiting++;  // no numbers yet
    if (!q.length || (m.photos || []).length) logged++;
    for (const k of Object.keys(sum)) {
      const v = isNum(m.manual?.[k]) ? m.manual[k] : isNum(m.review?.[k]) ? m.review[k] : q.reduce((s, x) => s + (isNum(x[k]) ? x[k] : 0), 0);
      sum[k] += v;
    }
  }
  const dr = { kcal: 0 };
  for (const e of waterOf(d).entries || []) {
    const x = DRINK[e.kind]; if (!x || !isNum(e.ml)) continue;
    for (const k of Object.keys(sum)) { sum[k] += e.ml / 100 * x[k]; if (k === 'kcal') dr.kcal += e.ml / 100 * x.kcal; }
  }
  return { meals, sum, waiting, logged, dr };
}
const intakeOf = d => memo('it', d, () => has('intake') ? A.intake(d) : ownIntake(d));
function targetOf(d) {
  return memo('tg', d, () => {
    if (has('targetsFor')) return A.targetsFor(d);
    const diet = S.plan?.diet; if (!diet || !isNum(diet.kcal)) return null;
    const rest = isRest(d) && !!diet.restDay, t = rest ? { ...diet, ...diet.restDay } : diet, b = bonusOf(d);
    return { kcal: t.kcal + b, protein: t.protein, rest, bonus: b };
  });
}
const anyFood = it => !!it && ((it.meals || []).length > 0 || (it.dr?.kcal || 0) > 0);
const partialDay = it => (it.logged ?? 2) < 2 || (it.waiting || 0) > 0;
function waterGoal() {
  if (has('waterTarget')) return A.waterTarget();
  if (isNum(S.plan?.diet?.water)) return S.plan.diet.water;
  const w = latestW() ?? S.profile?.weight;
  return isNum(w) ? Math.min(3500, Math.max(1500, Math.round(w * 35 / 100) * 100)) : 2000;
}
const waterTotal = d => (waterOf(d).entries || []).reduce((s, e) => s + (isNum(e.ml) ? e.ml : 0), 0);

/* Sleep: the night that ended on d. A cleared night is no data; without a night record, body.sleep (hours). */
function night(d) {
  const sl = S.sleep[d];
  if (sl && sl.cleared) return null;
  if (sl && isNum(sl.asleep) && sl.asleep > 0) return { d, min: sl.asleep, bed: sl.bedtime, wake: sl.wake, deep: sl.deep, rem: sl.rem, core: sl.core, src: sl.source };
  const b = S.body[d];
  return b && isNum(b.sleep) && b.sleep > 0 ? { d, min: b.sleep * 60, src: 'body' } : null;
}
/* Weight: weigh-ins with a number (a cleared one has weight null). */
function weighIns() {
  if (!M.wts) M.wts = Object.values(S.body).filter(b => isDate(b.date) && isNum(b.weight)).map(b => ({ d: b.date, w: b.weight })).sort((a, z) => a.d.localeCompare(z.d));
  return M.wts;
}
const latestW = () => { const w = weighIns(); return w.length ? w[w.length - 1].w : null; };
function weightAt(d) {  // the nearest weigh-in up to d, else the first one after it, else the profile's weight
  const w = weighIns(); let best = null;
  for (const p of w) { if (p.d <= d) best = p; else { if (!best) best = p; break; } }
  return best ? best.w : isNum(S.profile?.weight) ? S.profile.weight : null;
}
/* Where each card's data starts (and ends), over everything loaded. A card whose data covers less than half the range
   is drawn from its first day on (a week at least) and says so; a new account is not a row of empty charts. */
function firstDates() {
  if (M.fd) return M.fd;
  const span = xs => { const s = xs.filter(isDate).sort(); return s.length ? [s[0], s[s.length - 1]] : [null, null]; };
  const w = weighIns(), hd = Object.keys(S.health);
  const sl = span([...Object.keys(S.sleep).filter(d => night(d)), ...Object.values(S.body).filter(b => isDate(b.date) && isNum(b.sleep) && b.sleep > 0).map(b => b.date)]);
  const rc = span(hd.filter(d => hv(d, 'restingHR') != null || hv(d, 'hrv') != null));
  const ac = span(hd.filter(d => hv(d, 'steps') != null || hv(d, 'activeKcal') != null));
  const dt = span([...S.meals.map(m => m.date), ...Object.keys(S.water).filter(d => (waterOf(d).entries || []).some(e => DRINK[e?.kind] && isNum(e.ml)))]);
  const tr = span([...S.workouts.map(x => x.date), ...Object.keys(S.days).filter(d => typeof S.days[d]?.plan === 'string' && S.days[d].plan !== 'rest')]);
  const cp = comp(), bd = span(COMP.flatMap(([k]) => cp[k].map(p => p.d))), bf = span(cp.bodyFat.map(p => p.d));
  const wf = w.length ? w[0].d : null, wl = w.length ? w[w.length - 1].d : null;
  M.fd = { weight: wf, progress: wf, sleep: sl[0], recovery: rc[0], activity: ac[0], diet: dt[0], training: tr[0], body: bd[0], bodyFat: bf[0],
    last: { weight: wl, progress: wl, sleep: sl[1], recovery: rc[1], activity: ac[1], diet: dt[1], training: tr[1], body: bd[1], bodyFat: bf[1] } };
  return M.fd;
}
function ctxFor(base, key) {
  const from = firstDates()[key], latest = firstDates().last[key];
  const c = { ...base, from, latest };
  if (!from || from <= base.win[0]) return c;
  const span = daysBetween(from, base.t) + 1;
  if (span * 2 >= base.n) return c;
  const m = Math.max(7, span);
  return m >= base.n ? c : { ...c, n: m, win: base.win.slice(base.n - m), rl: `近 ${m} 天` };
}
// 「数据从 10/14 开始」 when the data starts after the start of the range picked.
const fromNote = c => c.from && c.from > c.r0 ? `<p class="dv-from">数据从 ${esc(md(c.from))} 开始</p>` : '';

// Weekly weight change in % per week: a straight line through the last 28 days of weigh-ins (6+ of them over 14+ days).
function rateAt(t) {
  const xs = weighIns().filter(p => p.d > addDays(t, -28) && p.d <= t);
  if (xs.length < 6 || daysBetween(xs[0].d, xs[xs.length - 1].d) < 14) return null;
  const X = xs.map(p => daysBetween(t, p.d)), Y = xs.map(p => p.w), mx = mean(X), my = mean(Y);
  let num = 0, den = 0; X.forEach((x, i) => { num += (x - mx) * (Y[i] - my); den += (x - mx) ** 2; });
  const kgwk = num / den * 7;
  return { kgwk, pct: kgwk / my * 100, n: xs.length, w: my };
}

/* ---------- exercises: working sets, top set, e1RM ---------- */
const setData = s => isNum(s.kg) || isNum(s.reps) || isNum(s.assist) || isNum(s.sec) || !!s.bodyweight;
// Working sets: no warm-ups, no drop sets; the ticked ones if any were ticked.
function workSets(sets) {
  const xs = (Array.isArray(sets) ? sets : []).filter(s => s && typeof s === 'object' && !s.warmup && !s.drop && setData(s));
  return xs.some(s => s.done) ? xs.filter(s => s.done) : xs;
}
function modeOf(lists) {
  const all = lists.flat();
  if (all.some(s => isNum(s.assist) && s.assist > 0)) return 'assist';
  if (all.some(s => s.bodyweight)) return all.some(s => isNum(s.kg) && s.kg > 0) ? 'bw+' : 'reps';
  if (all.some(s => isNum(s.kg) && s.kg > 0)) return 'kg';
  return all.some(s => isNum(s.sec)) ? 'sec' : 'reps';
}
const epley = (kg, reps) => kg * (1 + reps / 30);
// One session of an exercise: the top set (the heaviest working set; for assisted moves the least assistance) and the
// value the chart follows: e1RM (Epley, top set of at most 12 reps), assistance (lower is better), reps or seconds.
function topOf(sets, mode, d) {
  const reps = sets.filter(s => isNum(s.reps) && s.reps >= 1);
  const best = (xs, key) => xs.reduce((b, s) => !b || key(s) > key(b) ? s : b, null);
  if (mode === 'kg') {
    const top = best(reps.filter(s => isNum(s.kg) && s.kg > 0), s => s.kg * 1000 + s.reps); if (!top) return null;
    const e1 = top.reps <= 12 ? epley(top.kg, top.reps) : null;
    return { top, val: e1, e1, kg: top.kg };
  }
  if (mode === 'bw+') {  // body weight plus the added load
    const top = best(reps, s => (isNum(s.kg) ? s.kg : 0) * 1000 + s.reps); if (!top) return null;
    const bw = weightAt(d), load = (bw ?? 0) + (isNum(top.kg) ? top.kg : 0);
    const e1 = bw != null && top.reps <= 12 ? epley(load, top.reps) : null;
    return { top, val: e1 ?? (isNum(top.kg) ? top.kg : 0), e1, kg: isNum(top.kg) ? top.kg : 0 };
  }
  if (mode === 'assist') {
    const top = best(reps, s => -(isNum(s.assist) ? s.assist : 0) * 1000 + s.reps); if (!top) return null;
    return { top, val: isNum(top.assist) ? top.assist : 0, e1: null };
  }
  if (mode === 'sec') { const top = best(sets.filter(s => isNum(s.sec)), s => s.sec); return top ? { top, val: top.sec, e1: null } : null; }
  const top = best(reps, s => s.reps); return top ? { top, val: top.reps, e1: null } : null;
}
function topTxt(s, mode) {
  if (!s) return '—';
  if (mode === 'sec') return `${s.sec} 秒`;
  const r = isNum(s.reps) ? s.reps : '–';
  if (mode === 'assist') return isNum(s.assist) && s.assist > 0 ? `助力 ${kgTxt(s.assist)}kg × ${r}` : `自重 × ${r}`;
  if (s.bodyweight || mode === 'reps') return isNum(s.kg) && s.kg > 0 ? `自重+${kgTxt(s.kg)}kg × ${r}` : `自重 × ${r}`;
  return `${isNum(s.kg) ? kgTxt(s.kg) : '–'}kg × ${r}`;
}
const setShort = s => (isNum(s.assist) && s.assist > 0 ? `助${kgTxt(s.assist)}` : s.bodyweight ? (isNum(s.kg) && s.kg > 0 ? `+${kgTxt(s.kg)}` : '自重') : isNum(s.kg) ? kgTxt(s.kg) : '')
  + (isNum(s.sec) ? ` ${s.sec}秒` : `×${isNum(s.reps) ? s.reps : '–'}`);
const woMs = w => (isNum(w.xunji?.start) ? w.xunji.start : Date.parse(w.createdAt || '')) || 0;
// Every exercise ever logged (训记 and manual): {name, mode, list: sessions oldest first}. With 进阶显示 off, the moves
// followed by e1RM (with or without body weight) are followed by their heaviest set instead (最重一组: the weight, then
// the reps); the personal records (prsOf) keep their own rules either way.
const exercises = () => M.ex || (M.ex = advOn() ? exercisesOf(S.workouts) : exercisesOf(S.workouts).map(e => e.mode === 'kg' || e.mode === 'bw+'
  ? { ...e, mode: 'top', list: e.list.map(s => ({ ...s, val: isNum(s.kg) ? s.kg : isNum(s.top?.kg) ? s.top.kg : 0 })) } : e));
function exercisesOf(list) {
  const by = new Map();
  const ws = (Array.isArray(list) ? list : []).filter(w => w && isDate(w.date)).sort((a, z) => a.date.localeCompare(z.date) || woMs(a) - woMs(z));
  for (const w of ws) {
    for (const x of Array.isArray(w.exercises) ? w.exercises : []) {
      if (!x || x.cardio) continue;
      const name = String(x.name || '').trim(), sets = workSets(x.sets); if (!name || !sets.length) continue;
      let e = by.get(name); if (!e) by.set(name, e = { name, list: [] });
      const same = e.list.find(s => s.w === w);
      if (same) same.sets.push(...sets); else e.list.push({ w, d: w.date, sets: [...sets] });
    }
  }
  for (const e of by.values()) {
    e.mode = modeOf(e.list.map(s => s.sets));
    e.list = e.list.map(s => ({ ...s, ...topOf(s.sets, e.mode, s.d) })).filter(s => s.top);
    // high-rep and isolation moves (e1RM stops at 12 reps): the heaviest set's weight, reps breaking ties
    if (e.mode === 'kg' && byTopSet(e)) { e.mode = 'top'; e.list = e.list.map(s => ({ ...s, val: s.kg })); }
  }
  return [...by.values()].filter(e => e.list.length);
}
// 最重一组 instead of e1RM: an isolation move (not 双杠臂屈伸), or one whose heaviest set went past 12 reps in at least half of its last
// 8 sessions.
const ISOLATION = /平举|弯举|下压|臂屈伸|面拉|飞鸟|夹胸|提踵|卷腹|腿屈伸|腿弯举/;
function byTopSet(e) {
  if (ISOLATION.test(e.name) && !/双杠/.test(e.name)) return true;  // 双杠臂屈伸 is a compound move
  const r = e.list.slice(-8);
  return r.length > 0 && r.filter(s => isNum(s.top?.reps) && s.top.reps > 12).length * 2 >= r.length;
}
// The better of two sessions: the lower assistance, else the higher value; 最重一组 compares the reps at the same weight.
const better = (s, b, mode) => mode === 'top' ? s.kg > b.kg + 1e-9 || (Math.abs(s.kg - b.kg) < 1e-9 && s.top.reps >= b.top.reps)
  : lowerBetter(mode) ? s.val <= b.val : s.val >= b.val;
const lowerBetter = mode => mode === 'assist';
function valTxt(v, mode) {
  if (v == null) return '—';
  return mode === 'sec' ? `${Math.round(v)} 秒` : mode === 'reps' ? `${Math.round(v)} 次` : `${f1(v)} kg`;
}
const VAL_NAME = { kg: 'e1RM', top: '最重一组', 'bw+': 'e1RM（含体重）', assist: '助力', reps: '最多次数', sec: '最长' };
function planEx(name) {
  for (const d of Array.isArray(S.plan?.training?.days) ? S.plan.training.days : [])
    for (const x of Array.isArray(d?.exercises) ? d.exercises : []) if (String(x?.name || '').trim() === name) return { day: d, x };
  return null;
}

/* ---------- personal records ----------
   Per exercise, over its working sets (no warm-ups, no drop sets): the heaviest set (the most reps at that weight), the
   best e1RM (the session value 动作进步 charts: Epley on the session's heaviest set of at most 12 reps), and every session
   that beat everything before it. A session can set a weight record (heavier than ever: kind kg), a reps record (the
   heaviest weight again, more reps; or, for body-weight moves, more reps than ever: kind reps) or only an e1RM record
   (kind e1rm); one entry per session, in that order of precedence. The first session of a move is where its records
   start, not a record. Assisted moves (assist > 0, or 「辅助」 in the name) and timed-only moves have no weight records
   and are left out. */
const PR_W = { kg: '加了重量', reps: '多做了次数', e1rm: 'e1RM 新高' };
const assisted = (e, s) => (isNum(s.assist) && s.assist > 0) || /辅助/.test(e.name);
function prsOf(list) {
  const rows = [];
  for (const e of exercisesOf(list)) {
    if (e.mode === 'assist' || e.mode === 'sec' || /辅助/.test(e.name)) continue;
    const bwMove = e.mode === 'bw+' || e.mode === 'reps', lbl = kg => bwMove ? `自重+${kgTxt(kg)} kg` : `${kgTxt(kg)} kg`;
    let best = null, free = null, e1 = null;
    const recent = [];
    for (const s of e.list) {
      const ok = s.sets.filter(x => isNum(x.reps) && x.reps >= 1 && !assisted(e, x));
      const heavy = ok.filter(x => isNum(x.kg) && x.kg > 0);
      let ev = null;
      if (heavy.length) {
        const top = heavy.reduce((b, x) => !b || x.kg > b.kg + 1e-9 || (Math.abs(x.kg - b.kg) < 1e-9 && x.reps > b.reps) ? x : b, null);
        if (!best || top.kg > best.kg + 1e-9) { if (best) ev = { kind: 'kg', kg: top.kg, reps: top.reps, text: `${lbl(top.kg)} × ${top.reps}` }; best = { kg: top.kg, reps: top.reps, date: s.d }; }
        else if (Math.abs(top.kg - best.kg) < 1e-9 && top.reps > best.reps) { ev = { kind: 'reps', kg: top.kg, reps: top.reps, text: `${lbl(top.kg)} × ${top.reps}` }; best = { kg: top.kg, reps: top.reps, date: s.d }; }
      }
      const bare = bwMove ? ok.filter(x => !(isNum(x.kg) && x.kg > 0)) : [];
      if (bare.length) {  // body weight alone: the most reps
        const top = bare.reduce((b, x) => !b || x.reps > b.reps ? x : b, null);
        if (!free || top.reps > free.reps) { if (free && !ev) ev = { kind: 'reps', kg: null, reps: top.reps, text: `自重 × ${top.reps}` }; free = { reps: top.reps, date: s.d }; }
      }
      if (isNum(s.e1)) {
        if (!e1 || s.e1 > e1.v + 0.05) {
          if (e1 && !ev) ev = { kind: 'e1rm', kg: isNum(s.top?.kg) ? s.top.kg : null, reps: s.top?.reps ?? null, text: `e1RM ${f1(s.e1)} kg（${s.top?.kg > 0 ? lbl(s.top.kg) : '自重'} × ${s.top?.reps}）` };
          e1 = { v: Math.round(s.e1 * 10) / 10, date: s.d };
        }
      }
      if (ev) recent.unshift({ date: s.d, ...ev, ...(isNum(s.e1) ? { e1: Math.round(s.e1 * 10) / 10 } : {}), id: s.w?.id ?? null });
    }
    const b = best ? { ...best, ...(bwMove ? { bw: true } : {}) } : free ? { kg: null, reps: free.reps, date: free.date, bw: true } : null;
    if (!b && !e1) continue;
    rows.push([e.name, { best: b, e1rm: e1, recent: recent.slice(0, 20), n: e.list.length, last: e.list[e.list.length - 1].d, mode: e.mode }]);
  }
  // The latest record first; moves without one after them, the most recently trained first.
  rows.sort(([, a], [, z]) => String(z.recent[0]?.date || '').localeCompare(String(a.recent[0]?.date || '')) || z.last.localeCompare(a.last));
  return Object.fromEntries(rows);
}
// prs() for app.js and the card: its own memo (the view's M is put back), so calling it never changes what view() has.
let prMemo = { w: null, b: null, v: null };
function prsData(list) {
  const own = Array.isArray(list);
  if (!own && prMemo.v && prMemo.w === S.workouts && prMemo.b === S.body) return prMemo.v;
  const keep = M;
  try { newMemo(); const v = prsOf(own ? list : S.workouts); if (!own) prMemo = { w: S.workouts, b: S.body, v }; return v; }
  finally { M = keep; }
}
// window.LSJData.prs([workouts]): {name: {best: {kg, reps, date, bw?}, e1rm: {v, date} | null, recent: [{date, kind, text,
// kg, reps, e1?, id}], n, last, mode}}, the latest record first. A copy, so the caller can't change the card's numbers.
function prs(list) {
  if (!bind() || !Array.isArray(S.workouts)) return {};
  try { return JSON.parse(JSON.stringify(prsData(list))); } catch (e) { console.error(e); return {}; }
}

/* ---------- 围度和体脂: body.bodyFat and the circumferences, each a list of {d, v} oldest first ---------- */
const MEAS = [['waist', '腰围'], ['arm', '臂围'], ['chest', '胸围'], ['hip', '臀围'], ['thigh', '大腿围']];
const COMP = [['bodyFat', '体脂率'], ...MEAS];
const compName = k => (COMP.find(x => x[0] === k) || [k, k])[1];
const compUnit = k => k === 'bodyFat' ? '%' : 'cm';
function comp() {
  if (M.cp) return M.cp;
  const out = Object.fromEntries(COMP.map(([k]) => [k, []]));
  for (const b of Object.values(S.body)) {
    if (!b || !isDate(b.date)) continue;
    for (const [k] of COMP) {
      const v = b[k]; if (!isNum(v) || v <= 0 || (k === 'bodyFat' && v >= 75)) continue;  // a cleared one is null
      out[k].push(k === 'bodyFat' ? { d: b.date, v, src: b.bodyFatSource } : { d: b.date, v });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, z) => a.d.localeCompare(z.d));
  return (M.cp = out);
}
// What to watch for the goal: 腰围往下 (fat), 臂围往上 (muscle). [key, the wanted direction].
const FOCUS = { fatloss: [['waist', -1]], recomp: [['waist', -1]], lean: [['waist', -1], ['arm', 1]], muscle: [['arm', 1]] };
const FOCUS_SAY = {
  fatloss: '减脂主要看<b>腰围往下</b>：体重会跟着水分上下跳，腰围更能看出脂肪少没少。',
  recomp: '减脂增肌时体重不怎么动，主要看<b>腰围往下</b>，同时训练重量往上。',
  lean: '薄肌看两样：<b>腰围往下</b>、<b>臂围往上</b>。',
  muscle: '增肌看<b>臂围往上</b>；腰围也跟着涨得快，说明长的脂肪偏多。',
};
// A change under 0.5 (cm or %) is measuring noise.
function compWord(k, dv, w) {
  if (dv == null) return null;
  if (Math.abs(dv) < 0.5) return ['ok', '和上次差不多'];
  if (!w) return null;
  const nm = compName(k);
  return dv * w > 0 ? ['good', `${nm}在往${w < 0 ? '下' : '上'}`] : [Math.abs(dv) >= 1.5 ? 'adjust' : 'ok', `${nm}${dv > 0 ? '变粗' : '变细'}了`];
}
const bfSrc = s => s === 'apple-health' ? 'Apple 健康' : s === 'manual' ? '自己填的' : '';

/* ---------- 身材照: progress/<date>, {photos: {front, side, back}, note, review} ---------- */
const VIEWS = [['front', '正面'], ['side', '侧面'], ['back', '背面']];
const PID = /^[A-Za-z0-9_-]{1,80}$/;
const photoSrc = id => '/api/photos/' + (PID.test(String(id)) ? id : 'invalid');
const shotHas = (p, v) => !!p && PID.test(String(p.photos?.[v] || ''));
function shots() {  // newest first: the ones with a date and at least one photo
  const xs = Array.isArray(S.progress) ? S.progress : [];
  return xs.filter(p => p && isDate(p.date) && p.photos && typeof p.photos === 'object' && VIEWS.some(([v]) => shotHas(p, v)))
    .sort((a, z) => z.date.localeCompare(a.date));
}
let pv = { a: null, b: null, v: null };  // the pair picked (dates) and the view; null = the default
// The pair: the newest (or the one picked) on the right; on the left the one Claude compared it to, else the one
// nearest to 4 weeks before it (the previous one when that is all there is).
function pairOf(list) {
  const a = list.find(p => p.date === pv.a) || list[0];
  let b = pv.b ? list.find(p => p.date === pv.b && p !== a) : null;
  if (!b) {
    const ct = a.review?.compareTo, before = list.filter(p => p.date < a.date), aim = addDays(a.date, -28);
    b = (isDate(ct) && before.find(p => p.date === ct)) || before.reduce((x, p) => !x || Math.abs(daysBetween(aim, p.date)) < Math.abs(daysBetween(aim, x.date)) ? p : x, null);
  }
  return [a, b];
}

/* ---------- charts: hand-written SVG, one y-axis each, tap or hover for the values ---------- */
const CH = new Map();  // chart id -> {W, xs, idx (slots with data), tip(i), bars}
let PW = 332;
let chartSeq = 0;
function nice(lo, hi, n = 4) {
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw - 1e-9);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { lo: a, hi: b, ticks };
}
const P = v => v.toFixed(1);
function barPath(x, y0, y1, w) {  // a column from the baseline y0 to y1: square at the base, 4px rounded at the data end
  if (Math.abs(y0 - y1) < 1.5) y1 = y0 - (y1 > y0 ? -1.5 : 1.5);  // a value of about 0 is still a value
  const h = Math.abs(y0 - y1), r = Math.min(4, w / 2, h), s = y1 < y0 ? 1 : -1;
  return `M${P(x)},${P(y0)}V${P(y1 + s * r)}Q${P(x)},${P(y1)} ${P(x + r)},${P(y1)}H${P(x + w - r)}Q${P(x + w)},${P(y1)} ${P(x + w)},${P(y1 + s * r)}V${P(y0)}Z`;
}
// Marks, each a function of the chart's geometry g.
const lay = {
  band: (lo, hi, cls = 'm-band') => g => {
    const a = g.sy(Math.min(hi, g.y.hi)), b = g.sy(Math.max(lo, g.y.lo));
    return b > a ? `<rect class="${cls}" x="${g.L}" y="${P(a)}" width="${P(g.W - g.L - g.R)}" height="${P(b - a)}"/>` : '';
  },
  cols: (vals, cls) => g => {
    const w = Math.max(1.5, Math.min(24, g.bw * (g.bw > 12 ? 0.62 : 0.7)));
    return vals.map((v, i) => {
      if (!isNum(v)) return '';
      const d = barPath(g.cx(i) - w / 2, g.base, g.sy(v), w), k = typeof cls === 'function' ? cls(i) : cls;
      return d ? `<path class="${k}"${g.hatch && w >= 5 && / part\b/.test(k) ? ` style="fill:url(#${g.id}-h)"` : ''} d="${d}"/>` : '';
    }).join('');
  },
  line: (vals, cls = 'm-line', gap = Infinity) => g => {
    let d = '', last = -Infinity;
    vals.forEach((v, i) => { if (!isNum(v)) return; d += `${!d || i - last > gap ? 'M' : 'L'}${P(g.cx(i))},${P(g.sy(v))}`; last = i; });
    return d ? `<path class="${cls}" d="${d}"/>` : '';
  },
  dots: (vals, cls = 'm-dot', r = 3.5) => g => vals.map((v, i) => isNum(v) ? `<circle class="${typeof cls === 'function' ? cls(i) : cls}" cx="${P(g.cx(i))}" cy="${P(g.sy(v))}" r="${r}"/>` : '').join(''),
  step: (vals, cls = 'm-base') => g => {  // a value per slot (a target, a rolling baseline) as a stepped line
    let d = '', prev = false;
    vals.forEach((v, i) => {
      if (!isNum(v)) { prev = false; return; }
      d += `${prev ? 'L' : 'M'}${P(g.cx(i) - g.bw / 2)},${P(g.sy(v))}H${P(g.cx(i) + g.bw / 2)}`; prev = true;
    });
    return d ? `<path class="${cls}" d="${d}"/>` : '';
  },
  ticks: (vals, cls = 'm-tick') => g => {
    const w = Math.min(14, g.bw * 0.85) / 2;
    return vals.map((v, i) => isNum(v) ? `<line class="${cls}" x1="${P(g.cx(i) - w)}" x2="${P(g.cx(i) + w)}" y1="${P(g.sy(v))}" y2="${P(g.sy(v))}"/>` : '').join('');
  },
  target: (vals, n, usual) => (n <= 14 ? lay.ticks(vals, usual ? 'm-tick b' : 'm-tick') : lay.step(vals, usual ? 'm-base' : n > 31 ? 'm-tgt far' : 'm-tgt')),
  hline: (v, cls, label) => g => {
    if (!isNum(v) || v < g.y.lo || v > g.y.hi) return '';
    const y = P(g.sy(v));
    return `<line class="${cls}" x1="${g.L}" x2="${g.W - g.R}" y1="${y}" y2="${y}"/>${label ? `<text class="lbl" x="${g.W - g.R}" y="${P(g.sy(v) - 4)}" text-anchor="end">${esc(label)}</text>` : ''}`;
  },
  endLabel: (vals, text) => g => {  // the last value, next to the last point
    let i = vals.length - 1; while (i >= 0 && !isNum(vals[i])) i--; if (i < 0) return '';
    const x = g.cx(i), y = g.sy(vals[i]), right = x > g.W - 28;
    return `<text class="end" x="${P(right ? x - 7 : x + 7)}" y="${P(y + 4)}" text-anchor="${right ? 'end' : 'start'}">${esc(text)}</text>`;
  },
};
/* One chart. o: {n slots | pos: x per point in 0..1, y: nice(), fmt, layers, xl: [{i, t}], tip(i), has(i), aria, color, H} */
function plot(o) {
  const W = PW, H = o.H || 120, T = 8, B = 18, R = o.R ?? 6, y = o.y, fmt = o.fmt || kTick;
  const L = Math.round(7 + Math.max(...y.ticks.map(v => fmt(v).length)) * 5.3);
  const n = o.pos ? o.pos.length : o.n, span = W - L - R;
  const bw = o.pos ? Math.max(8, span / Math.max(n, 1) * 0.6) : span / n;
  const cx = o.pos ? (i => L + 8 + o.pos[i] * (span - 16)) : (i => L + bw * (i + 0.5));
  const sy = v => T + (y.hi - v) / (y.hi - y.lo) * (H - T - B);
  const id = o.id || 'c' + (++chartSeq);
  const g = { id, W, H, T, B, L, R, n, bw, cx, sy, y, hatch: !!o.hatch, base: sy(Math.min(y.hi, Math.max(y.lo, 0))) };
  const grid = y.ticks.map(v => `<line class="gl" x1="${L}" x2="${W - R}" y1="${P(sy(v))}" y2="${P(sy(v))}"/><text x="${L - 5}" y="${P(sy(v) + 3.5)}" text-anchor="end">${esc(fmt(v))}</text>`).join('');
  // Right to left: the newest label always stays; one crowding it from the left is dropped.
  let xl = '', left = Infinity;
  const ls = (o.xl || []).map(l => { const tw = l.t.length * 5.4; return { ...l, tw, x: Math.min(Math.max(cx(l.i), L + tw / 2), W - R - tw / 2) }; });
  for (let k = ls.length - 1; k >= 0; k--) {
    const l = ls[k]; if (l.x + l.tw / 2 > left - 10) continue;
    xl = `<text class="${l.now ? 'now' : ''}" x="${P(l.x)}" y="${H - 4}" text-anchor="middle">${esc(l.t)}</text>` + xl; left = l.x - l.tw / 2;
  }
  const idx = []; for (let i = 0; i < n; i++) if (o.has ? o.has(i) : true) idx.push(i);
  CH.set(id, { W, xs: Array.from({ length: n }, (_, i) => cx(i)), idx, tip: o.tip, bw: o.pos ? 0 : bw, T, H: H - B });
  return `<div class="dv-chart"><svg data-dv="${id}" viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="${esc(o.aria || '')}" style="--c:${o.color || 'var(--plate-blue)'}">
    ${o.hatch ? `<defs><pattern id="${id}-h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hb" width="4" height="4"/><line class="hs" x1="1" y1="0" x2="1" y2="4"/></pattern></defs>` : ''}${grid}<rect class="m-hl" x="0" y="${T}" width="${P(bw)}" height="${P(H - T - B)}" visibility="hidden"/>${(o.layers || []).map(f => f(g)).join('')}${xl}
    <line class="m-xh" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><rect class="hit" x="${L}" y="0" width="${span}" height="${H}"/></svg><div class="dv-tip" hidden></div></div>`;
}
// Date labels: every day for a week, every other day up to two weeks, Mondays for a month, the 1st and 15th for three
// months; the last day always (plot() drops a label that would crowd it).
function dayLabels(win, t) {
  const n = win.length;
  return win.map((d, i) => {
    const day = parseD(d);
    const on = i === n - 1 || n <= 8 || (n <= 16 ? (n - 1 - i) % 2 === 0 : n <= 31 ? day.getDay() === 1 : day.getDate() === 1 || day.getDate() === 15);
    return on ? { i, t: md(d), now: d === t } : null;
  }).filter(Boolean);
}
const legend = items => `<div class="dv-legend">${items.filter(Boolean).map(([kind, c, t]) => `<span><i class="${kind}" style="--c:${c}"></i>${esc(t)}</span>`).join('')}</div>`;
// A tiny trend line for a list row (no axis; the row's text carries the numbers). Blue when it went the good way;
// `neutral` when neither way is better.
function spark(vals, lower, neutral) {
  const xs = vals.filter(isNum); if (xs.length < 2) return '<svg class="dv-spark" viewBox="0 0 64 22" aria-hidden="true"></svg>';
  const lo = Math.min(...xs), hi = Math.max(...xs), k = hi > lo ? 16 / (hi - lo) : 0;
  const pts = vals.map((v, i) => isNum(v) ? [2 + i / (vals.length - 1) * 58, 19 - (v - lo) * k - (k ? 0 : 8)] : null).filter(Boolean);
  const up = neutral ? 0 : (xs[xs.length - 1] - xs[0]) * (lower ? -1 : 1);
  return `<svg class="dv-spark" viewBox="0 0 64 22" aria-hidden="true"><path class="${up > 0 ? 'up' : 'flat'}" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${P(p[0])},${P(p[1])}`).join('')}"/><circle cx="${P(pts[pts.length - 1][0])}" cy="${P(pts[pts.length - 1][1])}" r="2.4"/></svg>`;
}

/* Tooltips: the nearest slot with data under the finger or pointer; arrow keys when the chart has focus. */
function tipShow(svg, k) {
  const c = CH.get(svg.dataset.dv); if (!c || !c.idx.length || typeof c.tip !== 'function') return;
  k = Math.max(0, Math.min(c.idx.length - 1, k)); c.k = k;
  const i = c.idx[k], x = c.xs[i];
  const xh = svg.querySelector('.m-xh'), hl = svg.querySelector('.m-hl'), tip = svg.parentElement.querySelector('.dv-tip');
  if (c.bw > 6) { hl.setAttribute('x', P(x - c.bw / 2)); hl.setAttribute('visibility', 'visible'); xh.setAttribute('visibility', 'hidden'); }
  else { xh.setAttribute('x1', P(x)); xh.setAttribute('x2', P(x)); xh.setAttribute('visibility', 'visible'); }
  tip.innerHTML = c.tip(i); tip.hidden = false;
  const r = svg.getBoundingClientRect(), pr = svg.parentElement.getBoundingClientRect(), half = tip.offsetWidth / 2 + 2;
  tip.style.left = `${Math.min(Math.max(r.left - pr.left + x / c.W * r.width, half), Math.max(half, pr.width - half))}px`;
}
function tipAt(svg, clientX) {
  const c = CH.get(svg.dataset.dv); if (!c || !c.idx.length) return;
  const r = svg.getBoundingClientRect(), sx = (clientX - r.left) / r.width * c.W;
  let best = 0; c.idx.forEach((i, k) => { if (Math.abs(c.xs[i] - sx) < Math.abs(c.xs[c.idx[best]] - sx)) best = k; });
  tipShow(svg, best);
}
function tipOff(svg) {
  const tip = svg.parentElement.querySelector('.dv-tip'); if (tip && !tip.hidden) tip.hidden = true;
  svg.querySelector('.m-xh')?.setAttribute('visibility', 'hidden'); svg.querySelector('.m-hl')?.setAttribute('visibility', 'hidden');
}
function tipHide(except) { document.querySelectorAll('svg[data-dv]').forEach(svg => { if (svg !== except) tipOff(svg); }); }
const chartOf = e => e.target.closest?.('svg[data-dv]');
document.addEventListener('pointermove', e => { const s = chartOf(e); if (s) tipAt(s, e.clientX); });
let downAt = 0;  // a tap focuses the chart too: the tooltip stays where the finger was, not on the last day
document.addEventListener('pointerdown', e => { const s = chartOf(e); downAt = Date.now(); tipHide(s); if (s) tipAt(s, e.clientX); });
// A finger lifting fires pointerout at once: a tapped tooltip stays until the next tap elsewhere.
document.addEventListener('pointerout', e => { if (e.pointerType !== 'touch' && chartOf(e) && !e.relatedTarget?.closest?.('svg[data-dv]')) tipHide(); });
document.addEventListener('focusin', e => {
  const s = e.target.matches?.('svg[data-dv]') ? e.target : null; if (!s || Date.now() - downAt < 600) return;
  const c = CH.get(s.dataset.dv); if (c) { tipHide(s); tipShow(s, c.idx.length - 1); }
});
document.addEventListener('keydown', e => {
  const s = e.target.matches?.('svg[data-dv]') ? e.target : null; if (!s || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const c = CH.get(s.dataset.dv); if (!c) return;
  e.preventDefault(); tipShow(s, (c.k ?? c.idx.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1));
});
document.addEventListener('focusout', e => { if (e.target.matches?.('svg[data-dv]') && Date.now() - downAt > 600) tipOff(e.target); });

/* ---------- pieces of a card ---------- */
const TITLES = { weight: '体重', body: '围度和体脂', photos: '身材照', progress: '每周变化', sleep: '睡眠', recovery: '恢复', activity: '活动', diet: '饮食', training: '训练', week: '本周', reports: '报告' };
const titleOf = k => k === 'sleep' && advOn() ? '睡眠和恢复' : TITLES[k];
const GOAL_NAME = { muscle: '增肌', fatloss: '减脂', lean: '薄肌', recomp: '减脂增肌' };
const empty = t => `<div class="dv-empty">${esc(t)}</div>`;
// The 「?」 next to a card's name: its 这是什么 sheet.
const qBtn = (k, name) => `<button type="button" class="dv-q" data-act="d-info" data-k="${esc(k)}" aria-label="这是什么：${esc(name)}">?</button>`;
function head(big, unit, sub, tag = '') {
  return `<div class="dv-top"><span class="dv-big">${big}${unit ? `<small>${esc(unit)}</small>` : ''}</span>${tag}</div>${sub ? `<div class="dv-sub">${sub}</div>` : ''}`;
}
const kvs = items => `<div class="dv-kvs">${items.filter(Boolean).map(([k, v, s]) => `<div class="dv-kv"><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`).join('')}</div>`;
const tag = (cls, t) => `<span class="tag ${cls}">${esc(t)}</span>`;
/* Claude's line for the card (meta/insights), marked as Claude's and dated. Dimmed when it is more than 7 days old, or
   when its verdict and the card's own verdict now disagree (a card's state: {lv: good|adjust, both}: with `both` the card
   measures the same thing Claude judges, so either way round counts; without, only Claude's 「good」 against an
   「adjust」 on the card does). */
const LV_WORD = { good: '保持就行', ok: '有点偏', adjust: '要调整' };
function insightOf(key) {
  const ins = S.insights, c = ins && typeof ins.cards === 'object' ? ins.cards?.[key] : null;
  if (!c || typeof c !== 'object' || typeof c.say !== 'string' || !c.say.trim()) return null;
  const at = isDate(c.date) ? c.date : isDate(ins.date) ? ins.date : ins.updatedAt && !isNaN(Date.parse(ins.updatedAt)) ? ymd(new Date(ins.updatedAt)) : null;
  return { ...c, at, lv: LEVEL.includes(c.level) ? c.level : 'ok' };
}
function sayState(key, t, r) {
  const c = insightOf(key); if (!c) return null;
  const old = !!c.at && daysBetween(c.at, t) > 7, st = r?.state;
  const clash = !old && !!st && ((c.lv === 'good' && st.lv === 'adjust') || (!!st.both && c.lv === 'adjust' && st.lv === 'good'));
  return { c, old, clash, newer: !!(r?.latest && c.at && r.latest > c.at) };
}
/* Claude's lines for one card, in one box: a card that shows two things (体重 and its weekly rate, 睡眠 and 恢复) has a
   line for each, labelled. The box carries the newest date and the worst verdict of the lines still current; a line
   that is old or no longer matches the card is dimmed on its own (the whole box when none is current). rs: key → the
   card's result (its state, its data's latest day). */
const SAY_LABEL = { weight: '体重', progress: '每周变化', sleep: '睡眠', recovery: '恢复' };
function sayHTML(keys, t, rs) {
  const items = keys.map(k => ({ k, s: sayState(k, t, rs[k]) })).filter(x => x.s);
  if (!items.length) return '';
  const live = items.filter(x => !x.s.old && !x.s.clash), multi = items.length > 1, dim = !live.length;
  const lv = live.length ? LEVEL[Math.max(...live.map(x => LEVEL.indexOf(x.s.c.lv)))] : items[0].s.c.lv;
  const at = items.map(x => x.s.c.at).filter(Boolean).sort().pop();
  const one = ({ k, s }) => {
    const { c, old, clash } = s, off = old || clash;
    const note = old ? `${md(c.at)} 写的，已经超过一周` : clash ? (s.newer ? '数据有更新，等下次处理' : '和上面现在算出的数对不上，等下次处理') : '';
    return `<div class="it${off && !dim ? ' dim' : ''}"><p class="say">${multi ? `<b class="kk">${esc(SAY_LABEL[k] || titleOf(k))}</b>` : ''}${esc(c.say.trim())}</p>${typeof c.do === 'string' && c.do.trim() ? `<p class="do">${esc(c.do.trim())}</p>` : ''}${note ? `<p class="upd">${esc(note)}</p>` : ''}</div>`;
  };
  return `<div class="dv-say ${lv}${dim ? ' dim' : ''}"><div class="who"><span class="ag-mark" aria-hidden="true"></span><span class="by">Claude${at ? ` · ${esc(md(at))}` : ''}</span>${dim ? '' : `<span class="lv">${LV_WORD[lv]}</span>`}</div>${items.map(one).join('')}</div>`;
}
// A card: its name and 「?」 (info: the key of its 这是什么), anything for the title row's right end (act), then the panel.
function card(id, name, info, panel, act = '') {
  return `<section class="sec dv-card" id="dv-${id}"><div class="sec-h"><h2>${esc(name)}</h2>${info ? qBtn(info, name) : ''}${act}</div>
    <div class="panel">${panel}</div></section>`;
}
// A card with one result: big number and verdict (r.top), Claude's line for its key, the numbers and charts (r.body).
const plain = (key, t, r) => card(key, titleOf(key), key, `${r.top || ''}${sayHTML([key], t, { [key]: r })}${r.body || ''}`, r.act || '');

/* ---------- 本周 ---------- */
function actionsOn(d) {  // the 「今天要做的」 items of day d: Claude's first 3 non-skipped actions, plus the person's own
  if (has('dayActions') && has('isDone') && has('todoItems')) {
    const a = A.dayActions(d);
    return [...(a ? a.items.map(x => A.isDone(a.r, x.i)) : []), ...A.todoItems(d).map(x => x.done === true)];
  }
  const ok = r => r?.kind === 'daily' && Array.isArray(r.actions);
  const r = S.reports.find(x => ok(x) && x.actionsFor === d) || S.reports.find(x => ok(x) && x.id === 'daily-' + d && !isDate(x.actionsFor));
  const out = [];
  if (r) r.actions.map((a, i) => ({ a: String(a ?? '').trim(), i })).filter(x => x.a && r.skip?.[String(x.i)] !== true).slice(0, 3)
    .forEach(x => out.push(r.done?.[String(x.i)] === true));
  const td = S.todos ? (Array.isArray(S.todos) ? S.todos.find(x => x.date === d) : S.todos[d]) : null;
  for (const it of Array.isArray(td?.items) ? td.items : []) if (it && typeof it === 'object' && String(it.text || '').trim()) out.push(it.done === true);
  return out;
}
function weekStats(a, b, t) {
  const days = []; for (let d = a; d <= b; d = addDays(d, 1)) days.push(d);
  const done = d => d < t;  // a day that is over; today still counts when it already made it
  const food = days.filter(d => anyFood(intakeOf(d)));
  const avgOf = (xs, f) => mean(xs.map(f).filter(isNum));
  const over = food.filter(done);
  const pHit = d => { const tg = targetOf(d), p = intakeOf(d).sum?.protein; return isNum(tg?.protein) && isNum(p) && p >= 0.9 * tg.protein; };
  const pDays = food.filter(d => isNum(targetOf(d)?.protein) && (done(d) || pHit(d)));
  const wt = waterGoal(), wDays = days.filter(d => waterTotal(d) > 0 && (done(d) || waterTotal(d) >= wt));
  const acts = days.flatMap(actionsOn);
  const ws = weighIns().filter(p => p.d >= a && p.d <= b);
  return {
    days: days.length, kcal: avgOf(over, d => intakeOf(d).sum?.kcal), kT: avgOf(over, d => targetOf(d)?.kcal),
    prot: avgOf(over, d => intakeOf(d).sum?.protein), pT: avgOf(over, d => targetOf(d)?.protein), part: over.filter(d => partialDay(intakeOf(d))).length,
    pHit: pDays.filter(pHit).length, pOf: pDays.length,
    trained: days.filter(trainedOn).length, plan: planned(),
    sleep: mean(days.map(night).filter(Boolean).map(x => x.min)),
    steps: avgOf(days.filter(d => done(d) && worn(d)), d => hv(d, 'steps')),
    weight: ws.length ? mean(ws.map(p => p.w)) : null, wN: ws.length,
    water: wDays.filter(d => waterTotal(d) >= wt).length, waterOf: wDays.length,
    acts: acts.filter(Boolean).length, actsOf: acts.length,
  };
}
// The week a weekly report is about: its id is weekly-<Monday>; else its date's week.
const repWeek = r => { const m = /^weekly-(\d{4}-\d{2}-\d{2})$/.exec(r?.id || ''); return m ? m[1] : isDate(r?.date) ? monday(r.date) : null; };
// The latest weekly report, if it is about last week or this one (an older one's 「下周重点」 is over).
function weeklyNow(t) {
  const mon = monday(t), wk = S.reports.find(r => r?.kind === 'weekly');
  const w = wk && repWeek(wk);
  return w && w >= addDays(mon, -7) ? { r: wk, mon: w } : null;
}
function weekHTML(t) {
  const mon = monday(t), cur = weekStats(mon, t, t), prev = weekStats(addDays(mon, -7), addDays(mon, -1), t);
  // Last week with nothing in it (a new account) loses its column instead of a column of dashes.
  const prevAny = prev.kcal != null || prev.prot != null || prev.pOf > 0 || prev.trained > 0 || prev.sleep != null || prev.steps != null || prev.weight != null || prev.waterOf > 0 || prev.actsOf > 0;
  const v = (x, f = f0) => x == null ? null : `<b>${f(x)}</b>`;
  // The target is its own inline block: on a narrow screen it wraps under the number instead of being cut off.
  const vt = (x, tg) => x == null ? null : `<b>${f0(x)}</b>${tg != null ? `<small class="tg">/${f0(tg)}</small>` : ''}`;
  const of = (n, m) => m ? `<b>${n}</b><small class="tg">/${m}</small>` : null;
  const dw = cur.weight != null && prev.weight != null ? `<small class="dl">${sgn(cur.weight - prev.weight)}</small>` : '';
  const rows = [
    ['平均热量', 'kcal', vt(cur.kcal, cur.kT), vt(prev.kcal, prev.kT)],
    ['平均蛋白质', 'g', vt(cur.prot, cur.pT), vt(prev.prot, prev.pT)],
    ['蛋白质达标', '', of(cur.pHit, cur.pOf), of(prev.pHit, prev.pOf)],
    ['训练', '', cur.plan ? of(cur.trained, cur.plan) : v(cur.trained), prev.plan ? of(prev.trained, prev.plan) : v(prev.trained)],
    ['平均睡眠', '', v(cur.sleep, hmm), v(prev.sleep, hmm)],
    ['平均步数', '', v(cur.steps), v(prev.steps)],
    ['体重周均', 'kg', cur.weight != null ? v(cur.weight, f1) + dw : null, v(prev.weight, f1)],
    ['喝水达标', '', of(cur.water, cur.waterOf), of(prev.water, prev.waterOf)],
    ['建议做到', '', of(cur.acts, cur.actsOf), of(prev.acts, prev.actsOf)],
  ].filter(r => r[2] != null || (prevAny && r[3] != null))
    .map(([label, unit, a, b]) => `<tr><th scope="row">${esc(label)}${unit ? `<small>${esc(unit)}</small>` : ''}</th><td>${a ?? '<span class="na">—</span>'}</td>${prevAny ? `<td class="pv">${b ?? '<span class="na">—</span>'}</td>` : ''}</tr>`).join('');
  // How each row is counted is in the 「?」; only what is particular to this week is said here.
  const notes = [];
  if (t === mon) notes.push('今天是周一，本周还没有过完的一天');
  if (cur.part) notes.push(`本周有 ${cur.part} 天饮食记录不全`);
  if (!prevAny) notes.push('上周还没有记录，下周起会和上周比');
  const table = `<section class="sec" id="dv-week"><div class="sec-h"><h2>本周</h2>${qBtn('week', '本周')}<span class="count">${esc(md(mon))}–${esc(md(t))}</span></div><div class="panel dv-week">
    ${rows ? `<table class="dv-wk${prevAny ? '' : ' one'}">${prevAny ? '<thead><tr><th></th><th>本周</th><th class="pv">上周</th></tr></thead>' : ''}<tbody>${rows}</tbody></table>` : '<p class="dv-empty">本周还没有记录。</p>'}
    ${notes.length ? `<p class="dv-note">${esc(notes.join('。'))}。</p>` : ''}</div></section>`;
  return weekWithReport(t, table);
}
// The latest weekly report goes above the table Monday to Wednesday (the week it is about has just ended), under it
// from Thursday.
const weekWithReport = (t, table) => { const w = weeklyHTML(t); return isoWd(t) <= 3 ? w + table : table + w; };
// The latest weekly report: Claude's, so marked as such; its title, summary (the first paragraph), goals and 重点,
// and the whole report in app.js's report sheet.
function weeklyHTML(t) {
  const w = weeklyNow(t); if (!w) return '';
  const r = w.r, acts = Array.isArray(r.actions) ? r.actions.map(a => String(a ?? '').trim()).filter(Boolean) : [];
  const paras = String(r.summary || '').split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 1);
  const goals = has('goalsHTML') ? A.goalsHTML(r.goals) : '';
  return `<section class="sec dv-wkr" id="dv-weekly" aria-label="Claude 周报"><div class="who"><span class="ag-mark" aria-hidden="true"></span><span class="by">Claude 周报 · ${esc(md(w.mon))}–${esc(md(addDays(w.mon, 6)))}</span></div>
    ${r.title ? `<button type="button" class="t" data-act="d-rep" data-id="${esc(r.id)}">${esc(r.title)}</button>` : ''}
    ${paras.map(x => `<p>${esc(x)}</p>`).join('')}${goals}
    ${acts.length ? `<div class="sub-h">${w.mon < monday(t) ? '这周的重点' : '下周重点'}</div><ol class="list">${acts.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
    <button type="button" class="link" data-act="d-rep" data-id="${esc(r.id)}">看完整周报 ›</button></section>`;
}

/* ---------- the seven cards ---------- */
function cWeight(c) {
  const all = weighIns(), pts = all.filter(p => p.d >= c.win[0] && p.d <= c.t);
  const ma = d => mean(all.filter(p => p.d >= addDays(d, -6) && p.d <= d).map(p => p.w));
  const info = { pts: pts.length };
  if (!all.length) return { body: empty('还没有体重记录。早上起床、上完厕所、吃喝之前称，每周至少 4 次。'), info };
  if (pts.length < 2) {  // one weigh-in (or none lately): the number still leads; the trend needs a second one
    const lw = all[all.length - 1];
    return { top: head(f1(lw.w), 'kg', `${esc(md(lw.d))} 称的${pts.length ? '' : ` · ${c.rl}没称`}`), body: empty(`再称 ${2 - pts.length} 次就能画出趋势。起床、上完厕所、吃喝之前称，每周至少 4 次。`), info };
  }
  const byD = new Map(pts.map(p => [p.d, p.w]));
  const raw = c.win.map(d => byD.get(d) ?? null), avg = c.win.map((d, i) => raw[i] != null ? ma(d) : null);
  const last = pts[pts.length - 1], lastMA = ma(last.d), firstMA = ma(pts[0].d);
  const tw = isNum(S.profile?.targetWeight) ? S.profile.targetWeight : null;
  const vals = [...raw, ...avg].filter(isNum);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const showT = tw != null && tw >= lo - 1.5 && tw <= hi + 1.5;
  if (showT) { lo = Math.min(lo, tw); hi = Math.max(hi, tw); }
  const y = nice(lo - 0.3, hi + 0.3, 3);
  const dev = mean(pts.map(p => Math.abs(p.w - ma(p.d))));
  Object.assign(info, { lastMA, last, firstMA, change: lastMA - firstMA, from: pts[0].d, dev, tw, n: c.n });
  const chart = plot({
    n: c.n, y, fmt: v => String(+v.toFixed(1)), H: 132, R: 32, color: 'var(--plate-blue)',
    aria: `${c.rl}体重，7 日均值从 ${f1(firstMA)} 到 ${f1(lastMA)} 公斤`,
    layers: [showT ? lay.hline(tw, 'm-goal', `目标 ${kgTxt(tw)}`) : null, lay.dots(raw, 'm-raw', c.n > 40 ? 2.2 : 3), lay.line(avg, 'm-line', 8), lay.dots(avg.map((v, i) => i === c.win.indexOf(last.d) ? v : null), 'm-dot', 4.5), lay.endLabel(avg, f1(lastMA))].filter(Boolean),
    xl: dayLabels(c.win, c.t), has: i => raw[i] != null,
    tip: i => `${esc(mdw(c.win[i]))}<br><b>${f1(raw[i])}</b> kg 当天 · <b>${f1(avg[i])}</b> 7 日均值`,
  });
  const sub = `7 日均值 · 最近一次 ${f1(last.w)} kg（${esc(md(last.d))}）${tw != null ? ` · 目标 ${kgTxt(tw)} kg` : ''}`;
  return {
    top: head(f1(lastMA), 'kg', sub),
    body: kvs([[`${c.rl}变化`, `${sgn(lastMA - firstMA)}<small>kg</small>`], ['称重', `${pts.length}<small>/${c.n} 天</small>`], ['单天波动', `±${f1(dev)}<small>kg</small>`]])
      + fromNote(c) + chart + legend([['dot', 'var(--muted)', '每天称重'], ['ln', 'var(--plate-blue)', '7 日均值'], showT ? ['ln', 'var(--good)', '目标体重'] : null]),
    info,
  };
}

function bandOf() {
  const p = S.profile || {};
  if (p.goal === 'muscle') return p.level === 'new' ? [0.25, 0.5] : [0.15, 0.3];
  if (p.goal === 'fatloss') return [-1, -0.5];
  if (p.goal === 'recomp') return [-0.25, 0.1];
  if (p.goal === 'lean') return [-0.5, 0.1];  // 薄肌: weight steady or coming down slowly while the waist shrinks
  return [-0.25, 0.25];
}
function rateWord(pct, band) {
  const g = S.profile?.goal;
  if (pct >= band[0] && pct <= band[1]) return ['good', '在范围内'];
  const above = pct > band[1];
  if (g === 'muscle') return ['adjust', above ? '涨得偏快' : '涨得偏慢'];
  if (g === 'fatloss') return ['adjust', above ? '减得偏慢' : '减得偏快'];
  if (g === 'lean') return ['adjust', above ? '涨得偏快' : '降得偏快'];
  return ['adjust', above ? '在上涨' : '在下降'];
}
function weeksOf(c) {  // the weeks (Mondays) a weekly chart shows: at least 4
  const k = Math.max(4, Math.ceil(c.n / 7)), mon = monday(c.t);
  return Array.from({ length: k }, (_, i) => addDays(mon, -7 * (k - 1 - i)));
}
/* 每周变化: the weight's weekly rate against the goal's band, as the line under the weight chart (r.line); about when
   the target weight is reached at that rate. */
function cProgress(c) {
  const band = bandOf(), rate = rateAt(c.t), all = weighIns();
  const waist = Object.values(S.body).filter(b => isDate(b.date) && isNum(b.waist)).map(b => ({ d: b.date, v: b.waist })).sort((a, z) => a.d.localeCompare(z.d));
  const wIn = waist.filter(x => x.d >= c.win[0] && x.d <= c.t), wPrev = waist.filter(x => x.d < c.win[0]).pop();
  const wA = wIn.length > 1 ? wIn[0] : wPrev && wIn.length ? wPrev : null, wB = wIn.length ? wIn[wIn.length - 1] : null;
  const tw = isNum(S.profile?.targetWeight) ? S.profile.targetWeight : null, cur = all.length ? mean(all.filter(p => p.d >= addDays(all[all.length - 1].d, -6)).map(p => p.w)) : null;
  let eta = null;
  if (tw != null && cur != null) {
    const diff = tw - cur;
    if (Math.abs(diff) < 0.3) eta = { t: '已到目标附近' };
    else if (rate && Math.sign(rate.kgwk) === Math.sign(diff) && Math.abs(rate.kgwk) >= 0.02) {
      const wk = diff / rate.kgwk;
      eta = wk > 104 ? { t: '两年以上', wk } : { t: `约 ${Math.round(wk)} 周`, wk, d: addDays(c.t, Math.round(wk * 7)) };
    } else if (rate) eta = { t: '方向相反', away: true };
  }
  const info = { band, rate, waist: { a: wA, b: wB }, tw, cur, eta, w: rate?.w ?? cur };
  if (!all.length) return { line: '', info };  // the weight card already says to weigh
  const goal = GOAL_NAME[S.profile?.goal] ? `${GOAL_NAME[S.profile.goal]}目标` : '目标', bandTxt = `${goal} ${band.map(b => sgn(b, f2)).join(' ~ ')} %/周`;
  if (!rate) {  // not enough weigh-ins yet: how many there are and about when it will be
    const xs = all.filter(p => p.d > addDays(c.t, -28) && p.d <= c.t), when = xs.length ? addDays(xs[0].d, 14) : null;
    return { line: `<p class="dv-rate none"><b>每周变化</b>${xs.length ? `近 4 周称了 ${xs.length} 次，称满两周${when > c.t ? `（约 ${esc(md(when))}）` : ''}、至少 6 次后算出来` : '近 4 周没称，两周里称 6 次以上才能算出来'} · ${esc(bandTxt)}</p>`, info };
  }
  const [lv, word] = rateWord(rate.pct, band);
  const etaTxt = tw == null || !eta ? '' : eta.away ? ` · 和目标 ${kgTxt(tw)} kg 方向相反` : ` · 到 ${kgTxt(tw)} kg ${eta.t}${eta.d ? `（${md(eta.d)} 左右）` : ''}`;
  return {
    line: `<div class="dv-rate"><div class="r1"><b class="k">每周变化</b><span class="v">${sgn(rate.pct, f2)}<small>%</small></span><small class="kg">约 ${sgn(rate.kgwk, f2)} kg</small>${tag(lv, word)}</div>
      <p class="r2">${esc(bandTxt)}${esc(etaTxt)} · 按近 4 周 ${rate.n} 次称重</p></div>`,
    info, state: { lv, both: true },
  };
}

function cSleep(c) {
  const ns = c.win.map(night), got = ns.filter(Boolean);
  const info = { nights: got.length };
  if (!got.length) return { body: empty(c.from ? `${c.rl}没有睡眠数据（最近一晚是 ${md(c.latest)}）。` : '还没有睡眠数据。用「我的 → Apple 健康同步」自动同步，或在「今日 → 身体」上传睡眠截图。'), info };
  const avg = mean(got.map(x => x.min)), enough = got.filter(x => x.min >= 420).length;
  const beds = got.map(x => nightMin(x.bed)).filter(isNum), wakes = got.map(x => nightMin(x.wake)).filter(isNum);
  const st = got.filter(x => isNum(x.deep) && x.deep > 0 && isNum(x.rem));
  const deep = mean(st.map(x => x.deep)), rem = mean(st.map(x => x.rem)), deepP = mean(st.map(x => x.deep / x.min)), remP = mean(st.map(x => x.rem / x.min));
  Object.assign(info, { avg, enough, bed: beds.length ? [Math.min(...beds), Math.max(...beds), median(beds)] : null, wake: wakes.length ? [Math.min(...wakes), Math.max(...wakes), median(wakes)] : null, deep, rem, deepP, remP, stages: st.length });
  const hrs = ns.map(x => x ? x.min / 60 : null);
  const top = Math.max(10, Math.ceil(Math.max(...hrs.filter(isNum)))), y = { lo: 0, hi: top, ticks: [0, 3, 6, 9, 12].filter(v => v <= top) };
  const src = x => x.src === 'manual' ? '自己改的' : x.src === 'screenshot' ? '截图' : x.src === 'body' ? '手填时长' : 'Apple 健康';
  const chart = plot({
    n: c.n, y, fmt: v => String(v), H: 124, color: 'var(--sl-core)', aria: `${c.rl}每晚睡着时长，平均 ${hmm(avg)}`,
    layers: [lay.band(7, 9), lay.cols(hrs, 'm-col')],
    xl: dayLabels(c.win, c.t), has: i => !!ns[i],
    tip: i => { const x = ns[i]; return `${esc(mdw(c.win[i]))} 醒来<br>睡着 <b>${hmm(x.min)}</b>${x.bed && x.wake ? ` · ${esc(x.bed)}–${esc(x.wake)}` : ''}${isNum(x.deep) && isNum(x.rem) ? `<br>深睡 ${hmm(x.deep)} · REM ${hmm(x.rem)}` : ''}<br><span class="s">${src(x)}</span>`; },
  });
  const bedTxt = info.bed ? `${clock(info.bed[0])}–${clock(info.bed[1])}` : '—';
  // The card's own verdict, over the last 14 nights (what Claude looks at): clearly short sleep only, since Claude's
  // line also weighs how regular the bedtimes are.
  const n14 = Array.from({ length: 14 }, (_, i) => night(addDays(c.t, -i))).filter(Boolean), a14 = mean(n14.map(x => x.min));
  return {
    top: head(hmm(avg), '', `${c.rl}平均每晚睡着${got.length < c.n ? `（有数据的 ${got.length} 晚）` : ''} · 建议 7–9 小时`, avg >= 420 ? tag('good', '睡得够') : tag('adjust', '偏少')),
    body: kvs([['够 7 小时', `${enough}<small>/${got.length} 晚</small>`], ['入睡', bedTxt, info.bed && info.bed[1] > info.bed[0] ? `相差 ${f1((info.bed[1] - info.bed[0]) / 60)} 小时` : ''], ['深睡 · REM', st.length ? `${hmm(deep)} · ${hmm(rem)}` : '—', st.length ? `${Math.round(deepP * 100)}% · ${Math.round(remP * 100)}%` : '']])
      + fromNote(c) + chart + legend([['sq', 'var(--sl-core)', '每晚睡着'], ['wash', 'var(--good)', '7–9 小时']]),
    info, state: a14 != null && a14 < 390 ? { lv: 'adjust' } : null,
  };
}

/* 恢复, under the sleep chart (进阶显示 on): the latest resting HR and 3-day HRV against their baselines, and the days
   of the range with a recovery deviation (r.block; '' without either number). */
function cRecovery(c) {
  const rhr = c.win.map(d => hv(d, 'restingHR')), h3 = c.win.map(d => hv(d, 'hrv') != null ? hrv3(d) : null);
  const rec = c.win.map(recOf), flags = rec.filter(r => r.warn).length;
  const lastI = arr => { let i = arr.length - 1; while (i >= 0 && !isNum(arr[i])) i--; return i; };
  const iR = lastI(rhr), iH = lastI(h3);
  const info = { flags, rhr: iR >= 0 ? { v: rhr[iR], b: recBase(c.win[iR], 'restingHR'), d: c.win[iR] } : null, hrv: iH >= 0 ? { v: h3[iH], b: recBase(c.win[iH], 'hrv'), d: c.win[iH] } : null };
  if (iR < 0 && iH < 0) return { block: '', info };
  const why = x => [x.rhr ? '静息心率连续两天偏高' : '', x.hrv ? 'HRV 连续两天偏低' : ''].filter(Boolean).join('，');
  const now = recOf(c.t), prev = recOf(addDays(c.t, -1));
  const warn = now.warn ? `<div class="dv-warn">这天恢复偏差：${esc(why(now))}。练的话保持上次的重量、不冲新纪录，晚上早点睡。</div>` : '';
  const r = info.rhr, h = info.hrv;
  // Days with data in the 28 before today: the baseline needs 14 of them.
  const have = k => Array.from({ length: 28 }, (_, i) => hv(addDays(c.t, -1 - i), k)).filter(v => v != null).length;
  const short = Math.max(0, 14 - Math.max(have('restingHR'), have('hrv')));
  const based = r?.b != null || h?.b != null;
  // The verdict: 恢复正常 as a tag; a deviation this day is the warning under the numbers. No baseline yet: 基线还差 says how long.
  const verdict = !now.warn && based ? tag('good', '恢复正常') : '';
  const hrvPct = h?.b ? (h.v - h.b) / h.b * 100 : null;
  const block = `<div class="dv-rec"><div class="dv-ct">恢复${verdict}</div>${kvs([
    ['静息心率', r ? `${f0(r.v)}<small>次/分</small>` : '—', r ? (r.b != null ? `基线 ${f0(r.b)} · ${sgn(r.v - r.b, f0)}` : esc(md(r.d))) : ''],
    ['HRV', h ? `${f0(h.v)}<small>ms</small>` : '—', h ? (h.b != null ? `基线 ${f0(h.b)} · ${sgn(hrvPct, f0)}%` : '3 天平均') : ''],
    based ? ['恢复偏差', `${flags}<small>天</small>`, c.rl] : ['基线还差', `${short}<small>天</small>`, '有 14 天数据后判断']])}${warn}</div>`;
  return { block, info: { ...info, short }, state: now.warn || prev.warn ? { lv: 'adjust', both: true } : based ? { lv: 'good', both: true } : null };
}

function cActivity(c) {
  const steps = c.win.map(d => hv(d, 'steps')), act = c.win.map(d => hv(d, 'activeKcal')), wornA = c.win.map(worn);
  const base = c.win.map(d => actBase(d)), bonus = c.win.map(bonusOf);
  const info = {};
  if (!steps.some(isNum) && !act.some(isNum)) return { body: empty(c.from ? `${c.rl}没有步数和活动数据（最近一次是 ${md(c.latest)}）。` : '还没有步数和活动数据。用「我的 → Apple 健康同步」每天同步。'), info };
  const full = c.win.map((d, i) => d < c.t && wornA[i]);
  const avgSteps = mean(steps.filter((v, i) => isNum(v) && full[i])), avgAct = mean(act.filter((v, i) => isNum(v) && full[i]));
  // The usual steps: like the usual activity, a median of 4+ worn days in the 28 before today, else no line.
  const sDays = Array.from({ length: 28 }, (_, i) => addDays(c.t, -1 - i)).filter(worn).map(d => hv(d, 'steps')).filter(isNum);
  const sBase = sDays.length >= 4 ? median(sDays) : null;
  const bd = bonus.map((b, i) => b ? i : -1).filter(i => i >= 0);
  Object.assign(info, { avgSteps, avgAct, sBase, bT: actBase(c.t, false), bR: actBase(c.t, true), bonusDays: bd.length, bonusAvg: mean(bd.map(i => bonus[i])), wornDays: full.filter(Boolean).length });
  const ignored = (d, k) => Array.isArray(S.health[d]?.ignore) && S.health[d].ignore.includes(k);
  // Today is still going: drawn as in progress, not as a day the Watch was off.
  const cls = i => `m-col${c.win[i] === c.t ? ' now' : !wornA[i] ? ' off' : ''}`;
  const kind = d => isRest(d) ? '休息日' : '训练日';
  const offWhy = d => ignored(d, 'activeKcal') || ignored(d, 'steps') ? '这天有数据标了不算，不算进平常' : '没戴表或没同步全，不算进平常';
  const cS = `<div class="dv-ct">步数</div>` + plot({
    n: c.n, y: nice(0, Math.max(...steps.filter(isNum), sBase || 0, 1000), 3), H: 108, color: 'var(--plate-green)', aria: `步数，${c.rl}平均 ${avgSteps != null ? Math.round(avgSteps) : '无'}`,
    layers: [lay.cols(steps, cls), lay.hline(sBase, 'm-base')],
    xl: dayLabels(c.win, c.t), has: i => steps[i] != null || ignored(c.win[i], 'steps'),
    tip: i => `${esc(mdw(c.win[i]))}<br>${steps[i] != null ? `<b>${f0(steps[i])}</b> 步` : '步数标了不算'}${c.win[i] === c.t ? '（到现在为止）' : !wornA[i] ? `<br>${offWhy(c.win[i])}` : ''}`,
  });
  const cA = `<div class="dv-ct">活动能量 <small>kcal</small></div>` + plot({
    n: c.n, y: nice(0, Math.max(...act.filter(isNum), ...base.filter(isNum), 100), 3), H: 116, color: 'var(--plate-red)', aria: `活动能量，${bd.length} 天加了餐`,
    layers: [lay.cols(act, cls), lay.target(base, c.n, true), lay.dots(act.map((v, i) => bonus[i] ? v : null), 'm-bonus', c.n > 40 ? 2.4 : 3.5)],
    xl: dayLabels(c.win, c.t), has: i => act[i] != null || ignored(c.win[i], 'activeKcal'),
    tip: i => `${esc(mdw(c.win[i]))} · ${kind(c.win[i])}<br>${act[i] != null ? `活动 <b>${f0(act[i])}</b> kcal` : '活动能量标了不算'}${c.win[i] === c.t ? '（到现在为止）' : ''}${base[i] != null ? ` · 平常 ${f0(base[i])}` : ''}${bonus[i] ? `<br>目标加了 <b>${f0(bonus[i])}</b> kcal（碳水 +${f0(bonus[i] / 4)} g）` : ''}${c.win[i] !== c.t && !wornA[i] && act[i] != null ? `<br>${offWhy(c.win[i])}` : ''}`,
  });
  const usual = info.bT != null || info.bR != null;
  return {
    top: head(avgSteps != null ? f0(avgSteps) : '—', '步/天', avgSteps != null ? `${c.rl}平均（按戴了表、已过完的 ${info.wornDays} 天）` : `${c.rl}还没有戴了表、已过完的一天`),
    body: kvs([['活动能量', avgAct != null ? `${f0(avgAct)}<small>kcal/天</small>` : '—'],
      usual ? ['平常活动', `${info.bT != null ? f0(info.bT) : '—'}<small>训练日</small>`, `休息日 ${info.bR != null ? f0(info.bR) : '—'}`] : ['平常活动', '<span class="na">—</span>', '同类日子满 4 天后算'],
      ['加了餐', `${bd.length}<small>天</small>`, bd.length ? `平均 +${f0(info.bonusAvg)} kcal` : '']])
      + fromNote(c) + cS + cA + legend([sBase != null ? ['ln', 'var(--muted)', `平常步数 ${f0(Math.round(sBase / 100) * 100)}`] : null, base.some(isNum) ? ['ln', 'var(--muted)', '平常活动（同类日子的中位数）'] : null,
        bd.length ? ['dot', 'var(--accent)', '加了餐的日子'] : null, c.win.some((d, i) => d !== c.t && !wornA[i] && (steps[i] != null || act[i] != null)) ? ['sq off', 'var(--muted)', '不算进平常（没戴表等）'] : null,
        steps[c.n - 1] != null || act[c.n - 1] != null ? ['sq now', 'var(--plate-green)', '今天（到现在为止）'] : null]),
    info,
  };
}

function cDiet(c) {
  const rows = c.win.map(d => { const it = intakeOf(d), tg = targetOf(d); return { d, it, any: anyFood(it), kcal: it.sum?.kcal ?? 0, prot: it.sum?.protein ?? 0, tk: isNum(tg?.kcal) ? tg.kcal : null, tp: isNum(tg?.protein) ? tg.protein : null, part: partialDay(it), bonus: tg?.bonus || 0 }; });
  const food = rows.filter(r => r.any), over = food.filter(r => r.d < c.t);
  const info = { food: food.length };
  if (!food.length) return { body: empty(c.from ? `${c.rl}没有饮食记录（最近一次是 ${md(c.latest)}）。` : '还没有饮食记录。开饭前拍一张，Claude 处理后这里会显示每天吃了多少、和目标差多少。'), info };
  const hit = r => r.tp != null && r.prot >= 0.9 * r.tp;
  const pDays = food.filter(r => r.tp != null && (r.d < c.t || hit(r)));
  const kAvg = mean(over.map(r => r.kcal)), pAvg = mean(over.map(r => r.prot)), kT = mean(over.map(r => r.tk).filter(isNum)), pT = mean(over.map(r => r.tp).filter(isNum));
  const diet = S.plan?.diet || {};
  Object.assign(info, { kAvg, pAvg, kT, pT, hit: pDays.filter(hit).length, of: pDays.length, part: over.filter(r => r.part).length, over: over.length, diet, w: latestW() ?? S.profile?.weight });
  const kv = rows.map(r => r.any ? r.kcal : null), pv = rows.map(r => r.any ? r.prot : null);
  const started = r => !c.from || r.d >= c.from;  // no target marks on the days before the first meal was logged
  const cls = base => i => `${base}${rows[i].part ? ' part' : ''}`;
  const why = r => [r.it.logged < 2 ? `只记了 ${r.it.logged ?? 0} 餐` : '', r.it.waiting ? `${r.it.waiting} 餐待分析` : ''].filter(Boolean).join('，');
  const tip = i => { const r = rows[i]; return `${esc(mdw(r.d))} · ${isRest(r.d) ? '休息日' : '训练日'}${r.bonus ? `（活动 +${f0(r.bonus)}）` : ''}<br>热量 <b>${f0(r.kcal)}</b>${r.tk != null ? ` / ${f0(r.tk)}` : ''} kcal<br>蛋白质 <b>${f0(r.prot)}</b>${r.tp != null ? ` / ${f0(r.tp)}` : ''} g${r.part ? `<br>记录不全：${esc(why(r))}` : ''}`; };
  const cK = `<div class="dv-ct">热量 <small>kcal</small></div>` + plot({
    n: c.n, y: nice(0, Math.max(...kv.filter(isNum), ...rows.map(r => r.tk || 0)) * 1.04, 4), H: 120, color: 'var(--plate-blue)',
    hatch: true, aria: `${c.rl}每天热量，平均 ${kAvg != null ? Math.round(kAvg) : '无'}`, layers: [lay.cols(kv, cls('m-col')), lay.target(rows.map(r => started(r) ? r.tk : null), c.n)],
    xl: dayLabels(c.win, c.t), has: i => rows[i].any, tip,
  });
  const cP = `<div class="dv-ct">蛋白质 <small>g</small></div>` + plot({
    n: c.n, y: nice(0, Math.max(...pv.filter(isNum), ...rows.map(r => r.tp || 0)) * 1.04, 3), H: 104, color: 'var(--plate-red)',
    hatch: true, aria: `每天蛋白质，达标 ${info.hit} 天，共 ${info.of} 天`, layers: [lay.cols(pv, cls('m-col')), lay.target(rows.map(r => started(r) ? r.tp : null), c.n)],
    xl: dayLabels(c.win, c.t), has: i => rows[i].any, tip,
  });
  // The verdict on the big number: the average against the target over the days that are over and fully logged (2+).
  const full = over.filter(r => !r.part && r.tk != null), fk = mean(full.map(r => r.kcal)), ft = mean(full.map(r => r.tk));
  const dev = full.length >= 2 && ft ? (fk - ft) / ft : null;
  const verdict = dev == null ? '' : Math.abs(dev) <= 0.1 ? tag('good', '热量在目标附近') : tag('adjust', dev > 0 ? '热量偏多' : '热量偏少');
  // Against Claude's line (it looks at 7–14 days): the last 7 days that are over and fully logged, 3 of them at least.
  const w7 = rows.filter(r => r.any && !r.part && r.d < c.t && r.d >= addDays(c.t, -7) && r.tk != null && r.tp != null);
  const k7 = w7.length >= 3 ? mean(w7.map(r => r.kcal)) / mean(w7.map(r => r.tk)) - 1 : null, p7 = w7.length >= 3 ? mean(w7.map(r => r.prot)) / mean(w7.map(r => r.tp)) : null;
  const state = k7 == null ? null : p7 < 0.8 || Math.abs(k7) > 0.15 ? { lv: 'adjust' } : p7 >= 0.9 && Math.abs(k7) <= 0.1 ? { lv: 'good' } : null;
  const todayR = rows[rows.length - 1];
  const top = kAvg != null ? head(f0(kAvg), kT != null ? `/${f0(kT)} kcal` : 'kcal', `${c.rl}平均每天（按记了饮食、已过完的 ${over.length} 天）`, verdict)
    : head(f0(todayR.kcal), todayR.tk != null ? `/${f0(todayR.tk)} kcal` : 'kcal', '今天到现在，还没有过完的一天');
  return {
    top,
    body: kvs([['蛋白质', pAvg != null ? `${f0(pAvg)}<small>${pT != null ? `/${f0(pT)}` : ''} g</small>` : '—'], ['蛋白质达标', `${info.hit}<small>/${info.of} 天</small>`, '到目标的 90%'], ['记录不全', `${info.part}<small>天</small>`, info.part ? '斜线的柱子' : '']])
      + fromNote(c) + cK + cP + legend([['sq', 'var(--plate-blue)', '热量'], ['sq', 'var(--plate-red)', '蛋白质'], ['ln', 'var(--ink)', '当天目标'], rows.some(r => r.any && r.part) ? ['sq hatch', 'var(--muted)', '记录不全'] : null]),
    info, state,
  };
}

// Seven days as a strip: a filled mark with the plan day's letter on the days trained; today's planned day hollow.
function dayStrip(c) {
  let planNow = false;
  const cells = c.win.map(d => {
    const tr = trainedOn(d), k = kindOf(d), id = typeof k === 'string' && k !== 'rest' && k !== 'train' ? k : '';
    const pl = d === c.t && !tr && !!id; if (pl) planNow = true;
    const say = `${mdw(d)}：${tr ? `练了${id ? ` ${id}` : ''}` : pl ? `计划练 ${id}，还没练` : '没练'}`;
    return `<div class="dv-dd${tr ? ' on' : ''}${pl ? ' plan' : ''}${d === c.t ? ' now' : ''}" role="listitem" aria-label="${esc(say)}"><span class="w">${d === c.t ? '今天' : '周' + WD[parseD(d).getDay()]}</span><span class="m">${tr ? esc(id || '练') : pl ? esc(id) : ''}</span><span class="n">${esc(md(d))}</span></div>`;
  }).join('');
  return { html: `<div class="dv-days" role="list" aria-label="${esc(c.rl)}每天练没练">${cells}</div>`, planNow };
}
function cTraining(c) {
  const weeks = weeksOf(c), plan = planned();
  // Weeks that ended before the first session are no data, not a week of zero.
  const cnt = weeks.map(mon => { if (c.from && addDays(mon, 6) < c.from) return null; let n = 0; for (let i = 0; i < 7; i++) { const d = addDays(mon, i); if (d <= c.t && trainedOn(d)) n++; } return n; });
  const inWin = c.win.filter(trainedOn).length, wkNow = cnt[cnt.length - 1] ?? 0;
  const from = c.n < 28 ? addDays(c.t, -27) : c.win[0], exLabel = c.n < 28 ? '近 4 周' : c.rl;
  const top = exercises().map(e => ({ ...e, recent: e.list.filter(s => s.d >= from && s.d <= c.t) })).filter(e => e.recent.length)
    .sort((a, z) => z.recent.length - a.recent.length || z.recent[z.recent.length - 1].d.localeCompare(a.recent[a.recent.length - 1].d)).slice(0, 5);
  const done = cnt.slice(0, -1).filter(isNum);
  const info = { inWin, plan, weeks: weeks.length, perWk: mean(done.length ? done : cnt.filter(isNum)), top, exLabel };
  if (!c.from) return { body: empty('还没有训练记录。按计划记一次训练，或连上训记让 Claude 同步过来。'), info };
  let chart, lg;
  if (c.n <= 7) {  // a week: day by day
    const st = dayStrip(c); chart = st.html;
    lg = legend([['dot', 'var(--plate-red)', '练了（字母是计划里的哪天）'], st.planNow ? ['dot ring', 'var(--plate-red)', '今天计划练的'] : null]);
  } else {
    chart = plot({
      n: weeks.length, y: nice(0, Math.max(plan, ...cnt.filter(isNum), 3), 3), fmt: v => String(v), H: 112, color: 'var(--plate-red)', aria: `每周训练天数，计划每周 ${plan} 天`,
      layers: [lay.cols(cnt, i => `m-col${i === weeks.length - 1 ? ' now' : ''}`), plan ? lay.hline(plan, 'm-goal', `计划 ${plan}`) : null].filter(Boolean),
      xl: weeks.map((d, i) => ({ i, t: md(d), now: i === weeks.length - 1 })), has: i => cnt[i] != null,
      tip: i => `${esc(md(weeks[i]))} 那周${i === weeks.length - 1 ? '（本周，还没过完）' : ''}<br>练了 <b>${cnt[i]}</b> 天${plan ? ` / 计划 ${plan}` : ''}`,
    });
    lg = legend([['sq', 'var(--plate-red)', '每周练了几天'], ['sq now', 'var(--plate-red)', '本周（还没过完）'], plan ? ['ln', 'var(--good)', '计划'] : null]);
  }
  const rowsH = top.map(e => {
    const xs = e.recent, last = xs[xs.length - 1], a = xs.find(s => isNum(s.val)), b = [...xs].reverse().find(s => isNum(s.val));
    let ch = '';
    if (a && b && a !== b) {
      const dv = b.val - a.val, good = lowerBetter(e.mode) ? dv < 0 : dv > 0;
      ch = `<span class="ch${good ? ' up' : ''}">${e.mode === 'reps' || e.mode === 'sec' ? sgn(dv, f0) : sgn(dv)}${e.mode === 'reps' ? ' 次' : e.mode === 'sec' ? ' 秒' : ' kg'}<small>${{ kg: 'e1RM', top: '最重', 'bw+': 'e1RM', assist: '助力', reps: '次数', sec: '时长' }[e.mode]}</small></span>`;
    }
    return `<button type="button" class="dv-ex" data-act="d-ex" data-n="${esc(e.name)}"><span class="nm"><b>${esc(e.name)}</b><small>${xs.length} 次 · 最近 ${esc(topTxt(last.top, e.mode))}</small></span>${spark(xs.map(s => s.val), lowerBetter(e.mode))}${ch}</button>`;
  }).join('');
  const since = !inWin && c.latest ? ` · 上次 ${esc(md(c.latest))}，${daysBetween(c.latest, c.t)} 天前` : '';
  return {
    top: head(String(inWin), '天', `${c.rl}练了几天${plan ? ` · 计划每周 ${plan} 天` : ''}${since}`, plan ? (wkNow >= plan ? tag('good', '本周练满了') : tag('ok', `本周 ${wkNow}/${plan}`)) : ''),
    body: fromNote(c) + chart + lg
      + (rowsH ? `<div class="sub-h">主要动作（${esc(exLabel)}）</div><div class="dv-exs">${rowsH}</div>` : '')
      + '<div class="dv-links"><button type="button" class="link" data-act="d-hist">历史 ›</button><button type="button" class="link" data-act="d-exs">动作 ›</button></div>',  // the 训练 tab's pages
    info,
  };
}

/* 围度和体脂: the number the goal watches (腰围 or 臂围) first, every measure with its last change, 腰臀比, and the
   body-fat trend over the range. */
function cBody(c, base) {
  const cp = comp(), goal = S.profile?.goal, want = Object.fromEntries(FOCUS[goal] || []);
  const have = COMP.map(([k]) => k).filter(k => cp[k].length);
  const info = { cp, want, have };
  if (!have.length) return { body: `${empty('还没量过围度和体脂率。每两周早上空腹量一次腰围（肚脐那一圈），比体重更能看出长的是肌肉还是脂肪。')}<button type="button" class="btn sm ghost dv-btn" data-act="new-body">记一次围度</button>`, info };
  const last = k => cp[k][cp[k].length - 1], prev = k => cp[k].length > 1 ? cp[k][cp[k].length - 2] : null;
  const dlt = k => prev(k) ? last(k).v - prev(k).v : null;
  const lead = Object.keys(want).find(k => cp[k].length) || (cp.bodyFat.length ? 'bodyFat' : have[0]);
  const L = last(lead), Pv = prev(lead), dv = dlt(lead), word = compWord(lead, dv, want[lead]);
  const top = head(f1(L.v), compUnit(lead), `${esc(compName(lead))} · ${esc(md(L.d))}${lead === 'bodyFat' ? (bfSrc(L.src) ? ` · ${bfSrc(L.src)}` : '') : ' 量的'}${Pv ? ` · 比 ${esc(md(Pv.d))} ${sgn(dv)} ${compUnit(lead)}` : ' · 第一次量'}`, word ? tag(word[0], word[1]) : '');
  const row = k => {
    const xs = cp[k], a = last(k), b = prev(k), d = dlt(k), w = want[k] || 0;
    const cls = d == null || Math.abs(d) < 0.5 || !w ? '' : d * w > 0 ? ' good' : ' bad';
    const sub = `${md(a.d)}${b ? ` · 上次 ${md(b.d)}` : ' · 第一次'}`;
    return `<div class="dv-m${w ? ' focus' : ''}"><span class="nm"><b>${esc(compName(k))}${w ? `<i>${w < 0 ? '往下' : '往上'}</i>` : ''}</b><small>${esc(sub)}</small></span>${spark(xs.slice(-8).map(x => x.v), w < 0, !w)}<span class="val"><b>${f1(a.v)}<small>${compUnit(k)}</small></b>${d != null ? `<small class="ch${cls}">${sgn(d)}</small>` : ''}</span></div>`;
  };
  // 腰臀比: the latest day with both, else each one's latest.
  let whr = null;
  if (cp.waist.length && cp.hip.length) {
    const hipOn = new Map(cp.hip.map(p => [p.d, p.v])), both = [...cp.waist].reverse().find(p => hipOn.has(p.d));
    const w = both || last('waist'), h = both ? { d: both.d, v: hipOn.get(both.d) } : last('hip');
    whr = { v: w.v / h.v, d: w.d > h.d ? w.d : h.d };
  }
  const fem = S.profile?.sex === 'female', lim = fem ? 0.85 : 0.9;
  const whrRow = whr ? `<div class="dv-m"><span class="nm"><b>腰臀比</b><small>${lim.toFixed(2)} 以下较好</small></span><span></span><span class="val"><b>${f2(whr.v)}</b><small class="ch${whr.v > lim ? ' bad' : ''}">${whr.v > lim ? '偏高' : '在范围内'}</small></span></div>` : '';
  const miss = MEAS.filter(([k]) => !cp[k].length).map(([, n]) => n);
  Object.assign(info, { lead, whr, lim, miss });
  // 体脂率 over the range (from its first day when that is later); a dot a day measured.
  let chart = '';
  const cb = ctxFor(base, 'bodyFat'), byD = new Map(cp.bodyFat.map(p => [p.d, p])), vals = cb.win.map(d => byD.get(d)?.v ?? null);
  if (vals.filter(isNum).length >= 2) {
    const xs = vals.filter(isNum);
    chart = `<div class="dv-ct">体脂率 <small>%</small></div>${fromNote(cb)}` + plot({
      n: cb.n, y: nice(Math.min(...xs) - 0.4, Math.max(...xs) + 0.4, 3), fmt: v => String(+v.toFixed(1)), H: 112, R: 32, color: 'var(--plate-blue)',
      aria: `${cb.rl}体脂率，最近 ${f1(L.v)}%`,
      layers: [lay.line(vals, 'm-line', 21), lay.dots(vals, 'm-dot', cb.n > 40 ? 2.4 : 3.2), lay.endLabel(vals, f1(xs[xs.length - 1]))],
      xl: dayLabels(cb.win, cb.t), has: i => vals[i] != null,
      tip: i => { const p = byD.get(cb.win[i]); return `${esc(mdw(cb.win[i]))}<br>体脂率 <b>${f1(p.v)}</b>%${bfSrc(p.src) ? `<br><span class="s">${bfSrc(p.src)}</span>` : ''}`; },
    });
  } else if (cp.bodyFat.length) {
    const n = vals.filter(isNum).length;
    chart = `<p class="dv-note">${n ? `体脂率${esc(cb.rl)}只测了 1 次，再测 1 次就能画出走势。` : `${esc(cb.rl)}没测体脂率（最近一次是 ${esc(md(last('bodyFat').d))}）。`}</p>`;
  }
  const say = FOCUS_SAY[goal] ? `<p class="dv-focus">${FOCUS_SAY[goal]}</p>` : '';
  return {
    top,
    body: `${say}<div class="dv-ms">${have.map(row).join('')}${whrRow}</div>${miss.length ? `<p class="dv-note">还没量：${esc(miss.join('、'))}（每两周量一次就够）</p>` : ''}${chart}`,
    info,
  };
}

/* 身材照: two shots side by side (正面 / 侧面 / 背面), either date can be changed; Claude's comparison under them. */
function cPhotos(c) {
  const list = shots(), info = { n: list.length };
  const act = '<button type="button" class="link" data-act="progress-new">拍一组</button>';
  if (!list.length) return { body: `${empty('还没有身材照。每 2–4 周拍一组正面、侧面、背面，并排一比，肩、背、腰的变化比体重直观得多。')}<button type="button" class="btn sm ghost dv-btn" data-act="progress-new">拍第一组</button>`, info };
  const [a, b] = pairOf(list), pair = b ? [b, a] : [a];
  const v = VIEWS.some(([k]) => k === pv.v) && pair.some(p => shotHas(p, pv.v)) ? pv.v : (VIEWS.find(([k]) => shotHas(a, k)) || VIEWS.find(([k]) => shotHas(b, k)))[0];
  const vName = VIEWS.find(x => x[0] === v)[1];
  const gap = daysBetween(list[0].date, c.t);
  const remind = gap > 14 ? `<p class="dv-remind">上次拍是 ${esc(mdw(list[0].date))}，${gap} 天了。同一时间、同样光线再拍一组，才看得出这段时间的变化。</p>` : '';
  const seg = `<div class="seg dv-pv" role="group" aria-label="哪一面">${VIEWS.map(([k, l]) => `<button type="button" data-act="d-pv" data-v="${k}" aria-pressed="${k === v}"${pair.some(p => shotHas(p, k)) ? '' : ' disabled'}>${l}</button>`).join('')}</div>`;
  const pick = (side, cur, other) => list.length > 1
    ? `<label class="dv-pdate"><span class="vh">${side === 'b' ? '左边：之前那组' : '右边：后来那组'}</span><select id="d-pv-${side}">${list.filter(p => p !== other).map(p => `<option value="${esc(p.date)}"${p === cur ? ' selected' : ''}>${esc(mdW(p.date))}</option>`).join('')}</select></label>`
    : `<div class="dv-pdate one">${esc(mdW(cur.date))}</div>`;
  const img = p => shotHas(p, v)
    ? `<button type="button" class="dv-ph" data-act="d-photo" data-id="${esc(p.photos[v])}" aria-label="看大图：${esc(md(p.date))} ${vName}"><img src="${esc(photoSrc(p.photos[v]))}" alt="${esc(md(p.date))} ${vName}" loading="lazy" decoding="async"></button>`
    : `<div class="dv-ph none">这组没拍${vName}</div>`;
  const cols = b ? `<div class="dv-pair"><div class="dv-pc">${pick('b', b, a)}${img(b)}</div><div class="dv-pc">${pick('a', a, b)}${img(a)}</div></div>`
    : `<div class="dv-pair"><div class="dv-pc">${pick('a', a, null)}${img(a)}</div><div class="dv-pc"><div class="dv-pdate one">下一组</div><div class="dv-ph next">两周后同一时间、同样光线再拍一组，就能和这组并排比</div></div></div>`;
  const apart = b ? daysBetween(b.date, a.date) : 0;
  const cap = b ? `<p class="dv-note">相隔 ${apart} 天${apart >= 14 ? `（约 ${Math.round(apart / 7)} 周）` : ''} · 点照片看大图</p>` : '<p class="dv-note">点照片看大图</p>';
  // Claude's comparison: the review on the right-hand (later) shot.
  const r = a.review && typeof a.review === 'object' && typeof a.review.comment === 'string' && a.review.comment.trim() ? a.review : null;
  let say = '';
  if (r) {
    const at = r.reviewedAt && !isNaN(Date.parse(r.reviewedAt)) ? ymd(new Date(r.reviewedAt)) : null, stale = a.needsReview === true;
    const vs = isDate(r.compareTo) ? (b && r.compareTo === b.date ? `对比 ${md(r.compareTo)}` : `和 ${md(r.compareTo)} 那组比的`) : '';
    const chg = Array.isArray(r.changes) ? r.changes.map(x => String(x ?? '').trim()).filter(Boolean) : [];
    say = `<div class="dv-say ok${stale ? ' dim' : ''}"><div class="who"><span class="ag-mark" aria-hidden="true"></span><span class="by">Claude${at ? ` · ${esc(md(at))}` : ''}${vs ? ` · ${esc(vs)}` : ''}</span></div>
      <p class="say">${esc(r.comment.trim())}</p>${chg.length ? `<ul class="dv-chg">${chg.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${stale ? '<p class="upd">照片换过了，等 Claude 下次处理时重新看</p>' : ''}</div>`;
  } else if (a.needsReview === true) say = `<p class="dv-note dv-wait"><span class="ag-mark" aria-hidden="true"></span>${b ? `Claude 下次处理时会把 ${esc(md(a.date))} 这组和之前的比一比，写在这里。` : 'Claude 下次处理时会看这组照片；拍了下一组以后，它会对比着说哪里变了。'}</p>`;
  const note = typeof a.note === 'string' && a.note.trim() ? `<p class="dv-note">${esc(md(a.date))} 的备注：${esc(a.note.trim())}</p>` : '';
  return { act, body: `${remind}${seg}${cols}${cap}${say}${note}`, info: { ...info, gap, a: a.date, b: b?.date } };
}

/* ---------- the six cards ---------- */
// A sub-view or card that needs a look: its own verdict, or Claude's current line, says adjust.
function flagged(k, t, r) { const s = sayState(k, t, r); return r?.state?.lv === 'adjust' || (!!s && !s.old && !s.clash && s.c.lv === 'adjust'); }
/* 身体变化: 体重 / 围度和体脂 / 身材照 on one switch (the pick kept per account on this phone). 体重 has the weekly rate
   (每周变化) under its chart and Claude's lines on both. */
const SUBS = [['weight', '体重'], ['body', '围度和体脂'], ['photos', '身材照']];
const subKey = () => 'lsj-data-body:' + (S?.me?.id || '');
const curSub = () => { const v = lsGet(subKey()); return SUBS.some(([k]) => k === v) ? v : 'weight'; };
function shapeCard(res, t) {
  const sub = curSub();
  const dot = { weight: flagged('weight', t, res.weight) || flagged('progress', t, res.progress), body: flagged('body', t, res.body), photos: false };
  const seg = `<div class="seg dv-sub" role="group" aria-label="看哪一项">${SUBS.map(([k, l]) => `<button type="button" data-act="d-sub" data-v="${k}" aria-pressed="${k === sub}"${dot[k] && k !== sub ? ' class="flag"' : ''}>${l}${dot[k] && k !== sub ? '<span class="vh">（要留意）</span>' : ''}</button>`).join('')}</div>`;
  let panel, act = '';
  if (sub === 'weight') {
    const r = res.weight;
    panel = `${seg}${r.top || ''}${sayHTML(['weight', 'progress'], t, res)}${r.body || ''}${res.progress.line || ''}`;
  } else if (sub === 'body') {
    const r = res.body;
    panel = `${seg}${r.top || ''}${sayHTML(['body'], t, res)}${r.body || ''}`;
  } else {
    const r = res.photos; act = r.info?.n ? r.act || '' : '';
    panel = `${seg}${r.body || ''}`;
  }
  return card('shape', '身体变化', sub, panel, act);
}
// 睡眠和恢复: the sleep chart; with 进阶显示 on, resting HR and HRV under it (and Claude's line on recovery too).
function sleepCard(res, t, adv) {
  const r = res.sleep, rec = adv ? res.recovery.block || '' : '';
  return card('sleep', titleOf('sleep'), 'sleep', `${r.top || ''}${sayHTML(adv ? ['sleep', 'recovery'] : ['sleep'], t, res)}${r.body || ''}${rec}`);
}
/* 报告: every report Claude wrote, newest first, one line each (kind · title · date), by kind (计划 takes the plan notes
   and the phase summaries); each opens app.js's report sheet. The filter is kept on this phone. No card before the
   first report. */
const REP_KIND = { daily: '日报', weekly: '周报', plan: '计划', phase: '阶段', guide: '说明' };
const RF = [['all', '全部'], ['weekly', '周报'], ['daily', '日报'], ['plan', '计划']];
const rfKey = 'lsj-d-rf';
let repN = 6;
const curRf = () => { const v = lsGet(rfKey); return RF.some(([k]) => k === v) ? v : 'all'; };
const inRf = (r, f) => f === 'all' || r.kind === f || (f === 'plan' && r.kind === 'phase');
const str = v => typeof v === 'string' ? v : '';
function allReports() {
  return (Array.isArray(S.reports) ? S.reports : []).filter(r => r && typeof r === 'object' && typeof r.kind === 'string' && r.kind && typeof r.id === 'string')
    .sort((a, z) => str(z.date).localeCompare(str(a.date)) || str(z.createdAt).localeCompare(str(a.createdAt)) || (a.kind === 'weekly' ? -1 : z.kind === 'weekly' ? 1 : 0));
}
function reportsCard() {
  const all = allReports(); if (!all.length) return '';
  const f = curRf(), list = all.filter(r => inRf(r, f)), shown = list.slice(0, repN);
  const chips = `<div class="chips dv-rf" role="group" aria-label="报告类型">${RF.map(([k, l]) => `<button type="button" class="chip" data-act="d-rf" data-v="${k}" aria-pressed="${k === f}">${l}</button>`).join('')}</div>`;
  const row = r => `<li><button type="button" class="dv-rep" data-act="d-rep" data-id="${esc(r.id)}"><span class="kind ${esc(r.kind)}">${esc(REP_KIND[r.kind] || '报告')}</span>
    <span class="m">${esc(r.title || str(r.summary).split('\n')[0] || REP_KIND[r.kind] || '报告')}</span><span class="d">${esc(isDate(r.date) ? md(r.date) : '')}</span></button></li>`;
  const more = list.length > shown.length ? `<button type="button" class="link dv-rmore" data-act="d-rmore">再看 ${Math.min(20, list.length - shown.length)} 条（共 ${list.length}）</button>` : '';
  return `<section class="sec dv-card" id="dv-reports"><div class="sec-h"><h2>报告</h2>${qBtn('reports', '报告')}</div>${chips}
    ${shown.length ? `<ul class="panel dv-reps">${shown.map(row).join('')}</ul>` : '<p class="dv-note dv-rnone">这一类还没有。</p>'}${more}</section>`;
}

/* ---------- the view ---------- */
const NEED = ['meals', 'workouts', 'body', 'water', 'sleep', 'days', 'health', 'plan', 'profile'];
const KEYS = ['weight', 'body', 'photos', 'progress', 'sleep', 'recovery', 'activity', 'diet', 'training'];
const FN = { weight: cWeight, body: cBody, photos: cPhotos, progress: cProgress, sleep: cSleep, recovery: cRecovery, activity: cActivity, diet: cDiet, training: cTraining };
let cache = { deps: null, html: '', info: {} };
function view() {
  if (!bind()) return '<div class="panel empty">正在读取…</div>';
  const t = tday(), vw = document.getElementById('view')?.clientWidth || 358;
  PW = Math.round(Math.min(534, Math.max(260, vw - 34)));
  newMemo();
  const range = NEED.every(k => S.loaded.has(k)) ? curRange() : +lsGet(rangeKey()) || 30;
  if (has('ensureRange')) A.ensureRange(addDays(t, -(range + 35)));  // the range, last week and 28 days of baseline before it
  const adv = advOn();
  const deps = [S.meals, S.workouts, S.body, S.water, S.sleep, S.days, S.health, S.plan, S.profile, S.prefs, S.reports, S.insights, S.todos, S.status, S.progress, S.loaded.size, range, t, PW,
    `${pv.a}|${pv.b}|${pv.v}|${adv}|${curSub()}|${curRf()}|${repN}`];
  if (cache.deps && deps.every((d, i) => d === cache.deps[i])) return cache.html;
  for (const k of [...CH.keys()]) if (k.startsWith('c')) CH.delete(k);
  chartSeq = 0;
  let html, info = {};
  if (!NEED.every(k => S.loaded.has(k))) html = `<div class="panel empty" style="margin-top:6px">正在读取…</div>`;
  else {
    const n = range, win = Array.from({ length: n }, (_, i) => addDays(t, i - n + 1));
    const base = { t, n, win, rl: `近 ${n} 天`, r0: win[0], n0: n };
    const res = {};
    for (const k of KEYS) { const c = ctxFor(base, k), r = { ...FN[k](c, base), latest: c.latest }; res[k] = r; info[k] = { ...r.info, c }; }
    const cards = shapeCard(res, t) + sleepCard(res, t, adv) + plain('activity', t, res.activity) + plain('diet', t, res.diet) + plain('training', t, res.training) + reportsCard();
    const seg = `<div class="dv-range" role="group" aria-label="时间范围">${RANGES.map(r => `<button type="button" data-act="d-range" data-v="${r}" aria-pressed="${r === range}">${r} 天</button>`).join('')}</div>`;
    // A new account: one line instead of a table of dashes; each card still says what it will show
    const fresh = !S.meals.length && !S.workouts.length && !weighIns().length && !Object.keys(S.health).length && !Object.keys(S.sleep).length;
    const week = fresh ? weekWithReport(t, `<section class="sec" id="dv-week"><div class="sec-h"><h2>本周</h2></div><div class="panel empty">记上几天之后，这里会把本周和上周放在一起比：吃了多少、蛋白质够不够、练了几次、睡了多久、体重怎么走。</div></section>`) : weekHTML(t);
    html = `${week}${fresh ? '' : `<div class="sec-h dv-trend"><h2>趋势</h2>${seg}</div>`}${cards}`;
    info.c = base;
  }
  html = `<div class="dv">${html}</div>`;
  cache = { deps, html, info };
  return html;
}
function rerender() { cache.deps = null; if (has('render')) A.render(); }

/* ---------- 「这是什么」 sheets: what the number is, with this person's own numbers ---------- */
const li = xs => `<ul>${xs.filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`;
const sec = (h, body) => `<h4>${esc(h)}</h4>${body}`;
const p = t => `<p>${t}</p>`;
// A card's sheet: 体重 with 每周变化 (its line under the chart), 睡眠 with 恢复 when 进阶显示 shows it.
const part = h => `<h3 class="dv-ih">${esc(h)}</h3>`;
function infoHTML(key) {
  if (key === 'weight') return infoPart('weight') + part('每周变化') + infoPart('progress');
  if (key === 'sleep' && advOn()) return infoPart('sleep') + part('恢复：静息心率和 HRV') + infoPart('recovery');
  return infoPart(key);
}
function infoPart(key) {
  const inf = cache.info[key] || {}, c = inf.c || cache.info.c || { rl: '近 30 天', n: 30 };
  const prof = S.profile || {}, goal = prof.goal, w = latestW() ?? prof.weight;
  if (key === 'weight') return [
    sec('这是什么', p('体重每天会上下浮动 0.5–1.5 kg：前一天吃得咸、碳水多、喝水多，或者还没排便，第二天都会重一些，这些主要是水，不是长了肉或脂肪。所以单天的涨跌说明不了什么，看 7 日均值（蓝线）：每个点是那天和前 6 天称到的体重的平均。')),
    sec('你的数据', inf.lastMA != null ? li([`7 日均值 <b>${f1(inf.lastMA)} kg</b>（${esc(md(inf.last.d))}）`, `${c.rl}称了 ${inf.pts} 天，单天和均值平均差 ±${f1(inf.dev)} kg`, `${c.rl}里 7 日均值变了 ${sgn(inf.change)} kg`,
      inf.tw != null ? `目标体重 ${kgTxt(inf.tw)} kg，${Math.abs(inf.tw - inf.lastMA) < 0.3 ? '已经到了' : `还差 ${f1(Math.abs(inf.tw - inf.lastMA))} kg`}` : '还没填目标体重，可以在「我的 → 基础信息」里填']) : p('称满 2 次后这里会有你的数。')),
    sec('怎么称最准', p('起床、上完厕所、吃喝之前称，穿得差不多，用同一台秤。每周至少称 4 次，均值才稳。')),
    sec('什么时候要在意', p(`单天突然 +1 kg 不用管。7 日均值连着两三周朝不想要的方向走，才说明吃多了或吃少了，具体速度看下面的「每周变化」。`)),
  ].join('');
  if (key === 'progress') {
    const b = bandOf(), kg = w ? b.map(x => x / 100 * w) : null, r = inf.rate;
    const target = goal === 'muscle' ? `增肌${prof.level === 'new' ? '、新手' : ''}：每周 ${sgn(b[0], f2)}% ~ ${sgn(b[1], f2)}%${kg ? `，按你 ${f1(w)} kg 约每周 ${sgn(kg[0], f2)} ~ ${sgn(kg[1], f2)} kg，一个月 ${sgn(kg[0] * 4.3)} ~ ${sgn(kg[1] * 4.3)} kg` : ''}。${prof.level === 'new' ? '' : '新手长得快一些（每周 +0.25% ~ +0.5%）。'}`
      : goal === 'fatloss' ? `减脂：每周 -0.5% ~ -1%${kg ? `，按你 ${f1(w)} kg 约每周 ${sgn(kg[1], f2)} ~ ${sgn(kg[0], f2)} kg` : ''}。`
      : goal === 'recomp' ? '减脂增肌：体重基本不动（每周 -0.25% ~ +0.1%），主要看腰围往下、力量往上。'
      : goal === 'lean' ? `薄肌：体重稳住或每周慢慢降（每周 -0.5% ~ +0.1%${kg ? `，按你 ${f1(w)} kg 约每周 ${sgn(kg[0], f2)} ~ ${sgn(kg[1], f2)} kg` : ''}），同时腰围往下、训练重量往上。线条来自肌肉加低体脂，男生体脂 12–15%、女生 20–24% 就看得出，不用追求更低。`
      : '体重保持稳定：每周变化在 ±0.25% 以内。';
    const fix = goal === 'muscle' ? li(['涨得比范围快：多出来的主要是脂肪。每天少吃 150–200 kcal（先减零食和油），两周后再看。', '涨得慢或不涨：每天多吃 150–200 kcal，优先加碳水（米饭、面、水果），两周后再看。', '体重在涨、腰围也明显变粗：脂肪长得偏多，往范围下限靠。'])
      : goal === 'fatloss' ? li(['减得比范围快：容易掉肌肉、训练没劲、饿得难受。每天多吃 100–200 kcal。', '减得慢或不减：每天少吃 150–200 kcal，或每天多走 3000 步左右，两周后再看。', '蛋白质吃够、训练重量保持住，减掉的才主要是脂肪。'])
      : goal === 'lean' ? li(['体重在涨、腰围也变粗：每天少吃 150 kcal（先减零食、饮料和油），两周后再看。', '降得比范围快、训练重量往下掉：吃少了，每天多吃 100–200 kcal，加在训练日的主食上。', '腰围不动、重量也不涨：先看蛋白质够不够、每组是不是练到接近力竭，再看热量。'])
      : li(['体重变化超出范围两周以上，再按方向调热量，每次调 150–200 kcal。', '腰围比体重更能看出脂肪的变化，每两周量一次。']);
    return [
      sec('怎么算', p('每周体重变化占体重的百分比，用近 4 周每天的称重拟合一条趋势线来算，比只比两次称重稳得多。体重图下面那一行就是它。')),
      sec('你的目标范围', p(target)),
      sec('你现在', li([r ? `近 4 周 <b>${sgn(r.pct, f2)}%/周</b>（约 ${sgn(r.kgwk, f2)} kg/周，用了 ${r.n} 次称重）` : '称重还不够，至少两周、6 次以上才能算速度',
        inf.waist?.b ? `腰围 ${inf.waist.a ? `${f1(inf.waist.a.v)}（${esc(md(inf.waist.a.d))}）→ ` : ''}${f1(inf.waist.b.v)} cm（${esc(md(inf.waist.b.d))}）` : '还没量过腰围：肚脐那一圈，呼气后量，每两周一次',
        inf.tw != null ? (inf.eta ? (inf.eta.away ? `目标 ${kgTxt(inf.tw)} kg：现在的方向和目标相反` : `到 ${kgTxt(inf.tw)} kg：${esc(inf.eta.t)}${inf.eta.d ? `，大约 ${esc(md(inf.eta.d))}` : ''}（按现在的速度）`) : `目标 ${kgTxt(inf.tw)} kg`) : ''])),
      sec('偏离了怎么办', fix),
    ].join('');
  }
  if (key === 'sleep') return [
    sec('这是什么', p('每晚真正睡着的时间。Apple Watch 按心率和动作判断，不含躺着醒着的时间，所以比卧床时间短。日期是醒来的那天。')),
    sec('你的数据', inf.nights ? li([`${c.rl}平均睡着 <b>${hmm(inf.avg)}</b>，${inf.nights} 晚里 ${inf.enough} 晚够 7 小时`,
      inf.bed ? `入睡 ${clock(inf.bed[0])}–${clock(inf.bed[1])}，最早和最晚相差 ${f1((inf.bed[1] - inf.bed[0]) / 60)} 小时；一般在 ${clock(inf.bed[2])} 左右` : '',
      inf.wake ? `起床一般在 ${clock(inf.wake[2])} 左右（${clock(inf.wake[0])}–${clock(inf.wake[1])}）` : '',
      inf.stages ? `深睡平均 ${hmm(inf.deep)}（占 ${Math.round(inf.deepP * 100)}%），REM ${hmm(inf.rem)}（占 ${Math.round(inf.remP * 100)}%）` : '']) : p('有睡眠数据后这里会有你的数。')),
    sec('多少算够', p('成年人每晚睡着 7–9 小时。长期少于 7 小时，力量和训练质量会下降，更容易饿、更想吃甜的，增肌和减脂都会变慢。几点睡不要紧，入睡和起床的时间每天差不多（前后 1 小时以内）比偶尔补觉更重要。')),
    sec('深睡和 REM', p('深睡多在前半夜，身体的修复主要靠它，一般占睡着时间的 13–23%；REM 和记忆、情绪有关，一般占 20–25%。手表的分期是估算，看自己长期的变化就行，不用和别人比，也不用盯着某一晚。')),
    sec('怎么睡得更好', li(['先固定起床时间，入睡时间会慢慢跟着稳定', '睡前 8 小时内不喝咖啡、浓茶和功能饮料', '睡前 1 小时把灯调暗、放下手机；卧室凉一点、暗一点、安静一点', '睡前 2–3 小时吃完正餐，夜宵清淡、少一点'])),
  ].join('');
  if (key === 'recovery') {
    const r = inf.rhr, h = inf.hrv;
    return [
      sec('静息心率', p('安静、放松时每分钟心跳多少次，Apple Watch 用一天里你安静坐着、躺着时的数据估算。体能变好，它会慢慢降低。比平时明显偏高，常见原因是没睡好、累积疲劳、喝酒、天热或脱水，也可能是快生病了。')),
      sec('HRV（心率变异性）', p('相邻两次心跳间隔的变化幅度。Apple Watch 给的是 SDNN（单位毫秒），多在夜里和安静的时候测。一般越高说明身体越放松、恢复得越好。不同人差别很大，20 到 100 多毫秒都正常，所以只和你自己的基线比，不要和别人比。单次读数波动大，这里看 3 天平均。')),
      sec('基线和恢复偏差', p('基线是这一天之前 28 天的中位数，有数据的日子不到 14 天时不判断。静息心率比基线高 5 以上，或 HRV 的 3 天平均比基线低 15% 以上，同一种信号连续两天出现，就算恢复偏差。')),
      sec('你的数据', li([r ? `静息心率 ${f0(r.v)}（${esc(md(r.d))}）${r.b != null ? `，基线 ${f0(r.b)}，到 ${f0(r.b + 5)} 以上算偏高` : '，数据还不够 14 天，没有基线'}` : '还没有静息心率',
        h ? `HRV 3 天平均 ${f0(h.v)} ms${h.b != null ? `，基线 ${f0(h.b)} ms，低到 ${f0(h.b * 0.85)} 以下算偏低` : '，数据还不够 14 天，没有基线'}` : '还没有 HRV',
        `${c.rl}有 ${inf.flags || 0} 天恢复偏差`])),
      sec('偏差时怎么做', li(['照常练，但保持上次的重量、不冲新纪录，可以少做一两组', '当晚早点睡，多喝水，少喝酒', '连续好几天偏差，或者发烧、喉咙痛，就休息'])),
      p('<span class="hint">数据明显不对的那天（比如没戴表、表没贴紧），可以在「今日 → 身体」点健康数据，把那一项标成「这天不算」。</span>'),
    ].join('');
  }
  if (key === 'activity') return [
    sec('这是什么', p('步数，和 Apple Watch「活动」圆环红圈的活动能量：走路、训练、做家务这些额外消耗的热量，不含躺着不动也会消耗的基础代谢。')),
    sec('活动多的日子会加餐', p('计划里的热量已经按你平常的训练日、休息日算好了。哪天活动明显比平常多，当天的目标会自动加一点：和你最近 28 天同类日子（训练日比训练日，休息日比休息日）的活动能量中位数比，多出 150 kcal 以上时，加多出部分的 75%（最多 600 kcal），全加在碳水上。只加 75%，是因为手表常常估高。')),
    sec('你的数据', li([inf.avgSteps != null ? `${c.rl}平均每天 <b>${f0(inf.avgSteps)}</b> 步、活动 ${inf.avgAct != null ? f0(inf.avgAct) : '—'} kcal（按戴了表、已过完的 ${inf.wornDays} 天）` : '',
      `平常：训练日 ${inf.bT != null ? `${f0(inf.bT)} kcal` : '数据还不够'}，休息日 ${inf.bR != null ? `${f0(inf.bR)} kcal` : '数据还不够'}`,
      inf.bT != null ? `比如训练日活动到 ${f0(inf.bT + 150)} kcal 以上，目标开始加（活动 ${f0(inf.bT + 350)} kcal 时加 ${f0(Math.round(350 * 0.75 / 10) * 10)} kcal）` : '',
      `${c.rl}有 ${inf.bonusDays || 0} 天加了餐${inf.bonusDays ? `，平均 +${f0(inf.bonusAvg)} kcal` : ''}`])),
    sec('不算的日子', p('活动能量不到 100 kcal 或步数不到 1000 的日子，多半是没戴表或数据没同步全，不算进「平常」（图里浅色的柱子）。数据不对的那天也可以在「今日 → 身体」点健康数据，标成「这天不算」。')),
    sec('多少合适', p(`每天 7000–10000 步，对心肺和控制体脂都有好处。${goal === 'muscle' ? '增肌期步数保持稳定就好；突然走多了要跟着多吃，不然多出来的消耗会吃掉热量盈余。' : goal === 'fatloss' ? '减脂期多走路是最容易坚持的加消耗方式，比少吃更不容易饿。' : '保持稳定比偶尔猛走更有用。'}`)),
  ].join('');
  if (key === 'diet') {
    const d = inf.diet || S.plan?.diet || {}, rest = d.restDay || {}, perKg = isNum(d.protein) && w ? d.protein / w : null;
    return [
      sec('这是什么', p('每天吃下去的热量和蛋白质，对比当天的目标。数字来自 Claude 对每餐的估算、你自己填的数、快捷记录，再加上牛奶和豆浆。训练日和休息日的目标不同，活动多的日子目标会加一点（加在碳水上）。')),
      sec('你的目标', isNum(d.kcal) ? li([`训练日 ${f0(d.kcal)} kcal、蛋白质 ${isNum(d.protein) ? f0(d.protein) : '—'} g${isNum(rest.kcal) || isNum(rest.protein) ? `；休息日 ${f0(rest.kcal ?? d.kcal)} kcal、蛋白质 ${f0(rest.protein ?? d.protein)} g` : ''}`,
        perKg ? `蛋白质 ${f0(d.protein)} g，约每公斤体重 ${f1(perKg)} g（按 ${f1(w)} kg）` : '']) : p('还没有计划。在电脑上让 Claude 运行 /fitness-plan 生成。')),
      sec('你的数据', inf.food ? li([inf.over ? `${c.rl}记了饮食、已过完的 ${inf.over} 天：平均 <b>${f0(inf.kAvg)}</b> kcal、蛋白质 <b>${f0(inf.pAvg)}</b> g` : '',
        `蛋白质达标 ${inf.hit}/${inf.of} 天（吃到当天目标的 90% 就算）`, inf.part ? `${inf.part} 天记录不全（斜线的柱子）` : '']) : p('还没有饮食记录。')),
      sec('蛋白质要多少', p('增肌和减脂期都建议每天每公斤体重 1.6–2.2 g。分到 3–4 顿、每顿 25–40 g，比集中在一顿更好利用。')),
      sec('怎么看热量', p('照片估单餐，误差大约 ±15–20%，看一周的平均比看单天准，最后以体重趋势为准：体重涨得比目标慢就多吃一点，快了就少吃一点。只记了一餐、或者有餐还在等 Claude 分析的日子算「记录不全」，数字偏低，不要照着它补吃。')),
    ].join('');
  }
  if (key === 'training') {
    const ex = (inf.top || []).slice(0, 3).map(e => { const a = e.recent.find(s => isNum(s.val)), b = [...e.recent].reverse().find(s => isNum(s.val)); return a && b && a !== b ? `${esc(e.name)} ${VAL_NAME[e.mode]} ${valTxt(a.val, e.mode)} → ${valTxt(b.val, e.mode)}` : ''; }).filter(Boolean);
    return [
      sec('这是什么', p(`每周练了几天${inf.plan ? `（计划 ${inf.plan} 天）` : ''}，和练得最多的几个动作的进步。训记同步来的和在这里记的训练都算。`)),
      sec('你的数据', li([`${c.rl}练了 ${inf.inWin ?? 0} 天${inf.perWk != null ? `，最近几周平均每周 ${f1(inf.perWk)} 天` : ''}`, ...ex])),
      sec('渐进超负荷', p('力量和肌肉靠一点点加重量或次数长上来。常用的做法：在计划的次数区间里（比如 6–8 次），每组都做到上限后，下次加一档重量（上肢 1–2.5 kg，下肢 2.5–5 kg），次数回到下限再往上做。')),
      advOn() ? sec('e1RM 是什么', p('估算的 1RM：用 Epley 公式「重量 ×（1 + 次数 ÷ 30）」，把不同重量、不同次数的组换算成大概只能做 1 次的重量，方便把不同的训练放在一起比。比如 60 kg × 8 次 ≈ 76 kg。每次训练取最重的一组正式组来算，热身组和递减组不算，超过 12 次的不算（次数越少越准）。它只是估计，不用真的去测 1RM。辅助动作看辅助重量（越少越强），自重动作看次数，负重的自重动作把体重算进去。'))
        : sec('怎么看进步', p('每个动作看每次训练里最重的一组：重量加上去了，或者同样的重量多做了几次，就是进步。辅助动作看辅助的重量，越少越强；自重动作看一组最多做几次。')),
      sec('停滞了怎么办', p('同一个动作 3 周以上不涨：先看睡眠和吃够没有，再试换个次数区间或换个变式。连续几次往下掉，多半是累积疲劳，减量一周再回来：组数减半（最少 2 组）、重量不变、每组留 3–4 次余力。「今日」的训练卡会在该减量时提醒你，点一下就按这个安排。')),
    ].join('');
  }
  if (key === 'body') {
    const cp = inf.cp || comp(), want = inf.want || {};
    const mine = COMP.filter(([k]) => cp[k].length).map(([k, n]) => {
      const xs = cp[k], a = xs[xs.length - 1], b = xs[xs.length - 2];
      return `${esc(n)} <b>${f1(a.v)}</b> ${compUnit(k)}（${esc(md(a.d))}）${b ? `，比 ${esc(md(b.d))} ${sgn(a.v - b.v)}` : ''}${want[k] ? `，你要看它往${want[k] < 0 ? '下' : '上'}` : ''}`;
    });
    if (inf.whr) mine.push(`腰臀比 <b>${f2(inf.whr.v)}</b>（${prof.sex === 'female' ? '女性' : '男性'} ${inf.lim.toFixed(2)} 以下较好）`);
    return [
      sec('这是什么', p('体重分不出长的是肌肉还是脂肪，围度和体脂率能补上：腰围主要跟着肚子上的脂肪走；臂围、胸围、大腿围肌肉和脂肪都会让它变粗，要和腰围一起看。')),
      sec('你看哪几个', p(FOCUS_SAY[goal] || '保持健康和练力量：腰围稳住或者慢慢往下就好，其他的看个大概。')),
      sec('你的数据', mine.length ? li(mine) : p('还没量过。')),
      sec('怎么量', li(['腰围：肚脐那一圈，正常呼气后量，不收腹；软尺贴着皮肤、水平绕一圈，别勒紧', '臂围：手臂放松垂在身体旁边，量上臂最粗的地方，每次量同一侧', '胸围：过腋下、乳头那一圈，正常呼气后量', '臀围：两脚并拢站直，量臀部最宽的地方', '大腿围：站直、重心放两腿中间，量大腿最粗的地方（臀下横纹往下一点），每次量同一侧',
        '每两周量一次，同一时间：早上起床、上完厕所、吃喝之前，用同一根软尺。每处量两遍取平均'])),
      sec('体脂率', p('体脂秤和手表是用微弱电流估算的，同一个人前后能差 3–5 个百分点，喝水多少、刚运动完都会让它跳。只看同一台秤、同一时间测的长期趋势，不看单次的数，也不和别人比。Apple 健康里有体脂率时会自动同步过来，也可以在「今日 → 身体」里自己填。')),
      sec('腰臀比', p('腰围除以臀围。男性 0.90 以下、女性 0.85 以下较好；高了说明肚子上的脂肪偏多。')),
    ].join('');
  }
  if (key === 'week') return [
    sec('怎么比', p('左边一列是本周（周一到今天），右边是上周一整周。')),
    sec('怎么算', li(['平均热量、平均蛋白质、平均步数：按已经过完的天算，今天还没过完，不算进平均。热量和蛋白质只算记了饮食的日子，后面的小字是这些天目标的平均；步数只算戴了表的日子',
      '蛋白质达标、喝水达标、训练：按天数数，今天已经做到的也算。蛋白质吃到当天目标的 90% 就算达标',
      '体重周均：这周称到的体重的平均，旁边是比上周多少', '建议做到：日报「接下来」的前 3 条和你自己加的「今天要做的」，勾掉了几条（点了「不做」的不算）'])),
    sec('周报', p('Claude 写完上一周的周报后，周一到周三放在这张表上面，之后放在下面。以前的周报在页面最下面的「报告」里。')),
  ].join('');
  if (key === 'reports') return [
    sec('日报', p('Claude 每次处理完写这一天的：吃了多少、练得怎样、接下来做什么。「接下来」的前 3 条会出现在「今日」，可以勾掉。')),
    sec('周报', p('每周一份：本周和上周放在一起比，几项目标各做到了几天，下周的重点。')),
    sec('计划', p('计划说明（第一次做计划、重做计划时写的）和阶段总结（一个阶段结束时写的）。')),
  ].join('');
  if (key === 'photos') return [
    sec('为什么拍', p('镜子天天看分不出变化，体重也说明不了长的是什么。隔几周拍一组，并排一比，肩、背、腰的变化最直观。')),
    sec('怎么拍才能比', li(['同一时间：早上起床、上完厕所、吃东西之前', '同样的光线、同一个位置；手机放在同样高度（大约腰的高度）、离身体同样远，最好用支架或者让同一个人拍', '穿同样的衣服（紧身短裤、运动内衣，或者不穿上衣），放松站直，不刻意收腹、不发力', '正面、侧面、背面各一张', '每 2–4 周一次就够，太勤了看不出差别'])),
    sec('谁会看到', p('照片存在你自己的账号里，别人登录自己的账号看不到。Claude 处理时会看照片、和之前那组对比后写几句，这时照片会发给 Anthropic。')),
    sec('你的照片', inf.n ? p(`一共 ${inf.n} 组，最近一组是 ${esc(mdw(inf.a))}${inf.gap > 14 ? `，已经 ${inf.gap} 天了` : ''}。`) : p('还没拍过。')),
  ].join('');
  return '';
}
function openSheet(type, title, body) {
  if (!has('showSheet')) return;
  if (S.sheet && has('closeSheet')) A.closeSheet();
  if (S.sheet) return;  // a form with unsaved changes asked first
  S.sheet = { type };
  A.showSheet(title, body, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
function openInfo(key) {
  if (!cache.info.c) return;
  openSheet('d-info', `这是什么 · ${titleOf(key)}`, `<div class="dv-info">${infoHTML(key)}</div>`);
}

/* ---------- 动作详情 ---------- */
/* The chart's range: 3 个月 / 半年 / 1 年 / 全部. Picked: kept for this visit (sessionStorage) across exercises.
   Not picked: 3 个月, else the shortest range with 4 sessions in it. A range without a single session of this
   exercise widens to the next. The table follows the range; 看更早的 shows the rest. */
const EX_RANGES = [['3m', '3 个月', 91], ['6m', '半年', 182], ['1y', '1 年', 365], ['all', '全部', 0]];
const ssGet = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} };
const EXR_KEY = 'lsj-ex-range';
let exAll = false;  // 看更早的: the whole table
function exRange(xs, t) {
  const since = days => days ? addDays(t, -days + 1) : '';
  const n = k => { const r = EX_RANGES.find(x => x[0] === k); return xs.filter(s => s.d >= since(r[2])).length; };
  const picked = EX_RANGES.some(x => x[0] === ssGet(EXR_KEY)) ? ssGet(EXR_KEY) : null;
  let i = EX_RANGES.findIndex(x => x[0] === (picked || '3m'));
  while (i < EX_RANGES.length - 1 && n(EX_RANGES[i][0]) < (picked ? 1 : 4)) i++;
  const [k, label, days] = EX_RANGES[i];
  return { k, label, from: since(days) };
}
// 下次怎么练: app.js's prescription (the 今日 训练单's and 训练中's 这次), with its source.
const RX_SRC = { claude: 'Claude', rule: '按上次成绩', deload: '减量周', plan: '计划' };
function nextHTML(name) {
  let r = null; try { r = has('rxFor') ? A.rxFor(name) : null; } catch (e) { console.error(e); }
  if (!r || !r.line) return '';
  const src = r.src === 'claude' ? `<span class="ag-mark" aria-hidden="true"></span>Claude${isDate(r.at) ? ` · ${esc(md(r.at))}` : ''}` : esc(RX_SRC[r.src] || '');
  return `<div class="dv-next ${esc(r.src)}"><div class="who"><span class="by">下次怎么练</span><span class="src">${src}</span></div>
    <p class="dv-nx num">${esc(r.line)}</p>${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}</div>`;
}
// noLink: opened from a session's details (「‹ 那次训练」 goes back), so the table's rows don't open sessions again.
function exHTML(name, noLink) {
  const all = exercises();
  if (!all.length) return '<p class="hint" style="margin:0">还没有带重量或次数的训练记录。</p>';
  const byFreq = [...all].sort((a, z) => z.list.length - a.list.length || a.name.localeCompare(z.name, 'zh'));
  const e = all.find(x => x.name === name) || byFreq[0];
  const t = tday(), ymd = d => d.slice(0, 4) === t.slice(0, 4) ? md(d) : `${d.slice(0, 4)}/${md(d)}`;  // other years carry theirs
  const all_ = e.list, last = all_[all_.length - 1], mode = e.mode, lower = lowerBetter(mode);
  const rg = exRange(all_, t), xs = all_.filter(s => s.d >= rg.from);  // the chart's and the table's sessions
  const pick = `<label class="field dv-pick"><span class="lbl">动作</span><select id="d-ex-pick">${byFreq.map(x => `<option value="${esc(x.name)}"${x === e ? ' selected' : ''}>${esc(x.name)} · ${x.list.length} 次</option>`).join('')}</select></label>`;
  const withAll = all_.filter(s => isNum(s.val));
  const best = withAll.reduce((b, s) => !b || better(s, b, mode) ? s : b, null);  // the latest of equals
  const m4 = withAll.filter(s => s.d >= addDays(t, -27)), first4 = m4[0], last4 = m4[m4.length - 1];
  const ch = first4 && last4 && first4 !== last4 ? last4.val - first4.val : null;
  // the chart: the range from its start (全部: from the first session) to today; labels without the year but on 全部
  const vals = xs.map(s => s.val), withV = xs.filter(s => isNum(s.val));
  const start = rg.from || all_[0].d, span = Math.max(1, daysBetween(start, t));
  const lab = d => rg.k === 'all' ? ymd(d) : md(d);
  const yv = [...vals, ...(mode === 'kg' ? xs.map(s => s.kg) : [])].filter(isNum);
  const lo = yv.length ? Math.min(...yv) : 0, hi = yv.length ? Math.max(...yv) : 1, pad1 = Math.max(1, (hi - lo) * 0.1);
  const chips = `<div class="seg dv-exr" role="group" aria-label="时间范围">${EX_RANGES.map(([k, l]) => `<button type="button" data-act="d-exr" data-v="${k}" aria-pressed="${k === rg.k}">${l}</button>`).join('')}</div>`;
  const chart = withV.length ? plot({
    id: 's-ex', pos: xs.map(s => Math.max(0, Math.min(1, daysBetween(start, s.d) / span))), y: nice(Math.max(0, lo - pad1), hi + pad1, 3), fmt: v => String(+v.toFixed(1)), H: 140,
    color: mode === 'assist' ? 'var(--sl-deep)' : 'var(--plate-blue)', aria: `${e.name}：${VAL_NAME[mode]}，${rg.label}，最近 ${valTxt(last.val, mode)}`,
    layers: [mode === 'kg' ? g => lay.dots(xs.map(s => s.kg), 'm-raw', 3)(g) : null, lay.line(vals, 'm-line'), lay.dots(vals, 'm-dot', xs.length > 40 ? 2.5 : 3.5)].filter(Boolean),
    xl: (() => { const out = [{ i: 0, t: lab(xs[0].d) }]; if (xs.length > 2) out.push({ i: Math.floor((xs.length - 1) / 2), t: lab(xs[Math.floor((xs.length - 1) / 2)].d) }); if (xs.length > 1) out.push({ i: xs.length - 1, t: lab(xs[xs.length - 1].d) }); return out; })(),
    has: i => isNum(vals[i]) || !!xs[i].top,
    tip: i => { const s = xs[i]; return `${esc(mdw(s.d))}<br>最重一组 <b>${esc(topTxt(s.top, mode))}</b>${s.e1 != null && mode !== 'top' ? `<br>e1RM <b>${f1(s.e1)}</b> kg` : ''} · 正式组 ${s.sets.length}`; },
  }) : `<p class="dv-note">${esc(rg.label)}里没有这个动作的记录。</p>`;
  const pe = planEx(e.name);
  const num = v => !isNum(v) ? '—' : mode === 'reps' || mode === 'sec' ? String(Math.round(v)) : mode === 'assist' || mode === 'top' ? kgTxt(v) : f1(v);
  const bigTxt = num(last.val);
  const unit = mode === 'reps' ? '次' : mode === 'sec' ? '秒' : 'kg';
  const chTxt = ch == null ? '—' : `${mode === 'reps' || mode === 'sec' ? sgn(ch, f0) : sgn(ch)}<small>${unit}</small>`;
  const bestTxt = !best ? '—' : mode === 'top' ? `${num(best.kg)}<small>kg × ${best.top.reps}</small>` : `${num(best.val)}<small>${unit}</small>`;
  const adv = advOn();  // off: no e1RM, warm-up or drop-set words (exercises() already follows the heaviest set)
  const what = { kg: '估算 1RM（e1RM），由每次最重的一组正式组按 Epley 公式算出；灰点是那组的重量', top: adv ? '每次最重一组的重量，同样重的比次数；次数多（超过 12 次）的组和孤立动作不换算 e1RM' : '每次最重一组的重量：越重越好，同样重的比次数', 'bw+': 'e1RM，把当天体重和附加重量加在一起算', assist: '辅助重量，越少越强；降到 0 就是不用辅助了', reps: '自重动作，看一组最多做几次', sec: '一组最长坚持了多久' }[mode];
  // the drop sets of that session, after its working sets (they never count in the numbers)
  const drops = s => (Array.isArray(s.w?.exercises) ? s.w.exercises : []).filter(x => x && String(x.name || '').trim() === e.name)
    .flatMap(x => { const ss = (Array.isArray(x.sets) ? x.sets : []).filter(z => z && typeof z === 'object'), any = ss.some(z => z.done); return ss.filter(z => z.drop && setData(z) && (z.done || !any)); });
  const shown = exAll ? all_ : xs, older = all_.length - xs.length;
  // the table's third column: e1RM, else what this kind of move is measured by (最重 / 最多 / 助力 / 最长)
  const COL = { top: '最重', reps: '最多', assist: '助力', sec: '最长' };
  const cell = s => mode === 'top' ? kgTxt(s.kg) : mode === 'reps' ? (isNum(s.val) ? String(Math.round(s.val)) : '—') : mode === 'assist' ? (isNum(s.val) ? kgTxt(s.val) : '—')
    : mode === 'sec' ? (isNum(s.val) ? `${Math.round(s.val)}秒` : '—') : s.e1 != null ? f1(s.e1) : '—';
  const rows = [...shown].reverse().map(s => { const dr = drops(s); return `<tr${s.w?.id && !noLink ? ` class="go" data-act="d-wo" data-id="${esc(s.w.id)}" tabindex="0" aria-label="看 ${esc(ymd(s.d))} 那次训练"` : ''}><td>${esc(ymd(s.d))}</td><td><b>${esc(topTxt(s.top, mode))}</b><small>${esc(s.sets.map(setShort).join(' · '))}${dr.length ? `<i class="dv-dr"> · 递减 ${esc(dr.map(setShort).join(' · '))}</i>` : ''}</small></td><td class="n">${cell(s)}</td><td class="n">${s.sets.length}</td></tr>`; }).join('');
  const info = typeof A?.exInfo === 'function' ? A.exInfo(e.name) : null;  // 部位 · how it is done (the 动作库's line)
  return `${pick}${info?.how ? `<p class="dv-note dv-how">${esc(info.part && info.part !== '其他' ? `${info.part} · ` : '')}${esc(info.how)}</p>` : ''}<div class="panel dv-expanel">
    ${head(bigTxt, unit, `${esc(VAL_NAME[mode])} · 最近一次 ${esc(ymd(last.d))}：${esc(topTxt(last.top, mode))}`, ch != null && Math.abs(ch) > 0.05 ? tag((lower ? ch < 0 : ch > 0) ? 'good' : 'ok', lower ? (ch < 0 ? '辅助在减少' : '辅助变多了') : ch > 0 ? '在进步' : '比 4 周前低') : '')}
    ${kvs([['近 4 周', chTxt], ['最好', bestTxt, best ? esc(ymd(best.d)) : ''], ['练过', `${all_.length}<small>次</small>`, `${esc(ymd(all_[0].d))} 起`]])}
    ${chips}${chart}<p class="dv-note">${esc(what)}。${adv ? '热身组和递减组不算。' : ''}</p>
    ${nextHTML(e.name)}
    ${pe ? `<p class="dv-note">计划 ${esc(pe.day.name || '训练日')}：${esc([`${pe.x.sets ?? ''}×${pe.x.reps ?? ''}`, pe.x.load, pe.x.rest ? `休息 ${pe.x.rest}` : ''].filter(Boolean).join(' · '))}</p>` : ''}
  </div>
  <div class="dv-tbl"><table><thead><tr><th>日期</th><th>最重一组 · 正式组</th><th class="n">${COL[mode] || 'e1RM'}</th><th class="n">组</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="none">${esc(rg.label)}里没有记录</td></tr>`}</tbody></table></div>
  ${!exAll && older > 0 ? `<button type="button" class="link dv-exmore" data-act="d-exall">看更早的（${older} 次）</button>` : ''}`;
}
// Redraw the open sheet's body (another exercise, range or the whole table), its back link kept.
function exRedraw(name) {
  const box = document.querySelector('.dv-exsheet'); if (!box) return;
  newMemo(); box.innerHTML = exHTML(name, !!box.dataset.nolink);
}
// o.backWo: the session's details this was opened from: 「‹」 at the left of the title goes back to it (one swap).
function openEx(name, o = {}) {
  if (!bind() || !NEED.every(k => S.loaded.has(k))) return;
  newMemo(); exAll = false;
  const back = o && typeof o.backWo === 'string' && o.backWo ? o.backWo : '';
  openSheet('d-ex', '动作详情', `<div class="dv-exsheet"${back ? ' data-nolink="1"' : ''}>${exHTML(name || '', !!back)}</div>`);
  if (back && S.sheet) document.querySelector('#sheet .sheet-h')?.insertAdjacentHTML('afterbegin', `<button type="button" class="icon-btn sheet-back" data-act="d-wo-back" data-id="${esc(back)}" aria-label="回到那次训练"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>`);
}
// For app.js's 动作 page: every exercise with its sessions, most sessions first: {name, n, last (date), sets (that
// session's working sets), mode, best: {k, v} (the best e1RM; for moves without one, and for every move with 进阶显示
// off, the heaviest / most / least help / longest set), pr (the date of its latest record, or null)}.
let exMemo = { w: null, b: null, a: null, v: null };
function exRows() {
  if (!bind() || !Array.isArray(S.workouts)) return [];
  const adv = advOn();  // with 进阶显示 off no row's best is an e1RM
  if (exMemo.v && exMemo.w === S.workouts && exMemo.b === S.body && exMemo.a === adv) return exMemo.v;
  const keep = M;
  try {
    newMemo();
    const BEST = { kg: '最重', top: '最重', 'bw+': '最重', reps: '最多', assist: '最少助力', sec: '最长' };
    const recs = prsData();
    const v = exercises().map(e => {
      const xs = e.list, last = xs[xs.length - 1];
      const e1 = xs.filter(s => isNum(s.e1)).reduce((b, s) => !b || s.e1 > b.e1 ? s : b, null);
      const pick = lowerBetter(e.mode) ? (b, s) => !b || s.val < b.val ? s : b : (b, s) => !b || s.val > b.val ? s : b;
      const top = e.mode === 'kg' || e.mode === 'top' || e.mode === 'bw+' ? xs.reduce((b, s) => !b || (s.top?.kg ?? 0) * 1000 + (s.top?.reps ?? 0) > (b.top?.kg ?? 0) * 1000 + (b.top?.reps ?? 0) ? s : b, null)
        : xs.filter(s => isNum(s.val)).reduce(pick, null);
      const best = e.mode === 'kg' && e1 ? { k: 'e1RM', v: `${f1(e1.e1)} kg` } : top ? { k: BEST[e.mode] || '最好', v: topTxt(top.top, e.mode) } : null;
      return { name: e.name, n: xs.length, last: last.d, sets: last.sets, mode: e.mode, best, pr: recs[e.name]?.recent?.[0]?.date || null };
    }).sort((a, z) => z.n - a.n || z.last.localeCompare(a.last) || a.name.localeCompare(z.name, 'zh'));
    exMemo = { w: S.workouts, b: S.body, a: adv, v };
    return v;
  } finally { M = keep; }
}

/* ---------- a photo, big: app.js's viewer when it has one, else an overlay of our own (the page stays put) ---------- */
let lbBack = null;
function openPhoto(id) {
  if (!PID.test(String(id || ''))) return;
  if (typeof A?.openPhoto === 'function') { A.openPhoto(id); return; }
  let el = document.getElementById('dv-lb');
  if (!el) {
    el = document.createElement('div'); el.id = 'dv-lb'; el.className = 'dv-lb'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '照片大图'); el.dataset.act = 'd-lb-close';
    document.body.appendChild(el);
  }
  lbBack = document.activeElement;
  el.innerHTML = `<img src="${esc(photoSrc(id))}" alt="照片大图"><button type="button" class="dv-lb-x" data-act="d-lb-close" aria-label="关闭">×</button>`;
  el.hidden = false; document.documentElement.classList.add('locked');
  el.querySelector('.dv-lb-x').focus({ preventScroll: true });
}
function closePhoto() {
  const el = document.getElementById('dv-lb'); if (!el || el.hidden) return false;
  el.hidden = true; el.innerHTML = '';
  if (!S?.sheet && document.getElementById('sheet')?.hidden !== false) document.documentElement.classList.remove('locked');
  if (lbBack?.isConnected) lbBack.focus({ preventScroll: true });
  lbBack = null;
  return true;
}
// Escape closes our overlay first (before app.js's own Escape handling sees it).
window.addEventListener('keydown', e => { if (e.key === 'Escape' && closePhoto()) { e.stopPropagation(); e.preventDefault(); } }, true);

/* ---------- a report: app.js's report sheet (the one for every report, wherever it is opened from) ---------- */
function openReport(id) {
  const r = (Array.isArray(S.reports) ? S.reports : []).find(x => x && x.id === id);
  if (r && has('openReport')) A.openReport(r);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-act^="d-"]'); if (!t || !bind()) return;
  switch (t.dataset.act) {
    case 'd-range': { const v = +t.dataset.v; if (RANGES.includes(v) && t.getAttribute('aria-pressed') !== 'true') { lsSet(rangeKey(), String(v)); rerender(); } break; }
    case 'd-info': openInfo(t.dataset.k); break;
    case 'd-ex': openEx(t.dataset.n); break;
    // a session in 动作详情's table: the details get a 「‹」 back to this exercise (and no way further)
    case 'd-wo': if (has('openWorkout')) A.openWorkout(t.dataset.id, null, { back: document.getElementById('d-ex-pick')?.value || '' }); break;
    case 'd-wo-back': if (has('woBack')) A.woBack(t.dataset.id); break;
    case 'd-exr': if (t.getAttribute('aria-pressed') !== 'true') { ssSet(EXR_KEY, t.dataset.v); exAll = false; exRedraw(document.getElementById('d-ex-pick')?.value || ''); } break;
    case 'd-exall': exAll = true; exRedraw(document.getElementById('d-ex-pick')?.value || ''); break;
    // the 训练 tab's full-screen pages, from the training card
    case 'd-hist': if (has('go') && has('openHist')) { A.go('plan'); A.openHist({ view: 'main' }); } break;
    case 'd-exs': if (has('go') && has('openHist')) { A.go('plan'); A.openHist({ view: 'exs' }); } break;
    case 'd-rep': openReport(t.dataset.id); break;
    case 'd-sub': if (SUBS.some(([k]) => k === t.dataset.v) && t.getAttribute('aria-pressed') !== 'true') { lsSet(subKey(), t.dataset.v); rerender(); } break;
    case 'd-rf': if (RF.some(([k]) => k === t.dataset.v) && t.getAttribute('aria-pressed') !== 'true') { lsSet(rfKey, t.dataset.v); repN = 6; rerender(); } break;
    case 'd-rmore': repN += 20; rerender(); break;
    case 'd-pv': if (!t.disabled && t.getAttribute('aria-pressed') !== 'true') { pv.v = t.dataset.v; rerender(); } break;
    case 'd-photo': openPhoto(t.dataset.id); break;
    case 'd-lb-close': closePhoto(); break;
  }
});
// 身材照: a date picked on either side. The earlier one always stays on the left.
document.addEventListener('change', e => {
  const id = e.target.id; if ((id !== 'd-pv-a' && id !== 'd-pv-b') || !bind()) return;
  const list = shots(); if (!list.length) return;
  const [a, b] = pairOf(list), v = e.target.value;
  let na = id === 'd-pv-a' ? v : a.date, nb = id === 'd-pv-b' ? v : b?.date || null;
  if (nb && nb > na) [na, nb] = [nb, na];
  pv.a = na; pv.b = nb; rerender();
  requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }));
});
document.addEventListener('change', e => {
  if (e.target.id !== 'd-ex-pick' || !bind()) return;
  exAll = false; exRedraw(e.target.value);
  document.getElementById('d-ex-pick')?.focus();
});
// A row of 动作详情's table from the keyboard
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('tr[data-act="d-wo"]')) { e.preventDefault(); e.target.click(); } });
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (bind() && S.tab === 'data') rerender(); }, 200); });

window.LSJData = { view, prs, exRows, openEx };
})();

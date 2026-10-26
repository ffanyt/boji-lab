(() => {
'use strict';
// voice.js (互联网抽象风 wording, window.LSJVoice): the abstract line when html[data-style="abstract"], else the plain one
// passed here (fb). Without voice.js, the plain wording with {n}-style placeholders filled in. vh: the line escaped,
// the vars inserted as they are (for <b class="num">…</b>).
const LV = () => window.LSJVoice || null;
const vfill = (fb, vars) => String(fb ?? '').replace(/\{(\w+)\}/g, (m, k) => vars?.[k] ?? m);
const vt = (k, fb, vars) => { try { if (LV()) return LV().t(k, fb, vars); } catch (e) {} return vfill(fb, vars); };
const vh = (k, fb, vars) => { try { if (LV()) return LV().html(k, fb, vars); } catch (e) {} return esc(fb).replace(/\{(\w+)\}/g, (m, x) => vars?.[x] ?? m); };

/* ---------- constants ---------- */
const SLOTS = { breakfast: '早餐', lunch: '午餐', snack: '加餐', dinner: '晚餐', late: '夜宵' };
const SLOT_ORDER = ['breakfast', 'lunch', 'snack', 'dinner', 'late'];
const SLOT_TIME = { breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:30', late: '23:00' };
const PORTIONS = [['all', '全部吃完'], ['most', '大部分'], ['half', '一半'], ['little', '少量']];
const PORTION_TXT = { all: '吃完了', most: '吃了大部分', half: '吃了一半', little: '只吃了一点' };
const FULLNESS = ['还很饿', '有点饿', '刚好', '很饱', '撑了'];
const MEAL_FEEL = ['精力充沛', '满足', '犯困', '腹胀', '胃不舒服', '还想吃', '口渴'];
const WO_FEEL = ['状态很好', '力量涨了', '疲劳', '没睡好', '肌肉酸痛', '关节不适', '时间紧'];
const RATING = { good: '做得好', ok: '还行', adjust: '需调整' };
const KINDS = { daily: '日报', weekly: '周报', plan: '计划调整', phase: '阶段', guide: '说明' };
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const GOALS = [['fatloss', '减脂'], ['muscle', '增肌'], ['lean', '薄肌'], ['recomp', '减脂增肌'], ['strength', '提升力量'], ['health', '保持健康']];
const PLACES = [['gym', '健身房'], ['home', '家里有哑铃'], ['bodyweight', '徒手']];
const LEVELS = [['new', '新手'], ['some', '练过一阵'], ['adv', '两年以上']];
const MACROS = [
  ['kcal', '热量', 'kcal', 'var(--plate-blue)'],
  ['protein', '蛋白质', 'g', 'var(--plate-red)'],
  ['carbs', '碳水', 'g', 'var(--plate-yellow)'],
  ['fat', '脂肪', 'g', 'var(--plate-green)'],
];
const DRINKS = [['water', '白水'], ['tea', '茶'], ['coffee', '咖啡'], ['milk', '牛奶'], ['soy', '豆浆'], ['other', '其他']];
const DRINK_TXT = Object.fromEntries(DRINKS);
// Milk and soy milk count as food: whole milk and unsweetened soy milk, per 100 ml.
const DRINK_MACROS = { milk: { kcal: 65, protein: 3.2, carbs: 4.8, fat: 3.6 }, soy: { kcal: 31, protein: 3.0, carbs: 1.2, fat: 1.6 } };
const MKEYS = ['kcal', 'protein', 'carbs', 'fat'];
const RPES = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const HMETRICS = [['steps', '步数', '', null], ['activeKcal', '活动消耗', 'kcal', null], ['restingHR', '静息心率', '次/分', 'rhr'], ['hrv', 'HRV', 'ms', 'hrv']];
const THEMES = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
const STYLES = [['abstract', '抽象'], ['clean', '正经']];  // profile/prefs.style; abstract.css styles html[data-style="abstract"]
// 晨间状态 (body.feel): what each 1–5 scale means at its two ends
const FEEL = [['energy', '精力', '很差', '很好'], ['sore', '酸痛', '不酸', '很酸'], ['stress', '压力', '很轻松', '很大']];
// Circumferences besides the waist (body.arm …), cm
const MEAS = [['arm', '臂围'], ['chest', '胸围'], ['hip', '臀围'], ['thigh', '大腿围']];
const PP_SLOTS = [['front', '正面'], ['side', '侧面'], ['back', '背面']];  // progress/<date>.photos
const DRAFT_TTL = 36 * 3600e3;  // unsaved forms are offered again for 36 hours
const ADVICE_DAYS = 21;         // Claude's per-exercise advice older than this is ignored

/* ---------- utils ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const parseD = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const isoWd = s => parseD(s).getDay() || 7;
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
// Until this hour it is still the day before (night owls): profile/prefs.dayStartHour, else /api/me config; the last
// value is remembered so the first draw already uses it.
let dayStart = (() => { const h = parseInt(lsGet('lsj-daystart'), 10); return h >= 0 && h <= 12 ? h : 5; })();
const today =() => { const d = new Date(); if (d.getHours() < dayStart) d.setDate(d.getDate() - 1); return ymd(d); };
const dayTime = t => t && t < pad(dayStart) + ':00' ? '~' + t : (t || '');  // sort key: 01:30 comes after 23:00
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;  // code-point order ('~' after digits; localeCompare puts it first)
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmt = n => Math.round(n).toLocaleString('en-US');
const numTxt = v => isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(v ?? '');
const fmtDay = s => { const d = parseD(s); return `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`; };
const fmtTs = iso => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const md = d => String(d || '').slice(5).replace('-', '/');
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const blobSrc = id => '/api/photos/' + (PHOTO_ID.test(String(id)) ? id : 'invalid');
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const paras = t => String(t || '').split(/\n{1,}/).filter(x => x.trim()).map(x => `<p>${esc(x)}</p>`).join('');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const median = xs => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const round10 = x => Math.round(x / 10) * 10;  // JS rounding: halves go up (Python's round() would not)
const mdw = s => { const d = parseD(s); return `${d.getMonth() + 1}/${d.getDate()}（周${WD[d.getDay()]}）`; };  // 10/12（周日）
const nowIso = () => new Date().toISOString();
// For display only (never stored): 刚才 · 5 分钟前 · 3 小时前 · 昨天 21:40 · 10/12 21:40.
function fmtRel(iso) {
  const t = Date.parse(iso || ''); if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60 && s > -60) return '刚才';
  if (s > 0 && s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s > 0 && s < 6 * 3600) return `${Math.floor(s / 3600)} 小时前`;
  const d = new Date(t), hmTxt = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = ymd(d), now = ymd(new Date());
  if (day === now) return `今天 ${hmTxt}`;
  if (day === addDays(now, -1)) return `昨天 ${hmTxt}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hmTxt}`;
}
// Compares values the way the plan editors need: key order, missing fields and blank strings don't count.
const stable = v => JSON.stringify(v ?? null, (k, x) => x === '' ? undefined
  : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x) ?? 'null';
const eqv = (a, b) => stable(a) === stable(b);
// 外观: data-theme on <html> (app.css has both palettes); remembered locally so the next start paints right away.
function applyTheme(t) {
  if (!THEMES.some(([v]) => v === t)) t = 'auto';
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = t;
  themeMeta();
  lsSet('lsj-theme', t === 'auto' ? null : t);
}
// 页面风格: data-style="abstract" on <html> (abstract.css), none for 正经; remembered locally like the theme.
function applyStyle(s) {
  if (!STYLES.some(([v]) => v === s)) s = 'abstract';
  const root = document.documentElement;
  if (s === 'clean') root.removeAttribute('data-style'); else root.dataset.style = s;
  themeMeta();
  lsSet('lsj-style', s === 'abstract' ? null : s);
}
// The browser bar's colour: the page's ground in the current theme and style.
function themeMeta() {
  const root = document.documentElement, t = root.dataset.theme || 'auto', ab = root.dataset.style === 'abstract';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const dark = t === 'auto' ? /dark/.test(m.media) : t === 'dark';
    m.content = ab ? (dark ? '#0A0A0B' : '#FFF6D9') : dark ? '#0E1217' : '#F1F3F5';
  });
}
applyStyle(lsGet('lsj-style'));
applyTheme(lsGet('lsj-theme'));
// Numbers typed on a phone: 72,5 / 72。5 / full-width digits all mean 72.5. Blank is null, anything else unparseable is NaN.
function parseNum(s, int) {
  const t = String(s ?? '').trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[。，,．]/g, '.');
  if (!t) return null;
  if (!(int ? /^\d+$/ : /^(\d+\.?\d*|\.\d+)$/).test(t)) return NaN;
  return Number(t);
}
// "HH:MM" as minutes into the logging day (01:30 counts as 25:30).
const tmin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); if (!m) return null; return +m[1] * 60 + +m[2] + (+m[1] < dayStart ? 1440 : 0); };
// 夜宵 time, the one rule the page uses for it (meal slot, quick picks): from 22:00 until the day starts.
const LATE_FROM = 22 * 60;
const isLateMin = m => m != null && m >= LATE_FROM;
const lateNow = () => isLateMin(tmin(nowHM()));
// Meal slot for a new meal: 夜宵 at 夜宵 time; otherwise the slot whose usual time is closest to now. Usual: the median
// of this person's latest 5 meals of that slot in 30 days (at least 3), late-night times left out (a 00:55 「加餐」 is
// really a 夜宵; mixed with lunchtime snacks the median would land on dinner).
function guessSlot() {
  const t = today(), from = addDays(t, -30), now = tmin(nowHM());
  if (isLateMin(now)) return 'late';
  let best = 'lunch', bd = Infinity;
  for (const k of SLOT_ORDER) {
    if (k === 'late') continue;
    const xs = S.meals.filter(m => m.slot === k && m.date >= from && m.date <= t && !isLateMin(tmin(m.time)) && tmin(m.time) != null)
      .sort((a, z) => cmp(z.date + dayTime(z.time), a.date + dayTime(a.time))).slice(0, 5).map(m => tmin(m.time));
    const usual = xs.length >= 3 ? median(xs) : tmin(SLOT_TIME[k]);
    if (Math.abs(now - usual) < bd) { bd = Math.abs(now - usual); best = k; }
  }
  return best;
}

/* ---------- state ---------- */
const S = {
  db: null, assets: null, dbState: 'loading', canPhoto: null,
  tab: 'today', date: today(),
  meals: [], workouts: [], activeWorkout: null, body: {}, water: {}, reports: [], plan: null, profile: null, status: null, xunji: null,
  me: null, users: null, rest: null, sleep: {}, days: {}, health: {}, tokens: null,
  prefs: null, insights: null, todos: {}, xj: null,
  inbox: [], messages: [], log: [], memory: null, foods: null, claudeFocus: null,
  progress: [], places: null, backTab: 'today', subPushed: false, hlIds: null, meFocus: null,
  push: { ready: false, reg: null, sub: null, key: null, subs: 0, busy: false },
  loaded: new Set(), sheet: null, authLost: false,
};
const TABS = ['today', 'plan', 'claude', 'data', 'me'];
// Claude (the ✦ at the top right) is a second-level page: no tab of its own in the bar, 「‹」 at the top left goes back
// to the tab it was opened from (S.backTab). 我的 is the last tab (it was the avatar at the top right until 10/21).
const SUB_TABS = ['claude'];
// The 训练 tab keeps its id `plan` (lsj-tab, reports and proposals say 计划); its hash is #train, #plan still opens it.
const tabOf = t => t === 'feedback' ? 'data' : t === 'train' ? 'plan' : TABS.includes(t) ? t : 'today';
const hashOf = t => '#' + (t === 'plan' ? 'train' : t);
{ const t = lsGet('lsj-tab'); if (t) S.tab = tabOf(t); }
if (/^#(today|plan|train|claude|data|feedback|me)$/.test(location.hash)) S.tab = tabOf(location.hash.slice(1));
// the first entry carries its tab, so going back from Claude / 我的 lands on a tab the page can read
else if (!location.hash) { try { history.replaceState(history.state, '', hashOf(S.tab)); } catch (e) {} }

const viewEl = $('#view'), sheetEl = $('#sheet'), topEl = $('#top-in'), bannerEl = $('#banner');

/* ---------- preferences (profile/prefs) ---------- */
// Read defensively: a missing field or a value of the wrong type means the default.
const prefs = () => (S.prefs && typeof S.prefs === 'object' ? S.prefs : {});
const prefOn = k => prefs()[k] !== false;  // weighCard, staleHealth, habits
const notifyOn = k => { const n = prefs().notify; return !(n && typeof n === 'object' && n[k] === false); };
function prefDayStart() { const h = prefs().dayStartHour; return Number.isInteger(h) && h >= 0 && h <= 12 ? h : null; }
function prefTheme() { const t = prefs().theme; return THEMES.some(([v]) => v === t) ? t : 'auto'; }
function prefStyle() { const s = prefs().style; return STYLES.some(([v]) => v === s) ? s : 'abstract'; }
const pushOn = k => { const p = prefs().push; return !(p && typeof p === 'object' && p[k] === false); };
// 进阶显示 (profile/prefs.advanced): RPE, warm-up and drop sets, training volume, resting heart rate and HRV on the page.
// Unset: on for people who have trained before (profile.level some / adv), off for beginners and an empty level. The
// data is the same either way; only what is shown changes.
function advOn() { const v = prefs().advanced; return typeof v === 'boolean' ? v : ['some', 'adv'].includes(S.profile?.level); }
function waterPresets() {
  const xs = prefs().waterPresets;
  const ok = Array.isArray(xs) ? xs.filter(v => Number.isInteger(v) && v >= 10 && v <= 3000).slice(0, 6) : [];
  return ok.length ? ok : [150, 250, 500];
}
function restPref() {
  const r = prefs().restTimer, o = r && typeof r === 'object' ? r : {};
  return { on: o.on !== false, sec: Number.isInteger(o.sec) && o.sec >= 15 && o.sec <= 600 ? o.sec : 90 };
}
const serverDayStart = () => { const h = S.me?.config?.dayStartHour; return Number.isInteger(h) && h >= 0 && h <= 12 ? h : null; };
function syncDayStart() {
  const h = prefDayStart() ?? serverDayStart(); if (h == null || h === dayStart) return;
  dayStart = h; lsSet('lsj-daystart', String(h)); rollDay();
}
function prefsLoaded() {
  syncDayStart();
  if (S.sheet?.type !== 'prefs') { applyStyle(prefStyle()); applyTheme(prefTheme()); }  // the sheet previews its own choice until saved
}

/* ---------- derived ---------- */
function planDays() { return Array.isArray(S.plan?.training?.days) ? S.plan.training.days : []; }
const isPlanDay = id => planDays().some(x => x.id === id);
// A plan day's short name, what badges, chips and titles show (the letter id stays for the data): its `short` (up to 4
// characters, set on the plan page), else the first word of its name (split at spaces, ·, 、, ，, /), else the id.
function dayShort(day) {
  if (!day || typeof day !== 'object') return '';
  const s = String(day.short ?? '').trim();
  if (s) return [...s].slice(0, 4).join('');
  const first = String(day.name ?? '').trim().split(/[\s·、，,/／]+/)[0] || '';
  return first ? [...first].slice(0, 4).join('') : String(day.id ?? '');
}
// By id; an id no plan day has (an old import) shows as itself.
const dayShortOf = id => { const d = planDays().find(x => x.id === id); return d ? dayShort(d) : String(id ?? ''); };
function scheduledDay(d) {
  const sch = S.plan?.training?.schedule; if (!sch) return null;
  const id = sch[String(isoWd(d))]; if (!id) return null;
  return planDays().find(x => x.id === id) || null;
}
function rotation() { const r = S.plan?.training?.rotation; return Array.isArray(r) ? r.filter(x => typeof x === 'string' && x) : []; }
const woTime = w => (isNum(w.xunji?.start) ? new Date(w.xunji.start).toISOString() : '') || w.createdAt || '';
const latestFirst = (a, z) => woTime(z).localeCompare(woTime(a)) || String(z.id).localeCompare(String(a.id));
// What kind of day d is: a plan day id, 'train' (trained, but not one of the plan days) or 'rest'. In this order:
// 1. the user's pick in days/<d>  2. a logged session that day (训记 included)  3. a past day nobody trained is a rest day
// 4. the weekly schedule (with plan.training.rotation: the next day in the rotation)  5. rest.
function dayPick(d) {
  const v = S.days[d]?.plan;
  if (!v || typeof v !== 'string') return null;
  return v === 'rest' || isPlanDay(v) ? v : 'train';
}
function workedDay(d) {
  const wos = S.workouts.filter(w => w.date === d); if (!wos.length) return null;
  const w = wos.filter(x => isPlanDay(x.planDayId)).sort(latestFirst)[0];
  return w ? w.planDayId : 'train';
}
// The rotation day trained on date x, if any: a days pick in the rotation wins over that day's (latest) workout.
function rotationOn(x, rot) {
  const p = S.days[x]?.plan; if (rot.includes(p)) return p;
  const w = S.workouts.filter(w => w.date === x && rot.includes(w.planDayId)).sort(latestFirst)[0];
  return w ? w.planDayId : null;
}
// The next day in the rotation after the last trained rotation day before d; null without a rotation or history.
function nextRotation(d) {
  const rot = rotation(); if (!rot.length) return null;
  const dates = new Set();
  for (const [x, v] of Object.entries(S.days)) if (x < d && rot.includes(v?.plan)) dates.add(x);
  for (const w of S.workouts) if (w.date < d && rot.includes(w.planDayId)) dates.add(w.date);
  const last = [...dates].sort().pop(); if (!last) return null;
  return rot[(rot.indexOf(rotationOn(last, rot)) + 1) % rot.length];
}
function autoDay(d) {
  const w = workedDay(d); if (w) return w;
  if (d < today()) return 'rest';
  const sch = scheduledDay(d); if (!sch) return 'rest';
  return nextRotation(d) || sch.id;
}
const dayKind = d => dayPick(d) || autoDay(d);
function plannedDay(d) { const k = dayKind(d); return planDays().find(x => x.id === k) || null; }
const nextIn = (rot, id) => rot[(rot.indexOf(id) + 1) % rot.length];
// The days ahead as they are expected to go: today as dayKind says (the 口径), then each coming day the person's pick,
// else rest when the schedule has none, else (with a rotation) the day after the last one, assuming every training day
// before it gets trained. `stop(list, date)` ends the walk (at most 60 days).
function ahead(stop) {
  const rot = rotation(), t = today(), out = [];
  let nx = null;
  for (let i = 0, d = t; i < 60; i++, d = addDays(d, 1)) {
    // auto: what the day is without the person's pick (days/<d>)
    const auto = !i ? autoDay(t) : !scheduledDay(d) ? 'rest' : rot.length && nx ? nx : scheduledDay(d).id;
    const k = dayPick(d) || auto;
    if (rot.length) nx = rot.includes(k) ? nextIn(rot, k) : !i ? nextRotation(addDays(t, 1)) : nx;
    out.push({ d, k, auto });
    if (stop(out, d)) break;
  }
  return out;
}
const aheadAt = d => { const xs = ahead((o, x) => x >= d), last = xs[xs.length - 1]; return last && last.d === d ? last : null; };
// A coming day's kind (plan day id, 'train' or 'rest'), and what it would be without a pick; today and the past: the 口径.
const expectedKind = d => d > today() ? aheadAt(d)?.k ?? dayKind(d) : dayKind(d);
const autoOf = d => d > today() ? aheadAt(d)?.auto ?? autoDay(d) : autoDay(d);
// 「接下来：今天 B → 周六 C → 周一 D」: the next n training days (today counts until it has a session).
function nextTrainings(n = 3) {
  const t = today(), done = S.workouts.some(w => w.date === t);
  return ahead(o => o.filter(x => isPlanDay(x.k) && !(x.d === t && done)).length >= n).filter(x => isPlanDay(x.k) && !(x.d === t && done)).slice(0, n);
}
const dayWord = d => { const t = today(); return d === t ? '今天' : d === addDays(t, 1) ? '明天' : d === addDays(t, -1) ? '昨天' : `周${WD[parseD(d).getDay()]}`; };
const trainedOn = x => S.workouts.some(w => w.date === x) || (S.days[x]?.plan && S.days[x].plan !== 'rest');
function weekCount(d) {
  const mon = addDays(d, 1 - isoWd(d)); let n = 0;
  for (let i = 0; i < 7; i++) if (trainedOn(addDays(mon, i))) n++;
  return n;
}
// 临时目标: no plan yet, but the basics are in profile/main (sex, age, height, weight, goal, days a week). The daily
// average fitness-plan step 2 starts from: Mifflin-St Jeor × activity by training days, the goal's adjustment (the
// middle of its range), protein and fat per kg, the rest carbs; water 35 ml/kg. No AI involved; every place showing it
// says it is temporary. One number for every day (which days are training days is up to the plan).
const TEMP_ADJ = { fatloss: 0.825, muscle: 1.075, lean: 0.975, recomp: 0.925, strength: 1, health: 1 };
function tempTargets() {
  if (S.plan?.diet && isNum(S.plan.diet.kcal)) return null;
  return profileTargets();
}
// The same numbers from the basics alone, whatever the plan says (a field missing from plan.diet falls back to them).
function profileTargets() {
  const p = S.profile;
  if (!p || !['male', 'female'].includes(p.sex) || ![p.age, p.height, p.weight].every(isNum) || !(p.goal in TEMP_ADJ) || !(p.days >= 1 && p.days <= 7)) return null;
  const w = p.weight, bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const act = p.days <= 1 ? 1.3 : p.days <= 3 ? 1.4 : p.days <= 5 ? 1.55 : 1.65;
  const kcal = round10(bmr * act * TEMP_ADJ[p.goal]);
  const protein = Math.round(w * (['fatloss', 'lean', 'recomp'].includes(p.goal) ? 2.0 : 1.8));
  const fat = Math.round(w * 0.8);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, water: Math.min(4000, Math.max(1500, Math.round(w * 35 / 100) * 100)), temp: true };
}
function targetsFor(d) {
  const diet = S.plan?.diet;
  if (!diet || !isNum(diet.kcal)) {
    const tt = tempTargets(); if (!tt) return null;
    const b = activityBonus(d);
    return { kcal: tt.kcal + b, protein: tt.protein, carbs: tt.carbs + b / 4, fat: tt.fat, rest: false, bonus: b, temp: true };
  }
  const rest = dayKind(d) === 'rest' && !!diet.restDay;
  const t = rest ? { ...diet, ...diet.restDay } : diet;
  const bonus = activityBonus(d);
  // a plan with kcal but no protein / fat / carbs (saved half filled): those from the basics, carbs what the kcal leaves
  const pt = isNum(t.protein) && isNum(t.fat) && isNum(t.carbs) ? null : profileTargets();
  const protein = isNum(t.protein) ? t.protein : pt?.protein, fat = isNum(t.fat) ? t.fat : pt?.fat;
  const carbs = isNum(t.carbs) ? t.carbs : isNum(protein) && isNum(fat) ? Math.max(0, Math.round((t.kcal - 4 * protein - 9 * fat) / 4)) : pt?.carbs;
  return { kcal: t.kcal + bonus, protein, carbs: isNum(carbs) ? carbs + bonus / 4 : carbs, fat, rest, bonus };
}
// A metric the person marked 「这天不算」 (health.ignore) is missing everywhere: activity bonus, recovery, charts.
const hIgnored = (h, key) => Array.isArray(h?.ignore) && h.ignore.includes(key);
const hval = (d, key) => { const h = S.health[d], v = h?.[key]; return isNum(v) && !hIgnored(h, key) ? v : null; };
// Apple Health numbers against this person's own usual: the median over the 28 days before d.
const healthWin = d => Object.values(S.health).filter(x => x.date < d && x.date >= addDays(d, -28));
// The plan already budgets a usual training or rest day. When the Watch shows clearly more activity than this person's
// usual day of the same kind, add three quarters of the extra (the Watch tends to run high), on carbs. Days the Watch
// was barely worn (activity < 100 kcal or steps < 1000) are left out of the usual.
function activityBonus(d) {
  const a = hval(d, 'activeKcal'); if (a == null) return 0;
  const rest = dayKind(d) === 'rest';
  const xs = healthWin(d).map(x => ({ d: x.date, a: hval(x.date, 'activeKcal'), s: hval(x.date, 'steps') }))
    .filter(x => x.a != null && x.a >= 100 && !(x.s != null && x.s < 1000) && (dayKind(x.d) === 'rest') === rest).map(x => x.a);
  if (xs.length < 4) return 0;
  const extra = a - median(xs);
  return extra < 150 ? 0 : round10(Math.min(600, extra * 0.75));
}
// Recovery: resting HR 5+ above the usual, or the 3-day HRV mean at or below 85% of the usual, on two days running.
function recBase(d, key) { const xs = healthWin(d).map(x => hval(x.date, key)).filter(v => v != null); return xs.length >= 14 ? median(xs) : null; }
function hrv3(d) { const xs = [d, addDays(d, -1), addDays(d, -2)].map(x => hval(x, 'hrv')).filter(v => v != null); return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null; }
function rhrFlag(d) { const v = hval(d, 'restingHR'), b = recBase(d, 'restingHR'); return v != null && b != null && v - b >= 5; }
function hrvFlag(d) { const m = hrv3(d), b = recBase(d, 'hrv'); return m != null && b != null && m <= 0.85 * b; }
function recovery(d) {
  const y = addDays(d, -1);
  const rhr = rhrFlag(d) && rhrFlag(y), hrv = hrvFlag(d) && hrvFlag(y);
  return { rhr, hrv, warn: rhr || hrv };
}
// Tapping the row opens the day's numbers, where a metric can be marked 「这天不算」.
function healthRow(d) {
  const h = S.health[d]; if (!h) return '';
  const rb = recBase(d, 'restingHR'), hb = recBase(d, 'hrv'), h3 = hrv3(d), rhr = hval(d, 'restingHR');
  const rhrUp = rhr != null && rb != null ? Math.round(rhr - rb) : null;
  const hrvPct = h3 != null && hb ? Math.round((h3 - hb) / hb * 100) : null;
  const kv = (key, k, u, extra = '') => {
    const v = h[key], off = hIgnored(h, key) && isNum(v);
    return `<span class="kv${off ? ' off' : ''}"><span class="k">${k}</span><span class="v">${isNum(v) ? `${fmt(v)}<small>${u}</small>` : '<small>—</small>'}</span>${off ? '<span class="d">这天不算</span>' : extra}</span>`;
  };
  const dv = (txt, warn) => `<span class="d num${warn ? ' warn' : ''}">${esc(txt)}</span>`;
  // 静息心率 and HRV: 进阶显示 only (the recovery warning below still comes, in plain words)
  const adv = advOn();
  const row = `<button type="button" class="health${adv ? '' : ' two'}" data-act="health-open" data-d="${esc(d)}" aria-label="健康数据，点开看详情">${kv('steps', '步数', '')}${kv('activeKcal', '活动', 'kcal')}
    ${adv ? kv('restingHR', '静息心率', '', rhrUp != null ? dv(`比平时 ${rhrUp > 0 ? '+' : ''}${rhrUp}`, rhrFlag(d)) : '') : ''}
    ${adv ? kv('hrv', 'HRV', 'ms', hrvPct != null ? dv(`近3天 ${hrvPct > 0 ? '+' : ''}${hrvPct}%`, hrvFlag(d)) : '') : ''}</button>`;
  const rec = recovery(d);
  if (!rec.warn || d !== today()) return row;
  const why = adv ? [rec.rhr ? `静息心率连续两天偏高（今天比平时 +${rhrUp}）` : '', rec.hrv ? `HRV 近三天平均比平时低 ${-hrvPct}%` : ''].filter(Boolean).join('，') : '手表测的心率这两天显示还没恢复过来';
  return row + `<div class="recovery">恢复偏差：${esc(why)}。今天练的话保持上次的重量、别冲新纪录，晚上早点睡。</div>`;
}
function pendingCount() {
  return S.meals.filter(m => m.needsReview).length + S.workouts.filter(w => w.needsReview).length
    + Object.values(S.body).filter(b => b.needsReview).length + S.progress.filter(p => p.needsReview).length + (S.profile?.needsReview ? 1 : 0);
}
const hm = m => `${Math.floor(m / 60)}:${pad(Math.round(m % 60))}`;
const SLEEP_SRC = { 'apple-health': 'Apple 健康', screenshot: '截图', manual: '自己改的' };
// Last night's sleep (the night that ended on date d) as stage proportions. Tap: the sleep sheet. A night the person
// cleared (source manual, cleared) counts as no data.
function sleepStrip(d) {
  const sl = S.sleep[d]; if (!sl) return '';
  if (sl.cleared) return `<button type="button" class="sleep" data-act="sleep-open" data-d="${esc(d)}"><span class="sleep-top"><span>这晚的睡眠数据清除了</span><span>自己改的</span></span></button>`;
  if (!isNum(sl.asleep)) return '';
  const parts = [['deep', '深睡', 'var(--sl-deep)'], ['core', '核心', 'var(--sl-core)'], ['rem', 'REM', 'var(--sl-rem)'], ['awake', '清醒', 'var(--sl-awake)']]
    .filter(([k]) => isNum(sl[k]) && sl[k] > 0);
  const label = parts.map(([k, l]) => `${l} ${hm(sl[k])}`).join('，');
  const span = sl.bedtime || sl.wake ? `${esc(sl.bedtime || '?')}–${esc(sl.wake || '?')} · ` : '';
  return `<button type="button" class="sleep" data-act="sleep-open" data-d="${esc(d)}" aria-label="睡眠，点开可以修改">
    <span class="sleep-top"><span>${span}睡着 <b class="num">${hm(sl.asleep)}</b>${isNum(sl.inBed) ? ` · 卧床 ${hm(sl.inBed)}` : ''}</span><span>${esc(SLEEP_SRC[sl.source] || '')}</span></span>
    ${parts.length ? `<span class="sbar" role="img" aria-label="${esc(label)}">${parts.map(([k, , c]) => `<i style="flex:${sl[k]};--c:${c}"></i>`).join('')}</span>
    <span class="slegend">${parts.map(([k, l, c]) => `<span><i style="--c:${c}"></i>${l} <b class="num">${hm(sl[k])}</b></span>`).join('')}</span>` : ''}
  </button>`;
}
function woStats(w) {
  let sets = 0, done = 0, vol = 0;
  (w.exercises || []).forEach(x => (x.sets || []).forEach(s => {
    if (s.warmup) return;  // warm-up sets count neither toward completion nor volume
    sets++; if (s.done) { done++; if (isNum(s.kg) && isNum(s.reps) && !isNum(s.assist)) vol += s.kg * s.reps; }
  }));
  return { ex: (w.exercises || []).length, sets, done, vol };
}
// One set as text: 60 × 8 (unit: 60 kg × 8), 自重 × 12, 自重+10 kg × 8, 助力 20 kg × 8, 69 秒, 10 kg · 60 秒.
function setTxt(s, unit) {
  const u = unit ? ' kg' : '';
  const load = isNum(s.assist) && s.assist > 0 ? `助力 ${s.assist} kg`
    : s.bodyweight ? (isNum(s.kg) && s.kg > 0 ? `自重+${s.kg} kg` : '自重') : (isNum(s.kg) ? `${s.kg}${u || (isNum(s.sec) ? ' kg' : '')}` : '');
  if (isNum(s.sec)) return load ? `${load} · ${s.sec} 秒` : `${s.sec} 秒`;
  return `${load || '–'} × ${isNum(s.reps) ? s.reps : '–'}`;
}
// Several sets: the first with its unit, the rest without (「17.5 kg × 15 · 17.5 × 12」).
const setsTxt = sets => (sets || []).map((s, i) => setTxt(s, !i)).join(' · ');
const hasSetData = s => isNum(s.kg) || isNum(s.reps) || isNum(s.assist) || isNum(s.sec) || !!s.bodyweight;
// Working sets of a session: no warm-ups or drop sets; the ticked ones if any were ticked.
function workSets(sets) {
  const xs = (sets || []).filter(s => s && !s.warmup && !s.drop && hasSetData(s));
  return xs.some(s => s.done) ? xs.filter(s => s.done) : xs;
}

// body/<d>.weight: 'manual' (typed here, Apple Health won't overwrite it), 'apple-health', or 'cleared'
// ({weight: null, weightSource: 'manual'}: the person removed a wrong weigh-in and it stays removed).
const weightCleared = b => !!b && b.weight === null && b.weightSource === 'manual';
function weightSrc(b) {
  if (weightCleared(b)) return 'cleared';
  if (!isNum(b?.weight)) return null;
  return b.weightSource === 'manual' || !b.weightSource || (isNum(b.weightAuto) && b.weightAuto !== b.weight) ? 'manual' : 'apple-health';
}
// body/<d>.bodyFat, the same rules as the weight: bodyFatSource manual (or none, or not what Apple Health said) is typed
// here; {bodyFat: null, bodyFatSource: 'manual'} is cleared on purpose.
const bodyFatCleared = b => !!b && b.bodyFat === null && b.bodyFatSource === 'manual';
function bodyFatSrc(b) {
  if (bodyFatCleared(b)) return 'cleared';
  if (!isNum(b?.bodyFat)) return null;
  return b.bodyFatSource === 'manual' || !b.bodyFatSource || (isNum(b.bodyFatAuto) && b.bodyFatAuto !== b.bodyFat) ? 'manual' : 'apple-health';
}
function latestWeight() {
  const b = Object.values(S.body).filter(x => isNum(x.weight)).sort((a, z) => z.date.localeCompare(a.date))[0];
  return b ? b.weight : null;
}
// Daily water target: the plan's number if Claude set one, else 35 ml per kg, else 2 L.
function waterTarget() {
  if (isNum(S.plan?.diet?.water)) return S.plan.diet.water;
  const tt = tempTargets(); if (tt) return tt.water;
  const w = latestWeight() ?? S.profile?.weight;
  return isNum(w) ? Math.min(3500, Math.max(1500, Math.round(w * 35 / 100) * 100)) : 2000;
}

/* ---------- water ---------- */
// Taps are queued as operations (add / undo) and shown at once. Each entry carries an id, so replaying the queue on top
// of the server's copy (after a lost response, a conflict or a reload) never adds or removes the same tap twice. The
// queue lives in localStorage until the server has it.
const waterPending = {};
const waterSum = entries => (entries || []).reduce((s, e) => s + (isNum(e.ml) ? e.ml : 0), 0);
// An entry by id; an old entry without an id: the last one that looks the same (fp: {t, ml, kind}).
function waterIndex(e, id, fp) {
  if (typeof id === 'string') return e.findIndex(x => x.id === id);
  for (let j = e.length - 1; j >= 0; j--) {
    const x = e[j]; if (!x.id && x.t === fp?.t && x.ml === fp?.ml && (x.kind || 'water') === (fp?.kind || 'water')) return j;
  }
  return -1;
}
// Ops: {add: entry} · {undo: id | true, fp} removes one · {edit: id | null, fp, set: {ml, kind, t}, nid} changes one
// (an entry without an id gets nid, so replaying the op finds it again).
function applyWater(entries, ops) {
  const e = [...(entries || [])];
  for (const o of ops) {
    if (o.add) { if (!o.add.id || !e.some(x => x.id === o.add.id)) e.push(o.add); continue; }
    if (o.set) {
      let i = o.nid ? e.findIndex(x => x.id === o.nid) : -1;
      if (i < 0) i = waterIndex(e, o.edit, o.fp);
      if (i >= 0) e[i] = { ...e[i], ...o.set, id: e[i].id || o.nid };
      continue;
    }
    if (!o.undo) continue;
    const i = waterIndex(e, o.undo, o.fp);
    if (i >= 0) e.splice(i, 1);
  }
  return e;
}
function waterDay(d) {
  const base = S.water[d] || { date: d, entries: [] }; const p = waterPending[d];
  return p ? { date: d, entries: applyWater(base.entries, p.ops) } : base;
}
const waterKey = () => 'lsj-water-q:' + (S.me?.id || lsGet('lsj-uid') || '');
function persistWater() {
  const o = {}; for (const [d, p] of Object.entries(waterPending)) if (p.ops.length) o[d] = p.ops;
  lsSet(waterKey(), Object.keys(o).length ? JSON.stringify(o) : null);
}
function loadWaterQueue() {
  let o = null; try { o = JSON.parse(lsGet(waterKey()) || 'null'); } catch (e) {}
  if (!o || typeof o !== 'object') return;
  for (const [d, ops] of Object.entries(o)) {
    if (!isDate(d) || !Array.isArray(ops)) continue;
    const p = waterPending[d] || (waterPending[d] = { ops: [] });
    for (const op of ops) if (!p.ops.some(x => JSON.stringify(x) === JSON.stringify(op))) p.ops.push(op);
  }
}
function queueWater(d, op) {
  const p = waterPending[d] || (waterPending[d] = { ops: [] });
  p.ops.push(op); persistWater(); clearTimeout(p.timer);
  p.timer = setTimeout(() => flushWater(d), 700);
  render();
}
function addWater(ml, kind = 'water', d = S.date, t) { queueWater(d, { add: { id: newId('h'), t: t !== undefined ? t : d === today() ? nowHM() : null, ml, kind } }); }
const waterRef = x => x.id ? { id: x.id } : { fp: { t: x.t, ml: x.ml, kind: x.kind } };
function undoWater(d = S.date) {
  const e = waterDay(d).entries || []; const last = e[e.length - 1]; if (!last) return;
  const r = waterRef(last); queueWater(d, r.id ? { undo: r.id } : { undo: true, fp: r.fp });
}
const flushAllWater = () => Object.keys(waterPending).forEach(flushWater);
async function flushWater(d) {
  const p = waterPending[d]; if (!p || p.saving || !S.db || !p.ops.length) return;
  clearTimeout(p.timer);
  p.saving = true; const ops = p.ops.slice(); const ref = S.db.collection('water').doc(d);
  try {
    let cur = S.db.cached('water', d) || await retry1(() => ref.get());
    for (let i = 0; ; i++) {
      const entries = applyWater(cur.exists ? cur.data.entries : [], ops);
      const doc = { ...(cur.exists ? cur.data : {}), date: d, entries, total: waterSum(entries), updatedAt: new Date().toISOString() };
      try { await retry1(() => ref.set(doc, { ifVersion: cur.version })); break; }
      catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await retry1(() => ref.get()); }
    }
    p.ops.splice(0, ops.length); p.failed = false; p.tries = 0;
    if (!p.ops.length && waterPending[d] === p) delete waterPending[d];
  } catch (e) {
    p.failed = true; p.tries = (p.tries || 0) + 1;  // shown as 「未同步」 on the card; retried quietly
    if (e?.code !== 'unauthenticated') p.timer = setTimeout(() => flushWater(d), Math.min(60000, 5000 * p.tries));
  }
  p.saving = false; persistWater();
  if (waterPending[d] === p && p.ops.length && !p.failed) flushWater(d);
  render();
}
// Milk and soy milk logged as drinks, as food.
function drinkIntake(d) {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, ml: {} };
  for (const e of waterDay(d).entries || []) {
    const m = DRINK_MACROS[e.kind]; if (!m || !isNum(e.ml)) continue;
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) out[k] += e.ml / 100 * m[k];
    out.ml[e.kind] = (out.ml[e.kind] || 0) + e.ml;
  }
  return out;
}

// A meal's one-tap items (picked from plan.diet.quick); quickItems: only while nothing else gives the meal's numbers.
const quickList = m => Array.isArray(m?.quick) ? m.quick.filter(q => q && typeof q === 'object') : [];
const manualOf = m => m?.manual && typeof m.manual === 'object' && isNum(m.manual.kcal) ? m.manual : null;
const quickItems = m => !isNum(m.review?.kcal) && !manualOf(m) ? quickList(m) : [];
const quickOnly = m => Array.isArray(m.quick) && m.quick.length > 0 && !(m.photos || []).length;
// What one meal adds to its day: per field the numbers the person typed (manual), else Claude's (review), else the
// one-tap items' sum, else 0. null while none of the three exists yet (the meal is pending). src: which one gave kcal.
function mealNums(m) {
  const man = m?.manual && typeof m.manual === 'object' ? m.manual : {}, rv = m?.review && typeof m.review === 'object' ? m.review : {};
  const qs = quickList(m);
  if (!isNum(man.kcal) && !isNum(rv.kcal) && !qs.length) return null;
  const out = { src: isNum(man.kcal) ? 'manual' : isNum(rv.kcal) ? 'review' : 'quick' };
  for (const k of MKEYS) out[k] = isNum(man[k]) ? man[k] : isNum(rv[k]) ? rv[k] : qs.reduce((s, q) => s + (isNum(q[k]) ? q[k] : 0), 0);
  return out;
}
// What day d adds up to, the way the 摄入 meters count it: each meal's mealNums, plus milk / soy milk from 喝水.
// waiting / pending: meals nothing counts yet (waiting for Claude).
function intake(d) {
  const meals = S.meals.filter(m => m.date === d);
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 }, quick = { kcal: 0, protein: 0, carbs: 0, fat: 0, names: [] };
  let reviewed = 0, manual = 0; const pending = [];
  for (const m of meals) {
    const n = mealNums(m);
    if (!n) { pending.push(m); continue; }
    for (const k of MKEYS) sum[k] += n[k];
    if (n.src === 'review') reviewed++;
    else if (n.src === 'manual') manual++;
    else { for (const k of MKEYS) quick[k] += n[k]; quickList(m).forEach(q => quick.names.push(String(q.name || '快速记录'))); }
  }
  const dr = drinkIntake(d);
  for (const k of MKEYS) sum[k] += dr[k];
  return { meals, sum, reviewed, manual, waiting: pending.length, pending, quick, dr, logged: meals.filter(m => !quickOnly(m)).length };
}

// Last logged sets for an exercise (with that session's id and the exercise's target), and Claude's advice for it (from
// the last 21 days; adviceAt: the date of the session it was written on), from sessions on or before `date`.
function exHistory(name, date, excludeId) {
  const key = (name || '').trim(); if (!key) return {};
  const ws = S.workouts.filter(w => w.id !== excludeId && w.date <= date)
    .sort((a, z) => z.date.localeCompare(a.date) || woTime(z).localeCompare(woTime(a)));
  const fresh = addDays(date, -ADVICE_DAYS);
  let advice = null, adviceAt = null;
  for (const w of ws) {
    if (!advice && w.date >= fresh && w.review?.nextByExercise?.[key]) { advice = String(w.review.nextByExercise[key]); adviceAt = w.date; }
    const x = (w.exercises || []).find(e => (e.name || '').trim() === key);
    if (x && (x.sets || []).some(hasSetData)) return { last: { date: w.date, sets: x.sets, id: w.id, target: x.target, createdAt: w.createdAt }, advice, adviceAt };
  }
  return { advice, adviceAt };
}
function parseRest(r) {
  const s = String(r || ''); const m = s.match(/\d+(?:\.\d+)?/); if (!m) return null;
  return Math.round(/min|分/i.test(s) ? parseFloat(m[0]) * 60 : parseFloat(m[0]));
}

/* ---------- 训练单: what to do this time, and how a session went against the last one ---------- */
// A set's load as one number to compare by: kg; bodyweight: the added kg (0 without); assisted: minus the help.
function setLoad(s) {
  if (isNum(s?.assist) && s.assist > 0) return -s.assist;
  if (s?.bodyweight) return isNum(s.kg) ? s.kg : 0;
  return isNum(s?.kg) ? s.kg : null;
}
// A set's load with its unit: 30 kg · 自重 · 自重+10 kg · 助力 20 kg ('' when none was recorded).
function loadTxt(s) {
  if (isNum(s?.assist) && s.assist > 0) return `助力 ${s.assist} kg`;
  if (s?.bodyweight) return isNum(s.kg) && s.kg > 0 ? `自重+${s.kg} kg` : '自重';
  return isNum(s?.kg) ? `${s.kg} kg` : '';
}
// The working sets of one exercise in one session: drop sets never count, and when some sets are ticked only those.
// The working load is the one most sets were done with (a tie: the heavier). Warm-ups: the ones marked so and the
// lighter sets before the first working set; a heavier set is the top set. null when no set has numbers.
function workOf(sets) {
  const all = (sets || []).filter(s => s && typeof s === 'object' && !s.drop && hasSetData(s));
  const used = all.some(s => s.done) ? all.filter(s => s.done) : all;
  const xs = used.filter(s => !s.warmup);
  if (!xs.length) return null;
  const marked = used.filter(s => s.warmup);
  if (xs.every(s => isNum(s.sec) && !isNum(s.reps))) return { timed: true, load: setLoad(xs[0]), sets: xs, top: null, warm: new Set(marked) };
  // sets without a weight say nothing about the working weight while others have one
  const pool = xs.some(s => setLoad(s) != null) ? xs.filter(s => setLoad(s) != null) : xs;
  const key = l => l == null ? -Infinity : l;
  const n = new Map(); for (const s of pool) n.set(setLoad(s), (n.get(setLoad(s)) || 0) + 1);
  let load, best = 0;
  for (const [l, c] of n) if (c > best || (c === best && key(l) > key(load))) { load = l; best = c; }
  const first = pool.findIndex(s => setLoad(s) === load);
  const top = pool.filter(s => key(setLoad(s)) > key(load)).sort((a, z) => setLoad(z) - setLoad(a) || (z.reps || 0) - (a.reps || 0))[0] || null;
  return { load, sets: pool.filter(s => setLoad(s) === load), top, warm: new Set(marked.concat(pool.slice(0, first).filter(s => key(setLoad(s)) < key(load)))), mixed: pool.length < xs.length };
}
// 「30 kg × 12/12/10」 · 「自重 × 12/10」 · 「60/45 秒」
function workTxt(wk) {
  const l = loadTxt(wk.sets[0]), lastRpe = wk.sets[wk.sets.length - 1]?.rpe;  // the last set's RPE: 「× 12/12/12 @8」
  if (wk.timed) return `${l ? l + ' · ' : ''}${wk.sets.map(s => s.sec).join('/')} 秒`;
  return `${l || '–'} × ${wk.sets.map(s => isNum(s.reps) ? s.reps : '–').join('/')}${isNum(lastRpe) ? ` @${lastRpe}` : ''}`;
}
// 「上次 01/05 · 30 kg × 12/12/10 · 最重 32.5 kg × 8」 (h: exHistory or prevEx); 「第一次练」 without one.
function lastTxt(last) {
  const wk = last ? workOf(last.sets) : null;
  if (!wk) return '第一次练';
  return `上次 ${md(last.date)} · ${workTxt(wk)}${wk.top ? ` · 最重 ${setTxt(wk.top, true)}` : ''}`;
}
// 「8–12」 → [8, 12], 「15」 → [15, 15]; afterX: the part after × in a target like 「4×8–12 · 30 kg」.
function repRange(txt, afterX) {
  const m = (afterX ? /[×x*]\s*(\d+)(?:\s*[–\-~～]\s*(\d+))?/ : /^\s*(\d+)(?:\s*[–\-~～]\s*(\d+))?/).exec(String(txt ?? ''));
  return m ? [+m[1], +(m[2] || m[1])] : null;
}
// The plan's exercise of this name: on plan day `dayId` first, then on any other day.
function planEx(name, dayId) {
  const key = String(name || '').trim(); if (!key) return null;
  const days = planDays(), own = days.find(x => x.id === dayId);
  for (const d of own ? [own, ...days.filter(x => x !== own)] : days) {
    const x = (d.exercises || []).find(e => e && String(e.name || '').trim() === key);
    if (x) return x;
  }
  return null;
}
// What an exercise in a session aimed at: its own target (训记 sync fills it from the plan), else the plan's exercise
// of the same name. {txt: 「4×8–12 · 30 kg」, lo, hi}.
function exTarget(e, dayId) {
  const own = String(e?.target || '').trim();
  if (own) { const r = repRange(own, true); return { txt: own.split(/\s*·\s*/).filter(p => !/^休息/.test(p)).join(' · '), lo: r?.[0], hi: r?.[1] }; }
  const x = planEx(e?.name, dayId); if (!x) return null;
  const r = repRange(x.reps);
  return { txt: [`${x.sets ?? ''}×${x.reps ?? ''}`, x.load ? spaced(x.load) : ''].filter(Boolean).join(' · '), lo: r?.[0], hi: r?.[1] };
}
const woBefore = (x, w) => x.id !== w.id && (x.date < w.date || (x.date === w.date && woTime(x) < woTime(w)));
const newestFirst = (a, z) => z.date.localeCompare(a.date) || latestFirst(a, z);
// The last time before session w that this exercise was done (any plan day).
function prevEx(name, w) {
  const key = String(name || '').trim(); if (!key) return null;
  for (const x of S.workouts.filter(x => woBefore(x, w)).sort(newestFirst)) {
    const e = (x.exercises || []).find(e => (e?.name || '').trim() === key);
    if (e && (e.sets || []).some(hasSetData)) return { date: x.date, sets: e.sets, id: x.id, createdAt: x.createdAt, target: e.target };
  }
  return null;
}
// A plan's 「RPE 7」 / 「RPE 7–8」 with 进阶显示 off: 「留 3 次余力」 / 「留 2–3 次余力」 (what RPE means, reps left in reserve).
function plainRpe(t) {
  if (advOn()) return String(t ?? '');
  return String(t ?? '').replace(/RPE\s*(\d+(?:\.\d+)?)(?:\s*[–\-~～]\s*(\d+(?:\.\d+)?))?/gi, (m, a, b) => {
    const hi = r2(10 - Number(a)), lo = b ? r2(10 - Number(b)) : hi;
    return lo === hi ? `留 ${hi} 次余力` : `留 ${lo}–${hi} 次余力`;
  });
}
// 「4×8–12 · 22.5kg」 as people read it: 「4 组 × 8–12 次 · 22.5 kg」 (the stored target text stays as it is).
function humanTarget(txt) {
  return plainRpe(String(txt || '').trim()).replace(/^(\d+)\s*[×x*]\s*([^·]+?)(?=\s*(?:·|$))/, (m, s, r) => `${s} 组 × ${r}${/秒|s$/i.test(r) ? '' : ' 次'}`).replace(/(\d)(kg)$/i, '$1 $2').replace(/(\d)(kg)(\s*·)/i, '$1 $2$3');
}
// The session before w on the same plan day.
const prevSession = w => !isPlanDay(w.planDayId) ? null : S.workouts.filter(x => x.planDayId === w.planDayId && woBefore(x, w)).sort(newestFirst)[0] || null;
// How an exercise of session w went: its working sets against the target's low end (every one reaches it: ok, else
// short) and against the last time (a heavier working load: up; the same load and more reps in all: more).
function exVerdict(e, w) {
  if (!e || e.cardio) return null;
  const wk = workOf(e.sets); if (!wk) return null;
  const tg = exTarget(e, w.planDayId), p = prevEx(e.name, w), pw = p ? workOf(p.sets) : null;
  const v = { wk, tg, prev: pw ? { date: p.date, wk: pw, sets: p.sets } : null, up: null, more: null, hit: null, miss: 0 };
  if (pw && !wk.timed && !pw.timed && !wk.mixed && !pw.mixed) {  // a weight missing on some sets: no claim either way
    // under 1 kg apart counts as the same weight: a stack in lb converts to odd kg (50 lb = 22.7, logged as 22.7 or 23)
    const same = wk.load != null && pw.load != null && Math.abs(wk.load - pw.load) < 1;
    if (wk.load != null && pw.load != null && !same && wk.load > pw.load) v.up = Math.round((wk.load - pw.load) * 100) / 100;
    else if (same) {
      const sum = k => k.sets.reduce((s, x) => s + (isNum(x.reps) ? x.reps : 0), 0);
      if (sum(wk) > sum(pw)) v.more = sum(wk) - sum(pw);
    }
  }
  if (isNum(tg?.lo) && !wk.timed && wk.sets.some(s => isNum(s.reps))) { v.miss = wk.sets.filter(s => !(s.reps >= tg.lo)).length; v.hit = !v.miss; }
  return v;
}
// The verdict as tags: progress first (加重了 / 次数涨了), then 达标 / 差一点. long: the words too (the details sheet).
function verdictTags(v, long) {
  if (!v) return '';
  const out = [];
  const assisted = v.wk.load < 0;
  if (v.up) out.push(['up', long ? `加重了 ${assisted ? `助力少 ${v.up} kg` : `↑${v.up} kg`}` : assisted ? `助力 −${v.up}` : `↑${v.up} kg`, '加重了']);
  else if (v.more) out.push(['up', long ? `次数涨了 +${v.more} 次` : `+${v.more} 次`, '次数涨了']);
  if (v.hit === false) out.push(['short', long ? `差一点：${v.miss} 组没到 ${v.tg.lo} 次` : '差一点', '差一点']);
  else if (v.hit && !out.length) out.push(['ok', '✓ 达标', '每组都到了目标次数']);
  return out.map(([c, t, l]) => `<span class="vd ${c}" title="${esc(l)}">${esc(t)}</span>`).join('');
}
// A plan exercise's prescription for day d: Claude's advice (nextByExercise, 21 days, and written on or after the last
// time the exercise was done; older advice was for a session already trained) > the rule from last time (ruleRx) > the
// plan's load and reps (after a long gap: the low end of the range). {load, reps, sets, src: claude|rule|plan, note, why, h};
// o.dayId: the plan day (which plan exercise counts), o.excludeId: a session to leave out (训练中: the one running), o.h:
// exHistory already looked up.
function exRx(x, d, low, o = {}) {
  const h = o.h || exHistory(x.name, d, o.excludeId), sets = x.sets ?? '';
  if (inDeload(d)) { const dl = deloadRx(x, d, o.dayId, h); if (dl) return dl; }  // a deload week: half the sets, the same weight
  if (h.advice && (!h.last || !h.adviceAt || h.adviceAt >= h.last.date)) {
    const a = String(h.advice).trim(), m = /^(.*?)\s*[（(]([^）)]*)[）)]\s*$/.exec(a), main = m ? m[1] : a;
    const kg = /(\d+(?:\.\d+)?)\s*kg/i.exec(main), reps = /[×x*]\s*(\d+(?:\s*[–\-]\s*\d+)?)/i.exec(main);
    let load = kg ? `${kg[1]} kg` : /自重/.test(main) ? '自重' : null, claudeKg = null;
    const note = m ? m[2] : '', why = [note];
    // a weight the rack doesn't have (24.5 kg) snaps to the exercise's step; the small print keeps what Claude wrote
    if (kg) { const v = Number(kg[1]), sn = toStep(v, stepOf(x.name, o.dayId)); if (Math.abs(sn - v) > 0.01 && sn > 0) { load = `${sn} kg`; claudeKg = v; why.push(`Claude 说 ${v} kg`); } }
    if (load || reps) return { load, reps: reps ? reps[1].replace(/\s*-\s*/, '–') : null, sets, src: 'claude', note, why: why.filter(Boolean).join(' · '), claudeKg, h };
    return { raw: a, sets, src: 'claude', note: '', why: '', h };
  }
  const r = ruleRx(x.name, d, o.dayId, o.excludeId, h);
  if (r) return { ...r, sets: sets !== '' ? sets : r.sets, h };
  const ld = String(x.load ?? '').trim(), kg = /^(\d+(?:\.\d+)?)\s*kg$/i.exec(ld), rr = repRange(x.reps);
  return { load: kg ? `${kg[1]} kg` : /自重/.test(ld) ? '自重' : null, reps: low && rr ? String(rr[0]) : String(x.reps ?? '').trim() || null, sets, src: 'plan', note: kg || /自重/.test(ld) ? '' : spaced(ld), why: '', h };
}
// The weight step of an exercise: what −/+ move by, what the rule adds or takes off, and what Claude's advice snaps
// to. The plan's `step` for it (on this plan day, else on another), else the smallest difference between the distinct working weights it was done with
// (≥ 1, ≤ 10, to 0.5, at least two weights: some gyms' dumbbells go by 1 kg, a stack in lb by about 6.8), else by
// the equipment in its name: a barbell 2.5 (legs 5), dumbbells / kettlebells / one-sided moves 2, machines and cables 5.
function stepOf(name, dayId) {
  const key = String(name || '').trim(); if (!key) return 2.5;
  const px = planEx(key, dayId); if (px && isNum(px.step) && px.step > 0) return px.step;
  // the same move on another plan day with its step set (侧平举 on two days, the same dumbbells)
  for (const d of planDays()) { const e = (d.exercises || []).find(e => e && String(e.name || '').trim() === key && isNum(e.step) && e.step > 0); if (e) return e.step; }
  // a barbell goes by plates, never by the history (a 40 and a 41 kg entry would make it 1 kg)
  if (/杠铃/.test(key)) return exPart(key) === '腿' ? 5 : 2.5;
  const h = stepHist(key); if (h != null) return h;
  if (/哑铃|壶铃|单手|单腿|单臂|保加利亚|箭步/.test(key)) return 2;
  if (/器械|绳索|下拉|划船|倒蹬|屈伸|弯举|提踵|史密斯|哈克|龙门/.test(key)) return 5;
  return 2.5;
}
// The smallest positive difference between the distinct working weights (or assistance) in the history, to 0.5;
// null without two weights or outside 1–10.
function stepHist(key, field = 'kg') {
  const seen = new Set();
  for (const w of S.workouts) for (const e of w.exercises || []) {
    if (!e || String(e.name || '').trim() !== key) continue;
    for (const s of e.sets || []) if (s && !s.warmup && !s.drop && isNum(s[field]) && s[field] > 0) seen.add(r2(s[field]));
  }
  const xs = [...seen].sort((a, z) => a - z); if (xs.length < 2) return null;
  let min = Infinity; for (let i = 1; i < xs.length; i++) min = Math.min(min, xs[i] - xs[i - 1]);
  const st = Math.round(min * 2) / 2;
  return st >= 1 && st <= 10 ? st : null;
}
const toStep = (v, step) => r2(Math.round(v / step) * step);
// Single-joint moves (平举、弯举、下压、臂屈伸、面拉、提踵、卷腹、夹胸、飞鸟): the rule never takes weight off them.
const isIsolation = name => /平举|弯举|下压|臂屈伸|面拉|提踵|卷腹|夹胸|飞鸟|收腹|举腿/.test(String(name || ''));
// Progressive overload by rule, from the last time this exercise was done (when Claude has no fresh advice). The one
// rule table the page, the skill and the help text share:
//   prev = the working sets of the last time (workOf; fewer than two, or a set-by-set ramp like 15/17/19/20: the
//   heaviest set, said in the why); [lo, hi] = the plan's rep range (else the session's own target); step = stepOf;
//   lastRpe = the RPE on the last working set; the sessions before, for runs at the same weight (prevEx).
//   0. a break: 10–20 days the same weight at the low end; 21–41 days 10% off; 42 or more 15% off (to the step).
//   1. a miss = a working set under lo (a set with RPE ≤ 8 doesn't count: stopped early). Misses in the first two
//      sessions after a weight increase don't count as a run. A run = the same weight, sessions at most 20 days
//      apart. Three misses in a row, or two with the total reps falling → one step off (isolation moves: keep);
//      any other miss → keep, 「先把 4×8 做满」.
//   2. every set at lo or more: add a step when every set reaches hi, or the first set does and the total is at
//      least sets × hi − 2, and the last set's RPE is unknown or ≤ 9 (RPE 10: the same weight once more). A step
//      over 10% of the weight: more reps first (lo–(hi+3)), unless every set already reached hi+3. Three sessions
//      at the same weight without the total rising: keep, stalled. Totals are compared over the sets every one of
//      the sessions has (a session with fewer sets done is not a fall).
//   3. the rest: keep, 「每组都到 12 次就加重」.
//   Body weight: every set at hi+2 → add 2.5 kg or a harder variation; assisted: every set at hi → step less help,
//   at 5 kg or less → no help; timed: every set at the target → 10 s more; cardio: nothing.
// {name, kind, load, reps, sets, src: 'rule', why, lo, hi, step, kg?, assist?, sec?, up?, down?, stalled?} or null.
function ruleRx(name, date, dayId, excludeId, h) {
  const key = String(name || '').trim(); if (!key) return null;
  const kind = guessKind(key); if (kind === 'cardio') return null;
  const last = (h || exHistory(key, date, excludeId)).last; if (!last) return null;
  const prev = workOf(last.sets); if (!prev || prev.mixed || (prev.timed && kind !== 'sec')) return null;
  const px = planEx(key, dayId);
  const range = (px && repRange(px.reps)) || (last.target ? repRange(last.target, true) : null); if (!range) return null;
  const [lo, hi] = range, sets = parseInt(px?.sets, 10) || prev.sets.length, gap = daysBetween(last.date, date);
  const pick = wk => { let xs = wk.sets, top = false; if (xs.length < 2) { xs = [wk.top || xs[0]]; top = true; } return { xs, top }; };
  const { xs: work, top: byTop } = pick(prev);
  const first = work[0], step = stepOf(key, dayId), rng = lo === hi ? String(lo) : `${lo}–${hi}`;
  const out = { name: key, kind, sets, src: 'rule', lo, hi, step, load: loadTxt(first) || null, reps: rng, note: '' };
  const say = t => (byTop ? '按最重一组：' : '') + t;
  if (kind === 'sec') {
    const secs = work.map(s => s.sec); if (!secs.every(isNum)) return null;
    if (secs.every(v => v >= lo)) return { ...out, reps: `${lo + 10} 秒`, sec: lo + 10, up: true, why: say(`上次都撑到 ${lo} 秒，这次 ${lo + 10} 秒`) };
    return { ...out, reps: `${lo} 秒`, why: say(`上次 ${secs.join('/')} 秒，先撑满 ${lo} 秒`) };
  }
  const reps = work.map(s => s.reps); if (!reps.every(isNum)) return null;
  const n = reps.length, rs = reps.join('/'), total = reps.reduce((a, c) => a + c, 0);
  const allHi = reps.every(v => v >= hi), allLo = reps.every(v => v >= lo), shortAt = reps.findIndex(v => v < lo);
  const full = `先把 ${sets}×${lo} 做满`;
  if (kind === 'bw') {
    out.load = out.load || '自重';  // older imports carry no body-weight mark
    if (reps.every(v => v >= hi + 2)) return { ...out, load: '自重 +2.5 kg', up: true, why: say(`都到 ${hi + 2} 次了，可以加负重或换更难的变式`) };
    if (!allLo) return { ...out, why: say(`上次第 ${shortAt + 1} 组只到 ${reps[shortAt]} 次，${full}`) };
    return { ...out, why: say(`上次 ${rs}，每组都到 ${hi + 2} 次就加负重`) };
  }
  if (kind === 'assist') {
    const a = isNum(first?.assist) ? first.assist : null; if (a == null) return null;
    const st = stepHist(key, 'assist') ?? 2.5;
    if (allHi && a <= 5) return { ...out, load: '自重', assist: 0, up: true, why: say('可以去掉辅助了') };
    if (allHi) { const na = Math.max(0, r2(a - st)); return { ...out, load: `辅助 ${na} kg`, assist: na, up: true, why: say(`上次都到 ${hi} 次，辅助减到 ${na} kg`) }; }
    if (!allLo) return { ...out, load: `辅助 ${a} kg`, why: say(`上次第 ${shortAt + 1} 组只到 ${reps[shortAt]} 次，${full}`) };
    return { ...out, load: `辅助 ${a} kg`, why: say(`上次 ${rs}，每组都到 ${hi} 次就减辅助`) };
  }
  const kg = isNum(first?.kg) ? first.kg : null; if (kg == null) return null;
  out.load = `${kg} kg`; out.kg = kg;
  const off = (pct, why) => { const nk = Math.max(step, toStep(kg * (1 - pct), step)); return { ...out, load: `${nk} kg`, kg: nk, reps: String(lo), down: true, why: say(why(nk)) }; };
  // 0. a break
  if (gap >= 42) return off(0.15, nk => `隔了 ${gapTxt(gap)}，降到 ${nk} kg、先做到 ${lo} 次`);
  if (gap >= 21) return off(0.10, nk => `隔了 ${gapTxt(gap)}，降到 ${nk} kg、先做到 ${lo} 次`);
  if (gap >= 10) return { ...out, reps: String(lo), why: say(`隔了 ${gapTxt(gap)}，先做到 ${lo} 次`) };
  // the sessions before, newest first, each within 20 days of the next: {load, total, miss}
  const missed = ss => ss.some(s => s.reps < lo && !(isNum(s.rpe) && s.rpe <= 8));
  const judge = ss => { const wk = workOf(ss); if (!wk || wk.mixed || wk.timed) return null; const { xs } = pick(wk); const rr = xs.map(s => s.reps); if (!rr.every(isNum)) return null; return { load: setLoad(xs[0]), reps: rr, miss: missed(xs) }; };
  // the total reps of each of the runs' first k sessions, over the sets all k have
  const totals = (rs, k) => { const m = Math.min(...rs.slice(0, k).map(r => r.reps.length)); return rs.slice(0, k).map(r => r.reps.slice(0, m).reduce((a, c) => a + c, 0)); };
  const before = []; let ref = { id: last.id, date: last.date, createdAt: last.createdAt || '' };
  for (let k = 0; k < 5; k++) {
    const p = prevEx(key, ref); if (!p || daysBetween(p.date, ref.date) > 20) break;
    const j = judge(p.sets); if (!j) break;
    before.push(j); ref = { id: p.id, date: p.date, createdAt: p.createdAt || '' };
  }
  const same = l => l != null && Math.abs(l - kg) < 1;
  const run = [{ load: kg, reps, miss: missed(work) }];  // prev and the sessions before it at the same weight
  for (const j of before) { if (!same(j.load)) break; run.push(j); }
  const under = before[run.length - 1];  // the session before the run
  const justUp = run.length <= 2 && !!under && under.load != null && under.load < kg - 0.5;
  const lastRpe = isNum(work[n - 1]?.rpe) ? work[n - 1].rpe : null;
  // 1. a miss
  if (run[0].miss) {
    let streak = 0; for (const r of run) { if (!r.miss) break; streak++; }
    const falling = run.length >= 2 && (t => t[0] < t[1])(totals(run, 2));
    if (!justUp && (streak >= 3 || (streak >= 2 && falling))) {
      if (isIsolation(key)) return { ...out, why: say(`连续 ${streak} 次没到 ${lo} 次，孤立动作先保持 ${kg} kg`) };
      const nk = Math.max(step, r2(kg - step));
      return { ...out, load: `${nk} kg`, kg: nk, down: true, why: say(`连续 ${streak} 次没到 ${lo} 次，退一档到 ${nk} kg`) };
    }
    const at = shortAt >= 0 ? shortAt : 0;
    return { ...out, why: say(`上次第 ${at + 1} 组只到 ${reps[at]} 次，${full}`) };
  }
  if (!allLo) return { ...out, why: say(`上次第 ${shortAt + 1} 组只到 ${reps[shortAt]} 次（RPE ≤ 8，还有余力），${full}`) };
  // 2. every set at lo or more
  const stalled = run.length >= 3 && (t => t[0] <= t[1] && t[1] <= t[2])(totals(run, 3));
  const canAdd = allHi || (reps[0] >= hi && total >= n * hi - 2);
  if (canAdd && lastRpe != null && lastRpe >= 10) return { ...out, why: say(`上次到次数了但 RPE 10，同重量再做一次`) };
  if (canAdd) {
    if (step > kg * 0.1 && !reps.every(v => v >= hi + 3)) {
      if (stalled) return { ...out, stalled: true, why: say(`同重量 3 次没涨：换个次数区间，或者该减量了`) };
      return { ...out, reps: `${lo}–${hi + 3}`, why: say(`${kg} kg 再加一档太多，先做到 ${hi + 3} 次`) };
    }
    const nk = r2(kg + step), rpe = lastRpe != null ? `，RPE 才 ${lastRpe}` : '';
    const did = n === 1 ? `上次 ${kg} kg 做到 ${reps[0]} 次` : allHi ? `上次 ${n} 组都到 ${hi} 次` : `上次 ${rs}，总次数够了`;
    return { ...out, load: `${nk} kg`, kg: nk, up: true, why: say(`${did}${rpe}，加 ${step} kg`) };
  }
  if (stalled) return { ...out, stalled: true, why: say(`同重量 3 次没涨：换个次数区间，或者该减量了`) };
  // 3. the rest
  return { ...out, why: say(`上次 ${rs}，每组都到 ${hi} 次就加重`) };
}

// 下次怎么练 for an exercise (stats.js's 动作详情): the prescription the 今日 训练单 and 训练中's 这次 show, from Claude's
// advice (newer than the exercise's last session, 21 days at most), the deload week, the rule or the plan, for the plan
// day it is in (today's first). {line, src, why, at (Claude's date)}; null when there is nothing to go by.
function rxFor(name) {
  const key = String(name || '').trim(); if (!key) return null;
  const d = today(), has = p => planExs(p).some(x => String(x.name || '').trim() === key);
  const tdy = plannedDay(d), day = (tdy && has(tdy) ? tdy : planDays().find(has)) || null;
  const px = day ? planExs(day).find(x => String(x.name || '').trim() === key) : null;
  const h = exHistory(key, d), last = day ? lastDayOf(day.id, d) : null;
  const wk = h.last ? workOf(h.last.sets) : null;
  const rx = exRx(px || { name: key, sets: wk && !wk.timed ? wk.sets.length : '' }, d, !!last && daysBetween(last, d) >= 10, { dayId: day?.id, h });
  if (!px && rx.src === 'plan') return null;
  return { line: rxLine(rx), src: rx.src, why: rx.src === 'plan' ? plainRpe(rx.note) : rx.why || '', at: rx.src === 'claude' ? h.adviceAt : null };
}
/* ---------- 减量周: one way only — half the sets (at least 2), the same weight, 3–4 reps in reserve ---------- */
const deloadOf = () => { const dl = S.plan?.phaseInfo?.deload; return dl && typeof dl === 'object' && isDate(dl.start) && isDate(dl.end) && dl.end >= dl.start ? dl : null; };
const inDeload = d => { const dl = deloadOf(); return !!dl && d >= dl.start && d <= dl.end; };
const deloadSets = n => { const v = parseInt(n, 10); return v >= 1 ? Math.max(2, Math.ceil(v / 2)) : v; };
const DELOAD_WHY = '减量周：组数减半，重量不变，每组留 3–4 次余力';
// The deload prescription of a plan exercise: last time's working weight (else the plan's), the plan's rep range, half
// the sets. {src: 'deload'}; null for cardio or without any numbers to go by.
function deloadRx(x, d, dayId, h) {
  const key = String(x?.name || '').trim(); if (!key) return null;
  const kind = guessKind(key); if (kind === 'cardio') return null;
  const px = planEx(key, dayId) || x, rr = repRange(px?.reps) || (h?.last?.target ? repRange(h.last.target, true) : null);
  const wk = h?.last ? workOf(h.last.sets) : null, first = wk && !wk.timed ? wk.sets[0] : null;
  const ld = String(px?.load ?? '').trim(), pKg = /^(\d+(?:\.\d+)?)\s*kg$/i.exec(ld);
  const load = first ? loadTxt(first) || (kind === 'bw' ? '自重' : null) : pKg ? `${pKg[1]} kg` : /自重/.test(ld) ? '自重' : kind === 'bw' ? '自重' : null;
  const kg = first && isNum(first.kg) && !first.bodyweight ? first.kg : pKg ? Number(pKg[1]) : null;
  const sets = deloadSets(px?.sets ?? (wk ? wk.sets.length : ''));
  const reps = kind === 'sec' ? (rr ? `${rr[0]} 秒` : String(px?.reps ?? '').trim() || null) : rr ? (rr[0] === rr[1] ? String(rr[0]) : `${rr[0]}–${rr[1]}`) : String(px?.reps ?? '').trim() || null;
  if (!load && !reps) return null;
  return { name: key, kind, load, reps, sets: sets ?? '', src: 'deload', note: '', why: DELOAD_WHY, kg, h, lo: rr?.[0], hi: rr?.[1] };
}
// 该减量了: the reason a deload week is due, '' when none (fitness-review and stats.js say the same things):
// the phase's own deload lands this week; the phase ends within 7 days after 4+ weeks of 3+ sessions each; two or more
// main lifts (the first two of each plan day) stalled or down by the rule in the last 14 days; 3+ of the last 7 days
// with low energy or heavy soreness; a recovery warning on 3+ of them; the last three sessions at RPE 9 or more.
function deloadDue() {
  const t = today(); if (!S.plan || !S.loaded.has('workouts') || !S.loaded.has('body')) return '';
  const pi = S.plan.phaseInfo && typeof S.plan.phaseInfo === 'object' ? S.plan.phaseInfo : null, dl = deloadOf();
  const mon = addDays(t, 1 - isoWd(t)), sun = addDays(mon, 6);
  if (dl && dl.start > t && dl.start <= sun) return `计划里的减量周 ${md(dl.start)} 开始`;
  if (pi && isDate(pi.end) && pi.end >= t && daysBetween(t, pi.end) <= 7 && isDate(pi.start)) {
    let n = 0;
    for (let m = addDays(mon, -7); m >= pi.start; m = addDays(m, -7)) { let k = 0; for (let i = 0; i < 7; i++) if (trainedOn(addDays(m, i))) k++; if (k < 3) break; n++; }
    if (n >= 4) return `这阶段 ${md(pi.end)} 结束，已经连续 ${n} 周每周练 3 次以上`;
  }
  const since = addDays(t, -13), hit = [];
  for (const d of planDays()) for (const x of (d.exercises || []).slice(0, 2)) {
    const name = String(x?.name || '').trim(); if (!name || hit.includes(name)) continue;
    const h = exHistory(name, t), r = h.last && h.last.date >= since ? ruleRx(name, t, d.id, null, h) : null;
    if (r && (r.stalled || r.down)) hit.push(name);
  }
  if (hit.length >= 2) return `${hit.slice(0, 3).join('、')}停滞或连续没做满`;
  let low = 0, warn = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(t, -i), f = feelOf(d); if (f.energy <= 2 || f.sore >= 4) low++; if (recovery(d).warn) warn++; }
  if (low >= 3) return `最近 7 天有 ${low} 天精力很差或很酸`;
  if (warn >= 3) return `最近 7 天有 ${warn} 天静息心率或 HRV 偏差`;
  const last3 = S.workouts.filter(w => isNum(w.rpe)).sort(newestFirst).slice(0, 3);
  if (last3.length === 3 && last3.every(w => w.rpe >= 9)) return '最近 3 次训练整体 RPE 都在 9 以上';
  return '';
}
const RX_TIMES = '<i aria-hidden="true">×</i>';
function rxHTML(rx) {
  if (rx.raw) return `<span class="rx-big raw">${esc(rx.raw)}</span>`;
  const load = rx.load ? (/^(\S+) kg$/.test(rx.load) ? `${esc(rx.load.slice(0, -3))}<small>kg</small>` : `<span class="rx-w">${esc(rx.load)}</span>`) : '';
  const parts = [load, rx.reps ? esc(rx.reps) : '', rx.sets !== '' ? `${esc(rx.sets)}<small>组</small>` : ''].filter(Boolean);
  return `<span class="rx-big num" aria-label="${esc([rx.load, rx.reps ? `${rx.reps} 次` : '', rx.sets !== '' ? `${rx.sets} 组` : ''].filter(Boolean).join(' × '))}">${parts.join(RX_TIMES)}</span>`;
}
// The last date before d plan day `id` was trained: a session on it, or the person's pick in days/ (as the rotation counts).
function lastDayOf(id, d) {
  return S.workouts.filter(w => w.date < d && w.planDayId === id).map(w => w.date)
    .concat(Object.keys(S.days).filter(x => x < d && S.days[x]?.plan === id)).sort().pop() || null;
}
const gapTxt = n => n < 14 ? `${n} 天` : `${Math.round(n / 7)} 周`;
// The how-manieth training of its week day d would be: days trained before it (days to come: the expected ones), plus one.
function weekNth(d) {
  const t = today(); let n = 1;
  for (let x = addDays(d, 1 - isoWd(d)); x < d; x = addDays(x, 1)) if (x <= t ? trainedOn(x) : isPlanDay(expectedKind(x))) n++;
  return n;
}
/* ---------- render ---------- */
let rq = false;
const detState = {};
viewEl.addEventListener('toggle', e => { const k = e.target.dataset?.key; if (k) detState[k] = e.target.open; }, true);
function render() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; draw(); }); }
const loading = '<div class="empty">正在读取…</div>';
// claude.js (the Claude tab, FE-claude) when it has loaded; every call guarded, so a missing or broken file only hides
// its parts.
const LC = () => window.LSJClaude || null;
function lc(name, ...args) { const f = LC()?.[name]; if (typeof f !== 'function') return undefined; try { return f(...args); } catch (e) { console.error(e); return undefined; } }
const TITLES = { today: '今日', plan: '训练', claude: 'Claude', data: '数据', me: '我的' };
const STAR = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.8 5.1 3.9 8.2 9 9-5.1.8-8.2 3.9-9 9-.8-5.1-3.9-8.2-9-9 5.1-.8 8.2-3.9 9-9z"/></svg>';
const avatarTxt = () => esc(String(S.me?.name || S.me?.username || '我').trim().slice(0, 1) || '我');
function draw() {
  // the bar's tabs; on Claude (a second-level page) none is current
  document.querySelectorAll('.tab[data-tab]').forEach(b => { if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const nb = lc('badge'), cn = isNum(nb) && nb > 0 ? Math.round(nb) : 0;
  const banner = S.dbState === 'offline'
    ? `<span>${S.me ? '连不上服务器，显示的是上次读到的数据' : '连不上服务器，正在重试'}。填了一半的表单不会丢。</span><button class="link" data-act="retry">重试</button>` : '';
  bannerEl.hidden = !banner; if (banner && bannerEl.innerHTML !== banner) bannerEl.innerHTML = banner;
  // 今日: the date is the title and opens the system date picker (a transparent date input over it). Claude: 「‹」 back
  // to the tab it came from, then the name. The others: the page's name. Right, on every page: 回到今天 (今日, away
  // from today) and the round ✦ Claude button with what waits for the person.
  const sub = SUB_TABS.includes(S.tab), back = SUB_TABS.includes(S.backTab) ? 'today' : S.backTab || 'today';
  const away = S.tab === 'today' && S.date !== today();
  const title = S.tab === 'today'
    ? `<h1 class="top-t datepick"><span class="td-l">${esc(fmtDay(S.date))}</span><span class="td-s">${esc(`${md(S.date)} 周${WD[parseD(S.date).getDay()]}`)}</span><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg><input type="date" id="top-date-in" value="${esc(S.date)}" aria-label="跳到某一天"></h1>`
    : sub ? `<button type="button" class="icon-btn top-back" data-act="sub-back" aria-label="返回${esc(TITLES[back] || '')}">${CHEV(-1)}</button><h1 class="top-t">${esc(TITLES[S.tab] || '')}</h1>`
    : `<h1 class="top-t">${esc(TITLES[S.tab] || '')}</h1>`;
  const acts = away ? '<button class="pill-btn" data-act="today"><span class="pb-l">回到</span>今天</button>' : '';
  const cl = `<button type="button" class="cl-btn" data-act="tab" data-tab="claude" aria-label="${cn ? `Claude，${cn} 件要你处理` : 'Claude'}"${S.tab === 'claude' ? ' aria-current="page"' : ''}>${STAR}${cn ? `<span class="badge">${cn > 99 ? '99+' : cn}</span>` : ''}</button>`;
  const top = `${title}<div class="top-r">${acts}${cl}</div>`;
  topEl.classList.toggle('away', away);
  if (topEl.innerHTML !== top) topEl.innerHTML = top;  // untouched while the same, so an open date picker stays open
  // An input on the page being typed in (weight, a to-do) gets its focus and caret back after the redraw.
  const ae = document.activeElement, fid = ae && ae.id && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && viewEl.contains(ae) ? ae.id : null;
  const caret = fid ? [ae.selectionStart, ae.selectionEnd] : null;
  // 加到主屏幕 only on 今日 (#1); 「我的 → 加到主屏幕」 has it for good
  viewEl.innerHTML = (S.tab === 'today' ? a2hsStrip() : '') + ({ today: vToday, plan: vPlan, claude: vClaude, data: vData, feedback: vFeedback, me: vMe }[S.tab] || vToday)();
  if (S.hlIds) viewEl.querySelectorAll('[data-hl]').forEach(el => { if (S.hlIds.has(el.dataset.hl)) el.classList.add('hl-new'); });
  clockShown = clockSig();
  const fe = fid && document.getElementById(fid);
  if (fe) { fe.focus(); try { if (caret[0] != null) fe.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
  viewEl.querySelectorAll('details[data-key]').forEach(el => { const k = el.dataset.key; if (k in detState) el.open = detState[k]; });
  if (S.sheet?.type === 'water' && S.sheet.edit == null) drawWaterList();
  if (S.sheet?.type === 'me-sec') drawMeSec();
  if (S.meFocus && S.tab === 'me') { const f = S.meFocus; S.meFocus = null; requestAnimationFrame(() => $('#' + f)?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
  if (S.tab === 'today' && S.db) S.db.ensure(addDays(S.date, -isoWd(S.date) - 29));  // the shown week and the 4 weeks before it
  drawLiveBar(); if (LIVE.open) drawLive();
  if (HIST.open) drawHist();
  onbCheck(); if (onb.open && onb.step !== 'basics') drawOnb();  // ② keeps what is being typed: redrawn by its own events
  if (deep) openDeep();  // #workout=… / #ex=… once what it needs has loaded
}
// 数据 (stats.js, DATA agent) when it has loaded; the charts and reports of 反馈 otherwise.
function vData() {
  if (window.LSJData?.view) { try { return window.LSJData.view(); } catch (e) { console.error(e); } }
  return vFeedback();
}
// Claude (claude.js) when it has loaded.
function vClaude() {
  const v = lc('view');
  return typeof v === 'string' ? v : `<div class="panel" style="margin-top:6px">${loading}</div>`;
}

function statusLine() {
  if (!['status', 'meals', 'workouts', 'body', 'profile'].every(k => S.loaded.has(k))) return '<div class="status"><span class="dot wait"></span><span>正在读取…</span></div>';
  const n = pendingCount(); const st = S.status;
  const last = st?.lastRunAt ? `Claude 上次处理 ${esc(fmtTs(st.lastRunAt))}` : 'Claude 还没处理过记录';
  const tail = n ? `<b>${n}</b> 条等待处理` : '全部已处理';
  return `<div class="status"><span class="dot${n ? ' wait' : ''}"></span><span>${last} · ${tail}</span></div>`;
}

// The week around the shown day. Under each date: a dot per meal (up to 4) and a bar when there was training; each day
// says it in its label (no legend under the strip since v9).
const CHEV = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${d < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}"/></svg>`;
function weekStrip() {
  const start = addDays(S.date, 1 - isoWd(S.date)); const t = today();
  let cells = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const n = S.meals.filter(m => m.date === d).length, mc = Math.min(4, n);
    const wc = S.workouts.some(w => w.date === d);
    const lbl = [fmtDay(d), d === t ? '今天' : '', n ? `记了 ${n} 餐` : '', wc ? '练了' : ''].filter(Boolean).join('，');
    cells += `<button class="day${d === S.date ? ' is-sel' : ''}${d === t ? ' is-today' : ''}" data-act="date" data-d="${d}" aria-label="${esc(lbl)}"${d === S.date ? ' aria-current="date"' : ''}>
      <span class="dw">${WD[parseD(d).getDay()]}</span><span class="dn">${parseD(d).getDate()}</span>
      <span class="ticks" aria-hidden="true">${'<i></i>'.repeat(mc)}${wc ? '<i class="w"></i>' : ''}</span></button>`;
  }
  return `<div class="week"><button class="wk-nav" data-act="week" data-n="-7" aria-label="上一周">${CHEV(-1)}</button><div class="days">${cells}</div><button class="wk-nav" data-act="week" data-n="7" aria-label="下一周">${CHEV(1)}</button></div>`;
}

function mealRow(m) {
  const phs = (m.photos || []).filter(id => PHOTO_ID.test(String(id))); const ph = phs[0];
  const man = manualOf(m);
  const thumb = ph ? `<span class="thumb" style="background-image:url('${blobSrc(ph)}')">${phs.length > 1 ? `<span class="n num">${phs.length}</span>` : ''}</span>` : `<span class="thumb">${esc((SLOTS[m.slot] || '餐').slice(0, 1))}</span>`;
  const bits = [];
  if (m.portion) bits.push(PORTION_TXT[m.portion]);
  if (isNum(m.fullness)) bits.push(`饱腹 ${m.fullness}/5`);
  if (m.feelings?.length) bits.push(m.feelings.join('、'));
  const sub = [m.desc, bits.join(' · ')].filter(Boolean).join(' — ') || (m.photos?.length ? '只有照片，吃完可以补饭后情况' : '未填写');
  const qk = quickItems(m);
  let tag;
  if (man) tag = `<span class="tag kcal">${fmt(man.kcal)}<small class="u">kcal</small><small class="est">自己填</small></span>`;
  else if (m.needsReview) { const nx = nextRunTxt(); tag = nx ? `<span class="tag wait" title="Claude 下次看的时候估"><span class="tw-c">Claude </span>约 ${esc(nx)} 看</span>` : '<span class="tag wait">待分析</span>'; }
  else if (isNum(m.review?.kcal)) tag = `<span class="tag kcal">${fmt(m.review.kcal)}<small class="u">kcal</small></span>`;
  else if (qk.length) tag = `<span class="tag kcal">${fmt(qk.reduce((s, q) => s + (isNum(q.kcal) ? q.kcal : 0), 0))}<small class="u">kcal</small><small class="est" title="估算">估</small></span>`;
  else tag = '<span class="tag ok">已看过</span>';
  const ask = askOf(m);
  const row = `<button class="row" data-act="meal" data-id="${esc(m.id)}" data-hl="${esc(m.id)}">${thumb}<span class="row-main"><span class="row-t">${esc(SLOTS[m.slot] || '餐')}<span class="tm">${esc(m.time || '')}</span>${m.review?.rating && !m.needsReview ? `<span class="tag ${esc(m.review.rating)}">${esc(RATING[m.review.rating] || '')}</span>` : ''}${ask && !ask.answer ? '<span class="tag askb">Claude 有问题</span>' : ''}</span><span class="row-s">${esc(sub)}</span></span>${tag}</button>`;
  // 吃完了 / 剩了些: on 今日 they sit in the Claude card (待补的餐); a past day's rows keep them
  if (!askAfter(m) || S.date === today()) return row;
  return `<div class="mrow">${row}<div class="after" role="group" aria-label="${esc(SLOTS[m.slot] || '这餐')}吃完了吗"><button type="button" class="ac" data-act="meal-all" data-id="${esc(m.id)}"><span>吃完了</span></button><button type="button" class="ac" data-act="meal-left" data-id="${esc(m.id)}"><span>剩了些</span></button></div></div>`;
}
// A meal of the last three days that says nothing yet about how much was eaten: offer 吃完了 / 剩了些. Not once Claude
// has estimated it (it went by the photos and the description; the button would only contradict a 「蛋黄没吃」), and
// one-tap items need no follow-up.
function askAfter(m) {
  const t = today();
  if (m.date > t || m.date < addDays(t, -2) || m.portion != null || (m.leftovers || []).length || m.review) return false;
  return !(Array.isArray(m.quick) && m.quick.length);
}
async function mealAteAll(id, btn) {
  const m = S.meals.find(x => x.id === id); if (!m || !S.db) return;
  btn.disabled = true;
  const prev = !!m.needsReview;
  try {
    const doc = await saveFields('meals', id, clone(m), { portion: 'all', needsReview: true, updatedAt: new Date().toISOString() });
    toast(`${SLOTS[m.slot] || '这餐'}：吃完了`, false, async () => {
      try { await saveFields('meals', id, doc, { portion: null, needsReview: prev, updatedAt: new Date().toISOString() }); }
      catch (e) { toast(errMsg(e), true); }
    });
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
}
// 剩了些: the meal's form at 饭后情况, with the leftovers camera opened in the same tap where the browser allows it.
function mealLeft(id) {
  if (!S.meals.some(x => x.id === id)) return;
  openMeal(id);
  const fs = $('#after-fs', sheetEl); if (!fs) return;
  fs.classList.add('hl');
  fs.querySelector('legend span').textContent = '拍一下剩下的，再选吃了多少';
  fs.scrollIntoView({ block: 'start' });
  const inp = fs.querySelector('input[type=file][data-ph="leftovers"]');
  if (inp) { try { inp.click(); } catch (e) {} }
  else fs.querySelector('[data-group="portion"] button')?.focus();
}

/* 个人纪录, from stats.js (window.LSJData.prs): which exercises set a record in which session. Shown as 「新纪录」 on the
   session's results and 「纪录」 on the set in its details; after a 训记 sync a toast names the new ones. Nothing of it
   while stats.js isn't there. prIndex: workout id → Map(exercise name → {date, kind, text, kg, reps}). */
let prMemo = { w: null, v: null, a: null };
// With 进阶显示 off, a record only by estimated one-rep max (kind e1rm) isn't one on the page: the heaviest set counts.
const prShown = x => !!x && (x.kind !== 'e1rm' || advOn());
function prIndex() {
  const f = window.LSJData?.prs; if (typeof f !== 'function') return null;
  if (prMemo.w === S.workouts && prMemo.a === advOn() && prMemo.v) return prMemo.v;
  let all; try { all = f(); } catch (e) { console.error(e); return null; }
  const idx = new Map();
  for (const [name, r] of Object.entries(all && typeof all === 'object' ? all : {})) {
    for (const x of Array.isArray(r?.recent) ? r.recent : []) {
      if (!x || typeof x !== 'object' || !x.id || !prShown(x)) continue;
      const m = idx.get(x.id) || new Map(); if (!m.has(name)) m.set(name, x); idx.set(x.id, m);
    }
  }
  prMemo = { w: S.workouts, v: idx, a: advOn() };
  return idx;
}
const prOf = (w, name) => prIndex()?.get(w?.id)?.get(String(name || '').trim()) || null;
// The set that made the record: the first working set with its weight (none for body weight alone) and reps.
function prSet(sets, rec) {
  if (!rec || !isNum(rec.reps)) return null;
  return (sets || []).find(s => s && typeof s === 'object' && !s.warmup && !s.drop && s.reps === rec.reps
    && (isNum(rec.kg) && rec.kg > 0 ? isNum(s.kg) && Math.abs(s.kg - rec.kg) < 1e-6 : !(isNum(s.kg) && s.kg > 0))) || null;
}
const prTag = rec => rec ? `<span class="vd pr" title="${esc(rec.text || '')}">新纪录</span>` : '';
// Every record as "name|session|kind|text": taken before a sync, so the toast names only what the sync brought.
function prKeys() {
  const f = window.LSJData?.prs; if (typeof f !== 'function') return null;
  try { return new Set(Object.entries(f() || {}).flatMap(([n, r]) => (Array.isArray(r?.recent) ? r.recent : []).map(x => `${n}|${x.id}|${x.kind}|${x.text}`))); }
  catch (e) { return null; }
}
function newPrs(before) {
  const f = window.LSJData?.prs; if (!before || typeof f !== 'function') return [];
  const from = addDays(today(), -2), out = [];
  try {
    for (const [n, r] of Object.entries(f() || {})) for (const x of Array.isArray(r?.recent) ? r.recent : []) {
      if (x && isDate(x.date) && x.date >= from && prShown(x) && !before.has(`${n}|${x.id}|${x.kind}|${x.text}`)) out.push({ name: n, ...x });
    }
  } catch (e) { return []; }
  return out.sort((a, z) => cmp(z.date, a.date) || (z.kind === 'kg') - (a.kind === 'kg'));
}

// A cardio exercise's metrics: 30 分钟 · 5 km · 300 kcal (other keys, from 训记, as they are).
const METRIC_U = { min: '分钟', km: 'km', kcal: 'kcal' };
const metricsTxt = m => Object.entries(m && typeof m === 'object' ? m : {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => METRIC_U[k] ? `${v} ${METRIC_U[k]}` : `${k} ${v}`).join(' · ');
// 「+递减」 on an exercise that had drop sets (they never count in the working sets shown next to it).
const dropOf = e => (e?.sets || []).some(s => s && typeof s === 'object' && s.drop && hasSetData(s));
const dropTag = e => dropOf(e) ? '<span class="vd dr">+递减</span>' : '';
// The watch's numbers on a session: heartRate {avg, max, min, n?, source?} (训记's own, or Apple Health's that the server
// matched to a 训练中 session by its start and end) and kcal. 「心率 均 128 · 最高 162 · 消耗 310 kcal」, '' without.
const HEART = '<svg class="i hr-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/></svg>';
const fromWatch = w => w?.heartRate?.source === 'apple-health' || w?.kcalSource === 'apple-health';
const hrAvg = w => { const h = w?.heartRate; return h && typeof h === 'object' && isNum(h.avg) ? Math.round(h.avg) : null; };
function hrTxt(w) {
  const h = w?.heartRate, avg = hrAvg(w);
  return [avg != null ? `心率 均 ${avg}${isNum(h.max) ? ` · 最高 ${Math.round(h.max)}` : ''}` : '', isNum(w?.kcal) && w.kcal > 0 ? `消耗 ${fmt(w.kcal)} kcal` : ''].filter(Boolean).join(' · ');
}
const hrHTML = (w, cls = 'wr-hr') => { const t = hrTxt(w); return t ? `<span class="${cls}">${HEART}<span>${esc(t)}</span>${fromWatch(w) ? '<small>Apple Watch</small>' : ''}</span>` : ''; };
// A session logged on 训练中 and finished in the last two days, no heart rate yet: 同步健康 will bring the watch's.
const hrSoon = w => !!w && w.source !== 'xunji' && !w.heartRate && !!w.startedAt && !!w.endedAt && Date.now() - (Date.parse(w.endedAt) || 0) < 2 * 864e5;
// The exercises of a session as a results list: each one's working sets and how they went (against the target and the
// last time). Spans only: it sits inside the card's button.
function exResults(w) {
  return (w.exercises || []).filter(e => e && typeof e === 'object').map(e => {
    if (e.cardio) return `<span class="wr-r"><span class="wr-nv"><span class="wr-n">${esc(e.name)}</span><span class="wr-v">${esc(metricsTxt(e.metrics))}</span></span></span>`;
    const v = exVerdict(e, w);
    const pr = prTag(prOf(w, e.name)), dr = dropTag(e);
    return `<span class="wr-r"><span class="wr-nv"><span class="wr-n">${esc(e.name)}</span><span class="wr-v num">${v ? esc(workTxt(v.wk)) : '–'}</span></span>${v || pr || dr ? `<span class="wr-st">${pr}${dr}${v ? verdictTags(v) : ''}</span>` : ''}</span>`;
  }).join('');
}
// Volume against the session before on the same plan day: 「↑ 420」.
function volChg(w, vol) {
  const p = prevSession(w), pv = p ? woStats(p).vol : 0; if (!vol || !pv) return '';
  const dv = Math.round(vol - pv); if (!dv) return '';
  return ` <span class="vchg ${dv > 0 ? 'up' : 'down'}" title="比上次 ${esc(dayShortOf(p.planDayId))}（${esc(md(p.date))}）">${dv > 0 ? '↑' : '↓'} ${fmt(Math.abs(dv))}</span>`;
}
// A session on its day: what was done per exercise and how it went, the totals (volume against the last session of the
// same plan day), and Claude's comment, 「等 Claude 点评」, or nothing (an old 训记 import nobody reviewed: 「历史」).
// kind: what the card's day is (its title says so already; the session's own plan day shows only when it differs).
function woCard(w, kind) {
  const s = woStats(w), day = planDays().find(d => d.id === w.planDayId && d.id !== kind);
  const tag = w.needsReview ? '<span class="tag wait">待点评</span>'
    : w.review?.rating ? `<span class="tag ${esc(w.review.rating)}">${esc(RATING[w.review.rating] || '已点评')}</span>`
    : w.review ? '<span class="tag ok">已点评</span>' : w.source === 'xunji' ? '<span class="tag hist" title="历史导入，Claude 没点评过">历史</span>' : '';
  const ask = askOf(w);
  const sum = [s.sets ? `完成 <b class="num">${s.done}/${s.sets}</b> 组` : `${s.ex} 个动作`, isNum(w.durationMin) ? `<b class="num">${esc(w.durationMin)}</b> 分钟` : '',
    s.vol && advOn() ? `训练量 <b class="num">${fmt(s.vol)}</b> kg${volChg(w, s.vol)}` : ''].filter(Boolean).map(x => `<span>${x}</span>`).join(' · ');
  const cm = String(w.review?.comment || '').trim(), one = (cm.match(/^.*?[。！？!?](?=\s|$|[^」』）)])/) || [cm])[0];
  const foot = one ? `<span class="wr-cm">${AG}<span>${esc(one)}</span></span>` : '';  // 待点评 is the tag in the head
  const ex = exResults(w);
  return `<button type="button" class="wres" data-act="workout" data-id="${esc(w.id)}" data-hl="${esc(w.id)}">
    <span class="wr-h">${day ? `<span class="dayid sm">${esc(dayShort(day))}</span>` : ''}<b>${esc(woTitle(w))}</b>${w.source === 'xunji' ? '<span class="tag src">训记</span>' : ''}${ask && !ask.answer ? '<span class="tag askb">Claude 有问题</span>' : ''}<span class="wr-tag">${tag}${CHEV_R}</span></span>
    <span class="wr-sum">${sum}</span>${hrHTML(w)}${ex ? `<span class="wr-ex">${ex}</span>` : ''}${foot}</button>`;
}

// The first lines of 身体 on today while there is no weight yet: the weight typed in place, 记下, 今天不称. Off with
// prefs.weighCard = false; not shown either when the person cleared this day's weight on purpose.
function weighRow(d) {
  if (d !== today() || !S.loaded.has('body') || isNum(S.body[d]?.weight) || !prefOn('weighCard')) return '';
  if (lsGet('lsj-noweigh') === d || weightCleared(S.body[d])) return '';
  const last = latestWeight();
  return `<div class="weigh"><div class="weigh-h"><label for="q-w">${esc(vt('weigh.title', '今天还没称体重'))}<small>空腹称最准</small></label><button class="link" data-act="skip-weigh">今天不称</button></div>
    <div class="weigh-in"><input id="q-w" type="text" inputmode="decimal" autocomplete="off" value="${esc(S.qw || '')}" placeholder="${isNum(last) ? esc(last) : '例如 74.2'}"><span class="u">kg</span><button class="btn primary sm" data-act="quick-weigh">记下</button></div></div>`;
}
async function quickWeigh() {
  const v = parseNum($('#q-w')?.value); const d = S.date;
  if (Number.isNaN(v)) { toast('体重填的不是数字', true); return; }
  if (!(v > 20 && v < 400)) { toast('填一下体重，单位 kg', true); return; }
  if (!S.db || quickWeigh.busy) return; quickWeigh.busy = true;
  try {
    await saveFields('body', d, S.body[d] || null, { date: d, weight: Math.round(v * 10) / 10, weightSource: 'manual', updatedAt: new Date().toISOString() });
    S.qw = ''; render(); toast(vt('toast.weight', '体重已记下'));
  } catch (e) { toast(errMsg(e), true); }
  quickWeigh.busy = false;
}

async function setDayPlan(d, v) {
  if (!S.db || v === expectedKind(d)) return;
  const prev = S.days[d];
  const back = v === autoOf(d);  // same as what the day would be anyway: drop the override
  const doc = { date: d, plan: v, updatedAt: new Date().toISOString() };
  if (back) delete S.days[d]; else S.days[d] = { id: d, ...doc };
  render();
  try {
    if (back) { if (prev) await retry1(() => S.db.collection('days').doc(d).delete()); }
    else await retry1(() => S.db.collection('days').doc(d).set(doc));
  } catch (e) {
    if (prev) S.days[d] = prev; else delete S.days[d];
    render(); toast('没保存上，检查网络后再点一次', true);
  }
}

// stats[].prev (the period before): the change, 「↑ 120」 / 「↓ 0.3」.
const statNum = v => isNum(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
function statChg(s) {
  const v = statNum(s.value), p = statNum(s.prev); if (v == null || p == null) return '';
  const d = Math.round((v - p) * 10) / 10;
  return `<span class="chg num" title="上一期 ${esc(numTxt(p))}">${d ? `${d > 0 ? '↑' : '↓'} ${esc(numTxt(Math.abs(d)))}` : '持平'}</span>`;
}
function statsHTML(stats) {
  const xs = Array.isArray(stats) ? stats.filter(s => s && typeof s === 'object' && s.label != null) : [];
  if (!xs.length) return '';
  return `<div class="stats">${xs.map(s => `<span class="stat"><span class="k">${esc(s.label)}</span><b class="num">${esc(numTxt(s.value))}</b>${s.target != null && s.target !== '' ? `<span class="tg num">/${esc(numTxt(s.target))}</span>` : ''}${s.unit ? `<span class="u">${esc(s.unit)}</span>` : ''}${statChg(s)}</span>`).join('')}</div>`;
}
// Weekly goals: {label, hit, of} as 「蛋白质达标 5/7」.
function goalsHTML(goals) {
  const xs = Array.isArray(goals) ? goals.filter(g => g && typeof g === 'object' && g.label != null && isNum(g.hit) && isNum(g.of)) : [];
  if (!xs.length) return '';
  return `<div class="goals">${xs.map(g => `<span class="goal${g.hit >= g.of ? ' full' : ''}"><b class="num">${esc(numTxt(g.hit))}/${esc(numTxt(g.of))}</b>${esc(g.label)}</span>`).join('')}</div>`;
}
const sectionsHTML = secs => (Array.isArray(secs) ? secs : []).map(s => `<h4>${esc(s?.heading)}</h4><ul>${(s?.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('');

/* ---------- 今日 ---------- */
// Laid out by the day, not by kind of card (v9). Top to bottom: the week; 「今天」 (what is left to eat, what to train
// with 开练 / 继续, water and the 五件套 — the first screen's answer); Claude (its report of the day, what to do, what
// waits for a decision, meals to finish, new reviews; only when there is something); the food; the training card (always
// after the food: 「今天」 already says what to train and starts it); water; body (with the weigh-in and the morning
// check). A past day: one line of what was eaten instead of 「今天」, and of Claude only its report. A day to come: the
// plan's preview. A past day with no food and no water folds those into one card (#13).
function vToday() {
  const d = S.date, t = today();
  if (d > t) return `${weekStrip()}${previewCard(d)}`;
  const fold = d < t && ['meals', 'water'].every(k => S.loaded.has(k)) && !S.meals.some(m => m.date === d) && !(waterDay(d).entries || []).length;
  const food = fold ? `<section class="sec" id="sec-food"><div class="panel empty-day"><p>${esc(vt('empty.dayFold', '这天没有饮食和喝水记录。'))}</p><div class="btns"><button class="btn ghost sm" data-act="new-meal">补记一餐</button><button class="btn ghost sm" data-act="water-more">补记喝水</button></div></div></section>`
    : mealsSection(d);
  return `${weekStrip()}${d === t ? dayBar(d) : fold ? '' : pastLine(d)}${claudeBlock(d)}${food}${trainSection(d)}${fold ? '' : waterSection(d)}${bodySection(d)}`;
}

/* 「今天」: one compact card, always whole on the first screen. Left: what is left to eat today (超了 when over) and the
   protein against its target, a tap scrolls to the food. Right: what to train — 开练 (the plan day), 继续 (running),
   练了 ✓ (a tap scrolls to the results), or the rest day and the next one. Bottom: water against its target with +250,
   and, with prefs.habits on, the 五件套 as five dots (filled: done; a tap: what they are and today's values). */
function dayBar(d) {
  const mealsIn = S.loaded.has('meals'), tg = targetsFor(d), it = intake(d), sum = it.sum;
  const kT = tg && isNum(tg.kcal) ? tg.kcal : null, pT = tg && isNum(tg.protein) ? tg.protein : null;
  const over = mealsIn && kT != null && sum.kcal > kT;
  const k = !mealsIn || kT != null ? (over ? '超了' : '还能吃') : '吃了';
  const big = !mealsIn ? '—' : kT == null ? fmt(sum.kcal) : fmt(Math.abs(kT - sum.kcal));
  const sub = `蛋白质 <b class="num">${mealsIn ? fmt(sum.protein) : '—'}</b>${pT != null ? `<span class="num"> / ${fmt(pT)}</span>` : ''} g${it.waiting ? `<span class="tb-wait"> · ${it.waiting} 餐待估</span>` : ''}`;
  const eatLbl = `${k} ${big} kcal，蛋白质 ${mealsIn ? fmt(sum.protein) : '—'}${pT != null ? ` / ${fmt(pT)}` : ''} 克${tg?.temp ? '（临时目标）' : ''}，点了看饮食`;
  const eat = `<button type="button" class="tb-eat${over ? ' over' : ''}" data-act="tb-food" aria-label="${esc(eatLbl)}"><span class="tb-k">${k}${tg?.temp ? '<i class="tb-tmp">临时目标</i>' : ''}</span>
    <span class="tb-big"><b class="num">${big}</b><small>kcal</small></span><span class="tb-sub">${sub}</span></button>`;
  // water and the 五件套
  const w = waterSum(waterDay(d).entries), wT = waterTarget();
  const water = `<button type="button" class="tb-w" data-act="water-more" aria-label="喝水 ${fmt(w)} / ${fmt(wT)} 毫升，点了看明细"><span>喝水</span><b class="num">${S.loaded.has('water') ? fmt(w) : '—'}</b><span class="num tb-wt">/ ${fmt(wT)}</span><small>ml</small></button>
    <button type="button" class="tb-add" data-act="water-add" data-ml="250" aria-label="喝了 250 毫升"><span class="num">+250</span></button>`;
  let hb = '';
  if (prefOn('habits') && ['meals', 'water', 'sleep', 'body', 'health', 'workouts'].every(x => S.loaded.has(x))) {
    const hs = habitsOf(d), n = hs.filter(h => h.ok).length, of = hs.filter(h => !h.na).length;
    hb = `<button type="button" class="tb-hb" data-act="habits-info" aria-label="${esc(`五件套 做到 ${n}/${of}：${hs.map(h => `${h.name}${h.na ? '没数据' : h.ok ? '做到了' : '还没'}`).join('，')}。点了看是什么`)}">${hs.map(h => `<i class="${h.ok ? 'ok' : h.na ? 'na' : ''}" aria-hidden="true"></i>`).join('')}</button>`;
  }
  return `<section class="sec tb-sec"><div class="panel tbar"><div class="tb-top">${eat}${tbTrain(d)}</div><div class="tb-bot">${water}${hb}</div></div></section>`;
}
// The right half of 「今天」.
function tbTrain(d) {
  const wrap = (k, v, btn = '', cls = '') => `<div class="tb-tr${cls}"><span class="tb-kv"><span class="tb-k">${k}</span><span class="tb-v">${v}</span></span>${btn}</div>`;
  if (!['workouts', 'plan', 'days'].every(x => S.loaded.has(x))) return wrap('今天练什么', '…');
  const wos = S.workouts.filter(w => w.date === d).sort(latestFirst), act = activeWo();
  const k = dayKind(d), pd = planDays().find(x => x.id === k) || null, named = p => esc(p.name || dayShort(p));
  const ti = trainIn(), app = ti !== 'xunji', key = ti !== 'app' && xjKey() && !S.xj?.missing;
  if (act && isFresh(act) && act.date === d && !wos.length) {
    return wrap(esc(vt('live.bar', '在练')), `<span class="num" data-lv-clock>${esc(lvElapsed(act))}</span>`, '<button type="button" class="btn primary sm tb-go" data-act="lv-open">继续</button>', ' tb-live');
  }
  if (wos.length) {
    const wp = planDays().find(x => x.id === wos[0].planDayId);
    return `<button type="button" class="tb-tr tb-done" data-act="tb-train" aria-label="今天练了，点了看结果"><span class="tb-kv"><span class="tb-k">练了</span><span class="tb-v">${wp ? named(wp) : esc(woTitle(wos[0]))}<i class="tb-ok" aria-hidden="true">✓</i></span></span>${wos.length > 1 ? `<small class="tb-s">${wos.length} 次</small>` : ''}</button>`;
  }
  if (!S.plan) return wrap('今天练什么', '还没有计划', '<button type="button" class="link tb-link" data-act="plan-tpl">自己搭一套</button>');
  const go = (day, label) => app && !act ? `<button type="button" class="btn primary sm tb-go" data-act="lv-start"${day ? ` data-day="${esc(day)}"` : ''}>${esc(label)}</button>`
    : key && !act ? `<button type="button" class="btn primary sm tb-go" data-act="xj-sync"${S.xjBusy ? ' disabled' : ''}>${S.xjBusy ? '同步中…' : '同步'}</button>` : '';
  if (pd) return wrap('今天练', named(pd), go(pd.id, vt('btn.liveStart', '开练')));
  if (k === 'train') return wrap('今天练', '不按计划', app && !act ? go('', vt('btn.liveStart', '开练')) : '');
  const nx = nextTrainAfter(d);
  return wrap('今天', '休息日', nx ? `<small class="tb-s">下次 ${esc(nx.d === addDays(d, 1) ? '明天' : dayName(nx.d))} ${esc(dayShort(nx.pd))}</small>` : '', ' tb-rest');
}
// A past day: one line of what was eaten and drunk (the numbers of 「今天」 as they ended).
function pastLine(d) {
  if (!['meals', 'water'].every(k => S.loaded.has(k))) return '';
  const it = intake(d), w = waterSum(waterDay(d).entries);
  return `<p class="past-line">这天吃了 <b class="num">${fmt(it.sum.kcal)}</b> kcal · 蛋白质 <b class="num">${fmt(it.sum.protein)}</b> g · 喝水 <b class="num">${fmt(w)}</b> ml${it.waiting ? `<span> · ${it.waiting} 餐待估</span>` : ''}</p>`;
}

/* Claude, on 今日: one card, only with something in it. Its report of the day (a line, the sheet on a tap); today also
   what to do (Claude's actions for the day and the person's own to-dos), what waits for a decision (claude.js's
   todayHTML: proposals and questions, handled in place), meals of the last three days still without 吃完了吗, the
   meals and sessions Claude reviewed since the person last looked, 该拍身材照了, and once, the offer of notifications. */
function claudeBlock(d) {
  if (!S.loaded.has('reports')) return '';
  const t = today(), isT = d === t, parts = [];
  const daily = S.reports.find(r => r.kind === 'daily' && r.date === d);
  if (daily) parts.push(`<button type="button" class="cb-rep" data-act="report" data-id="${esc(daily.id)}">${AG}<span class="cb-rt"><b>Claude · ${esc(md(d))}</b>${daily.title ? `<span>：${esc(daily.title)}</span>` : '<span>：这天的日报</span>'}</span>${CHEV_R}</button>`);
  if (!isT) return parts.length ? `<section class="sec" id="sec-claude"><div class="ag-card cb">${parts.join('')}</div></section>` : '';
  const tb = todoBlock(d), todos = tb.includes('todo-r');
  if (todos) parts.push(tb);
  const dec = lc('todayHTML');
  if (typeof dec === 'string' && dec.trim()) parts.push(`<div class="cb-dec">${dec}</div>`);
  const after = afterRows(); if (after) parts.push(after);
  const rv = newReviewLine(); if (rv) parts.push(rv);
  // 「＋ 自己加一件」 without to-dos: before the small last line; with nothing else to say, a single quiet line instead
  // of the card
  const add = todos ? '' : tb, foot = footLine();
  if (!parts.length && !foot) return add ? `<div class="cb-solo">${add}</div>` : '';
  return `<section class="sec" id="sec-claude"><div class="ag-card cb">${parts.join('')}${add}${foot}</div></section>`;
}
// 待补的餐: meals of the last three days that say nothing yet about how much was eaten (askAfter), one line each.
function afterRows() {
  const t = today();
  const all = S.meals.filter(askAfter).sort((a, z) => cmp(z.date + dayTime(z.time), a.date + dayTime(a.time)));
  if (!all.length) return '';
  const open = S.afterAll === t, xs = open ? all : all.slice(0, 1), more = all.length - xs.length;
  return `<div class="cb-sec cb-after">${xs.map((m, k) => {
    const when = `${m.date !== t ? `${dayWord(m.date)} ` : ''}${SLOTS[m.slot] || '这餐'}${m.time ? ` ${m.time}` : ''}`;
    const plus = !k && more ? `<button type="button" class="cb-plus" data-act="after-all" aria-label="还有 ${more} 餐没补吃了多少">+${more}</button>` : '';
    return `<div class="cb-ar"><button type="button" class="cb-am" data-act="meal" data-id="${esc(m.id)}"><b>${esc(when)}</b><small>吃完了吗？</small></button><span class="cb-ab"><button type="button" class="ac" data-act="meal-all" data-id="${esc(m.id)}"><span>吃完了</span></button><button type="button" class="ac" data-act="meal-left" data-id="${esc(m.id)}"><span>剩了些</span></button>${plus}</span></div>`;
  }).join('')}</div>`;
}
// 新点评: what Claude reviewed (review.reviewedAt) after the person last tapped this line (lsj-seen-review:<uid>, set to
// now the first time so an old account doesn't start with everything), in the last three days.
const seenKey = () => 'lsj-seen-review:' + (S.me?.id || '');
const revAt = x => Date.parse(x?.review?.reviewedAt || '') || 0;
function newReviewed() {
  if (!S.me || !['meals', 'workouts'].every(k => S.loaded.has(k))) return null;
  let seen = Date.parse(lsGet(seenKey()) || '');
  if (!seen) { lsSet(seenKey(), nowIso()); return null; }
  const from = addDays(today(), -2), fresh = x => x.date >= from && revAt(x) > seen;
  return { meals: S.meals.filter(fresh), wos: S.workouts.filter(fresh) };
}
function newReviewLine() {
  const r = newReviewed(); if (!r || (!r.meals.length && !r.wos.length)) return '';
  const txt = [r.meals.length ? `${r.meals.length} 餐` : '', r.wos.length ? `${r.wos.length} 次训练` : ''].filter(Boolean).join(' ');
  return `<button type="button" class="cb-line cb-rv" data-act="cb-reviews">${AG}<span>Claude 点评了 ${esc(txt)}</span>${CHEV_R}</button>`;
}
// The tap: to the day with the newest of them (its meals and sessions lit up for a moment), then they count as seen.
function showReviews() {
  const r = newReviewed(); if (!r) return;
  const all = [...r.meals, ...r.wos]; if (!all.length) return;
  lsSet(seenKey(), new Date(Math.max(...all.map(revAt))).toISOString());
  const d = all.map(x => x.date).sort().pop();
  S.hlIds = new Set(all.filter(x => x.date === d).map(x => x.id));
  if (S.date !== d) { S.date = d; S.todoOpen = false; }
  draw();
  const first = viewEl.querySelector('.hl-new');
  (first || $('#sec-food'))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  clearTimeout(showReviews.t); showReviews.t = setTimeout(() => { S.hlIds = null; viewEl.querySelectorAll('.hl-new').forEach(el => el.classList.remove('hl-new')); }, 2600);
}
// Notifications are offered once Claude has written to the person (a daily report, a reply), into 「我的 → 通知」; ×
// and it never comes back on this phone (lsj-push-asked).
function pushWanted() {
  if (!S.me || lsGet('lsj-push-asked')) return false;
  const st = pushState(); if (st === 'on' || st === 'no' || st === 'checking' || S.push.subs > 0) return false;
  return S.reports.some(r => r.kind === 'daily') || S.messages.some(m => m?.reply?.text);
}
// The last line of the card, in small type: 该拍身材照了 and the notification offer (either or both).
function footLine() {
  const pp = progressDue(), push = pushWanted(); if (!pp && !push) return '';
  const a = pp ? `<button type="button" class="cb-fl" data-act="progress-new" title="${esc(pp)}"><span>${push ? '该拍身材照了' : `该拍身材照了 · ${esc(pp)}`}</span>${CHEV_R}</button>` : '';
  const b = push ? `<button type="button" class="cb-fl" data-act="push-ask-go"><span>${pp ? '开通知' : '开通知，Claude 看完提醒你'}</span>${CHEV_R}</button><button type="button" class="icon-btn sm cb-fx" data-act="push-ask-x" aria-label="不要通知的提示">×</button>` : '';
  return `<div class="cb-foot">${a}${a && b ? '<i aria-hidden="true">·</i>' : ''}${b}</div>`;
}

/* 晨间状态: body/<today>.feel {energy, sore, stress, at}, three 1–5 scales (no needsReview; Claude reads it with sleep
   and heart rate). One line in the 身体 card, 「今天状态：精力 · 酸痛 · 压力 ›」, opening a sheet to tap them in. Asked
   from when the day starts until six hours after this morning's wake-up (the night in sleep/<today>; without one, until
   15:00); once tapped, the values stay on the line all day. Off with prefs.feelCard = false. Taps show at once and are
   merged into the record. */
const feelLocal = {};  // date → the values tapped but not saved yet
function feelOf(d) {
  const f = S.body[d]?.feel, base = f && typeof f === 'object' ? f : {};
  const out = {};
  for (const [k] of FEEL) { const v = k in (feelLocal[d] || {}) ? feelLocal[d][k] : base[k]; if (Number.isInteger(v) && v >= 1 && v <= 5) out[k] = v; }
  return out;
}
// Until when the morning check is asked today: wake-up + 6 h, else 15:00 (minutes on the day's clock, tmin).
function feelUntil(d) {
  const sl = S.sleep[d], w = sl && !sl.cleared ? tmin(sl.wake) : null;
  return w != null ? w + 360 : 15 * 60;
}
// 'ask' (in the window, not all three in), 'line' (some or all tapped), '' (not shown).
function feelShown(d) {
  if (d !== today() || !prefOn('feelCard') || !S.loaded.has('body')) return '';
  const n = Object.keys(feelOf(d)).length;
  if (n === FEEL.length) return 'line';
  if (tmin(nowHM()) < feelUntil(d)) return 'ask';
  return n ? 'line' : '';
}
function feelRow(d) {
  const mode = feelShown(d); if (!mode) return '';
  const f = feelOf(d), n = Object.keys(f).length;
  const txt = FEEL.map(([k, l]) => f[k] ? `${l} <b class="num">${f[k]}</b>` : `<span class="fl-no">${l}</span>`).join('<i aria-hidden="true">·</i>');
  const say = n ? FEEL.filter(([k]) => f[k]).map(([k, l]) => `${l} ${f[k]}`).join('，') : '还没记';
  return `<button type="button" class="feel-line${n ? '' : ' fl-ask'}" data-act="feel-open" aria-label="今天状态：${esc(say)}，点了${n ? '改' : '记'}"><span class="fl-t">今天状态</span><span class="fl-v">${txt}</span>${CHEV_R}</button>`;
}
function feelRowsHTML(d) {
  const f = feelOf(d);
  return FEEL.map(([k, l, lo, hi]) => `<div class="fl-row" role="group" aria-label="${l}：1 ${lo}，5 ${hi}"><span class="fl-k">${l}</span><div class="fl-btns">${[1, 2, 3, 4, 5].map(n =>
    `<button type="button" class="fl-b" data-act="feel" data-k="${k}" data-v="${n}" aria-pressed="${f[k] === n}" aria-label="${l} ${n}${n === 1 ? `，${lo}` : n === 5 ? `，${hi}` : ''}"><span class="num">${n}</span>${n === 1 ? `<small>${lo}</small>` : n === 5 ? `<small>${hi}</small>` : ''}</button>`).join('')}</div></div>`).join('');
}
// The sheet: each tap is kept straight away; 好 closes it.
function openFeel() {
  const d = today();
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'feel', d, photos: [], removed: [] };
  showSheet('今天状态', `<div class="panel feel" id="feel-box">${feelRowsHTML(d)}</div><p class="hint" style="margin:0">点一下就存。Claude 会和睡眠、心率一起看，决定今天练多重。</p>`,
    '<button type="button" class="btn primary main" data-act="close">好</button>');
}
function tapFeel(k, v) {
  const d = today(); if (!S.db || !FEEL.some(([x]) => x === k) || !(v >= 1 && v <= 5)) return;
  feelLocal[d] = { ...(feelLocal[d] || {}), [k]: v };
  const box = S.sheet?.type === 'feel' && $('#feel-box', sheetEl);
  if (box) box.innerHTML = feelRowsHTML(d);
  render();
  clearTimeout(tapFeel.t); tapFeel.t = setTimeout(() => saveFeel(d), 500);
}
async function saveFeel(d) {
  const loc = feelLocal[d]; if (!loc || !Object.keys(loc).length || !S.db) return;
  const sent = { ...loc };
  try {
    await mergeDoc('body', d, { feel: { ...sent, at: nowIso() } }, { date: d });
    for (const k of Object.keys(sent)) if (feelLocal[d]?.[k] === sent[k]) delete feelLocal[d][k];
  } catch (e) { toast(e?.code === 'unauthenticated' ? errMsg(e) : '状态没存上，检查网络后再点一次', true); }
  render();
}
// Merge fields into a record (the server merges objects into what it has), creating it with `create` when it isn't there.
async function mergeDoc(col, id, patch, create = {}) {
  const ref = S.db.collection(col).doc(id), c = S.db.cached(col, id);
  if (!c || c.exists) {
    try { return await retry1(() => ref.update(patch)); } catch (e) { if (e?.code !== 'not_found') throw e; }
  }
  try { return await retry1(() => ref.set({ ...create, ...patch }, { ifVersion: 0 })); }
  catch (e) { if (e?.code !== 'conflict') throw e; return retry1(() => ref.update(patch)); }
}

// 五件套 (the 2026 「大水 / 大睡 / 大蛋 / 大站 / 薄肌」 habits), worked out from what is logged anyway — nothing extra to
// tick. The same rules are in CLAUDE.md 「口径」. Off with prefs.habits = false.
const HABIT_WATER = 2000, HABIT_SLEEP = 480, HABIT_STEPS = 8000;
function habitsOf(d) {
  const w = waterSum(waterDay(d).entries);
  const b = S.body[d], sl = S.sleep[d];
  const sleepMin = sl && !sl.cleared && isNum(sl.asleep) ? sl.asleep : isNum(b?.sleep) ? Math.round(b.sleep * 60) : null;
  const t = targetsFor(d), kg = latestWeight() ?? S.profile?.weight;
  const pT = isNum(t?.protein) ? t.protein : isNum(kg) ? Math.round(kg * 1.6) : null;
  const p = Math.round(intake(d).sum.protein);
  const steps = hval(d, 'steps');
  const rest = dayKind(d) === 'rest', trained = S.workouts.some(x => x.date === d);
  const hm = m => `${Math.floor(m / 60)}:${pad(m % 60)}`;
  // na: nothing to judge by (no sleep / steps from a watch, no plan to say it's a rest day): greyed, not counted
  return [
    { k: 'water', name: '大水', ok: w >= HABIT_WATER, v: `${(Math.round(w / 100) / 10).toFixed(1).replace(/\.0$/, '')}/2 L`, act: 'water-more', tip: '喝水到 2 升' },
    isNum(sleepMin) ? { k: 'sleep', name: '大睡', ok: sleepMin >= HABIT_SLEEP, v: hm(sleepMin), act: 'sleep-open', tip: '睡够 8 小时' }
      : { k: 'sleep', name: '大睡', na: true, ok: false, v: '接表后算', act: 'sleep-open', tip: '睡够 8 小时，接上手表后自动算' },
    { k: 'egg', name: '大蛋', ok: isNum(pT) && p >= pT, v: isNum(pT) ? `${p}/${pT} g` : `${p} g`, tip: '蛋白质吃够' },
    isNum(steps) ? { k: 'stand', name: '大站', ok: steps >= HABIT_STEPS, v: `${fmt(steps)} 步`, tip: '走够 8000 步' }
      : { k: 'stand', name: '大站', na: true, ok: false, v: '接表后算', tip: '走够 8000 步，接上手表后自动算' },
    trained ? { k: 'lean', name: '薄肌', ok: true, v: '练了', tip: '训练日按计划练，休息日休息' }
      : !S.plan ? { k: 'lean', name: '薄肌', na: true, ok: false, v: '等计划', tip: '训练日按计划练，休息日休息；有了计划才知道哪天该练' }
      : { k: 'lean', name: '薄肌', ok: rest, v: rest ? '休息日' : '还没练', tip: '训练日按计划练，休息日休息' },
  ];
}
// The 五件套 sheet (from the dots on 「今天」): the shown day's five, each with its value (and, in the abstract style, a
// line from voice.js), then what they are.
function habitsHTML(d) {
  const hs = habitsOf(d), n = hs.filter(h => h.ok).length, of = hs.filter(h => !h.na).length;
  const pill = h => {
    let q = ''; if (!h.na) try { q = LV()?.habit(h.k, h.ok, '', { date: d, rest: h.k === 'lean' && h.v === '休息日' }) || ''; } catch (e) {}
    const inner = `<span class="hb-n">${h.ok ? '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}${esc(h.name)}</span>${h.k === 'lean' && q ? `<span class="hb-q">${esc(q)}</span>` : `<span class="hb-v num">${esc(h.v)}</span>${q ? `<span class="hb-q">${esc(q)}</span>` : ''}`}`;
    const label = `${h.name}：${h.tip}，${h.na ? '还没有数据，不算' : h.ok ? '做到了' : '还没做到'}（${h.v}）`;
    return `<div class="hb${h.ok ? ' ok' : ''}${h.na ? ' na' : ''}" role="img" aria-label="${esc(label)}">${inner}</div>`;
  };
  const na = hs.filter(h => h.na && h.k !== 'lean').map(h => h.name);
  return `<div class="habits"><p class="meta hb-sum">${esc(d === today() ? '今天' : mdw(d))}做到 <b class="num">${n}/${of}</b></p><div class="hb-row">${hs.map(pill).join('')}</div>${na.length ? `<p class="hint hb-na">${esc(na.join('、'))}接上手表（「我的 → Apple 健康同步」）后自动算，没数据的不算进 ${n}/${of}。</p>` : ''}</div>`;
}
function openHabitsInfo() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'info', photos: [], removed: [] };
  const ready = ['meals', 'water', 'sleep', 'body', 'health', 'workouts'].every(k => S.loaded.has(k)) && S.date <= today();
  showSheet('五件套', `${ready ? habitsHTML(S.date) : ''}<div class="prose">
    <p>2026 年 10 月很火的「大水理论」「大睡理论」「大蛋理论」「大站理论」「薄肌理论」，薄肌研究所会用你已经在记的数据自动算，不用另外打卡：</p>
    <ul><li><b>大水</b>：这天喝水合计到 2 升（大瓶白水代替饮料）</li>
      <li><b>大睡</b>：这晚睡着 8 小时（按 Apple 健康或你改过的睡眠）</li>
      <li><b>大蛋</b>：蛋白质吃到这天的目标（每天三个蛋是最便宜的补法，一个蛋约 6 g 蛋白质）</li>
      <li><b>大站</b>：走够 8000 步，别一坐一整天</li>
      <li><b>薄肌</b>：训练日按计划练了，休息日就算做到（还没有计划时，练了才算）</li></ul>
    <p>大睡、大站要有手表的数据（Apple 健康同步）；没有数据的那项显示成灰的，不算进几项里做到了几项。</p>
    <p>薄肌靠的是肌肉加低体脂：练的时候照样要加重量、每组做到接近力竭，「轻重量高次数」本身不会更出线条。想按薄肌来做计划，在「我的 → 基础信息」把目标改成「薄肌」。</p>
    <p class="hint">不想看这一条，在「我的 → 偏好设置」里关掉。</p></div>`, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}

const AG = '<span class="ag-mark" aria-hidden="true"></span>';
const CHEV_R = '<svg class="i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const CAM_SVG = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>';
// When the scheduled run comes next: meta/status.auto.next ("HH:MM" or a time), else the first of auto.times after now.
// When Claude looks: meta/status.auto.times, else the usual two runs (a new account has no status yet).
const RUN_TIMES = ['15:00', '23:30'];
function runTimes() {
  const a = S.status?.auto, xs = (Array.isArray(a?.times) ? a.times : []).filter(x => /^\d{1,2}:\d{2}$/.test(String(x || '').trim())).map(x => String(x).trim().padStart(5, '0')).sort();
  return xs.length ? xs : RUN_TIMES;
}
// When 「同步健康」 should run by itself: 20 minutes before each scheduled Claude run, so that run sees fresh data.
function syncTimesTxt() {
  return runTimes().map(t => { const [h, m] = t.split(':').map(Number), x = (h * 60 + m + 1420) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; }).join('、');
}
function nextRunTxt() {
  const a = S.status?.auto && typeof S.status.auto === 'object' ? S.status.auto : { times: RUN_TIMES };
  const hmOf = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m ? `${pad(+m[1])}:${m[2]}` : null; };
  if (a.next) {
    const h = hmOf(a.next); if (h) return h;
    const x = Date.parse(a.next);
    if (x && x > Date.now() - 1800e3) { const dt = new Date(x), hh = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`; return ymd(dt) === ymd(new Date()) ? hh : `${dt.getMonth() + 1}/${dt.getDate()} ${hh}`; }
  }
  let times = (Array.isArray(a.times) ? a.times : []).map(hmOf).filter(Boolean).sort();
  if (!times.length) times = RUN_TIMES;
  return times.find(x => x > nowHM()) || `明天 ${times[0]}`;
}
// No plan yet. With the basics in profile/main the plan is on its way: when Claude next looks, and what was filled in;
// without them, what to fill in (the guide's step ②). short: the line in the training card.
function planWaitHTML(short) {
  if (!S.loaded.has('profile')) return '正在读取…';
  // the person plans; Claude assists: a template first, waiting for Claude's own plan second
  const wait = `<button type="button" class="link" data-act="plan-wait">等 Claude 做一份</button>`;
  if (hasBasics()) {
    return short ? `<span>还没有训练计划。可以先自己搭一套，Claude 下次看的时候会补饮食目标、给建议；也可以等它做一份。</span>${wait}`
      : `<b class="pw-t">还没有计划</b><span>可以先自己搭一套（从模版里挑，今天就能练），Claude 下次看的时候会补饮食目标、给建议；也可以等它做一份。</span><div class="btns"><button type="button" class="btn primary sm" data-act="plan-tpl">自己搭一套</button><button type="button" class="btn ghost sm" data-act="profile">看看我填的资料</button></div>${wait}`;
  }
  return short ? `<span>还没有训练计划。可以先自己搭一套；要 Claude 做一份的话，先填好基础信息，它下次看的时候做。</span><button type="button" class="link" data-act="onb-basics">填写基础信息</button>`
    : `<b class="pw-t">还没有计划</b><span>可以先自己搭一套（从模版里挑，今天就能练）。要 Claude 做一份训练和饮食计划的话，先填好基础信息（六项就够），它下次看的时候做。</span><div class="btns"><button type="button" class="btn primary sm" data-act="plan-tpl">自己搭一套</button><button type="button" class="btn ghost sm" data-act="onb-basics">填写基础信息</button></div>${wait}`;
}
// 等 Claude 做一份: what happens meanwhile, in a sheet.
function openPlanWait() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const runs = runTimes().join(' 和 '), tt = tempTargets();
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet('等 Claude 做一份', `<div class="panel panel-pad stack">${hasBasics()
    ? `<p>Claude 每天 ${esc(runs)} 看一次，按你填的资料和这之前记的饭做一份训练和饮食计划，做好后出现在「训练」页。</p><p class="meta">这之前拍下吃的每一顿，它第一次看的时候就能对着你真实的饮食来定；今晚想练的话，先自己搭一套，它之后只补饮食目标、给建议。</p>`
    : `<p>先填好基础信息（六项就够），Claude 下次看的时候做一份训练和饮食计划，出现在「训练」页。</p><button type="button" class="btn primary sm" data-act="onb-basics" data-close="1" style="align-self:flex-start">填写基础信息</button>`}
    ${tt ? `<div class="sub-h">先按这个吃</div>${tempTargetsHTML(tt)}` : ''}</div>`,
    '<button type="button" class="btn ghost" data-act="plan-tpl" data-close="1">自己搭一套</button><button type="button" class="btn primary main" data-act="close">好</button>');
}
// 让 Claude 看看 (the plan page, after a day is saved): a message Claude answers with proposals next time.
async function askPlanReview(btn) {
  if (btn?.disabled) return; if (btn) btn.disabled = true;
  try { await sendToClaude('帮我看看现在这套训练安排：各部位组数、动作顺序、组数次数和重量有没有要调的，直接出提案', 'plan-review'); toast('已交给 Claude，下次处理时会回复'); render(); }
  catch (e) { if (btn) btn.disabled = false; toast(errMsg(e), true); }
}
// 该拍身材照了: for the body-shape goals, 14 days or more after the last set of photos (or none yet after a week of use).
// The reason as a short line; '' when not due.
const PP_GOALS = ['lean', 'muscle', 'recomp', 'fatloss'];
function progressDue() {
  if (!PP_GOALS.includes(S.profile?.goal) || !['progress', 'meals', 'workouts', 'body'].every(k => S.loaded.has(k))) return '';
  const t = today(), last = S.progress.find(p => isDate(p.date) && p.date <= t);
  if (last) { const n = daysBetween(last.date, t); return n >= 14 ? `上次是 ${md(last.date)}，隔了 ${gapTxt(n)}` : ''; }
  const first = [...S.meals, ...S.workouts, ...Object.values(S.body)].map(x => x.date).filter(isDate).sort()[0];
  return first && daysBetween(first, t) >= 7 ? '还没拍过，拍一组以后好对比' : '';
}
// A day to come: its training card (which plan day it is expected to be, 换一天 to change it, the 训练单 or, on a rest
// day, the next one) and the day's diet targets.
function previewCard(d) {
  if (!['plan', 'workouts', 'days'].every(k => S.loaded.has(k))) return `<section class="sec"><div class="panel">${loading}</div></section>`;
  if (!S.plan) return `<section class="sec"><div class="panel empty">${planWaitHTML()}</div></section>`;
  const tg = targetsFor(d);
  const diet = tg ? `<section class="sec"><div class="sec-h"><h2>饮食目标</h2><span class="count">${tg.rest ? '休息日' : '训练日'}</span></div><div class="panel panel-pad"><div class="targets">${MACROS.map(([k2, l, u, c]) => `<div class="tg" style="--c:${c}"><div class="k">${l}</div><div class="v">${isNum(tg[k2]) ? fmt(tg[k2]) : '—'}<small>${u}</small></div></div>`).join('')}</div></div></section>` : '';
  return `${trainSection(d)}${diet}<p class="hint center">按现在的计划推算，到这天再来记录。</p>`;
}
// 摄入怎么算的: which number each meal counts with, drinks, quick items, the day's target.
function openIntakeInfo(d = S.date) {
  const it = intake(d), tg = targetsFor(d), pd = plannedDay(d);
  const who = d === today() ? '今天' : '这天';
  const parts = [it.reviewed ? `Claude 估的 ${it.reviewed} 餐` : '', it.manual ? `自己填的 ${it.manual} 餐` : '', it.quick.names.length ? `快捷记录 ${it.quick.names.length} 项` : ''].filter(Boolean);
  const ps = [
    `每餐按这个顺序取数：自己填的 > Claude 估的 > 快捷记录的合计。${parts.length ? `${who}算进来的有：${parts.join('、')}。` : `${who}还没有能算进来的餐。`}${it.waiting ? `还有 ${it.waiting} 餐等 Claude 估，没算进来。` : ''}`,
    it.dr.kcal ? `饮品：${Object.entries(it.dr.ml).map(([k, ml]) => `${DRINK_TXT[k]} ${fmt(ml)} ml`).join('、')}，约 ${fmt(it.dr.kcal)} kcal、蛋白质 ${fmt(it.dr.protein)} g。牛奶按全脂、豆浆按无糖算。` : '',
    it.quick.names.length ? `快捷记录：${it.quick.names.join('、')}，约 ${fmt(it.quick.kcal)} kcal、蛋白质 ${fmt(it.quick.protein)} g。` : '',
    tg?.temp ? `目标：还没有计划，这是按你的基础信息估的临时目标（基础代谢 × 活动量，按目标增减；蛋白质、脂肪按体重算，剩下的给碳水）。Claude 做计划后会细调，到时按计划来。${tg.bonus ? `活动消耗比你平时多，热量加了 ${fmt(tg.bonus)} kcal，都加在碳水上。` : ''}`
      : tg ? `目标：${who}${tg.rest ? '是休息日，用计划里的休息日目标' : `是训练日${pd ? `（练${dayShort(pd)}）` : ''}，用训练日目标`}。${tg.bonus ? `活动消耗比你平时同类的日子多，热量加了 ${fmt(tg.bonus)} kcal，都加在碳水上。` : ''}` : '还没有计划，所以没有目标。',
  ].filter(Boolean);
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet(`摄入怎么算的 · ${mdw(d)}`, `<div class="panel panel-pad prose">${ps.map(p => `<p>${esc(p)}</p>`).join('')}</div>`, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}

// 饮食: the meals of the day. The card's head says carbs and fat against the day's targets (kcal and protein are on
// 「今天」), the targets (训练日目标 ›: the 饮食目标 sheet) and 「?」 (how the numbers are counted); in the evening, with
// 30 g of protein or more to go, quick picks at the bottom. 记一餐 and the camera as before.
function mealsSection(d) {
  const mealsIn = S.loaded.has('meals'), isToday = d === today();
  const meals = S.meals.filter(m => m.date === d).sort((a, b) => cmp(dayTime(a.time), dayTime(b.time)));
  const cam = S.assets && isToday ? `<button class="cam" data-act="cam-meal" aria-label="拍照记一餐">${CAM_SVG}</button>` : '';
  const body = !mealsIn ? loading : meals.length ? `<div class="rows">${meals.map(mealRow).join('')}</div>`
    : `<div class="empty">${esc(isToday ? vt('empty.meals', '还没有记饮食。开饭前拍一张，吃完再补吃了多少就行。') : vt('empty.mealsPast', '这天没有记饮食。'))}<button class="btn primary sm" data-act="${isToday && S.assets ? 'cam-meal' : 'new-meal'}">${isToday ? esc(vt('btn.camMeal', '拍照记一餐')) : '补记一餐'}</button></div>`;
  const tg = targetsFor(d), it = intake(d);
  const mac = mealsIn ? MACROS.slice(2).map(([k, l]) => `${l} <b class="num">${fmt(it.sum[k])}</b>${tg && isNum(tg[k]) ? `<span class="num">/${fmt(tg[k])}</span>` : ''}`).join('<i aria-hidden="true"> · </i>') + ' g' : '';
  const tgBtn = tg ? `<button type="button" class="mh-tg${tg.temp ? ' tmp' : ''}" data-act="diet-open" aria-label="饮食目标：训练日、休息日、原则、常去的店">${tg.temp ? '临时目标' : `${tg.rest ? '休息日' : '训练日'}目标`} ›</button>`
    : S.loaded.has('plan') ? `<span class="meta">${S.profile ? '有了计划后显示目标' : '填好基础信息后显示目标'}</span>` : '';
  const head = `<div class="mh"><span class="mh-m">${mac}</span>${tgBtn}<button type="button" class="icon-btn sm mh-q" data-act="intake-info" aria-label="摄入怎么算的">?</button></div>`;
  return `<section class="sec" id="sec-food"><div class="sec-h"><h2>饮食</h2>${mealsIn && meals.length ? `<span class="count">${meals.length}</span>` : ''}<button class="link" data-act="new-meal">${isToday ? '记一餐' : '补记'}</button>${cam}</div><div class="panel">${head}${body}${proteinChips(d, it, tg)}</div></section>`;
}

// 训练 (the 今日 card): one question a card. Today on a training day: 「今天练 胸 肩 三头」, 开练, the exercises' names
// (tap: the 训练单), one line of facts; a session running: the live card; sessions logged: each one's results (woCard);
// a rest day, a past day without a session: one line. 换一天 and everything else (补记, 从训记同步, 再练一次, the 训练
// tab) sit in the sheet under 「⋯」 (openTrainMore) and the 换一天 sheet (openDaySwitch).
const xjKey = () => !!S.xj?.hasKey;
const xjUser = () => xjKey() || !!S.xunji?.linked;
// 训练记在哪 (profile/prefs.trainIn): 'app' 只用薄肌研究所 (训记's parts folded away), 'both' 两个都用 (薄肌研究所's 开练 first;
// 训记's sync and templates stay, on the 训练 tab), 'xunji' 只用训记 (从训记同步 is the card's main button; 开练 under
// 「⋯」). Unset: 'both' for people connected to 训记 (meta/xunji.linked or a training key), else 'app'.
const TRAIN_IN = [['app', '只在这里记'], ['both', '两个都用'], ['xunji', '只用训记']];
const autoTrainIn = () => xjUser() ? 'both' : 'app';
function trainIn() { const v = prefs().trainIn; return TRAIN_IN.some(([k]) => k === v) ? v : autoTrainIn(); }
const xjOn = () => trainIn() !== 'app';     // 训记 things shown
const appOn = () => trainIn() !== 'xunji';  // 薄肌研究所's 训练中 is the way to log
// The first training day after d (d: today or later), as the days ahead are expected to go.
function nextTrainAfter(d) {
  const xs = ahead((o, x) => x > d && isPlanDay(o[o.length - 1].k));
  const nx = xs.find(x => x.d > d && isPlanDay(x.k));
  const pd = nx && planDays().find(p => p.id === nx.k);
  return pd ? { d: nx.d, pd } : null;
}
const planExs = pd => (pd?.exercises || []).filter(x => x && typeof x === 'object');
// This time's prescriptions for plan day pd on day d, with when it was last trained.
function dayRxs(d, pd) {
  const last = lastDayOf(pd.id, d), gap = last ? daysBetween(last, d) : null;
  return { last, gap, rxs: planExs(pd).map(x => exRx(x, d, gap != null && gap >= 10, { dayId: pd.id })) };
}
// 「5 个动作 · 上次 10/12 · 隔了 7 天」, and without a rotation 「本周第 2 练 / 共 4」.
function dayMetaTxt(d, pd, r) {
  const bits = [`${planExs(pd).length} 个动作`];
  if (r.last) bits.push(`上次 ${md(r.last)}`, `隔了 ${gapTxt(r.gap)}`); else bits.push('还没练过');
  if (!rotation().length && d <= today()) { const n = weeklyTrainDays(); bits.push(`本周第 ${weekNth(d)} 练${n ? ` / 共 ${n}` : ''}`); }
  if (inDeload(d)) bits.push('减量周');
  return bits.join(' · ');
}
// The rule's point for the day: 「按上次成绩，杠铃卧推该加重」; '' when nothing is due.
function ruleTip(rxs) {
  const ups = rxs.filter(r => r.src === 'rule' && r.up && r.name && (r.kind === 'kg' || r.kind === 'assist')).map(r => r.name);
  return ups.length ? `按上次成绩，${ups.slice(0, 2).join('、')}${ups.length > 2 ? ` 等 ${ups.length} 个动作` : ''}该加重` : '';
}
// 训练单 of plan day pd on day d: per exercise what to do this time (big: weight × reps × sets, from Claude's advice,
// the rule, the deload week or the plan, with the reason) and, small, last time's working sets; a row opens the
// exercise's details.
function rxListHTML(d, pd, rxs) {
  const xs = planExs(pd);
  if (!xs.length) return '<p class="hint pad">这天还没有动作，在「训练」里加。</p>';
  return `<ul class="rx-list">${xs.map((x, i) => {
    const rx = rxs[i], src = rx.src === 'claude' ? `<span class="rx-src cl">${AG}Claude</span>` : rx.src === 'rule' ? '<span class="rx-src rl">按上次成绩</span>' : rx.src === 'deload' ? '<span class="rx-src dl">减量周</span>' : `<span class="rx-src">计划${rx.note ? ` · ${esc(plainRpe(rx.note))}` : ''}</span>`;
    const name = String(x.name || '').trim();
    return `<li class="rx"><button type="button" class="rx-row" data-act="ex-open" data-n="${esc(name)}" aria-label="${esc(name || '动作')}：动作详情、每次的记录"><span class="rx-n">${esc(name || '动作')}</span><span class="rx-v">${rxHTML(rx)}${src}</span>${CHEV_R}
      ${rx.src !== 'plan' && rx.why ? `<span class="rx-note${rx.src === 'rule' ? ' rl' : rx.src === 'deload' ? ' dl' : ''}">${esc(rx.why)}</span>` : ''}<span class="rx-l">${esc(lastTxt(rx.h.last))}</span></button></li>`;
  }).join('')}</ul>`;
}
// The 训练单 is folded under the exercises' names; whether it is open is kept for the day on this phone (sessionStorage).
const trKey = d => `lsj-tr-open:${S.me?.id || ''}:${d}`;
const trOpen = d => { try { return sessionStorage.getItem(trKey(d)) === '1'; } catch (e) { return false; } };
function trToggle(d) { try { sessionStorage.setItem(trKey(d), trOpen(d) ? '0' : '1'); } catch (e) {} render(); }
// The exercises' names in one line (tap: the 训练单), the facts line, the 训练单 when open.
function dayBodyHTML(d, pd) {
  const r = dayRxs(d, pd), xs = planExs(pd), names = xs.map(x => String(x.name || '').trim()).filter(Boolean), open = trOpen(d);
  const tip = d <= today() ? ruleTip(r.rxs) : '';
  const line = names.length ? `<button type="button" class="tr-exs" data-act="tr-sheet" data-d="${esc(d)}" aria-expanded="${open}" aria-label="${open ? '收起训练单' : '展开训练单'}：${esc(names.join('、'))}"><span>${esc(names.join(' · '))}</span>${CHEV_DOWN}</button>` : '';
  return `${line}<p class="tr-meta">${esc(dayMetaTxt(d, pd, r))}${tip ? `<b>${esc(tip)}</b>` : ''}</p>${open && names.length ? rxListHTML(d, pd, r.rxs) : ''}`;
}
// A coming day: 明天, 周三 within the week, else 10/22（周四）.
function dayName(d) {
  const t = today(), n = daysBetween(t, d);
  return n === 1 ? '明天' : n > 1 && n < 7 ? `周${WD[parseD(d).getDay()]}` : mdw(d);
}
function trainSection(d) {
  const t = today();
  if (!['workouts', 'plan', 'days'].every(k => S.loaded.has(k))) return `<section class="sec"><div class="panel train">${loading}</div></section>`;
  const wos = S.workouts.filter(w => w.date === d).sort(latestFirst);
  // a day to come: what it comes to if the training days before it go as planned (the 本周 card, 换一天 and 下次练 say
  // the same); today and the past: the 口径 (dayKind)
  const k = d > t ? expectedKind(d) : dayKind(d), pd = planDays().find(x => x.id === k) || null;
  const ti = trainIn(), app = ti !== 'xunji';
  const when = d === t ? '今天' : d > t ? dayName(d) : '这天';
  const named = p => esc(p.name || dayShort(p));
  // 训练中: a session being logged shows on its own day, and on today while it runs or waits to be finished
  const act = activeWo(), showAct = !!act && d <= t && (act.date === d || d === t);
  const liveNow = showAct && isFresh(act) && act.date === d;
  const live = showAct ? liveCardHTML(act) : '';
  let title = '', body = '', mode = 'rest', tags = '', right = '';
  const sw = (label, cls = 'link tr-sw') => planDays().length ? `<button type="button" class="${cls}" data-act="day-switch" data-d="${esc(d)}">${label}</button>` : '';
  if (liveNow && !wos.length) {
    const apd = planDays().find(x => x.id === act.planDayId);
    mode = 'live'; title = apd ? `${when}在练 ${named(apd)}` : `${when}在练`;
    body = live;
  } else if (wos.length) {
    mode = 'done'; title = pd ? `${when}练了 ${named(pd)}` : `${when}练了`;
    body = `${live}<div class="wres-list">${wos.map(w => woCard(w, k)).join('')}</div>`;
  } else if (!S.plan) {
    // no plan yet: a template makes one for today (B3); a free session is still one tap away
    body = live + `<div class="tr-rest tr-wait">${planWaitHTML(true)}</div>`
      + (d === t && !live && appOn() ? `<div class="tr-go"><button type="button" class="btn primary" data-act="plan-tpl">自己搭一套</button><button type="button" class="link tr-free" data-act="lv-start">${esc(vt('btn.liveFree', '先自己练一次'))}</button></div>` : '');
  } else if (pd) {
    mode = 'plan'; title = `${when}练 ${named(pd)}`;
    if (d === t) {
      if (inDeload(t)) tags = '<button type="button" class="tag dl" data-act="phase-open">减量周</button>';
      else if (!activeWo() && deloadDue() && !deloadQuiet()) tags = '<button type="button" class="tag dl due" data-act="deload-open">该减量 ›</button>';
    }
    right = sw('换一天');
    // today's 开练 (or 从训记同步) is the button on 「今天」 at the top; this card is what the day is
    body = live + (d < t ? `<p class="tr-line">这天没有训练记录。${ti === 'xunji' ? '在训记里练了就同步过来' : '练了的话在「⋯」里补记'}；没练就换成休息。</p>` : dayBodyHTML(d, pd));
  } else if (k === 'train') {
    mode = 'train'; title = d < t ? '这天练了' : `${when}练，不按计划`;
    right = sw('换一天');
    body = live + (d === t && !act && app ? '<p class="tr-meta">不按计划：开练后自己加动作</p>' : d < t ? '<p class="tr-line">这天没有训练记录。练了的话在「⋯」里补记。</p>' : '');
  } else if (d < t) {
    title = '这天没练'; right = sw('其实练了？');
    body = live;
  } else {
    const nx = nextTrainAfter(d);
    title = `${when}休息${nx ? `<small class="tr-nx">下次练 ${esc(nx.d === addDays(t, 1) ? '明天' : dayName(nx.d))} ${named(nx.pd)}</small>` : ''}`;
    right = sw(d === t ? '其实今天练？' : '其实练？');
    body = live;
  }
  // a pick that differs from the plan: 「你换的」 next to the title (the 换一天 sheet says what the plan was)
  const p = dayPick(d);
  const mineTag = p && p !== autoOf(d) && mode !== 'done' && mode !== 'live' ? `<button type="button" class="tag mine" data-act="day-switch" data-d="${esc(d)}">你换的</button>` : '';
  if (mineTag) title = title.replace(/(<small class="tr-nx">|$)/, m => mineTag + m);
  const more = `<button type="button" class="icon-btn more" data-act="train-more" data-d="${esc(d)}" aria-label="更多：换一天、补记、同步、去训练页">⋯</button>`;
  const head = title ? `<div class="tr-head"><h3 class="tr-title">${title}</h3>${tags}${right}${more}</div>` : (S.plan ? `<div class="tr-head"><h3 class="tr-title">${when}休息</h3>${right}${more}</div>` : '');
  return `<section class="sec" id="sec-train"><div class="panel train trm-${mode}">${head}${body}</div></section>`;
}
// 该减量一周了: 先不 keeps it quiet for 7 days on this phone (lsj-deload-dismiss).
const deloadKey = () => 'lsj-deload-dismiss:' + (S.me?.id || '');
const deloadQuiet = () => { const off = lsGet(deloadKey()); return isDate(off) && daysBetween(off, today()) < 7; };
// The reason (deloadDue), what a deload week is, 这周减量 / 先不; from the 今日 card's 「该减量 ›」 and the 训练 tab.
function openDeloadSheet() {
  const why = deloadDue(); if (!why || !S.plan) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet('该减量一周了', `<div class="panel panel-pad stack"><p><b>${esc(why)}</b>。</p><p class="hint" style="margin:0">减量周：每个动作组数减半（最少 2 组）、重量不变，每组留 3–4 次余力，让身体恢复，下周接着往上加。开练时训练单会按减量排。</p></div>`,
    '<button type="button" class="btn ghost" data-act="deload-no" data-close="1">先不</button><button type="button" class="btn primary main" data-act="deload-go">这周减量</button>');
}
async function deloadGo(btn) {
  if (!S.db || btn.disabled) return;
  btn.disabled = true;
  const t = today();
  try {
    await editPlan(plan => {
      const pi = plan.phaseInfo && typeof plan.phaseInfo === 'object' ? plan.phaseInfo : (plan.phaseInfo = {});
      pi.deload = { start: t, end: addDays(t, 6) };
    });
    if (S.sheet?.type === 'info') closeSheet(true);
    toast('这周按减量练：组数减半、重量不变');
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
}
// 训记模版 status of a plan day (meta/xunji.templatesState); none for people who said no to templates.
function tplStatus(id) {
  const x = S.xunji; if (!x) return null;
  const st = x.templatesState && typeof x.templatesState === 'object' ? x.templatesState[id] : null;
  if (!st) return x.templates === 'declined' ? null : { t: '还没写进训记', cls: '' };
  const pu = Date.parse(S.plan?.updatedAt || ''), at = Date.parse(st.planUpdatedAt || '');
  if (pu && at && pu > at + 1000) return { t: '计划改过，训记里还是旧的', cls: 'warn' };
  const w = Date.parse(st.at || '');
  return { t: w ? `已写入 ${md(ymd(new Date(w)))}` : '已写入', cls: 'ok' };
}
// 换一天: which plan day this day is (or rest), the one the rotation / week plan comes to marked; a past day can be
// marked as trained. A tap is setDayPlan.
function openDaySwitch(d = S.date) {
  const days = planDays(); if (!days.length) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const t = today(), auto = autoOf(d), cur = expectedKind(d), by = rotation().length ? '按轮换' : '按计划';
  const opts = [...days.map(x => [x.id, x.name || dayShort(x), x.focus || '', dayShort(x)]), ['rest', '休息', '', '休']];
  if (!opts.some(([v]) => v === cur)) opts.unshift([cur, '练了，不是计划里的哪天', '', '练']);
  const p = dayPick(d), nm = v => v === 'rest' ? '休息' : v === 'train' ? '练' : `练${dayShortOf(v)}`;
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet(`${d === t ? '今天' : d < t ? mdw(d) : dayName(d)}练哪天`, `<div class="panel acts">${opts.map(([v, l, f, s]) => {
    const on = v === cur, plan = v === auto;
    return `<button type="button" class="act-row ds-row" data-act="day-plan" data-d="${esc(d)}" data-v="${esc(v)}" data-close="1" aria-pressed="${on}"><span class="dayid${v === 'rest' ? ' rest' : ''}">${esc(s)}</span><span class="ds-t"><b>${esc(l)}</b>${f || plan ? `<small>${esc([plan ? `${by}这天${v === 'rest' ? '休息' : '练这个'}` : '', f].filter(Boolean).join(' · '))}</small>` : ''}</span>${on ? '<span class="ds-on" aria-hidden="true">✓</span>' : ''}</button>`;
  }).join('')}</div>${p && p !== auto ? `<p class="hint" style="margin:0">计划是${esc(nm(auto))}，你换成了${esc(nm(p))}。</p>` : ''}`,
    '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
// 「⋯」 on the 训练 card: the things that aren't today's answer. Every row is an action or a tab.
function openTrainMore(d = S.date) {
  const t = today(), ti = trainIn(), app = ti !== 'xunji', key = ti !== 'app' && xjKey() && !S.xj?.missing;
  const wos = S.workouts.filter(w => w.date === d), act = activeWo(), k = dayKind(d), pd = isPlanDay(k) ? k : '';
  const near = d <= t && d >= addDays(t, -2);
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'info', photos: [], removed: [] };
  const rows = [
    planDays().length && !wos.length && !(d === t && act) ? `<button type="button" class="act-row" data-act="day-switch" data-d="${esc(d)}" data-close="1"><b>换一天</b><small>${d < t ? '这天其实练了、或者没练' : '练别的一天，或者休息'}</small></button>` : '',
    d <= t ? `<button type="button" class="act-row" data-act="new-workout" data-close="1"${pd ? ` data-day="${esc(pd)}"` : ''}><b>补记一次训练</b><small>${app ? '以前练的、忘了记的，选好哪天再逐组补上' : '没用训记的那次，在薄肌研究所里逐组记'}</small></button>` : '',
    key && near ? `<button type="button" class="act-row" data-act="xj-sync" data-close="1"><b>${wos.length ? '再从训记同步' : '从训记同步'}</b><small>导入最近三天在训记里记的训练${S.xunji?.lastSyncAt || S.xj?.webSync?.at ? ` · 上次同步 ${esc(fmtRel(new Date(Math.max(Date.parse(S.xj?.webSync?.at || '') || 0, Date.parse(S.xunji?.lastSyncAt || '') || 0)).toISOString()))}` : ''}</small></button>` : '',
    d === t && !act && wos.length && app ? `<button type="button" class="act-row" data-act="lv-start" data-close="1"><b>${esc(vt('btn.liveAgain', '再练一次'))}</b><small>空白的一次，开练后自己加动作</small></button>` : '',
    d === t && !act && !wos.length && !app && S.plan ? `<button type="button" class="act-row" data-act="lv-start" data-close="1"${pd ? ` data-day="${esc(pd)}"` : ''}><b>在薄肌研究所里开练</b><small>没带训记的那次：逐组打勾，组间自动计时</small></button>` : '',
    `<button type="button" class="act-row" data-act="tab" data-tab="plan" data-close="1"><b>去「训练」看计划和历史</b><small>训练日、每周安排、历史、每个动作的进步</small></button>`,
  ].filter(Boolean).join('');
  showSheet(d === t ? '今天的训练' : `${mdw(d)} 的训练`, `<div class="panel acts">${rows}</div>`, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
function bodySection(d) {
  const b = S.body[d];
  if (!S.loaded.has('body')) return `<section class="sec"><div class="sec-h"><h2>身体</h2></div><div class="panel">${loading}</div></section>`;
  const prev = Object.values(S.body).filter(x => x.date < d && isNum(x.weight)).sort((a, z) => z.date.localeCompare(a.date))[0];
  const delta = b && isNum(b.weight) && prev ? b.weight - prev.weight : null;
  // sleep: body.sleep, else the night in sleep/<d> (#11)
  const sl = S.sleep[d], slH = isNum(b?.sleep) ? b.sleep : sl && !sl.cleared && isNum(sl.asleep) ? Math.round(sl.asleep / 6) / 10 : null;
  const kv = (k, v, u, extra = '') => `<div class="kv"><div class="k">${k}</div><div class="v">${isNum(v) ? `${esc(v)}<small>${u}</small>` : '<small>—</small>'}</div>${extra}</div>`;
  // 体脂率 and the other circumferences: only the ones measured that day
  const more = [];
  if (isNum(b?.bodyFat)) {
    const pb = Object.values(S.body).filter(x => x.date < d && isNum(x.bodyFat)).sort((a, z) => z.date.localeCompare(a.date))[0];
    const dv = pb ? Math.round((b.bodyFat - pb.bodyFat) * 10) / 10 : null;
    more.push(kv('体脂率', b.bodyFat, '%', `<div class="d num">${dv != null ? `较上次 ${dv > 0 ? '+' : ''}${dv.toFixed(1)}` : bodyFatSrc(b) === 'apple-health' ? 'Apple 健康' : ''}</div>`));
  }
  for (const [k, l] of MEAS) if (isNum(b?.[k])) more.push(kv(l, b[k], 'cm'));
  return `<section class="sec" id="sec-body"><div class="sec-h"><h2>身体</h2><button class="link" data-act="new-body">${b ? '修改' : '记录'}</button></div><div class="panel">
    ${weighRow(d)}${feelRow(d)}<div class="body-row">${kv('体重', b?.weight, 'kg', delta != null ? `<div class="d num">较上次 ${delta > 0 ? '+' : ''}${delta.toFixed(1)}</div>` : weightCleared(b) ? '<div class="d">已清除</div>' : '')}${kv('睡眠', slH, 'h')}${kv('腰围', b?.waist, 'cm')}</div>
    ${more.length ? `<div class="body-row more">${more.join('')}</div>` : ''}
    ${healthRow(d)}${d === today() && canSyncHealth() ? '<div class="hsync-line"><button type="button" class="link" data-act="health-sync">同步 Apple 健康</button></div>' : ''}${sleepStrip(d)}${b?.needsReview ? '<div class="meters-foot">睡眠截图等 Claude 读取</div>' : ''}${healthStale(d)}</div></section>`;
}

/* 今天要做的: the first three actions the person hasn't struck (skip) of the daily report Claude wrote for day d (its
   actionsFor; the newest one when there are several; reports from before actionsFor: daily-<d>'s own actions), then the
   person's own to-dos in todos/<d>. Ticks go to the report's done map; 不做 to its skip map. */
function dayActions(d) {
  const ok = r => r?.kind === 'daily' && Array.isArray(r.actions);
  const r = S.reports.find(x => ok(x) && x.actionsFor === d) || S.reports.find(x => ok(x) && x.id === 'daily-' + d && !isDate(x.actionsFor));
  const items = r ? r.actions.map((a, i) => ({ t: String(a ?? '').trim(), i })).filter(x => x.t && !isSkipped(r, x.i)).slice(0, 3) : [];
  return items.length ? { r, items } : null;
}
const doneLocal = {}, skipLocal = {};  // ticks / strikes on their way to the server: "<report id>:<index>" -> true / false
let doneQ = Promise.resolve();
const isDone = (r, i) => { const k = r.id + ':' + i; return k in doneLocal ? doneLocal[k] : r.done?.[String(i)] === true; };
const isSkipped = (r, i) => { const k = r.id + ':' + i; return k in skipLocal ? skipLocal[k] : r.skip?.[String(i)] === true; };
const BOX = '<span class="box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span>';
// 「接下来」 in the brief: Claude's actions for the day, then the person's own; 「＋ 自己加一件」 opens the input.
function todoBlock(d) {
  if (!S.loaded.has('reports')) return '';
  const a = dayActions(d), mine = todoItems(d);
  const claude = (a?.items || []).map(x => ({ ...x, on: isDone(a.r, x.i) }));
  const n = claude.length + mine.length;
  const all = n && claude.every(x => x.on) && mine.every(x => x.done);
  const add = d !== today() ? '' : S.todoOpen
    ? `<div class="todo-add"><input id="q-todo" type="text" maxlength="80" enterkeyhint="done" autocomplete="off" placeholder="比如：晚上 11 点前睡" aria-label="加一件要做的事" value="${esc(S.qt || '')}"><button type="button" class="btn primary sm" data-act="todo-add">加</button></div>`
    : `<button type="button" class="link todo-more" data-act="todo-open">＋ 自己加一件</button>`;
  const rowsOf = (cl, mn) => cl.map(x => `<div class="todo-r"><button type="button" class="todo-i" role="checkbox" aria-checked="${x.on}" data-act="todo" data-id="${esc(a.r.id)}" data-i="${x.i}">${BOX}<span class="tx">${esc(x.t)}</span></button><button type="button" class="todo-x" data-act="todo-skip" data-id="${esc(a.r.id)}" data-i="${x.i}" aria-label="不做这条：${esc(x.t)}" title="不做这条"><span>不做</span></button></div>`).join('')
    + mn.map(x => `<div class="todo-r mine"><button type="button" class="todo-i" role="checkbox" aria-checked="${!!x.done}" data-act="mytodo" data-d="${esc(d)}" data-id="${esc(x.id)}">${BOX}<span class="tx">${esc(x.text)}</span></button><button type="button" class="todo-x" data-act="mytodo-del" data-d="${esc(d)}" data-id="${esc(x.id)}" aria-label="删掉：${esc(x.text)}" title="删掉"><span>×</span></button></div>`).join('');
  // three at most (Claude's first), 「还有 N 条」 opens the rest for the day on this page
  const cap = S.todoAll === d ? Infinity : 3, cl = claude.slice(0, cap), mn = mine.slice(0, Math.max(0, cap - cl.length)), more = n - cl.length - mn.length;
  const rows = rowsOf(cl, mn);
  if (!n && !add) return '';
  // with items, 「还有 N 条」 and 「＋ 自己加一件」 sit at the right of the heading (the input, once open, under the list)
  const inHead = n && add && !S.todoOpen;
  const moreBtn = more > 0 ? `<button type="button" class="link todo-all" data-act="todo-all" data-d="${esc(d)}">还有 ${more} 条</button>` : '';
  return `<div class="ag-sec">${n ? `<div class="ag-sh"><span>${esc(vt('brief.next', '接下来'))}</span>${all ? '<span class="all-done">都做到了</span>' : ''}${moreBtn || inHead ? `<span class="ag-sh-r">${moreBtn}${inHead ? add : ''}</span>` : ''}</div><div class="todo">${rows}</div>` : ''}${inHead ? '' : add}</div>`;
}
// Shown at once; the PATCHes go out one after another so the last tap is what the server keeps.
function toggleDone(rid, i) {
  const r = S.reports.find(x => x.id === rid); if (!r || !S.db || !(i >= 0)) return;
  reportFlag(doneLocal, 'done', r, i, !isDone(r, i));
}
function reportFlag(local, field, r, i, v) {
  const k = r.id + ':' + i;
  local[k] = v; render();
  doneQ = doneQ.then(async () => {
    try { await retry1(() => S.db.collection('reports').doc(r.id).update({ [field]: { [String(i)]: v ? true : { __delete__: true } } })); }
    catch (e) { if (local[k] === v) toast('没保存上，检查网络后再点一次', true); }
    if (local[k] === v) delete local[k];
    render();
  });
}
// 不做: Claude's action i drops out of the card (the next one moves up); 撤销 brings it back.
function skipAction(rid, i) {
  const r = S.reports.find(x => x.id === rid); if (!r || !S.db || !(i >= 0)) return;
  reportFlag(skipLocal, 'skip', r, i, true);
  toast('这条不做了', false, () => { const x = S.reports.find(y => y.id === rid); if (x) reportFlag(skipLocal, 'skip', x, i, false); });
}
// The person's own to-dos, todos/<date> {date, items: [{id, text, done}]}. Changes show at once and are written in order;
// each is a function of the item list, so a conflict re-applies it to the server's copy.
const todoLocal = {}, todoBusy = {};
let todoQ = Promise.resolve();
function todoItems(d) {
  const xs = d in todoLocal ? todoLocal[d] : S.todos[d]?.items;
  return Array.isArray(xs) ? xs.filter(x => x && typeof x === 'object' && typeof x.text === 'string' && x.id) : [];
}
function changeTodos(d, fn) {
  if (!S.db || !isDate(d)) return;
  todoLocal[d] = fn(clone(todoItems(d))); todoBusy[d] = (todoBusy[d] || 0) + 1; render();
  todoQ = todoQ.then(async () => {
    const ref = S.db.collection('todos').doc(d);
    try {
      let cur = S.db.cached('todos', d) || await retry1(() => ref.get());
      for (let i = 0; ; i++) {
        const base = cur.exists && Array.isArray(cur.data.items) ? cur.data.items : [];
        const doc = { ...(cur.exists ? cur.data : {}), date: d, items: fn(clone(base)), updatedAt: nowIso() };
        try { await retry1(() => ref.set(doc, { ifVersion: cur.version })); break; }
        catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await retry1(() => ref.get()); }
      }
    } catch (e) { toast(e?.code === 'invalid_argument' ? '服务器还不支持自己加的待办' : '没保存上，检查网络后再试', true); }
    if (!--todoBusy[d]) delete todoLocal[d];
    render();
  });
}
function addTodo(d) {
  const text = String(S.qt || '').trim().slice(0, 80);
  if (!text) { $('#q-todo')?.focus(); return; }
  const item = { id: newId('t'), text, done: false };
  S.qt = '';
  changeTodos(d, xs => xs.some(x => x.id === item.id) ? xs : [...xs, item]);
}
function tickTodo(d, id) {
  const x = todoItems(d).find(y => y.id === id); if (!x) return;
  const v = !x.done;
  changeTodos(d, xs => xs.map(y => y.id === id ? { ...y, done: v } : y));
}
function delTodo(d, id) {
  const xs0 = todoItems(d), i = xs0.findIndex(y => y.id === id); if (i < 0) return;
  const x = xs0[i];
  changeTodos(d, xs => xs.filter(y => y.id !== id));
  toast(`删掉了「${x.text.length > 12 ? x.text.slice(0, 12) + '…' : x.text}」`, false, () => changeTodos(d, xs => xs.some(y => y.id === id) ? xs : [...xs.slice(0, i), x, ...xs.slice(i)]));
}

// One line in 身体 when Apple Health data stopped coming in: opens the 同步健康 shortcut. No x-success: coming back
// through a web address would open Safari rather than the home-screen app; the page refetches when it is shown again.
// Off with prefs.staleHealth = false.
const SYNC_URL = 'shortcuts://run-shortcut?name=' + encodeURIComponent('同步健康');
function healthStale(d) {
  if (d !== today() || !S.loaded.has('health') || !prefOn('staleHealth')) return '';
  let last = 0;
  for (const h of Object.values(S.health)) { const t = Date.parse(h.syncedAt || ''); if (t > last) last = t; }
  if (!last || Date.now() - last <= 12 * 3600e3) return '';
  const hrs = Math.floor((Date.now() - last) / 3600e3);
  return `<div class="hsync"><span>健康数据 ${hrs >= 48 ? `${Math.floor(hrs / 24)} 天` : `${hrs} 小时`}前同步</span><span aria-hidden="true">·</span><a href="${esc(SYNC_URL)}">立即同步</a></div>`;
}

// plan.diet.quick, the usable ones with their index.
const quickChoices = () => (Array.isArray(S.plan?.diet?.quick) ? S.plan.diet.quick : []).map((q, i) => ({ q, i })).filter(x => x.q && typeof x.q === 'object' && typeof x.q.name === 'string' && x.q.name.trim());
const qkSub = q => [isNum(q.protein) ? `蛋白质 ${fmt(q.protein)} g` : '', isNum(q.kcal) ? `${fmt(q.kcal)} kcal` : '', q.when === 'late' ? '适合夜宵' : ''].filter(Boolean).join(' · ');
// In the evening (from 18:00) with 30 g of protein or more to go: two or three quick-list picks at the bottom of the
// food card, protein-rich first and, at 夜宵 time, the late-night ones first. A tap logs it at once with 撤销 in the
// toast (#43); 更多 opens the whole list (#6).
function proteinChips(d, it, tg) {
  if (d !== today() || !S.loaded.has('meals')) return '';
  const qs = quickChoices(), T = isNum(tg?.protein) ? tg.protein : null;
  if (!qs.length || T == null) return '';
  const left = Math.round(T - it.sum.protein);
  if (left < 30 || tmin(nowHM()) < 18 * 60) return '';
  const late = lateNow(), p = q => isNum(q.protein) ? q.protein : 0;
  const pick = [...qs].sort((a, z) => (late ? (z.q.when === 'late') - (a.q.when === 'late') : 0) || p(z.q) - p(a.q)).slice(0, 3);
  return `<div class="pchips"><p>${it.waiting ? `蛋白质还差 <b class="num">${fmt(left)}</b> g（${it.waiting} 餐还没估），补一份：` : vh('intake.protein', '蛋白质还差 {n} g，补一份：', { n: `<b class="num">${fmt(left)}</b>` })}</p>
    <div class="chips">${pick.map(({ q, i }) => `<button type="button" class="chip qchip" data-act="quick-log" data-i="${i}" data-n="${esc(q.name)}">＋ ${esc(q.name)}${isNum(q.protein) ? `<small> · ${fmt(q.protein)} g</small>` : ''}</button>`).join('')}<button type="button" class="chip more" data-act="quick-list">更多</button></div></div>`;
}
// One quick item as stored on a meal: the numbers times the portion; the name gets 「 ×0.5」 when it isn't one portion.
function quickItem(q, k = 1) {
  const it = { name: String(q.name).trim() + (k !== 1 ? ` ×${k}` : '') };
  for (const f of MKEYS) if (isNum(q[f])) it[f] = f === 'kcal' ? Math.round(q[f] * k) : Math.round(q[f] * k * 10) / 10;
  return it;
}
// 记一笔 on the card: a meal holding just that item right now, counted at once (Claude doesn't need to look at it).
async function quickLog(i, name, btn) {
  const q = S.plan?.diet?.quick?.[i]; if (!q || String(q.name) !== name || !S.db || btn.disabled) return;
  const d = today(), id = newId('m'), now = nowIso();
  let slot = guessSlot();
  if (!['snack', 'late'].includes(slot) && S.meals.some(m => m.date === d && m.slot === slot)) slot = 'snack';  // that meal is already logged
  const item = quickItem(q);
  const doc = { date: d, slot, time: nowHM(), desc: item.name, quick: [item], photos: [], leftovers: [], needsReview: false, createdAt: now, updatedAt: now };
  const ref = S.db.collection('meals').doc(id);
  btn.disabled = true;
  try { await retry1(() => ref.set(doc, { ifVersion: 0 })); }
  catch (e) {
    if (e?.code !== 'conflict') { btn.disabled = false; toast(errMsg(e), true); return; }
    S.db.sync(true);  // the first try did get through; only its answer was lost
  }
  toast(vt('toast.quick', '记下了：{name}', { name: item.name, seed: Date.now() }), false, async () => {
    try { await retry1(() => ref.delete()); toast('已撤销'); } catch (e) { toast(errMsg(e), true); }
  });
}

// 一拍记一餐: the camera, then the meal is created as soon as the photo is up. If anything fails, the photo goes into a
// new-meal form instead (kept as a draft, with 重试), so it isn't lost.
const camIn = (() => {
  const el = document.createElement('input');
  Object.assign(el, { type: 'file', id: 'cam-in', accept: 'image/*', className: 'vh', tabIndex: -1 });
  el.setAttribute('capture', 'environment'); el.setAttribute('aria-hidden', 'true');
  el.addEventListener('change', () => { const f = el.files?.[0]; el.value = ''; if (f) camMeal(f); });
  document.body.appendChild(el);
  return el;
})();
let camBusy = false;
async function camMeal(file) {
  if (camBusy) return; camBusy = true;
  const d = today(), slot = guessSlot(), time = nowHM();
  let blob = null, pid = null;
  try {
    try { blob = await compress(file); }
    catch (e) { if (/^image\/(jpeg|png|webp|gif)$/.test(file.type)) blob = file; else throw { code: 'unreadable' }; }
    toast('正在上传照片…');
    if (!S.db || !S.assets) throw { code: 'unavailable', message: '网络不可用' };
    pid = (await retry1(() => S.assets.upload(blob, { stay: true }))).id;
    const now = new Date().toISOString(), id = newId('m'), ref = S.db.collection('meals').doc(id);
    try { await retry1(() => ref.set({ date: d, slot, time, photos: [pid], needsReview: true, createdAt: now, updatedAt: now }, { ifVersion: 0, stay: true })); }
    catch (e) { if (e?.code !== 'conflict') throw e; S.db.sync(true); }
    S.date = d; render();
    // a new person learns here that the numbers come later (one of the two places that say when Claude looks next)
    const nx = nextRunTxt(), runs = runTimes();
    toast(`拍好了，Claude 约 ${nx} 看（每天 ${runs.join(' 和 ')} 各看一次）`, false, () => { if (!S.sheet) openMeal(id); }, '补充');
  } catch (e) {
    if (e?.code === 'unreadable') toast('这张照片读不出来，换一张或截图后再试', true);
    else camFallback(blob, d, e);
    if (pid) S.assets?.delete(pid).catch(() => {});  // the form uploads it again when saved
  }
  camBusy = false;
}
function camFallback(blob, d, err) {
  if (S.sheet) { toast('照片没记上：' + errMsg(err), true); return; }
  openMeal(null, { date: d });
  const sh = S.sheet; if (!sh || !$('#ph-grid-photos', sheetEl)) return;
  sh.photos.push({ blob, local: true, url: URL.createObjectURL(blob) });
  drawPhotos(); sheetChanged(); writeDraft();
  if (err?.code === 'unauthenticated') failBar('登录已失效，先别关，重新登录后再保存', 'relogin', '重新登录');
  else failBar(errMsg(err));
}

/* plan.custom: what the person changed on the page, {"<path>": {at, was}} (was: Claude's value before the first
   change). Claude keeps these when it reworks the plan. */
const planCustom = () => { const c = S.plan?.custom; return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; };
const CUSTOM_LBL = { 'diet.kcal': '训练日热量', 'diet.protein': '训练日蛋白质', 'diet.carbs': '训练日碳水', 'diet.fat': '训练日脂肪', 'diet.water': '喝水目标',
  'diet.restDay': '休息日目标', 'diet.quick': '快捷清单', 'training.schedule': '每周安排', 'training.rotation': '轮换顺序' };
const schedTxt = sch => [1, 2, 3, 4, 5, 6, 7].filter(i => sch?.[String(i)]).map(i => `周${WD[i % 7]} ${dayShortOf(sch[String(i)])}`).join('、') || '全部休息';
function customWas(path, was) {
  if (was == null) return path.startsWith('training.days.') ? 'Claude 的计划里没有这一天' : { 'training.rotation': 'Claude 的是不轮换', 'diet.restDay': 'Claude 的是休息日和训练日一样', 'diet.quick': 'Claude 没列' }[path] || 'Claude 没设';
  if (isNum(was)) return `Claude 的是 ${fmt(was)} ${{ 'diet.kcal': 'kcal', 'diet.water': 'ml' }[path] || 'g'}`;
  if (path === 'diet.restDay') return `Claude 的是${MACROS.filter(([k]) => isNum(was[k])).map(([k, l, u]) => ` ${l} ${fmt(was[k])} ${u}`).join('、')}`;
  if (path === 'diet.quick') return `Claude 列了 ${Array.isArray(was) ? was.length : 0} 样`;
  if (path === 'training.schedule') return `Claude 的是 ${schedTxt(was)}`;
  if (path === 'training.rotation') return `Claude 的是 ${Array.isArray(was) ? was.map(dayShortOf).join(' → ') : '不轮换'}`;
  if (path.startsWith('training.days.')) return `Claude 的是「${was.name || ''}」${Array.isArray(was.exercises) ? `，${was.exercises.length} 个动作` : ''}`;
  return '';
}
// One line per changed path: 「你改过」, what Claude had, and 恢复建议值. `paths`: exact paths, or prefixes ending in ".".
function customRows(paths) {
  const c = planCustom(), tpl = S.plan?.template && typeof S.plan.template === 'object' ? String(S.plan.template.name || '模版') : '';
  return Object.keys(c).filter(p => paths.some(x => x.endsWith('.') ? p.startsWith(x) : p === x)).map(p => {
    const m = /^training\.days\.(.+)$/.exec(p);
    // a training day by its name (the id stays in the data): the day's now, else the one it had (a deleted day)
    const dn = m ? `训练日「${planDays().find(d => d.id === m[1])?.name || c[p]?.was?.name || (isPlanDay(m[1]) ? dayShortOf(m[1]) : '没名字的一天')}」` : '';
    // a plan the person built from a template: its training paths are theirs, nothing of Claude's to go back to
    if (tpl && p.startsWith('training.') && c[p]?.was == null && (!m || isPlanDay(m[1]))) return `<div class="cust"><span class="tag mine">你的</span><span class="cust-t">${esc(m ? dn : CUSTOM_LBL[p] || p)} · 从模版「${esc(tpl)}」搭的，Claude 只给建议</span></div>`;
    const lbl = m ? `${dn}${!isPlanDay(m[1]) ? '（你删掉了）' : c[p]?.was == null ? '（你加的）' : ''}` : CUSTOM_LBL[p] || p;
    return `<div class="cust"><span class="tag mine">你改过</span><span class="cust-t">${esc(lbl)} · ${esc(customWas(p, c[p]?.was))}</span><button type="button" class="link" data-act="plan-restore" data-p="${esc(p)}">恢复建议值</button></div>`;
  }).join('');
}

// "22.5kg" → "22.5 kg", "120s" → "120 s" (a load or rest as Claude writes it).
const spaced = v => String(v ?? '').trim().replace(/^(\d+(?:\.\d+)?)\s*(kg|s|min)$/i, '$1 $2');
// Open plan proposals and 训记 template proposals waiting in inbox.
const openInbox = kind => S.inbox.filter(x => x && x.status === 'open' && x.kind === kind);

/* The 训练 tab, top to bottom: 计划 (one row a plan day, opening the day's page), 本周 (the week's seven cells, what
   comes next, the phase line), 历史 · 动作 (two rows into the full-screen pages), 训记 (for people connected to it).
   The diet targets live on 今日's 摄入 card (openDietSheet); the phase, the summary and Claude's notes in a sheet
   (openPhaseSheet); the weekly sets per muscle in a sheet (openMuscleSheet). */
// 「第 1 阶段 · 第 3/4 周 · 减量周 10/20–10/26」 for the 本周 card's last line; the plan's phase name without phaseInfo.
function phaseLineTxt(p) {
  const pi = p.phaseInfo, t = today();
  if (!pi || typeof pi !== 'object' || !isDate(pi.start) || !isDate(pi.end) || pi.end < pi.start) return String(p.phase || '').trim() || '计划说明';
  const name = String(pi.name || '').trim() || String(p.phase || '').trim() || '当前阶段';
  const total = daysBetween(pi.start, pi.end) + 1, weeks = Math.ceil(total / 7), dl = deloadOf();
  const where = t < pi.start ? `${daysBetween(t, pi.start)} 天后开始` : t > pi.end ? '已结束，等下一阶段' : `第 ${Math.floor(daysBetween(pi.start, t) / 7) + 1}/${weeks} 周`;
  return [name, where, dl ? `减量周 ${md(dl.start)}–${md(dl.end)}` : ''].filter(Boolean).join(' · ');
}
// 本周: seven cells (✓ and the day trained, today, the days to come by what they are expected to be, rest), 编辑,
// 接下来, the phase line (or 该减量一周了).
function weekCard(p) {
  const t = today(), mon = addDays(t, 1 - isoWd(t)), sch = p.training?.schedule || {};
  const cells = [1, 2, 3, 4, 5, 6, 7].map(i => {
    const d = addDays(mon, i - 1), tr = trainedOn(d);
    let cls = 'wk-c', txt = '休', say = '休息';
    if (tr) { const k = workedDay(d) || dayPick(d); txt = isPlanDay(k) ? dayShortOf(k) : '练'; say = `练了${isPlanDay(k) ? ` ${txt}` : ''}`; cls += ' on'; }
    else if (d < t) { txt = sch[String(i)] ? '–' : '休'; say = sch[String(i)] ? '排了训练，没练' : '休息'; cls += ' off'; }
    else { const k = expectedKind(d); if (isPlanDay(k)) { txt = dayShortOf(k); say = `要练 ${txt}`; cls += ' plan'; } else if (k === 'train') { txt = '练'; say = '要练'; cls += ' plan'; } else cls += ' rest'; }
    if (d === t) cls += ' now';
    const inner = `<span class="wd">${WD[i % 7]}</span><span class="wv">${tr ? '<i aria-hidden="true">✓</i>' : ''}${esc(txt)}</span>`;
    return d >= t ? `<button type="button" class="${cls}" role="listitem" data-act="day-switch" data-d="${d}" aria-label="${esc(`${mdw(d)}：${say}，点一下改这天练什么`)}">${inner}</button>` : `<div class="${cls}" role="listitem" aria-label="${esc(`${mdw(d)}：${say}`)}">${inner}</div>`;
  }).join('');
  const nx = S.loaded.has('workouts') && S.loaded.has('days') ? nextTrainings(3) : [];
  const next = nx.length ? `<p class="next-line"><span>接下来</span>${nx.map(x => `<b>${esc(dayWord(x.d))} ${esc(dayShortOf(x.k))}</b>`).join('<i aria-hidden="true">→</i>')}</p>` : '';
  const due = !inDeload(t) && !activeWo() && deloadDue() && !deloadQuiet();
  const line = due ? `<button type="button" class="wk-ph due" data-act="deload-open"><span>该减量一周了</span>${CHEV_R}</button>`
    : `<button type="button" class="wk-ph" data-act="phase-open"><span>${esc(phaseLineTxt(p))}</span>${CHEV_R}</button>`;
  return `<section class="sec"><div class="sec-h"><h2>本周</h2></div>
    <div class="panel panel-pad wkc"><div class="wk7" role="list" aria-label="本周每天">${cells}</div>${next}${line}</div></section>`;
}
// 历史 · 动作: two rows into the full-screen pages.
function histExCard() {
  const t = today(), month = S.workouts.filter(w => ymOf(w.date) === ymOf(t)).length, exN = exRows().length;
  return `<section class="sec"><div class="panel acts hx"><button type="button" class="act-row hx-row" data-act="hist"><b>训练历史</b><small>本月 ${month} 次</small>${CHEV_R}</button>
    <button type="button" class="act-row hx-row" data-act="ex-page"><b>动作</b><small>练过 ${exN} 个</small>${CHEV_R}</button></div></section>`;
}
function vPlan() {
  const p = S.plan;
  if (!S.loaded.has('plan')) return `<div class="panel" style="margin-top:6px">${loading}</div>`;
  if (!p) return `<section class="sec"><div class="panel empty plan-wait">${planWaitHTML()}</div></section>${S.workouts.length ? histExCard() : ''}`;
  const days = planDays(), t = today(), cust = planCustom(), fromTpl = !!p.template && typeof p.template === 'object';
  const mine = path => path in cust ? `<span class="tag mine">${fromTpl && cust[path]?.was == null && path.startsWith('training.') ? '你的' : '你改过'}</span>` : '';
  const props = openInbox('plan');
  const banner = props.length ? `<button type="button" class="ag-card ag-banner" data-act="go" data-tab="claude" data-focus="proposals">${AG}<span>Claude 有 ${props.length} 个计划提案等你拍板</span>${CHEV_R}</button>` : '';
  // 计划: the days in the order they come round; 调整: − and ↑ ↓ (a day not in the rotation: 加进轮换); a day deleted
  // here stays in its place as 已删掉 · 撤销 until another tab
  const order = planOrder(), rotOn = rotation().length > 0, adj = !!S.planAdj, sch = p.training?.schedule || {};
  const nWk = [1, 2, 3, 4, 5, 6, 7].filter(i => isPlanDay(sch[String(i)])).length;
  const nRot = order.filter(o => o.rot).length;
  const row = ({ d, rot }, k) => {
    const n = planExs(d).length, last = lastDayOf(d.id, addDays(t, 1)), sub = `${n} 个动作${last ? ` · 上次 ${md(last)}` : ' · 还没练过'}`;
    if (!adj) return `<button type="button" class="pd-row" data-act="day-page" data-id="${esc(d.id)}" aria-label="${esc(d.name || dayShort(d))}：动作、改、开练"><span class="dayid">${esc(dayShort(d))}</span><span class="pd-rt"><b>${esc(d.name || dayShort(d))}${mine('training.days.' + d.id)}</b><small>${esc(sub)}</small></span>${CHEV_R}</button>`;
    const grp = rot ? order.filter(o => o.rot) : order.filter(o => !o.rot), gi = grp.findIndex(o => o.d.id === d.id);
    const mv = rotOn && !rot ? `<button type="button" class="link pd-in" data-act="pd-rot" data-id="${esc(d.id)}">加进轮换</button>`
      : `<span class="pd-mv"><button type="button" class="icon-btn" data-act="pd-up" data-id="${esc(d.id)}" aria-label="上移"${gi === 0 ? ' disabled' : ''}>↑</button><button type="button" class="icon-btn" data-act="pd-down" data-id="${esc(d.id)}" aria-label="下移"${gi === grp.length - 1 ? ' disabled' : ''}>↓</button></span>`;
    return `<div class="pd-row adj"><button type="button" class="pd-x" data-act="pd-del" data-id="${esc(d.id)}" aria-label="删掉「${esc(d.name || dayShort(d))}」">−</button><span class="pd-rt"><b>${esc(d.name || dayShort(d))}</b><small>${esc(sub)}</small></span>${mv}</div>`;
  };
  const goneRow = g => `<div class="pd-row pd-gone"><span>已删掉「${esc(g.name)}」</span><button type="button" class="link" data-act="pd-undo" data-id="${esc(g.id)}">撤销</button></div>`;
  const items = [];
  order.forEach((o, k) => {
    S.planGone.filter(g => g.at === k).forEach(g => items.push(goneRow(g)));
    if (rotOn && !o.rot && (k === 0 || order[k - 1].rot)) items.push('<div class="pd-grp">不在轮换里</div>');
    items.push(row(o, k));
  });
  S.planGone.filter(g => g.at >= order.length).forEach(g => items.push(goneRow(g)));
  items.push('<button type="button" class="pd-add" data-act="day-new">+ 加一天</button>');
  const goneDays = customRows(Object.keys(cust).filter(k => k.startsWith('training.days.') && !isPlanDay(k.slice(14)) && !S.planGone.some(g => 'training.days.' + g.id === k)));
  // 怎么排: rotating (the order above) on the weekdays ticked; or each weekday its own day (the sheet)
  const modes = `<div class="seg pd-modes" role="group" aria-label="怎么排">${[['rot', '按顺序轮换'], ['fix', '固定周几']].map(([v, l]) => `<button type="button" data-act="pd-mode" data-v="${v}" aria-pressed="${(v === 'rot') === rotOn}">${l}</button>`).join('')}</div>`;
  const how = days.length ? `<div class="panel pd-how"><div class="pd-how-h"><b>怎么排</b>${mine('training.schedule') || mine('training.rotation')}${modes}</div>
    ${rotOn ? `<div class="pd-wk" role="group" aria-label="每周哪几天练">${[1, 2, 3, 4, 5, 6, 7].map(i => `<button type="button" class="chip" data-act="pd-wk" data-i="${i}" aria-pressed="${isPlanDay(sch[String(i)])}">${WD[i % 7]}</button>`).join('')}</div>
      <p class="hint" style="margin:0">${nWk ? `每周 ${nWk} 练，按上面的顺序 ${nRot} 天一轮：到了练的日子就练上次之后的那一天，错过的不跳过。` : '点亮每周练的那几天。'}</p>`
      : `<button type="button" class="act-row pd-fix" data-act="sched-edit"><b>${esc(schedTxt(sch))}</b><small>每个周几练哪天，点这里改</small>${CHEV_R}</button>`}</div>` : '';
  const asked = S.messages.some(m => m && m.kind === 'plan-review' && m.status === 'new');
  const links = ['<button type="button" class="link" data-act="plan-swap">换一套</button>',
    asked ? `<span class="meta">${AG} 已交给 Claude</span>` : `<button type="button" class="link" data-act="plan-review">${AG}让 Claude 看看</button>`,
    advOn() && days.length ? '<button type="button" class="link" data-act="muscle-open">每周各部位 ›</button>' : ''].filter(Boolean).join('');
  const count = `${days.length} 个训练日${nWk ? ` · 每周 ${nWk} 练` : ''}`;
  const plan = `<section class="sec" id="sec-days">${banner}<div class="sec-h"><h2>计划</h2><span class="count">${count}</span>${p.example ? '<span class="tag ex">示例</span>' : ''}${days.length ? `<button type="button" class="link" data-act="pd-adj">${adj ? '完成' : '调整'}</button>` : ''}</div>
    <div class="panel pd-list${adj ? ' adj' : ''}">${items.join('')}</div>${goneDays ? `<div class="panel cust-box">${goneDays}</div>` : ''}${how}<div class="pd-links">${links}</div>${tplGuideHTML()}</section>`;
  return plan + weekCard(p) + histExCard() + xjSection();
}
// 训记 on the 训练 tab: one row (for people who log in 训记 too), its sheet has the sync, the templates and what each
// plan day is called in 训记 (dayMap).
const xjLastSync = () => Math.max(Date.parse(S.xj?.webSync?.at || '') || 0, Date.parse(S.xunji?.lastSyncAt || '') || 0);
function xjSection() {
  if (!xjOn()) return '';
  const last = xjLastSync(), wait = openInbox('xunji').length;
  return `<section class="sec"><div class="panel me-g">${meRow('me-sec', '训记', last ? `上次同步 ${esc(md(ymd(new Date(last))))}` : '还没同步过', { attrs: ' data-k="xjplan"', tag: wait ? '<span class="tag wait">模版等你确认</span>' : '' })}</div></section>`;
}
function xjPlanBody() {
  const key = xjKey() && !S.xj?.missing;
  const last = xjLastSync();
  const sync = key ? `<div class="xj-sync"><button type="button" class="btn ghost sm" data-act="xj-sync"${S.xjBusy ? ' disabled' : ''}>${S.xjBusy ? esc(vt('btn.syncing', '同步中…')) : esc(vt('btn.sync', '从训记同步'))}</button><span class="meta">${last ? `上次同步 ${esc(fmtRel(new Date(last).toISOString()))}` : '还没同步过'}</span></div>`
    : `<p class="meta" style="margin:0">在「我的 → 训记」填上训练 key，就能在这里一键同步。<button type="button" class="link" data-act="tab" data-tab="me">去填</button></p>`;
  const maps = planDays().map(xjDayBar).join('');
  return `<div class="panel panel-pad stack">${sync}${tplBodyHTML()}</div>${maps ? `<div class="panel xjmaps">${maps}</div>` : ''}`;
}
// The phase (progress bar, focus, what comes next), the plan's summary and Claude's notes; 这周减量 when a deload is due.
function openPhaseSheet() {
  const p = S.plan; if (!p) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const t = today(), ph = phaseHTML(p.phaseInfo), nc = Object.keys(planCustom()).length;
  const sum = String(p.summary || '').split(/\n+/).map(x => x.trim()).filter(Boolean).join('\n');
  const why = !inDeload(t) && !activeWo() && !deloadQuiet() ? deloadDue() : '';
  const name = String(p.phaseInfo?.name || p.phase || '').trim() || '计划说明';
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet(name, `<div class="panel panel-pad stack plan-head">${p.example ? '<span class="tag ex" style="align-self:flex-start">示例计划 · 填写资料后由 Claude 替换</span>' : ''}${ph || `<h2>${esc(p.phase || '当前计划')}</h2>`}
    ${sum ? `<p class="psum">${esc(sum)}</p>` : ''}${p.training?.note ? `<p class="hint" style="margin:0">${esc(p.training.note)}</p>` : rotation().length ? `<p class="hint" style="margin:0">训练日按 ${esc(rotation().map(dayShortOf).join(' → '))} 轮换：到了训练日就练上次之后的那一天，错过的不跳过。</p>` : ''}
    ${p.notes ? `<div class="sub-h">Claude 的说明</div><div class="prose">${paras(p.notes)}</div>` : ''}
    <div class="ph-f">${p.updatedAt ? `<span class="meta">更新于 ${esc(fmtTs(p.updatedAt))}</span>` : ''}${nc ? `<span class="tag mine">你改过 ${nc} 处</span>` : ''}</div>
    <p class="hint" style="margin:0">${nc ? 'Claude 处理时会照你改的来，觉得不合适会在报告里提。' : '训练日、每周安排、饮食目标和快捷清单都可以自己改，Claude 处理时会照你的来。'}</p></div>
    ${why ? `<div class="dl-card" role="note"><div class="dl-t"><b>该减量一周了</b><span>${esc(why)}。组数减半、重量不变，每组留 3–4 次余力，下周再往上加。</span></div><div class="dl-b"><button type="button" class="btn primary sm" data-act="deload-go">这周减量</button><button type="button" class="btn ghost sm" data-act="deload-no" data-close="1">先不</button></div></div>` : ''}`,
    '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
// 每周各部位 (B1): the weekly sets per muscle the plan adds up to.
function openMuscleSheet() {
  if (!S.plan) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet('每周各部位', `<div class="panel panel-pad stack"><p class="meta" style="margin:0">按每周 ${esc(weeklyTrainDays())} 次算，间接练到的算半组</p>${muscleLineHTML(planWeeklySets())}<p class="hint" style="margin:0">一般范围：胸 10–20、背 12–22、肩 8–20、二头 / 三头 8–14、股四 8–16、腘绳臀 6–14、小腿 6–12、核心 4–10 组一周，每块肌肉一周练到两次。</p></div>`,
    '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
// 饮食目标 (from 今日's 摄入 card): the training-day and rest-day targets, water, 编辑, what the person changed, the
// principles, a day's meals; 常去的店怎么点 at the end. Without a plan: the 临时目标.
function openDietSheet(d = S.date) {
  const p = S.plan, tg = targetsFor(d);
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'diet-info', d, photos: [], removed: [] };
  const close = '<button type="button" class="btn primary main" data-act="close">关闭</button>';
  if (!p) {
    const tt = tempTargets();
    showSheet('临时目标', `${tt ? `<div class="panel panel-pad">${tempTargetsHTML(tt)}</div>` : `<div class="panel panel-pad"><p class="hint" style="margin:0">${S.profile ? '有了计划后显示目标' : '填好基础信息后显示目标'}。</p></div>`}${placesSec()}`, close);
    return;
  }
  const diet = p.diet || {}, cust = planCustom(), mine = path => path in cust ? '<span class="tag mine">你改过</span>' : '';
  // a plan built from a template has no diet targets yet: the same 临时目标 as on 今日, until Claude adds its own (#8.2)
  if (!isNum(diet.kcal)) {
    const tt = tempTargets();
    showSheet('临时目标', `<div class="panel panel-pad stack">${tt ? `${tempTargetsHTML(tt).replace('按你填的资料估的，Claude 做计划后会细调。', 'Claude 处理时会补上正式的。')}` : `<p class="hint" style="margin:0">${S.profile ? '训练计划是自己搭的，Claude 处理时会补上饮食目标。' : '填好基础信息后显示目标。'}</p>`}
      ${diet.guidelines?.length ? `<div class="sub-h">原则</div><ul class="list">${diet.guidelines.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}</div>${placesSec()}`,
      `<button type="button" class="btn ghost" data-act="diet-edit">自己定</button>${close}`);
    return;
  }
  const tgs = MACROS.map(([k, label, unit, c]) => `<div class="tg" style="--c:${c}"><div class="k">${label}</div><div class="v">${isNum(diet[k]) ? fmt(diet[k]) : '—'}<small>${unit}</small></div>${('diet.' + k) in cust ? '<div class="mine-t">你改过</div>' : ''}</div>`).join('');
  const rd = diet.restDay && typeof diet.restDay === 'object' ? diet.restDay : null;
  const rest = rd ? `<p class="hint" style="margin:0">休息日：${MACROS.filter(([k]) => isNum(rd[k])).map(([k, l, u]) => `${l} ${fmt(rd[k])} ${u}`).join(' · ')}${mine('diet.restDay')}</p>` : '<p class="hint" style="margin:0">休息日和训练日一样。</p>';
  const who = d === today() ? '今天' : mdw(d);
  const now = tg ? `<p class="meta" style="margin:0">${esc(who)}是${tg.rest ? '休息日' : '训练日'}${tg.bonus ? `，活动多，热量 +${fmt(tg.bonus)} kcal（加在碳水上）` : ''}</p>` : '';
  showSheet('饮食目标', `<div class="panel panel-pad stack">${now}<div class="sub-h">训练日</div><div class="targets">${tgs}</div>${rest}${isNum(diet.water) ? `<p class="hint" style="margin:0">每天喝水 ${fmt(diet.water)} ml${mine('diet.water')}</p>` : ''}
    ${customRows(['diet.kcal', 'diet.protein', 'diet.carbs', 'diet.fat', 'diet.restDay', 'diet.water'])}
    ${diet.guidelines?.length ? `<div class="sub-h">原则</div><ul class="list">${diet.guidelines.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
    ${diet.meals?.length ? `<div class="sub-h">一天怎么吃</div><div class="ideas">${diet.meals.map(m => `<div><b>${esc(m.slot)}</b><span>${esc(m.idea)}</span></div>`).join('')}</div>` : ''}</div>${placesSec()}`,
    `<button type="button" class="btn ghost" data-act="diet-edit">编辑</button>${close}`);
}
/* 常去的店怎么点: meta/places (Claude keeps it from the meals it sees). On the plan page each place folds open to its
   picks, what to skip and tips; in the meal form, a place named in 吃了什么 brings up its first pick (placeFor). */
const placesList = () => (Array.isArray(S.places?.places) ? S.places.places : []).filter(p => p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim());
const strs = v => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x.trim());
const pickNums = x => [isNum(x.kcal) ? `约 ${fmt(x.kcal)} kcal` : '', isNum(x.protein) ? `蛋白质 ${fmt(x.protein)} g` : ''].filter(Boolean).join(' · ');
function placesSec() {
  if (!S.loaded.has('places')) return '';
  const xs = placesList();
  const ask = typeof LC()?.compose === 'function' ? '<button type="button" class="btn ghost sm" data-act="places-ask">告诉 Claude 我常去哪</button>' : '';
  const body = xs.length ? xs.map((p, i) => {
    const picks = (Array.isArray(p.picks) ? p.picks : []).filter(x => x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim());
    const avoid = strs(p.avoid), tips = strs(p.tips);
    return `<details class="pl" data-key="pl-${i}-${esc(p.name)}"><summary><span class="pl-n"><b>${esc(p.name)}</b>${p.kind ? `<span class="tag ok">${esc(p.kind)}</span>` : ''}</span><span class="pl-c">${isNum(p.n) && p.n > 0 ? `吃过 ${fmt(p.n)} 次` : ''}</span>${CHEV_R}</summary>
      <div class="pl-b">${picks.length ? `<div class="sub-h">这样点</div><ul class="pl-picks">${picks.map(x => `<li><b>${esc(x.name)}</b>${pickNums(x) || x.note ? `<span>${esc([pickNums(x), x.note].filter(Boolean).join(' · '))}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${avoid.length ? `<div class="sub-h">少点</div><p class="pl-p">${esc(avoid.join('、'))}</p>` : ''}
        ${tips.length ? `<div class="sub-h">小技巧</div><ul class="list">${tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${isDate(p.lastAt) ? `<p class="meta">上次去是 ${esc(mdw(p.lastAt))}</p>` : ''}</div></details>`;
  }).join('') : `<div class="empty">常去的店、食堂和外卖，Claude 会从你记的饭里整理出照目标怎么点。${ask}</div>`;
  return `<div class="sub-h pls-h">常去的店怎么点${xs.length ? ` · ${xs.length}` : ''}</div><div class="panel pls">${body}</div>${xs.length ? '<p class="hint">记一餐时写到店名，表单里会提示这家怎么点。</p>' : ''}`;
}
// The place 吃了什么 mentions first (by its name or an alias, at least two characters), or null.
function placeFor(text) {
  const t = String(text || '').toLowerCase(); if (!t.trim()) return null;
  let best = null;
  for (const p of placesList()) {
    for (const nm of [p.name, ...strs(p.aliases)]) {
      const n = String(nm).trim().toLowerCase(); if (n.length < 2) continue;
      const i = t.indexOf(n);
      if (i >= 0 && (!best || i < best.i || (i === best.i && n.length > best.len))) best = { p, i, len: n.length };
    }
  }
  return best ? best.p : null;
}
// In the meal form, under 吃了什么: 「肯德基这样点」 with the first pick and what to skip; × hides it for this form.
function drawPlaceTip() {
  const sh = S.sheet, el = $('#place-tip', sheetEl); if (!el || sh?.type !== 'meal') return;
  const p = sh.existing?.review ? null : placeFor(fval('f-desc'));
  if (!p || (sh.placeHide || []).includes(p.name)) { el.hidden = true; el.innerHTML = ''; return; }
  const pick = (Array.isArray(p.picks) ? p.picks : []).find(x => x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim());
  const avoid = strs(p.avoid), n = pick ? pickNums(pick) : '';
  if (!pick && !avoid.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<div class="pt-h">${AG}<b>${esc(p.name)}这样点</b><button type="button" class="icon-btn sm" data-act="place-hide" data-n="${esc(p.name)}" aria-label="收起这条提示">×</button></div>
    ${pick ? `<p class="pt-pick">${esc(pick.name)}${n ? `<small>${esc(n)}</small>` : ''}</p>` : ''}${avoid.length ? `<p class="pt-avoid">少点：${esc(avoid.join('、'))}</p>` : ''}`;
}

/* 阶段进度 (plan.phaseInfo {name, start, end, focus?, deload?: {start, end}, next?}): the phase's name and dates, a bar
   of its weeks with today's place and the deload week marked, how far along (第 2 周 / 共 4 周 · 还剩 20 天), the focus and
   what comes next. '' without a usable phaseInfo (the page shows plan.phase as before). */
function phaseHTML(pi) {
  if (!pi || typeof pi !== 'object' || !isDate(pi.start) || !isDate(pi.end) || pi.end < pi.start) return '';
  const t = today(), total = daysBetween(pi.start, pi.end) + 1, weeks = Math.ceil(total / 7);
  const name = String(pi.name || '').trim() || String(S.plan?.phase || '').trim() || '当前阶段';
  const at = daysBetween(pi.start, t);  // 0 on the first day
  const pct = x => Math.max(0, Math.min(100, x / total * 100));
  const dl = pi.deload && isDate(pi.deload.start) && isDate(pi.deload.end) && pi.deload.end >= pi.deload.start ? pi.deload : null;
  const inDl = dl && t >= dl.start && t <= dl.end;
  let where;
  if (t < pi.start) where = `还有 ${daysBetween(t, pi.start)} 天开始 · 共 ${weeks} 周`;
  else if (t > pi.end) where = `${md(pi.end)} 已经结束，等 Claude 写阶段总结、排下一阶段`;
  else where = `第 ${Math.floor(at / 7) + 1} 周 / 共 ${weeks} 周 · ${t === pi.end ? '今天是最后一天' : `还剩 ${daysBetween(t, pi.end)} 天`}`;
  const ticks = Array.from({ length: weeks - 1 }, (_, i) => `<i class="wk" style="left:${pct((i + 1) * 7)}%"></i>`).join('');
  const dlBar = dl ? `<i class="dl" style="left:${pct(daysBetween(pi.start, dl.start))}%;width:${pct(daysBetween(dl.start, dl.end) + 1)}%"></i>` : '';
  const now = t >= pi.start && t <= pi.end ? `<i class="now" style="left:${pct(at + 0.5)}%"></i>` : '';
  const label = `${name}：${where}${dl ? `，减量周 ${md(dl.start)}–${md(dl.end)}` : ''}`;
  return `<div class="phase"><h2>${esc(name)}</h2><span class="meta num">${esc(md(pi.start))}–${esc(md(pi.end))}</span></div>
    <div class="ph-bar" role="img" aria-label="${esc(label)}"><i class="done" style="width:${t > pi.end ? 100 : pct(Math.max(0, at))}%"></i>${dlBar}${ticks}${now}</div>
    <div class="ph-legend"><span class="ph-w">${esc(where)}</span>${dl ? `<span class="ph-dl${inDl ? ' on' : ''}"><i aria-hidden="true"></i>减量周 ${esc(md(dl.start))}–${esc(md(dl.end))}</span>` : ''}</div>
    ${inDl ? '<p class="ph-note">这周是减量周：每个动作组数减半（最少 2 组）、重量不变，每组留 3–4 次余力，让身体恢复，下周接着往上加。</p>' : ''}
    ${pi.focus ? `<p class="ph-line"><b>这阶段重点</b>${esc(pi.focus)}</p>` : ''}${pi.next ? `<p class="ph-line"><b>下一阶段</b>${esc(String(pi.next).replace(/^下一阶段[:：]\s*/, ''))}</p>` : ''}`;
}
// The 训记 titles that count as plan day `id` (meta/xunji.dayMap), the most recently trained first.
function xjTitles() {
  const map = S.xunji?.dayMap && typeof S.xunji.dayMap === 'object' ? S.xunji.dayMap : {};
  const from = addDays(today(), -60), seen = new Map();
  for (const w of [...S.workouts].sort(latestFirst)) {
    if (w.source !== 'xunji' || typeof w.title !== 'string' || !w.title.trim()) continue;
    const k = w.title; const x = seen.get(k) || { title: k, n: 0, last: w.date, recent: false };
    x.n++; if (w.date > x.last) x.last = w.date; if (w.date >= from) x.recent = true; seen.set(k, x);
  }
  for (const k of Object.keys(map)) if (!seen.has(k)) seen.set(k, { title: k, n: 0, last: '', recent: false });
  return [...seen.values()].map(x => ({ ...x, id: typeof map[x.title] === 'string' ? map[x.title] : null }))
    .sort((a, z) => cmp(z.last, a.last) || cmp(a.title, z.title));
}
// The bottom of a plan day's card for 训记 people: what the day is called in 训记 (改), and its template's state.
function xjDayBar(day) {
  if (!xjUser() || !xjOn()) return '';
  const ts = xjTitles().filter(x => x.id === day.id);
  const nm = ts.length ? `训记里叫「${ts[0].title}」${ts.length > 1 ? ` 等 ${ts.length} 个` : ''}` : '训记里还没对应哪个训练';
  const st = tplStatus(day.id);
  return `<div class="xjday"><button type="button" class="xjd-map" data-act="daymap-day" data-id="${esc(day.id)}"><span class="xj-ic" aria-hidden="true">训记</span><span class="xjd-n">${esc(nm)}${st ? `<small class="xjd-tpl ${st.cls}">模版：${esc(st.t)}</small>` : ''}</span><span class="link-t">改</span></button></div>`;
}
// 训记模版 (the 训练 tab's 训记 section): Claude's prepared templates, or asking for them, or where the template key
// goes; what is in 训记's 「Agent 模版」 folder now.
function tplBodyHTML() {
  const x = S.xunji || {}, open = openInbox('xunji');
  const n = open.reduce((s, i) => s + (Array.isArray(i.mutation?.upserts) ? i.mutation.upserts.length : 0), 0);
  const support = S.xj && 'hasTemplateKey' in S.xj, hasT = !!S.xj?.hasTemplateKey;
  const asked = S.messages.some(m => m && m.kind === 'xunji-templates' && m.status === 'new');
  let body;
  if (open.length) body = `<button type="button" class="ag-card ag-banner" data-act="go" data-tab="claude" data-focus="proposals">${AG}<span>Claude 准备好了 ${n || open.length} 个模版，等你确认</span>${CHEV_R}</button>`;
  else if (!hasT) body = `<p>${support ? '在「我的 → 训记」存上模版 key，Claude 准备好的模版点一下就能写进训记。' : '把计划写进训记需要服务器先支持模版 key。'}</p>${support ? '<button type="button" class="btn ghost sm" data-act="tab" data-tab="me">去存模版 key</button>' : ''}`;
  else if (asked) body = '<p class="meta">已经告诉 Claude 了。它下次处理时把模版准备好，你在「Claude」页点同意才会写进训记。</p>';
  else body = `<p>让 Claude 把现在的计划按训练日写成训记的「Agent 模版」，你点同意后才会写进去。</p><button type="button" class="btn primary sm" data-act="tpl-ask">让 Claude 把计划写进训记</button>`;
  const tpls = Array.isArray(x.agentTemplates) ? x.agentTemplates.filter(t2 => t2 && typeof t2.name === 'string') : [];
  return `<div class="sub-h">模版</div>${body}
    ${tpls.length ? `<div class="sub-h">训记「Agent 模版」里现在有</div><div class="chips static">${tpls.map(t2 => `<span class="chip">${esc(t2.name)}</span>`).join('')}</div>` : ''}`;
}
// Messages to Claude: claude.js's send when it is there, else the same document written here.
async function sendToClaude(text, kind = null) {
  const f = LC()?.send;
  if (typeof f === 'function') return f(text, kind);
  if (!S.db) throw { code: 'unavailable' };
  const now = nowIso(), id = newId('m');
  return retry1(() => S.db.collection('messages').doc(id).set({ text: String(text).slice(0, 500), createdAt: now, kind: kind || null, status: 'new', needsReview: true }, { ifVersion: 0 }));
}
async function askTemplates(btn) {
  if (btn.disabled) return; btn.disabled = true;
  try { await sendToClaude('把现在的计划写进训记模版', 'xunji-templates'); toast('已告诉 Claude，下次处理时准备好给你确认'); render(); }
  catch (e) { btn.disabled = false; toast(errMsg(e), true); }
}

// A report's content: numbers, weekly goals, summary, sections, its actions (struck ones marked).
function reportBody(r) {
  const acts = Array.isArray(r.actions) ? r.actions : [];
  return `${statsHTML(r.stats)}${goalsHTML(r.goals)}${paras(r.summary)}
  ${sectionsHTML(r.sections)}
  ${acts.length ? `<h4>接下来</h4><ol>${acts.map((a, i) => isSkipped(r, i) ? `<li class="skip"><s>${esc(a)}</s> <small>不做</small></li>` : `<li>${esc(a)}</li>`).join('')}</ol>` : ''}`;
}
function reportHTML(r, open) {
  return `<details class="report" data-key="r-${esc(r.id)}"${open ? ' open' : ''}><summary><span class="kind ${esc(r.kind)}">${esc(KINDS[r.kind] || '反馈')}</span><span class="t">${esc(r.title || '')}</span><span class="dt">${esc(md(r.date))}</span></summary>
  <div class="report-b">${reportBody(r)}</div></details>`;
}
// One report in a sheet (the brief's 看全文, the Claude tab's list): its kind and date on top, the title once.
function openReport(r) {
  if (typeof r === 'string') r = S.reports.find(x => x.id === r);
  if (!r || typeof r !== 'object') return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'report', photos: [], removed: [] };
  const when = r.kind === 'weekly' && isDate(r.date) ? `${md(r.date)} 那周` : isDate(r.date) ? mdw(r.date) : '';
  showSheet(`${KINDS[r.kind] || 'Claude 的报告'}${when ? ' · ' + when : ''}`, `<div class="rep-sheet">${r.title ? `<h4 class="rep-t">${esc(r.title)}</h4>` : ''}<div class="report-b">${reportBody(r)}</div>
    ${r.createdAt ? `<p class="meta">${AG} Claude 写于 ${esc(fmtTs(r.createdAt))}</p>` : ''}</div>`, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
// The day's water entries in time order (the sheet's list).
const waterSorted = entries => (entries || []).map((e, i) => ({ e, i })).sort((a, z) => cmp(a.e.t ? dayTime(a.e.t) : '~~', z.e.t ? dayTime(z.e.t) : '~~') || a.i - z.i);
// 喝水 on 今日: one row of buttons (prefs.waterPresets) and 记录明细 (the day's entries, other amounts); today's total is on
// 「今天」, a past day says it in the head.
function waterSection(d) {
  const wd = waterDay(d), target = waterTarget(), sum = waterSum(wd.entries);
  const entries = wd.entries || [];
  const p = waterPending[d]; const unsynced = !!(p && p.ops.length && p.failed);
  if (d < today() && S.loaded.has('water') && !entries.length) {
    return `<section class="sec"><div class="sec-h"><h2>喝水</h2></div><div class="panel line-row"><span>${esc(vt('empty.waterPast', '这天没记喝水'))}</span><button class="link" data-act="water-more">补记</button></div></section>`;
  }
  const ps = waterPresets(), isT = d === today();
  const tmp = S.loaded.has('plan') && !isNum(S.plan?.diet?.water) && !!tempTargets();
  const tot = !isT && S.loaded.has('water') ? `<span class="count num">${fmt(sum)} / ${fmt(target)} ml</span>` : '';
  return `<section class="sec" id="sec-water"><div class="sec-h"><h2>喝水</h2>${tot}${tmp ? '<span class="tag tmp">临时目标</span>' : ''}${unsynced ? '<span class="tag wait" title="网络恢复后自动补上">未同步</span>' : ''}<button type="button" class="link" data-act="water-more">记录明细 ›</button></div>
    <div class="panel water"><div class="water-btns" style="--n:${Math.min(6, ps.length)}">${ps.map(ml => `<button class="btn ghost sm" data-act="water-add" data-ml="${ml}" aria-label="喝了 ${ml} 毫升"><span class="num">+${ml}</span></button>`).join('')}</div></div></section>`;
}

// 30-day weight: daily weigh-ins as faint dots, the 7-day trailing average as the line.
let chartPts = null;
const CW = 340, CH = 160;
function weightSection() {
  const end = today(), start = addDays(end, -29);
  const pts = Object.values(S.body).filter(b => isNum(b.weight) && b.date >= start && b.date <= end).sort((a, z) => a.date.localeCompare(z.date));
  chartPts = null;
  if (pts.length < 3) return S.loaded.has('body') ? '<section class="sec"><div class="sec-h"><h2>近 30 天体重</h2></div><div class="panel empty">记满 3 天体重后，这里会显示趋势。每天早上空腹称最准。</div></section>' : '';
  const rows = pts.map(p => {
    const from = addDays(p.date, -6); const win = pts.filter(q => q.date >= from && q.date <= p.date);
    return { date: p.date, w: p.weight, avg: win.reduce((s, q) => s + q.weight, 0) / win.length };
  });
  const L = 30, R = 46, T = 10, B = 22;
  const vals = rows.flatMap(r => [r.w, r.avg]);
  let lo = Math.floor(Math.min(...vals) - 0.2), hi = Math.ceil(Math.max(...vals) + 0.2);
  const step = Math.max(1, Math.ceil((hi - lo) / 4)); hi = lo + step * Math.max(2, Math.ceil((hi - lo) / step));
  const x = d => L + Math.round((parseD(d) - parseD(start)) / 864e5) / 29 * (CW - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (CH - T - B);
  const ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
  const last = rows[rows.length - 1];
  chartPts = rows.map(r => ({ ...r, x: x(r.date), y: y(r.avg) }));
  const weekAgo = rows.filter(r => r.date <= addDays(last.date, -7)).pop();
  const diff = weekAgo ? last.avg - weekAgo.avg : null;
  const svg = `<svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="近 30 天体重，7 日均值 ${last.avg.toFixed(1)} 公斤">
    ${ticks.map(v => `<line class="gl" x1="${L}" x2="${CW - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tk" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`).join('')}
    <text class="tk" x="${L}" y="${CH - 5}">${esc(md(start))}</text><text class="tk" x="${CW - R}" y="${CH - 5}" text-anchor="end">${esc(md(end))}</text>
    ${rows.map(r => `<circle class="raw" cx="${x(r.date).toFixed(1)}" cy="${y(r.w).toFixed(1)}" r="3.5"/>`).join('')}
    <polyline class="avg" points="${chartPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>
    <line class="xh" id="w-xh" x1="0" x2="0" y1="${T}" y2="${CH - B}" visibility="hidden"/>
    <circle class="end" cx="${x(last.date).toFixed(1)}" cy="${y(last.avg).toFixed(1)}" r="4.5"/>
    <text class="endl" x="${(x(last.date) + 8).toFixed(1)}" y="${(y(last.avg) + 4).toFixed(1)}">${last.avg.toFixed(1)}</text>
    <rect class="hit" x="${L}" y="0" width="${CW - L - R}" height="${CH}"/></svg>`;
  return `<section class="sec"><div class="sec-h"><h2>近 30 天体重</h2></div><div class="panel">
    <div class="wchart">${svg}<div class="wtip" id="w-tip" hidden></div></div>
    <div class="wsum">7 日均值 <b>${last.avg.toFixed(1)}</b> kg${diff != null ? `，比一周前 ${diff > 0 ? '+' : ''}${diff.toFixed(1)} kg` : ''}。灰点是每天的称重，蓝线是 7 日均值。</div>
    <details class="tbl-det" data-key="wtable"><summary>查看数据</summary><div style="overflow-x:auto"><table><tr><th>日期</th><th>体重 kg</th><th>7 日均值</th></tr>${rows.slice().reverse().map(r => `<tr><td>${esc(md(r.date))}</td><td>${r.w.toFixed(1)}</td><td>${r.avg.toFixed(1)}</td></tr>`).join('')}</table></div></details>
  </div></section>`;
}
function chartHover(e) {
  const svg = $('.wchart svg'), tip = $('#w-tip'), xh = $('#w-xh');
  if (!svg || !tip || !chartPts) return;
  const r = svg.getBoundingClientRect(), wr = svg.parentElement.getBoundingClientRect();
  const sx = (e.clientX - r.left) / r.width * CW;
  let p = chartPts[0]; for (const q of chartPts) if (Math.abs(q.x - sx) < Math.abs(p.x - sx)) p = q;
  xh.setAttribute('x1', p.x); xh.setAttribute('x2', p.x); xh.setAttribute('visibility', 'visible');
  tip.innerHTML = `${esc(md(p.date))} · 当天 ${p.w.toFixed(1)} kg<br>7 日均值 ${p.avg.toFixed(1)} kg`;
  tip.hidden = false;
  tip.style.left = `${Math.min(Math.max(r.left - wr.left + p.x / CW * r.width, 72), wr.width - 72)}px`;
}
function chartLeave() { const tip = $('#w-tip'); if (tip) tip.hidden = true; $('#w-xh')?.setAttribute('visibility', 'hidden'); }
document.addEventListener('pointermove', e => { if (e.target.closest?.('.wchart svg')) chartHover(e); });
document.addEventListener('pointerdown', e => { if (e.target.closest?.('.wchart svg')) chartHover(e); else chartLeave(); });
// A finger lifting fires pointerout at once: a tapped tooltip stays until the next tap elsewhere.
document.addEventListener('pointerout', e => { if (e.pointerType !== 'touch' && e.target.closest?.('.wchart svg') && !e.relatedTarget?.closest?.('.wchart svg')) chartLeave(); });

// 14 days of intake against each day's own target (training or rest day, activity bonus included): kcal as thin bars
// with the target as a tick, protein as dots with their target on a second small chart (no second axis). Days with
// fewer than 2 meals logged (one-tap items aside) or with meals still waiting for Claude are hatched: 记录不全.
let ichart = null;
const IW = 340, IL = 34, IR = 6, K0 = 20, K1 = 116, P0 = 146, P1 = 196, IH = 216;
function intakeRows() {
  const end = today(), rows = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(end, -i), it = intake(d), tg = targetsFor(d);
    rows.push({ d, kcal: it.sum.kcal, protein: it.sum.protein, tk: isNum(tg?.kcal) ? tg.kcal : null, tp: isNum(tg?.protein) ? tg.protein : null,
      bonus: tg?.bonus || 0, rest: dayKind(d) === 'rest', logged: it.logged, waiting: it.waiting, partial: it.logged < 2 || it.waiting > 0,
      any: it.meals.length > 0 || it.dr.kcal > 0 });
  }
  return rows;
}
function niceTop(v, steps) { const st = steps.find(s => v / s <= 3) || steps[steps.length - 1]; return { top: Math.max(st, Math.ceil(v / st) * st), step: st }; }
const kTick = v => v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v);
function barPath(x, y0, y1, w) {  // a column from the baseline y0 up to y1, square at the base, 4px rounded at the top
  const h = y0 - y1; if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x.toFixed(1)},${y0}V${(y1 + r).toFixed(1)}Q${x.toFixed(1)},${y1.toFixed(1)} ${(x + r).toFixed(1)},${y1.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y1.toFixed(1)} ${(x + w).toFixed(1)},${(y1 + r).toFixed(1)}V${y0}Z`;
}
function intakeSection() {
  ichart = null;
  if (!['meals', 'plan', 'water', 'workouts', 'days'].every(k => S.loaded.has(k))) return '';
  const rows = intakeRows();
  const head = '<div class="sec-h"><h2>近 14 天摄入</h2></div>';
  if (!rows.some(r => r.any)) return `<section class="sec">${head}<div class="panel empty">记几天饮食后，这里会显示每天吃了多少、和目标差多少。</div></section>`;
  const bw = (IW - IL - IR) / 14, cx = i => IL + bw * (i + 0.5);
  const K = niceTop(Math.max(...rows.flatMap(r => [r.kcal, r.tk || 0])) * 1.05 || 1, [500, 1000, 2000]);
  const P = niceTop(Math.max(...rows.flatMap(r => [r.protein, r.tp || 0])) * 1.05 || 1, [50, 100, 200]);
  const yk = v => K1 - v / K.top * (K1 - K0), yp = v => P1 - v / P.top * (P1 - P0);
  const grid = (top, step, y, x0) => { let s = ''; for (let v = 0; v <= top; v += step) s += `<line class="gl" x1="${x0}" x2="${IW - IR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tk" x="${x0 - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${kTick(v)}</text>`; return s; };
  const tick = (x, y) => `<line class="tgt" x1="${(x - 7).toFixed(1)}" x2="${(x + 7).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  const marks = rows.map((r, i) => {
    const x = cx(i), cls = r.partial ? ' part' : '';
    const bar = barPath(x - 4, K1, yk(r.kcal), 8);
    return `${bar ? (r.partial ? `<path class="kbp" fill="url(#i-hatch)" d="${bar}"/>` : `<path class="kb" d="${bar}"/>`) : ''}${r.tk != null ? tick(x, yk(r.tk)) : ''}
      ${r.tp != null ? tick(x, yp(r.tp)) : ''}${r.any ? `<circle class="pd${cls}" cx="${x.toFixed(1)}" cy="${yp(r.protein).toFixed(1)}" r="4"/>` : ''}
      <text class="tk${r.d === today() ? ' now' : ''}" x="${x.toFixed(1)}" y="${IH - 4}" text-anchor="middle">${parseD(r.d).getDate()}</text>`;
  }).join('');
  ichart = { rows, bw };
  const withT = rows.filter(r => r.tp != null);
  const hit = rows.filter(r => r.tp != null && r.protein >= 0.9 * r.tp).length;
  const sum = withT.length ? `蛋白质达标 <b>${hit}</b>/14 天（到目标的 90% 就算）` : '生成计划后，这里会对比每天的目标。';
  const svg = `<svg viewBox="0 0 ${IW} ${IH}" role="img" aria-label="近 14 天摄入。${withT.length ? `蛋白质达标 ${hit} 天，共 14 天` : ''}">
    <defs><pattern id="i-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="hb" width="4" height="4"/><line class="hs" x1="1" y1="0" x2="1" y2="4"/></pattern></defs>
    <rect class="band" id="i-hl" x="0" y="${K0 - 6}" width="${bw.toFixed(1)}" height="${IH - K0 + 6}" rx="4" visibility="hidden"/>
    <text class="plbl" x="${IL}" y="10">热量 kcal</text>${grid(K.top, K.step, yk, IL)}
    <text class="plbl" x="${IL}" y="${P0 - 8}">蛋白质 g</text>${grid(P.top, P.step, yp, IL)}
    ${marks}
    <rect class="hit" x="${IL}" y="0" width="${IW - IL - IR}" height="${IH}"/></svg>`;
  const tbl = rows.slice().reverse().map(r => `<tr><td>${esc(md(r.d))}</td><td>${fmt(r.kcal)}</td><td>${r.tk != null ? fmt(r.tk) : '—'}</td><td>${fmt(r.protein)}</td><td>${r.tp != null ? fmt(r.tp) : '—'}</td><td>${r.partial ? '记录不全' : ''}</td></tr>`).join('');
  return `<section class="sec">${head}<div class="panel">
    <div class="ichart">${svg}<div class="wtip" id="i-tip" hidden></div></div>
    <div class="ilegend"><span><i class="sw-k"></i>热量</span><span><i class="sw-p"></i>蛋白质</span><span><i class="sw-t"></i>当天目标</span><span><i class="sw-h"></i>记录不全</span></div>
    <div class="wsum">${sum}</div>
    <details class="tbl-det" data-key="itable"><summary>看表格</summary><div style="overflow-x:auto"><table class="itbl"><tr><th>日期</th><th>热量</th><th>目标</th><th>蛋白质 g</th><th>目标</th><th></th></tr>${tbl}</table></div></details>
  </div></section>`;
}
function ichartHover(e) {
  const svg = $('.ichart svg'), tip = $('#i-tip'), hl = $('#i-hl');
  if (!svg || !tip || !hl || !ichart) return;
  const r = svg.getBoundingClientRect(), wr = svg.parentElement.getBoundingClientRect();
  const sx = (e.clientX - r.left) / r.width * IW;
  const i = Math.max(0, Math.min(13, Math.floor((sx - IL) / ichart.bw)));
  const x = ichart.rows[i];
  hl.setAttribute('x', (IL + ichart.bw * i).toFixed(1)); hl.setAttribute('visibility', 'visible');
  const why = [x.logged < 2 ? `只记了 ${x.logged} 餐` : '', x.waiting ? `${x.waiting} 餐待分析` : ''].filter(Boolean).join('，');
  tip.innerHTML = `${esc(fmtDay(x.d))} · ${x.rest ? '休息日' : '训练日'}${x.bonus ? `（活动 +${fmt(x.bonus)}）` : ''}<br>热量 ${fmt(x.kcal)}${x.tk != null ? ` / ${fmt(x.tk)}` : ''} kcal<br>蛋白质 ${fmt(x.protein)}${x.tp != null ? ` / ${fmt(x.tp)}` : ''} g${why ? `<br>记录不全：${esc(why)}` : ''}`;
  tip.hidden = false;
  const half = tip.offsetWidth / 2 + 4;  // keep the whole tooltip inside the card
  tip.style.left = `${Math.min(Math.max(r.left - wr.left + (IL + ichart.bw * (i + 0.5)) / IW * r.width, half), wr.width - half)}px`;
}
function ichartLeave() { const tip = $('#i-tip'); if (tip) tip.hidden = true; $('#i-hl')?.setAttribute('visibility', 'hidden'); }
document.addEventListener('pointermove', e => { if (e.target.closest?.('.ichart svg')) ichartHover(e); });
document.addEventListener('pointerdown', e => { if (e.target.closest?.('.ichart svg')) ichartHover(e); else ichartLeave(); });
document.addEventListener('pointerout', e => { if (e.pointerType !== 'touch' && e.target.closest?.('.ichart svg') && !e.relatedTarget?.closest?.('.ichart svg')) ichartLeave(); });

function vFeedback() {
  const charts = weightSection() + intakeSection();
  if (!S.loaded.has('reports')) return `${charts}${statusLine()}<div class="panel">${loading}</div>`;
  const list = S.reports;
  if (!list.length) return `${charts}${statusLine()}<div class="panel empty">Claude 处理记录后，日报、周报和计划调整说明会出现在这里。每餐和每次训练的单独点评在对应记录里。</div>`;
  return charts + statusLine() + list.map((r, i) => reportHTML(r, i < 2)).join('');
}

/* 我的 (v9; the last tab since 10/21): in groups — one card each, one row a thing, a row opens its sheet:
   我 (name, 基础信息, 账号) · 记录方式 (Apple 健康同步, 训记, 训练记在哪) · Claude (claude.js's meHTML) · 偏好设置 (the
   sheet, and 进阶显示 switched in place) · 通知 (as before, in the page) · 加到主屏幕 · 更多 (用户管理 for admins,
   新人引导, 隐私, 退出, 注销). The explanations live in the sheets. */
const meRow = (act, title, sub = '', o = {}) => `<button type="button" class="me-row${o.cls ? ' ' + o.cls : ''}" data-act="${act}"${o.attrs || ''}><span class="me-rt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${o.tag || ''}${CHEV_R}</button>`;
const meGroup = (h, body, id = '') => body ? `<section class="sec me-sec"${id ? ` id="${id}"` : ''}><div class="sec-h"><h2>${h}</h2></div><div class="panel me-g">${body}</div></section>` : '';
// 偏好设置 in a line: what differs from the defaults first.
function prefsSum() {
  const rt = restPref(), th = THEMES.find(([v]) => v === prefTheme())[1], sty = STYLES.find(([v]) => v === prefStyle())[1];
  const off = [!prefOn('feelCard') && '晨间状态', !prefOn('weighCard') && '称体重提示', !prefOn('staleHealth') && '同步过时提示', !prefOn('habits') && '五件套'].filter(Boolean);
  return [`一天从 ${dayStart} 点算起`, `外观${th}`, `风格${sty}`, rt.on ? `组间计时 ${rt.sec} 秒` : '组间计时关', off.length ? `关了${off.join('、')}` : ''].filter(Boolean).join(' · ');
}
function healthStatus() {
  const lastSync = Object.values(S.sleep).filter(x => x.source === 'apple-health').sort((a, z) => (z.syncedAt || '').localeCompare(a.syncedAt || ''))[0];
  const lastHealth = Object.values(S.health).filter(x => x.syncedAt).sort((a, z) => String(z.syncedAt).localeCompare(String(a.syncedAt)))[0];
  return [lastSync?.syncedAt, lastHealth?.syncedAt].filter(Boolean).sort().pop() || '';
}
function vMe() {
  const p = S.profile, me = S.me; if (!me) return `<div class="panel" style="margin-top:6px">${loading}</div>`;
  const lbl = (arr, v) => (arr.find(x => x[0] === v) || [])[1] || '';
  // 我
  const head = `<div class="me-head"><span class="avatar big" aria-hidden="true">${avatarTxt()}</span><div class="me-n"><b>${esc(me.name)}</b><span class="meta">@${esc(me.username)} · ${me.role === 'admin' ? '管理员' : '成员'}</span></div></div>`;
  const basics = !S.loaded.has('profile') ? '<p class="me-wait">正在读取…</p>'
    : p ? meRow('profile', '基础信息', esc([lbl(GOALS, p.goal), isNum(p.height) ? `${p.height} cm` : '', isNum(p.weight) ? `${p.weight} kg` : '', isNum(p.days) ? `每周 ${p.days} 天` : '', lbl(LEVELS, p.level)].filter(Boolean).join(' · ')),
      { tag: p.needsReview ? `<span class="tag wait">${S.plan ? '等 Claude 调整计划' : '等 Claude 做计划'}</span>` : '' })
    : meRow('profile', '填写基础信息', 'Claude 靠它做训练和饮食计划', { cls: 'hl' });
  const acct = meRow('me-sec', '账号', '改名字、改密码、导出数据', { attrs: ' data-k="acct"' });
  // Claude doesn't look at the photos of a new account until the person says 「我知道了」 in the guide
  const nudge = S.loaded.has('prefs') && !prefs().consentAt && !legacyAccount() ? `<section class="sec"><div class="panel panel-pad onb-nudge"><p><b>Claude 还没开始看你的照片。</b>在新手引导第一步点「我知道了」，它才会看。</p><div class="btns"><button type="button" class="btn primary sm" data-act="onb-open">打开新手引导</button></div></div></section>` : '';
  // 记录方式
  const hs = healthStatus();
  const health = meRow('me-sec', 'Apple 健康同步', hs ? `在同步 · 上次 ${esc(fmtRel(hs))}` : '还没设置：睡眠、体重、步数、心率自动过来', { attrs: ' data-k="health"', tag: hs ? '<span class="dot ok" aria-hidden="true"></span>' : '' });
  const xjLast = Math.max(Date.parse(S.xj?.webSync?.at || '') || 0, Date.parse(S.xunji?.lastSyncAt || '') || 0);
  const xj = xjUser() || trainIn() !== 'app' ? meRow('me-sec', '训记', trainIn() === 'app' ? '已停用' : xjKey() ? `存了训练 key${xjLast ? ` · 上次同步 ${esc(fmtRel(new Date(xjLast).toISOString()))}` : ''}` : '填 key 后能从训记同步', { attrs: ' data-k="xj"' }) : '';
  const tin = meRow('train-in-open', '训练记在哪', esc(TRAIN_IN.find(([v]) => v === trainIn())[1]));
  // Claude (claude.js): its rows, or nothing while it isn't there
  const cm = lc('meHTML');
  const claude = typeof cm === 'string' && cm.trim() ? (/^\s*<section/.test(cm) ? cm : `<section class="sec me-sec" id="sec-me-claude"><div class="sec-h"><h2>Claude</h2></div>${cm}</section>`) : '';
  // 偏好设置: the sheet, and 进阶显示 switched here
  const adv = `<label class="tgl me-tgl"><span>进阶显示<small>RPE、热身组和递减组、训练量、静息心率和 HRV</small></span><input type="checkbox" class="sw" data-pref="advanced"${advOn() ? ' checked' : ''}></label>`;
  const pref = meRow('prefs', '偏好设置', esc(prefsSum())) + adv;
  // 加到主屏幕: not from the home-screen app itself
  const a2 = standalone() ? '' : meGroup('加到主屏幕', meRow('a2hs', '加到主屏幕', '全屏打开，还能收通知'));
  const more = [me.role === 'admin' ? meRow('me-sec', '用户管理', S.users ? `${S.users.length} 个账号 · 邀请朋友注册` : '账号和邀请', { attrs: ' data-k="users"' }) : '',
    meRow('onb-open', '新人引导', '三步：数据怎么处理、基础信息、从今天开始'),
    meRow('privacy', '你的数据怎么处理', '存在哪、谁能看到、导出和注销'),
    meRow('logout', '退出登录'),
    meRow('acct-del', '注销账号', '删掉这个账号和全部数据', { cls: 'danger' })].join('');
  return `${meGroup('我', head + basics + acct)}${nudge}
    ${meGroup('记录方式', health + xj + tin)}
    ${claude}
    ${meGroup('偏好设置', pref)}
    ${pushSection()}
    ${a2}
    ${meGroup('更多', more)}`;
}
/* The sheets behind the rows (S.sheet.type 'me-sec'). Their content follows the page's state as it changes (a token
   made, the users loaded, a key saved): draw() rewrites the body when its HTML changed, keeping the open details. */
const ME_SECS = {
  health: ['Apple 健康同步', () => healthSyncBody()],
  xj: ['训记', () => xunjiBody()],
  users: ['用户管理', () => usersBody()],
  acct: ['账号', () => acctBody()],
  xjplan: ['训记', () => xjPlanBody()],
};
function openMeSec(k) {
  const s = ME_SECS[k]; if (!s || !S.me) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  if (k === 'users') loadUsers();
  if (k === 'health') loadTokens();
  if (k === 'xj' || k === 'xjplan') loadXj();
  const h = s[1]();
  S.sheet = { type: 'me-sec', sec: k, last: h, photos: [], removed: [] };
  showSheet(s[0], `<div class="me-sec-b" id="me-sec">${h}</div>`, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
function drawMeSec() {
  const sh = S.sheet, el = $('#me-sec', sheetEl); if (sh?.type !== 'me-sec' || !el) return;
  const h = ME_SECS[sh.sec]?.[1](); if (h == null || h === sh.last) return;
  const st = new Map([...el.querySelectorAll('details[data-key]')].map(x => [x.dataset.key, x.open]));
  el.innerHTML = h; sh.last = h;
  el.querySelectorAll('details[data-key]').forEach(x => { if (st.has(x.dataset.key)) x.open = st.get(x.dataset.key); });
}
function acctBody() {
  const me = S.me; if (!me) return '';
  return `<div class="panel acts">
    <button type="button" class="act-row" data-act="acct-name"><b>改名字</b><small>现在叫「${esc(me.name)}」</small></button>
    <button type="button" class="act-row" data-act="acct-pw"><b>改密码</b></button>
    ${me.sessions > 1 ? `<button type="button" class="act-row" data-act="logout-others"><b>退出其他 ${esc(me.sessions - 1)} 台设备</b><small>这台手机保持登录</small></button>` : ''}
    <button type="button" class="act-row" data-act="export"><b>导出我的数据</b><small>所有记录和计划，一个 JSON 文件</small></button></div>`;
}
function usersBody() {
  const me = S.me; if (me?.role !== 'admin') return '';
  return `<div class="lbl-row"><span class="lbl">账号${S.users ? ` · ${S.users.length}` : ''}</span><button type="button" class="link" data-act="user-new">+ 新建账号</button></div>
    <div class="panel">${usersHTML()}</div><p class="hint" style="margin:0">网页上每个人只看得到自己的记录。Claude 处理时会分别处理每个人。</p>${invitesHTML()}
    <details class="steps-det admin-det" data-key="loop-admin"><summary>怎么让 Claude 处理</summary><p class="hint">在运行 Claude Code 的电脑上打开这个项目目录（就是你克隆这个仓库的目录），运行 <code>/fitness-review</code>；做计划用 <code>/fitness-plan</code>。定时处理也在那台电脑上跑。</p></details>`;
}
// 训练记在哪 (profile/prefs.trainIn): a tap is kept.
function openTrainIn() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'info', photos: [], removed: [] };
  const cur = trainIn(), say = { app: '在这里逐组打勾，组间自动计时；训记的同步和模版都收起来', both: '这里为主，训记照常同步、模版照常写', xunji: '练完从训记同步过来，开练收进「⋯」' };
  showSheet('训练记在哪', `<div class="panel acts">${TRAIN_IN.map(([v, l]) => `<button type="button" class="act-row ds-row" data-act="train-in" data-v="${v}" data-close="1" aria-pressed="${v === cur}"><span class="ds-t"><b>${l}</b><small>${say[v]}</small></span>${v === cur ? '<span class="ds-on" aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div>
    <p class="hint" style="margin:0">以前导入的训练都留着，换了也照常显示。</p>`, '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
// Apple 健康同步 (the 「我的」 sheet): once data comes in, one status line and 重新设置 (#37); the set-up steps otherwise.
function healthSyncBody() {
  const me = S.me; if (!me) return '';
  const lastSync = Object.values(S.sleep).filter(x => x.source === 'apple-health').sort((a, z) => (z.syncedAt || '').localeCompare(a.syncedAt || ''))[0];
  const lastHealth = Object.values(S.health).filter(x => x.syncedAt).sort((a, z) => String(z.syncedAt).localeCompare(String(a.syncedAt)))[0];
  const last = [lastSync?.syncedAt, lastHealth?.syncedAt].filter(Boolean).sort().pop();
  const status = last ? `最近一次 ${esc(fmtRel(last))}` : '';
  if (last && !S.healthSetup && !S.newToken) {
    return `<div class="panel line-row"><span><span class="dot ok" aria-hidden="true"></span>在同步 · ${status}</span><button type="button" class="link" data-act="health-setup">重新设置</button></div>
      <p class="hint hsync-new">快捷指令现在也会传最近两天的心率和活动能量明细，只用来算每次训练的心率和消耗。<b>旧的快捷指令没有这一项：在「快捷指令」里把「同步健康」删掉，再点「重新设置」生成令牌、重新下载。</b></p>`;
  }
  // One button makes the upload token and copies it (#v5); then the next step is downloading the Shortcut, which works
  // in Safari only: from the home-screen icon the address goes to the clipboard first, the token is made over there.
  const so = standalone(), tok = S.newToken, line = tok ? `Bearer ${tok}` : '';
  const dl = '<a class="btn primary sm" href="/shortcut" download target="_blank" rel="noopener">下载快捷指令</a>';
  const soNote = `<div class="standalone-note"><p>你现在是从主屏幕图标打开的：快捷指令在这里下载不了，跳过去也回不来。先复制网址，到 Safari 里打开、登录，在那里点「生成并复制同步令牌」和「下载快捷指令」。</p><button type="button" class="btn primary sm" data-act="copy-url" data-v="${esc(location.origin + '/#me')}">复制网址</button></div>`;
  const made = tok ? `<div class="pwbox tok-new"><div class="lbl">${S.tokenCopied ? '同步令牌已复制' : '同步令牌（只显示这一次）'}</div><div class="pw">${esc(line)}</div>
      <p class="hint" style="margin:0">${S.tokenCopied ? '已经在剪贴板里了，第 4 步粘贴到快捷指令里。' : '没能自动复制：点下面的「复制」。'}这个令牌只能上传健康数据，读不到你的任何记录；只显示这一次，弄丢了就撤销，再生成一个。</p>
      <button type="button" class="btn ghost sm" data-act="copy" data-v="${esc(line)}">${S.tokenCopied ? '再复制一次' : '复制'}</button></div>
    ${so ? '<p class="meta">下一步：到 Safari 里下载快捷指令。先别复制别的东西，令牌还在剪贴板里。</p>' : `<div class="tok-next"><b>下一步：下载快捷指令</b><span class="meta">Safari 问要不要下载，点「下载」，再点地址栏里的下载图标打开它。</span>${dl}</div>`}`
    : `<div class="btns"><button type="button" class="btn ${so ? 'ghost' : 'primary'} sm" data-act="token-go"${S.tokenBusy ? ' disabled' : ''}>${S.tokenBusy ? '正在生成…' : '生成并复制同步令牌'}</button>${so ? '' : dl.replace('btn primary', 'btn ghost')}</div>`;
  return `${last ? '<div class="lbl-row"><span class="meta">重新设置</span><button type="button" class="link" data-act="health-setup">收起</button></div>' : ''}<div class="panel panel-pad sync">
    <p>用 iPhone 自带的「快捷指令」，每天自动把「健康」里的数据传过来：Apple Watch 记录的睡眠、体重和体脂率（用智能体重秤才有）、步数、活动消耗、静息心率和 HRV。活动比平时多的那天，摄入目标会自动加一点；静息心率和 HRV 用来判断恢复得好不好。</p>
    <p>练的时候在 Apple Watch 上开一个「传统力量训练」：快捷指令还会传最近两天的心率和活动能量明细，只用来算每次训练的平均、最高心率和消耗，不留原始数据。</p>
    <p class="meta">${last ? status : '还没有同步过'}</p>
    ${tokensHTML()}
    ${so ? soNote : ''}
    ${made}
    <details class="steps-det" data-key="hs1"${last ? '' : ' open'}><summary>① 添加快捷指令，粘贴令牌，手动跑一次</summary><ol class="steps">
      <li>点「生成并复制同步令牌」：令牌生成后自动复制好（「Bearer …」那一整行）。</li>
      <li>${so ? '在 iPhone 的「Safari」里打开这个页面（从主屏幕图标打开的下载不了），' : ''}点「下载快捷指令」。Safari 问要不要下载，点「下载」，再点地址栏里的下载图标打开它（或者在「文件」App 的「下载」里点它）。</li>
      <li>「快捷指令」App 打开后点「添加快捷指令」。</li>
      <li>在「快捷指令」里长按「同步健康」→「编辑」。最上面有个文本框写着「把这里换成同步令牌」：点进去，全选删掉，粘贴第 1 步复制的令牌，点「完成」。</li>
      <li>在「快捷指令」里运行一次「同步健康」。第一次会问能不能读取健康数据、能不能连接这个网址，<b>都选「总是允许」</b>（选「允许一次」的话，自动跑时弹不出来就失败）。通知里列出今天的数据就成功了。</li>
    </ol>
    <p class="hint" style="margin:0">导入后某一组的「类型」是空的，点一下重新选上就行（睡眠、步数、活动能量、静息心率、心率变异性、体重、体脂率、心率、活动能量）。没有智能体重秤的话，体重和体脂率那两组没有数据，不影响；没戴 Apple Watch 练的话，最后的心率和活动能量明细也没有数据，不影响。</p></details>
    <details class="steps-det" data-key="hs2"><summary>② 让它每天自动跑</summary>
    <p><b>iOS 27</b>：在「快捷指令」里长按「同步健康」→「编辑」→「自动化」→ 加「特定时间」、每天，一个时间加一条。</p>
    <p><b>iOS 26 及以前</b>（8 步）：「快捷指令」App → 底部「自动化」→ 右上「+」→「特定时间」→ 选时间、「每天」→ 选「立即运行」（不是「运行前确认」），可以关掉「运行时通知」→「下一步」→ 选「同步健康」→「完成」。一个时间建一个。</p>
    <p>建议的时间：起床后一个（比如 08:00，带上昨晚的睡眠），再在 Claude 每天看记录（${runTimes().join('、')}）之前各一个：${syncTimesTxt()}。</p>
    <p class="hint" style="margin:0">手机锁着时读不到健康数据，那次会失败，下次自动补上；练完点「同步手表心率」最稳。</p></details>
    <details class="steps-det" data-key="hs3"><summary>③ 练完点「同步手表心率」</summary>
    <p>在薄肌研究所里点「完成」保存后，提示旁有「同步手表心率」，点一下就打开快捷指令同步一次，手表记的心率和消耗会对到这次训练上。训练详情里、「今日 → 身体」的健康数据下面也有这个按钮。</p></details>
    <details class="steps-det" data-key="steps"><summary>下载用不了？自己动手搭（大约 10 分钟）</summary>${shortcutSteps(`${location.origin}/api/ingest/health`)}</details>
    <p class="hint" style="margin:0">不想设置的话，也可以在「今日 → 身体」里上传睡眠截图，Claude 处理时会读出来。</p>
  </div>`;
}
// 训记: the two keys the server can keep (never shown again): the training key reads sessions for 「从训记同步」, the
// template key writes the plan into 训记's 「Agent 模版」 folder once the person agrees. Sync only with a training key
// (#35); the 训记 title → plan day list (改: the same sheet as on the plan page).
function xunjiBody() {
  const x = S.xj, lx = S.xunji;
  if (!S.me) return '';
  // 只用薄肌研究所: one line; the sessions imported before stay where they are
  if (trainIn() === 'app') {
    if (!xjUser()) return '';
    const keys = !!(x && !x.missing && (x.hasKey || x.hasTemplateKey));
    return `<div class="panel panel-pad xj-off"><p>训记已停用，以前导入的训练都还在。</p>
      <div class="btns"><button type="button" class="btn ghost sm" data-act="train-in" data-v="both">重新用训记</button>${keys ? '<button type="button" class="btn ghost sm danger" data-act="xj-keys-del">删除保存的训记 key</button>' : ''}</div></div>`;
  }
  if (!x || x.missing) {
    return lx?.linked ? `<div class="panel panel-pad"><p class="meta">已连接训记：训练记录由 Claude 处理时同步过来${lx.lastSyncAt ? `，上次同步 ${esc(fmtTs(lx.lastSyncAt))}` : ''}，已导入 ${esc(lx.imported || 0)} 次训练。</p></div>` : '';
  }
  const ws = x.webSync || lx?.webSync;
  const res = !ws ? '还没从网页同步过' : `上次网页同步 ${fmtRel(ws.at)}：${ws.ok ? `新 ${ws.new || 0} 条、更新 ${ws.updated || 0} 条` : `没成功${ws.error ? `（${ws.error}）` : ''}`}`;
  const tplOk = 'hasTemplateKey' in x;
  const keyRow = (kind, name, what, has, at) => `<div class="keyrow"><div class="kr-t"><b>${name}</b><span class="meta">${what}</span><span class="kr-st${has ? ' ok' : ''}">${has ? `已保存 · ${esc(fmtTs(at))}` : tplOk || kind === 'train' ? '还没保存' : '服务器还不支持'}</span></div>
    <div class="kr-b">${tplOk || kind === 'train' ? `<button type="button" class="btn ghost sm" data-act="xj-key" data-kind="${kind}">${has ? '换一个' : '填写'}</button>` : ''}${has ? `<button type="button" class="btn ghost sm danger" data-act="xj-key-del" data-kind="${kind}">删除</button>` : ''}</div></div>`;
  const titles = xjTitles().filter(t => t.id || t.recent);
  const dm = titles.length ? `<div class="sub-h">训记里的训练对应计划里的哪天</div><div class="dm-list">${titles.slice(0, 6).map(t => {
    const pd = planDays().find(d => d.id === t.id);
    return `<button type="button" class="dm-row" data-act="daymap" data-t="${esc(t.title)}"><span class="dm-t">${esc(t.title)}</span><span class="dm-v">${pd ? `<span class="dayid sm">${esc(dayShort(pd))}</span>${esc(pd.name || '')}` : t.id ? esc(t.id) : '<span class="meta">不对应</span>'}</span><span class="link-t">改</span></button>`;
  }).join('')}${titles.length > 6 ? `<button type="button" class="dm-row dm-all-btn" data-act="daymap-all"><span class="dm-t">全部 ${titles.length} 个一起改</span><span></span>${CHEV_R}</button>` : ''}</div>` : '';
  return `<div class="panel panel-pad sync">
    <p>训练记在训记里的话，练完点「从训记同步」就能导入最近三天；Claude 准备好的训练计划，你点同意后写进训记的「Agent 模版」。</p>
    <div class="keys">${keyRow('train', '训练 key', '只读，用来同步训练', x.hasKey, x.keyUpdatedAt)}${keyRow('template', '模版 key', '只能改训记里的「Agent 模版」文件夹，用来把计划写进训记', !!x.hasTemplateKey, x.templateKeyUpdatedAt)}</div>
    ${x.hasKey ? `<div class="kr-sync"><button type="button" class="btn primary sm" data-act="xj-sync"${S.xjBusy ? ' disabled' : ''}>${S.xjBusy ? '同步中…' : '从训记同步'}</button><span class="meta${ws && !ws.ok ? ' warn' : ''}">${esc(res)}</span></div>` : ''}
    ${lx?.linked ? `<p class="meta">已导入 ${esc(lx.imported || 0)} 次训练${lx.lastSyncAt ? `，Claude 上次同步 ${esc(fmtTs(lx.lastSyncAt))}` : ''}</p>` : ''}
    ${dm}
    <p class="hint" style="margin:0">两种 key 都在训记 App 里申请。存在服务器上，页面上不会再显示；训练 key 不会往训记里写东西，模版 key 只在你同意 Claude 的提案后用一次。</p>
  </div>`;
}
function tokensHTML() {
  return (S.tokens || []).map(t => `<div class="tok"><span><b>${esc(t.name)}</b> · 创建于 ${esc(fmtTs(t.createdAt))} · ${t.lastUsed ? '最近使用 ' + esc(fmtTs(t.lastUsed)) : '还没用过'}</span><button class="link" data-act="token-del" data-id="${esc(t.id)}">撤销</button></div>`).join('');
}
function shortcutSteps(url) {
  const types = [['sleep', '睡眠分析', '最近 1 天', '还要再加一个「合并文本」放「结束日期」（同样设成 ISO 8601）'],
    ['steps', '步数', '最近 3 天', '「分组方式」选「天」，不然手表和手机的步数会重复算'], ['active', '活动能量', '最近 3 天', '「分组方式」选「天」'],
    ['rhr', '静息心率', '最近 3 天', ''], ['hrv', '心率变异性', '最近 3 天', ''], ['weight', '体重', '最近 3 天', '没有智能体重秤可以不做这一组'],
    ['bodyfat', '体脂率', '最近 3 天', '体脂秤才有，没有可以不做这一组'],
    ['hr', '心率', '最近 2 天', '不分组，每个样本一行：服务器拿它算「训练中」记的每次训练的平均和最高心率'],
    ['kcals', '活动能量', '最近 2 天', '这一组不分组（和上面按天分组的那组不一样），每个样本一行：算每次训练的消耗']];
  return `<ol class="steps">
    <li>点上面的「生成同步令牌」，复制「Bearer …」那一整行。</li>
    <li>打开 iPhone 的「快捷指令」App，点右上角 +，新建一个快捷指令，命名为「同步健康」。</li>
    <li>先做睡眠这一组，4 个操作：
      <ol>
        <li>「查找健康样本」：类型选「睡眠分析」；添加过滤条件「开始日期」「在最近」「1 天」。</li>
        <li>「合并文本」：输入选上一步的「健康样本」，点它选属性「值」；分隔符选「换行符」。</li>
        <li>再一个「合并文本」：输入还是「健康样本」，属性选「开始日期」，在变量设置里把「日期格式」设为「ISO 8601」；分隔符「换行符」。睡眠这一组${esc(types[0][3])}。</li>
        <li>「获取 URL 内容」：网址 <code>${esc(url)}</code>；方法 POST；头部 <code>Authorization</code> 填第 1 步复制的那一行；请求体选「JSON」，加文本字段：<code>metric</code> 填 <code>sleep</code>，<code>v</code> 选第一个「合并文本」，<code>s</code> 选第二个，<code>e</code> 选第三个。</li>
      </ol></li>
    <li>其他数据每样一组，做法一样（没有「结束日期」和 <code>e</code>）。可以长按复制上一组，再改「类型」和 <code>metric</code>，并把 <code>v</code>、<code>s</code> 重新选成这一组里的两个「合并文本」：
      <ul>${types.slice(1).map(([m, t, r, n]) => `<li>类型「${esc(t)}」，「${esc(r)}」，<code>metric</code> 填 <code>${m}</code>${n ? `；${esc(n)}` : ''}</li>`).join('')}</ul></li>
    <li>最后添加「获取词典值」，键填 <code>message</code>，输入选最后一个「获取 URL 内容」；再添加「显示通知」，内容选「词典值」。</li>
    <li>点 ▶ 运行一次。第一次会问能不能读取健康数据、能不能连接这个网址，都选允许。通知里会列出今天同步到的全部数据，哪一样没有就是那一组没设好。</li>
    <li>让它每天自动跑：「自动化」→ 新建个人自动化 →「特定时间」→ 建几个：起床后一个（带上昨晚的睡眠），Claude 每天看记录之前各一个（${syncTimesTxt()}）→ 运行「同步健康」→ 选「立即运行」。</li>
  </ol>
  <div class="copyline"><button type="button" class="btn ghost sm" data-act="copy" data-v="${esc(url)}">复制网址</button></div>`;
}
async function loadTokens() {
  try { S.tokens = (await req('GET', '/api/me/tokens')).tokens; } catch (e) {}
  render();
}
async function createToken() {
  try { S.newToken = (await req('POST', '/api/me/tokens', { name: 'iPhone 快捷指令' })).token; loadTokens(); }
  catch (e) { toast(errMsg(e), true); }
}
function usersHTML() {
  if (!S.users) return loading;
  return `<div class="rows">${S.users.map(u => `<button class="row urow" data-act="user" data-id="${esc(u.id)}"><span class="avatar">${esc((u.name || u.username).slice(0, 1))}</span>
    <span class="row-main"><span class="row-t">${esc(u.name)}<span class="tm">@${esc(u.username)}</span>${u.role === 'admin' ? '<span class="tag ok">管理员</span>' : ''}</span>
    <span class="row-s">${esc(u.records)} 条记录${u.pending ? ` · ${esc(u.pending)} 条待处理` : ''} · ${u.lastSeen ? '最近使用 ' + esc(fmtTs(u.lastSeen)) : '还没登录过'}</span></span>
    ${u.disabled ? '<span class="tag adjust">已停用</span>' : u.mustChange ? '<span class="tag wait">待改密码</span>' : ''}</button>`).join('')}</div>`;
}

/* ---------- sheet plumbing ---------- */
function showSheet(title, body, foot) {
  const fresh = sheetEl.hidden;
  sheetEl.innerHTML = `<div class="sheet-bg"></div><div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-h"><h3>${esc(title)}</h3><span id="sheet-chip"></span><button class="icon-btn" data-act="close" aria-label="关闭">×</button></div><div class="sheet-b">${body}</div><div class="sheet-msg" id="sheet-msg" role="alert" hidden></div><div class="sheet-f">${foot}</div></div>`;
  sheetEl.hidden = false; document.documentElement.classList.add('locked');
  if (fresh) layerSync();
}
// The bar between the form and the footer: why a save didn't go through (with 重试 / 重新登录), or "close without saving?".
function sheetMsg(html, kind = 'err') {
  const el = $('#sheet-msg', sheetEl); if (!el) return;
  el.hidden = !html; el.className = 'sheet-msg ' + kind; el.innerHTML = html || '';
}
function failBar(text, act = 'retry-save', label = '重试') {
  sheetMsg(`<span><b>未保存</b> · ${esc(text)}</span><button type="button" class="btn sm ghost" data-act="${act}">${label}</button>`);
}
function closeSheet(force) {
  const sh = S.sheet;
  if (!sh) {  // a sheet drawn without S.sheet (stats.js): just take it down
    if (!sheetEl.hidden) { sheetEl.hidden = true; sheetEl.innerHTML = ''; document.documentElement.classList.remove('locked'); layerSync(); }
    return;
  }
  if (!force) {
    if (sh.forced) return;
    if (sh.busy) { sh.ctl?.abort(); return; }  // × during a save cancels it; the form stays as it is
    if (sh.form && isDirty()) { askClose(); return; }
  }
  clearTimeout(sheetChanged.t);
  if (sh.type === 'prefs' && !sh.saved) { applyStyle(prefStyle()); applyTheme(prefTheme()); }  // drop the preview
  [...(sh.photos || []), ...(sh.leftovers || [])].forEach(p => { if (p.local && p.url) URL.revokeObjectURL(p.url); });
  if (!sh.saved) cleanupOrphans(sh);
  S.sheet = null; sheetEl.hidden = true; sheetEl.innerHTML = ''; document.documentElement.classList.remove('locked');
  layerSync();
  if (S.authLost) location.href = '/login';
  // a session opened from 动作详情 (the second layer): × goes back to the page under both; 「‹」 (ex-back) to the exercise
}
function askClose() {
  const sh = S.sheet;
  sheetMsg(`<span>改动还没保存。</span><span class="msg-btns"><button type="button" class="btn sm ghost" data-act="close-cancel">继续填</button>${sh.dkey ? '<button type="button" class="btn sm ghost" data-act="close-keep">先放着</button>' : ''}<button type="button" class="btn sm ghost danger" data-act="close-drop">不保存</button></span>`, 'ask');
}
// cls "req": one option always stays picked (like 餐次).
function seg(group, opts, val, cls = '') {
  return `<div class="seg ${cls}" data-group="${group}" role="group">${opts.map(([v, label]) => `<button type="button" data-act="seg" data-v="${esc(v)}" aria-pressed="${String(v) === String(val ?? '')}">${label}</button>`).join('')}</div>`;
}
function chips(group, list, vals = []) {
  return `<div class="chips" data-group="${group}">${list.map(t => `<button type="button" class="chip" data-act="chip" data-v="${esc(t)}" aria-pressed="${(vals || []).includes(t)}">${esc(t)}</button>`).join('')}</div>`;
}
const segVal = g => sheetEl.querySelector(`[data-group="${g}"] [aria-pressed="true"]`)?.dataset.v ?? null;
const chipVals = g => [...sheetEl.querySelectorAll(`[data-group="${g}"] [aria-pressed="true"]`)].map(b => b.dataset.v);
const fval = id => (sheetEl.querySelector('#' + id)?.value || '').trim();
// A switch row: the whole row is the tap target.
const tgl = (id, label, sub, on) => `<label class="tgl"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><input type="checkbox" class="sw" id="${id}"${on ? ' checked' : ''}></label>`;
const checked = id => !!sheetEl.querySelector('#' + id)?.checked;
// 累不累 (进阶显示 off): 轻松 / 刚好 / 很累 store the session's RPE as 6 / 8 / 9.5. A value already there stays as it is
// unless another answer is picked: its bucket's choice carries it.
const TIRED = [[6, '轻松'], [8, '刚好'], [9.5, '很累']];
const tiredOf = v => !isNum(v) ? null : v <= 6.5 ? 0 : v <= 8.5 ? 1 : 2;
const tiredOpts = v => TIRED.map(([n, l], i) => [i === tiredOf(v) ? v : n, l]);
const rpeLbl = () => advOn() ? '整体强度 RPE' : '累不累';
const rpeOpts = v => advOn() ? `<option value="">不填</option>${RPES.map(n => `<option value="${n}"${n === v ? ' selected' : ''}>${n}${n === 10 ? '（力竭）' : n === 8 ? '（还能做 2 次）' : ''}</option>`).join('')}`
  : `<option value="">不填</option>${tiredOpts(v).map(([n, l]) => `<option value="${n}"${n === v ? ' selected' : ''}>${l}</option>`).join('')}`;
const numIn = (id, value, o = {}) => `<input type="text" inputmode="${o.int ? 'numeric' : 'decimal'}" autocomplete="off" id="${id}" value="${esc(value ?? '')}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.int ? ' data-int="1"' : ''} data-num="1">`;
function badInput(msg, id) { const e = new Error(msg); e.code = 'invalid_input'; e.field = id; return e; }
// A number field: null when blank, an error (and a red field) when it isn't a number or is out of range.
function readNum(id, label, o = {}) {
  const el = sheetEl.querySelector('#' + id); if (!el) return null;
  const v = parseNum(el.value, o.int);
  if (v === null) return null;
  const out = !Number.isNaN(v) && ((o.min != null && v < o.min) || (o.max != null && v > o.max));
  if (Number.isNaN(v) || out) { el.setAttribute('aria-invalid', 'true'); throw badInput(out ? `${label}应该在 ${o.min}–${o.max} 之间` : `${label}填的不是数字`, id); }
  return v;
}
function footer(saveAct, canDelete) {
  return `${canDelete ? '<button type="button" class="btn ghost danger" data-act="del">删除</button>' : ''}<button type="button" class="btn primary main" data-act="${saveAct}" id="save-btn">保存</button>`;
}
function setBusy(txt) {
  const b = $('#save-btn', sheetEl); if (!S.sheet) return;
  S.sheet.busy = !!txt;
  if (!b) return;
  if (!b.dataset.label) b.dataset.label = b.textContent;
  b.disabled = !!txt;
  if (txt) b.textContent = txt; else if (S.sheet.form) updateSaveBtn(); else b.textContent = b.dataset.label;
}

/* ---------- form state: the 关闭 / 保存 button, asking before closing, drafts ---------- */
// Everything a person can change in the open sheet. Photos are {id} when they were already on the record, {blob} otherwise.
function formState() {
  const sh = S.sheet, o = { f: {}, g: {}, c: {}, ph: {} };
  sheetEl.querySelectorAll('.sheet-b input[id], .sheet-b textarea[id], .sheet-b select[id]').forEach(el => { if (!['file', 'password', 'hidden'].includes(el.type) && !el.hidden && !el.dataset.nf) o.f[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  sheetEl.querySelectorAll('.sheet-b .seg[data-group]').forEach(g => { o.g[g.dataset.group] = segVal(g.dataset.group); });
  sheetEl.querySelectorAll('.sheet-b .chips[data-group]').forEach(g => { o.c[g.dataset.group] = chipVals(g.dataset.group); });
  for (const k of ['photos', 'leftovers']) if (sh[k] && sheetEl.querySelector('#ph-grid-' + k)) o.ph[k] = sh[k].filter(p => !p.pending).map(p => p.orig ? { id: p.id } : { blob: p.blob, url: p.url });
  if (sh.type === 'workout') o.x = { dayId: sh.dayId, title: sh.title };
  if (sh.items) o.items = sh.items;  // list editors (快捷清单, 训练日, 轮换) keep their rows here
  if (sh.wact) o.wact = sh.wact;     // body: 清除这天体重 / 恢复自动
  if (sh.bfact) o.bfact = sh.bfact;  // body: the same for 体脂率
  if (sh.slots) o.pp = Object.fromEntries(Object.entries(sh.slots).map(([k, p]) => [k, !p ? null : p.orig ? { id: p.id } : { blob: p.blob, url: p.url }]));  // 身材照
  return o;
}
const stateKey = o => JSON.stringify(o, (k, v) => v instanceof Blob ? undefined : v);
const isDirty = () => !!S.sheet?.form && stateKey(formState()) !== S.sheet.base;
function updateSaveBtn() {
  const b = $('#save-btn', sheetEl); if (!b || !S.sheet?.form || S.sheet.busy) return;
  const dirty = isDirty();
  b.textContent = dirty ? (S.sheet.saveLabel || '保存') : '关闭';
  b.classList.toggle('primary', dirty); b.classList.toggle('ghost', !dirty);
}
function sheetChanged() {
  if (!S.sheet?.form) return;
  updateSaveBtn();
  const ask = $('#sheet-msg.ask', sheetEl); if (ask && !isDirty()) sheetMsg(null);
  clearTimeout(sheetChanged.t); sheetChanged.t = setTimeout(writeDraft, 400);
}
// Call once a form sheet is drawn: remembers how it looked, then brings back an unsaved draft of the same record.
function formReady(saveAct, keyId) {
  const sh = S.sheet;
  Object.assign(sh, { form: true, saveAct, uploaded: sh.uploaded || [] });
  if (keyId && S.me) sh.dkey = `${S.me.id}|${sh.type}|${keyId}`;
  sh.base = stateKey(formState());
  const d = sh.dkey && drafts.get(sh.dkey);
  if (d && Date.now() - d.savedAt < DRAFT_TTL) {
    applyState(d.st);
    if (sh.isNew && d.id) sh.id = d.id;  // same id as before, so a save that did reach the server is overwritten, not doubled
    const t = new Date(d.savedAt);
    $('.sheet-b', sheetEl).insertAdjacentHTML('afterbegin', `<div class="draft-note"><span>接着上次没保存的${sh.isNew ? '记录' : '改动'}（${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}）</span><button type="button" class="link" data-act="draft-discard">丢弃</button></div>`);
  }
  updateDateChip(); updateSaveBtn();
}
function applyState(st) {
  const sh = S.sheet;
  for (const [id, v] of Object.entries(st.f || {})) { const el = sheetEl.querySelector('#' + CSS.escape(id)); if (el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } }
  for (const [g, v] of Object.entries(st.g || {})) sheetEl.querySelectorAll(`[data-group="${CSS.escape(g)}"] [data-v]`).forEach(b => b.setAttribute('aria-pressed', String(v != null && b.dataset.v === String(v))));
  for (const [g, v] of Object.entries(st.c || {})) sheetEl.querySelectorAll(`[data-group="${CSS.escape(g)}"] [data-v]`).forEach(b => b.setAttribute('aria-pressed', String((v || []).includes(b.dataset.v))));
  for (const [k, list] of Object.entries(st.ph || {})) {
    sh[k] = (list || []).map(p => p.id ? { id: p.id, url: blobSrc(p.id), orig: true } : p.blob instanceof Blob ? { blob: p.blob, local: true, url: URL.createObjectURL(p.blob) } : null).filter(Boolean);
  }
  if (st.x && sh.type === 'workout') { const { dayId, title } = clone(st.x); Object.assign(sh, { ...(dayId ? { dayId } : {}), ...(typeof title === 'string' ? { title } : {}) }); }  // an older draft's sets are left out
  if (sh.type === 'body' && (st.wact || st.bfact)) { sh.wact = st.wact || null; sh.bfact = st.bfact || null; drawWeightSrc(); }
  if (st.pp && sh.slots) {
    for (const [k, p] of Object.entries(st.pp)) if (k in sh.slots) sh.slots[k] = !p ? null : p.id ? { id: p.id, url: blobSrc(p.id), orig: true } : p.blob instanceof Blob ? { blob: p.blob, local: true, url: URL.createObjectURL(p.blob) } : null;
    drawSlots();
  }
  drawPhotos();
}
function updateDateChip() {
  const el = $('#sheet-chip', sheetEl); const d = fval('f-date');
  if (el) el.innerHTML = S.sheet?.isNew && isDate(d) && d !== today() ? `<span class="tag ex">记到 ${esc(md(d))}</span>` : '';
}

// Drafts live in IndexedDB (photos included); without it, in localStorage minus the photos. Kept in memory as well.
const drafts = new Map();
const idb = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
    const r = indexedDB.open('lianshiji', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('drafts', mode); const q = fn(t.objectStore('drafts'));
      t.oncomplete = () => res(q?.result); t.onerror = t.onabort = () => rej(t.error);
    });
  };
  return {
    all: async () => { const keys = await run('readonly', s => s.getAllKeys()); const vals = await run('readonly', s => s.getAll()); return keys.map((k, i) => [k, vals[i]]); },
    put: (k, v) => run('readwrite', s => s.put(v, k)),
    del: k => run('readwrite', s => s.delete(k)),
  };
})();
const lsDrafts = () => { try { return JSON.parse(lsGet('lsj-drafts') || '{}') || {}; } catch (e) { return {}; } };
async function loadDrafts() {
  let rows = [];
  try { rows = await idb.all(); } catch (e) { rows = Object.entries(lsDrafts()); }
  for (const [k, v] of rows) {
    if (!v || Date.now() - v.savedAt > DRAFT_TTL) { dropDraft(k); continue; }
    if (!drafts.has(k)) drafts.set(k, v);
  }
  // the old workout draft (localStorage, before drafts covered every form)
  const uid = S.me?.id, old = uid && lsGet('lsj-wo-draft:' + uid);
  if (old) {
    try {
      const d = JSON.parse(old);
      if (d && Date.now() - d.savedAt < DRAFT_TTL && !drafts.has(`${uid}|workout|new`)) {
        putDraft(`${uid}|workout|new`, { savedAt: d.savedAt, st: { f: { 'f-date': d.date }, g: { day: d.dayId }, c: {}, ph: {}, x: { ex: d.ex, dayId: d.dayId, title: d.title, date: d.date } } });
      }
    } catch (e) {}
    lsSet('lsj-wo-draft:' + uid, null);
  }
}
async function putDraft(k, v) {
  drafts.set(k, v);
  try { await idb.put(k, v); }
  catch (e) { const all = lsDrafts(); all[k] = JSON.parse(stateKey(v)); lsSet('lsj-drafts', JSON.stringify(all)); }
}
async function dropDraft(k) {
  if (!k) return;
  drafts.delete(k);
  try { await idb.del(k); } catch (e) {}
  const all = lsDrafts(); if (k in all) { delete all[k]; lsSet('lsj-drafts', JSON.stringify(all)); }
}
async function writeDraft() {
  clearTimeout(sheetChanged.t);
  const sh = S.sheet; if (!sh?.form || !sh.dkey || sh.saved) return;
  if (!isDirty()) { if (drafts.has(sh.dkey)) await dropDraft(sh.dkey); return; }
  await putDraft(sh.dkey, { id: sh.id, savedAt: Date.now(), st: formState() });
}
// Photos uploaded for a save that never went through: delete the ones the record doesn't reference.
async function cleanupOrphans(sh) {
  const ids = sh.uploaded || []; if (!ids.length || !S.db || !sh.col) return;
  try {
    const cur = await S.db.collection(sh.col).doc(sh.id).get();
    const used = new Set(cur.exists ? [...photoList(cur.data.photos), ...photoList(cur.data.leftovers)] : []);
    for (const id of ids) if (!used.has(id)) { try { await S.assets.delete(id); } catch (e) {} }
  } catch (e) {}
}

/* photos */
function photoField(hint, label = '照片', key = 'photos') {
  if (!S.assets) return `<div class="field"><span class="lbl">${label}</span><p class="hint" style="margin:0">${S.canPhoto === false ? '这个视图不能上传照片，请用你自己的账号打开。' : '照片上传还没就绪，稍等几秒再打开这个表单。'}</p></div>`;
  return `<div class="field"><span class="lbl">${label}</span><div class="photos" id="ph-grid-${key}"></div>${hint ? `<p class="hint" style="margin:0">${hint}</p>` : ''}</div>`;
}
function drawPhotos() {
  for (const key of ['photos', 'leftovers']) {
    const g = $('#ph-grid-' + key, sheetEl); if (!g) continue;
    const add = key === 'leftovers' ? '拍剩菜' : '添加照片';
    g.innerHTML = (S.sheet[key] || []).map((p, i) => p.pending ? '<div class="ph loading">处理中…</div>'
      : `<div class="ph"><button type="button" class="ph-v" data-act="ph-view" data-k="${key}" data-i="${i}" aria-label="查看大图"><img src="${esc(p.url)}" alt="照片 ${i + 1}"></button><button type="button" class="x" data-act="ph-del" data-k="${key}" data-i="${i}" aria-label="移除照片"><span>×</span></button></div>`).join('')
      + `<label class="ph-add"><svg class="i" viewBox="0 0 24 24"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${add}<input type="file" accept="image/*" multiple class="vh" data-ph="${key}"></label>`;
  }
}
async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) throw new Error('encode');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
async function onFiles(input) {
  const files = [...input.files]; input.value = ''; const key = input.dataset.ph || 'photos'; const sh = S.sheet;
  if (!sh) return; sh[key] = sh[key] || [];
  for (const f of files) {
    if (S.sheet !== sh) return;  // the sheet was closed while photos were still being read
    const slot = { pending: true }; sh[key].push(slot); drawPhotos();
    try {
      let blob;
      try { blob = await compress(f); } catch (e) { if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) blob = f; else throw e; }
      Object.assign(slot, { pending: false, blob, local: true, url: URL.createObjectURL(blob) });
    } catch (e) {
      sh[key] = sh[key].filter(p => p !== slot);
      toast('这张照片读不出来，换一张或截图后再试', true);
    }
    if (S.sheet === sh) { drawPhotos(); sheetChanged(); }
  }
}
async function retry1(fn) {
  try { return await fn(); }
  catch (e) { if (e && (e.code === 'unavailable' || e.code === 'store_unavailable')) { await sleep(600 + Math.random() * 800); return fn(); } throw e; }
}
// Values a form compares as equal: blank strings, empty lists and missing fields are all "nothing".
const blank = v => v == null || v === '' || (Array.isArray(v) && !v.length) ? null : v;
const same = (a, b) => JSON.stringify(blank(a)) === JSON.stringify(blank(b));
const ALWAYS = new Set(['needsReview', 'updatedAt']);
const changedFields = (fields, before) => Object.keys(fields).filter(k => !ALWAYS.has(k) && k !== 'createdAt' && !same(fields[k], before?.[k]));
// Write a sheet's fields onto the latest copy of the record. Fields the user didn't change since opening the sheet
// keep whatever the server has now (Claude's review, a sleep sync that landed meanwhile); needsReview and updatedAt
// always go through. Starts from the copy already on the phone and re-reads only when the server says it changed.
async function saveFields(col, id, before, fields, signal) {
  const ref = S.db.collection(col).doc(id);
  let cur = S.db.cached(col, id) || await retry1(() => ref.get({ signal }));
  for (let i = 0; ; i++) {
    const doc = { ...(cur.exists ? cur.data : {}) };
    for (const [k, v] of Object.entries(fields)) if (!cur.exists || ALWAYS.has(k) || !same(v, before?.[k])) doc[k] = v;
    try { await retry1(() => ref.set(doc, { ifVersion: cur.version, signal })); return doc; }
    catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await retry1(() => ref.get({ signal })); }
  }
}
// PATCH a few fields onto a record (the server merges objects into what it has; lists are replaced whole). `fn` builds
// the fields from the latest copy, so a list such as corrections is rebuilt on top of what the server has; on a conflict
// it re-reads and builds them again. Only the fields `fn` returns are written.
async function patchDoc(col, id, fn, signal) {
  const ref = S.db.collection(col).doc(id);
  let cur = S.db.cached(col, id) || await retry1(() => ref.get({ signal }));
  for (let i = 0; ; i++) {
    if (!cur.exists) throw { code: 'not_found', message: '这条记录已经删掉了' };
    try { return await retry1(() => ref.update(fn(cur.data), { ifVersion: cur.version, signal })); }
    catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await retry1(() => ref.get({ signal })); }
  }
}
async function uploadPhotos(sh, key, signal) {
  const list = sh[key] || []; const ids = []; const todo = list.filter(p => !p.id && !p.pending).length; let k = 0;
  if (list.some(p => p.pending)) throw { code: 'pending' };
  for (const p of list) {
    if (!p.id) {
      k++; setBusy(`上传照片 ${k}/${todo}…`);
      const r = await retry1(() => S.assets.upload(p.blob, { signal }));
      p.id = r.id; sh.uploaded.push(r.id);
    }
    ids.push(p.id);
  }
  return ids;
}
const photoIds = list => (list || []).map(p => p.id && p.orig ? p.id : 'new');
function errMsg(e) {
  const m = {
    pending: '照片还在处理，稍等一下再保存', pw_rate_limited: '试得太多了，10 分钟后再试', timeout: '网络太慢，等了太久没有回应', aborted: '已取消',
    quota_exceeded: '存储已满，删掉一些旧记录后再试', invalid_argument: '没有写入权限，或数据格式有误',
    resource_exhausted: '操作太频繁，过几秒再试', unavailable: '网络暂时不可用，稍后再试',
    too_large: '照片太大，换一张再试', unsupported_type: '不支持这种图片格式，请用 JPG 或 PNG',
    quota_or_state: '照片存储空间已满', rate_limited: '上传太频繁，过一会儿再试', upstream_auth: '登录状态失效，请刷新页面',
    store_unavailable: '照片服务暂时不可用，稍后再试', conflict: '这条记录刚在别处改过，关掉重新打开再改', internal: '服务器出错了，稍后再试',
    wrong_password: '当前密码不对', weak_password: '新密码至少 8 位', bad_username: '用户名只能用 2–32 位小写字母、数字或 _ . -',
    username_taken: '这个用户名已经有人用了', last_admin: '至少要保留一个管理员', self: '不能对自己的账号这样操作',
    forbidden: '没有权限做这个操作', must_change_password: '先设置新密码', unauthenticated: '登录已失效，请重新登录',
    too_many_tokens: '令牌太多了，先撤销用不到的', not_found: '这条记录已经删掉了',
    xunji_key_invalid: '训记 key 不对或已失效，请在训记 App 里重新申请', xunji_busy: '训记那边限频了，过一会儿再试',
  }[e?.code];
  return m || e?.message || '保存失败，请重试';
}
async function cleanupRemoved(sh) { for (const id of sh.removed || []) { try { await S.assets?.delete(id); } catch (e) {} } }
// Runs a sheet's save. Failures stay on screen in the bar above the footer; × cancels a save in flight.
async function runSave(fn) {
  const sh = S.sheet; if (!sh || sh.busy) return;
  sh.ctl = new AbortController(); sheetMsg(null);
  try { await fn(sh, sh.ctl.signal); }
  catch (e) {
    if (S.sheet !== sh) return;
    setBusy();
    if (e?.code === 'invalid_input') {
      toast(e.message, true);
      const el = e.field && sheetEl.querySelector('#' + e.field); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
    } else if (e?.code === 'unauthenticated') failBar('登录已失效，先别关，重新登录后再保存', 'relogin', '重新登录');
    else if (e?.code === 'aborted') failBar('已取消。填的内容都还在', 'retry-save', '重试');
    else failBar(errMsg(e), 'retry-save', '重试');
  } finally { sh.ctl = null; }
}
// Shared ending of a successful save.
async function saved(sh, msg) {
  sh.saved = true; sh.uploaded = [];
  if (sh.dkey) dropDraft(sh.dkey);
  cleanupRemoved(sh);
  closeSheet(true);
  if (msg) toast(msg);
  if (typeof sh.onSaved === 'function') { try { sh.onSaved(); } catch (e) { console.error(e); } }
}
function submit(act) {
  const sh = S.sheet; const fn = SAVES[act]; if (!sh || !fn || sh.busy) return;
  if (sh.form && !isDirty()) { if (sh.dkey) dropDraft(sh.dkey); closeSheet(true); return; }  // 关闭
  runSave(fn);
}

// Corrections the person made to single items of Claude's estimate: corrections: [{item, kind, note?}], one per item.
const CORR = { none: '没吃', half: '吃了一半', wrong: '不是这个' };
const corrList = m => Array.isArray(m?.corrections) ? m.corrections.filter(c => c && typeof c === 'object' && CORR[c.kind]) : [];
const corrFor = (m, name) => corrList(m).find(c => c.item === name) || null;
const corrTxt = c => CORR[c.kind] + (c.note ? (c.kind === 'wrong' ? `，其实是${c.note}` : `（${c.note}）`) : '');
function reviewMealHTML(m) {
  const r = m?.review;
  if (!r) {  // one-tap items: their numbers, until Claude looks at the meal
    const q = quickItems(m || {}); if (!q.length) return '';
    return `<div class="review" id="rv"><div class="review-h"><b>快速记录</b><span class="tag ok">估算</span></div><ul class="items">${q.map(i => `<li><span class="it-n">${esc(i.name)}${isNum(i.protein) ? ` <span class="amt">蛋白质 ${fmt(i.protein)} g</span>` : ''}</span><span class="kc">${isNum(i.kcal) ? fmt(i.kcal) : ''}</span></li>`).join('')}</ul></div>`;
  }
  const macro = isNum(r.kcal) ? `<div class="macro-line"><span class="big">${fmt(r.kcal)}<span class="m" style="margin-left:4px">kcal</span></span>${MACROS.slice(1).map(([k, l, u, c]) => isNum(r[k]) ? `<span class="m" style="--c:${c}">${l}<b>${fmt(r[k])}</b>${u}</span>` : '').join('')}</div>` : '';
  const its = Array.isArray(r.items) ? r.items.filter(i => i && typeof i === 'object') : [];
  const items = its.length ? `<ul class="items fx">${its.map(i => {
    const c = corrFor(m, String(i.name ?? ''));
    return `<li><button type="button" class="it" data-act="item-fix" data-n="${r.items.indexOf(i)}" aria-expanded="false"><span class="it-n">${esc(i.name)} <span class="amt">${esc(i.amount || '')}</span>${c ? `<span class="fixed">已标：${esc(corrTxt(c))}${m.needsReview ? ' · 等 Claude 重算' : ''}</span>` : ''}</span><span class="kc">${isNum(i.kcal) ? fmt(i.kcal) : ''}</span></button></li>`;
  }).join('')}</ul><p class="hint" style="margin:0">哪一项不对，点它标一下。</p>` : '';
  const nc = corrList(m).length, ans = askOf(m)?.answer;
  const why = m.feedback ? `你反馈「${m.feedback === 'high' ? '估高了' : '估低了'}」，` : nc ? `你标了 ${nc} 项，` : ans ? '你回答了 Claude 的问题，' : '记录有修改，';
  return `<div class="review" id="rv"><div class="review-h">${AG}<b>Claude 分析</b>${esc(fmtTs(r.reviewedAt))}${r.rating ? `<span class="tag ${esc(r.rating)}">${esc(RATING[r.rating] || '')}</span>` : ''}</div>${macro}${items}${r.comment ? `<p>${esc(r.comment)}</p>` : ''}${r.tip ? `<p class="tip">${esc(r.tip)}</p>` : ''}${m.needsReview ? `<div class="stale">${why}下次处理时会重新分析</div>`
    : isNum(r.kcal) ? '<div class="fb"><span>估得准吗？</span><button type="button" class="chip" data-act="meal-fb" data-v="high">估高了</button><button type="button" class="chip" data-act="meal-fb" data-v="low">估低了</button></div>' : ''}</div>`;
}
function reviewWoHTML(w) {
  const r = w?.review; if (!r) return '';
  return `<div class="review" id="rv"><div class="review-h">${AG}<b>Claude 点评</b>${esc(fmtTs(r.reviewedAt))}${r.rating ? `<span class="tag ${esc(r.rating)}">${esc(RATING[r.rating] || '')}</span>` : ''}</div>${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
    ${r.wins?.length ? `<div class="sub-h">做得好</div><ul class="plain">${r.wins.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.next?.length ? `<div class="sub-h">下次</div><ul class="plain">${r.next.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${r.nextByExercise && Object.keys(r.nextByExercise).length ? `<div class="sub-h">下次每个动作</div><ul class="plain nx-list">${Object.entries(r.nextByExercise).map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}</ul>` : ''}${w.needsReview ? `<div class="stale">${askOf(w)?.answer ? '你回答了 Claude 的问题，下次处理时会看' : '记录有修改，下次处理时会重新点评'}</div>` : ''}</div>`;
}
const redrawReview = sh => { const el = $('#rv', sheetEl); if (el) el.outerHTML = sh.type === 'meal' ? reviewMealHTML(sh.existing) : reviewWoHTML(sh.existing); };

/* Claude's question about a meal or a workout: review.ask {q, options?}. The answer goes on the record itself as
   answer {text, at, q} (q: the question it answers), with needsReview, and nothing else; that holds for 训记 sessions too. */
function askOf(rec) {
  const a = rec?.review?.ask; if (!a || typeof a !== 'object' || typeof a.q !== 'string' || !a.q.trim()) return null;
  const ans = rec.answer && typeof rec.answer === 'object' && typeof rec.answer.text === 'string' && rec.answer.text ? rec.answer : null;
  const fits = ans && (typeof ans.q === 'string' ? ans.q === a.q : Date.parse(ans.at) >= (Date.parse(rec.review.reviewedAt || '') || 0));
  return { q: a.q, options: (Array.isArray(a.options) ? a.options : []).filter(o => typeof o === 'string' && o.trim()).slice(0, 8), answer: fits ? ans : null };
}
function askHTML(rec, editing) {
  const a = askOf(rec); if (!a) return '';
  const done = a.answer && !editing;
  return `<div class="ask" id="ask-box"><div class="ask-h">${AG}Claude 想问你</div><p class="ask-q">${esc(a.q)}</p>
    ${done ? `<p class="ask-a">你的回答：${esc(a.answer.text)}</p><div class="ask-st"><span>${rec.needsReview ? '已回答，等 Claude 处理' : '已回答'}</span><button type="button" class="link" data-act="ask-edit">改一下</button></div>`
    : `${a.options.length ? `<div class="ask-opts">${a.options.map(o => `<button type="button" class="chip" data-act="ask-opt" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="ask-in"><input type="text" class="ask-text" maxlength="200" enterkeyhint="send" autocomplete="off" aria-label="回答 Claude" placeholder="${a.options.length ? '或者自己写…' : '写一句回答'}" value="${esc(editing && a.answer ? a.answer.text : '')}"><button type="button" class="btn primary sm" data-act="ask-send">发送</button></div>`}</div>`;
}
async function sendAnswer(text) {
  const sh = S.sheet; if (!sh?.existing || !S.db || sh.asking || !['meal', 'workout', 'xunji'].includes(sh.type)) return;
  const a = askOf(sh.existing); if (!a) return;
  text = String(text || '').trim().slice(0, 200);
  if (!text) { toast('先写一句再发送', true); $('#ask-box .ask-text', sheetEl)?.focus(); return; }
  const box = $('#ask-box', sheetEl); box?.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
  sh.asking = true;
  const answer = { text, at: new Date().toISOString(), q: a.q };
  try {
    await patchDoc(sh.type === 'meal' ? 'meals' : 'workouts', sh.id, () => ({ answer, needsReview: true }));
    if (S.sheet === sh) {
      Object.assign(sh.existing, { answer, needsReview: true });
      const el = $('#ask-box', sheetEl); if (el) el.outerHTML = askHTML(sh.existing);
      redrawReview(sh);
    }
    toast('已回答，Claude 下次处理时会看');
  } catch (e) {
    box?.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    toast(errMsg(e), true);
  }
  sh.asking = false;
}

// Tapping an item of Claude's estimate opens 没吃 / 吃了一半 / 不是这个 and a short note under it.
function openFix(btn) {
  const li = btn.closest('li'), wasOpen = !!li.querySelector('.fix');
  sheetEl.querySelectorAll('.items .fix').forEach(x => x.remove());
  sheetEl.querySelectorAll('.items .it[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  const m = S.sheet?.existing, item = m?.review?.items?.[+btn.dataset.n];
  if (wasOpen || !item) return;
  const c = corrFor(m, String(item.name ?? ''));
  btn.setAttribute('aria-expanded', 'true');
  li.insertAdjacentHTML('beforeend', `<div class="fix" data-n="${esc(btn.dataset.n)}"><div class="fix-k" role="group" aria-label="${esc(item.name)}">${Object.entries(CORR).map(([k, l]) => `<button type="button" class="chip" data-act="fix-kind" data-v="${k}" aria-pressed="${c?.kind === k}">${l}</button>`).join('')}</div>
    <input type="text" class="fix-note" maxlength="60" enterkeyhint="done" autocomplete="off" aria-label="补充说明" placeholder="${c?.kind === 'wrong' ? '其实是…' : '补充一句（可不填）'}" value="${esc(c?.note || '')}">
    <div class="fix-b">${c ? '<button type="button" class="link" data-act="fix-clear">去掉标记</button>' : ''}<button type="button" class="btn ghost sm" data-act="fix-cancel">取消</button><button type="button" class="btn primary sm" data-act="fix-save">保存</button></div></div>`);
}
function pickFix(btn) {
  const box = btn.closest('.fix');
  box.querySelectorAll('[data-act="fix-kind"]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
  const inp = box.querySelector('.fix-note');
  inp.placeholder = btn.dataset.v === 'wrong' ? '其实是…' : '补充一句（可不填）';
  if (btn.dataset.v === 'wrong') inp.focus();
}
async function saveFix(el, clear) {
  const sh = S.sheet, box = el.closest('.fix'); if (!sh?.existing || sh.type !== 'meal' || !box || sh.fixing || !S.db) return;
  const item = sh.existing.review?.items?.[+box.dataset.n]; if (!item) return;
  const name = String(item.name ?? '');
  const kind = box.querySelector('[data-act="fix-kind"][aria-pressed="true"]')?.dataset.v;
  const note = box.querySelector('.fix-note').value.trim().slice(0, 60);
  if (!clear && !kind) { toast('先选「没吃」「吃了一半」或「不是这个」', true); return; }
  const entry = clear ? null : { item: name, kind, ...(note ? { note } : {}) };
  sh.fixing = true; box.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
  try {
    const r = await patchDoc('meals', sh.id, cur => {
      const list = (Array.isArray(cur.corrections) ? cur.corrections : []).filter(c => c?.item !== name);
      if (entry) list.push(entry);
      return entry ? { corrections: list, needsReview: true } : { corrections: list.length ? list : { __delete__: true } };
    });
    if (S.sheet === sh) {
      sh.existing.corrections = r.data.corrections; sh.existing.needsReview = r.data.needsReview;
      redrawReview(sh);
    }
    toast(entry ? '已标上，Claude 下次处理时重算' : '已去掉标记');
  } catch (e) {
    box.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
    toast(errMsg(e), true);
  }
  sh.fixing = false;
}

async function mealFeedback(btn) {
  const sh = S.sheet; if (!sh || sh.type !== 'meal' || !sh.existing || !S.db || sh.fb) return;
  const v = btn.dataset.v; sh.fb = true;
  try {
    await retry1(() => S.db.collection('meals').doc(sh.id).update({ feedback: v, needsReview: true }));
    Object.assign(sh.existing, { feedback: v, needsReview: true });
    btn.closest('.fb').innerHTML = `<span>已反馈「${v === 'high' ? '估高了' : '估低了'}」，下次处理时重新估。哪里不对可以写在下面的备注里，再点保存。</span>`;
  } catch (e) { sh.fb = false; toast(errMsg(e), true); }
}

/* ---------- meal ---------- */
function openMeal(id, opts = {}) {
  const m = id ? S.meals.find(x => x.id === id) : null;
  if (id && !m) return;
  const date = m?.date || (isDate(opts.date) ? opts.date : S.date);
  const slot = m?.slot || (date === today() ? guessSlot() : 'lunch');
  const orig = list => (list || []).filter(pid => PHOTO_ID.test(String(pid))).map(pid => ({ id: pid, url: blobSrc(pid), orig: true }));
  S.sheet = { type: 'meal', col: 'meals', id: m ? m.id : newId('m'), isNew: !m, existing: clone(m), photos: orig(m?.photos), leftovers: orig(m?.leftovers), removed: [], reopen: () => openMeal(id, opts) };
  const fullOpts = FULLNESS.map((t, i) => [String(i + 1), `${i + 1}<small>${t}</small>`]);
  // 最近吃过: dish names from Claude's estimates of recent meals (not the descriptions, which hold notes like
  // 「蛋黄没吃」, #15); a tap adds the dish to 吃了什么.
  const recent = [];
  for (const x of [...S.meals].sort((a, z) => (z.date + dayTime(z.time)).localeCompare(a.date + dayTime(a.time)))) {
    for (const it of Array.isArray(x.review?.items) ? x.review.items : []) {
      const t = String(it?.name ?? '').trim();
      if (t && t.length <= 14 && !recent.includes(t)) recent.push(t);
    }
    if (recent.length >= 8) break;
  }
  recent.splice(8);
  showSheet(m ? `${SLOTS[m.slot] || '餐食'} · ${md(m.date)}` : '记一餐', `
    ${askHTML(m)}${reviewMealHTML(m)}
    <div class="field"><span class="lbl">餐次</span>${seg('slot', SLOT_ORDER.map(k => [k, SLOTS[k]]), slot)}</div>
    <div class="row2"><div class="field"><label for="f-date">日期</label><input type="date" id="f-date" value="${esc(date)}"></div><div class="field"><label for="f-time">时间</label><input type="time" id="f-time" value="${esc(m?.time || (date === today() ? nowHM() : SLOT_TIME[slot]))}"></div></div>
    ${photoField('开吃前整份拍进去，带上碗盘或筷子做参照。剩菜拍到下面「饭后情况」里。')}
    <div class="field"><label for="f-desc">吃了什么</label><textarea id="f-desc" class="grow" rows="2" placeholder="例：糙米饭大半碗、清蒸鲈鱼半条、炒菜心">${esc(m?.desc || '')}</textarea><div class="place-tip" id="place-tip" role="note" hidden></div>${!m && recent.length ? `<div class="chips recent" aria-label="最近吃过，点一下加进去">${recent.map(t => `<button type="button" class="chip" data-act="fill-desc" data-v="${esc(t)}">＋ ${esc(t)}</button>`).join('')}</div>` : ''}</div>
    ${manualField(m)}
    <fieldset id="after-fs"><legend>饭后情况<span>可以吃完再回来补</span></legend>
      <div class="field"><span class="lbl">吃了多少</span>${seg('portion', PORTIONS, m?.portion)}</div>
      <div class="field"><span class="lbl">饱腹感</span>${seg('fullness', fullOpts, m?.fullness)}</div>
      <div class="field"><span class="lbl">饭后感受</span>${chips('feel', MEAL_FEEL, m?.feelings)}</div>
      ${photoField('吃完拍一下剩下的（吃光了就不用拍），Claude 会按剩下的扣，比只选「吃了多少」准。', '剩菜照片', 'leftovers')}
    </fieldset>
    <div class="field"><label for="f-notes">备注</label><textarea id="f-notes" rows="2" placeholder="外卖还是自己做、饮料零食、情绪、是否赶时间…">${esc(m?.notes || '')}</textarea></div>
  `, footer('save-meal', !!m));
  drawPhotos();
  formReady('save-meal', m ? m.id : 'new'); growAll(); drawPlaceTip();
}
// 我知道热量: numbers from a package label or a takeout app. They count as typed; Claude fills in only the missing macros.
function manualField(m) {
  const man = m?.manual && typeof m.manual === 'object' ? m.manual : {};
  const has = MKEYS.some(k => isNum(man[k]));
  return `<details class="kn" id="kn"${has ? ' open' : ''}><summary>我知道热量<span>包装上、外卖 App 上写的</span></summary>
    <div class="mac4">${MACROS.map(([k, l, u]) => `<label class="mini"><span>${l}${k === 'kcal' ? '' : ` ${u}`}</span>${numIn('mn-' + k, man[k], { ph: k === 'kcal' ? '必填' : '' })}</label>`).join('')}</div>
    <div class="kn-f"><p class="hint" style="margin:0">填了就按你的数算，Claude 只补没填的。</p><button type="button" class="link" data-act="manual-clear">清除</button></div></details>`;
}
function readManual() {
  const o = {};
  for (const [k, l] of MACROS) { const v = readNum('mn-' + k, l, k === 'kcal' ? { min: 0, max: 5000 } : { min: 0, max: 500 }); if (v != null) o[k] = v; }
  if (!Object.keys(o).length) return undefined;
  if (!isNum(o.kcal)) throw badInput('「我知道热量」里热量要填', 'mn-kcal');
  return o;
}
async function saveMeal(sh, signal) {
  if (!S.db) return;
  const date = isDate(fval('f-date')) ? fval('f-date') : S.date;
  const manual = readManual();
  if (!sh.photos.length && !fval('f-desc')) throw badInput('至少拍一张照片或写一下吃了什么', 'f-desc');
  const fullness = segVal('fullness');
  const fields = {
    date, slot: segVal('slot') || 'lunch', time: fval('f-time'),
    desc: fval('f-desc'), portion: segVal('portion'), fullness: fullness ? Number(fullness) : null,
    feelings: chipVals('feel'), notes: fval('f-notes'), manual,
  };
  const photosSame = same(photoIds(sh.photos), sh.existing?.photos) && same(photoIds(sh.leftovers), sh.existing?.leftovers);
  if (sh.existing && photosSame && !changedFields(fields, sh.existing).length) { await saved(sh); return; }  // nothing changed
  setBusy('保存中…');
  fields.photos = S.assets ? await uploadPhotos(sh, 'photos', signal) : (sh.existing?.photos || []);
  fields.leftovers = S.assets ? await uploadPhotos(sh, 'leftovers', signal) : (sh.existing?.leftovers || []);
  setBusy('保存中…');
  const now = new Date().toISOString();
  await saveFields('meals', sh.id, sh.existing, { ...fields, needsReview: true, createdAt: sh.existing?.createdAt || now, updatedAt: now }, signal);
  S.date = date; render();
  await saved(sh, sh.existing ? '已更新，下次处理时重新分析' : '已记下，等 Claude 处理');
}

/* ---------- workout ---------- */
let audioCtx = null, wakeLock = null;
function beep() {
  const c = audioCtx; if (!c) return;
  try {
    [0, 0.28].forEach(off => {
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + off;
      o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.22);
    });
  } catch (e) {}
}
// The screen stays on while a workout form or the 训练中 screen is open (the system lets go when the page is hidden;
// it is asked again when the page comes back). `wantAwake` is the last wish, so an on and an off racing end right.
let wantAwake = false, wakeBusy = false;
async function keepAwake(on) {
  wantAwake = !!on;
  if (wakeBusy) return;
  wakeBusy = true;
  const wish = wantAwake;
  try {
    if (wish && 'wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      const l = await navigator.wakeLock.request('screen');
      wakeLock = l; l.addEventListener?.('release', () => { if (wakeLock === l) wakeLock = null; });
    } else if (!wish && wakeLock) { const l = wakeLock; wakeLock = null; await l.release(); }
  } catch (e) { if (!wish) wakeLock = null; }
  wakeBusy = false;
  if (wantAwake !== wish) keepAwake(wantAwake);
}
// 「练的时候屏幕常亮」 (训练中 → ⋯): on unless switched off on this phone (localStorage lsj-wake = '0').
const wakeOn = () => lsGet('lsj-wake') !== '0';

// The plan day a 训记 session's title maps to (meta/xunji.dayMap).
const xjAutoDay = w => { const id = S.xunji?.dayMap?.[w.title]; return isPlanDay(id) ? id : null; };
// One exercise of a session in its details: name and target, every set (warm-ups faded: the marked ones and the lighter
// sets before the working weight; drop sets marked), and against last time.
// noLink: the sheet was opened from the exercise's details (「‹」 goes back there), so the names don't open it again.
function exCardHTML(e, i, w, noLink) {
  if (e.cardio) return `<div class="xex"><div class="xex-h"><span class="ex-n num">${i + 1}</span><b>${esc(e.name)}</b></div><div class="meta">${esc(metricsTxt(e.metrics))}</div></div>`;
  const nm = String(e.name || '').trim();  // the name opens 动作详情
  const v = exVerdict(e, w), tg = v?.tg || exTarget(e, w.planDayId), warm = v?.wk.warm || new Set();
  const rec = prOf(w, e.name), top = prSet(e.sets, rec);
  const chips = (e.sets || []).filter(s => s && typeof s === 'object').map((s, j) => {
    const wu = !!s.warmup || warm.has(s), pr = s === top;
    return `<span class="xset${s.done ? '' : ' undone'}${wu ? ' warm' : ''}${s.drop ? ' drop' : ''}${pr ? ' pr' : ''}"${pr ? ` title="${esc(rec.text || '新纪录')}"` : ''}>${wu ? '<i>热身</i>' : s.drop ? '<i>递减</i>' : pr ? '<i>纪录</i>' : ''}${esc(setTxt(s, !j))}${isNum(s.rpe) && advOn() ? `<small>@${esc(s.rpe)}</small>` : ''}</span>`;
  }).join('');
  const cmp = v ? `<div class="xex-f">${prTag(rec)}${verdictTags(v, true)}<span class="xex-last">${esc(v.prev ? lastTxt({ date: v.prev.date, sets: v.prev.sets }) : '第一次练这个动作')}</span></div>` : '';
  const nameH = noLink ? `<span class="xex-n"><b>${esc(nm)}</b></span>` : `<button type="button" class="ex-link xex-n" data-act="ex-open" data-n="${esc(nm)}" aria-label="${esc(nm)}：动作详情、每次的记录"><b>${esc(nm)}</b></button>`;
  return `<div class="xex"><div class="xex-h"><span class="ex-n num">${i + 1}</span>${nameH}${tg?.txt ? `<span class="xex-tg num">${esc(humanTarget(tg.txt))}</span>` : ''}</div>
    ${chips ? `<div class="xsets">${chips}</div>` : ''}${cmp}${rpLine(w, e, i)}</div>`;
}
// A session imported from 训记: the sets are read-only (edits here would not reach 训记). 「我的补充」 (notes, feelings,
// RPE, which plan day it was) is stored on the record as `mine`, only in 薄肌研究所; sync never changes it. Claude's review
// first, then one card per exercise; 我的补充 folded at the bottom.
function openXunji(w, opts = {}) {
  S.sheet = { type: 'xunji', col: 'workouts', id: w.id, existing: clone(w), photos: [], removed: [], reopen: () => openXunji(S.workouts.find(x => x.id === w.id) || w, opts) };
  const st = woStats(w), x = w.xunji || {};
  const mine = w.mine && typeof w.mine === 'object' ? w.mine : {};
  const clock = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const meta = [isNum(x.start) && isNum(x.end) ? esc(`${clock(x.start)}–${clock(x.end)}`) : '', isNum(w.durationMin) ? esc(`${w.durationMin} 分钟`) : '',
    esc(`完成 ${st.done}/${st.sets} 组`), st.vol && advOn() ? `训练量 ${fmt(st.vol)} kg${volChg(w, st.vol)}` : ''].filter(Boolean).join(' · ');
  const exs = (w.exercises || []).filter(e => e && typeof e === 'object').map((e, i) => exCardHTML(e, i, w, !!opts.back)).join('');
  const auto = xjAutoDay(w), pdv = typeof mine.planDayId === 'string' ? (mine.planDayId && isPlanDay(mine.planDayId) ? mine.planDayId : mine.planDayId ? 'auto' : 'free') : 'auto';
  const pdOpts = [['auto', `按训记标题${auto ? `（${dayShortOf(auto)}）` : '（不对应计划日）'}`], ...planDays().map(d => [d.id, d.name || dayShort(d)]), ['free', '自由（不算计划里的哪天）']];
  const feel = Array.isArray(mine.feelings) ? mine.feelings.filter(f => typeof f === 'string') : [];
  const filled = [pdv !== 'auto' ? (pdv === 'free' ? '自由' : `练的${dayShortOf(pdv)}`) : '', isNum(mine.rpe) ? (advOn() ? `RPE ${mine.rpe}` : TIRED[tiredOf(mine.rpe)][1]) : '', feel.join('、'), typeof mine.notes === 'string' && mine.notes.trim() ? '有备注' : ''].filter(Boolean).join(' · ');
  const wait = !w.review && w.needsReview ? `<p class="wait-cm">${AG}<span>等 Claude 点评，下次处理时会写</span></p>` : '';
  showSheet(`${woTitle(w)} · ${md(w.date)}`, `
    ${askHTML(w)}${reviewWoHTML(w)}${wait}
    <p class="meta" style="margin:0">训记 · ${meta}</p>${hrBlock(w)}
    ${exs || '<p class="hint" style="margin:0">这次训练没有动作记录。</p>'}
    ${w.notes ? `<p style="margin:0">${esc(w.notes)}</p>` : ''}
    <p class="hint" style="margin:0">组数和重量记在训记里，要改请在训记里改，同步时会更新。</p>
    <details class="mine-det" id="mine-det"><summary><span class="md-t">补充感受、${advOn() ? 'RPE' : '累不累'}、备注<small>只存在这里</small></span>${filled ? `<span class="md-f">${esc(filled)}</span>` : ''}${CHEV_R}</summary>
      <div class="md-b">
      <div class="field"><label for="x-pd">这次练的是</label><select id="x-pd">${pdOpts.map(([v, l]) => `<option value="${esc(v)}"${v === pdv ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="f-rpe">${rpeLbl()}</label><select id="f-rpe">${rpeOpts(mine.rpe)}</select></div>
      <div class="field"><span class="lbl">感受</span>${chips('feel', WO_FEEL, feel)}</div>
      <div class="field"><label for="f-notes">备注</label><textarea id="f-notes" rows="2" placeholder="哪个动作不顺、哪里不舒服…">${esc(typeof mine.notes === 'string' ? mine.notes : '')}</textarea></div>
      </div></details>`, footer('save-xunji', false));
  sheetBack(opts.back);
  formReady('save-xunji', w.id);
  if (isDirty()) { const det = $('#mine-det', sheetEl); if (det) det.open = true; }  // a draft brought back: show it
}
async function saveXunji(sh, signal) {
  if (!S.db) return;
  const w = sh.existing, pd = fval('x-pd'), rpe = fval('f-rpe'), notes = fval('f-notes'), feel = chipVals('feel');
  const mine = { ...(w.mine && typeof w.mine === 'object' ? w.mine : {}) };
  if (notes) mine.notes = notes.slice(0, 1000); else delete mine.notes;
  if (feel.length) mine.feelings = feel; else delete mine.feelings;
  if (rpe) mine.rpe = Number(rpe); else delete mine.rpe;
  const hadPick = typeof w.mine?.planDayId === 'string';
  if (pd === 'auto') delete mine.planDayId; else mine.planDayId = pd === 'free' ? '' : pd;
  // top-level planDayId follows the pick ("" = trained, not a plan day); back to 自动: what the 训记 title maps to
  const planDayId = typeof mine.planDayId === 'string' ? mine.planDayId || null : hadPick ? xjAutoDay(w) : w.planDayId ?? null;
  const fields = { mine: Object.keys(mine).length ? mine : undefined, planDayId };
  if (!changedFields(fields, w).length) { await saved(sh); return; }
  setBusy('保存中…');
  await saveFields('workouts', sh.id, w, { ...fields, needsReview: true, updatedAt: nowIso() }, signal);
  await saved(sh, '已保存，Claude 下次处理时会看');
}
// The watch's heart rate and kcal under a session's title (details); a 训练中 session just finished: they come with 同步健康.
function hrBlock(w) {
  const h = hrHTML(w, 'hr-line');
  if (h) return `<p class="hr-p">${h}</p>`;
  return hrSoon(w) ? `<p class="hint hr-soon" style="margin:0">同步健康后，这里会有手表记的心率和消耗${canSyncHealth() ? '<button type="button" class="link" data-act="health-sync">同步手表心率</button>' : ''}</p>` : '';
}
// Swapped in for a plan exercise, not decided yet (two days): 以后都练这个 changes the plan right away (B4).
function rpLine(w, e, k) {
  const nm = String(e.name || '').trim();
  return daysBetween(w.date, today()) <= 2 && e.replaced && !lsGet(rpKey(w.id, k)) && isPlanDay(w.planDayId) && planEx(e.replaced, w.planDayId) ? `<span class="cmp-l rp-line"><span class="rp-t">本来是 ${esc(e.replaced)} → ${esc(nm)}</span><span class="rp-b"><button type="button" class="btn ghost sm" data-act="rp-plan" data-id="${esc(w.id)}" data-k="${k}">以后都练这个</button><button type="button" class="btn ghost sm" data-act="rp-once" data-id="${esc(w.id)}" data-k="${k}">只这次</button></span></span>` : '';
}
// 以后都练这个 / 只这次 from a session's details (B4).
async function rpDecide(btn, wid, k, plan) {
  const w = S.workouts.find(x => x.id === wid), e = w?.exercises?.[k]; if (!e || btn.disabled) return;
  if (!plan) { lsSet(rpKey(wid, k), 'once'); btn.closest('.rp-line')?.remove(); return; }
  btn.disabled = true;
  try { await swapPlanEx(w.planDayId, e.replaced, String(e.name || '').trim(), wid, k); btn.closest('.rp-line')?.remove(); }
  catch (e2) { btn.disabled = false; toast(errMsg(e2), true); }
}
// A session logged here (训练中, 补记): Claude's review, the watch, every exercise with every set (read-only: 改动作和组数
// opens them on the 训练中 screen, the one place sets are edited), then what this sheet edits itself: which plan day,
// title, date, duration, RPE, feelings, photos, notes. No id: 补记 (openBuji).
function openWorkout(id, dayId, opts = {}) {
  const w = id ? S.workouts.find(x => x.id === id) : null;
  if (id && !w) return;
  if (!w) { openBuji(dayId, opts.date); return; }
  if (w.source === 'xunji') { openXunji(w, opts); return; }
  const days = planDays(), pick = w.planDayId || 'free';
  S.sheet = {
    type: 'workout', col: 'workouts', id: w.id, existing: clone(w), dayId: pick, date: w.date, title: w.title || autoTitle(days.find(d => d.id === pick)),
    photos: (w.photos || []).filter(pid => PHOTO_ID.test(String(pid))).map(pid => ({ id: pid, url: blobSrc(pid), orig: true })), removed: [],
    reopen: () => openWorkout(id, dayId, opts),
  };
  const st = woStats(w), busy = !!(LIVE.w && LIVE.mode === 'live');
  const meta = [isNum(w.durationMin) ? esc(`${w.durationMin} 分钟`) : '', esc(`完成 ${st.done}/${st.sets} 组`), st.vol && advOn() ? `训练量 ${fmt(st.vol)} kg${volChg(w, st.vol)}` : ''].filter(Boolean).join(' · ');
  const exs = (w.exercises || []).filter(e => e && typeof e === 'object').map((e, i) => exCardHTML(e, i, w, !!opts.back)).join('');
  const dayOpts = days.map(d => [d.id, `${esc(dayShort(d))}<small>${esc(d.name || '')}</small>`]).concat([['free', '自由<small>不按计划</small>']]);
  const wait = !w.review && w.needsReview ? `<p class="wait-cm">${AG}<span>等 Claude 点评，下次处理时会写</span></p>` : '';
  showSheet(`${woTitle(w)} · ${md(w.date)}`, `
    ${askHTML(w)}${reviewWoHTML(w)}${wait}
    <p class="meta" style="margin:0">${meta}</p>${hrBlock(w)}
    ${exs || '<p class="hint" style="margin:0">这次训练没有动作记录。</p>'}
    <button type="button" class="btn ghost wo-edit" data-act="lv-edit" data-id="${esc(w.id)}"${busy ? ' disabled' : ''}>改动作和组数</button>
    ${busy ? '<p class="hint" style="margin:-6px 0 0">正在练的这次还没点完成：点了完成，才能在这里改这次的组。</p>' : ''}
    <div class="field"><span class="lbl">练哪一天</span>${seg('day', dayOpts, pick)}</div>
    <div class="field"><label for="f-title">标题</label><input type="text" id="f-title" maxlength="40" autocomplete="off" value="${esc(S.sheet.title)}"></div>
    <div class="row2"><div class="field"><label for="f-date">日期</label><input type="date" id="f-date" value="${esc(w.date)}" max="${esc(today())}"></div><div class="field"><label for="f-dur">时长（分钟）</label>${numIn('f-dur', w.durationMin, { int: true, ph: '60' })}</div></div>
    <div class="field"><label for="f-rpe">${rpeLbl()}</label><select id="f-rpe">${rpeOpts(w.rpe)}</select>${advOn() ? '<p class="hint" style="margin:0">10 = 力竭，8 = 还能再做 2 次</p>' : ''}</div>
    <div class="field"><span class="lbl">感受</span>${chips('feel', WO_FEEL, w.feelings)}</div>
    ${photoField('可选：手表心率截图、器械或姿势照片。')}
    <div class="field"><label for="f-notes">备注</label><textarea id="f-notes" rows="2" placeholder="哪个动作不顺、换了什么动作、哪里不舒服…">${esc(w.notes || '')}</textarea></div>
    ${S.plan && (w.exercises || []).some(e => e && !e.cardio && String(e.name || '').trim()) ? `<button type="button" class="link" data-act="day-from-wo" data-id="${esc(w.id)}" style="align-self:flex-start">把这次的动作存成训练日</button>` : ''}
  `, footer('save-workout', true));
  sheetBack(opts.back);
  drawPhotos();
  formReady('save-workout', w.id);
}
// 补记: which day it was and which plan day, then the sets on the 训练中 screen (lvNew), as when correcting one.
function openBuji(dayId, date) {
  if (LIVE.w && LIVE.mode === 'live') { toast('先把正在练的这次点完成，再补记别的', true); return; }
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const t = today(), d = isDate(date) && date <= t ? date : t, days = planDays();
  const pick = days.some(x => x.id === dayId) ? dayId : plannedDay(d)?.id || (days.length ? days[0].id : 'free');
  S.sheet = { type: 'buji', photos: [], removed: [] };
  showSheet('补记一次训练', `<div class="field"><label for="bj-date">哪天练的</label><input type="date" id="bj-date" value="${esc(d)}" max="${esc(t)}"></div>
    ${days.length ? `<div class="field"><span class="lbl">练的哪一天</span>${seg('bj-day', days.map(x => [x.id, `${esc(dayShort(x))}<small>${esc(x.name || '')}</small>`]).concat([['free', '自由<small>不按计划</small>']]), pick)}</div>` : ''}
    <p class="hint" style="margin:0">接下来在训练界面里逐组填：灰字是上次的成绩，直接点 ✓ 就按它记；热身组、递减组点组号加。</p>`,
    '<button type="button" class="btn ghost" data-act="close">取消</button><button type="button" class="btn primary main" data-act="bj-go">开始记</button>');
}
// A session opened from 动作进步's table: 「‹」 at the left of the title goes back to that exercise's sheet, and so
// does closing the details (S.sheet.backEx; closeSheet reopens it).
function sheetBack(name) {
  const key = String(name || '').trim(); if (!key || !S.sheet) return;
  S.sheet.backEx = key;
  $('.sheet-h', sheetEl)?.insertAdjacentHTML('afterbegin', `<button type="button" class="icon-btn sheet-back" data-act="ex-back" aria-label="回到动作进步">${CHEV(-1)}</button>`);
}
// ↑ ↓ for a row of a list editor: data-act "<p>-up" / "<p>-down".
const mvBtns = (p, i, n) => `<span class="mv"><button type="button" class="icon-btn" data-act="${p}-up" aria-label="上移"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="icon-btn" data-act="${p}-down" aria-label="下移"${i === n - 1 ? ' disabled' : ''}>↓</button></span>`;
const moveItem = (list, i, d) => { const j = i + d; if (j < 0 || j >= list.length) return false; [list[i], list[j]] = [list[j], list[i]]; return true; };
const autoTitle = day => day ? (day.name || dayShort(day) || '训练') : '自由训练';
// A session's title as shown: an older 「A · 胸 肩 三头」 loses the letter when A is a plan day (the badge says it
// already); the stored title is untouched.
function woTitle(w) {
  const t = String(w?.title || '').trim(); if (!t) return '训练';
  const m = /^([A-Za-z0-9]{1,3})\s*[·•]\s*(.+)$/.exec(t);
  return m && isPlanDay(m[1]) ? m[2].trim() : t;
}
function pickDay(v) {
  const sh = S.sheet, was = autoTitle(planDays().find(d => d.id === sh.dayId)); sh.dayId = v;
  const day = planDays().find(d => d.id === v);
  const inp = $('#f-title', sheetEl);
  if (!inp || !inp.value.trim() || inp.value.trim() === was.trim()) { sh.title = autoTitle(day); if (inp) inp.value = sh.title; }  // a title the person typed stays
}
// The details' own fields (the sets are saved from the 训练中 screen).
async function saveWorkout(sh, signal) {
  if (!S.db) return;
  const date = isDate(fval('f-date')) ? fval('f-date') : sh.existing.date;
  if (date > today()) throw badInput('日期不能晚于今天', 'f-date');
  const rpe = fval('f-rpe');
  const fields = {
    date, planDayId: sh.dayId === 'free' ? null : sh.dayId, title: fval('f-title') || autoTitle(planDays().find(d => d.id === sh.dayId)),
    durationMin: readNum('f-dur', '时长', { int: true, min: 0, max: 600 }), rpe: rpe ? Number(rpe) : null,
    feelings: chipVals('feel'), notes: fval('f-notes'),
  };
  const before = sh.existing;
  if (same(photoIds(sh.photos), before.photos) && !changedFields(fields, before).length) { await saved(sh); return; }
  setBusy('保存中…');
  fields.photos = S.assets ? await uploadPhotos(sh, 'photos', signal) : (before.photos || []);
  setBusy('保存中…');
  await saveFields('workouts', sh.id, before, { ...fields, needsReview: true, updatedAt: nowIso() }, signal);
  S.date = date; render();
  await saved(sh, vt('toast.workout', '训练已保存'));
}

/* ---------- 训练中: a session logged set by set, in the gym ----------
   开始训练 writes workouts/<id> at once: {date, planDayId, title, status: 'active', startedAt, exercises, needsReview: false,
   createdAt, updatedAt}. Every change is kept on the phone right away (localStorage lsj-live:<uid>) and written 1.2 s
   later, the whole record on its version (a conflict: the version is read again and the phone's copy written once
   more); without a signal it waits and writes when the page is back online, so a closed app or a dead spot loses
   nothing. 完成 drops status and adds endedAt, durationMin, rpe, feelings, notes and needsReview: true. While active the
   record stays out of S.workouts (COLS keeps it as S.activeWorkout). Sets use the 训记 import's fields: kg, reps, done,
   warmup, drop, bodyweight (kg = added weight), assist (kg null), sec; cardio is {cardio: true, metrics: {min, km?,
   kcal?}, sets: []}; an exercise may carry the person's note. Numbers not typed or stepped show as a grey suggestion
   (Claude's advice > the same set last time > the plan) and are filled in when the set is ticked; sets with neither a
   tick nor a number are not saved. A finished manual session can be edited on the same screen (mode 'edit': nothing is
   written until 保存, then only the changed fields, on the latest version). */
const LIVE_FRESH = 12 * 3600e3;  // started longer ago than this: the 训练 card asks to finish or drop it
const blankLive = () => ({ w: null, id: null, mode: 'live', ver: null, created: false, open: false, cur: 0, focus: null, rest: null, restOn: restPref().on,
  rev: 0, savedRev: 0, saving: null, again: false, t: null, retryT: null, offline: false, prs: {}, stale: null, base: null, dirty: false,
  finishing: false, booted: false, autoOpened: false, lastTop: '', lastExs: '', lastDock: '', detOpen: null, rir: null, later: null });
let LIVE = blankLive(), lvRestT = null;
const liveEl = document.createElement('div');
liveEl.id = 'live'; liveEl.className = 'live'; liveEl.hidden = true;
liveEl.setAttribute('role', 'dialog'); liveEl.setAttribute('aria-modal', 'true'); liveEl.setAttribute('aria-label', '训练中');
document.body.insertBefore(liveEl, sheetEl);
// 「训练进行中 · 32:10 · 继续」 under the title bar on every page while a session runs and its screen is put away
const liveBarEl = document.createElement('div');
liveBarEl.className = 'live-bar'; liveBarEl.hidden = true;
topEl.after(liveBarEl);

const lvKey = () => 'lsj-live:' + (S.me?.id || lsGet('lsj-uid') || '');
const startMs = w => Date.parse(w?.startedAt || w?.createdAt || '') || 0;
const isFresh = w => !!w && Date.now() - startMs(w) < LIVE_FRESH;
// The session being logged: the one on this phone, else the server's (another phone, or not opened here yet).
function activeWo() { return LIVE.w && LIVE.mode === 'live' ? { ...LIVE.w, id: LIVE.id } : S.activeWorkout; }
function lvElapsed(w, end) {
  const s = Math.max(0, Math.floor(((end ?? Date.now()) - (startMs(w) || Date.now())) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
}
const clockOf = iso => { const d = new Date(iso || ''); return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const r2 = v => Math.round(v * 100) / 100;
const nTxt = v => isNum(v) ? String(r2(v)) : '';
// A buzz where the phone allows it (only after the person has touched the page; iPhones ignore it)
const buzz = p => { try { if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(p); } catch (e) {} };
const CHEV_DOWN = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const WATCH = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9 6.5l.6-3.5h4.8l.6 3.5M9 17.5l.6 3.5h4.8l.6-3.5M12 9.6V12l1.6 1.2"/></svg>';

/* how an exercise is logged */
const EX_KINDS = [['kg', '负重'], ['bw', '自重'], ['assist', '辅助'], ['sec', '计时'], ['cardio', '有氧']];
const KIND_TXT = Object.fromEntries(EX_KINDS);
function exKind(x) {
  if (!x || typeof x !== 'object') return 'kg';
  if (x.cardio) return 'cardio';
  const ss = (x.sets || []).filter(s => s && typeof s === 'object');
  if (ss.some(s => isNum(s.assist) && s.assist > 0) || (ss.some(s => s.bodyweight) && (ss.some(s => 'assist' in s) || /辅助/.test(x.name || '')))) return 'assist';
  if (ss.some(s => s.bodyweight)) return 'bw';
  if (ss.length && ss.some(s => 'sec' in s) && !ss.some(s => isNum(s.reps))) return 'sec';
  return 'kg';
}
// 动作库 for 加动作: common exercises by body part, named as the plans and 训记 name them. 'name|kind|how|aliases':
// the kind when it isn't 负重 (bw 自重, sec 计时, assist 辅助, cardio 有氧), how it is done in one line (which machine,
// what to do), the words people search with (拉背, 推胸…), / between them.
const EX_LIB = [
  ['胸', ['杠铃卧推|kg|平凳上杠铃下到胸口再推起|卧推/平板卧推', '哑铃卧推|kg|平凳上两只哑铃推到胸口上方|哑铃推胸', '上斜哑铃卧推|kg|凳子调到 30°，哑铃推向上方|上斜', '上斜杠铃卧推|kg|上斜凳，杠铃下到锁骨上方|',
    '器械推胸|kg|坐在推胸机，握把推到手臂伸直|推胸/推的机器/推胸机', '哑铃飞鸟|kg|平凳上两臂张开再合到胸前|飞鸟', '蝴蝶机夹胸|kg|坐蝴蝶机，两臂向前夹到一起|夹胸/蝴蝶机', '绳索夹胸|kg|龙门架两边绳索，向前夹到胸前|',
    '俯卧撑|bw|手撑地，身体一条线下压再撑起|', '双杠臂屈伸|bw|双杠上撑住，前倾下沉再撑起|双杠', '跪姿俯卧撑|bw|膝盖着地的俯卧撑，先练这个|', '下斜俯卧撑|bw|脚垫高的俯卧撑，比标准的难|脚垫高俯卧撑',
    '俯卧撑（负重）|bw|背包里放东西的俯卧撑|负重俯卧撑']],
  ['背', ['引体向上|bw|握单杠悬垂，拉到下巴过杠|引体', '引体向上（辅助）|assist|辅助引体机，膝盖跪在垫上拉|辅助引体', '高位下拉|kg|坐在下拉机，宽握把拉到锁骨|拉背/坐着往下拉/下拉机', '宽距高位下拉|kg|下拉机，握得比肩宽拉到锁骨|',
    '对握高位下拉|kg|下拉机换对握把，拉到胸口|', '坐姿划船|kg|坐划船机，握把拉到肚子|拉的机器/坐姿拉', '杠铃划船|kg|俯身握杠铃，拉到小腹|', '俯卧哑铃划船|kg|趴上斜凳，哑铃拉到腰侧|',
    '器械坐姿划船|kg|划船机，胸贴垫拉到底|', '山羊挺身|bw|趴罗马椅，上身下放再抬平|挺身', '哑铃划船|kg|单手撑凳，另一手哑铃拉到腰侧|单臂划船/哑铃单臂划船', '椅间屈膝反向划船|bw|仰卧在桌下或两把椅子间，把身体拉上去|反向划船/澳式引体',
    '弹力绳-高位下拉|kg|弹力带挂高处，跪着往下拉到胸口|弹力带下拉/弹力带高位下拉']],
  ['腿', ['杠铃深蹲|kg|杠铃扛肩上蹲到大腿平行|蹲腿/深蹲', '哑铃酒杯深蹲|kg|哑铃抱胸前，蹲到底再站起|酒杯蹲', '器械倒蹬|kg|坐倒蹬机，双脚蹬板到腿伸直|蹬腿/倒蹬机/腿举', '哈克深蹲|kg|哈克机背靠垫，蹲到底再蹬起|哈克',
    '杠铃罗马尼亚硬拉|kg|微屈膝俯身，杠铃贴腿滑到小腿|罗马尼亚/RDL', '哑铃保加利亚蹲|kg|后脚搭凳，单腿蹲到底|保加利亚', '哑铃箭步蹲|kg|手持哑铃，迈步前蹲再站起|弓步/箭步', '腿屈伸|kg|坐腿屈伸机，小腿往上踢直|踢腿机/伸腿',
    '腿弯举|kg|趴腿弯举机，小腿往上勾|勾腿', '杠铃臀推|kg|背靠凳，杠铃压胯向上顶|臀推', '站姿器械提踵|kg|站提踵机，脚跟抬到最高|提踵', '哑铃直腿硬拉|kg|微屈膝俯身，哑铃贴腿滑到小腿|哑铃罗马尼亚硬拉/哑铃硬拉/哑铃RDL',
    '自重深蹲|bw|双脚与肩同宽，蹲到大腿平行再站起|徒手深蹲', '原地箭步蹲|bw|一脚向前迈一大步蹲下，后膝接近地面|箭步蹲/弓步蹲', '单腿深蹲|bw|单腿站着蹲到底，另一腿前伸|手枪蹲', '臀桥|bw|仰卧屈膝，臀部顶起到身体一条线|',
    '单腿臀桥|bw|仰卧单腿顶起臀部，另一腿伸直|', '毛巾腿弯举|bw|仰卧脚踩毛巾在光滑地面，脚跟滑向臀部|滑盘腿弯举/滑盘', '站姿哑铃提踵|kg|手持哑铃站台阶边，脚跟抬到最高|哑铃提踵', '哑铃单腿提踵|kg|单脚站台阶边，手持哑铃提踵|单腿提踵',
    '站姿自重提踵|bw|站台阶边，脚跟抬到最高再放到底|自重提踵']],
  ['肩', ['哑铃推肩|kg|坐直，两只哑铃从耳旁推到头顶|推肩/肩推', '杠铃推举|kg|站或坐，杠铃从锁骨推过头|推举', '器械推肩|kg|坐推肩机，握把推到手臂伸直|推肩机', '侧平举|kg|两手哑铃从身侧抬到与肩平|练肩/飞肩',
    '绳索侧平举|kg|龙门架低位，单手往外抬到肩高|', '蝴蝶机反向飞鸟|kg|反坐蝴蝶机，两臂向后张开|反向飞鸟', '面拉|kg|绳索齐脸高，拉向脸两侧|绳索面拉', '哑铃前平举|kg|哑铃从体前抬到肩高|前平举',
    '俯身飞鸟|kg|俯身，两手哑铃（或水瓶）向两侧抬起|俯身哑铃飞鸟/后束飞鸟', '弹力带-面拉|kg|弹力带固定齐脸高，拉向脸两侧|弹力带面拉', '派克俯卧撑|bw|臀部顶高成倒 V，头往地面压再撑起|', '靠墙倒立撑|bw|脚蹬墙倒立，弯肘下降再撑起|倒立撑']],
  ['手臂', ['哑铃弯举|kg|两手哑铃从身侧弯到肩前|二头/练二头/弯举', '杠铃弯举|kg|握杠铃从大腿前弯到胸前|', '锤式弯举|kg|哑铃对握，像抡锤子弯起|锤式', '上斜哑铃弯举|kg|躺上斜凳，两臂下垂往上弯|',
    '牧师凳弯举|kg|手臂搭牧师凳，弯举到顶|牧师凳', '直杆绳索下压|kg|龙门架高位直杆，往下压到伸直|三头/练三头/绳索下压', '绳索臂屈伸|kg|绳索高位，绳头向下拉开到伸直|', '仰卧杠铃臂屈伸|kg|躺平凳，杠铃从额头上方推直|臂屈伸',
    '哑铃臂屈伸|kg|双手托哑铃过头，从脑后推直|', '窄距俯卧撑|bw|双手窄于肩，肘贴身下压再撑起|三头俯卧撑']],
  ['核心', ['卷腹|bw|躺着屈膝，上背卷起离地|仰卧起坐/练腹', '平板支撑|sec|肘撑地，身体一条线撑住|平板/撑', '侧平板支撑|sec|侧身单肘撑地撑住|侧平板', '悬垂举腿|bw|悬在单杠上，腿抬到水平|举腿',
    '俄罗斯转体|bw|坐着后仰，上身左右转|转体', '死虫|bw|仰卧，对侧手脚交替伸直|', '健腹轮|bw|跪着推健腹轮向前再收回|腹轮', '平板蝴蝶收腹|bw|仰卧屈膝外展，卷腹收起|']],
  ['有氧', ['跑步|cardio|跑步机或户外|跑步机/跑', '快走|cardio|跑步机快走|走路', '爬坡走|cardio|跑步机加坡度走|爬坡', '动感单车|cardio|单车房或健身房的单车|单车/骑车', '椭圆机|cardio|踩椭圆机|',
    '划船机|cardio|坐划船机拉桨|划船机器/有氧划船', '跳绳|cardio|跳绳|', '爬楼机|cardio|踩爬楼机|爬楼']],
].map(([part, xs]) => [part, xs.map(x => { const [n, k, how, al] = x.split('|'); return { n, k: k || 'kg', part, how: how || '', al: (al || '').split('/').filter(Boolean) }; })]);
const EX_LIB_ALL = EX_LIB.flatMap(([, xs]) => xs);
const EX_LIB_KIND = new Map(EX_LIB_ALL.map(x => [x.n, x.k]));
const EX_LIB_BY = new Map(EX_LIB_ALL.map(x => [x.n, x]));
// How the five ways of logging read in the picker (a new name): the kind in plain words.
const EX_KIND_HELP = { kg: '有重量（杠铃/哑铃/器械）', bw: '只用体重（俯卧撑、引体）', assist: '器械帮一把（辅助引体）', sec: '按秒数（平板支撑）', cardio: '有氧（跑步、单车）' };
// 新手常用: the machine moves a beginner (profile.level new) sees first in the picker.
const EX_STARTER = ['器械推胸', '高位下拉', '坐姿划船', '器械倒蹬', '腿屈伸', '腿弯举', '器械推肩', '侧平举', '哑铃弯举', '直杆绳索下压', '卷腹', '平板支撑'];
// What stats.js shows under 动作进步's title: {part, how}.
const exInfo = name => { const x = EX_LIB_BY.get(String(name || '').trim()); return { part: exPart(name), how: x?.how || '' }; };
const EX_LIB_PART = new Map(EX_LIB_ALL.map(x => [x.n, x.part]));
// An exercise's body part (the 动作库's, else by its name; 划船机 is cardio before 划船 is back, 硬拉 legs before 背):
// 胸 背 腿 肩 手臂 核心 有氧, else 其他. Also for stats.js (window.LSJ.exPart).
function exPart(name) {
  const k = String(name || '').trim(); if (!k) return '其他';
  if (EX_LIB_PART.has(k)) return EX_LIB_PART.get(k);
  if (/划船机|跑|走|单车|骑行|椭圆|跳绳|爬楼|游泳|有氧/.test(k)) return '有氧';
  if (/硬拉|蹲|腿|提踵|臀|倒蹬|箭步/.test(k)) return '腿';
  if (/胸|卧推|推胸|飞鸟|夹胸|俯卧撑|双杠臂屈伸/.test(k)) return '胸';
  if (/绳索下拉|下压/.test(k)) return '手臂';  // triceps, before 下拉 counts as back
  if (/下拉|划船|引体|背|挺身/.test(k)) return '背';
  if (/推肩|平举|面拉|肩|推举/.test(k)) return '肩';
  if (/弯举|臂屈伸|下压|臂/.test(k)) return '手臂';
  if (/卷腹|平板|腹|核心|举腿|转体/.test(k)) return '核心';
  return '其他';
}
/* 每周各部位 (B1): what an exercise trains, by muscle. Nine buckets; a set counts 1 for each main muscle and 0.5 for each
   one it works on the side (the coach's table, v7-coach 附录 A); an overhead press is 0.5 肩 + 0.5 三头, a front raise
   0.5 肩, so the side and rear delts' own sets show through. {main, secondary, half} — half: the main ones count 0.5. */
const MUSCLES = ['胸', '背', '肩', '二头', '三头', '股四', '腘绳臀', '小腿', '核心'];
const MUSCLE_RANGE = { 胸: [10, 20], 背: [12, 22], 肩: [8, 20], 二头: [8, 14], 三头: [8, 14], 股四: [8, 16], 腘绳臀: [6, 14], 小腿: [6, 12], 核心: [4, 10] };
const MUSCLE_OF = [
  [/^(杠铃卧推|哑铃卧推|上斜哑铃卧推|上斜杠铃卧推|器械推胸|俯卧撑|双杠臂屈伸|跪姿俯卧撑|下斜俯卧撑|俯卧撑（负重）)$/, ['胸'], ['三头']],
  [/^(哑铃飞鸟|蝴蝶机夹胸|绳索夹胸)$/, ['胸'], []],
  [/^窄距俯卧撑$/, ['三头'], ['胸']],
  [/^(引体向上|引体向上（辅助）|高位下拉|宽距高位下拉|对握高位下拉|弹力绳-高位下拉)$/, ['背'], ['二头']],
  [/^(坐姿划船|器械坐姿划船|俯卧哑铃划船|哑铃划船|椅间屈膝反向划船)$/, ['背'], ['二头', '肩']],
  [/^杠铃划船$/, ['背'], ['二头', '腘绳臀']],
  [/^山羊挺身$/, ['腘绳臀'], ['背']],
  [/^(杠铃深蹲|哑铃酒杯深蹲|器械倒蹬|哑铃保加利亚蹲|哑铃箭步蹲|自重深蹲|原地箭步蹲|单腿深蹲)$/, ['股四'], ['腘绳臀']],
  [/^(哈克深蹲|腿屈伸)$/, ['股四'], []],
  [/^(杠铃罗马尼亚硬拉|哑铃直腿硬拉)$/, ['腘绳臀'], ['背']],
  [/^(腿弯举|杠铃臀推|臀桥|单腿臀桥|毛巾腿弯举)$/, ['腘绳臀'], []],
  [/^(站姿器械提踵|站姿哑铃提踵|哑铃单腿提踵|站姿自重提踵)$/, ['小腿'], []],
  [/^(哑铃推肩|杠铃推举|器械推肩|派克俯卧撑|靠墙倒立撑)$/, ['肩'], ['三头'], true],
  [/^(侧平举|绳索侧平举)$/, ['肩'], []],
  [/^(蝴蝶机反向飞鸟|面拉|俯身飞鸟|弹力带-面拉)$/, ['肩'], ['背']],
  [/^哑铃前平举$/, ['肩'], [], true],
  [/^(哑铃弯举|杠铃弯举|锤式弯举|上斜哑铃弯举|牧师凳弯举)$/, ['二头'], []],
  [/^(直杆绳索下压|绳索臂屈伸|仰卧杠铃臂屈伸|哑铃臂屈伸)$/, ['三头'], []],
  [/^(卷腹|平板支撑|侧平板支撑|悬垂举腿|俄罗斯转体|死虫|健腹轮|平板蝴蝶收腹)$/, ['核心'], []],
];
function exMuscles(name) {
  const k = String(name || '').trim(), none = { main: [], secondary: [], half: false };
  if (!k) return none;
  for (const [re, main, secondary, half] of MUSCLE_OF) if (re.test(k)) return { main, secondary, half: !!half };
  // not in the table: by the part its name says, with the usual helpers
  const p = exPart(k);
  if (p === '胸') return { main: ['胸'], secondary: /推|卧推|俯卧撑|双杠/.test(k) ? ['三头'] : [], half: false };
  if (p === '背') return { main: ['背'], secondary: /下拉|引体|划船|反向/.test(k) ? ['二头'] : [], half: false };
  if (p === '腿') {
    if (/提踵/.test(k)) return { main: ['小腿'], secondary: [], half: false };
    if (/硬拉|臀|弯举|桥|挺身/.test(k)) return { main: ['腘绳臀'], secondary: /硬拉/.test(k) ? ['背'] : [], half: false };
    return { main: ['股四'], secondary: /蹲|倒蹬|箭步/.test(k) ? ['腘绳臀'] : [], half: false };
  }
  if (p === '肩') {
    if (/推肩|推举|倒立/.test(k)) return { main: ['肩'], secondary: ['三头'], half: true };
    if (/反向飞鸟|面拉|后束|俯身/.test(k)) return { main: ['肩'], secondary: ['背'], half: false };
    return { main: ['肩'], secondary: [], half: /前平举/.test(k) };
  }
  if (p === '手臂') return { main: [/弯举|二头/.test(k) ? '二头' : '三头'], secondary: [], half: false };
  if (p === '核心') return { main: ['核心'], secondary: [], half: false };
  return none;
}
// What one set of this exercise adds to each bucket: {胸: 1, 三头: 0.5}.
function muscleWeights(name) {
  const m = exMuscles(name), out = {};
  for (const x of m.main) out[x] = (out[x] || 0) + (m.half ? 0.5 : 1);
  for (const x of m.secondary) out[x] = (out[x] || 0) + 0.5;
  return out;
}
// Training weekdays a week (the schedule's), and how often each plan day comes round: with a rotation of m days each is
// trained n/m times a week, else as often as the schedule names it.
function weeklyTrainDays(sch = S.plan?.training?.schedule) { return Object.values(sch && typeof sch === 'object' ? sch : {}).filter(v => typeof v === 'string' && v).length; }
function dayFreq(o = {}) {
  const days = o.days || planDays(), sch = o.schedule || S.plan?.training?.schedule || {}, rot = (o.rotation || rotation()).filter(id => days.some(d => d.id === id));
  const n = weeklyTrainDays(sch), out = {};
  if (rot.length) { for (const id of rot) out[id] = n / rot.length; }
  else for (const v of Object.values(sch)) if (typeof v === 'string' && v) out[v] = (out[v] || 0) + 1;
  return out;
}
// The plan's weekly sets per muscle, to the half set: {胸: 16, 背: 20, …}. o.days / o.schedule / o.rotation override the
// plan's (the day editor passes the day being edited).
function planWeeklySets(o = {}) {
  const days = o.days || planDays(), freq = dayFreq({ ...o, days }), out = Object.fromEntries(MUSCLES.map(m => [m, 0]));
  for (const d of days) {
    const f = freq[d.id] || 0; if (!f) continue;
    for (const x of d.exercises || []) {
      const n = parseInt(x?.sets, 10); if (!(n > 0)) continue;
      for (const [m, w] of Object.entries(muscleWeights(x.name))) out[m] += n * w * f;
    }
  }
  for (const m of MUSCLES) out[m] = Math.round(out[m] * 2) / 2;
  return out;
}
// The buckets as pills (the ones under the coach's range faint) and a line about the lowest one or two.
function muscleLineHTML(sets) {
  const pills = MUSCLES.map(m => { const [lo, hi] = MUSCLE_RANGE[m], v = sets[m] || 0; return `<span class="mus${v < lo ? ' low' : ''}" title="一般每周 ${lo}–${hi} 组">${esc(m)} <b class="num">${esc(String(v))}</b></span>`; }).join('');
  const low = MUSCLES.filter(m => (sets[m] || 0) < MUSCLE_RANGE[m][0]).sort((a, z) => (sets[a] || 0) / MUSCLE_RANGE[a][0] - (sets[z] || 0) / MUSCLE_RANGE[z][0]).slice(0, 2);
  const say = low.length ? `<p class="mus-say">${esc(low.map(m => `${m}每周只有 ${sets[m] || 0} 组（一般 ${MUSCLE_RANGE[m][0]}–${MUSCLE_RANGE[m][1]}）`).join('，'))}，可以再加 1–2 组，或者排到另一天再练一次</p>` : '<p class="mus-say ok">每块肌肉都在一般范围里（虚线的是低于范围）</p>';
  return `<div class="mus-row">${pills}</div>${say}`;
}
// A name's kind: as it was last done, else the plan's load / reps (自重, 秒), else the 动作库, else from the name.
function guessKind(name) {
  const key = String(name || '').trim();
  for (const w of [...S.workouts].sort(newestFirst)) {
    const e = (w.exercises || []).find(e => e && String(e.name || '').trim() === key);
    if (!e || !(e.cardio || (e.sets || []).some(hasSetData))) continue;
    const k = exKind(e), ds = (e.sets || []).filter(s => s && hasSetData(s));
    // older 训记 imports carry no body-weight marks: 辅助 in the name, or reps without any weight, tell it
    if (k === 'kg' && /辅助/.test(key)) return 'assist';
    if (k === 'kg' && ds.length && ds.every(s => !isNum(s.kg) && isNum(s.reps))) return 'bw';
    return k;
  }
  const px = planEx(key);
  if (px && /秒|\d\s*s\b/i.test(String(px.reps ?? ''))) return 'sec';
  if (px && /自重/.test(String(px.load ?? ''))) return /辅助/.test(key) ? 'assist' : 'bw';
  if (EX_LIB_KIND.has(key)) return EX_LIB_KIND.get(key);
  if (/辅助/.test(key)) return 'assist';
  if (/跑步|快走|单车|骑行|椭圆机|跳绳|游泳|划船机|爬楼|有氧/.test(key)) return 'cardio';
  if (/平板支撑|靠墙静蹲|悬垂|静力/.test(key)) return 'sec';
  if (/引体向上|俯卧撑|双杠臂屈伸|卷腹|仰卧起坐|自重/.test(key)) return 'bw';
  return 'kg';
}
function blankSet(kind, o = {}) {
  const s = kind === 'bw' ? { bodyweight: true, kg: null, reps: null } : kind === 'assist' ? { bodyweight: true, assist: null, kg: null, reps: null }
    : kind === 'sec' ? { kg: null, sec: null } : { kg: null, reps: null };
  return { ...s, done: false, ...o };
}
// The numbers of a set row: [field, label, step, whole numbers]. Weights go up 2.5 kg unless the move has its own step
// (stepOf), reps 1, seconds 5.
function setFields(kind, step = 2.5) {
  if (kind === 'sec') return [['sec', '秒', 5, true]];
  if (kind === 'assist') return [['assist', '助力 kg', step, false], ['reps', '次数', 1, true]];
  return [['kg', kind === 'bw' ? '加重 kg' : '重量 kg', step, false], ['reps', '次数', 1, true]];
}
// The step of a set's field in 训练中: the exercise's weight step (stepOf), the smallest help difference for an
// assisted move, 1 rep, 5 s.
function lvStepOf(x, f) {
  if (f === 'kg') return stepOf(x?.name, LIVE.w?.planDayId);
  if (f === 'assist') return stepHist(String(x?.name || '').trim(), 'assist') ?? 2.5;
  return f === 'sec' ? 5 : 1;
}
// The last note written on this exercise (座椅 4 档、对握), carried into a new session's copy of it.
function lastNote(name) {
  const key = String(name || '').trim(); if (!key) return '';
  for (const w of [...S.workouts].sort(newestFirst)) {
    const e = (w.exercises || []).find(e => e && String(e.name || '').trim() === key);
    if (e) return typeof e.note === 'string' ? e.note.trim().slice(0, 300) : '';
  }
  return '';
}
const lastCount = name => { const h = exHistory(name, today()); return h.last ? workSets(h.last.sets).length : 0; };
// A new exercise: the plan's sets and target (px: the plan's exercise), else as many sets as last time, else 3.
function liveEx(name, kind, px) {
  if (kind === 'cardio') return { name, cardio: true, metrics: {}, sets: [] };
  const n = Math.max(1, Math.min(10, parseInt(px?.sets, 10) || lastCount(name) || 3));
  const target = px ? [`${px.sets ?? ''}×${px.reps ?? ''}`, px.load, px.rest ? `休息 ${px.rest}` : ''].filter(Boolean).join(' · ') : '';
  const note = lastNote(name);  // last time's note comes along (editable, deletable)
  return { name, target, restSec: px ? parseRest(px.rest) : null, sets: Array.from({ length: n }, () => blankSet(kind)), ...(note ? { note } : {}) };
}

/* suggestions: what a set would be if ticked as it is */
// The prescription (lvRx: Claude's advice, the rule from last time, or the plan) sets the advised numbers: Claude's
// kg × reps; the rule's new weight (or less help, more seconds) with the low end of the range when it changed, last
// time's weight when it keeps (reps then follow the same set last time).
function lvBase(x) {
  const w = LIVE.w, h = exHistory(x.name, w.date, LIVE.id), kind = exKind(x);
  const rx = kind === 'cardio' || LIVE.mode === 'edit' ? null : lvRx(x, h), rule = rx?.src === 'rule' || rx?.src === 'deload' ? rx : null;
  const adv = rx?.src === 'claude' ? String(h.advice || '').replace(/[（(].*$/, '') : '';
  // Claude's weight as the prescription shows it (snapped to the step), its reps as written
  const num = re => { const m = re.exec(adv); return m ? Number(m[1]) : null; };
  const rxKg = rx?.src === 'claude' && rx.load ? Number((/(\d+(?:\.\d+)?)\s*kg/i.exec(rx.load) || [])[1]) : NaN;
  const all = (h.last?.sets || []).filter(s => s && typeof s === 'object');
  const work = all.filter(s => !s.warmup && !s.drop && hasSetData(s));
  const px = planEx(x.name, w.planDayId), pl = String(px?.load ?? '').trim();
  const pKg = /^(\d+(?:\.\d+)?)\s*kg$/i.exec(pl), pr = repRange(px?.reps), pSec = /(\d+)\s*(?:s|秒)/i.exec(String(px?.reps ?? ''));
  const wk = workOf(h.last?.sets), used = work.some(s => s.done) ? work.filter(s => s.done) : work;
  // last time's drop sets, each with the set it came straight after (a working set or the drop before it)
  const drops = []; let par = null;
  for (const s of all) { if (s.warmup) { par = null; continue; } if (s.drop && par && hasSetData(s)) drops.push({ s, par }); par = s; }
  // The rule's reps: one number (「先做到 6 次」 after a break, a lighter weight's low end) is what every set gets — 这次,
  // the grey numbers and the dock say the same; a range (8–12) leaves each set to last time's same set, kept inside
  // it (rRange; lvSug), or its low end when the weight changed.
  const moved = !!rule && (rule.up || rule.down), rr = rule && kind !== 'sec' ? repRange(rule.reps) : null;
  const ruleReps = !rr ? null : rr[0] === rr[1] ? rr[0] : moved ? rr[0] : null;
  // last time's working sets in order; the lighter ones before the working weight were warm-ups (workOf), not set 1
  return { advKg: rule ? (kind === 'kg' && isNum(rule.kg) ? rule.kg : null) : Number.isFinite(rxKg) ? rxKg : num(/(\d+(?:\.\d+)?)\s*kg/i), advReps: rule ? ruleReps : num(/[×x*]\s*(\d+)/i),
    rRange: rr && rr[0] !== rr[1] ? rr : null,
    advAssist: rule && isNum(rule.assist) ? rule.assist : null, advSec: rule && isNum(rule.sec) ? rule.sec : null, rx,
    lw: wk ? used.filter(s => !wk.warm.has(s)) : used,
    warm: all.filter(s => hasSetData(s) && (s.warmup || wk?.warm.has(s))), drops, pKg: pKg ? Number(pKg[1]) : null, pReps: pr ? pr[0] : null, pSec: pSec ? Number(pSec[1]) : null };
}
// Last time's drop set after a set of the weight p has (f: kg, or assist for an assisted move), or null.
const dropMatch = (b, p, f) => isNum(p[f]) ? (b.drops || []).find(d => d.par[f] === p[f] && isNum(d.s[f]))?.s || null : null;
// A drop set's weight: about ¾ of the set before, to the exercise's step and at least one step lighter; none left
// (a light dumbbell) is null. A drop on an assisted move takes one step more help.
function dropLoad(p, kind, st) {
  if (kind === 'assist') return { kg: null, assist: isNum(p.assist) ? r2(p.assist + st) : p.assist };
  if (!isNum(p.kg) || p.kg <= 0) return { kg: p.kg, assist: p.assist };
  let kg = toStep(p.kg * 0.75, st); if (kg >= p.kg) kg = r2(p.kg - st);
  return { kg: kg > 0 ? kg : kind === 'bw' ? 0 : null, assist: p.assist };
}
const firstNum = (...vs) => { for (const v of vs) if (isNum(v)) return v; return null; };
// Claude's advice (21 days) or the rule > the same working set last time > the plan; a working set after one already
// done or changed follows its weight; warm-ups: last time's, else half the working weight × 10; a drop set: what last
// time's drop after a set of the same weight was, else ¾ of the set before (dropLoad) with its reps.
function lvSug(x, j, b) {
  const sets = x.sets || [], s = sets[j] || {}, kind = exKind(x);
  if (s.warmup) {
    const lwm = b.warm[sets.slice(0, j).filter(p => p.warmup).length] || null;
    const k = sets.findIndex(p => !p.warmup && !p.drop), wk = k >= 0 ? lvVal(x, k, b) : {};
    return { kg: firstNum(lwm?.kg, isNum(wk.kg) && wk.kg > 0 ? toStep(wk.kg * 0.5, lvStepOf(x, 'kg')) : null), reps: firstNum(lwm?.reps, 10), sec: firstNum(lwm?.sec), assist: firstNum(lwm?.assist) };
  }
  let k = j - 1; while (k >= 0 && sets[k].warmup) k--;
  if (s.drop && k >= 0) {
    const p = lvVal(x, k, b), f = kind === 'assist' ? 'assist' : 'kg', same = dropMatch(b, p, f);
    if (same) return { kg: kind === 'assist' ? null : same.kg, reps: firstNum(same.reps, p.reps), sec: p.sec, assist: kind === 'assist' ? same.assist : p.assist };
    return { ...dropLoad(p, kind, lvStepOf(x, f)), reps: p.reps, sec: p.sec };
  }
  const wj = sets.slice(0, j).filter(p => !p.warmup && !p.drop).length, last = b.lw[wj] || b.lw[b.lw.length - 1] || null;
  const lastReps = isNum(last?.reps) && b.rRange ? Math.min(b.rRange[1], Math.max(b.rRange[0], last.reps)) : last?.reps;
  let kg = kind === 'assist' ? null : firstNum(b.advKg, last?.kg, kind === 'kg' ? b.pKg : null), reps = firstNum(b.advReps, lastReps, b.pReps), sec = firstNum(b.advSec, last?.sec, b.pSec), assist = firstNum(b.advAssist, last?.assist, kind === 'assist' && !last?.bodyweight ? last?.kg : null);
  // each number from the nearest working set before with one there (typed or ticked): 24 typed on set 1 carries to
  // sets 2, 3 and 4 alike; reps only when nothing else says them
  const need = { kg: kind !== 'assist', assist: true, sec: true, reps: !isNum(reps) };
  for (let q = j - 1; q >= 0 && (need.kg || need.assist || need.sec || need.reps); q--) {
    const p = sets[q]; if (p.warmup || p.drop) continue;
    if (need.kg && isNum(p.kg)) { kg = p.kg; need.kg = false; }
    if (need.assist && isNum(p.assist)) { assist = p.assist; need.assist = false; }
    if (need.sec && isNum(p.sec)) { sec = p.sec; need.sec = false; }
    if (need.reps && isNum(p.reps)) { reps = p.reps; need.reps = false; }
  }
  return { kg, reps, sec, assist };
}
function lvVal(x, j, b) {  // a set's numbers: what was entered, else the suggestion
  const s = x.sets?.[j] || {}, g = lvSug(x, j, b);
  return { kg: isNum(s.kg) ? s.kg : g.kg, reps: isNum(s.reps) ? s.reps : g.reps, sec: isNum(s.sec) ? s.sec : g.sec, assist: isNum(s.assist) ? s.assist : g.assist };
}
const lvValTxt = (v, kind) => kind === 'sec' ? `${isNum(v.sec) ? v.sec : '–'} 秒` : setTxt({ kg: v.kg, reps: v.reps, sec: kind === 'sec' ? v.sec : null, bodyweight: kind === 'bw' || kind === 'assist', assist: kind === 'assist' ? v.assist : null }, true);
// 第 N 组 counts the working sets only (warm-ups and drop sets have their own names)
const setNo = (x, j) => x.sets.slice(0, j + 1).filter(p => !p.warmup && !p.drop).length;
const setLabel = (x, j) => { const s = x.sets[j]; return s.warmup ? '热身组' : s.drop ? '递减组' : `第 ${setNo(x, j)} 组`; };
// A drop set to do straight away (训练中): the set before it ticked and nothing after it in the exercise ticked yet.
const dropNow = (x, j) => LIVE.mode === 'live' && !!x.sets[j]?.drop && !!x.sets[j - 1]?.done && !x.sets.slice(j + 1).some(p => p.done);

/* the session's plan day, this time's prescription */
const lvPd = () => planDays().find(x => x.id === LIVE.w?.planDayId) || null;
// This time's prescription for an exercise of the session (h: its exHistory when already looked up); an exercise not
// in the plan only has one from Claude or the rule.
function lvRx(x, h) {
  const w = LIVE.w, px = planEx(x.name, w.planDayId), last = w.planDayId ? lastDayOf(w.planDayId, w.date) : null;
  const rx = exRx(px || { name: x.name, sets: (x.sets || []).filter(s => !s.warmup && !s.drop).length }, w.date, !!last && daysBetween(last, w.date) >= 10, { dayId: w.planDayId, excludeId: LIVE.id, h });
  return !px && rx.src === 'plan' ? null : rx;
}
// 杠铃配重: 「每边 15 kg = 10 + 5（杆 20 kg）」 for a weight on a 20 kg bar, from 25 / 20 / 15 / 10 / 5 / 2.5 / 1.25 plates;
// nothing at 20 kg or under, or when it doesn't come out in plates. platesSide: just 「16.25」 for the dock button.
function platesCalc(kg) {
  if (!isNum(kg) || kg <= 20) return null;
  const side = r2((kg - 20) / 2); if (Math.abs(side / 1.25 - Math.round(side / 1.25)) > 1e-6) return null;
  const parts = []; let left = side;
  for (const p of [25, 20, 15, 10, 5, 2.5, 1.25]) while (left >= p - 1e-6) { parts.push(p); left = r2(left - p); }
  return { side, parts };
}
const platesTxt = kg => { const p = platesCalc(kg); return p ? `配重 每边 ${p.side} kg = ${p.parts.join(' + ')}（杆 20 kg）` : ''; };
const platesSide = kg => { const p = platesCalc(kg); return p ? String(p.side) : ''; };
const isBarbell = x => !!x && exKind(x) === 'kg' && /杠铃/.test(String(x.name || ''));
// The plates line of a barbell exercise (名字含「杠铃」, logged in kg): for the set in focus when it is in this exercise,
// else the first working set. Static text: lvPatch leaves it, the redraw after typing brings it up to date.
function platesLine(x, i, b) {
  const sets = x.sets || [];
  const j = LIVE.focus?.i === i && sets[LIVE.focus.j] ? LIVE.focus.j : sets.findIndex(s => !s.warmup && !s.drop);
  if (j < 0) return '';
  const t = platesTxt(lvVal(x, j, b).kg);
  return t ? `<p class="lv-i lv-plates">${esc(t)}</p>` : '';
}
const rxLine = rx => rx.raw || [rx.load, rx.reps ? `${rx.reps} 次` : '', rx.sets !== '' && rx.sets != null ? `${rx.sets} 组` : ''].filter(Boolean).join(' × ');

/* records: what this session beat (ticked sets only while it runs) */
function lvPrsOf(w) {
  const f = window.LSJData?.prs; if (typeof f !== 'function' || !w) return {};
  try {
    const all = f([...S.workouts.filter(x => x.id !== LIVE.id), w]) || {}, out = {};
    for (const [n, r] of Object.entries(all)) { const rec = (Array.isArray(r?.recent) ? r.recent : []).find(x => x && x.id === LIVE.id && prShown(x)); if (rec) out[n] = rec; }
    return out;
  } catch (e) { console.error(e); return {}; }
}
const lvDoneOnly = () => ({ ...LIVE.w, id: LIVE.id, exercises: (LIVE.w.exercises || []).map(x => x.cardio ? x : { ...x, sets: (x.sets || []).filter(s => s && s.done) }) });
// 新纪录: a sticker in the abstract style, a toast in the plain one.
function popPr(name, text) {
  const head = vt('live.pr', '新纪录！');
  if (!LV()?.on()) { toast(`${head}${name} ${text}`); return; }
  let el = $('#pr-pop');
  if (!el) { el = document.createElement('div'); el.id = 'pr-pop'; el.className = 'pr-pop'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  const m = /^(.*?)\s*([（(].*)$/.exec(text), main = m ? m[1] : text, sub = m ? m[2] : '';
  el.innerHTML = `<div class="pp-card"><span class="pp-k">${esc(head)}</span><b class="pp-n">${esc(name)}</b><span class="pp-v num">${esc(main)}</span>${sub ? `<span class="pp-x num">${esc(sub)}</span>` : ''}${'<i class="pp-s" aria-hidden="true"></i>'.repeat(6)}</div>`;
  el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  clearTimeout(popPr.t); popPr.t = setTimeout(() => { el.hidden = true; }, 3200);
}

/* keeping it: on the phone at once, on the server shortly after */
// A correction or 补记 not saved yet: on the phone too (lsj-edit:<uid>), so a reload or the phone dropping the page
// brings it back (lvBoot); gone when saved or closed.
const lvEditKey = () => 'lsj-edit:' + (S.me?.id || lsGet('lsj-uid') || '');
function lvPersist() {
  if (LIVE.w && LIVE.mode === 'edit' && LIVE.dirty) lsSet(lvEditKey(), JSON.stringify({ id: LIVE.id, w: LIVE.w, base: LIVE.base, ver: LIVE.ver, isNew: !!LIVE.isNew, at: Date.now(), focus: LIVE.focus || null, cur: LIVE.cur }));
  if (!LIVE.w || LIVE.mode !== 'live') return;
  lsSet(lvKey(), JSON.stringify({ id: LIVE.id, w: LIVE.w, ver: LIVE.ver, created: LIVE.created, rest: LIVE.rest, restOn: LIVE.restOn, later: LIVE.later || null, dirty: LIVE.rev !== LIVE.savedRev, focus: LIVE.focus || null, cur: LIVE.cur }));
}
function lvChanged(redraw = true) {
  if (!LIVE.w) return;
  LIVE.rev++; LIVE.w.updatedAt = nowIso();
  LIVE.stale = null;  // carried on after all: it ends when it is finished
  if (LIVE.mode === 'live') { lvPersist(); clearTimeout(LIVE.t); LIVE.t = setTimeout(lvSave, 1200); }
  else { LIVE.dirty = true; lvPersist(); }
  if (redraw) drawLive(); else drawDock();
}
// The whole record on its version; on a conflict the version is read again and the phone's copy wins (once).
async function lvPut(id, doc, signal) {
  const ref = S.db.collection('workouts').doc(id);
  let ver = LIVE.id === id && LIVE.ver != null ? LIVE.ver : (S.db.cached('workouts', id)?.version ?? 0);
  for (let i = 0; ; i++) {
    try { const r = await retry1(() => ref.set(doc, { ifVersion: ver, signal })); if (LIVE.id === id) LIVE.ver = r.version; return r; }
    catch (e) { if (e?.code !== 'conflict' || i >= 1) throw e; ver = (await retry1(() => ref.get({ signal }))).version; }
  }
}
function lvSave() {
  clearTimeout(LIVE.t);
  if (!LIVE.w || LIVE.mode !== 'live' || !S.db || LIVE.finishing) return Promise.resolve();
  if (LIVE.saving) { LIVE.again = true; return LIVE.saving; }
  const rev = LIVE.rev, id = LIVE.id, doc = clone(LIVE.w);
  LIVE.saving = (async () => {
    let ok = false;
    try {
      await lvPut(id, doc);
      ok = true;
      if (LIVE.id === id) { LIVE.savedRev = Math.max(LIVE.savedRev, rev); LIVE.created = true; LIVE.offline = false; lvPersist(); }
    } catch (e) {
      if (LIVE.id === id) {
        LIVE.offline = true;
        clearTimeout(LIVE.retryT); LIVE.retryT = setTimeout(lvSave, 15000);
        if (e?.code === 'unauthenticated') toast('登录失效了：这次训练先存在手机上，重新登录后会接着存', true);
      }
    } finally {
      if (LIVE.id === id) {
        LIVE.saving = null;
        if (ok && (LIVE.again || LIVE.rev !== LIVE.savedRev)) { LIVE.again = false; LIVE.t = setTimeout(lvSave, 300); }
        if (LIVE.open) drawTop();
      }
    }
  })();
  return LIVE.saving;
}
// After the workouts load or change: pick up the session (this phone's copy or the server's) once; later, let go of one
// that was finished or dropped on another phone.
function liveSync() {
  if (!S.me || !S.db || !S.loaded.has('workouts')) return;
  if (!LIVE.booted) { lvBoot(); return; }
  if (LIVE.w && LIVE.mode === 'live' && LIVE.created && !LIVE.open && !LIVE.saving && !LIVE.finishing && LIVE.rev === LIVE.savedRev) {
    const c = S.db.cached('workouts', LIVE.id);
    if (!c?.exists || c.data?.status !== 'active') lvEnd();
    else if (c.version > (LIVE.ver ?? 0)) { const keep = { rest: LIVE.rest, restOn: LIVE.restOn }; lvAdopt({ ...c.data, id: LIVE.id }); Object.assign(LIVE, keep); }
  }
}
function lvBoot() {
  LIVE.booted = true;
  let d = null; try { d = JSON.parse(lsGet(lvKey()) || 'null'); } catch (e) {}
  if (d && d.id && d.w && typeof d.w === 'object') {
    const c = S.db.cached('workouts', d.id), srv = c?.exists ? c.data : null;
    if (srv && srv.status !== 'active') d = null;  // finished on another phone
    else if (!srv && d.created) d = null;          // dropped on another phone
    else if (srv && (Date.parse(srv.updatedAt || '') || 0) > (Date.parse(d.w.updatedAt || '') || 0)) d = null;  // the server's is newer
    if (d) {
      Object.assign(LIVE, { w: d.w, id: d.id, mode: 'live', ver: c?.exists ? c.version : 0, created: !!c?.exists, rest: d.rest || null, restOn: d.restOn !== false, later: typeof d.later === 'string' ? d.later : null });
      const newer = !srv || (Date.parse(d.w.updatedAt || '') || 0) > (Date.parse(srv.updatedAt || '') || 0);
      if (newer) { LIVE.rev = 1; LIVE.savedRev = 0; lvSave(); }
      // back where it was (a reload, the phone dropping the page): the open exercise and the set in focus, when still there
      const f = d.focus, xs = LIVE.w.exercises || [];
      if (f && Number.isInteger(f.i) && Number.isInteger(f.j) && xs[f.i]?.sets?.[f.j]) { LIVE.focus = { i: f.i, j: f.j }; LIVE.cur = xs[d.cur] ? d.cur : f.i; }
      else lvFocusFirst();
    }
  }
  if (!d) { lsSet(lvKey(), null); if (S.activeWorkout) lvAdopt(S.activeWorkout); }
  if (!LIVE.w) lvEditBack();
  if (LIVE.rest) lvRestLoop();
  // opening the app while a session runs: straight back into it
  if (LIVE.w && isFresh(LIVE.w) && !LIVE.autoOpened && !S.sheet) { LIVE.autoOpened = true; openLive(); }
  render();
}
// A correction or 补记 left unsaved (within a week, its session still there): back on the screen where it was.
function lvEditBack() {
  let d = null; try { d = JSON.parse(lsGet(lvEditKey()) || 'null'); } catch (e) {}
  const base = d && !d.isNew ? S.workouts.find(x => x.id === d.id) : null;
  if (!d || !d.w || typeof d.w !== 'object' || !d.id || !(Date.now() - d.at < 7 * 86400e3) || (!d.isNew && !base) || base?.source === 'xunji') { lsSet(lvEditKey(), null); return; }
  LIVE = { ...blankLive(), booted: true, autoOpened: true, w: d.w, id: d.id, mode: 'edit', base: d.isNew ? null : d.base || clone(base), ver: d.ver ?? null, isNew: !!d.isNew, dirty: true };
  const f = d.focus, xs = LIVE.w.exercises || [];
  if (f && xs[f.i]?.sets?.[f.j]) { LIVE.focus = { i: f.i, j: f.j }; LIVE.cur = xs[d.cur] ? d.cur : f.i; } else { LIVE.cur = 0; lvFocusFirst(); }
  if (!S.sheet) { openLive(); toast(d.isNew ? `接着补记 ${md(d.w.date)} 的训练（还没保存）` : `接着改 ${md(d.w.date)} 的记录（还没保存）`); }
}
function lvAdopt(a) {
  const { id, ...w } = clone(a);
  Object.assign(LIVE, { ...blankLive(), booted: true, autoOpened: LIVE.autoOpened, open: LIVE.open, w, id, mode: 'live', ver: S.db?.cached('workouts', id)?.version ?? null, created: true });
  lvFocusFirst();
}
function lvEnd() {
  clearTimeout(LIVE.t); clearTimeout(LIVE.retryT); clearInterval(lvRestT); lvRestT = null;
  laterClear();
  if (LIVE.mode === 'live') lsSet(lvKey(), null); else lsSet(lvEditKey(), null);
  const wasOpen = LIVE.open;
  LIVE = { ...blankLive(), booted: true, autoOpened: true };
  if (wasOpen) closeLive(); else render();
}

/* start, open, put away */
function startLive(dayId) {
  if (!S.db || !S.loaded.has('workouts')) return;
  const a = activeWo();
  if (a) {
    if (isFresh(a)) { openLive(); toast('这次训练还没点完成，接着练'); }
    else openStale(dayId);
    return;
  }
  if (LIVE.w && LIVE.mode === 'edit') lvEnd();
  const d = today(), day = planDays().find(x => x.id === dayId) || null, now = nowIso(), dl = inDeload(d);
  const w = {
    date: d, planDayId: day ? day.id : null, title: autoTitle(day), status: 'active', startedAt: now,
    // a deload week: half the plan's sets (at least 2)
    exercises: day ? (day.exercises || []).filter(x => x && typeof x === 'object' && String(x.name || '').trim()).map(x => liveEx(String(x.name).trim(), guessKind(x.name), dl ? { ...x, sets: deloadSets(x.sets) } : x)) : [],
    needsReview: false, createdAt: now, updatedAt: now,
  };
  LIVE = { ...blankLive(), booted: true, autoOpened: true, w, id: newId('w'), ver: 0 };
  lvFocusFirst(); lvPersist(); openLive(); lvSave();
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch (e) {}
}
function openStale(dayId) {
  const a = activeWo(), st = woStats(a);
  S.sheet = { type: 'live-stale', dayId, photos: [], removed: [] };
  showSheet('上次的训练没点完成', `<div class="panel panel-pad stack"><p><b>${esc(woTitle(a))}</b> · ${esc(mdw(a.date))} ${esc(clockOf(a.startedAt))} 开始，打勾了 ${st.done} 组。</p><p class="hint" style="margin:0">先把它点完成或者放弃，再开始新的。</p></div>`,
    '<button type="button" class="btn ghost danger" data-act="lv-stale-drop">放弃它，开始新的</button><button type="button" class="btn primary main" data-act="lv-stale-finish" data-close="1">先把它完成</button>');
}
function lvStaleFinish() {
  const a = activeWo(); if (!a) return;
  if (!LIVE.w || LIVE.mode !== 'live') lvAdopt(a);
  LIVE.stale = LIVE.w.updatedAt || nowIso();
  openLive(); lvFinish();
}
function openLive() {
  if (!S.db) return;
  if (!LIVE.w) { if (!S.activeWorkout) return; lvAdopt(S.activeWorkout); }
  if (HIST.open) closeHist();  // 「改动作和组数」 on a session opened from 训练历史: the screen comes to the front
  if (LIVE.mode === 'live' && LIVE.stale && isFresh(LIVE.w)) LIVE.stale = null;
  LIVE.open = true; liveEl.hidden = false; document.documentElement.classList.add('live-on'); layerSync();
  if (!LIVE.focus) lvFocusFirst();
  LIVE.prs = lvPrsOf(lvDoneOnly());
  LIVE.lastTop = LIVE.lastExs = LIVE.lastDock = '';
  liveEl.innerHTML = '';
  drawLive(); keepAwake(wakeOn()); render();
  requestAnimationFrame(() => lvScrollTo(LIVE.focus ? `.lv-set[data-i="${LIVE.focus.i}"][data-j="${LIVE.focus.j}"]` : null, 'center'));
}
function closeLive() {
  LIVE.open = false; liveEl.hidden = true; liveEl.innerHTML = ''; document.documentElement.classList.remove('live-on');
  keepAwake(false); render(); layerSync();
}
function lvScrollTo(sel, block = 'nearest') {
  const el = sel && $(sel, liveEl); if (!el) return;
  try { el.scrollIntoView({ block, behavior: block === 'center' ? 'auto' : 'smooth' }); } catch (e) { el.scrollIntoView(); }
}

/* drawing: the top bar, the exercises (the open one in full, the others one line each), the dock at the bottom */
function drawLive() {
  if (!LIVE.open || !LIVE.w) return;
  if (!$('#lv-exs', liveEl)) {
    liveEl.innerHTML = '<div class="lv-top" id="lv-top"></div><div class="lv-body" id="lv-body"><div class="lv-exs" id="lv-exs"></div></div><div class="lv-dock" id="lv-dock"></div>';
    LIVE.lastTop = LIVE.lastExs = LIVE.lastDock = '';
  }
  drawTop();
  // while a number is being typed the list is not rebuilt (a phone would drop its keyboard): the other fields' numbers
  // and suggestions are patched in place, and the list is redrawn once the typing is over
  const ae = document.activeElement, typing = !!ae && ae.tagName === 'INPUT' && liveEl.contains(ae);
  const h = lvBodyHTML();
  if (h !== LIVE.lastExs) {
    if (typing) lvPatch(ae);
    else { $('#lv-exs', liveEl).innerHTML = h; LIVE.lastExs = h; }
  }
  drawDock();
}
function lvPatch(skip) {
  const xs = LIVE.w?.exercises || [], bs = new Map();
  liveEl.querySelectorAll('input.lv-v[data-lf]').forEach(el => {
    const i = +el.dataset.i, j = +el.dataset.j, f = el.dataset.lf, x = xs[i], s = x?.sets?.[j]; if (!s) return;
    if (!bs.has(i)) bs.set(i, lvBase(x));
    const g = lvSug(x, j, bs.get(i))[f], ph = isNum(g) ? nTxt(g) : f === 'kg' && exKind(x) === 'bw' ? '0' : '–';
    if (el.placeholder !== ph) el.placeholder = ph;
    if (el !== skip && el.value !== nTxt(s[f])) el.value = nTxt(s[f]);
  });
}
function drawTop() {
  const el = $('#lv-top', liveEl); if (!el || !LIVE.w) return;
  const h = lvTopHTML(); if (h === LIVE.lastTop) return;
  el.innerHTML = h; LIVE.lastTop = h; liveTick();
}
function drawDock() {
  const el = LIVE.open && $('#lv-dock', liveEl); if (!el) return;
  const h = lvDockHTML(); if (h === LIVE.lastDock) return;
  el.innerHTML = h; LIVE.lastDock = h; lvRestTick();
}
function lvTopHTML() {
  const w = LIVE.w, pd = lvPd(), edit = LIVE.mode === 'edit';
  const name = `<span class="lv-nm">${esc(String(w.title || '').trim() ? woTitle(w) : pd ? pd.name || dayShort(pd) : '训练')}</span>`;
  // progress: exercises with every set ticked (cardio: logged) / all, sets ticked / all
  const xs = w.exercises || [], st = woStats({ ...w, id: LIVE.id });
  const exDone = xs.filter(x => x && (x.cardio ? !!metricsTxt(x.metrics) : (x.sets || []).some(s => !s.warmup) && (x.sets || []).filter(s => !s.warmup).every(s => s.done))).length;
  const prog = xs.length ? `<span class="lv-prog num">${exDone}/${xs.length} 动作 · ${st.done}/${st.sets} 组</span>` : '';
  // 减量周 and 今天保守 (a recovery warning on the day: keep the weights, no records) as small tags after the clock
  const cons = !edit && w.date <= today() && recovery(w.date).warn ? '<button type="button" class="lv-dl lv-cons" data-act="lv-cons" aria-label="今天保守：为什么">今天保守</button>' : '';
  const sub = edit ? `<span>${LIVE.isNew ? `补记 ${esc(mdw(w.date))}` : `改 ${esc(mdw(w.date))} 的记录`}</span>${prog}` : `<span class="num" data-lv-clock></span>${w.date !== today() ? `<span>${esc(md(w.date))}</span>` : ''}${prog}${inDeload(w.date) ? '<span class="lv-dl">减量周</span>' : ''}${cons}${LIVE.offline ? '<span class="lv-off">没联网，先存在手机上</span>' : ''}`;
  return `<button type="button" class="icon-btn lv-min" data-act="${edit ? 'lv-edit-close' : 'lv-min'}" aria-label="${edit ? '不改了，关掉' : '收起，先看别的页面'}">${edit ? '×' : CHEV_DOWN}</button>
    <div class="lv-tt"><b class="lv-name">${name}</b><span class="lv-sub">${sub}</span></div>
    <button type="button" class="icon-btn lv-more" data-act="lv-more" aria-label="更多：改日期、名字、组间计时${edit ? '' : '，放弃这次训练'}">⋯</button>
    <button type="button" class="btn primary sm lv-done" data-act="lv-finish">${edit ? '保存' : esc(vt('btn.liveDone', '完成'))}</button>`;
}
// The exercises (the open one in full, the others one line each), the watch note at the bottom, 加动作.
function lvBodyHTML() {
  const w = LIVE.w, xs = w.exercises || [];
  return `${xs.length ? `<div class="lv-list">${xs.map((x, i) => i === LIVE.cur ? lvExOpen(x, i) : lvExRow(x, i)).join('')}</div>` : `<div class="lv-empty">${esc(vt('live.empty', '还没有动作。点「加动作」，从计划、练过的或动作库里挑，也可以直接写名字。'))}</div>`}
    ${LIVE.mode === 'live' ? watchTip() : ''}${xs.length ? '<button type="button" class="btn ghost lv-add" data-act="lv-ex-add">+ 加动作</button>' : ''}`;
}
// The first time 训练中 opens (until 知道了: lsj-watch-tip): how the watch comes in. For someone who never set up 同步健康
// (no upload token, nothing synced from Apple Health) also where to do that; unknown until the tokens are read once.
function healthSet() {
  if (Object.values(S.health).some(x => x?.syncedAt) || Object.values(S.sleep).some(x => x?.source === 'apple-health')) return true;
  return Array.isArray(S.tokens) ? S.tokens.length > 0 : null;
}
let watchAsked = false;
// Only for someone whose Apple Health data has come in (the set-up lives in 「我的」, not here).
function watchTip() {
  if (lsGet('lsj-watch-tip') || healthSet() !== true) return '';
  return `<div class="lv-tip" role="note"><span class="lv-tip-ic">${WATCH}</span><div class="lv-tip-t"><p>戴着 Apple Watch？在手表上开一个「传统力量训练」，练完点「同步手表心率」，心率和消耗会对到这次训练上。</p>
    <div class="lv-tip-b"><button type="button" class="btn ghost sm lv-tip-ok" data-act="lv-watch-ok">知道了</button></div></div></div>`;
}
// iPhones and iPads can open the 「同步健康」 shortcut by link (isIOS: the push section's); shown to people whose
// Apple Health data has come in.
const canSyncHealth = () => isIOS() && healthSet() === true;
function runHealthShortcut() { location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent('同步健康'); }
function lvExRow(x, i) {
  const kind = exKind(x), sets = (x.sets || []).filter(s => !s.warmup), done = sets.filter(s => s.done).length;
  const full = kind === 'cardio' ? !!metricsTxt(x.metrics) : sets.length > 0 && done === sets.length;
  const rx = kind === 'cardio' || LIVE.mode === 'edit' ? null : lvRx(x);
  const sub = kind === 'cardio' ? metricsTxt(x.metrics) || '有氧' : rx ? `这次 ${rxLine(rx)}` : lastTxt(exHistory(x.name, LIVE.w.date, LIVE.id).last);
  return `<button type="button" class="lv-row${full ? ' full' : done ? ' some' : ''}" data-act="lv-ex" data-i="${i}" aria-label="${esc(`${x.name || '未命名'}，${kind === 'cardio' ? (full ? '记了' : '还没记') : `完成 ${done}/${sets.length} 组`}，点开`)}">
    <span class="ex-n num">${full ? '✓' : i + 1}</span><span class="lv-rn"><b>${esc(x.name || '未命名')}</b><small>${esc(sub)}</small></span><span class="lv-rc num">${kind === 'cardio' ? '' : `${done}/${sets.length}`}</span>${CHEV_R}</button>`;
}
// The last five times this exercise was done (before the session; the session itself left out), in the details
// under 这次: date · working sets · drop sets, a row opens that session; 全部 opens the exercise's details sheet.
function lvHistHTML(x, i) {
  const w = LIVE.w, key = String(x.name || '').trim(), yr = today().slice(0, 4), rows = [];
  for (const v of S.workouts.filter(v => v.id !== LIVE.id && v.date <= w.date).sort(newestFirst)) {
    const e = (v.exercises || []).find(e => e && String(e.name || '').trim() === key); if (!e || e.cardio) continue;
    const wk = histWk(e.sets); if (!wk) continue;
    const ss = (e.sets || []).filter(s => s && typeof s === 'object'), any = ss.some(s => s.done);
    const dr = ss.filter(s => s.drop && hasSetData(s) && (s.done || !any));
    rows.push(`<button type="button" class="lv-hr" data-act="workout" data-id="${esc(v.id)}" aria-label="看 ${esc(mdw(v.date))} 那次训练"><span class="lv-hd num">${esc(v.date.slice(0, 4) === yr ? md(v.date) : `${v.date.slice(0, 4)}/${md(v.date)}`)}</span><span class="lv-hv num">${esc(wk)}${dr.length ? `<i> · 递减 ${esc(dr.map(s => setTxt(s, false)).join('、'))}</i>` : ''}</span>${CHEV_R}</button>`);
    if (rows.length >= 5) break;
  }
  if (!rows.length) return '';
  return `<div class="lv-hist">${rows.join('')}<button type="button" class="lv-hr lv-hall" data-act="lv-ex-hist-all" data-i="${i}"><span>全部</span>${CHEV_R}</button></div>`;
}
function lvExOpen(x, i) {
  const kind = exKind(x), w = LIVE.w, h = exHistory(x.name, w.date, LIVE.id), tg = exTarget(x, w.planDayId), name = String(x.name || '').trim();
  const b = kind === 'cardio' ? null : lvBase(x), rx = b ? b.rx : null, dOpen = LIVE.detOpen?.i === i;
  const head = `<div class="lv-exh"><span class="ex-n num">${i + 1}</span><b class="lv-exn">${esc(name || '未命名')}</b>${kind !== 'kg' ? `<span class="tag ok">${esc(KIND_TXT[kind])}</span>` : ''}<button type="button" class="icon-btn lv-exm" data-act="lv-ex-menu" data-i="${i}" aria-label="这个动作：换一个、备注、移动、删除">⋯</button></div>`;
  const src = rx ? (rx.src === 'claude' ? `${AG}Claude` : rx.src === 'rule' ? '按上次成绩' : rx.src === 'deload' ? '减量周' : '按计划') : '', why = rx ? (rx.src === 'plan' ? plainRpe(rx.note) : rx.why) : '';
  // two lines by default: 这次 (big, its source) and why (never folded); the target, last time, the plates and the last
  // five times fold out under 这次 ›
  const base = [
    tg?.txt ? `<p class="lv-i"><span class="lv-k">目标</span><span class="num">${esc(humanTarget(tg.txt))}</span></p>` : '',
    kind !== 'cardio' ? `<p class="lv-i lv-last">${esc(lastTxt(h.last))}</p>` : '',
    b && isBarbell(x) ? platesLine(x, i, b) : '',
  ].filter(Boolean).join('');
  const five = kind !== 'cardio' && dOpen ? lvHistHTML(x, i) : '', det = base + five;
  // without a prescription: the target and last time as they are, the last five times under 「最近几次」
  const info = rx
    ? `<button type="button" class="lv-i lv-rx${rx.src === 'claude' ? ' cl' : rx.src === 'rule' ? ' rl' : ''}" data-act="lv-det" data-i="${i}" aria-expanded="${dOpen}" aria-label="这次 ${esc(rxLine(rx))}，${dOpen ? '收起' : '展开'}目标、上次和最近几次"><span class="lv-k">这次</span><b class="num">${esc(rxLine(rx))}</b>${src ? `<small class="lv-src">${src}</small>` : ''}${base || h.last ? CHEV_DOWN : ''}</button>${why ? `<p class="lv-why">${esc(why)}</p>` : ''}${det ? `<div class="lv-det"${dOpen ? '' : ' hidden'}>${det}</div>` : ''}`
    : base + (kind !== 'cardio' && h.last ? `<button type="button" class="lv-i lv-five" data-act="lv-det" data-i="${i}" aria-expanded="${dOpen}"><span>最近几次</span>${CHEV_DOWN}</button>${five}` : '');
  const body = info + (x.note ? `<p class="lv-note">${esc(x.note)}</p>` : '');
  if (kind === 'cardio') {
    const m = x.metrics || {};
    return `<section class="lv-ex on cardio" data-i="${i}">${head}${body}<div class="lv-cardio">${[['min', '分钟', true], ['km', '公里', false], ['kcal', '千卡', true]].map(([k, l, int]) =>
      `<label class="lv-cm"><span>${l}</span><input type="text" class="lv-v num" id="lv-m-${k}-${i}" data-i="${i}" data-lm="${k}" inputmode="${int ? 'numeric' : 'decimal'}" autocomplete="off" enterkeyhint="done" value="${esc(nTxt(m[k]))}" placeholder="–"></label>`).join('')}</div>
      <p class="hint" style="margin:0">填时长；公里和千卡有就填（看跑步机或手表）。</p></section>`;
  }
  const fs = setFields(kind, lvStepOf(x, kind === 'assist' ? 'assist' : 'kg')), rec = LIVE.prs[name], top = rec ? prSet((x.sets || []).filter(s => s.done), rec) : null;
  const hdr = `<div class="lv-seth${fs.length === 1 ? ' one' : ''}" aria-hidden="true"><span>组</span>${fs.map(f => `<span>${f[1]}</span>`).join('')}<span>完成</span></div>`;
  return `<section class="lv-ex on" data-i="${i}">${head}${body}<div class="lv-sets${fs.length === 1 ? ' one' : ''}">${hdr}${lvSetsHTML(x, i, b, fs, top)}</div>
    <div class="lv-adds"><button type="button" class="btn ghost sm" data-act="lv-set-add" data-i="${i}">+ 加一组</button>${advOn() ? `<button type="button" class="btn ghost sm" data-act="lv-warm-add" data-i="${i}">+ 热身组</button>${kind !== 'sec' ? `<button type="button" class="btn ghost sm lv-dradd" data-act="lv-drop-add" data-i="${i}">+ 递减组</button>` : ''}` : ''}</div></section>`;
}
// The set rows, and 「+ 递减组」 where a drop set would go: under the chain of the working set ticked last, and under
// each ticked working set without one when drops are this exercise's thing (one already, the plan's cue or last time
// had them) or a finished session is being corrected. With 进阶显示 on, or once the exercise has a drop set; not on
// timed moves.
function lvSetsHTML(x, i, b, fs, top) {
  const sets = x.sets || [], on = exKind(x) !== 'sec' && (advOn() || sets.some(s => s.drop));
  const all = on && (LIVE.mode === 'edit' || sets.some(s => s.drop) || dropWanted(x));
  let last = -1; sets.forEach((s, j) => { if (s.done && !s.warmup && !s.drop) last = j; });
  let par = -1, out = '';
  sets.forEach((s, j) => {
    out += lvSetHTML(x, i, s, j, b, fs, s === top);
    par = s.warmup ? -1 : s.drop ? par : j;
    if (!on || par < 0 || !sets[par].done || sets[j + 1]?.drop || !(par === last || (all && par === j))) return;
    out += `<button type="button" class="lv-dslot" data-act="lv-drop-after" data-i="${i}" data-j="${par}" aria-label="在${esc(setLabel(x, par))}后面加递减组">+ 递减组</button>`;
  });
  return out;
}
function lastDrop(x, j, b) {
  let k = j - 1; while (k >= 0 && x.sets[k].warmup) k--;
  return k < 0 ? null : dropMatch(b, lvVal(x, k, b), exKind(x) === 'assist' ? 'assist' : 'kg');
}
function lvSetHTML(x, i, s, j, b, fs, pr) {
  const g = lvSug(x, j, b), foc = !!LIVE.focus && LIVE.focus.i === i && LIVE.focus.j === j, lab = setLabel(x, j);
  const sn = s.warmup ? '热' : s.drop ? '递' : String(setNo(x, j));
  // under a working set: the same set last time (「上次 22.5 × 12」; none when last time had fewer sets)
  // under a drop set: last time's drop after a set of the same weight
  const lp = s.warmup ? null : s.drop ? lastDrop(x, j, b) : b.lw[x.sets.slice(0, j).filter(p => !p.warmup && !p.drop).length] || null;
  const rpe = isNum(s.rpe) && advOn() ? `<i class="lv-rpe">RPE ${esc(String(s.rpe))}</i>` : '';  // this set's RPE (from 还能做几次 or the set menu), at the right
  const prev = lp || rpe ? `<span class="lv-prev"><span>${lp ? `上次 ${esc(setTxt(lp, false))}` : ''}</span>${rpe}</span>` : '';
  const cells = fs.map(([f, l, st, int]) => {
    const ph = isNum(g[f]) ? nTxt(g[f]) : f === 'kg' && exKind(x) === 'bw' ? '0' : '–', long = (nTxt(s[f]) || ph).length >= 5;
    return `<div class="lv-st"><button type="button" class="lv-pm" data-act="lv-step" data-i="${i}" data-j="${j}" data-f="${f}" data-d="-1" aria-label="${lab}${l}减 ${st}">−</button><input type="text" class="lv-v num${long ? ' sm' : ''}" id="lv-${f}-${i}-${j}" data-i="${i}" data-j="${j}" data-lf="${f}" inputmode="${int ? 'numeric' : 'decimal'}" autocomplete="off" enterkeyhint="done" value="${esc(nTxt(s[f]))}" placeholder="${esc(ph)}" aria-label="${lab}${l}"><button type="button" class="lv-pm" data-act="lv-step" data-i="${i}" data-j="${j}" data-f="${f}" data-d="1" aria-label="${lab}${l}加 ${st}">+</button></div>`;
  }).join('');
  return `<div class="lv-set${s.done ? ' done' : ''}${foc ? ' focus' : ''}${s.warmup ? ' warm' : ''}${s.drop ? ' drop' : ''}${pr ? ' pr' : ''}" data-act="lv-focus" data-i="${i}" data-j="${j}">
    <button type="button" class="lv-sn" data-act="lv-set-menu" data-i="${i}" data-j="${j}" aria-label="${lab}：加递减组、标热身、标递减或删除"><span class="num">${sn}</span>${pr ? '<small>纪录</small>' : ''}</button>${cells}<button type="button" class="lv-tick" data-act="lv-tick" data-i="${i}" data-j="${j}" aria-pressed="${!!s.done}" aria-label="${lab}${s.done ? '已完成，再点取消' : '完成'}">✓</button>${prev}</div>`;
}
function lvDockHTML() {
  const r = LIVE.rest, w = LIVE.w;
  // Nothing in focus (a fresh free session, a deleted set): the next set not ticked yet, so 「收工」 only shows when all are done
  if (!(LIVE.focus && w.exercises?.[LIVE.focus.i]?.sets?.[LIVE.focus.j])) {
    const i = (w.exercises || []).findIndex(e => !e?.cardio && (e?.sets || []).some(t => !t.done));
    LIVE.focus = i < 0 ? null : { i, j: w.exercises[i].sets.findIndex(t => !t.done) };
  }
  const f = LIVE.focus, x = f ? w.exercises?.[f.i] : null, s = x?.sets?.[f.j];
  let go;
  if (s) {
    const kind = exKind(x), v = lvVal(x, f.j, lvBase(x)), side = isBarbell(x) ? platesSide(v.kg) : '';
    // the first session on this phone: what the grey numbers are, as the button's second line (until the first tick)
    const fh = LIVE.mode === 'live' && !lsGet('lsj-live-hint') ? '<small class="lv-go-h">灰字是建议，直接打勾就行</small>' : '';
    go = `<button type="button" class="btn primary lv-go" data-act="lv-tick-focus"><span class="lv-go-ck" aria-hidden="true">✓</span><span class="lv-go-t"><b>${esc(x.name)} · ${esc(setLabel(x, f.j))}</b><small class="num">${esc(lvValTxt(v, kind))}${side ? `<span class="lv-go-x"> · 每边 ${esc(side)}</span>` : ''}${dropNow(x, f.j) ? '<span class="lv-go-x"> · 紧接着做，不休息</span>' : ''}</small>${fh}</span></button>`;
  } else if ((w.exercises || []).length) go = `<button type="button" class="btn primary lv-go" data-act="lv-finish"><span class="lv-go-t"><b>${esc(LIVE.mode === 'edit' ? '改好了，保存' : vt('live.allDone', '都练完了，点这里收工'))}</b></span></button>`;
  else go = '<button type="button" class="btn primary lv-go" data-act="lv-ex-add"><span class="lv-go-t"><b>+ 加动作</b></span></button>';
  const rest = !r ? '' : r.done
    ? `<div class="lv-rest done" role="timer"><span class="lr-n"><b>${esc(vt('live.restDone', '休息结束'))}</b><small>多歇了 <span class="num" data-lv-rest></span></small></span><button type="button" class="lr-b" data-act="lv-rest-skip">好</button></div>`
    : `<div class="lv-rest" role="timer"><b class="lr-t num" data-lv-rest></b><span class="lr-n">组间休息${restTo(r) ? `<small>${esc(restTo(r))}</small>` : ''}</span><button type="button" class="lr-b" data-act="lv-rest-sub" aria-label="少休息 30 秒">−30</button><button type="button" class="lr-b" data-act="lv-rest-add" aria-label="多休息 30 秒">+30</button><button type="button" class="lr-b" data-act="lv-rest-skip">跳过</button><i class="lr-bar" aria-hidden="true"></i></div>`;
  // 「这组还能再做几次？」 after an exercise's last working set (B5): one tap, or none; stored as the set's RPE (10 − reps left)
  const q = LIVE.rir, qx = q && w.exercises?.[q.i], qs = qx?.sets?.[q.j];
  const rir = qs && qs.done && !isNum(qs.rpe) ? `<div class="lv-rir" role="group" aria-label="${esc(qx.name)} 最后一组还能再做几次"><span class="lv-rir-q"><b>${esc(qx.name)}</b>这组还能再做几次？</span><span class="lv-rir-b">${[['0', '0'], ['1', '1'], ['2', '2'], ['3', '3+']].map(([v, l]) => `<button type="button" class="lr-b" data-act="lv-rir" data-v="${v}" aria-label="还能再做 ${l} 次">${l}</button>`).join('')}</span></div>` : '';
  return rest + rir + go;
}
// Under 组间休息: what comes next, from the set in focus now (it moves when sets are added, marked or skipped): 「→ 第 3
// 组」 in the same exercise, 「→ 侧平举」 in another one.
function restTo(r) {
  const f = LIVE.focus, x = f && LIVE.w?.exercises?.[f.i]; if (!x?.sets?.[f.j]) return '';
  return `→ ${f.i === r.from ? setLabel(x, f.j) : x.name}`;
}
// 问最后一组还能做几次: on unless switched off in 「⋯」 on this phone (localStorage lsj-rir = '0').
const rirOn = () => lsGet('lsj-rir') !== '0';
function lvRir(v) {
  const q = LIVE.rir, s = q && LIVE.w?.exercises?.[q.i]?.sets?.[q.j]; LIVE.rir = null;
  if (!s) { drawDock(); return; }
  const left = Math.max(0, Math.min(3, parseInt(v, 10) || 0));
  s.rpe = 10 - left;  // 3+ reps left: RPE 7
  lvChanged();
}
// 这组 RPE from the set's menu: a number, or none.
function lvSetRpe(i, j, v) {
  const s = LIVE.w?.exercises?.[i]?.sets?.[j]; if (!s) return;
  const n = Number(v);
  if (RPES.includes(n)) s.rpe = n; else delete s.rpe;
  if (LIVE.rir?.i === i && LIVE.rir.j === j) LIVE.rir = null;
  lvChanged();
}
// 「训练进行中 · 32:10 · 继续」 (and the rest countdown) under the title bar while the screen is put away.
function drawLiveBar() {
  // not over 今日's today: 「今天」 says 在练 · 继续 there already
  const a = activeWo(), show = !!a && isFresh(a) && !LIVE.open && !!S.me && !(S.tab === 'today' && S.date === today());
  liveBarEl.hidden = !show;
  if (!show) { if (liveBarEl.dataset.k) { liveBarEl.innerHTML = ''; liveBarEl.dataset.k = ''; } return; }
  const resting = !!LIVE.rest && !LIVE.rest.done;
  const k = [a.id, vt('live.bar', '训练进行中')].join('|');
  if (liveBarEl.dataset.k !== k) {
    liveBarEl.dataset.k = k;
    liveBarEl.innerHTML = `<button type="button" class="lb-btn" data-act="lv-open"><i class="lb-dot" aria-hidden="true"></i><span class="lb-t"><b>${esc(vt('live.bar', '训练进行中'))}</b> · <span class="num" data-lv-clock></span><span class="lb-rest" hidden> · 休息 <span class="num" data-lv-rest></span></span></span><span class="lb-go">继续${CHEV_R}</span></button>`;
    liveTick();
  }
  const r = $('.lb-rest', liveBarEl); if (r && r.hidden === resting) r.hidden = !resting;
  lvRestTick();
}
// The 训练 card's part: running (tap to go back), or started over 12 hours ago (完成 / 放弃).
function liveCardHTML(a) {
  const st = woStats(a);
  if (!isFresh(a)) return `<div class="lv-card stale"><p><b>上次的训练没点完成</b><span>${esc(woTitle(a))} · ${esc(mdw(a.date))} ${esc(clockOf(a.startedAt))} 开始 · 打勾了 ${st.done} 组</span></p><div class="btns"><button type="button" class="btn primary sm" data-act="lv-stale-finish">完成</button><button type="button" class="btn ghost sm danger" data-act="lv-discard">放弃</button></div></div>`;
  return `<button type="button" class="lv-card" data-act="lv-open"><span class="lvc-h"><i class="lb-dot" aria-hidden="true"></i><b>${esc(vt('live.bar', '训练进行中'))}</b><span class="num lvc-clock" data-lv-clock>${esc(lvElapsed(a))}</span></span>
    <span class="lvc-t">${esc(woTitle(a))} · 完成 <b class="num">${st.done}/${st.sets}</b> 组</span><span class="btn primary sm lvc-go">继续练</span></button>`;
}
// Every second: the elapsed time wherever it shows.
function liveTick() {
  const a = activeWo(), t = a ? lvElapsed(a) : '';
  document.querySelectorAll('[data-lv-clock]').forEach(el => { if (el.textContent !== t) el.textContent = t; });
}
setInterval(() => { if (document.visibilityState === 'visible' && (LIVE.w || S.activeWorkout)) liveTick(); }, 1000);

/* rest between sets: a countdown in the dock (and in the bar), a beep and a buzz at zero; it runs by its end time, so
   coming back after the screen was locked shows what is left, or 休息结束 */
function lvRestStart(sec, from) {
  LIVE.rest = { end: Date.now() + sec * 1000, total: sec, from, done: false };
  lvPersist(); lvRestLoop(); drawLiveBar(); laterSet();
}
function lvRestLoop() { clearInterval(lvRestT); lvRestT = LIVE.rest ? setInterval(lvRestTick, 250) : null; drawDock(); lvRestTick(); }
function lvRestStop() { LIVE.rest = null; clearInterval(lvRestT); lvRestT = null; laterClear(); lvPersist(); drawDock(); drawLiveBar(); }
function lvRestTick() {
  const r = LIVE.rest; if (!r) { clearInterval(lvRestT); lvRestT = null; return; }
  const left = Math.ceil((r.end - Date.now()) / 1000);
  if (left <= 0 && !r.done) {
    r.done = true; lvPersist();
    if (document.visibilityState === 'visible' && left > -30) { beep(); buzz([200, 100, 200]); laterClear(); }  // the page said it itself: no push
    drawDock(); drawLiveBar();
  }
  if (r.done && left < -600) { lvRestStop(); return; }
  const a = Math.abs(left), txt = `${Math.floor(a / 60)}:${pad(a % 60)}`;
  document.querySelectorAll('[data-lv-rest]').forEach(el => { if (el.textContent !== txt) el.textContent = txt; });
  const bar = LIVE.open && $('#lv-dock .lr-bar', liveEl); if (bar) bar.style.width = `${left > 0 ? Math.min(100, left / r.total * 100) : 0}%`;
}
function lvRestAdd(sec) {
  const r = LIVE.rest; if (!r || r.done) return;
  r.end = sec > 0 ? r.end + sec * 1000 : Math.max(Date.now(), r.end + sec * 1000); if (sec > 0) r.total += sec;
  lvPersist(); lvRestTick(); laterSet();
}
/* 组间计时在后台也提醒 (B7): when a rest starts on a phone that gets notifications, the server is asked to send
   「休息完了」 when it ends (POST /api/push/later; one pending per person, 10–900 s); ±30 s re-schedules it; the rest
   ending here (the page visible at zero, skipped, the next set ticked, 收工, 放弃) cancels it. Every failure is silent. */
let laterSeq = 0;
function laterBody() {
  const f = LIVE.focus, x = f && LIVE.w?.exercises?.[f.i], s = x?.sets?.[f.j]; if (!s || x.cardio) return '';
  return [...`${x.name} · ${setLabel(x, f.j)} · ${lvValTxt(lvVal(x, f.j, lvBase(x)), exKind(x))}`].slice(0, 80).join('');
}
function laterSet() {
  const r = LIVE.rest;
  if (!S.push?.sub || !S.db || LIVE.mode !== 'live' || !r || r.done) { laterClear(); return; }
  // the server fires on the second: three seconds of slack so laterClear() from a visible page at zero gets there first
  const left = (r.end - Date.now()) / 1000, delay = Math.min(900, Math.max(10, Math.ceil(left) + 3)), seq = ++laterSeq, old = LIVE.later;
  LIVE.later = null;
  (async () => {
    try {
      if (old) await req('DELETE', '/api/push/later/' + encodeURIComponent(old));
      if (left < 5 || left > 900 || seq !== laterSeq) return;
      const body = laterBody();
      const res = await req('POST', '/api/push/later', { delaySec: delay, title: '休息完了', body: body || '开始下一组', url: '/#today' });
      if (!res?.id) return;
      if (seq === laterSeq && LIVE.rest && !LIVE.rest.done) { LIVE.later = res.id; lvPersist(); }
      else req('DELETE', '/api/push/later/' + encodeURIComponent(res.id)).catch(() => {});
    } catch (e) {}
  })();
}
function laterClear() {
  laterSeq++;
  const id = LIVE.later; if (!id) return;
  LIVE.later = null;
  if (S.db) req('DELETE', '/api/push/later/' + encodeURIComponent(id)).catch(() => {});
}

/* sets: focus, tick, step, mark, add, delete */
function lvNextUndone(i, j) {  // the next set to do after (i, j): later in this exercise, earlier in it, then the exercises after it
  const xs = LIVE.w.exercises || [], ok = (a, b) => xs[a] && !xs[a].cardio && xs[a].sets?.[b] && !xs[a].sets[b].done;
  if (i != null && xs[i]) { for (let b = j + 1; b < (xs[i].sets || []).length; b++) if (ok(i, b)) return { i, j: b }; for (let b = 0; b < j; b++) if (ok(i, b)) return { i, j: b }; }
  for (let n = 1; n <= xs.length; n++) { const a = ((i ?? -1) + n) % xs.length; for (let b = 0; b < (xs[a].sets || []).length; b++) if (ok(a, b)) return { i: a, j: b }; }
  return null;
}
function lvFocusFirst() {
  if (!LIVE.w) return;
  const xs = LIVE.w.exercises || [], cur = xs[LIVE.cur] ? LIVE.cur : 0;
  LIVE.focus = lvNextUndone(cur, -1) || lvNextUndone(null, -1);
  if (LIVE.focus) LIVE.cur = LIVE.focus.i; else LIVE.cur = Math.min(cur, Math.max(0, xs.length - 1));
}
function lvFocusRow(row) {
  const i = +row.dataset.i, j = +row.dataset.j; if (!LIVE.w?.exercises?.[i]?.sets?.[j]) return;
  LIVE.focus = { i, j };
  liveEl.querySelectorAll('.lv-set.focus').forEach(el => el.classList.remove('focus'));
  row.classList.add('focus');
  if (LIVE.lastExs) LIVE.lastExs = lvBodyHTML();  // what is on screen now (unless typing left it behind already)
  lvPersist(); drawDock();
}
function lvTick(i, j) {
  const x = LIVE.w?.exercises?.[i], s = x?.sets?.[j]; if (!s) return;
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch (e) {}
  if (s.done) { s.done = false; LIVE.focus = { i, j }; if (LIVE.rir?.i === i && LIVE.rir.j === j) LIVE.rir = null; LIVE.prs = lvPrsOf(lvDoneOnly()); lvChanged(); return; }
  const kind = exKind(x), v = lvVal(x, j, lvBase(x)), need = kind === 'sec' ? 'sec' : 'reps';
  if (!isNum(s[need]) && !isNum(v[need])) {
    LIVE.focus = { i, j }; drawLive(); toast(kind === 'sec' ? '先填这组做了几秒，再打勾' : '先填这组做了几次，再打勾', true);
    requestAnimationFrame(() => $(`#lv-${need}-${i}-${j}`, liveEl)?.focus());
    return;
  }
  for (const [f] of setFields(kind)) if (!isNum(s[f]) && isNum(v[f])) s[f] = v[f];
  s.done = true;
  if (LIVE.mode === 'live') lsSet('lsj-live-hint', '1');  // the grey-numbers note on the dock has done its job
  buzz(15);
  // the exercise's last working set: 「这组还能再做几次？」 under the rest (B5), unless its RPE is already there; a drop
  // set ticked after it leaves the question up
  const lastWork = !s.warmup && !s.drop && !x.sets.slice(j + 1).some(p => !p.warmup && !p.drop);
  if (!s.drop) LIVE.rir = LIVE.mode === 'live' && rirOn() && advOn() && lastWork && !isNum(s.rpe) ? { i, j } : null;
  // a set ticked after a later one of the exercise (caught up on, added afterwards): the rest running goes on as it is
  const retro = x.sets.slice(j + 1).some(p => p.done);
  const before = LIVE.prs, now = lvPrsOf(lvDoneOnly()), n = String(x.name || '').trim();
  LIVE.prs = now;
  const pr = LIVE.mode === 'live' && now[n] && before[n]?.text !== now[n].text && prSet([s], now[n]);
  if (pr) popPr(n, now[n].text);
  const nx = lvNextUndone(i, j);
  LIVE.focus = nx;
  const moved = nx && nx.i !== i;
  if (nx) LIVE.cur = nx.i;
  // a drop set straight after (a working set or the drop before it): no rest in between, it is the next one to do;
  // the rest starts after the chain's last drop set
  const chain = !s.warmup && !!x.sets[j + 1]?.drop && !x.sets[j + 1].done;
  if (LIVE.mode !== 'live' || retro) {}
  else if (chain) { if (LIVE.rest) lvRestStop(); }
  else if (LIVE.restOn && nx) {
    const px = planEx(x.name, LIVE.w.planDayId), sec = s.warmup ? Math.min(60, x.restSec || restPref().sec) : x.restSec || parseRest(px?.rest) || restPref().sec;
    lvRestStart(sec, i);
  }
  lvChanged();
  if (nx) requestAnimationFrame(() => moved ? lvScrollTo(`.lv-ex[data-i="${nx.i}"]`, 'start') : lvScrollTo(`.lv-set[data-i="${nx.i}"][data-j="${nx.j}"]`));
  // the exercise's last set done and the screen moved on: a drop set after it is one tap away when the plan's cue
  // or last time had one
  if (LIVE.mode === 'live' && moved && !s.warmup && !pr && advOn() && dropWanted(x)) toast(`${x.name} 做完了`, false, () => { if (LIVE.w?.exercises?.[i] === x) lvDropAdd(i); }, '+ 递减组');
}
function dropWanted(x) {
  if (exKind(x) === 'sec') return false;
  const px = planEx(x.name, LIVE.w.planDayId), h = exHistory(x.name, LIVE.w.date, LIVE.id);
  return /递减/.test(`${px?.cue || ''} ${x.target || ''}`) || (!!h.last && dropOf({ sets: h.last.sets }));
}
function lvStep(i, j, f, dir) {
  const x = LIVE.w?.exercises?.[i], s = x?.sets?.[j]; if (!s || !['kg', 'reps', 'sec', 'assist'].includes(f)) return;
  const st = lvStepOf(x, f), cur = isNum(s[f]) ? s[f] : lvSug(x, j, lvBase(x))[f];
  s[f] = Math.max(0, r2(isNum(cur) ? cur + dir * st : dir > 0 ? st : 0));
  LIVE.focus = { i, j };
  lvChanged();
}
function lvSetMenu(i, j) {
  const x = LIVE.w?.exercises?.[i], s = x?.sets?.[j]; if (!s) return;
  if (S.sheet) closeSheet(true);
  S.sheet = { type: 'live-set', photos: [], removed: [] };
  const at = `data-i="${i}" data-j="${j}" data-close="1"`;
  // 进阶显示 off: no RPE, the warm-up said plainly; adding a drop set after this one stays (it's what this menu is for)
  const adv = advOn(), dropOk = !x.cardio && exKind(x) !== 'sec';
  showSheet(`${x.name} · ${setLabel(x, j)}`, `<div class="panel acts">
    ${s.warmup || !dropOk ? '' : `<button type="button" class="act-row" data-act="lv-drop-after" ${at}><b>在这组后面加递减组</b><small>做完马上降重量接着做。建议的重量照上次同重量后面的递减，没有就是这组的四分之三左右；可以连着加</small></button>`}
    <button type="button" class="act-row" data-act="lv-set-warm" ${at}><b>${s.warmup ? '改回正式组' : adv ? '标为热身组' : '这组是热身（不算数）'}</b><small>${adv ? '热身组不算完成组数、训练量和纪录' : '正式开始前用轻重量活动开的那组，不算进组数'}</small></button>
    ${s.drop || (adv && dropOk && !s.warmup && prevWork(x, j) >= 0) ? `<button type="button" class="act-row" data-act="lv-set-drop" ${at}><b>${s.drop ? '改回正式组' : '标为递减组'}</b><small>${s.drop ? '算回正式组，计组数和纪录' : `跟在${esc(setLabel(x, prevWork(x, j)))}后面、降了重量接着做的；不算纪录`}</small></button>` : ''}
    <button type="button" class="act-row" data-act="lv-set-del" ${at}><b class="danger-t">删除这组</b></button></div>
    ${x.cardio || !advOn() ? '' : `<div class="field"><span class="lbl">这组 RPE</span><div class="chips rpe-chips">${[6, 7, 8, 9, 10].map(n => `<button type="button" class="chip" data-act="lv-set-rpe" data-i="${i}" data-j="${j}" data-v="${n}" data-close="1" aria-pressed="${s.rpe === n}">${n}<small>${{ 6: '还能 4+', 7: '还能 3', 8: '还能 2', 9: '还能 1', 10: '力竭' }[n]}</small></button>`).join('')}${isNum(s.rpe) ? `<button type="button" class="chip" data-act="lv-set-rpe" data-i="${i}" data-j="${j}" data-v="" data-close="1">不记</button>` : ''}</div><p class="hint" style="margin:0">RPE 8 = 做完还能再做 2 次。规则按最后一组的 RPE 决定加不加重。</p></div>`}`,
    '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
// The working set a drop set at j would hang under (drop sets in between are its chain); -1 when a warm-up or nothing
// comes first.
function prevWork(x, j) {
  let k = j - 1; while (k >= 0 && x.sets[k].drop) k--;
  return k >= 0 && !x.sets[k].warmup ? k : -1;
}
function lvSetMark(i, j, k) {
  const x = LIVE.w?.exercises?.[i], s = x?.sets?.[j]; if (!s) return;
  if (k === 'drop' && !s.drop && prevWork(x, j) < 0) return;  // a drop set needs a set before it
  if (s[k]) delete s[k]; else { s[k] = true; delete s[k === 'warmup' ? 'drop' : 'warmup']; }
  LIVE.prs = lvPrsOf(lvDoneOnly()); lvChanged();
}
// A working set goes with the drop sets hanging under it (they were its drops); 撤销 puts them all back.
function lvSetDel(i, j) {
  const w = LIVE.w, x = w?.exercises?.[i]; if (!x?.sets?.[j]) return;
  const s0 = x.sets[j]; let n = 1;
  if (!s0.warmup && !s0.drop) while (x.sets[j + n]?.drop) n++;
  const gone = x.sets.splice(j, n), id = LIVE.id;
  if (LIVE.focus?.i === i) LIVE.focus = lvNextUndone(i, Math.max(-1, j - 1));
  if (LIVE.rir?.i === i && LIVE.rir.j >= j) LIVE.rir = null;
  LIVE.prs = lvPrsOf(lvDoneOnly()); lvChanged();
  toast(`删掉了${s0.warmup ? '一组热身' : s0.drop ? '一组递减' : n > 1 ? `一组和它的 ${n - 1} 组递减` : '一组'}`, false, () => { if (LIVE.id === id && w.exercises.includes(x)) { x.sets.splice(Math.min(j, x.sets.length), 0, ...gone); lvChanged(); } });
}
function lvSetAdd(i, warm) {
  const x = LIVE.w?.exercises?.[i]; if (!x || x.cardio) return;
  const kind = exKind(x);
  if (warm) {  // after the warm-ups already there, before the first working set
    let k = x.sets.findIndex(s => !s.warmup); if (k < 0) k = x.sets.length;
    x.sets.splice(k, 0, blankSet(kind, { warmup: true })); LIVE.focus = { i, j: k };
    if (LIVE.rir?.i === i && LIVE.rir.j >= k) LIVE.rir = { i, j: LIVE.rir.j + 1 };
  }
  else {
    const last = [...x.sets].reverse().find(s => !s.warmup && !s.drop), s = blankSet(kind);  // a drop's lighter weight isn't the next set's
    if (last) for (const [f] of setFields(kind)) if (isNum(last[f])) s[f] = last[f];
    x.sets.push(s); LIVE.focus = { i, j: x.sets.length - 1 };
  }
  LIVE.cur = i; lvChanged();
  requestAnimationFrame(() => lvScrollTo(`.lv-set[data-i="${i}"][data-j="${LIVE.focus.j}"]`));
}
// A drop set (drop: true): right after a working set and the drop sets already behind it, so they chain (lvSug says
// the weight). `after`: that set (its menu, the 「+ 递减组」 slot under it). Else (the button under the sets,
// the exercise's ⋯) the set the person is at: the drop chain's working set when a drop set is in focus; a ticked
// working set in focus; the ticked working set right before the set in focus, without a drop set yet (the one just
// done); else the set in focus; focus elsewhere: the last ticked working set, else the last one. Then a toast says where it went (撤销).
// Done straight after that set: a rest counting down for it stops.
function lvDropAdd(i, after) {
  const x = LIVE.w?.exercises?.[i]; if (!x || x.cardio) return;
  const sets = x.sets || (x.sets = []), work = j => !!sets[j] && !sets[j].warmup && !sets[j].drop;
  let k = -1;
  if (after != null) k = sets[after] && !sets[after].warmup ? after : -1;
  else {
    const f = LIVE.focus?.i === i && sets[LIVE.focus.j] ? LIVE.focus.j : -1;
    if (f >= 0 && sets[f].drop) { k = f; while (k >= 0 && sets[k].drop) k--; if (!work(k)) k = -1; }
    else if (f >= 0 && work(f) && sets[f].done) k = f;
    else if (f >= 0) k = work(f - 1) && sets[f - 1].done ? f - 1 : work(f) ? f : -1;
    for (let j = sets.length - 1; j >= 0 && k < 0; j--) if (work(j) && sets[j].done) k = j;
    for (let j = sets.length - 1; j >= 0 && k < 0; j--) if (work(j)) k = j;
  }
  if (k < 0) { toast('递减组跟在一组正式组后面：先加一组', true); return; }
  let at = k + 1; while (sets[at]?.drop) at++;
  const ns = blankSet(exKind(x), { drop: true }), id = LIVE.id;
  sets.splice(at, 0, ns);
  if (LIVE.rir?.i === i && LIVE.rir.j >= at) LIVE.rir = { i, j: LIVE.rir.j + 1 };  // 「还能再做几次」 stays on its set
  // the next thing to do (its set just done): the rest stops and the drop set takes the focus; added ahead of its set,
  // or afterwards behind later sets already done, the focus and a running rest stay where they are
  const now = dropNow(x, at);
  if (now && LIVE.rest && !LIVE.rest.done) lvRestStop();
  if (now || LIVE.mode === 'edit' || !LIVE.focus) LIVE.focus = { i, j: at };
  else if (LIVE.focus.i === i && LIVE.focus.j >= at) LIVE.focus = { i, j: LIVE.focus.j + 1 };
  LIVE.cur = i; lvChanged();
  requestAnimationFrame(() => lvScrollTo(`.lv-set[data-i="${i}"][data-j="${at}"]`));
  if (after == null) toast(`递减组加在${setLabel(x, k)}后面`, false, () => {
    const n = LIVE.id === id ? sets.indexOf(ns) : -1; if (n < 0 || ns.done) return;
    sets.splice(n, 1); if (LIVE.rir?.i === i && LIVE.rir.j > n) LIVE.rir = { i, j: LIVE.rir.j - 1 };
    if (LIVE.focus?.i === i && LIVE.focus.j > n) LIVE.focus = { i, j: LIVE.focus.j - 1 };
    else if (LIVE.focus?.i === i && LIVE.focus.j === n) LIVE.focus = lvNextUndone(i, n - 1);
    lvChanged();
  });
}

/* exercises: open one, its menu, change its kind, note, move, delete, the picker */
function lvExpand(i) {
  if (!LIVE.w?.exercises?.[i]) return;
  LIVE.cur = i;
  if (LIVE.focus?.i !== i) { const f = lvNextUndone(i, -1); LIVE.focus = f && f.i === i ? f : LIVE.focus; }
  lvPersist(); drawLive();
  requestAnimationFrame(() => lvScrollTo(`.lv-ex[data-i="${i}"]`, 'start'));
}
function lvExMenu(i) {
  const x = LIVE.w?.exercises?.[i]; if (!x) return;
  const n = LIVE.w.exercises.length, kind = exKind(x), at = `data-i="${i}" data-close="1"`, done = (x.sets || []).some(s => s.done);
  S.sheet = { type: 'live-ex', photos: [], removed: [] };
  showSheet(x.name || '动作', `<div class="panel acts">
    <button type="button" class="act-row" data-act="lv-ex-swap" ${at}><b>换个动作</b><small>${done ? '做完的组留着，没做的换成新动作' : '器械被占了、做着不舒服，换一个'}</small></button>
    <button type="button" class="act-row" data-act="lv-ex-note" ${at}><b>${x.note ? '改备注' : '加备注'}</b><small>座椅档位、握法、哪里不舒服…</small></button>
    ${advOn() || x.cardio ? '' : `<button type="button" class="act-row" data-act="lv-warm-add" ${at}><b>加热身组</b><small>正式组前用轻重量活动开，不算组数和纪录</small></button>${kind !== 'sec' ? `<button type="button" class="act-row" data-act="lv-drop-add" ${at}><b>加递减组</b><small>做完一组马上降重量接着做</small></button>` : ''}`}
    ${i > 0 ? `<button type="button" class="act-row" data-act="lv-ex-up" ${at}><b>上移</b></button>` : ''}${i < n - 1 ? `<button type="button" class="act-row" data-act="lv-ex-down" ${at}><b>下移</b></button>` : ''}
    <button type="button" class="act-row" data-act="lv-ex-del" ${at}><b class="danger-t">删除这个动作</b></button></div>
    <div class="field"><span class="lbl">怎么记</span><div class="chips">${EX_KINDS.filter(([k]) => k !== 'cardio' || !done).map(([k, l]) => `<button type="button" class="chip" data-act="lv-ex-kind" data-i="${i}" data-k="${k}" data-close="1" aria-pressed="${k === kind}">${l}</button>`).join('')}</div>
      <p class="hint" style="margin:0">负重记重量 × 次数；自重可以加负重；辅助记助力的重量；计时记秒数；有氧记时长和距离。</p></div>`,
    '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}
function lvSetKind(i, kind) {
  const x = LIVE.w?.exercises?.[i]; if (!x || !KIND_TXT[kind] || exKind(x) === kind) return;
  if (kind === 'cardio') { LIVE.w.exercises[i] = { name: x.name, cardio: true, metrics: {}, sets: [], ...(x.note ? { note: x.note } : {}) }; }
  else {
    if (x.cardio) { delete x.cardio; delete x.metrics; x.sets = Array.from({ length: Math.max(1, lastCount(x.name) || 3) }, () => blankSet(kind)); }
    x.sets = x.sets.map(s => {
      const keep = { done: !!s.done, ...(s.warmup ? { warmup: true } : {}), ...(s.drop ? { drop: true } : {}) };
      if (kind === 'sec') return { kg: null, sec: isNum(s.sec) ? s.sec : null, ...keep };
      if (kind === 'assist') return { bodyweight: true, assist: isNum(s.assist) ? s.assist : null, kg: null, reps: isNum(s.reps) ? s.reps : null, ...keep };
      return { ...(kind === 'bw' ? { bodyweight: true } : {}), kg: isNum(s.kg) ? s.kg : null, reps: isNum(s.reps) ? s.reps : null, ...keep };
    });
  }
  lvFocusFirst(); LIVE.cur = i; lvChanged();
}
function lvNote(i) {
  const x = LIVE.w?.exercises?.[i]; if (!x) return;
  S.sheet = { type: 'live-note', i, photos: [], removed: [] };
  showSheet(`备注 · ${x.name}`, `<div class="field"><label for="lv-note">这个动作的备注</label><textarea id="lv-note" rows="3" maxlength="300" placeholder="座椅第 4 档、握距、哪里不舒服…">${esc(x.note || '')}</textarea><p class="hint" style="margin:0">Claude 点评时会看。</p></div>`,
    '<button type="button" class="btn primary main" data-act="lv-note-save">好</button>');
}
function lvNoteSave() {
  const sh = S.sheet, x = LIVE.w?.exercises?.[sh?.i]; if (!x) { closeSheet(true); return; }
  const v = fval('lv-note').slice(0, 300);
  closeSheet(true);
  if (v === (x.note || '')) return;
  if (v) x.note = v; else delete x.note;
  lvChanged();
}
function lvMove(i, d) {
  const xs = LIVE.w?.exercises; if (!xs || !moveItem(xs, i, d)) return;
  const f = LIVE.focus;
  if (f && (f.i === i || f.i === i + d)) f.i = f.i === i ? i + d : i;
  LIVE.cur = LIVE.cur === i ? i + d : LIVE.cur === i + d ? i : LIVE.cur;
  lvChanged();
}
function lvExDel(i) {
  const w = LIVE.w, xs = w?.exercises; if (!xs?.[i]) return;
  const [x] = xs.splice(i, 1), id = LIVE.id;
  LIVE.cur = Math.min(LIVE.cur > i ? LIVE.cur - 1 : LIVE.cur, Math.max(0, xs.length - 1)); LIVE.focus = null; lvFocusFirst();
  LIVE.prs = lvPrsOf(lvDoneOnly()); lvChanged();
  toast(`删掉了「${x.name || '未命名'}」`, false, () => { if (LIVE.id === id) { xs.splice(Math.min(i, xs.length), 0, x); LIVE.cur = Math.min(i, xs.length - 1); lvFocusFirst(); lvChanged(); } });
}
// 加动作 / 换个动作: this day's plan first, then everything trained (most recently first) and the other plan days; a typed
// name that isn't there is added as a new one, with how it is logged.
function lvPicker(i) {
  if (!LIVE.w) return;
  if (S.sheet) closeSheet(true);
  // a beginner (profile.level new) starts on 新手常用 instead of a body part
  const pd = lvPd();
  S.sheet = { type: 'live-pick', i: i == null ? null : i, photos: [], removed: [] };
  S.sheet.pk = pickerState({ pd, here: (LIVE.w.exercises || []).map(x => x.name), cat: S.profile?.level === 'new' ? '' : libPartOf(pd), on: (name, kind) => lvPicked(name, kind, i) });
  showSheet(i == null ? '加动作' : `换掉「${LIVE.w.exercises[i]?.name || ''}」`, pickerHTML(), '<button type="button" class="btn ghost main" data-act="close">取消</button>');
  drawPick();
}
/* The exercise picker (训练中's 加动作 / 换个动作 and the day editor's 加动作 share it): a search box and the list. Its
   state sits on S.sheet.pk = {q, cat, pd (the plan day whose exercises come first), here (names already in the list),
   on(name, kind)}; rows tap to add at once (pk-pick), a name nobody has is added as new (pk-new), the 动作库 by part
   (pk-cat). The search input is data-nf: not part of the sheet's form state. */
function pickerState(o) { return { q: '', cat: '', pd: null, here: [], on: () => {}, ...o, here: new Set((o.here || []).map(n => String(n || '').trim()).filter(Boolean)) }; }
function pickerHTML() {
  return `<div class="lp-q"><input type="text" id="lp-q" data-nf="1" placeholder="搜动作，或者直接写名字" autocomplete="off" enterkeyhint="search" maxlength="40" aria-label="搜动作"></div><div id="lp-list" class="lp-list"></div>`;
}
// Names to pick from: plan day pd's first, then everything trained (most recently first) and the other plan days.
function pickList(pk) {
  const pd = pk.pd, out = new Map(), hist = new Map();
  for (const x of [...S.workouts].sort(newestFirst)) for (const e of x.exercises || []) {
    const n = String(e?.name || '').trim();
    if (n && !hist.has(n) && (e.cardio || (e.sets || []).some(hasSetData))) hist.set(n, { date: x.date, e });
  }
  const sub = n => { const h = hist.get(n); if (!h) return '没练过'; if (h.e.cardio) return `上次 ${md(h.date)} · ${metricsTxt(h.e.metrics) || '有氧'}`; const wk = workOf(h.e.sets); return `上次 ${md(h.date)}${wk ? ` · ${workTxt(wk)}` : ''}`; };
  const add = (n, tag) => { n = String(n || '').trim(); if (n && !out.has(n)) out.set(n, { n, tag, sub: sub(n) }); };
  if (pd) for (const x of pd.exercises || []) add(x?.name, `计划 ${dayShort(pd)}`);
  for (const n of hist.keys()) { const d = planDays().find(p => (p.exercises || []).some(x => String(x?.name || '').trim() === n)); add(n, d ? `计划 ${dayShort(d)}` : ''); }
  for (const d of planDays()) for (const x of d.exercises || []) add(x?.name, `计划 ${dayShort(d)}`);
  return [...out.values()].map(x => ({ ...x, here: pk.here.has(x.n) }));
}
// The 动作库 part to open on: the first part named in a plan day's name and focus (胸 / 背 / 腿 …), else 胸.
function libPartOf(pd) {
  const txt = `${pd?.name || ''} ${pd?.focus || ''}`;
  const hit = [['胸', /胸|推/], ['背', /背|拉/], ['腿', /腿|臀|下肢|蹲/], ['肩', /肩/], ['手臂', /手臂|二头|三头|臂/], ['核心', /核心|腹/], ['有氧', /有氧/]].find(([, re]) => re.test(txt));
  return hit ? hit[0] : '胸';
}
const lvLibPart = () => libPartOf(lvPd());
// Rows tap to add at once. No search: the plan day and what was trained (pickList), then the 动作库 by part. A search
// matches any part of a name (下拉 → 高位下拉, 对握高位下拉), the person's own names first; a new name can be added.
function drawPick() {
  const sh = S.sheet, pk = sh?.pk, el = $('#lp-list', sheetEl); if (!el || !pk) return;
  const q = String(pk.q || '').trim(), ql = q.toLowerCase();
  const mine = pickList(pk), known = new Set(mine.map(x => x.n));
  // a library row: 「部位 · how」 (the kind when it isn't 负重 and there is no how)
  const lib = x => ({ n: x.n, tag: x.part, sub: x.how || (x.k !== 'kg' ? KIND_TXT[x.k] : ''), here: pk.here.has(x.n) });
  // 换一个 in the day editor: what the day already has can't come in again (greyed; a tap says why, #L8)
  const row = x => `<button type="button" class="lp-row${pk.swapping && x.here ? ' lp-dis' : ''}" data-act="pk-pick" data-n="${esc(x.n)}"${pk.swapping && x.here ? ' aria-disabled="true"' : ''}><span class="lp-n"><b>${esc(x.n)}</b>${x.tag || x.sub ? `<small>${esc([x.tag, x.sub].filter(Boolean).join(' · '))}</small>` : ''}</span>${x.here ? '<span class="tag ok">已有</span>' : '<span class="lp-add" aria-hidden="true">＋</span>'}</button>`;
  const hit = x => !!x && (String(x.n || '').toLowerCase().includes(ql) || (x.al || []).some(a => a.toLowerCase().includes(ql)));  // names and the words people use
  if (q) {
    const xs = [...mine.filter(x => x.n.toLowerCase().includes(ql) || hit(EX_LIB_BY.get(x.n))), ...EX_LIB_ALL.filter(x => !known.has(x.n) && hit(x)).map(lib)];
    // a name nobody has: one tap adds it the way it most likely is logged; the other ways under it
    const gk = guessKind(q);
    const neu = !xs.some(x => x.n === q) ? `<div class="lp-new"><p>没有叫「<b>${esc(q)}</b>」的，加成新动作：</p><button type="button" class="btn primary sm lp-new-go" data-act="pk-new" data-k="${gk}">加「${esc(q)}」 · ${esc(EX_KIND_HELP[gk])}</button>
      <div class="lp-new-alt"><span class="meta">不是这种？</span><div class="chips">${EX_KINDS.filter(([k]) => k !== gk).map(([k]) => `<button type="button" class="chip" data-act="pk-new" data-k="${k}">${esc(EX_KIND_HELP[k])}</button>`).join('')}</div></div></div>` : '';
    el.innerHTML = (xs.length ? `<div class="panel lp-rows">${xs.slice(0, 80).map(row).join('')}</div>` : '') + neu;  // a new name after the matches
    return;
  }
  const part = EX_LIB.find(([p]) => p === pk.cat) || null, isNew = S.profile?.level === 'new';
  const libRow = x => row(known.has(x.n) ? { ...(mine.find(m => m.n === x.n) || lib(x)) } : lib(x));
  const starter = isNew && !part ? EX_STARTER.map(n => EX_LIB_BY.get(n)).filter(Boolean) : [];
  el.innerHTML = `${starter.length ? `<div class="sub-h">新手常用</div><div class="panel lp-rows">${starter.map(libRow).join('')}</div>` : ''}
    ${mine.length ? `<div class="sub-h">计划里的和练过的</div><div class="panel lp-rows">${mine.slice(0, 40).map(row).join('')}</div>` : ''}
    <div class="sub-h">动作库</div><div class="chips lp-cats" role="tablist" aria-label="按部位">${EX_LIB.map(([p]) => `<button type="button" class="chip" role="tab" data-act="pk-cat" data-v="${esc(p)}" aria-pressed="${p === part?.[0]}" aria-selected="${p === part?.[0]}">${esc(p)}</button>`).join('')}</div>
    ${part ? `<div class="panel lp-rows">${part[1].map(libRow).join('')}</div>` : (starter.length ? '' : `<div class="panel lp-rows">${EX_LIB[0][1].map(libRow).join('')}</div>`)}
    <p class="hint" style="margin:0">没有想要的？在上面直接写名字。</p>`;
}
// A tap on a row, on 加「…」, or Enter in the search: the picker's `on` gets the name (and, for a new one, its kind).
function pickGo(name, kind) {
  const pk = S.sheet?.pk; if (!pk) return;
  name = String(name || '').trim().slice(0, 40); if (!name) return;
  if (pk.swapping && pk.here.has(name)) { toast(`这天已经有 ${name} 了`, true); return; }
  pk.on(name, KIND_TXT[kind] ? kind : guessKind(name));
}
function pickEnter(q) {
  const pk = S.sheet?.pk; if (!pk) return;
  q = String(q || '').trim(); if (!q) return;
  const xs = pickList(pk).filter(x => x.n.toLowerCase().includes(q.toLowerCase()));
  pickGo(xs.find(x => x.n === q)?.n || (xs.length === 1 ? xs[0].n : q));
}
function lvPicked(name, kind, i) {
  name = String(name || '').trim().slice(0, 40); if (!name || !LIVE.w) return;
  kind = KIND_TXT[kind] ? kind : guessKind(name);
  closeSheet(true);
  const xs = LIVE.w.exercises, px = planEx(name, LIVE.w.planDayId), nx = liveEx(name, kind, px);
  if (i != null && xs[i]) {
    const old = xs[i], done = (old.sets || []).filter(s => s.done), was = String(old.replaced || old.name || '').trim();
    // what it stood in for (the plan's name): 收工 asks whether the plan should change to this one (B4)
    if (was && was !== name && planEx(was, LIVE.w.planDayId)) nx.replaced = was; else delete nx.replaced;
    if (done.length && !old.cardio) {  // the sets done stay with the old exercise; the rest go to the new one
      const left = (old.sets || []).filter(s => !s.done && !s.warmup && !s.drop).length;
      old.sets = done;
      if (!nx.cardio) nx.sets = Array.from({ length: Math.max(1, left) }, () => blankSet(kind));
      xs.splice(i + 1, 0, nx); LIVE.cur = i + 1;
    } else { xs[i] = nx; LIVE.cur = i; }
    toast(`换成了「${name}」`);
  } else { xs.push(nx); LIVE.cur = xs.length - 1; }
  LIVE.focus = lvNextUndone(LIVE.cur, -1);
  if (LIVE.focus && LIVE.focus.i !== LIVE.cur) LIVE.focus = null;
  lvChanged();
  requestAnimationFrame(() => lvScrollTo(`.lv-ex[data-i="${LIVE.cur}"]`, 'start'));
}

/* 「⋯」: date, name, the rest timer, dropping the session */
function lvMore() {
  const w = LIVE.w, edit = LIVE.mode === 'edit'; if (!w) return;
  S.sheet = { type: 'live-more', photos: [], removed: [] };
  showSheet(edit ? '这次记录' : '这次训练', `
    <div class="row2"><div class="field"><label for="lv-date">日期</label><input type="date" id="lv-date" value="${esc(w.date)}" max="${esc(today())}"></div>
      <div class="field"><label for="lv-title">名字</label><input type="text" id="lv-title" maxlength="40" autocomplete="off" value="${esc(w.title || '')}"></div></div>
    <div class="tgls">${edit ? '' : tgl('lv-rt', '组间计时', `打勾后自动开始；动作没写休息时间时按 ${restPref().sec} 秒`, LIVE.restOn)}${edit || !advOn() ? '' : tgl('lv-rir', '问最后一组还能做几次', '每个动作最后一组打勾后问一句，记成这组的 RPE（只在这台手机上）', rirOn())}${tgl('lv-wake', '练的时候屏幕常亮', '开着这个界面时手机不自动锁屏（只在这台手机上）', wakeOn())}</div>
    ${edit ? '' : `<div class="lv-drop"><button type="button" class="btn ghost danger" data-act="lv-discard">放弃这次训练</button><p class="hint" style="margin:0">放弃会把这次的记录删掉。</p></div>`}`,
    '<button type="button" class="btn primary main" data-act="close">好</button>');
}
function lvMoreInput(el) {
  const w = LIVE.w; if (!w) return;
  if (el.id === 'lv-date' && isDate(el.value) && el.value !== w.date) { w.date = el.value; lvChanged(); }
  if (el.id === 'lv-title') { const v = el.value.trim().slice(0, 40); if (v && v !== w.title) { w.title = v; lvChanged(); } }
  if (el.id === 'lv-rt') { LIVE.restOn = el.checked; if (!el.checked && LIVE.rest) lvRestStop(); lvPersist(); }
  if (el.id === 'lv-rir') { lsSet('lsj-rir', el.checked ? null : '0'); if (!el.checked) { LIVE.rir = null; drawDock(); } }
  if (el.id === 'lv-wake') { lsSet('lsj-wake', el.checked ? '1' : '0'); keepAwake(el.checked && LIVE.open); }
}

/* 完成: the summary, RPE, feelings, a note; 保存 */
// What gets saved: the sets ticked or with a number in them (a drop set in 训练中 only when ticked: one added and left,
// or only typed into, wasn't done), the cardio with its numbers; exercises left empty go.
function lvClean(list) {
  const filled = s => isNum(s.kg) || isNum(s.reps) || isNum(s.sec) || isNum(s.assist), live = LIVE.mode === 'live';
  return (list || []).map(x => {
    const name = String(x?.name || '').trim(); if (!name) return null;
    if (x.cardio) { const m = Object.fromEntries(Object.entries(x.metrics || {}).filter(([, v]) => isNum(v))); return Object.keys(m).length ? { ...x, name, metrics: m, sets: [] } : null; }
    const sets = (x.sets || []).filter(s => s && (s.done || (filled(s) && !(live && s.drop))));
    return sets.length ? { ...x, name, sets } : null;
  }).filter(Boolean);
}
function lvFinish() {
  const w = LIVE.w; if (!w) return;
  if (S.sheet) closeSheet(true);
  const edit = LIVE.mode === 'edit', ex = lvClean(w.exercises);
  S.sheet = { type: 'live-finish', photos: [], removed: [], saveAct: 'lv-save' };
  if (!ex.length && LIVE.isNew) {
    showSheet('还没记任何一组', '<div class="panel panel-pad"><p style="margin:0">填了重量和次数、点了 ✓ 的组才会记下。</p></div>',
      '<button type="button" class="btn ghost" data-act="close">接着记</button><button type="button" class="btn ghost danger main" data-act="lv-edit-drop" data-close="1">不记了</button>');
    return;
  }
  if (!ex.length) {
    showSheet(edit ? '一组都没有了' : '还没记任何一组', `<div class="panel panel-pad"><p style="margin:0">${edit ? '所有的组都删掉了，要删掉这次训练吗？' : '还没记任何一组，要放弃这次训练吗？'}</p></div>`,
      `<button type="button" class="btn ghost" data-act="close">${edit ? '接着改' : '继续练'}</button><button type="button" class="btn ghost danger main" data-act="${edit ? 'lv-del-edit' : 'lv-discard'}">${edit ? '删掉这次训练' : '放弃这次训练'}</button>`);
    return;
  }
  const fw = { ...w, id: LIVE.id, exercises: ex }, st = woStats(fw), planned = edit ? st.sets : woStats(w).sets;
  const dur = edit ? w.durationMin : Math.max(1, Math.round(((Date.parse(LIVE.stale || '') || Date.now()) - startMs(w)) / 60000));
  const prs = lvPrsOf(fw), prList = Object.entries(prs);
  // 下次 by the rule, with this session as the last time (Claude hasn't seen it yet)
  const nextTxt = e => {
    const r = ruleRx(e.name, fw.date, fw.planDayId, null, { last: { date: fw.date, sets: e.sets, id: LIVE.id, target: e.target, createdAt: fw.createdAt } });
    if (!r) return '';
    return `下次 ${r.load ? `${r.load} × ` : ''}${r.reps}${/秒/.test(r.reps) ? '' : ' 次'}（按规则）`;
  };
  const rows = ex.map((e, k) => {
    if (e.cardio) return `<li><span class="wr-nv"><span class="wr-n">${esc(e.name)}</span><span class="wr-v">${esc(metricsTxt(e.metrics))}</span></span></li>`;
    const v = exVerdict(e, fw), nx = nextTxt(e);
    // swapped in for a plan exercise: 以后都练这个 (the plan changes with the save) / 只这次 (B4)
    const rp = !edit && e.replaced && planEx(e.replaced, fw.planDayId) ? `<span class="cmp-l rp-line"><span class="rp-t">本来是 ${esc(e.replaced)} → ${esc(e.name)}</span>${seg('rp-' + k, [['plan', '以后都练这个'], ['once', '只这次']], 'once', 'req rp-seg')}</span>` : '';
    return `<li><span class="wr-nv"><span class="wr-n">${esc(e.name)}</span><span class="wr-v num">${v ? esc(workTxt(v.wk)) : '–'}</span></span><span class="wr-st">${prTag(prs[e.name])}${dropTag(e)}${verdictTags(v)}</span>${v ? `<span class="cmp-l">${esc(v.prev ? lastTxt({ date: v.prev.date, sets: v.prev.sets }) : '第一次练这个动作')}</span>` : ''}${nx ? `<span class="cmp-l cmp-nx">${esc(nx)}</span>` : ''}${rp}</li>`;
  }).join('');
  showSheet(edit ? (LIVE.isNew ? '保存补记' : '保存修改') : vt('live.doneTitle', '练完了'), `
    <div class="lf-sum">
      <label class="lf-k" for="lf-dur"><span class="lf-l">用时</span><span class="lf-v">${numIn('lf-dur', dur, { int: true })}<small>分钟</small></span></label>
      <div class="lf-k"><span class="lf-l">完成</span><span class="lf-v"><b class="num">${st.done}<small>/${planned}</small></b><small>组</small></span></div>
      ${advOn() ? `<div class="lf-k"><span class="lf-l">训练量</span><span class="lf-v"><b class="num">${fmt(st.vol)}</b><small>kg</small></span></div>` : ''}
    </div>
    ${prList.length ? `<div class="lf-prs">${prList.map(([n, r]) => `<p><span class="vd pr">新纪录</span><b>${esc(n)}</b><span class="num">${esc(r.text)}</span></p>`).join('')}</div>` : ''}
    <div class="cmp"><div class="sub-h">每个动作</div><ul class="cmp-list">${rows}</ul></div>
    ${advOn() ? `<div class="field"><span class="lbl">整体强度 RPE</span>${seg('rpe', RPES.map(n => [n, String(n)]), w.rpe, 'num-seg rpe-seg')}<p class="hint" style="margin:0">10 = 力竭，8 = 还能再做 2 次</p></div>`
      : `<div class="field"><span class="lbl">累不累</span>${seg('rpe', tiredOpts(w.rpe), w.rpe, 'tired-seg')}</div>`}
    <div class="field"><span class="lbl">感受</span>${chips('feel', WO_FEEL, w.feelings)}</div>
    <div class="field"><label for="lf-notes">备注</label><textarea id="lf-notes" rows="2" maxlength="1000" placeholder="哪个动作不顺、哪里不舒服…">${esc(w.notes || '')}</textarea></div>`,
    `<button type="button" class="btn ghost" data-act="close">${edit ? '接着改' : '继续练'}</button><button type="button" class="btn primary main" data-act="lv-save" id="save-btn">保存</button>`);
}
async function saveLive(sh, signal) {
  const w = LIVE.w; if (!w || !S.db) return;
  const dur = readNum('lf-dur', '用时', { int: true, min: 0, max: 600 });
  const rpe = segVal('rpe'), ex = lvClean(w.exercises), mode = LIVE.mode, id = LIVE.id;
  if (!ex.length) throw badInput('还没记任何一组');
  const now = nowIso();
  const fields = { exercises: ex, durationMin: dur, rpe: rpe ? Number(rpe) : null, feelings: chipVals('feel'), notes: fval('lf-notes').slice(0, 1000), needsReview: true, updatedAt: now };
  setBusy('保存中…');
  if (mode === 'live') {
    LIVE.finishing = true;  // no autosave of the running copy after this one
    try {
      clearTimeout(LIVE.t); clearTimeout(LIVE.retryT);
      if (LIVE.saving) await LIVE.saving;
      clearTimeout(LIVE.t); clearTimeout(LIVE.retryT);
      const doc = { ...clone(w), ...fields, endedAt: LIVE.stale || now };
      delete doc.status;
      await lvPut(id, doc, signal);
    } catch (e) { LIVE.finishing = false; throw e; }
  } else await saveFields('workouts', id, LIVE.base, { date: w.date, planDayId: w.planDayId ?? null, title: w.title || '', ...fields, ...(LIVE.base ? {} : { createdAt: w.createdAt || now }) }, signal);
  // 以后都练这个: the plan day's exercise takes the new name (its sets, reps, rest and cue stay); a failure only says so
  const swaps = mode === 'live' ? ex.map((e, k) => e.replaced && segVal('rp-' + k) === 'plan' ? { was: e.replaced, name: e.name } : null).filter(Boolean) : [];
  sh.saved = true; closeSheet(true);
  const pdId = w.planDayId, wid = id;
  lvEnd();
  S.date = w.date;
  if (S.tab !== 'today') setTab('today'); else render();
  for (const sw of swaps) { const k = ex.findIndex(e => e.name === sw.name && e.replaced === sw.was); swapPlanEx(pdId, sw.was, sw.name, wid, k).catch(e => toast(`计划没改成：${errMsg(e)}`, true)); }
  // on an iPhone with Apple Health set up: the shortcut brings the watch's heart rate onto this session
  if (mode === 'live' && canSyncHealth()) toast(vt('toast.workout', '训练已保存'), false, runHealthShortcut, '同步手表心率');
  else toast(mode === 'live' ? vt('toast.workout', '训练已保存') : '已保存，Claude 下次处理时会看');
}
// 以后都练这个 (B4): in plan day `dayId` the exercise called `was` becomes `name`; sets, reps, rest and cue stay, the load
// is what the new one was last done with (else none). Recorded in plan.custom like any edit on the page. The decision
// is remembered on this phone (lsj-rp:<session>:<k>) so the session's details stop asking.
const rpKey = (wid, k) => `lsj-rp:${wid}:${k}`;
// A plan exercise with another name in its place (收工's 以后都练这个, the editor's 换一个): sets, reps and rest stay; the
// cue becomes the new exercise's 动作库 line (none: cleared); the load what it was last done with (「22.5kg」, 自重, 辅助
// 20kg; a body-weight move never done: 自重; otherwise cleared); the weight step goes (other equipment).
function swapLoadOf(name) {
  const h = exHistory(name, today()), wk = h.last ? workOf(h.last.sets) : null, first = wk && !wk.timed ? wk.sets[0] : null;
  const was = first ? planLoadOf(first) : '';
  return was || (guessKind(name) === 'bw' ? '自重' : '');
}
function swapExFields(x, name) {
  const o = { ...x, name }, how = EX_LIB_BY.get(name)?.how || '', load = swapLoadOf(name);
  if (how) o.cue = how; else delete o.cue;
  if (load) o.load = load; else delete o.load;
  delete o.step;
  return o;
}
async function swapPlanEx(dayId, was, name, wid, k) {
  if (!S.db || !dayId) return;
  await editPlan(plan => {
    const days = Array.isArray(plan.training?.days) ? plan.training.days : [];
    const i = days.findIndex(d => d?.id === dayId); if (i < 0) return false;
    const old = clone(days[i]), nd = clone(old);
    const xs = Array.isArray(nd.exercises) ? nd.exercises : [];
    const j = xs.findIndex(x => x && String(x.name || '').trim() === was); if (j < 0) return false;
    xs[j] = swapExFields(xs[j], name);
    days[i] = nd;
    noteCustom(plan, 'training.days.' + dayId, old, nd);
  });
  if (wid != null && k != null) lsSet(rpKey(wid, k), 'plan');
  toast(`计划里的「${was}」改成了「${name}」`);
  render();
}
async function lvDiscard(btn, then) {
  if (btn && !confirmTap(btn, '确认放弃，删掉这次记录', btn.textContent)) return;
  if (!LIVE.w || LIVE.mode !== 'live') { const a = S.activeWorkout; if (!a) return; lvAdopt(a); }
  const id = LIVE.id;
  if (btn) btn.disabled = true;
  LIVE.finishing = true;
  clearTimeout(LIVE.t); clearTimeout(LIVE.retryT);
  if (LIVE.saving) await LIVE.saving;
  clearTimeout(LIVE.t); clearTimeout(LIVE.retryT);
  try { if (LIVE.created || S.db.cached('workouts', id)?.exists) await retry1(() => S.db.collection('workouts').doc(id).delete()); }
  catch (e) { if (e?.code !== 'not_found') { LIVE.finishing = false; if (btn) btn.disabled = false; toast(errMsg(e), true); return; } }
  if (S.sheet) closeSheet(true);
  lvEnd(); toast(vt('live.dropped', '这次训练放弃了'));
  then?.();
}

/* editing a finished session on this screen, or logging one afterwards (补记: a new record, LIVE.isNew) */
function lvNew(date, dayId) {
  if (LIVE.w && LIVE.mode === 'live') { toast('先把正在练的这次点完成，再补记别的', true); return; }
  const day = planDays().find(x => x.id === dayId) || null, now = nowIso();
  const w = {
    date, planDayId: day ? day.id : null, title: autoTitle(day),
    exercises: day ? (day.exercises || []).filter(x => x && typeof x === 'object' && String(x.name || '').trim()).map(x => liveEx(String(x.name).trim(), guessKind(x.name), x)) : [],
    needsReview: true, createdAt: now, updatedAt: now,
  };
  LIVE = { ...blankLive(), booted: true, autoOpened: true, w, id: newId('w'), mode: 'edit', base: null, ver: 0, isNew: true };
  LIVE.cur = 0; lvFocusFirst(); openLive();
}
function lvEdit(id) {
  if (LIVE.w && LIVE.mode === 'live') { toast('先把正在练的这次点完成，再改别的', true); return; }
  const w = S.workouts.find(x => x.id === id); if (!w || w.source === 'xunji') return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const { id: _, ...data } = clone(w);
  LIVE = { ...blankLive(), booted: true, autoOpened: true, w: data, id, mode: 'edit', base: clone(w), ver: S.db.cached('workouts', id)?.version ?? null };
  LIVE.cur = 0; lvFocusFirst(); openLive();
}
function lvEditClose() {
  if (!LIVE.dirty) { lvEnd(); return; }
  const nw = !!LIVE.isNew;
  S.sheet = { type: 'live-ask', photos: [], removed: [] };
  showSheet(nw ? '补记还没保存' : '改动还没保存', `<p style="margin:0">${nw ? '关掉的话，刚才填的都不要了。' : '关掉的话，刚才在这里改的都不要了。'}</p>`,
    `<button type="button" class="btn ghost" data-act="close">${nw ? '接着记' : '接着改'}</button><button type="button" class="btn ghost danger main" data-act="lv-edit-drop" data-close="1">${nw ? '不记了，关掉' : '不保存，关掉'}</button>`);
}
async function lvDelEdit(btn) {
  if (!confirmTap(btn, '确认删除这次训练', btn.textContent)) return;
  btn.disabled = true;
  try { await retry1(() => S.db.collection('workouts').doc(LIVE.id).delete()); }
  catch (e) { if (e?.code !== 'not_found') { btn.disabled = false; toast(errMsg(e), true); return; } }
  closeSheet(true); lvEnd(); toast(vt('toast.deleted', '已删除'));
}

/* the screen's own events: typing numbers, long-pressing a set */
liveEl.addEventListener('input', e => {
  const el = e.target; if (!LIVE.w) return;
  if (el.dataset.lf) {
    const s = LIVE.w.exercises?.[+el.dataset.i]?.sets?.[+el.dataset.j]; if (!s) return;
    const v = markNum(el, el.dataset.lf === 'reps' || el.dataset.lf === 'sec');
    if (!Number.isNaN(v)) { s[el.dataset.lf] = v == null ? null : r2(v); LIVE.focus = { i: +el.dataset.i, j: +el.dataset.j }; lvChanged(false); }
  } else if (el.dataset.lm) {
    const x = LIVE.w.exercises?.[+el.dataset.i]; if (!x) return;
    const v = markNum(el, el.dataset.lm !== 'km');
    if (!Number.isNaN(v)) { x.metrics = { ...(x.metrics || {}) }; if (v == null) delete x.metrics[el.dataset.lm]; else x.metrics[el.dataset.lm] = v; lvChanged(false); }
  }
});
liveEl.addEventListener('change', e => { if (e.target.dataset?.lf || e.target.dataset?.lm) setTimeout(drawLive, 0); });
liveEl.addEventListener('focusout', e => { if (e.target.classList?.contains('lv-v')) setTimeout(() => { const a = document.activeElement; if (!(a && a.tagName === 'INPUT' && liveEl.contains(a))) drawLive(); }, 0); });
liveEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.classList?.contains('lv-v')) { e.preventDefault(); e.target.blur(); } });
liveEl.addEventListener('focusin', e => {
  const el = e.target; if (!el.dataset?.lf) return;
  const row = el.closest('.lv-set'); if (row && !row.classList.contains('focus')) lvFocusRow(row);
  try { el.select(); } catch (x) {}
});
let lpT = null, lpFired = false, lpXY = null;
liveEl.addEventListener('pointerdown', e => {
  lpFired = false; clearTimeout(lpT);
  const row = e.target.closest('.lv-set[data-j]'); if (!row || e.target.closest('input, .lv-pm, .lv-tick')) return;
  lpXY = [e.clientX, e.clientY];
  lpT = setTimeout(() => { lpFired = true; buzz(10); lvSetMenu(+row.dataset.i, +row.dataset.j); }, 520);
});
['pointerup', 'pointercancel'].forEach(t => liveEl.addEventListener(t, () => clearTimeout(lpT)));
liveEl.addEventListener('pointermove', e => { if (lpXY && Math.hypot(e.clientX - lpXY[0], e.clientY - lpXY[1]) > 10) clearTimeout(lpT); });
liveEl.addEventListener('click', e => { if (lpFired) { lpFired = false; e.stopPropagation(); e.preventDefault(); } }, true);
liveEl.addEventListener('contextmenu', e => { if (e.target.closest('.lv-set')) e.preventDefault(); });
// back online / back in the app: write what is waiting
window.addEventListener('online', () => { if (LIVE.w && LIVE.rev !== LIVE.savedRev) lvSave(); });

/* ---------- The full-screen pages of the 训练 tab: 训练历史, a plan day, the exercises ----------
   One panel (histEl) over the tabs, ‹ at the top closes it; over it only sheets open (a session's details, an
   exercise's details), never another page. view 'main' 训练历史: the month's calendar (the plan day's letter on a day
   trained, a dot for a session outside the plan; ‹ ›, or a swipe, changes the month; a tap scrolls to that day), the
   month in numbers, then the sessions newest first by month, 30 at a time, filtered by plan day. view 'day': a plan
   day's exercises (a row opens the exercise's details), 按这天开练, 编辑, what the person changed, where it is in 训记.
   view 'exs': every exercise done (stats.js exRows), most sessions first, searchable and filtered by body part; a row
   opens the exercise's details sheet. The page holds what S.workouts has loaded; older months come in with
   S.db.ensure as the calendar or the list gets there. */
const HIST_FLOOR = '2000-01-01';  // ensure() from here on: everything
const HIST = { open: false, view: 'main', id: '', month: '', filter: '*', n: 30, q: '', part: '', oldest: null, last: {} };
const histEl = document.createElement('div');
histEl.id = 'hist'; histEl.className = 'hist'; histEl.hidden = true;
histEl.setAttribute('role', 'dialog'); histEl.setAttribute('aria-modal', 'true'); histEl.setAttribute('aria-label', '训练历史');
document.body.insertBefore(histEl, sheetEl);
const ymOf = d => String(d).slice(0, 7);
// workouts are loaded from this date on ('' = all of them; null before the first load)
const woCover = () => { const c = S.db?.cover?.().workouts; return c === undefined ? null : c; };
const histAll = () => { const c = woCover(); return c === '' || (isDate(c) && c <= HIST_FLOOR); };
function histEnsure(from) { const c = woCover(); if (isDate(c) && c > from) S.db.ensure(from); }
const exRows = () => { try { return window.LSJData?.exRows?.() || []; } catch (e) { console.error(e); return []; } };
// workTxt, with reps and no weight at all said as 自重 (older 训记 imports carry no body-weight mark)
const histWk = sets => { const wk = workOf(sets); if (!wk) return ''; const t = workTxt(wk); return /^– × /.test(t) ? `自重${t.slice(1)}` : t; };

// o.view: 'main' (default), 'day' with o.id (a plan day), 'exs'.
function openHist(o = {}) {
  if (!S.db) return;
  const view = ['main', 'day', 'exs'].includes(o.view) ? o.view : 'main';
  if (view === 'day' && !isPlanDay(o.id)) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  Object.assign(HIST, { open: true, view, id: view === 'day' ? o.id : '', month: ymOf(today()), filter: '*', n: 30, q: '', part: '', oldest: null, last: {}, adj: false, gone: [] });
  histEl.setAttribute('aria-label', view === 'day' ? '训练日' : view === 'exs' ? '动作' : '训练历史');
  histEl.innerHTML = '<div class="hs-top" id="hs-top"></div><div class="hs-body" id="hs-body"><div class="hs-in" id="hs-in"></div></div>';
  histEl.hidden = false; document.documentElement.classList.add('hist-on');
  layerSync();
  drawHist();
  $('#hs-body', histEl).scrollTop = 0;
}
function closeHist() {
  HIST.open = false; histIO?.disconnect(); histIO = null;  // its root goes with the page
  histEl.hidden = true; histEl.innerHTML = ''; document.documentElement.classList.remove('hist-on');
  layerSync();
}
// Each part is rewritten only when its HTML changed (an open search keeps its keyboard, the list keeps its scroll).
function drawHist() {
  if (!HIST.open) return;
  const put = (sel, k, h) => { const el = $(sel, histEl); if (el && HIST.last[k] !== h) { el.innerHTML = h; HIST.last[k] = h; return true; } return false; };
  put('#hs-top', 'top', histTopHTML());
  if (HIST.last.mode !== HIST.view) {
    $('#hs-in', histEl).innerHTML = HIST.view === 'main' ? '<section class="panel hs-cal" id="hs-cal" aria-label="月历"></section><div class="hs-ctl" id="hs-ctl"></div><div class="hs-list" id="hs-list"></div>'
      : HIST.view === 'exs' ? '<div class="hs-ctl" id="hs-ctl"></div><div class="hs-list" id="hs-list"></div>' : '<div class="hs-day" id="hs-day"></div>';
    HIST.last = { top: HIST.last.top, mode: HIST.view };
  }
  if (HIST.view === 'day') { put('#hs-day', 'day', dayPageHTML(HIST.id)); return; }
  if (HIST.view === 'exs') {
    if (put('#hs-ctl', 'ctl', exsCtlHTML())) { const q = $('#hs-q', histEl); if (q) q.value = HIST.q; }
    put('#hs-list', 'list', exsListHTML());
    return;
  }
  const none = S.loaded.has('workouts') && !S.workouts.length && histAll();
  $('#hs-cal', histEl).hidden = none; $('#hs-ctl', histEl).hidden = none;
  if (!none) { put('#hs-cal', 'cal', histCalHTML()); put('#hs-ctl', 'ctl', histCtlHTML()); }
  // a list redrawn, or an older stretch loaded that brought nothing new: 再看更早的 is watched again
  const cov = woCover();
  if (put('#hs-list', 'list', none ? histEmptyHTML() : histListHTML()) || cov !== HIST.last.cov) histWatch();
  HIST.last.cov = cov;
}
function histTopHTML() {
  const pd = HIST.view === 'day' ? planDays().find(x => x.id === HIST.id) : null;
  const title = pd ? esc(pd.name || dayShort(pd)) : HIST.view === 'exs' ? '动作' : '训练历史';
  const sub = pd ? esc([pd.focus, `${planExs(pd).length} 个动作`].filter(Boolean).join(' · ')) : HIST.view === 'exs' ? `练过 ${exRows().length} 个` : '';
  const tt = pd ? `<button type="button" class="hs-tt hs-tt-ed" data-act="dp-meta" aria-label="改名字和备注"><b>${title}<i class="ed" aria-hidden="true">✎</i></b>${sub ? `<small>${sub}</small>` : ''}</button>`
    : `<div class="hs-tt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<button type="button" class="icon-btn hs-back" data-act="hs-back" aria-label="回到训练页">${CHEV(-1)}</button>
    ${tt}${pd ? '<button type="button" class="icon-btn hs-more" data-act="dp-more" aria-label="更多：复制、轮换、删掉这一天">⋯</button>' : ''}`;
}
function histEmptyHTML() {
  return `<div class="panel panel-pad hs-empty"><p>还没有训练记录。练完一次，这里会按日期列出每次练了什么。</p>${appOn() ? '<button type="button" class="btn ghost sm" data-act="hs-today">去「今日」开练</button>' : ''}</div>`;
}

/* a plan day's page */
function dayPageHTML(id) {
  const d = planDays().find(x => x.id === id); if (!d) return '<p class="hs-none">这一天已经不在计划里了。</p>';
  const t = today(), xs = planExs(d), last = lastDayOf(id, addDays(t, 1)), cust = planCustom(), fromTpl = !!S.plan?.template && typeof S.plan.template === 'object';
  const mine = ('training.days.' + id) in cust ? `<span class="tag mine">${fromTpl && cust['training.days.' + id]?.was == null ? '你的' : '你改过'}</span>` : '';
  const rotOn = rotation().length > 0, inRot = rotation().includes(id);
  const meta = [last ? `上次 ${md(last)}（隔了 ${gapTxt(daysBetween(last, t))}）` : '还没练过', isPlanDay(expectedKind(t)) && expectedKind(t) === id && !S.workouts.some(w => w.date === t) ? '今天就是这天' : '', rotOn && !inRot ? '不在轮换里' : ''].filter(Boolean).join(' · ');
  const adj = HIST.adj, gone = HIST.gone.filter(g => g.id === id);
  // a row: that exercise's sheet; 调整: − and ↑ ↓; a deleted one: 已删掉 · 撤销 where it was
  const row = (x, i) => {
    const name = String(x.name || '').trim(), sub = [plainRpe(spaced(x.load)), x.rest ? spaced(x.rest) : ''].filter(Boolean).join(' · ');
    if (adj) return `<li class="pex adj"><button type="button" class="pd-x" data-act="px-del" data-id="${esc(id)}" data-i="${i}" aria-label="删掉${esc(name || '这个动作')}">−</button><span class="pex-l"><b>${esc(name || '动作')}</b><small>${esc(humanTarget(`${x.sets ?? ''}×${x.reps ?? ''}`))}${sub ? ` · ${esc(sub)}` : ''}</small></span><span class="pd-mv"><button type="button" class="icon-btn" data-act="px-up" data-id="${esc(id)}" data-i="${i}" aria-label="上移"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="icon-btn" data-act="px-down" data-id="${esc(id)}" data-i="${i}" aria-label="下移"${i === xs.length - 1 ? ' disabled' : ''}>↓</button></span></li>`;
    const adv = exHistory(name, t).advice;
    return `<li class="pex"><button type="button" class="pex-row" data-act="px-open" data-id="${esc(id)}" data-i="${i}" aria-label="${esc(name || '动作')}：改组数、次数、重量"><div class="pex-l"><b>${esc(name || '动作')}</b>${x.cue ? `<span class="cue">${esc(x.cue)}</span>` : ''}${adv ? `<span class="nx">${AG}下次 ${esc(adv)}</span>` : ''}</div><div class="pex-r"><span class="num">${esc(humanTarget(`${x.sets ?? ''}×${x.reps ?? ''}`))}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>${CHEV_R}</button></li>`;
  };
  const goneRow = (g, k) => `<li class="pex pd-gone"><span>已删掉「${esc(g.name)}」</span><button type="button" class="link" data-act="px-undo" data-k="${HIST.gone.indexOf(g)}">撤销</button></li>`;
  const items = []; xs.forEach((x, i) => { gone.filter(g => g.at === i).forEach(g => items.push(goneRow(g))); items.push(row(x, i)); });
  gone.filter(g => g.at >= xs.length).forEach(g => items.push(goneRow(g)));
  const go = appOn() && xs.length && !activeWo() ? `<button type="button" class="btn primary" data-act="hs-start" data-day="${esc(id)}">${esc(vt('btn.liveDay', '按这天开练'))}</button>` : '';
  const xj = xjUser() && xjOn() ? `<div class="panel xjmaps">${xjDayBar(d)}</div>` : '';
  const cr = customRows(['training.days.' + id]);
  return `<div class="panel panel-pad dp-head"><p class="dp-meta">${mine}<span>${esc(meta)}</span></p>${go ? `<div class="btns">${go}</div>` : ''}</div>
    <div class="sec-h dp-sh"><h2>动作</h2><span class="count">${xs.length} 个</span>${xs.length ? `<button type="button" class="link" data-act="dp-adj">${adj ? '完成' : '调整'}</button>` : ''}</div>
    <div class="panel pd">${items.length ? `<ul class="pex-list">${items.join('')}</ul>` : ''}<button type="button" class="pd-add" data-act="px-add" data-id="${esc(id)}">+ 加动作</button>${d.note ? `<p class="hint">${esc(d.note)}</p>` : ''}</div>
    ${cr ? `<div class="panel cust-box">${cr}</div>` : ''}${xj}`;
}

/* the exercises: search, body parts, the list */
const EX_PARTS = ['胸', '背', '肩', '腿', '手臂', '核心', '有氧', '其他'];
function exsCtlHTML() {
  const parts = new Set(exRows().map(r => exPart(r.name)));
  const chips = EX_PARTS.filter(p => parts.has(p));
  return `<div class="hs-q"><input type="text" id="hs-q" placeholder="搜动作" autocomplete="off" enterkeyhint="search" maxlength="40" aria-label="搜动作"></div>
    ${chips.length > 1 ? `<div class="chips hs-fl" role="group" aria-label="只看">${[['', '全部'], ...chips.map(p => [p, p])].map(([v, l]) => `<button type="button" class="chip" data-act="hs-part" data-v="${esc(v)}" aria-pressed="${HIST.part === v}">${l}</button>`).join('')}</div>` : ''}`;
}
function exsListHTML() {
  if (!S.loaded.has('workouts')) return loading;
  const rows = exRows();
  if (!rows.length) return '<p class="hs-none">还没有带重量或次数的训练记录。</p>';
  const q = HIST.q.trim().toLowerCase(), t = today(), since = addDays(t, -27);
  const xs = rows.filter(r => (!q || r.name.toLowerCase().includes(q)) && (!HIST.part || exPart(r.name) === HIST.part));
  if (!xs.length) return `<p class="hs-none">${q ? `没有名字里带「${esc(HIST.q.trim())}」的动作` : '这个部位还没有动作'}</p>`;
  return `<div class="panel hs-xl">${xs.map(r => {
    const wk = histWk(r.sets), part = exPart(r.name), pr = isDate(r.pr) && r.pr >= since && r.pr <= t;
    return `<button type="button" class="hs-xr" data-act="ex-open" data-n="${esc(r.name)}"><span class="hs-xn"><b>${esc(r.name)}${part !== '其他' ? `<span class="hs-xp">${esc(part)}</span>` : ''}${pr ? '<span class="vd pr">纪录</span>' : ''}</b><small>${r.n} 次 · 最近 ${esc(md(r.last))}${wk ? ` · <span class="num">${esc(wk)}</span>` : ''}</small></span>${r.best ? `<span class="hs-xb"><b class="num">${esc(r.best.v)}</b><small>${esc(r.best.k)}</small></span>` : ''}${CHEV_R}</button>`;
  }).join('')}</div>${histAll() ? '' : '<p class="hs-end">算的是已经读到的记录；在「训练历史」里往下翻，会读更早的。</p>'}`;
}

/* the month: calendar and numbers */
const histMonthWos = m => S.workouts.filter(w => ymOf(w.date) === m);
// ‹ goes back while there may be older sessions: all loaded, down to the month of the oldest one.
function histCanPrev() {
  if (!histAll()) return true;
  const o = S.workouts[S.workouts.length - 1]; return !!o && ymOf(o.date) < HIST.month;
}
function histCalHTML() {
  const m = HIST.month, [y, mo] = m.split('-').map(Number), t = today(), first = `${m}-01`;
  const n = new Date(y, mo, 0).getDate(), lead = isoWd(first) - 1, ws = histMonthWos(m), by = new Map();
  for (const w of [...ws].sort(latestFirst).reverse()) { if (!by.has(w.date)) by.set(w.date, []); by.get(w.date).push(w); }
  const cells = Array.from({ length: lead }, () => '<span class="hs-d pad" aria-hidden="true"></span>');
  for (let k = 1; k <= n; k++) {
    const d = `${m}-${pad(k)}`, xs = by.get(d), cls = `hs-d${d === t ? ' now' : ''}${d > t ? ' fut' : ''}`;
    if (!xs) { cells.push(`<span class="${cls}"><span class="hs-dn num">${k}</span></span>`); continue; }
    const ids = [...new Set(xs.map(w => isPlanDay(w.planDayId) ? w.planDayId : ''))].slice(0, 2);
    const mk = ids.map(id => id ? `<span class="dayid sm">${esc(dayShortOf(id))}</span>` : '<i class="hs-dot"></i>').join('');
    cells.push(`<button type="button" class="${cls} on" data-act="hs-day" data-d="${d}" aria-label="${esc(`${fmtDay(d)}，练了${xs.map(woTitle).join('、')}`)}"><span class="hs-dn num">${k}</span><span class="hs-mk">${mk}</span></button>`);
  }
  const c = woCover(), wait = isDate(c) && c > first && !histAll();
  const st = ws.reduce((a, w) => { const x = woStats(w); a.done += x.done; a.vol += x.vol; if (isNum(w.durationMin)) a.min += w.durationMin; return a; }, { done: 0, vol: 0, min: 0 });
  const tile = (v, u, l) => `<div class="hs-k"><b class="num">${v}<small>${u}</small></b><span>${l}</span></div>`;
  // working sets by muscle (no warm-ups, drop sets or cardio): 1 for the muscle an exercise is for, 0.5 for the ones it
  // works on the side (the same buckets as 每周各部位)
  const parts = new Map();
  for (const w of ws) for (const e of w.exercises || []) {
    if (!e || typeof e !== 'object' || e.cardio) continue;
    const xs = (e.sets || []).filter(s => s && typeof s === 'object' && !s.warmup && !s.drop && hasSetData(s)), n = (xs.some(s => s.done) ? xs.filter(s => s.done) : xs).length;
    if (!n) continue;
    for (const [m, wgt] of Object.entries(muscleWeights(e.name))) parts.set(m, (parts.get(m) || 0) + n * wgt);
  }
  const pl = MUSCLES.map(m => [m, Math.round((parts.get(m) || 0) * 2) / 2]).filter(([, n]) => n > 0).sort((a, z) => z[1] - a[1]);
  const partLine = pl.length ? `<p class="hs-parts"><span>本月各部位（含间接）</span>${pl.map(([p, n]) => `<b>${esc(p)} <span class="num">${n}</span></b>`).join('')}</p>` : '';
  const sum = ws.length ? `<div class="hs-sum">${tile(ws.length, '次', '练了')}${tile(st.done, '组', '完成')}${advOn() ? tile(st.vol ? fmt(st.vol) : '0', 'kg', '训练量') : ''}${tile(st.min ? +(st.min / 60).toFixed(1) : '–', 'h', '时长')}</div>${partLine}`
    : `<p class="hs-none">${wait ? '正在读取这个月的记录…' : m === ymOf(t) ? '这个月还没练' : '这个月没有训练记录'}</p>`;
  return `<div class="hs-mh"><button type="button" class="icon-btn" data-act="hs-m" data-n="-1" aria-label="上个月"${histCanPrev() ? '' : ' disabled'}>${CHEV(-1)}</button><b class="hs-mt num" aria-live="polite">${y} 年 ${mo} 月</b><button type="button" class="icon-btn" data-act="hs-m" data-n="1" aria-label="下个月"${m < ymOf(t) ? '' : ' disabled'}>${CHEV(1)}</button></div>
    <div class="hs-wk" aria-hidden="true">${['一', '二', '三', '四', '五', '六', '日'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="hs-grid">${cells.join('')}</div>${sum}`;
}
function histMonth(dn) {
  const [y, m] = HIST.month.split('-').map(Number), d = new Date(y, m - 1 + dn, 1), nm = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (nm > ymOf(today()) || (dn < 0 && !histCanPrev())) return;
  HIST.month = nm; histEnsure(`${nm}-01`); drawHist();
}
// A day in the calendar: its first session in the list by date (the filter let go of if it hides it), scrolled to.
function histDay(d) {
  if (!histList().some(w => w.date === d)) HIST.filter = '*';
  const k = histList().findIndex(w => w.date === d); if (k < 0) return;
  if (k >= HIST.n) HIST.n = Math.ceil((k + 10) / 30) * 30;
  drawHist();
  const el = document.getElementById('hs-d-' + d); if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* the filter by plan day */
function histCtlHTML() {
  const opts = [['*', '全部'], ...planDays().map(d => [d.id, esc(dayShort(d)), d.name || dayShort(d)]), ['-', '其他', '不在计划里的']];
  return `<div class="chips hs-fl" role="group" aria-label="只看">${opts.map(([v, l, a]) => `<button type="button" class="chip" data-act="hs-f" data-v="${esc(v)}" aria-pressed="${HIST.filter === v}"${a ? ` aria-label="${esc(a)}"` : ''}>${l}</button>`).join('')}</div>`;
}
function histList() {
  const f = HIST.filter;
  return S.workouts.filter(w => f === '*' || (f === '-' ? !isPlanDay(w.planDayId) : w.planDayId === f)).sort(newestFirst);
}
function histListHTML() {
  if (!S.loaded.has('workouts')) return loading;
  const all = histList(), xs = all.slice(0, HIST.n), c = woCover();
  if (!all.length) return `<p class="hs-none">${histAll() ? '没有这样的训练' : '已经读到的记录里没有这样的训练'}</p>${histAll() ? '' : '<button type="button" class="btn ghost hs-more" id="hs-more" data-act="hs-more">再看更早的</button>'}`;
  let out = '', mo = '', day = '';
  for (const w of xs) {
    const m = ymOf(w.date);
    if (m !== mo) {
      const whole = histAll() || (isDate(c) && `${m}-01` >= c);  // the count only for a month loaded in full
      out += `${mo ? '</div>' : ''}<h3 class="hs-mo">${+m.slice(0, 4)} 年 ${+m.slice(5)} 月${whole ? `<small>${all.filter(x => ymOf(x.date) === m).length} 次</small>` : ''}</h3><div class="hs-cards">`;
      mo = m;
    }
    out += histCard(w, w.date !== day); day = w.date;
  }
  out += '</div>';
  const more = all.length > HIST.n || !histAll();
  const oldest = all[all.length - 1];
  return out + (more ? '<button type="button" class="btn ghost hs-more" id="hs-more" data-act="hs-more">再看更早的</button>'
    : `<p class="hs-end">${all.length} 次训练${oldest ? `，最早一次是 ${oldest.date.slice(0, 4) !== today().slice(0, 4) ? `${oldest.date.slice(0, 4)}/` : ''}${esc(mdw(oldest.date))}` : ''}</p>`);
}
// One session, compact (like 训记's history): date and weekday, plan day, title, 训记, then time · sets done · volume
// · heart rate, and per exercise its working sets (纪录 when it beat a record there, +递减 with drop sets).
function histCard(w, anchor) {
  const st = woStats(w), pd = isPlanDay(w.planDayId) ? w.planDayId : null, d = parseD(w.date), avg = hrAvg(w);
  const meta = [isNum(w.durationMin) ? `${w.durationMin} 分钟` : '', st.sets ? `${st.done} 组` : '', st.vol && advOn() ? `${fmt(st.vol)} kg` : ''].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')
    + (avg != null ? `<span class="hs-hr">${HEART}均 ${avg}</span>` : '');
  const exs = (w.exercises || []).filter(e => e && typeof e === 'object' && String(e.name || '').trim()).map(e => {
    const v = e.cardio ? metricsTxt(e.metrics) || '有氧' : histWk(e.sets) || '–';
    const tags = (!e.cardio && prOf(w, e.name) ? '<span class="vd pr">纪录</span>' : '') + dropTag(e);
    return `<span class="hs-ex"><span class="hs-en">${esc(e.name)}${tags ? `<span class="hs-tg">${tags}</span>` : ''}</span><span class="hs-ev num">${esc(v)}</span></span>`;
  }).join('');
  return `<button type="button" class="hs-card" data-act="hs-wo" data-id="${esc(w.id)}"${anchor ? ` id="hs-d-${esc(w.date)}"` : ''}>
    <span class="hs-dt"><b class="num">${d.getMonth() + 1}/${d.getDate()}</b><small>周${WD[d.getDay()]}</small></span>
    <span class="hs-m"><span class="hs-h">${pd ? `<span class="dayid sm">${esc(dayShortOf(pd))}</span>` : ''}<b class="hs-t">${esc(woTitle(w))}</b>${w.source === 'xunji' ? '<span class="tag src">训记</span>' : ''}${CHEV_R}</span>
      ${meta ? `<span class="hs-meta">${meta}</span>` : ''}${exs ? `<span class="hs-exs">${exs}</span>` : ''}</span></button>`;
}

/* more: the next 30 loaded, else a year further back (then everything, when a year brought nothing older) */
let histIO = null;
function histMore() {
  if (histList().length > HIST.n) { HIST.n += 30; drawHist(); return; }
  if (histAll()) return;
  const c = woCover(); if (!isDate(c)) return;
  const oldest = S.workouts[S.workouts.length - 1]?.date || null;
  const from = HIST.oldest !== null && HIST.oldest === oldest ? HIST_FLOOR : addDays(c, -365);
  HIST.oldest = oldest; S.db.ensure(from);
}
// 再看更早的 also goes by itself when it scrolls into view
function histWatch() {
  histIO?.disconnect();
  const el = $('#hs-more', histEl); if (!el || !('IntersectionObserver' in window)) return;
  histIO = histIO || new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && HIST.open && HIST.view === 'main') histMore(); }, { root: $('#hs-body', histEl), rootMargin: '0px 0px 300px 0px' });
  histIO.observe(el);
}
histEl.addEventListener('input', e => { if (e.target.id === 'hs-q') { HIST.q = e.target.value.slice(0, 40); drawHist(); } });
// a sideways swipe on the calendar: the month before (→) or after (←)
let hsSwipe = null, hsSwiped = 0;
histEl.addEventListener('pointerdown', e => { hsSwipe = e.target.closest('#hs-cal') ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; });
histEl.addEventListener('pointerup', e => {
  const s = hsSwipe; hsSwipe = null; if (!s) return;
  const dx = e.clientX - s.x, dy = e.clientY - s.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy) && Date.now() - s.t < 900) { hsSwiped = Date.now(); histMonth(dx < 0 ? 1 : -1); }
});
histEl.addEventListener('pointercancel', () => { hsSwipe = null; });
histEl.addEventListener('click', e => { if (Date.now() - hsSwiped < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
/* ---------- body ---------- */
// 体重 and 体脂率 share the rules for where the number comes from (typed here or Apple Health) and the two links under
// them: 清除这天… (stays cleared, a wrong scale reading) and 恢复自动 (Apple Health's own number). k: 'w' or 'bf'.
const SRC = {
  w: { f: 'weight', auto: 'weightAuto', src: 'weightSource', lbl: '体重', u: 'kg', inp: 'f-w', el: 'w-src', fn: weightSrc },
  bf: { f: 'bodyFat', auto: 'bodyFatAuto', src: 'bodyFatSource', lbl: '体脂率', u: '%', inp: 'f-bf', el: 'bf-src', fn: bodyFatSrc },
};
function openBody(date = S.date) {
  const b = S.body[date];
  S.sheet = { type: 'body', col: 'body', id: date, isNew: !b, existing: clone(b), wact: null, bfact: null, photos: (b?.photos || []).filter(pid => PHOTO_ID.test(String(pid))).map(pid => ({ id: pid, url: blobSrc(pid), orig: true })), removed: [], reopen: () => openBody(date) };
  const synced = S.sleep[date]?.source === 'apple-health';
  const hasMore = MEAS.some(([k]) => isNum(b?.[k]));
  showSheet(`身体数据 · ${mdw(date)}`, `
    <div class="row3"><div class="field"><label for="f-w">体重 kg</label>${numIn('f-w', b?.weight)}</div>
    <div class="field"><label for="f-s">睡眠 h</label>${numIn('f-s', b?.sleep)}</div>
    <div class="field"><label for="f-wa">腰围 cm</label>${numIn('f-wa', b?.waist)}</div></div>
    <div class="wsrc" id="w-src"></div>
    <div class="bf-row"><div class="field"><label for="f-bf">体脂率 %</label>${numIn('f-bf', b?.bodyFat, { ph: '可不填' })}</div><div class="wsrc" id="bf-src"></div></div>
    <details class="kn" id="more-meas"${hasMore ? ' open' : ''}><summary>更多围度<span>臂围、胸围、臀围、大腿围</span></summary>
      <div class="mac4">${MEAS.map(([k, l]) => `<label class="mini"><span>${l} cm</span>${numIn('f-' + k, b?.[k])}</label>`).join('')}</div>
      <p class="hint">腰围量肚脐一圈、呼气后；臂围量放松时最粗的地方；臀围量最翘处，大腿围量臀线下面最粗处。每两周早上同一时间量一次，软尺贴皮肤别勒紧。</p></details>
    <p class="hint" style="margin:0">体重最好每天早上空腹、如厕后称，Claude 会看 7 天平均的趋势，不看单日起伏。${synced ? '睡眠已经从 Apple 健康同步过来了，在这里改了就以你填的为准。' : ''}</p>
    <button type="button" class="link" data-act="sleep-open" data-d="${esc(date)}" style="align-self:flex-start;min-height:40px">改入睡、起床和深睡等分期 ›</button>
    ${synced ? '' : photoField('可以上传 Apple Watch 或「健康」App 的睡眠截图，Claude 处理时会读出入睡、起床时间和深睡等数据。开了自动同步就不用传。', '睡眠截图')}
    <div class="field"><label for="f-notes">备注</label><textarea id="f-notes" rows="2" placeholder="生理期、熬夜、喝酒、出差…">${esc(b?.notes || '')}</textarea></div>
  `, footer('save-body', !!b));
  drawWeightSrc(); drawPhotos();
  formReady('save-body', date);
}
// Where the weight and the body fat come from, with 清除这天… and 恢复自动 (only when Apple Health's own number is
// known: an old synced value without it would just be deleted, #39). Both take effect on 保存.
function drawWeightSrc() {
  const sh = S.sheet; if (sh?.type !== 'body') return;
  for (const k of ['w', 'bf']) {
    const o = SRC[k], el = $('#' + o.el, sheetEl); if (!el) continue;
    const b = sh.existing, src = o.fn(b), auto = isNum(b?.[o.auto]) ? b[o.auto] : null, act = sh[k + 'act'];
    let txt = src === 'apple-health' ? `${o.lbl}：Apple 健康同步` : src === 'manual' ? `${o.lbl}：自己填的${auto != null && auto !== b[o.f] ? `（Apple 健康是 ${auto} ${o.u}）` : ''}` : src === 'cleared' ? `这天的${o.lbl}清除了，同步也不会再填` : '';
    if (act === 'clear') txt = `保存后清除这天的${o.lbl}，同步也不会再填`;
    if (act === 'auto') txt = auto != null ? `保存后用 Apple 健康的 ${auto} ${o.u}` : '保存后等 Apple 健康同步来填';
    const btns = [isNum(b?.[o.f]) && act !== 'clear' ? `<button type="button" class="link" data-act="${k}-clear">清除这天${o.lbl}</button>` : '',
      (src === 'manual' || src === 'cleared') && auto != null && act !== 'auto' ? `<button type="button" class="link" data-act="${k}-auto">恢复自动</button>` : ''].join('');
    el.innerHTML = txt || btns ? `<span>${esc(txt)}</span>${btns}` : '';
  }
}
function weightAct(kind, k = 'w') {
  const sh = S.sheet; if (sh?.type !== 'body' || !SRC[k]) return;
  const o = SRC[k], inp = $('#' + o.inp, sheetEl), b = sh.existing;
  sh[k + 'act'] = kind;
  inp.value = kind === 'auto' && isNum(b?.[o.auto]) ? String(b[o.auto]) : '';
  inp.removeAttribute('aria-invalid');
  drawWeightSrc(); sheetChanged();
}
// The value and its source for 体重 / 体脂率 as the sheet left them (fields gets value and, when it changes, source).
// A number typed here wins over Apple Health from now on: the server won't overwrite a manual one. Only when a value
// was typed: clearing the field leaves the day open for the scale.
function srcFields(fields, k, v, before, act) {
  const o = SRC[k], auto = isNum(before?.[o.auto]) ? before[o.auto] : null;
  fields[o.f] = v;
  if (act === 'clear' && v == null) { fields[o.f] = null; fields[o.src] = 'manual'; }
  else if (act === 'auto' && (v == null || v === auto)) {
    if (auto != null) { fields[o.f] = auto; fields[o.src] = 'apple-health'; } else { fields[o.f] = undefined; fields[o.src] = undefined; }
  } else if (!same(v, before?.[o.f])) { if (v != null) fields[o.src] = 'manual'; else if (before?.[o.src] === 'manual') fields[o.src] = null; }
}
const r1 = v => v == null ? v : Math.round(v * 10) / 10;
async function saveBody(sh, signal) {
  if (!S.db) return;
  const before = sh.existing;
  const weight = readNum('f-w', '体重', { min: 20, max: 400 }), sleepH = readNum('f-s', '睡眠', { min: 0, max: 24 }), waist = readNum('f-wa', '腰围', { min: 30, max: 250 });
  const bodyFat = r1(readNum('f-bf', '体脂率', { min: 2, max: 70 }));
  const fields = { date: sh.id, sleep: sleepH, waist, notes: fval('f-notes') };
  for (const [k, l] of MEAS) fields[k] = r1(readNum('f-' + k, l, { min: 10, max: 200 }));
  srcFields(fields, 'w', weight, before, sh.wact);
  srcFields(fields, 'bf', bodyFat, before, sh.bfact);
  if (!same(sleepH, before?.sleep)) { if (sleepH != null) fields.sleepSource = 'manual'; else if (before?.sleepSource === 'manual') fields.sleepSource = null; }
  const hasPhotos = !!sheetEl.querySelector('#ph-grid-photos');
  if (!(hasPhotos && !same(photoIds(sh.photos), before?.photos)) && !changedFields(fields, before).length) { await saved(sh); return; }
  setBusy('保存中…');
  const photos = S.assets && hasPhotos ? await uploadPhotos(sh, 'photos', signal) : (before?.photos || []);
  setBusy('保存中…');
  const doc = { ...fields, photos, updatedAt: nowIso() };
  const had = before?.photos || [];
  if (photos.some(p => !had.includes(p))) doc.needsReview = true;  // a new screenshot for Claude to read
  else if (!photos.length) doc.needsReview = false;
  await saveFields('body', sh.id, before, doc, signal);
  const cleared = [sh.wact === 'clear' && fields.weight === null ? '体重' : '', sh.bfact === 'clear' && fields.bodyFat === null ? '体脂率' : ''].filter(Boolean);
  await saved(sh, doc.needsReview ? '已记录，截图等 Claude 读取' : cleared.length ? `这天的${cleared.join('和')}清除了` : '已记录');
}

/* ---------- 身材照: progress/<date> {date, photos: {front, side, back}, note, needsReview} ----------
   Three photo spots (camera or library, compressed like every photo here), a note. Saved on today's date; a set already
   taken today is opened to change. New or changed photos ask Claude to compare with the set before (needsReview). */
const photoList = v => Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
function openProgress(date = today()) {
  if (S.sheet || !sheetEl.hidden) { closeSheet(); if (S.sheet) return; }
  const p = S.progress.find(x => x.date === date) || null;
  const ph = p?.photos && typeof p.photos === 'object' ? p.photos : {};
  const slots = Object.fromEntries(PP_SLOTS.map(([k]) => [k, PHOTO_ID.test(String(ph[k] || '')) ? { id: ph[k], url: blobSrc(ph[k]), orig: true } : null]));
  S.sheet = { type: 'progress', col: 'progress', id: date, isNew: !p, existing: clone(p), slots, photos: [], removed: [], reopen: () => openProgress(date) };
  const last = S.progress.find(x => isDate(x.date) && x.date < date);
  showSheet(`身材照 · ${mdw(date)}`, `
    <div class="pp-tip"><b>每次都一样，才比得出变化</b><span>同一时间、同样光线、穿同样的衣服，站在同一个位置；手机放在同样的高度，全身入镜。</span></div>
    ${S.assets ? '<div class="pp-grid" id="pp-grid"></div>' : photoField('', '照片')}
    <div class="field"><label for="f-notes">备注</label><textarea id="f-notes" rows="2" maxlength="500" placeholder="比如：早上空腹、练腿第二天">${esc(p?.note || '')}</textarea></div>
    <p class="hint" style="margin:0">${last ? `上一组是 ${esc(mdw(last.date))}。` : ''}Claude 处理时会和上一组对比，在「数据 → 身材照」里并排看。照片只存在你的服务器上，Claude 看的时候会发给 Anthropic。</p>
  `, footer('save-progress', !!p));
  drawSlots();
  formReady('save-progress', date);
}
function drawSlots() {
  const sh = S.sheet, g = $('#pp-grid', sheetEl); if (!g || sh?.type !== 'progress') return;
  g.innerHTML = PP_SLOTS.map(([k, l]) => {
    const p = sh.slots[k];
    const tile = p?.pending ? '<div class="ph pp-ph loading">处理中…</div>'
      : p ? `<div class="ph pp-ph"><button type="button" class="ph-v" data-act="pp-view" data-k="${k}" aria-label="看${l}大图"><img src="${esc(p.url)}" alt="${l}"></button><button type="button" class="x" data-act="pp-del" data-k="${k}" aria-label="去掉${l}照片"><span>×</span></button></div>`
      : `<label class="ph-add pp-ph pp-add">${CAM_SVG}<span>添加</span><input type="file" accept="image/*" class="vh" data-pp="${k}" aria-label="添加${l}照片"></label>`;
    return `<div class="pp">${tile}<span class="pp-l">${l}</span></div>`;
  }).join('');
}
async function onSlotFile(input) {
  const f = input.files?.[0], k = input.dataset.pp, sh = S.sheet; input.value = '';
  if (!f || sh?.type !== 'progress' || !(k in sh.slots)) return;
  const old = sh.slots[k];
  sh.slots[k] = { pending: true }; drawSlots();
  try {
    let blob;
    try { blob = await compress(f); } catch (e) { if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) blob = f; else throw e; }
    if (S.sheet !== sh) return;
    if (old?.orig) sh.removed.push(old.id); else if (old?.local) URL.revokeObjectURL(old.url);
    sh.slots[k] = { blob, local: true, url: URL.createObjectURL(blob) };
  } catch (e) {
    if (S.sheet === sh) sh.slots[k] = old;
    toast('这张照片读不出来，换一张或截图后再试', true);
  }
  if (S.sheet === sh) { drawSlots(); sheetChanged(); }
}
async function saveProgress(sh, signal) {
  if (!S.db) return;
  const before = sh.existing, slots = sh.slots;
  if (PP_SLOTS.some(([k]) => slots[k]?.pending)) throw { code: 'pending' };
  if (!PP_SLOTS.some(([k]) => slots[k])) throw badInput('至少拍一张，正面最要紧');
  const note = fval('f-notes').slice(0, 500);
  const oldPh = before?.photos && typeof before.photos === 'object' ? before.photos : {};
  const samePh = PP_SLOTS.every(([k]) => (slots[k] ? slots[k].orig ? slots[k].id : 'new' : null) === (oldPh[k] || null));
  if (before && samePh && note === (before.note || '')) { await saved(sh); return; }
  const todo = PP_SLOTS.filter(([k]) => slots[k] && !slots[k].id).length; let n = 0;
  const photos = {};
  for (const [k] of PP_SLOTS) {
    const p = slots[k]; if (!p) continue;
    if (!p.id) { n++; setBusy(`上传照片 ${n}/${todo}…`); const r = await retry1(() => S.assets.upload(p.blob, { signal })); p.id = r.id; sh.uploaded.push(r.id); }
    photos[k] = p.id;
  }
  setBusy('保存中…');
  const now = nowIso();
  const fields = { date: sh.id, photos, note, updatedAt: now, ...(before ? {} : { createdAt: now }), ...(samePh ? {} : { needsReview: true }) };
  await saveFields('progress', sh.id, before, fields, signal);
  await saved(sh, samePh ? '已保存' : '身材照存好了，Claude 下次处理时会和上一组对比');
}
// A photo, big (stats.js uses it for the 身材照 card): the lightbox, over whatever is open.
function openPhoto(id) { if (PHOTO_ID.test(String(id || ''))) openLightbox(blobSrc(id)); }

/* ---------- sleep ---------- */
// The night that ended on date d. Saving writes sleep/<d> as a manual night (Apple Health won't overwrite it) and
// body.sleep (hours) with sleepSource manual. 清除: a manual night marked cleared. 恢复自动: both go, the next sync refills.
const SLEEP_STAGES = [['deep', '深睡'], ['core', '核心'], ['rem', 'REM'], ['awake', '清醒']];
function openSleep(d = S.date) {
  if (!isDate(d)) return;
  const sl = S.sleep[d], b = S.body[d];
  const night = sl && !sl.cleared ? sl : null;
  const src = !sl ? (isNum(b?.sleep) ? '只有睡眠时长' : '还没有这晚的数据') : sl.cleared ? '这晚的数据清除了' : { 'apple-health': 'Apple 健康同步', screenshot: '从截图读的', manual: '自己改的' }[sl.source] || '';
  const asleep = isNum(night?.asleep) ? Math.round(night.asleep) : !sl && isNum(b?.sleep) ? Math.round(b.sleep * 60) : null;
  const manual = sl?.source === 'manual' || b?.sleepSource === 'manual';
  S.sheet = { type: 'sleep', id: d, existing: clone(sl), photos: [], removed: [] };
  showSheet(`睡眠 · ${mdw(d)}`, `
    <p class="meta" style="margin:0">${esc(mdw(d))}早上醒来的这一晚 · ${esc(src)}</p>
    <div class="row2"><div class="field"><label for="s-bed">入睡</label><input type="time" id="s-bed" value="${esc(night?.bedtime || '')}"></div><div class="field"><label for="s-wake">醒来</label><input type="time" id="s-wake" value="${esc(night?.wake || '')}"></div></div>
    <div class="field"><span class="lbl">睡着多久</span><div class="hm-in"><label class="mini"><span>小时</span>${numIn('s-ah', asleep != null ? Math.floor(asleep / 60) : '', { int: true })}</label><label class="mini"><span>分钟</span>${numIn('s-am', asleep != null ? asleep % 60 : '', { int: true })}</label></div><p class="hint" style="margin:0">不填就按入睡到醒来算（减去清醒）。</p></div>
    <div class="field"><span class="lbl">分期（分钟，可不填）</span><div class="mac4">${SLEEP_STAGES.map(([k, l]) => `<label class="mini"><span>${l}</span>${numIn('s-' + k, isNum(night?.[k]) ? Math.round(night[k]) : '', { int: true })}</label>`).join('')}</div></div>
    ${sl && !sl.cleared || manual ? `<div class="acct-actions">${sl && !sl.cleared ? '<button type="button" class="btn ghost sm danger" data-act="sleep-clear">这晚数据不对，清除</button>' : ''}${manual ? '<button type="button" class="btn ghost sm" data-act="sleep-auto">恢复自动</button>' : ''}</div>` : ''}
    <p class="hint" style="margin:0">改过或清除的这一晚，Apple 健康同步不会再覆盖；点「恢复自动」，下次同步重新填。</p>`, footer('save-sleep', false));
  formReady('save-sleep');
}
const hmMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
async function saveSleep(sh, signal) {
  if (!S.db) return;
  const d = sh.id, bed = fval('s-bed'), wake = fval('s-wake');
  const ah = readNum('s-ah', '小时', { int: true, min: 0, max: 16 }), am = readNum('s-am', '分钟', { int: true, min: 0, max: 59 });
  const st = {};
  for (const [k, l] of SLEEP_STAGES) { const v = readNum('s-' + k, l, { int: true, min: 0, max: 900 }); if (v != null) st[k] = v; }
  const b0 = hmMin(bed), w0 = hmMin(wake);
  const inBed = b0 != null && w0 != null ? ((w0 - b0 + 1440) % 1440) || null : null;
  let asleep = ah != null || am != null ? (ah || 0) * 60 + (am || 0) : null;
  if (asleep == null && inBed) asleep = Math.max(0, inBed - (st.awake || 0));
  if (!asleep) throw badInput('填一下睡着多久，或者入睡和醒来的时间', 's-ah');
  if (asleep > 16 * 60) throw badInput('睡着的时间超过 16 小时了，检查一下', 's-ah');
  const now = nowIso();
  const doc = { source: 'manual', date: d, ...(bed ? { bedtime: bed } : {}), ...(wake ? { wake } : {}), asleep, ...(inBed ? { inBed } : {}), ...st, editedAt: now };
  setBusy('保存中…');
  await putDoc('sleep', d, doc, signal);
  await saveFields('body', d, S.body[d] || null, { date: d, sleep: Math.round(asleep / 6) / 10, sleepSource: 'manual', updatedAt: now }, signal);
  await saved(sh, '睡眠已保存，同步不会再覆盖这一晚');
}
async function sleepAction(kind, btn) {
  const sh = S.sheet; if (sh?.type !== 'sleep' || sh.busy || !S.db) return;
  if (kind === 'clear' && !confirmTap(btn, '确认清除这一晚', '这晚数据不对，清除')) return;
  const d = sh.id, now = nowIso();
  sh.busy = true;
  try {
    if (kind === 'clear') {
      await putDoc('sleep', d, { source: 'manual', date: d, cleared: true, editedAt: now });
      await saveFields('body', d, S.body[d] || null, { date: d, sleep: null, sleepSource: 'manual', updatedAt: now });
    } else {
      try { await retry1(() => S.db.collection('sleep').doc(d).delete()); } catch (e) { if (e?.code !== 'not_found') throw e; }
      const b = S.db.cached('body', d);
      if (!b || b.exists) await patchDoc('body', d, () => ({ sleep: { __delete__: true }, sleepSource: { __delete__: true }, updatedAt: now })).catch(e => { if (e?.code !== 'not_found') throw e; });
    }
    sh.saved = true; closeSheet(true);
    toast(kind === 'clear' ? '这一晚的睡眠清除了' : '已恢复自动，下次同步会重新填');
  } catch (e) { sh.busy = false; toast(errMsg(e), true); }
}
// Write a whole document (replacing what is there) on its latest version; re-read and retry on a conflict.
async function putDoc(col, id, doc, signal) {
  const ref = S.db.collection(col).doc(id);
  let cur = S.db.cached(col, id) || await retry1(() => ref.get({ signal }));
  for (let i = 0; ; i++) {
    try { return await retry1(() => ref.set(doc, { ifVersion: cur.version, signal })); }
    catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await retry1(() => ref.get({ signal })); }
  }
}

/* ---------- health ---------- */
// The day's Apple Health numbers; a metric marked 「这天不算」 (health.ignore) is left out of the activity bonus and the
// recovery check, and out of the charts.
function openHealth(d = S.date) {
  const h = S.health[d]; if (!h) return;
  S.sheet = { type: 'health', id: d, photos: [], removed: [] };
  showSheet(`健康数据 · ${mdw(d)}`, `
    <div class="panel hl-list">${HMETRICS.map(([k, l, u, nk]) => `<div class="hl-i"><span class="hl-k">${l}${nk && isNum(h.n?.[nk]) ? `<small>${esc(h.n[nk])} 个样本取平均</small>` : k === 'steps' || k === 'activeKcal' ? '<small>一天的总数</small>' : ''}</span>
      <b class="num">${isNum(h[k]) ? fmt(h[k]) : '—'}<small>${u}</small></b>
      ${isNum(h[k]) ? `<label class="hl-ig"><input type="checkbox" class="sw" id="h-ig-${k}"${hIgnored(h, k) ? ' checked' : ''}><span>这天不算</span></label>` : '<span></span>'}</div>`).join('')}</div>
    <p class="hint" style="margin:0">不算的不参与活动加餐和恢复判断，图表里也不画。比如手表没戴好、忘了停止体能训练。${h.syncedAt ? `同步于 ${esc(fmtTs(h.syncedAt))}。` : ''}</p>`, footer('save-health', false));
  formReady('save-health');
}
async function saveHealth(sh, signal) {
  if (!S.db) return;
  const ig = HMETRICS.map(([k]) => k).filter(k => checked('h-ig-' + k));
  setBusy('保存中…');
  await patchDoc('health', sh.id, () => ({ ignore: ig.length ? ig : { __delete__: true } }), signal);
  await saved(sh, ig.length ? `这天的${ig.map(k => HMETRICS.find(x => x[0] === k)[1]).join('、')}不算了` : '已保存');
}

/* ---------- profile ---------- */
// Changing these is a reason to redo the plan: 「让 Claude 按新资料重新做计划」 starts ticked when one of them changed.
const REPLAN = ['sex', 'age', 'height', 'weight', 'goal', 'days', 'minutes', 'place', 'level', 'injuries'];
// o.onSaved: called once the form is saved (the 新人引导 goes on to its next step). A first profile, and the one filled in
// from the guide, start with 「让 Claude 按资料做计划」 ticked.
function openProfile(o = {}) {
  const p = S.profile || {}, first = !S.profile || !!o.onboard;
  S.sheet = { type: 'profile', col: 'profile', id: 'main', isNew: !S.profile, existing: clone(S.profile), photos: [], removed: [], reopen: () => openProfile(o),
    onSaved: typeof o.onSaved === 'function' ? o.onSaved : null, replanTouched: first };
  showSheet('基础信息', `
    <div class="row2"><div class="field"><span class="lbl">性别</span>${seg('sex', [['male', '男'], ['female', '女']], p.sex)}</div><div class="field"><label for="f-age">年龄</label>${numIn('f-age', p.age, { int: true })}</div></div>
    <div class="row3"><div class="field"><label for="f-h">身高 cm</label>${numIn('f-h', p.height)}</div><div class="field"><label for="f-w">体重 kg</label>${numIn('f-w', p.weight)}</div><div class="field"><label for="f-tw">目标体重 kg</label>${numIn('f-tw', p.targetWeight, { ph: '可不填' })}</div></div>
    <div class="field"><span class="lbl">主要目标</span>${seg('goal', GOALS, p.goal, 'g3')}
      <p class="hint" style="margin:0">薄肌：体脂低、有线条、不追求大块。热量基本持平或略少，蛋白质吃足，力量加有氧。</p></div>
    <div class="field"><span class="lbl">每周能练几天</span>${seg('days', [1, 2, 3, 4, 5, 6, 7].map(n => [String(n), String(n)]), p.days, 'num-seg')}</div>
    <div class="field"><label for="f-min">每次多长时间（分钟）</label>${numIn('f-min', p.minutes, { int: true, ph: '例如 60' })}</div>
    <div class="field"><span class="lbl">在哪练</span>${seg('place', PLACES, p.place)}</div>
    <div class="field"><span class="lbl">训练经验</span>${seg('level', LEVELS, p.level)}</div>
    <div class="field"><label for="f-diet">饮食习惯与忌口</label><textarea id="f-diet" rows="3" placeholder="例：工作日午饭吃食堂，晚饭常点外卖；不吃羊肉；乳糖不耐">${esc(p.diet || '')}</textarea></div>
    <div class="field"><label for="f-inj">伤病与限制</label><textarea id="f-inj" rows="2" placeholder="例：右膝半月板旧伤，深蹲到平行会痛">${esc(p.injuries || '')}</textarea></div>
    <div class="field"><label for="f-notes">其他想让 Claude 知道的</label><textarea id="f-notes" rows="2" placeholder="例：想在 3 个月内腰围减 5cm；周三晚上固定加班">${esc(p.notes || '')}</textarea></div>
    ${first ? tgl('f-replan', '让 Claude 按资料做计划', '下次处理时做第一份训练和饮食计划', true) : tgl('f-replan', '让 Claude 按新资料重新做计划', '不勾的话只更新资料，计划不动', false)}
  `, footer('save-profile', false));
  formReady('save-profile', 'main');
  profileReplan();
}
// What the form says now. strict: out-of-range numbers throw (on save); otherwise they are just read.
function profileForm(strict) {
  const num = (id, label, o) => { if (strict) return readNum(id, label, o); const v = parseNum(fval(id), o.int); return Number.isNaN(v) ? fval(id) : v; };
  const n = v => (v == null ? null : Number(v));
  return {
    sex: segVal('sex'), age: num('f-age', '年龄', { int: true, min: 10, max: 100 }), height: num('f-h', '身高', { min: 100, max: 250 }), weight: num('f-w', '体重', { min: 20, max: 400 }),
    targetWeight: num('f-tw', '目标体重', { min: 30, max: 300 }),
    goal: segVal('goal'), days: n(segVal('days')), minutes: num('f-min', '每次时长', { int: true, min: 10, max: 300 }), place: segVal('place'), level: segVal('level'),
    diet: fval('f-diet'), injuries: fval('f-inj'), notes: fval('f-notes'),
  };
}
// Until the person touches the checkbox, it follows whether a plan-relevant field changed.
function profileReplan() {
  const sh = S.sheet, el = $('#f-replan', sheetEl); if (sh?.type !== 'profile' || !el || sh.replanTouched) return;
  const f = profileForm(false), was = sh.existing || {};
  el.checked = REPLAN.some(k => !same(f[k], was[k]));
}
async function saveProfile(sh, signal) {
  if (!S.db) return;
  const fields = profileForm(true);
  const replan = checked('f-replan');
  if (!changedFields(fields, sh.existing).length && !(replan && !sh.existing?.needsReview)) { await saved(sh); return; }
  setBusy('保存中…');
  await saveFields('profile', 'main', sh.existing, { ...fields, ...(replan ? { needsReview: true } : {}), updatedAt: nowIso() }, signal);
  await saved(sh, replan ? '已保存，Claude 下次处理时会据此调整计划' : '资料已更新，计划不动');
}

/* ---------- water sheet ---------- */
// Every entry of the day (tap one to change or delete it), and a new one with its own time. Changes go through the
// same queue as the card's buttons, so they show at once and survive a lost connection.
function openWater(d = S.date) {
  S.sheet = { type: 'water', id: d, edit: null, photos: [], removed: [], saveAct: 'save-water' };
  showSheet(`喝水 · ${mdw(d)}`, `
    <div id="w-list"></div>
    <fieldset><legend>再记一笔</legend>
    <div class="field"><span class="lbl">喝的是</span>${seg('kind', DRINKS, 'water')}</div>
    <div class="field"><span class="lbl">多少 ml</span>${seg('ml', [100, 150, 200, 250, 350, 500].map(n => [String(n), String(n)]), null, 'num-seg')}</div>
    <div class="row2"><div class="field"><label for="f-ml">或者直接输入 ml</label>${numIn('f-ml', '', { int: true, ph: '例如 330' })}</div><div class="field"><label for="f-wt">时间</label><input type="time" id="f-wt" value="${d === today() ? nowHM() : ''}"></div></div>
    </fieldset>
    <p class="hint" style="margin:0">牛奶按全脂、豆浆按无糖估算热量和蛋白质，自动算进摄入。奶茶、果汁、含糖饮料请记到「饮食」里，Claude 会估算。</p>`,
    '<button type="button" class="btn ghost main" data-act="save-water" id="save-btn">关闭</button>');
  drawWaterList();
}
// The sheet's main button: 关闭 until an amount is picked or typed, then 「记下 250 ml」 (#44).
function waterAmount() {
  const typed = parseNum(fval('f-ml'), true);
  return Number.isNaN(typed) ? NaN : Math.round(typed || Number(segVal('ml')) || 0);
}
function updateWaterBtn() {
  const b = $('#save-btn', sheetEl); if (!b || S.sheet?.type !== 'water') return;
  const ml = waterAmount(), on = Number.isNaN(ml) || ml > 0;
  b.textContent = Number.isNaN(ml) ? '记下' : ml > 0 ? `记下 ${ml} ml` : '关闭';
  b.classList.toggle('primary', on); b.classList.toggle('ghost', !on);
}
function drawWaterList() {
  const sh = S.sheet, el = $('#w-list', sheetEl); if (!el || sh?.type !== 'water') return;
  const es = waterDay(sh.id).entries || [];  // listed by time (补记 last); data-i is the index in the stored list
  if (sh.edit != null && !es[sh.edit]) sh.edit = null;
  el.innerHTML = `<div class="sub-h">${esc(mdw(sh.id))}喝了 <span class="num">${fmt(waterSum(es))}</span> ml${es.length ? `，${es.length} 笔` : ''}</div>`
    + (es.length ? `<div class="panel wl">${waterSorted(es).map(({ e, i }) => sh.edit === i ? `<div class="wl-e" data-i="${i}">
        <div class="row2"><div class="field"><label for="we-ml">ml</label>${numIn('we-ml', e.ml, { int: true })}</div><div class="field"><label for="we-t">时间</label><input type="time" id="we-t" value="${esc(e.t || '')}"></div></div>
        ${seg('ekind', DRINKS, e.kind || 'water', 'req')}
        <div class="fix-b"><button type="button" class="link danger" data-act="we-del">删掉这笔</button><button type="button" class="btn ghost sm" data-act="we-cancel">取消</button><button type="button" class="btn primary sm" data-act="we-save">保存</button></div></div>`
      : `<button type="button" class="wl-i" data-act="we-open" data-i="${i}"><span class="num">${esc(e.t || '补记')}</span><span>${esc(DRINK_TXT[e.kind || 'water'] || '其他')}</span><b class="num">${fmt(e.ml)}<small>ml</small></b></button>`).join('')}</div><p class="hint" style="margin:0">点一笔可以改或删掉。</p>`
      : '<p class="hint" style="margin:0">这天还没记。</p>');
}
function saveWater() {
  const sh = S.sheet; if (sh?.type !== 'water') return;
  const ml = waterAmount();
  if (Number.isNaN(ml)) { toast('ml 填的不是整数', true); return; }
  if (!ml) { closeSheet(); return; }
  if (ml < 1 || ml > 3000) { toast('填一个 1 到 3000 之间的数', true); return; }
  const kind = segVal('kind') || 'water';
  addWater(ml, kind, sh.id, fval('f-wt') || null);
  const f = $('#f-ml', sheetEl); if (f) f.value = '';
  sheetEl.querySelectorAll('[data-group="ml"] button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  updateWaterBtn();
  toast(vt('toast.water', '记下 {ml} ml', { ml, seed: Date.now() }) + (kind !== 'water' ? ' ' + (DRINK_TXT[kind] || '') : ''));
}
// Change or delete the entry being edited (sh.edit is its index in the day's list).
function waterEdit(del) {
  const sh = S.sheet; if (sh?.type !== 'water' || sh.edit == null) return;
  const e = (waterDay(sh.id).entries || [])[sh.edit]; if (!e) return;
  const r = waterRef(e);
  if (del) {
    queueWater(sh.id, r.id ? { undo: r.id } : { undo: true, fp: r.fp });
    sh.edit = null; drawWaterList();
    const back = { ...e, id: e.id || newId('h') };
    toast(`删掉了 ${e.ml} ml`, false, () => queueWater(sh.id, { add: back }));
    return;
  }
  const ml = parseNum(fval('we-ml'), true);
  if (!(ml >= 1 && ml <= 3000)) { toast('填一个 1 到 3000 之间的数', true); $('#we-ml', sheetEl)?.focus(); return; }
  queueWater(sh.id, { edit: r.id || null, fp: r.fp, nid: r.id ? undefined : newId('h'), set: { ml, kind: segVal('ekind') || 'water', t: fval('we-t') || null } });
  sh.edit = null; drawWaterList(); toast('已改好');
}

/* ---------- preferences sheet ---------- */
function openPrefs() {
  const def = Number.isInteger(S.me?.config?.dayStartDefault) ? S.me.config.dayStartDefault : prefDayStart() == null ? serverDayStart() : null;
  const rt = restPref(), wp = waterPresets(), noPush = !S.push.sub && !(S.push.subs > 0);
  S.sheet = { type: 'prefs', col: 'profile', id: 'prefs', existing: clone(S.prefs), photos: [], removed: [] };
  showSheet('偏好设置', `
    <div class="field"><label for="p-ds">一天从几点算起</label><select id="p-ds">${Array.from({ length: 13 }, (_, h) => `<option value="${h}"${h === dayStart ? ' selected' : ''}>${h === 0 ? '0 点（午夜）' : `早上 ${h} 点`}${h === def ? '（默认）' : ''}</option>`).join('')}</select>
      <p class="hint" style="margin:0">这个点之前记的算前一天，睡得晚的人设 4–6 点。改了只影响以后记的。</p></div>
    <div class="field"><span class="lbl">训练记在哪</span>${seg('trainin', [['app', '只在这里记<small>逐组打勾</small>'], ['both', '两个都用<small>这里为主</small>'], ['xunji', '只用训记<small>练完同步</small>']], trainIn(), 'req g3')}
      <p class="hint" style="margin:0">只在这里记时，训记的同步和模版都收起来，以前导入的训练照常显示。</p></div>
    <div class="field"><span class="lbl">外观</span>${seg('theme', THEMES, prefTheme(), 'req')}</div>
    <div class="field"><span class="lbl">页面风格</span>${seg('style', [['abstract', '抽象<small>花哨、整活</small>'], ['clean', '正经<small>简洁、安静</small>']], prefStyle(), 'req')}</div>
    <div class="field"><span class="lbl">显示</span><div class="tgls">
      ${tgl('p-adv', '进阶显示', 'RPE、热身组和递减组、训练量、静息心率和 HRV；关掉时只是不显示，记录照旧', advOn())}</div></div>
    <div class="field"><span class="lbl">今日页的提示</span><div class="tgls">
      ${tgl('p-feel', '晨间状态', '起床后 6 小时内，在「身体」里问一下精力、酸痛和压力', prefOn('feelCard'))}
      ${tgl('p-weigh', '称体重提示', '今天还没称时，「身体」里先让你填体重', prefOn('weighCard'))}
      ${tgl('p-stale', '健康数据过时提示', '超过 12 小时没同步时，提醒运行快捷指令', prefOn('staleHealth'))}
      ${tgl('p-habits', '五件套', '大水、大睡、大蛋、大站、薄肌，按你记的数据自动算', prefOn('habits'))}</div></div>
    <div class="field"><span class="lbl">Claude 发的通知</span><div class="tgls${noPush ? ' off' : ''}">
      ${PUSH_KINDS.map(([k, l, sub]) => tgl('p-push-' + k, l, sub, pushOn(k))).join('')}</div>
      ${noPush ? '<p class="hint" style="margin:0">还没有设备开通知：先在「我的 → 通知」里开启，这几项才有用。</p>' : ''}</div>
    <div class="field"><span class="lbl">「同步健康」通知里的提醒</span><div class="tgls">
      ${tgl('p-n-plan', '训练', '今天练哪天、还差几练', notifyOn('plan'))}
      ${tgl('p-n-weigh', '称重', '今天还没称体重', notifyOn('weigh'))}
      ${tgl('p-n-water', '喝水', '离喝水目标还差多少', notifyOn('water'))}</div></div>
    <div class="field"><span class="lbl">喝水按钮（ml）</span><div class="wp-in">${[0, 1, 2, 3, 4, 5].map(i => numIn('p-wp' + i, wp[i], { int: true })).join('')}</div>
      <p class="hint" style="margin:0">今日页喝水卡片上的按钮，最多 6 个，空着的不显示。</p></div>
    <div class="field"><span class="lbl">组间休息计时</span><div class="tgls">${tgl('p-rt', '打勾后自动开始计时', '记训练时也可以临时关掉', rt.on)}</div>
      <div class="row2"><div class="field"><label for="p-rts">默认秒数</label>${numIn('p-rts', rt.sec, { int: true })}</div></div>
      <p class="hint" style="margin:0">动作没写休息时间时用这个，15–600 秒。</p></div>`, footer('save-prefs', false));
  if (noPush) sheetEl.querySelectorAll('[id^="p-push-"]').forEach(el => { el.disabled = true; });
  formReady('save-prefs');
}
async function savePrefs(sh, signal) {
  if (!S.db) return;
  const ds = parseInt(fval('p-ds'), 10);
  const wp = [];
  for (let i = 0; i < 6; i++) { const v = readNum('p-wp' + i, '喝水按钮', { int: true, min: 10, max: 3000 }); if (v != null) wp.push(v); }
  const sec = readNum('p-rts', '默认秒数', { int: true, min: 15, max: 600 });
  const fields = {
    theme: segVal('theme') || 'auto', style: segVal('style') || 'abstract', feelCard: checked('p-feel'),
    weighCard: checked('p-weigh'), staleHealth: checked('p-stale'), habits: checked('p-habits'),
    notify: { plan: checked('p-n-plan'), weigh: checked('p-n-weigh'), water: checked('p-n-water') },
    waterPresets: wp.length ? wp : undefined, restTimer: { on: checked('p-rt'), sec: sec ?? 90 },
  };
  // 进阶显示: stored once it was set, or when it differs from what the training level gives
  const adv = checked('p-adv');
  if (typeof prefs().advanced === 'boolean' || adv !== advOn()) fields.advanced = adv;
  // 训练记在哪: stored once it was picked, or when it differs from what it is without a pick
  const ti = segVal('trainin');
  if (TRAIN_IN.some(([v]) => v === ti) && (prefs().trainIn || ti !== autoTrainIn())) fields.trainIn = ti;
  // push kinds: only once one is off or they were stored before (all on is the default)
  const push = Object.fromEntries(PUSH_KINDS.map(([k]) => [k, checked('p-push-' + k)]));
  if (prefs().push || Object.values(push).some(v => !v)) fields.push = push;
  // stored once it was picked, or when it differs from where the day starts now
  if (Number.isInteger(ds) && (prefDayStart() != null || ds !== dayStart)) fields.dayStartHour = ds;
  const moved = Number.isInteger(ds) && ds !== dayStart;
  setBusy('保存中…');
  await saveFields('profile', 'prefs', sh.existing, { ...fields, updatedAt: nowIso() }, signal);
  sh.saved = true;
  applyStyle(fields.style); applyTheme(fields.theme);
  await saved(sh, moved ? `已保存，一天从 ${ds} 点算起` : '已保存');
  if (moved) refreshMe();
}

/* ---------- plan editing ---------- */
const getPath = (o, path) => path.split('.').reduce((x, k) => x && typeof x === 'object' ? x[k] : undefined, o);
function setPath(o, path, v) {
  const ks = path.split('.'), last = ks.pop(); let x = o;
  for (const k of ks) { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; }
  if (v == null) delete x[last]; else x[last] = v;
}
// A change the person made: plan.custom[path] = {at, was}. was is Claude's value from before the first change and is
// kept on later edits; setting the value back to it drops the entry.
function noteCustom(plan, path, old, v) {
  const c = plan.custom && typeof plan.custom === 'object' && !Array.isArray(plan.custom) ? plan.custom : (plan.custom = {});
  const e = c[path];
  if (e && typeof e === 'object' && 'was' in e) { if (eqv(v, e.was)) delete c[path]; else e.at = nowIso(); }
  else c[path] = { at: nowIso(), was: clone(old) ?? null };
  if (!Object.keys(c).length) delete plan.custom;
}
function setPlanVal(plan, path, v) {
  const old = getPath(plan, path);
  if (eqv(old, v)) return;
  setPath(plan, path, clone(v));
  noteCustom(plan, path, old, v);
}
// The page's edits to plan/current: fn changes the latest copy (return false: nothing to write). Written whole on its
// version and re-applied on a conflict. updatedAt moves; version and plan_history are Claude's.
async function editPlan(fn, signal) {
  const ref = S.db.collection('plan').doc('current');
  let cur = S.db.cached('plan', 'current') || await retry1(() => ref.get({ signal }));
  for (let i = 0; ; i++) {
    if (!cur.exists) throw { code: 'not_found', message: '还没有计划' };
    const doc = clone(cur.data);
    if (fn(doc) === false) return null;
    doc.updatedAt = nowIso();
    try { await retry1(() => ref.set(doc, { ifVersion: cur.version, signal })); return doc; }
    catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await retry1(() => ref.get({ signal })); }
  }
}
// 恢复建议值: Claude's value goes back and the entry goes away.
async function restoreCustom(path, btn) {
  if (!S.db || btn.disabled) return;
  btn.disabled = true;
  try {
    await editPlan(plan => {
      const e = plan.custom?.[path]; if (!e) return false;
      const was = clone(e.was), m = /^training\.days\.(.+)$/.exec(path);
      if (m) {
        const tr = plan.training && typeof plan.training === 'object' ? plan.training : (plan.training = {});
        const days = Array.isArray(tr.days) ? tr.days : (tr.days = []);
        const i = days.findIndex(x => x?.id === m[1]);
        if (was == null) { if (i >= 0) days.splice(i, 1); }
        else if (i >= 0) days[i] = was;
        else { const j = days.findIndex(x => String(x?.id) > m[1]); days.splice(j < 0 ? days.length : j, 0, was); }
      } else setPath(plan, path, was);
      delete plan.custom[path]; if (!Object.keys(plan.custom).length) delete plan.custom;
    });
    toast('已恢复 Claude 的建议值');
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
}

// 饮食目标: training-day kcal and macros, an optional rest-day set, the water target.
const DIET_RANGE = { kcal: { min: 800, max: 6000 }, protein: { min: 20, max: 400 }, carbs: { min: 0, max: 1000 }, fat: { min: 10, max: 400 } };
function openDiet() {
  const p = S.plan; if (!p) return;
  const own = p.diet && typeof p.diet === 'object' ? p.diet : {}, tt = isNum(own.kcal) ? null : profileTargets();
  // no targets yet (a plan built from a template): every box starts at the 临时目标 (#M1); a field missing from a plan
  // that has its kcal: the basics' value for it
  const pt = isNum(own.kcal) && MKEYS.some(k => !isNum(own[k])) ? profileTargets() : null;
  const diet = tt ? { ...own, kcal: tt.kcal, protein: tt.protein, carbs: tt.carbs, fat: tt.fat, water: isNum(own.water) ? own.water : tt.water }
    : pt ? { ...own, protein: own.protein ?? pt.protein, fat: own.fat ?? pt.fat, carbs: own.carbs ?? Math.max(0, Math.round((own.kcal - 4 * (own.protein ?? pt.protein) - 9 * (own.fat ?? pt.fat)) / 4)) } : own;
  const rd = diet.restDay && typeof diet.restDay === 'object' ? diet.restDay : null;
  const four = (pre, src) => `<div class="mac4">${MACROS.map(([k, l, u]) => `<label class="mini"><span>${l} ${u}</span>${numIn(`${pre}-${k}`, isNum(src[k]) ? Math.round(src[k]) : '', { int: true })}</label>`).join('')}</div>`;
  S.sheet = { type: 'diet', photos: [], removed: [] };
  showSheet('饮食目标', `
    <fieldset><legend>训练日</legend>${four('dt', diet)}<p class="hint" style="margin:0" id="dt-gkg"></p></fieldset>
    <fieldset><legend>休息日</legend>${tgl('dr-on', '休息日用另一套', '关掉就和训练日一样', !!rd)}<div id="dr-box" class="fs-in"${rd ? '' : ' hidden'}>${four('dr', { ...diet, ...(rd || {}) })}<p class="hint" style="margin:0" id="dr-gkg"></p></div></fieldset>
    <div class="field"><label for="d-water">每天喝水 ml</label>${numIn('d-water', diet.water, { int: true, ph: `不填按体重估，约 ${fmt(estWater())}` })}</div>
    ${tt ? '<p class="hint" style="margin:0">先填的是临时目标（按你的基础信息估的），改哪个数保存哪个。</p>' : ''}
    <p class="hint" style="margin:0">改热量会按蛋白质和脂肪重算碳水；改蛋白质、碳水或脂肪会重算热量（蛋白质、碳水每克 4 kcal，脂肪 9 kcal）。活动多的日子页面还会自动加一点。</p>
    ${customRows(['diet.kcal', 'diet.protein', 'diet.carbs', 'diet.fat', 'diet.restDay', 'diet.water'])}`, footer('save-diet', false));
  dietHints(); formReady('save-diet');
}
const estWater = () => { const w = latestWeight() ?? S.profile?.weight; return isNum(w) ? Math.min(3500, Math.max(1500, Math.round(w * 35 / 100) * 100)) : 2000; };
function dietHints() {
  const w = latestWeight() ?? S.profile?.weight;
  for (const pre of ['dt', 'dr']) {
    const el = $(`#${pre}-gkg`, sheetEl), p = parseNum(fval(`${pre}-protein`));
    if (el) el.textContent = isNum(w) && isNum(p) ? `蛋白质每公斤体重 ${(p / w).toFixed(1)} g（按 ${w} kg）` : '';
  }
}
// kcal typed: carbs = (kcal − 4P − 9F) / 4; a macro typed: kcal = 4P + 4C + 9F.
function dietInput(el) {
  const m = /^(dt|dr)-(kcal|protein|carbs|fat)$/.exec(el.id); if (!m) return;
  const pre = m[1], v = k => parseNum(fval(`${pre}-${k}`));
  const put = (k, x) => { const e = $(`#${pre}-${k}`, sheetEl); if (e && Number.isFinite(x)) { e.value = String(Math.max(0, Math.round(x))); e.removeAttribute('aria-invalid'); } };
  const P = v('protein'), C = v('carbs'), F = v('fat'), K = v('kcal');
  if (m[2] === 'kcal') { if (isNum(K) && isNum(P) && isNum(F)) put('carbs', (K - 4 * P - 9 * F) / 4); }
  else if (isNum(P) && isNum(C) && isNum(F)) put('kcal', 4 * P + 4 * C + 9 * F);
  dietHints();
}
async function saveDiet(sh, signal) {
  if (!S.db) return;
  const read = (pre, label) => { const o = {}; for (const [k, l] of MACROS) o[k] = readNum(`${pre}-${k}`, `${label}${l}`, { int: true, ...DIET_RANGE[k] }); return o; };
  const t = read('dt', '训练日');
  if (t.kcal == null) throw badInput('训练日热量不能空着', 'dt-kcal');
  // the four always saved together: protein and fat left empty keep what they were (else the 临时目标), carbs left empty
  // are what the kcal leaves (#M1)
  const fill = o => {
    const cur = S.plan?.diet || {}, pt = profileTargets();
    for (const k of ['protein', 'fat']) if (o[k] == null) o[k] = isNum(cur[k]) ? cur[k] : pt?.[k] ?? null;
    if (o.protein == null) throw badInput('填一下蛋白质', 'dt-protein');
    if (o.fat == null) throw badInput('填一下脂肪', 'dt-fat');
    if (o.carbs == null) o.carbs = Math.max(0, Math.round((o.kcal - 4 * o.protein - 9 * o.fat) / 4));
    return o;
  };
  fill(t);
  let rest = null;
  if (checked('dr-on')) {
    const r = read('dr', '休息日'); rest = {};
    for (const k of MKEYS) if (r[k] != null && r[k] !== t[k]) rest[k] = r[k];  // only what differs from a training day
    if (!Object.keys(rest).length) rest = null;
  }
  const water = readNum('d-water', '喝水目标', { int: true, min: 500, max: 6000 });
  setBusy('保存中…');
  await editPlan(plan => {
    const before = stable(plan.diet);
    for (const k of MKEYS) setPlanVal(plan, 'diet.' + k, t[k]);
    const oldRest = plan.diet?.restDay, keep = rest && oldRest && typeof oldRest === 'object' ? { ...oldRest, ...rest } : rest;
    if (keep) for (const k of MKEYS) if (!(k in rest)) delete keep[k];
    setPlanVal(plan, 'diet.restDay', keep);
    setPlanVal(plan, 'diet.water', water);
    if (stable(plan.diet) === before) return false;
  }, signal);
  await saved(sh, '饮食目标已保存');
}

// 快捷清单 (plan.diet.quick): what the person really buys, for one-tap logging.
function openQuickList() {
  const qs = quickChoices();
  S.sheet = { type: 'quick', photos: [], removed: [] };
  showSheet('快捷清单', `${qs.length ? `<div class="panel quick">${qs.map(({ q, i }) => `<div class="qk"><span class="qk-n">${esc(q.name)}<small>${esc(qkSub(q))}</small></span><button type="button" class="btn ghost sm" data-act="quick-pick" data-i="${i}">记一笔</button></div>`).join('')}</div>
      <p class="hint" style="margin:0">记一笔可以选日期、餐次和份数，数字直接算进摄入，不用等 Claude。</p>`
    : `<p class="hint" style="margin:0">${S.plan ? '清单还是空的。把常买的蛋白棒、酸奶、牛奶加进来，以后点一下就能记。' : '有了计划之后就能编辑清单。'}</p>`}`,
    `${S.plan ? '<button type="button" class="btn ghost" data-act="quick-edit">编辑清单</button>' : ''}<button type="button" class="btn primary main" data-act="close">关闭</button>`);
}
function openQuickLog(i) {
  const q = S.plan?.diet?.quick?.[i]; if (!q || typeof q.name !== 'string' || !q.name.trim()) return;
  const d = S.date, slot = guessSlot();
  S.sheet = { type: 'qlog', q: clone(q), id: newId('m'), photos: [], removed: [], saveAct: 'save-qlog' };
  showSheet(`记一笔 · ${q.name}`, `
    <p class="meta" style="margin:0" id="ql-sum"></p>
    <div class="row2"><div class="field"><label for="f-date">日期</label><input type="date" id="f-date" value="${esc(d)}"></div><div class="field"><label for="f-time">时间</label><input type="time" id="f-time" value="${d === today() ? nowHM() : SLOT_TIME[slot]}"></div></div>
    <div class="field"><span class="lbl">餐次</span>${seg('slot', SLOT_ORDER.map(k => [k, SLOTS[k]]), slot)}</div>
    <div class="field"><span class="lbl">份数</span>${seg('mult', [['0.5', '×0.5'], ['1', '×1'], ['1.5', '×1.5'], ['2', '×2']], '1', 'num-seg req')}</div>`,
    '<button type="button" class="btn primary main" data-act="save-qlog" id="save-btn">记下</button>');
  drawQlSum();
}
function drawQlSum() {
  const sh = S.sheet, el = $('#ql-sum', sheetEl); if (!el || sh?.type !== 'qlog') return;
  const it = quickItem(sh.q, Number(segVal('mult')) || 1);
  el.textContent = [isNum(it.kcal) ? `${fmt(it.kcal)} kcal` : '', isNum(it.protein) ? `蛋白质 ${numTxt(it.protein)} g` : '', isNum(it.carbs) ? `碳水 ${numTxt(it.carbs)} g` : '', isNum(it.fat) ? `脂肪 ${numTxt(it.fat)} g` : ''].filter(Boolean).join(' · ');
}
async function saveQuickLog(sh, signal) {
  if (!S.db) return;
  const date = isDate(fval('f-date')) ? fval('f-date') : S.date, slot = segVal('slot') || 'snack';
  const item = quickItem(sh.q, Number(segVal('mult')) || 1), now = nowIso();
  const doc = { date, slot, time: fval('f-time') || (date === today() ? nowHM() : SLOT_TIME[slot]), desc: item.name, quick: [item], photos: [], leftovers: [], needsReview: false, createdAt: now, updatedAt: now };
  const ref = S.db.collection('meals').doc(sh.id);
  setBusy('保存中…');
  try { await retry1(() => ref.set(doc, { ifVersion: 0, signal })); }
  catch (e) { if (e?.code !== 'conflict') throw e; S.db.sync(true); }  // an earlier try did get through
  sh.saved = true; closeSheet(true); S.date = date; render();
  toast(vt('toast.quick', '记下了：{name}', { name: item.name, seed: Date.now() }), false, async () => { try { await retry1(() => ref.delete()); toast('已撤销'); } catch (e) { toast(errMsg(e), true); } });
}
function openQuickEdit() {
  if (!S.plan) return;
  const items = (Array.isArray(S.plan.diet?.quick) ? S.plan.diet.quick : []).filter(q => q && typeof q === 'object').map(clone);
  S.sheet = { type: 'quick-edit', items, photos: [], removed: [] };
  showSheet('编辑快捷清单', `<div id="qe-list"></div><button type="button" class="btn ghost sm" data-act="qe-add" style="align-self:flex-start">+ 加一样</button>
    <p class="hint" style="margin:0">挑你真会买、拿起来就能吃的。标了「适合夜宵」的，晚上会排在前面。</p>${customRows(['diet.quick'])}`, footer('save-quick', false));
  drawQE(); formReady('save-quick');
}
function drawQE() {
  const el = $('#qe-list', sheetEl), sh = S.sheet; if (!el || sh?.type !== 'quick-edit') return;
  // the name gets the whole first row; ↑ ↓ × sit with 随时 / 适合夜宵 on the last (#25)
  el.innerHTML = sh.items.length ? sh.items.map((q, i) => `<div class="ex qe" data-i="${i}">
    <div class="qe-h"><span class="ex-n num">${i + 1}</span><input type="text" data-q="name" maxlength="20" autocomplete="off" value="${esc(q.name ?? '')}" placeholder="名字，例如 蛋白棒" aria-label="名字"></div>
    <div class="mac4">${MACROS.map(([k, l, u]) => `<label class="mini"><span>${l}${k === 'kcal' ? '' : ` ${u}`}</span><input type="text" inputmode="decimal" autocomplete="off" data-q="${k}" value="${esc(isNum(q[k]) ? q[k] : q[k] ?? '')}"></label>`).join('')}</div>
    <div class="qe-f"><div class="seg" role="group" aria-label="什么时候吃">${[['any', '随时'], ['late', '适合夜宵']].map(([v, l]) => `<button type="button" data-act="qe-when" data-v="${v}" aria-pressed="${(q.when === 'late' ? 'late' : 'any') === v}">${l}</button>`).join('')}</div>${mvBtns('qe', i, sh.items.length)}<button type="button" class="icon-btn del" data-act="qe-del" aria-label="删掉这一样">×</button></div>
  </div>`).join('') : '<p class="hint" style="margin:0">清单是空的，点下面「加一样」。</p>';
}
async function saveQuick(sh, signal) {
  if (!S.db) return;
  const out = [];
  sh.items.forEach((q, i) => {
    const name = String(q.name ?? '').trim().slice(0, 20), nums = {};
    for (const k of MKEYS) {
      const v = isNum(q[k]) ? q[k] : parseNum(q[k]);
      if (Number.isNaN(v) || (v != null && (v < 0 || v > (k === 'kcal' ? 3000 : 300)))) throw badInput(`第 ${i + 1} 样的${MACROS.find(x => x[0] === k)[1]}${Number.isNaN(v) ? '不是数字' : '超出范围了'}`);
      nums[k] = v;
    }
    if (!name && MKEYS.every(k => nums[k] == null)) return;  // an empty row
    if (!name) throw badInput(`第 ${i + 1} 样还没写名字`);
    if (nums.kcal == null) throw badInput(`「${name}」的热量没填`);
    const it = { ...q, name, when: q.when === 'late' ? 'late' : 'any' };
    for (const k of MKEYS) if (nums[k] != null) it[k] = nums[k]; else delete it[k];
    out.push(it);
  });
  setBusy('保存中…');
  await editPlan(plan => { const b = stable(plan.diet?.quick); setPlanVal(plan, 'diet.quick', out.length ? out : null); if (stable(plan.diet?.quick) === b) return false; }, signal);
  await saved(sh, '快捷清单已保存');
}

// 训练日: name, focus, note and the exercises of one plan day (or a new day with the next free letter).
// A new training day's id: one no day ever had here — not a day of the plan, not a deleted one (plan.custom), not one a
// session, a 换一天, 训记's dayMap or its written templates point at — so a deleted day's sessions never turn into the
// new day's.
function nextDayId() {
  const used = new Set(planDays().map(d => String(d.id)));
  for (const k of Object.keys(planCustom())) if (k.startsWith('training.days.')) used.add(k.slice(14));
  for (const w of S.workouts) if (w?.planDayId) used.add(String(w.planDayId));
  for (const v of Object.values(S.days || {})) if (v?.plan) used.add(String(v.plan));
  for (const v of Object.values(S.xunji?.dayMap || {})) if (v) used.add(String(v));
  for (const k of Object.keys(S.xunji?.templatesState || {})) used.add(k);
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return c;
  for (let n = 1; ; n++) if (!used.has('X' + n)) return 'X' + n;
}
/* Managing the plan (v10). The 训练 tab's 计划 lists the training days in the order they come round (the rotation's;
   the days not in it after them), 调整 puts − and ↑ ↓ on every row, + 加一天 is the last row, 怎么排 (the rotation,
   the weekdays) right under it. A day's own page is where the day is edited: its name in the title (a tap: name,
   short name, focus, note), each exercise a row (a tap: that exercise's sheet — sets, reps, load, rest, step, cue,
   换一个, copy or move to another day, 删掉), 调整 for − and ↑ ↓, + 加动作 (the picker stays open for several), ⋯ for
   复制一份 / 轮换 / 删掉这一天. Every change is written at once, noted in plan.custom like any page edit; deleting has 撤销
   instead of a confirm, and the deleted row stays in place (已删掉 · 撤销) until the page is left. Training days are
   called by their names on the page; their ids stay in the data. */
// The plan's days in the order they come round: {d, rot} (rot: in the rotation).
function planOrder() {
  const days = planDays(), rot = rotation().filter(isPlanDay);
  if (!rot.length) return days.map(d => ({ d, rot: false }));
  return [...rot.map(id => ({ d: days.find(x => x.id === id), rot: true })), ...days.filter(d => !rot.includes(d.id)).map(d => ({ d, rot: false }))];
}
const planErr = e => { toast(errMsg(e), true); return null; };
// Change plan day `id`: fn(a copy of it, the plan) edits it (false: nothing to do); written at once, plan.custom noted.
async function planDayEdit(id, fn) {
  if (!S.db) return null;
  return editPlan(plan => {
    const days = plan.training?.days; if (!Array.isArray(days)) return false;
    const i = days.findIndex(d => d?.id === id); if (i < 0) return false;
    const old = clone(days[i]), nd = clone(old);
    if (fn(nd, plan) === false || eqv(old, nd)) return false;
    days[i] = nd; noteCustom(plan, 'training.days.' + id, old, nd);
  });
}
// A new training day into the plan (rot: at the end of the rotation); → its id.
async function planDayAdd(nd, rot) {
  const id = nextDayId();
  await editPlan(plan => {
    const tr = plan.training && typeof plan.training === 'object' ? plan.training : (plan.training = {});
    const days = Array.isArray(tr.days) ? tr.days : (tr.days = []);
    const d = { ...nd, id }; days.push(d);
    noteCustom(plan, 'training.days.' + id, null, d);
    if (rot) setPlanVal(plan, 'training.rotation', [...(Array.isArray(tr.rotation) ? tr.rotation : []), id]);
  });
  return id;
}
// The day's page, opened on a day just added (S.plan has it once the write is in).
function openDayPage(id) { if (isPlanDay(id)) openHist({ view: 'day', id }); }
const rotTail = () => { const r = rotation().filter(isPlanDay); return r.length ? pdName(r[r.length - 1]) : ''; };
const pdName = id => planDays().find(d => d.id === id)?.name || dayShortOf(id);
// 排进轮换 in a toast: the day goes to the end of the rotation.
const rotJoin = id => async () => { try { await editPlan(plan => { const tr = plan.training || {}, r = Array.isArray(tr.rotation) ? tr.rotation : []; if (r.includes(id)) return false; setPlanVal(plan, 'training.rotation', [...r, id]); }); toast(`排进轮换了，现在 ${rotation().length} 天一轮`); render(); } catch (e) { planErr(e); } };

/* the days: 调整 (− ↑ ↓), 加进轮换 / 移出, deleting with 撤销 */
// ↑ ↓: a day in the rotation moves in it (the order they are trained in), any other among the days not in it.
async function planDayMove(id, dir) {
  try {
    await editPlan(plan => {
      const tr = plan.training || {}, rot = Array.isArray(tr.rotation) ? [...tr.rotation] : [], days = Array.isArray(tr.days) ? tr.days : [];
      if (rot.includes(id)) { if (!moveItem(rot, rot.indexOf(id), dir)) return false; setPlanVal(plan, 'training.rotation', rot); return; }
      const list = days.filter(d => !rot.includes(d?.id)), k = list.findIndex(d => d?.id === id), o = list[k + dir];
      if (k < 0 || !o) return false;
      const a = days.indexOf(list[k]), b = days.indexOf(o); [days[a], days[b]] = [days[b], days[a]];
    });
    render();
  } catch (e) { planErr(e); }
}
// 加进轮换 (at the end) / 移出轮换 (at least one day stays in it).
async function planDayRot(id) {
  const inRot = rotation().includes(id);
  if (inRot && rotation().filter(isPlanDay).length <= 1) { toast('轮换里至少要留一天；不想轮换就在「怎么排」里关掉', true); return; }
  try {
    await editPlan(plan => {
      const tr = plan.training || {}, r = Array.isArray(tr.rotation) ? tr.rotation : [];
      setPlanVal(plan, 'training.rotation', inRot ? r.filter(x => x !== id) : [...r, id]);
    });
    toast(inRot ? `「${pdName(id)}」移出轮换了，留在计划里` : `「${pdName(id)}」排进轮换了，现在 ${rotation().length} 天一轮`); render();
  } catch (e) { planErr(e); }
}
// Days deleted while the 训练 tab is open: shown where they were (已删掉 · 撤销) until another tab.
S.planGone = [];
// 删掉这一天 (调整's −, the day page's ⋯): at once, with 撤销 (the toast, the row left in its place). The weekdays it was
// on keep training with the rotation, or become rest days without one; it leaves the rotation. A 训记 title that
// pointed at it is said in the toast. 撤销 puts the training part and plan.custom back, unless the plan changed since.
async function planDayDelete(id) {
  if (!S.db || !S.plan) return false;
  const dn = pdName(id), at = planOrder().findIndex(o => o.d?.id === id);
  const xj = Object.entries(S.xunji?.dayMap || {}).filter(([, v]) => v === id).map(([k]) => k);
  let snap = null, after = null, offDays = [];
  try {
    after = await editPlan(plan => {
      const tr = plan.training || {}, days = Array.isArray(tr.days) ? tr.days : [];
      const i = days.findIndex(d => d?.id === id); if (i < 0) return false;
      snap = { training: clone(plan.training), custom: clone(plan.custom ?? null) };
      const [old] = days.splice(i, 1);
      noteCustom(plan, 'training.days.' + id, old, null);
      const rot = Array.isArray(tr.rotation) ? tr.rotation : [], r = rot.filter(x => x !== id);
      if (rot.includes(id)) setPlanVal(plan, 'training.rotation', r.length ? r : null);
      if (tr.schedule && typeof tr.schedule === 'object') {
        const sch = { ...tr.schedule };
        for (const [k, v] of Object.entries(sch)) if (v === id) { if (r.length) sch[k] = r[0]; else { offDays.push(Number(k)); delete sch[k]; } }
        setPlanVal(plan, 'training.schedule', sch);
      }
    });
  } catch (e) { planErr(e); return false; }
  if (!after) return false;
  const undo = async () => {
    S.planGone = S.planGone.filter(g => g.id !== id);
    try {
      const r = await editPlan(plan => {
        if (stable(plan.training) !== stable(after.training)) return false;  // changed since: leave it
        plan.training = snap.training;
        if (snap.custom == null) delete plan.custom; else plan.custom = snap.custom;
      });
      toast(r ? `「${dn}」恢复了` : '计划在这之后又改过，没法撤销了', !r);
    } catch (e) { planErr(e); }
    render();
  };
  S.planGone = [...S.planGone.filter(g => g.id !== id), { id, name: dn, at: Math.max(0, at), undo }];
  render();
  const off = offDays.length ? `，${offDays.sort((a, z) => a - z).map(k => `周${WD[k % 7]}`).join('、')}改成休息` : '';
  toast(`删掉了「${dn}」${off}${xj.length ? `；训记里的「${xj[0]}」${xj.length > 1 ? ` 等 ${xj.length} 个` : ''}不再对应计划` : ''}`, false, undo);
  return true;
}
// 怎么排: the rotation on (the days as listed, every one in it) or off (each weekday keeps the day it had).
async function planRotMode(on) {
  if (on === rotation().length > 0) return;
  try {
    await editPlan(plan => {
      const tr = plan.training || {}, days = Array.isArray(tr.days) ? tr.days : [];
      if (on) {
        const ids = days.map(d => d.id), sch = { ...(tr.schedule || {}) };
        for (const [k, v] of Object.entries(sch)) if (!ids.includes(v)) delete sch[k];
        setPlanVal(plan, 'training.rotation', ids); setPlanVal(plan, 'training.schedule', sch);
      } else setPlanVal(plan, 'training.rotation', null);
    });
    render();
    if (!on) toast('改成固定周几练哪天：在「怎么排」里给每个周几选好');
  } catch (e) { planErr(e); }
}
// A weekday's chip (rotating): 练 ↔ 休. A training weekday keeps the day it had (the fallback before any history), else
// the next in turn.
async function planWeekday(i) {
  try {
    await editPlan(plan => {
      const tr = plan.training || {}, rot = (Array.isArray(tr.rotation) ? tr.rotation : []).filter(x => (tr.days || []).some(d => d?.id === x));
      if (!rot.length) return false;
      const old = tr.schedule && typeof tr.schedule === 'object' ? tr.schedule : {}, on = new Set(Object.keys(old).filter(k => old[k]));
      if (on.has(String(i))) on.delete(String(i)); else on.add(String(i));
      const ns = {}; let k = 0;
      for (let d = 1; d <= 7; d++) if (on.has(String(d))) { ns[String(d)] = rot.includes(old[String(d)]) ? old[String(d)] : rot[k % rot.length]; k++; }
      setPlanVal(plan, 'training.schedule', ns);
    });
    render();
  } catch (e) { planErr(e); }
}

/* a day's name, short name, focus and note; 加一天 */
function openDayMeta(id) {
  if (!S.plan) return;
  const d = id ? planDays().find(x => x.id === id) : null; if (id && !d) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'day-meta', dayId: d ? d.id : null, isNewDay: !d, photos: [], removed: [] };
  const tail = rotTail(), more = [d?.short ? `简称 ${d.short}` : '', d?.focus || '', d?.note ? '有备注' : ''].filter(Boolean).join(' · ');
  showSheet(d ? '名字和备注' : '加一天', `<div class="field"><label for="dm-name">名字</label><input type="text" id="dm-name" maxlength="20" autocomplete="off" value="${esc(d?.name || '')}" placeholder="例如 胸 肩 三头"></div>
    ${!d && tail ? tgl('dm-rot', '排进轮换', `排在「${tail}」之后，变成 ${rotation().filter(isPlanDay).length + 1} 天一轮`, true) : ''}
    ${!d && !tail ? '<p class="hint" style="margin:0">加好以后，在「训练」页的「怎么排」里给它排上周几。</p>' : ''}
    <details class="de-more" data-key="dm-more"><summary>更多<small>${esc(more || '简称、重点、备注')}</small>${CHEV_R}</summary><div class="de-more-b">
      <div class="field"><label for="dm-short">简称<small>最多 4 个字，不填就用名字的第一段</small></label><input type="text" id="dm-short" maxlength="4" autocomplete="off" value="${esc(d?.short || '')}" placeholder="${esc(d ? dayShort({ ...d, short: '' }) : '胸')}"></div>
      <div class="field"><label for="dm-focus">重点</label><textarea id="dm-focus" class="grow" rows="1" maxlength="40" placeholder="例如 推：胸、肩前中束、三头">${esc(d?.focus || '')}</textarea></div>
      <div class="field"><label for="dm-note">备注</label><textarea id="dm-note" class="grow" rows="2" placeholder="这天的注意事项">${esc(d?.note || '')}</textarea></div></div></details>
    ${!d ? '<p class="hint" style="margin:0">接下来在这一天的页面里点「+ 加动作」挑动作。</p>' : ''}`, footer('save-daymeta', false));
  formReady('save-daymeta', d ? d.id : 'new'); growAll();
}
async function saveDayMeta(sh, signal) {
  if (!S.db) return;
  const name = fval('dm-name'), short = [...fval('dm-short')].slice(0, 4).join(''), focus = fval('dm-focus'), note = fval('dm-note');
  if (!name) throw badInput('给这一天起个名字', 'dm-name');
  setBusy('保存中…');
  const put = nd => { nd.name = name; for (const [k, v] of [['short', short], ['focus', focus], ['note', note]]) { if (v) nd[k] = v; else delete nd[k]; } };
  if (!sh.isNewDay) { await planDayEdit(sh.dayId, nd => put(nd)); await saved(sh); return; }
  const rot = checked('dm-rot'), tail = rotTail(), n = rotation().filter(isPlanDay).length + 1, nd = { exercises: [] }; put(nd);
  const id = await planDayAdd(nd, rot);
  await saved(sh);
  openDayPage(id);
  toast(rot ? `加了「${name}」，排在「${tail}」之后，现在 ${n} 天一轮` : `加了「${name}」`);
}
// 复制一份 (the day page's ⋯): the same exercises under 「… 2」, not in the rotation (a copy is usually there to replace
// the day it came from); its page opens.
async function planDayCopy(id) {
  const d = planDays().find(x => x.id === id); if (!d) return;
  const { id: _, ...rest } = clone(d), name = `${String(d.name || dayShort(d)).slice(0, 16)} 2`;
  delete rest.short;
  try {
    const nid = await planDayAdd({ ...rest, name }, false);
    openDayPage(nid);
    toast(`复制了一份「${name}」，没排进轮换`, false, rotJoin(nid), '排进轮换');
  } catch (e) { planErr(e); }
}
// 把这次的动作存成训练日 (a session's details): a new day with the session's exercises, its page open.
async function planDayFrom(w) {
  if (!S.plan) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const name = String(woTitle(w) || '训练').slice(0, 20), exercises = exItemsFrom(w);
  if (!exercises.length) { toast('这次没有能存的动作', true); return; }
  try {
    const nid = await planDayAdd({ name, exercises }, false);
    openDayPage(nid);
    toast(`存成了训练日「${name}」，没排进轮换`, false, rotJoin(nid), '排进轮换');
  } catch (e) { planErr(e); }
}
// The day page's ⋯.
function openDayMore(id) {
  const d = planDays().find(x => x.id === id); if (!d) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const inRot = rotation().includes(id), rotOn = rotation().length > 0, at = `data-id="${esc(id)}" data-close="1"`;
  S.sheet = { type: 'info', photos: [], removed: [] };
  showSheet(d.name || dayShort(d), `<div class="panel acts">
    <button type="button" class="act-row" data-act="dp-meta" ${at}><b>改名字和备注</b><small>简称、重点、备注也在这里</small></button>
    <button type="button" class="act-row" data-act="dp-copy" ${at}><b>复制一份</b><small>一样的动作，改改当另一天；不会排进轮换</small></button>
    ${rotOn ? `<button type="button" class="act-row" data-act="dp-rot" ${at}><b>${inRot ? '移出轮换' : '排进轮换'}</b><small>${inRot ? '留在计划里，轮到的时候跳过它' : '排在轮换最后'}</small></button>` : ''}
    <button type="button" class="act-row" data-act="dp-del" ${at}><b class="danger-t">删掉这一天</b><small>马上删，可以撤销</small></button></div>`,
    '<button type="button" class="btn ghost main" data-act="close">关闭</button>');
}

/* a day's exercises: the sheet of one, 加动作 / 换一个 (the picker), 调整, deleting with 撤销 */
HIST.adj = false; HIST.gone = [];
// One exercise of a plan day: sets (− / +), reps, load (last time's beside it), rest, the weight step, the cue;
// 换一个, 看记录, 复制到 / 移到 another day, 删掉. 保存 writes it (关闭 when nothing changed).
function openPlanEx(id, i) {
  const d = planDays().find(x => x.id === id), x = d?.exercises?.[i]; if (!x) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'plan-ex', dayId: id, i, name0: String(x.name || '').trim(), items: [clone(x)], photos: [], removed: [] };
  const name = String(x.name || '').trim(), h = exHistory(name, today()), wk = h.last ? workOf(h.last.sets) : null;
  const lastLoad = wk ? (wk.timed ? `${wk.sets.map(s => s.sec).join('/')} 秒` : loadTxt(wk.sets[0]) || '') : '';
  const n = Math.max(1, Math.min(10, parseInt(x.sets, 10) || 3)), rest = String(x.rest || '').trim(), restSec = parseRest(rest), step = isNum(x.step) ? x.step : null;
  const others = planOrder().map(o => o.d).filter(o => o && o.id !== id);
  const to = act => others.map(o => `<button type="button" class="chip" data-act="${act}" data-to="${esc(o.id)}">${esc(o.name || dayShort(o))}</button>`).join('');
  showSheet(name || '动作', `<div class="de-f px-f">
      <div class="de-nm"><input type="text" data-e="name" autocomplete="off" value="${esc(x.name ?? '')}" placeholder="动作名称" aria-label="动作名称"><button type="button" class="link" data-act="px-swap">换一个</button></div>
      <div class="de-g2"><div class="de-k"><span class="lbl">组数</span><div class="de-step"><button type="button" class="icon-btn" data-act="px-sets" data-d="-1" aria-label="少一组">−</button><b class="de-n num">${n}</b><button type="button" class="icon-btn" data-act="px-sets" data-d="1" aria-label="多一组">+</button></div></div>
        <label class="de-k"><span class="lbl">次数</span><input type="text" data-e="reps" autocomplete="off" value="${esc(x.reps ?? '')}" placeholder="8–12"></label></div>
      <label class="de-k"><span class="lbl">重量</span><span class="de-ld"><input type="text" data-e="load" autocomplete="off" value="${esc(x.load ?? '')}" placeholder="22.5kg / RPE 8 / 自重">${lastLoad ? `<small>上次 ${esc(lastLoad)}</small>` : '<small>还没练过</small>'}</span></label>
      <div class="de-k"><span class="lbl">休息</span><div class="de-rest"><div class="chips">${deRests.map(s => `<button type="button" class="chip" data-act="px-rest" data-v="${s}" aria-pressed="${restSec === s}">${s}s</button>`).join('')}</div><input type="text" data-e="rest" autocomplete="off" value="${esc(rest)}" placeholder="自定义，如 100s" aria-label="休息秒数"></div></div>
      <div class="de-k"><span class="lbl">重量步进<small>自动：现在按 ${esc(fmt(stepOf(name, id)))} kg 算</small></span><div class="chips de-stp"><button type="button" class="chip" data-act="px-step" data-v="" aria-pressed="${step == null}">自动</button>${deSteps.map(s => `<button type="button" class="chip" data-act="px-step" data-v="${s}" aria-pressed="${step === s}">${s} kg</button>`).join('')}</div></div>
      <textarea data-e="cue" class="grow cue-in" rows="1" placeholder="要点（可不填）" aria-label="动作要点">${esc(x.cue ?? '')}</textarea>
      ${name ? `<button type="button" class="link px-hist" data-act="ex-open" data-n="${esc(name)}">看这个动作的记录 ›</button>` : ''}
      ${others.length ? `<div class="de-k px-to"><span class="lbl">复制到</span><div class="chips">${to('px-copy')}</div><span class="lbl">移到</span><div class="chips">${to('px-move')}</div></div>` : ''}
    </div>`, `<button type="button" class="btn ghost danger" data-act="px-del-sheet">删掉</button><button type="button" class="btn primary main" data-act="save-planex" id="save-btn">保存</button>`);
  formReady('save-planex', `${id}|${i}`); growAll();
}
// The row an exercise sheet stands for: its index, unless the day changed underneath (then by its name), or -1.
function pxIndex(nd, sh) {
  const xs = Array.isArray(nd.exercises) ? nd.exercises : [];
  if (String(xs[sh.i]?.name || '').trim() === sh.name0) return sh.i;
  return xs.findIndex(x => String(x?.name || '').trim() === sh.name0);
}
// The exercise as typed in the sheet, checked; throws what to fix.
function pxRow(x) {
  const n = String(x.name ?? '').trim(); if (!n) throw badInput('给这个动作写个名字');
  const sets = typeof x.sets === 'number' ? x.sets : parseNum(x.sets, true);
  if (!(Number.isInteger(sets) && sets >= 1 && sets <= 10)) throw badInput(`「${n}」的组数要在 1–10 之间`);
  const o = { ...x, name: n, sets };
  for (const k of ['reps', 'load', 'rest', 'cue']) { const v = String(x[k] ?? '').trim(); if (v) o[k] = v; else delete o[k]; }
  if (isNum(x.step) && x.step > 0) o.step = x.step; else delete o.step;
  return o;
}
async function savePlanEx(sh, signal) {
  if (!S.db) return;
  const o = pxRow(sh.items[0]);
  setBusy('保存中…');
  await planDayEdit(sh.dayId, nd => { const k = pxIndex(nd, sh); if (k < 0) return false; nd.exercises[k] = o; });
  await saved(sh, '保存了');
}
// 复制到 / 移到 another day (the sheet's numbers come along; 移到 takes it off this day).
async function planExTo(sh, to, move) {
  let o; try { o = pxRow(sh.items[0]); } catch (e) { toast(errMsg(e), true); return; }
  const tn = pdName(to);
  if (planDays().find(d => d.id === to)?.exercises?.some(x => String(x?.name || '').trim() === o.name)) { toast(`「${tn}」已经有 ${o.name} 了`, true); return; }
  sh.saved = true; closeSheet(true);
  try {
    await planDayEdit(to, nd => { (nd.exercises = Array.isArray(nd.exercises) ? nd.exercises : []).push(o); });
    if (move) await planDayEdit(sh.dayId, nd => { const k = pxIndex(nd, sh); if (k < 0) return false; nd.exercises.splice(k, 1); });
    render();
    toast(move ? `「${o.name}」移到了「${tn}」` : `「${o.name}」复制到了「${tn}」`, false, () => openDayPage(to), '去看看');
  } catch (e) { planErr(e); }
}
// Deleting an exercise (调整's −, the sheet's 删掉): at once; the row stays in its place as 已删掉 · 撤销 until the page goes.
async function planExDel(id, i, name0) {
  const d = planDays().find(x => x.id === id), x = d?.exercises?.[i]; if (!x || (name0 && String(x.name || '').trim() !== name0)) return;
  const name = String(x.name || '').trim() || '动作', ex = clone(x);
  try { await planDayEdit(id, nd => { if (String(nd.exercises?.[i]?.name || '').trim() !== String(x.name || '').trim()) return false; nd.exercises.splice(i, 1); }); }
  catch (e) { planErr(e); return; }
  const undo = async () => {
    HIST.gone = HIST.gone.filter(g => g.ex !== ex);
    try { await planDayEdit(id, nd => { const xs = Array.isArray(nd.exercises) ? nd.exercises : (nd.exercises = []); xs.splice(Math.min(i, xs.length), 0, ex); }); toast(`「${name}」放回去了`); }
    catch (e) { planErr(e); }
    render();
  };
  HIST.gone = [...HIST.gone.filter(g => g.id === id), { id, at: i, name, ex, undo }];
  render(); toast(`删掉了「${name}」`, false, undo);
}
async function planExMove(id, i, dir) {
  try { await planDayEdit(id, nd => { if (!Array.isArray(nd.exercises) || !moveItem(nd.exercises, i, dir)) return false; }); render(); }
  catch (e) { planErr(e); }
}
// + 加动作: the picker stays open, every tap adds one (with what it was last done with), 已有 marks it; 完成 closes.
// 换一个 (sheet: the exercise's): its sets, reps and rest stay, the cue and load follow the new one.
function openPlanPick(id, swap) {
  const d = planDays().find(x => x.id === id); if (!d) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const sw = swap && d.exercises?.[swap.i] ? swap : null;
  S.sheet = { type: 'plan-pick', dayId: id, photos: [], removed: [] };
  S.sheet.pk = pickerState({ pd: d, here: planExs(d).map(x => x.name), swapping: !!sw, cat: S.profile?.level === 'new' ? '' : libPartOf(d), on: (name, kind) => planPicked(id, name, kind, sw) });
  showSheet(sw ? `换掉「${d.exercises[sw.i].name || ''}」` : `加动作 · ${d.name || dayShort(d)}`, pickerHTML(), `<button type="button" class="btn ${sw ? 'ghost' : 'primary'} main" data-act="close">${sw ? '取消' : '完成'}</button>`);
  drawPick();
}
async function planPicked(id, name, kind, sw) {
  const pk = S.sheet?.pk;
  if (sw) {
    closeSheet(true);
    try { await planDayEdit(id, nd => { const k = pxIndex(nd, { i: sw.i, name0: sw.name0 }); if (k < 0) return false; nd.exercises[k] = swapExFields(nd.exercises[k], name); }); toast(`换成了「${name}」`); render(); }
    catch (e) { planErr(e); }
    return;
  }
  if (pk?.here.has(name)) { toast(`这天已经有 ${name} 了`); return; }
  try {
    await planDayEdit(id, nd => { (nd.exercises = Array.isArray(nd.exercises) ? nd.exercises : []).push(deDefaults(name, kind)); });
    if (pk) { pk.here.add(name); drawPick(); }
    render(); toast(`加了「${name}」`);
  } catch (e) { planErr(e); }
}

// A session's exercises as plan rows: the working sets' count, reps as min–max, the working load, the rest.
function exItemsFrom(w) {
  return (w.exercises || []).filter(e => e && typeof e === 'object' && !e.cardio && String(e.name || '').trim()).map(e => {
    const wk = workOf(e.sets), xs = wk ? wk.sets : [], reps = xs.map(s => s.reps).filter(isNum);
    const o = { name: String(e.name).trim(), sets: Math.max(1, Math.min(10, xs.length || 3)) };
    if (wk?.timed) { const secs = xs.map(s => s.sec).filter(isNum); if (secs.length) o.reps = `${Math.min(...secs)} 秒`; }
    else if (reps.length) o.reps = Math.min(...reps) === Math.max(...reps) ? String(reps[0]) : `${Math.min(...reps)}–${Math.max(...reps)}`;
    const load = xs[0] ? planLoadOf(xs[0]) : ''; if (load) o.load = load;
    if (isNum(e.restSec) && e.restSec > 0) o.rest = `${e.restSec}s`;
    return o;
  });
}
// A set's load as the plan writes it: 「22.5kg」 · 「自重」 · 「自重+10kg」 · 「辅助 20kg」; '' without one.
const planLoadOf = s => isNum(s?.assist) && s.assist > 0 ? `辅助 ${s.assist}kg` : s?.bodyweight ? (isNum(s.kg) && s.kg > 0 ? `自重+${s.kg}kg` : '自重') : isNum(s?.kg) ? `${s.kg}kg` : '';
// Defaults for an exercise added to a day: as it was last done (sets, reps as the plan has them or min–max, load), else
// 3 × 8–12 at RPE 8; rest 90 s (leg compounds 120 s).
function deDefaults(name, kind) {
  const h = exHistory(name, today()), wk = h.last ? workOf(h.last.sets) : null, px = planEx(name);
  const o = { name, sets: 3, reps: '8–12', rest: /蹲|硬拉|倒蹬|臀推/.test(name) ? '120s' : '90s' };
  if (px) { if (px.reps) o.reps = px.reps; if (px.rest) o.rest = px.rest; if (px.cue) o.cue = px.cue; }
  if (wk && !wk.timed) {
    const reps = wk.sets.map(s => s.reps).filter(isNum);
    o.sets = Math.max(1, Math.min(10, wk.sets.length));
    if (!px?.reps && reps.length >= 2) { const lo = Math.min(...reps), hi = Math.max(...reps); o.reps = lo === hi ? `${lo}–${lo + 4}` : `${lo}–${hi}`; }
    const load = planLoadOf(wk.sets[0]); if (load) o.load = load;
  } else if (wk?.timed) { o.reps = `${Math.min(...wk.sets.map(s => s.sec).filter(isNum))} 秒`; delete o.load; }
  else if (kind === 'bw') o.load = '自重';
  else if (kind === 'assist') o.load = '辅助';
  else if (kind === 'sec') { o.reps = '45 秒'; }
  else if (kind !== 'cardio') o.load = 'RPE 8';
  if (px?.load && !o.load) o.load = px.load;
  return o;
}
const deRests = [60, 90, 120, 150, 180], deSteps = [1, 2, 2.5, 5];
// Text areas that grow with what is in them (要点 and the like, #24).
function grow(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }
function growAll(root = sheetEl) { root.querySelectorAll('textarea.grow').forEach(grow); }

/* ---------- 自己搭一套 (B3): five templates from the coach's table (v7-coach 附录 B), filtered by days a week and
   where the person trains; a beginner gets the smaller set counts and RPE 7. Written to plan/current as a plan of its
   own (no diet: Claude fills the targets next time), or, over an existing plan, only its training part — the old one
   goes to plan_history first. ---------- */
// exercise rows: [name, sets for a beginner, sets with some experience, reps, rest s, cue?]
const TPL_CUE = {
  杠铃深蹲: '脚跟踩实，蹲到大腿平行，膝盖跟着脚尖', 杠铃卧推: '肩胛后缩下沉，杠落胸中下部', 坐姿划船: '肘贴身往后，肩胛夹紧停一秒', 杠铃罗马尼亚硬拉: '臀往后推，杠贴腿滑，背平',
  哑铃推肩: '肋骨收住，推到头顶正上方', 侧平举: '肘带着抬到肩高，不耸肩', 卷腹: '下背贴地，肩胛卷离地面', 器械倒蹬: '下背不离靠垫，膝到 90°', 高位下拉: '先沉肩再拉，拉到下巴下',
  上斜哑铃卧推: '30° 斜度，推起不碰', 腿弯举: '慢放 2 秒，臀不抬', 哑铃弯举: '大臂不前摆', 直杆绳索下压: '大臂贴身，压到底停一秒', 平板支撑: '臀夹紧，身体一条线',
  哑铃保加利亚蹲: '前脚离凳一大步，前膝不内扣', 绳索臂屈伸: '大臂贴身，绳头向下拉开到伸直', 俯卧哑铃划船: '胸贴斜板，肘贴身拉到底', 面拉: '拉到额头两侧，肘高于腕',
  绳索夹胸: '手臂微弯画弧，顶点挤', '引体向上（辅助）': '先沉肩再拉，胸迎杠', 宽距高位下拉: '先沉肩再拉，胸迎杠', 对握高位下拉: '肘往裤兜方向', 上斜哑铃弯举: '下放到底充分伸展',
  锤式弯举: '肘钉在身侧', 站姿器械提踵: '顶端停一秒，底部充分拉伸', 杠铃臀推: '下巴收住，顶端臀夹紧停一秒', 腿屈伸: '顶端停一秒', 哑铃箭步蹲: '迈步前蹲再站起，上身直',
  悬垂举腿: '骨盆后倾卷起来，不荡', 哑铃卧推: '推到胸口上方，肘不过低', 仰卧杠铃臂屈伸: '大臂稍后倾固定，只动肘', 哈克深蹲: '背靠垫，蹲到底再蹬起', 上斜杠铃卧推: '上斜凳，杠铃下到锁骨上方',
  器械推肩: '坐稳，推到手臂伸直', 杠铃划船: '俯身握杠，拉到小腹', 哑铃直腿硬拉: '微屈膝俯身，哑铃贴腿滑到小腿', 哑铃酒杯深蹲: '哑铃抱胸前，蹲到底再站起', 哑铃划船: '单手撑凳，哑铃拉到腰侧',
  俯卧撑: '身体一条线，胸口贴近地面再撑起', 窄距俯卧撑: '双手窄于肩，肘贴身', 椅间屈膝反向划船: '身体绷直，胸口拉到桌沿', 自重深蹲: '蹲到大腿平行，膝盖跟着脚尖', 原地箭步蹲: '后膝接近地面，上身直',
  单腿臀桥: '顶起时臀夹紧停一秒', 毛巾腿弯举: '脚跟慢慢滑回来', 站姿自重提踵: '站台阶边，底部充分拉伸', 派克俯卧撑: '臀顶高，头往地面压', 俯身飞鸟: '俯身，两臂向两侧抬到肩高',
};
const T = (n, a, b, r, s, c) => [n, a, b, r, s, c];
const TPL = [
  { id: 'fb2', name: '全身 2 天', who: '每周只能去两次，想把全身都照顾到', days: [2], rec: { new: 2, some: 2, adv: 2 }, d: [
    ['A', '全身 1', [T('杠铃深蹲', 3, 4, '6–10', 150), T('杠铃卧推', 3, 4, '6–10', 150), T('坐姿划船', 3, 4, '8–12', 90), T('杠铃罗马尼亚硬拉', 3, 3, '8–12', 120), T('哑铃推肩', 2, 3, '8–12', 90), T('侧平举', 2, 3, '12–20', 60), T('卷腹', 2, 2, '15–20', 60)]],
    ['B', '全身 2', [T('器械倒蹬', 3, 4, '8–12', 120), T('高位下拉', 3, 4, '8–12', 90), T('上斜哑铃卧推', 3, 4, '8–12', 120), T('腿弯举', 2, 3, '10–15', 60), T('哑铃弯举', 2, 3, '10–15', 60), T('直杆绳索下压', 2, 3, '10–15', 60), T('平板支撑', 2, 2, '40–60 秒', 60)]],
  ] },
  { id: 'fb3', name: '全身 3 天', sub: '新手推荐', who: '刚开始练、每周 3 次，每次练到全身', days: [3], rec: { new: 3 }, d: [
    ['A', '全身 1', [T('杠铃深蹲', 3, 4, '6–10', 150), T('杠铃卧推', 3, 4, '6–10', 150), T('坐姿划船', 3, 4, '8–12', 90), T('侧平举', 3, 3, '12–20', 60), T('卷腹', 2, 3, '15–20', 60)]],
    ['B', '全身 2', [T('杠铃罗马尼亚硬拉', 3, 4, '8–12', 120), T('哑铃推肩', 3, 3, '8–12', 90), T('高位下拉', 3, 4, '8–12', 90), T('哑铃保加利亚蹲', 2, 3, '10–12', 90), T('哑铃弯举', 2, 3, '10–15', 60), T('绳索臂屈伸', 2, 3, '10–15', 60)]],
    ['C', '全身 3', [T('器械倒蹬', 3, 4, '10–15', 120), T('上斜哑铃卧推', 3, 4, '8–12', 120), T('俯卧哑铃划船', 3, 3, '10–12', 90), T('腿弯举', 2, 3, '10–15', 60), T('面拉', 3, 3, '15–20', 60), T('平板支撑', 2, 2, '45–60 秒', 60)]],
  ] },
  { id: 'ppl', name: '推 / 拉 / 腿 3 天', who: '练过一阵，想按推、拉、腿分开练', days: [3], rec: { some: 3, adv: 3 }, d: [
    ['A', '推 胸 肩 三头', [T('杠铃卧推', 3, 4, '6–10', 150), T('哑铃推肩', 3, 3, '8–12', 90), T('上斜哑铃卧推', 3, 3, '8–12', 120), T('侧平举', 3, 4, '12–20', 60), T('直杆绳索下压', 2, 3, '10–15', 60), T('绳索夹胸', 0, 2, '12–15', 60)]],
    ['B', '拉 背 二头', [T('引体向上（辅助）', 3, 4, '6–10', 120), T('坐姿划船', 3, 4, '8–12', 90), T('对握高位下拉', 2, 3, '10–12', 90), T('面拉', 3, 3, '15–20', 60), T('上斜哑铃弯举', 2, 3, '10–15', 60), T('锤式弯举', 0, 2, '10–15', 60)]],
    ['C', '腿 腹', [T('杠铃深蹲', 3, 4, '6–10', 180), T('杠铃罗马尼亚硬拉', 3, 3, '8–12', 120), T('器械倒蹬', 2, 3, '10–15', 120), T('腿弯举', 2, 3, '10–15', 60), T('站姿器械提踵', 3, 4, '10–15', 60), T('卷腹', 2, 3, '15–20', 60)]],
  ] },
  { id: 'ppl6', name: '推 / 拉 / 腿 6 天', who: '有基础、每天都能去、睡够 7 小时：每块肌肉一周两遍', days: [6], rec: { some: 6, adv: 6, new: 6 }, d: [
    ['A', '推 1', [T('杠铃卧推', 3, 4, '6–10', 150), T('哑铃推肩', 3, 3, '8–12', 90), T('上斜哑铃卧推', 3, 3, '8–12', 120), T('侧平举', 3, 4, '12–20', 60), T('直杆绳索下压', 2, 3, '10–15', 60), T('绳索夹胸', 0, 2, '12–15', 60)]],
    ['B', '拉 1', [T('引体向上（辅助）', 3, 4, '6–10', 120), T('坐姿划船', 3, 4, '8–12', 90), T('对握高位下拉', 2, 3, '10–12', 90), T('面拉', 3, 3, '15–20', 60), T('上斜哑铃弯举', 2, 3, '10–15', 60), T('锤式弯举', 0, 2, '10–15', 60)]],
    ['C', '腿 1', [T('杠铃深蹲', 3, 4, '6–10', 180), T('杠铃罗马尼亚硬拉', 3, 3, '8–12', 120), T('器械倒蹬', 2, 3, '10–15', 120), T('腿弯举', 2, 3, '10–15', 60), T('站姿器械提踵', 3, 4, '10–15', 60), T('卷腹', 2, 3, '15–20', 60)]],
    ['D', '推 2', [T('上斜杠铃卧推', 2, 3, '6–10', 150), T('器械推肩', 2, 2, '8–12', 90), T('哑铃卧推', 2, 2, '8–12', 120), T('侧平举', 2, 3, '12–20', 60), T('绳索臂屈伸', 2, 2, '10–15', 60), T('绳索夹胸', 0, 2, '12–15', 60)]],
    ['E', '拉 2', [T('杠铃划船', 2, 3, '6–10', 120), T('俯卧哑铃划船', 2, 3, '8–12', 90), T('宽距高位下拉', 2, 2, '10–12', 90), T('面拉', 2, 2, '15–20', 60), T('哑铃弯举', 2, 2, '10–15', 60), T('锤式弯举', 0, 2, '10–15', 60)]],
    ['F', '腿 2', [T('哈克深蹲', 2, 3, '6–10', 180), T('杠铃臀推', 2, 2, '8–12', 120), T('腿屈伸', 2, 2, '12–15', 60), T('腿弯举', 2, 2, '10–15', 60), T('站姿器械提踵', 2, 3, '10–15', 60), T('卷腹', 2, 2, '15–20', 60)]],
  ] },
  { id: 'ul4', name: '上肢 / 下肢 4 天', who: '每周 4–5 次，上下肢轮着练', days: [4, 5], rec: { new: 4, some: 4, adv: 4 }, d: [
    ['A', '上肢 1 推为主', [T('杠铃卧推', 3, 4, '6–10', 150), T('坐姿划船', 3, 4, '8–12', 90), T('哑铃推肩', 3, 3, '8–12', 90), T('高位下拉', 2, 3, '8–12', 90), T('侧平举', 3, 3, '12–20', 60), T('直杆绳索下压', 2, 2, '10–15', 60)]],
    ['B', '下肢 1', [T('杠铃深蹲', 3, 4, '6–10', 180), T('杠铃罗马尼亚硬拉', 3, 3, '8–12', 120), T('哑铃保加利亚蹲', 2, 3, '10–12', 90), T('腿弯举', 2, 3, '10–15', 60), T('站姿器械提踵', 3, 3, '10–15', 60), T('卷腹', 2, 3, '15–20', 60)]],
    ['C', '上肢 2 拉为主', [T('引体向上（辅助）', 3, 4, '6–10', 120), T('上斜哑铃卧推', 3, 4, '8–12', 120), T('俯卧哑铃划船', 3, 3, '10–12', 90), T('绳索夹胸', 2, 2, '12–15', 60), T('面拉', 3, 3, '15–20', 60), T('上斜哑铃弯举', 2, 3, '10–15', 60)]],
    ['D', '下肢 2', [T('器械倒蹬', 3, 4, '10–15', 120), T('杠铃臀推', 3, 3, '8–12', 120), T('腿屈伸', 2, 3, '12–15', 60), T('哑铃箭步蹲', 2, 3, '10–12', 90), T('站姿器械提踵', 3, 3, '10–15', 60), T('悬垂举腿', 2, 3, '10–15', 60)]],
  ] },
  { id: 'cbl4', name: '胸背腿 + 上肢 4 天', who: '每周 4 次，一天一大块，第四天下肢加上肢补量', days: [4], rec: {}, d: [
    ['A', '胸 肩 三头', [T('哑铃卧推', 3, 4, '8–12', 150), T('上斜哑铃卧推', 3, 3, '10–12', 120), T('哑铃推肩', 3, 3, '8–12', 90), T('侧平举', 3, 4, '12–20', 60), T('仰卧杠铃臂屈伸', 2, 3, '10–12', 90)]],
    ['B', '背 二头', [T('对握高位下拉', 3, 4, '8–12', 120), T('坐姿划船', 3, 4, '10–12', 90), T('俯卧哑铃划船', 2, 3, '10–12', 90), T('面拉', 3, 3, '15–20', 60), T('上斜哑铃弯举', 2, 3, '10–12', 60)]],
    ['C', '腿 腹', [T('器械倒蹬', 3, 4, '10–12', 120), T('杠铃罗马尼亚硬拉', 3, 4, '8–12', 120), T('哑铃保加利亚蹲', 2, 3, '10–12', 90), T('腿弯举', 2, 3, '12–15', 60), T('站姿器械提踵', 3, 3, '12–15', 60), T('卷腹', 2, 3, '15–20', 60)]],
    ['D', '下肢 上肢补量', [T('哈克深蹲', 3, 3, '8–12', 120), T('杠铃卧推', 3, 4, '6–10', 150), T('宽距高位下拉', 3, 4, '8–12', 120), T('侧平举', 2, 3, '12–20', 60), T('直杆绳索下压', 2, 2, '10–15', 60), T('哑铃弯举', 2, 2, '10–15', 60)]],
  ] },
];
// 家里（哑铃）: what each gym move becomes; 徒手: by what it trains (a beginner's version, then a harder one)
const TPL_HOME = { 杠铃卧推: '哑铃卧推', 器械推胸: '哑铃卧推', 上斜杠铃卧推: '上斜哑铃卧推', 绳索夹胸: '哑铃飞鸟', 蝴蝶机夹胸: '哑铃飞鸟', 高位下拉: '弹力绳-高位下拉', 宽距高位下拉: '弹力绳-高位下拉', 对握高位下拉: '弹力绳-高位下拉',
  '引体向上（辅助）': '弹力绳-高位下拉', 坐姿划船: '哑铃划船', 器械坐姿划船: '哑铃划船', 杠铃划船: '哑铃划船', 杠铃深蹲: '哑铃酒杯深蹲', 哈克深蹲: '哑铃酒杯深蹲', 器械倒蹬: '哑铃保加利亚蹲', 杠铃罗马尼亚硬拉: '哑铃直腿硬拉',
  腿弯举: '毛巾腿弯举', 腿屈伸: '哑铃箭步蹲', 杠铃臀推: '单腿臀桥', 站姿器械提踵: '哑铃单腿提踵', 杠铃推举: '哑铃推肩', 器械推肩: '哑铃推肩', 绳索侧平举: '侧平举', 蝴蝶机反向飞鸟: '俯身飞鸟', 面拉: '俯身飞鸟',
  直杆绳索下压: '哑铃臂屈伸', 绳索臂屈伸: '哑铃臂屈伸', 仰卧杠铃臂屈伸: '哑铃臂屈伸', 杠铃弯举: '哑铃弯举', 牧师凳弯举: '上斜哑铃弯举', 悬垂举腿: '死虫' };
const TPL_BW = [  // [new, some, adv]
  [/^(杠铃卧推|哑铃卧推|上斜哑铃卧推|上斜杠铃卧推|器械推胸)$/, ['俯卧撑', '下斜俯卧撑', '俯卧撑（负重）']], [/^(哑铃飞鸟|绳索夹胸|蝴蝶机夹胸)$/, null], [/^(直杆绳索下压|绳索臂屈伸|仰卧杠铃臂屈伸|哑铃臂屈伸)$/, ['窄距俯卧撑', '窄距俯卧撑', '双杠臂屈伸']],
  [/下拉|引体/, ['椅间屈膝反向划船', '引体向上', '引体向上']], [/划船/, ['椅间屈膝反向划船', '椅间屈膝反向划船', '椅间屈膝反向划船']], [/弯举/, null],
  [/^(杠铃深蹲|哈克深蹲|器械倒蹬|哑铃酒杯深蹲)$/, ['自重深蹲', '原地箭步蹲', '单腿深蹲']], [/保加利亚|箭步|腿屈伸/, ['原地箭步蹲', '原地箭步蹲', '原地箭步蹲']],
  [/硬拉/, ['臀桥', '单腿臀桥', '单腿臀桥']], [/腿弯举/, ['毛巾腿弯举', '毛巾腿弯举', '毛巾腿弯举']], [/臀推/, ['臀桥', '单腿臀桥', '单腿臀桥']], [/提踵/, ['站姿自重提踵', '站姿自重提踵', '站姿自重提踵']],
  [/推肩|推举/, ['派克俯卧撑', '派克俯卧撑', '靠墙倒立撑']], [/侧平举|前平举/, null], [/面拉|反向飞鸟/, ['俯身飞鸟', '俯身飞鸟', '俯身飞鸟']],
];
const TPL_SCHED = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };
const tplLevel = () => (S.profile?.level === 'new' ? 'new' : S.profile?.level === 'adv' ? 'adv' : 'some');
// A template as plan days for this person: the level's set counts, the place's exercises, cues, loads from history.
function tplBuild(tp, days, place) {
  const lv = tplLevel(), isNew = lv === 'new';
  return tp.d.map(([id, name, rows]) => {
    const seen = new Set(), out = [];
    for (const [n0, a, b, reps, rest, cue0] of rows) {
      const sets = isNew ? a : b; if (!sets) continue;
      let name = n0, r = reps;
      if (place === 'home') name = TPL_HOME[n0] || n0;
      else if (place === 'bodyweight') {
        const hit = TPL_BW.find(([re]) => re.test(n0));
        if (hit) { if (!hit[1]) continue; name = hit[1][lv === 'new' ? 0 : lv === 'adv' ? 2 : 1]; if (!/秒/.test(reps)) r = '10–20'; }
      }
      if (seen.has(name)) continue; seen.add(name);
      const x = { name, sets, reps: r, rest: `${rest}s` };
      const cue = cue0 || TPL_CUE[name] || TPL_CUE[n0] || EX_LIB_BY.get(name)?.how; if (cue) x.cue = cue;
      const load = tplLoad(name); if (load) x.load = load;
      out.push(x);
    }
    // 全身 1 / 全身 2 would both be called 全身: the short name keeps the number (全身1), 推 1 → 推1
    const m = /^(\S+)(?:\s+(\d))?/.exec(name), short = m && m[2] ? `${m[1]}${m[2]}` : '';
    return { id, name, ...(short && short !== dayShort({ name }) ? { short: [...short].slice(0, 4).join('') } : {}), exercises: out };
  });
}
// A template exercise's load: last time's working weight, else RPE 7 (a beginner) / RPE 7–8; 自重 / 辅助 / nothing for timed.
function tplLoad(name) {
  const kind = guessKind(name); if (kind === 'cardio' || kind === 'sec') return '';
  const h = exHistory(name, today()), wk = h.last ? workOf(h.last.sets) : null, first = wk && !wk.timed ? wk.sets[0] : null;
  const was = first ? planLoadOf(first) : '';
  if (was) return was;
  return kind === 'bw' ? '自重' : kind === 'assist' ? '辅助' : tplLevel() === 'new' ? 'RPE 7' : 'RPE 7–8';
}
const tplSchedule = (n, ids) => { const wds = TPL_SCHED[n] || TPL_SCHED[3], out = {}; wds.forEach((wd, i) => { out[String(wd)] = ids[i % ids.length]; }); return out; };
// The cards for n days a week, the recommended one for this level first.
function tplCards(n) {
  const lv = tplLevel(), xs = TPL.filter(t => t.days.includes(n));
  return xs.map(t => ({ ...t, rec: t.rec?.[lv] === n })).sort((a, z) => (z.rec ? 1 : 0) - (a.rec ? 1 : 0));
}
function openPlanTpl(o = {}) {
  if (!S.db || !S.loaded.has('plan')) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const p = S.profile || {}, days = [2, 3, 4, 5, 6].includes(p.days) ? p.days : 3, place = PLACES.some(([k]) => k === p.place) ? p.place : 'gym';
  const keep = true;  // Claude 只给建议，不改我的训练日: on for everyone (people plan for themselves; Claude assists)
  // from: the tab it was opened on (今日's 「今天」, the guide, or the 训练 tab), where 就练这套 goes back to (#L6)
  S.sheet = { type: 'plan-tpl', from: S.tab, tp: { days, place, open: '', built: null, keep, swap: !!o.swap && !!S.plan }, photos: [], removed: [] };
  const cards = tplCards(days); S.sheet.tp.open = cards[0]?.id || '';
  tplRebuild();
  showSheet(S.sheet.tp.swap ? '换一套训练日' : '自己搭一套', '<div id="tp-body" class="tp-body"></div>',
    `<div class="tp-foot"><label class="tgl tp-keep"><span>Claude 只给建议，不改我的训练日<small>它补饮食目标、给建议、出提案；关掉的话，它第一次做计划时可以调动作和组数（结构不变）</small></span><input type="checkbox" class="sw" id="tp-keep"${keep ? ' checked' : ''}></label><button type="button" class="btn primary main" data-act="tp-go" id="tp-go">就练这套</button></div>`);
  drawTpl();
}
// 换一套 on the plan page: a word first.
function openPlanSwap() {
  if (!S.plan) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'plan-swap', photos: [], removed: [] };
  showSheet('换掉现在的训练日？', '<div class="panel panel-pad stack"><p>饮食目标不变，旧的训练日会存一份到计划历史（Claude 看得到）。每周安排、轮换按新的一套来；你改过的地方只留在历史里。</p></div>',
    '<button type="button" class="btn ghost" data-act="close">先不换</button><button type="button" class="btn primary main" data-act="plan-tpl" data-close="1">换</button>');
}
function tplRebuild() {
  const sh = S.sheet, tp = sh?.tp; if (!tp) return;
  const cards = tplCards(tp.days);
  if (!cards.some(c => c.id === tp.open)) tp.open = cards[0]?.id || '';
  const t = TPL.find(x => x.id === tp.open);
  tp.built = t ? tplBuild(t, tp.days, tp.place) : null;
}
function drawTpl() {
  const sh = S.sheet, tp = sh?.tp, el = $('#tp-body', sheetEl); if (!el || !tp) return;
  const isNew = tplLevel() === 'new', cards = tplCards(tp.days);
  const chips = (act, opts, cur) => opts.map(([v, l]) => `<button type="button" class="chip" data-act="${act}" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('');
  const head = `<div class="tp-pick"><span>每周练</span><span class="chips">${chips('tp-days', [2, 3, 4, 5, 6].map(n => [n, String(n)]), tp.days)}</span><span>天 · 在</span><span class="chips">${chips('tp-place', PLACES.map(([k, l]) => [k, k === 'home' ? '家里' : l]), tp.place)}</span></div>`;
  const list = cards.map(c => {
    const open = c.id === tp.open, built = open ? tp.built || [] : null;
    const shorts = c.d.map(([, nm]) => { const m = /^(\S+)(?:\s+(\d))?/.exec(nm); return m ? `${m[1]}${m[2] || ''}` : nm; }).join(' · ');
    const body = !open ? '' : `<div class="tp-days">${built.map((d, di) => `<div class="tp-day"><div class="tp-dh"><span class="dayid">${esc(dayShort(d))}</span><b>${esc(d.name)}</b><small>${d.exercises.length} 个动作</small></div>
      <ul class="tp-exs">${d.exercises.map((x, i) => {
        const info = EX_LIB_BY.get(x.name), part = exPart(x.name), h = exHistory(x.name, today()), wk = h.last ? workOf(h.last.sets) : null;
        const last = wk ? `上次 ${wk.timed ? `${wk.sets[0].sec} 秒` : loadTxt(wk.sets[0]) || `${wk.sets[0].reps} 次`}` : '';
        return `<li class="tp-ex"><div class="tp-exm"><b>${esc(x.name)}</b><span class="tp-exs-t">${part !== '其他' ? `${esc(part)} · ` : ''}${esc(humanTarget(`${x.sets}×${x.reps}`))}${x.load && !/^RPE/.test(x.load) ? ` · ${esc(spaced(x.load))}` : ''}</span>${info?.how ? `<small class="tp-how">${esc(info.how)}${isNew && /^RPE/.test(x.load || '') ? '<i>选一个能做 10 次、还能再做 2 次的重量</i>' : ''}</small>` : ''}${last ? `<small class="tp-last">${esc(last)}</small>` : ''}</div><button type="button" class="link tp-sw" data-act="tp-swap" data-d="${di}" data-i="${i}" aria-label="换一个${esc(part !== '其他' ? part : '')}动作">换一个</button></li>`;
      }).join('')}</ul></div>`).join('')}</div>`;
    return `<div class="panel tp-card${open ? ' open' : ''}"><button type="button" class="tp-h" data-act="tp-open" data-id="${esc(c.id)}" aria-expanded="${open}"><span class="tp-ht"><b>${esc(c.name)}${c.sub ? `<small class="tag tmp">${esc(c.sub)}</small>` : ''}${c.rec ? '<span class="tag good">推荐</span>' : ''}</b><span class="tp-who">${esc(c.who)}</span><span class="tp-sh">${esc(shorts)}</span></span>${CHEV_R}</button>${body}</div>`;
  }).join('');
  el.innerHTML = `${head}${list || '<p class="hint">这个天数还没有模版，选 2–6 天。</p>'}<p class="hint" style="margin:0">${isNew ? '新手版：复合动作 3 组、小动作 2 组，8–12 次；' : '有基础版：主项 4 组、小动作 3 组；'}搭好以后每个动作、组数都能改。</p>`;
}
// 换一个: the next 动作库 exercise of the same part not already in that day (round and round).
function tplSwap(di, i) {
  const tp = S.sheet?.tp, d = tp?.built?.[di], x = d?.exercises?.[i]; if (!x) return;
  const part = exPart(x.name), lib = (EX_LIB.find(([p]) => p === part) || [])[1] || [];
  const ok = lib.filter(e => tp.place !== 'bodyweight' || e.k === 'bw' || e.k === 'sec').filter(e => tp.place !== 'home' || !/杠铃|器械|绳索|蝴蝶机|龙门|倒蹬|哈克|腿屈伸|腿弯举|下拉|引体|提踵机|史密斯|牧师凳|面拉/.test(e.n) || /哑铃|自重|毛巾/.test(e.n));
  const pool = ok.length ? ok : lib; if (!pool.length) { toast('这个部位没有别的动作可换', true); return; }
  const here = new Set(d.exercises.map(e => e.name)), k = pool.findIndex(e => e.n === x.name);
  for (let s = 1; s <= pool.length; s++) {
    const e = pool[(k + s) % pool.length]; if (here.has(e.n)) continue;
    const kind = e.k, nx = { ...x, name: e.n };
    const cue = TPL_CUE[e.n] || e.how; if (cue) nx.cue = cue; else delete nx.cue;
    const load = tplLoad(e.n); if (load) nx.load = load; else delete nx.load;
    if (kind === 'sec' && !/秒/.test(nx.reps)) nx.reps = '45–60 秒'; else if (kind !== 'sec' && /秒/.test(nx.reps)) nx.reps = '10–15';
    d.exercises[i] = nx; drawTpl(); return;
  }
  toast('这个部位的动作都在这一天里了', true);
}
const tplGuideKey = () => 'lsj-tpl-guide:' + (S.me?.id || '');
// The guide card on top of 训练日 after a template was taken, until × (what to change, when the diet targets come).
function tplGuideHTML() {
  const tp = S.plan?.template; if (!tp || typeof tp !== 'object' || !tp.at) return '';
  const off = lsGet(tplGuideKey()); if (off === 'off' || Date.now() - (Date.parse(tp.at) || 0) > 14 * 864e5) return '';
  const t = today(), pd = plannedDay(t), noDiet = !isNum(S.plan?.diet?.kcal);
  return `<div class="panel tp-guide"><div class="tp-gh"><b>这是你从模版搭的「${esc(String(tp.name || ''))}」</b><button type="button" class="icon-btn sm" data-act="tpl-guide-off" aria-label="收起">×</button></div>
    <ul><li>点一天进去看动作、按它开练，「编辑」改动作、组数、重量和顺序；「本周」的「编辑」改哪天练。</li>${noDiet ? `<li>饮食目标先按临时目标吃，Claude 下次处理时会补上正式的。</li>` : ''}<li>${pd ? `今天练 <b>${esc(pd.name || dayShort(pd))}</b>，到「今日」开练。` : '今天是休息日，到「今日」的训练卡能换成练哪天。'}</li></ul></div>`;
}
// 就练这套: the plan written (B3). Without a plan: plan/current {version 1, phase, training, diet: {}, template}; the
// switch on → custom marks every training path as the person's. Over a plan: the old one to plan_history, then only
// the training part replaced (diet untouched, version the same, custom's training.* entries renewed).
async function savePlanTpl(btn) {
  const sh = S.sheet, tp = sh?.tp; if (!tp || !tp.built || !S.db || btn.disabled) return;
  const t = TPL.find(x => x.id === tp.open); if (!t) return;
  const days = tp.built.filter(d => d.exercises.length); if (!days.length) { toast('这套在这里没有能练的动作，换个地方或模版', true); return; }
  const keep = checked('tp-keep'), ids = days.map(d => d.id), now = nowIso(), td = today();
  const nameTxt = `${t.name}${tp.place === 'home' ? '（家里）' : tp.place === 'bodyweight' ? '（徒手）' : ''}`;
  const training = { note: '自己从模版搭的，动作、组数都可以改；Claude 会按你的记录提建议', schedule: tplSchedule(tp.days, ids), rotation: ids, days };
  const phaseInfo = { name: '第 1 阶段', start: td, end: addDays(td, 27) }, phase = `自己搭的 · 第 1 阶段（${md(td)}–${md(addDays(td, 27))}）`;
  const template = { name: nameTxt, at: now, keep };
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const ref = S.db.collection('plan').doc('current');
    if (!S.plan) {
      const doc = { version: 1, updatedAt: now, phase, phaseInfo, summary: `${nameTxt}，每周 ${tp.days} 天，自己搭的。Claude 下次处理时补上饮食目标，之后只给建议和提案，不动训练日。`, training, diet: {}, template };
      if (keep) doc.custom = Object.fromEntries([...ids.map(id => `training.days.${id}`), 'training.schedule', 'training.rotation'].map(p => [p, { at: now, was: null }]));
      await retry1(() => ref.set(doc, { ifVersion: 0 }));
      // today should be a training day: the first one, unless the week already has it
      if (!tplSchedule(tp.days, ids)[String(isoWd(td))] && !S.workouts.some(w => w.date === td)) { try { await retry1(() => S.db.collection('days').doc(td).set({ date: td, plan: ids[0], updatedAt: now })); } catch (e) {} }
    } else {
      const cur = S.db.cached('plan', 'current') || await retry1(() => ref.get());
      if (cur.exists) {
        const old = cur.data, hid = `${td}-v${old.version ?? cur.version}-page`;
        try { await retry1(() => S.db.collection('plan_history').doc(hid).set(old, { ifVersion: 0 })); }
        catch (e) { if (e?.code !== 'conflict') throw e; await retry1(() => S.db.collection('plan_history').doc(`${hid}-${now.slice(11, 19).replace(/:/g, '')}`).set(old, { ifVersion: 0 })); }
      }
      await editPlan(plan => {
        const was = { days: Array.isArray(plan.training?.days) ? plan.training.days : [], schedule: plan.training?.schedule ?? null, rotation: plan.training?.rotation ?? null };
        plan.training = training; plan.phase = phase; plan.phaseInfo = phaseInfo; plan.template = template;
        const c = plan.custom && typeof plan.custom === 'object' ? plan.custom : {};
        for (const k of Object.keys(c)) if (k.startsWith('training.')) delete c[k];
        if (keep) {
          for (const id of ids) c[`training.days.${id}`] = { at: now, was: clone(was.days.find(d => d?.id === id)) ?? null };
          c['training.schedule'] = { at: now, was: clone(was.schedule) }; c['training.rotation'] = { at: now, was: clone(was.rotation) };
        }
        if (Object.keys(c).length) plan.custom = c; else delete plan.custom;
      });
    }
    lsSet(tplGuideKey(), null);
    sh.saved = true; closeSheet(true);
    // today a training day (a new plan makes it one): 开练 on 「今天」; else when the next one is
    const k = dayKind(td), nx = isPlanDay(k) && !S.workouts.some(w => w.date === td) ? null : nextTrainAfter(td);
    toast(!nx ? '计划搭好了，今天就能练' : `计划搭好了，下次练是${dayName(nx.d)}的${dayShort(nx.pd)}`);
    if (sh.from === 'plan') { if (S.tab !== 'plan') setTab('plan'); setTimeout(() => { const el = document.getElementById('sec-days'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - ($('.top')?.offsetHeight || 0) - 8); }, 150); }
    else { S.date = td; if (S.tab !== 'today') setTab('today'); else render(); window.scrollTo(0, 0); }
  } catch (e) { btn.disabled = false; btn.textContent = '就练这套'; toast(e?.code === 'conflict' ? '计划刚在别处改过，关掉重新打开再试' : errMsg(e), true); }
}

// 每周安排: each weekday rest or a plan day; 按顺序轮换 with its order.
// With a rotation on, a weekday is only 练 or 休 (which day comes from the rotation, #21); off: rest or a plan day.
function openSchedule() {
  if (!S.plan) return;
  const days = planDays(), sch = S.plan.training?.schedule || {}, rot = rotation().filter(isPlanDay);
  S.sheet = { type: 'schedule', items: rot.length ? [...rot] : days.map(d => d.id), photos: [], removed: [] };
  const opts = [['', '休'], ...days.map(d => [d.id, esc(dayShort(d))])];
  const row = (i, inner) => `<div class="wk-row"><span class="wk-d">周${WD[i % 7]}</span>${inner}</div>`;
  showSheet('每周安排', `
    <fieldset><legend>轮换</legend>${tgl('ro-on', '按顺序轮换', '到了训练日就练上次之后的那一天，错过的不跳过', !!rot.length)}<div id="ro-box" class="fs-in"${rot.length ? '' : ' hidden'}><div id="ro-list"></div></div></fieldset>
    <div class="field" id="wk-on"${rot.length ? '' : ' hidden'}><span class="lbl">每周哪几天练</span><div class="wk-edit">${[1, 2, 3, 4, 5, 6, 7].map(i => row(i, seg('wo' + i, [['', '休'], ['on', '练']], isPlanDay(sch[String(i)]) ? 'on' : '', 'req'))).join('')}</div></div>
    <div class="field" id="wk-ids"${rot.length ? ' hidden' : ''}><span class="lbl">每周哪天练哪天</span><div class="wk-edit">${[1, 2, 3, 4, 5, 6, 7].map(i => { const v = sch[String(i)]; return row(i, seg('wd' + i, opts, isPlanDay(v) ? v : '', 'day-seg req')); }).join('')}</div></div>
    ${customRows(['training.schedule', 'training.rotation'])}`, footer('save-schedule', false));
  drawRot(); formReady('save-schedule');
}
// The rotation switch: carry the weekdays over between 练 / 休 and plan-day letters.
function schedMode(on) {
  $('#ro-box', sheetEl).hidden = !on; $('#wk-on', sheetEl).hidden = !on; $('#wk-ids', sheetEl).hidden = on;
  const set = (g, v) => sheetEl.querySelectorAll(`[data-group="${g}"] button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  let k = 0;
  for (let i = 1; i <= 7; i++) {
    if (on) set('wo' + i, segVal('wd' + i) ? 'on' : '');
    else if (segVal('wo' + i) !== 'on') set('wd' + i, '');
    else if (!segVal('wd' + i)) { const ids = S.sheet.items.length ? S.sheet.items : planDays().map(d => d.id); set('wd' + i, ids[k++ % ids.length] || ''); }
  }
}
function drawRot() {
  const el = $('#ro-list', sheetEl), sh = S.sheet; if (!el || sh?.type !== 'schedule') return;
  const out = planDays().filter(d => !sh.items.includes(d.id));
  el.innerHTML = `${sh.items.map((id, i) => { const d = planDays().find(x => x.id === id); return `<div class="ro-row" data-i="${i}"><span class="dayid">${esc(dayShortOf(id))}</span><span class="ro-n">${esc(d?.name || '')}</span>${mvBtns('ro', i, sh.items.length)}<button type="button" class="icon-btn del" data-act="ro-x" aria-label="不参与轮换">×</button></div>`; }).join('')}
    ${out.length ? `<div class="ro-add"><span class="meta">加进轮换：</span>${out.map(d => `<button type="button" class="chip" data-act="ro-add" data-id="${esc(d.id)}">${esc(d.name || dayShort(d))}</button>`).join('')}</div>` : ''}`;
}
async function saveSchedule(sh, signal) {
  if (!S.db) return;
  const on = checked('ro-on'), rot = on ? sh.items.filter(isPlanDay) : [];
  if (on && !rot.length) throw badInput('轮换里至少要有一天');
  const old = S.plan?.training?.schedule || {}, ns = {};
  let k = 0;
  for (let i = 1; i <= 7; i++) {
    if (!on) { const v = segVal('wd' + i); if (v) ns[String(i)] = v; continue; }
    if (segVal('wo' + i) !== 'on') continue;
    // a training weekday keeps the letter it had (the fallback before there is any history), else the next in turn
    const was = old[String(i)];
    ns[String(i)] = isPlanDay(was) ? was : rot[k % rot.length];
    k++;
  }
  setBusy('保存中…');
  await editPlan(plan => {
    const b = stable(plan.training);
    setPlanVal(plan, 'training.schedule', ns);
    setPlanVal(plan, 'training.rotation', rot.length ? rot : null);
    if (stable(plan.training) === b) return false;
  }, signal);
  await saved(sh, '每周安排已保存');
}

/* ---------- 训记 ---------- */
// GET /api/xunji: {hasKey, keyUpdatedAt, webSync}; {missing: true} when this server doesn't have it.
async function loadXj() {
  try { S.xj = await req('GET', '/api/xunji'); }
  catch (e) { if (e?.code === 'not_found') S.xj = { missing: true }; }
  render();
}
function xjErr(e) {
  if (e?.code === 'rate_limited') return isNum(e.retryAfter) ? `刚同步过，${Math.ceil(e.retryAfter)} 秒后再试` : '刚同步过，过一分钟再试';
  return { xunji_busy: '训记那边限频了，过一会儿再试', xunji_key_invalid: '训记 key 不对或已失效，请在训记 App 里重新申请', not_found: '这个服务器还不支持从训记同步' }[e?.code]
    || (/[一-鿿]/.test(e?.message || '') ? e.message : errMsg(e));
}
// 从训记同步: the server imports the last three days from 训记, then the page reloads.
async function xjSync() {
  if (S.xjBusy || !S.db) return;
  S.xjBusy = true; render();
  const before = prKeys();  // the records so far: the toast names only the ones this sync brought
  try {
    const r = await req('POST', '/api/xunji/sync', {}, { timeout: 45000 });
    const n = (r.new || []).length, u = (r.updated || []).length;
    const msg = n ? vt('toast.syncNew', '导入 {n} 条新训练', { n }) + (u ? `，更新 ${u} 条` : '') : u ? vt('toast.syncUpd', '更新了 {n} 条训练', { n: u }) : vt('toast.syncNone', '训记里没有新的训练');
    if (n || u) await S.db.sync(true); else S.db.sync(true);
    const fresh = n || u ? newPrs(before) : [];
    if (fresh.length) {
      const x = fresh[0];
      toast(`${msg} · ${LV()?.on() ? vt('toast.pr', '新纪录') + '：' : '新纪录：'}${x.name} ${x.text}${fresh.length > 1 ? ` 等 ${fresh.length} 项` : ''}`, false, () => { if (!S.sheet) openWorkout(x.id); }, '看看');
    } else toast(msg);
  } catch (e) { toast(xjErr(e), true); }
  S.xjBusy = false; render(); loadXj();
}
// The two 训记 keys: kind 'train' (reads sessions) or 'template' (writes the 「Agent 模版」 folder).
const XJ_KEYS = { train: ['训练 key', '粘贴训记的训练 key', '在训记 App 里申请训练的 key。保存时会用它读一次训记今天的记录，确认能用。'],
  template: ['模版 key', '粘贴训记的 Agent 模版 key', '在训记 App 里申请 Agent 模版的 key。它只能改训记里的「Agent 模版」文件夹，你在「Claude」页同意提案时才会用。'] };
function openXjKey(kind = 'train') {
  if (!XJ_KEYS[kind]) kind = 'train';
  const [name, lbl, hint] = XJ_KEYS[kind];
  S.sheet = { type: 'xj-key', kind, photos: [], removed: [], saveAct: 'save-xjkey' };
  showSheet(name, `<div class="field"><label for="f-xk">${lbl}</label><input type="text" id="f-xk" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="8–200 位，不含空格"></div>
    <p class="hint" style="margin:0">${hint}保存后页面上不会再显示它。</p>`,
    '<button type="button" class="btn primary main" data-act="save-xjkey" id="save-btn">保存</button>');
}
async function saveXjKey(sh, signal) {
  const key = fval('f-xk').replace(/\s+/g, '');
  if (key.length < 8 || key.length > 200) throw badInput('key 应该是 8–200 位', 'f-xk');
  setBusy('验证中…');
  let r;
  try { r = await req('PUT', '/api/xunji/key', { key, kind: sh.kind || 'train' }, { signal, timeout: 30000 }); }
  catch (e) { throw ['unauthenticated', 'aborted', 'timeout', 'unavailable'].includes(e?.code) ? e : { code: 'xunji', message: xjErr(e) }; }
  sh.saved = true; closeSheet(true);
  toast(r?.verified === false ? (r.message || 'key 已保存，但现在连不上训记，没能验证') : sh.kind === 'template' ? '模版 key 已保存，Claude 准备好的模版点同意就能写进训记' : 'key 已保存，可以从训记同步了');
  loadXj();
}
async function delXjKey(btn, kind = 'train') {
  if (!confirmTap(btn, `确认删除${kind === 'template' ? '模版' : '训练'} key`, '删除')) return;
  btn.disabled = true;
  try { await req('DELETE', `/api/xunji/key?kind=${encodeURIComponent(kind)}`); toast(`${kind === 'template' ? '模版' : '训练'} key 删掉了`); } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
  loadXj();
}

// 「删除保存的训记 key」 (只用薄肌研究所): both kinds, after a second tap.
async function delXjKeys(btn) {
  if (!confirmTap(btn, '确认删除训记 key', '删除保存的训记 key')) return;
  btn.disabled = true;
  try {
    for (const kind of ['train', 'template']) await req('DELETE', `/api/xunji/key?kind=${kind}`);
    toast('训记 key 删掉了，服务器上不再保存');
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
  loadXj();
}
// 训练记在哪, from a button (「重新用训记」): merged into profile/prefs.
async function setTrainIn(v, btn) {
  if (!TRAIN_IN.some(([k]) => k === v) || !S.db) return;
  if (btn) btn.disabled = true;
  try { await patchPrefs({ trainIn: v }); toast(v === 'app' ? '训练只在这里记' : v === 'both' ? '训记重新打开了：开始训练和从训记同步都能用' : '训练记在训记'); loadXj(); }
  catch (e) { if (btn) btn.disabled = false; toast(errMsg(e), true); }
  render();
}

/* 训记 → plan days (meta/xunji.dayMap {训记 title: plan day id}). Saved as a merge on the latest version, then the
   server re-maps the 训记 sessions already imported (POST /api/xunji/remap). */
function dmOpts(cur) {
  return [...planDays().map(d => [d.id, `${esc(dayShort(d))}<small>${esc(d.name || '')}</small>`]), ['', '不对应<small>不算计划里的哪天</small>']]
    .map(([v, l]) => `<button type="button" data-act="seg" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur ?? '')}">${l}</button>`).join('');
}
// One 训记 title: which plan day it counts as.
function editDayMap(title) {
  if (typeof title !== 'string' || !title) { openDayMapAll(); return; }
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const t = xjTitles().find(x => x.title === title) || { title, n: 0, id: S.xunji?.dayMap?.[title] ?? null };
  S.sheet = { type: 'daymap', title, photos: [], removed: [] };
  showSheet('训记的训练对应哪天', `<div class="panel panel-pad"><b>${esc(title)}</b><p class="meta" style="margin:2px 0 0">${t.n ? `练过 ${t.n} 次，最近 ${esc(md(t.last))}` : '还没有这个标题的训练'}</p></div>
    <div class="field"><span class="lbl">对应计划里的</span><div class="seg col req" data-group="dm" role="group">${dmOpts(isPlanDay(t.id) ? t.id : '')}</div></div>
    <p class="hint" style="margin:0">保存后，已经导入的这个标题的训练会重新对应，点评不受影响。在某次训练里单独选过的不变。</p>`, footer('save-daymap', false));
  formReady('save-daymap');
}
// A plan day: which 训记 titles count as it (tap to add or remove), or a title typed in.
function openDayMapDay(id) {
  const day = planDays().find(d => d.id === id); if (!day) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const ts = xjTitles().filter(x => x.id === id || x.recent || x.n);
  S.sheet = { type: 'daymap-day', dayId: id, photos: [], removed: [] };
  const dn = day.name || dayShort(day);
  showSheet(`${dn} · 训记`, `<p class="meta" style="margin:0">训记里哪些训练算「${esc(dn)}」？可以选几个。</p>
    ${ts.length ? `<div class="chips dm-chips" data-group="dmt">${ts.map(x => `<button type="button" class="chip" data-act="chip" data-v="${esc(x.title)}" aria-pressed="${x.id === id}">${esc(x.title)}${x.id && x.id !== id ? `<small>现在是${esc(dayShortOf(x.id))}</small>` : ''}</button>`).join('')}</div>` : '<p class="hint" style="margin:0">最近 60 天没有从训记导入的训练。</p>'}
    <div class="field"><label for="dm-new">或者手填训记里的标题</label><input type="text" id="dm-new" maxlength="60" autocomplete="off" placeholder="和训记里的训练标题一字不差"></div>
    <p class="hint" style="margin:0">保存后，已经导入的这些训练会重新对应到「${esc(dn)}」，点评不受影响。</p>`, footer('save-daymap-day', false));
  formReady('save-daymap-day');
}
// Every title at once.
function openDayMapAll() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  const ts = xjTitles().filter(x => x.id || x.recent);
  S.sheet = { type: 'daymap-all', titles: ts.map(x => x.title), photos: [], removed: [] };
  showSheet('训记的训练对应哪天', ts.length ? `<div class="panel dm-all">${ts.map((x, i) => `<label class="dm-sel"><span>${esc(x.title)}${x.n ? `<small>${x.n} 次 · 最近 ${esc(md(x.last))}</small>` : ''}</span><select id="dm-${i}">${[...planDays().map(d => [d.id, d.name || dayShort(d)]), ['', '不对应']].map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(isPlanDay(x.id) ? x.id : '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`).join('')}</div>` : '<p class="hint" style="margin:0">还没有从训记导入的训练。</p>',
    footer('save-daymap-all', false));
  formReady('save-daymap-all');
}
// changes: {title: plan day id | null}. Writes meta/xunji on its latest version, then asks the server to re-map.
async function writeDayMap(changes, signal) {
  const keys = Object.keys(changes); if (!keys.length || !S.db) return null;
  const patch = Object.fromEntries(keys.map(k => [k, changes[k] ? changes[k] : { __delete__: true }]));
  try { await patchDoc('meta', 'xunji', () => ({ dayMap: patch }), signal); }
  catch (e) {
    if (e?.code !== 'not_found') throw e;
    const add = Object.fromEntries(keys.filter(k => changes[k]).map(k => [k, changes[k]]));
    await retry1(() => S.db.collection('meta').doc('xunji').set({ dayMap: add }, { ifVersion: 0, signal }));
  }
  try { const r = await req('POST', '/api/xunji/remap', {}, { signal, timeout: 30000 }); S.db.sync(true); return Array.isArray(r?.remapped) ? r.remapped.length : 0; }
  catch (e) { if (e?.code === 'not_found' || e?.status === 404) return null; throw e; }
}
function dayMapToast(n, id) {
  if (n == null) toast('已保存，下次同步时生效');
  else if (!n) toast('已保存');
  else toast(id === undefined ? `已重新对应 ${n} 次训练` : id ? `已把 ${n} 次训练对应到「${dayShortOf(id)}」` : `已保存，${n} 次训练不再算计划里的哪天`);
}
async function saveDayMap(sh, signal) {
  const v = segVal('dm') ?? '', cur = S.xunji?.dayMap?.[sh.title] ?? '';
  if (v === cur) { await saved(sh); return; }
  setBusy('保存中…');
  const n = await writeDayMap({ [sh.title]: v || null }, signal);
  await saved(sh); dayMapToast(n, v);
}
async function saveDayMapDay(sh, signal) {
  const map = S.xunji?.dayMap || {}, on = new Set(chipVals('dmt')), typed = fval('dm-new');
  if (typed) on.add(typed);
  const ch = {};
  for (const t of on) if (map[t] !== sh.dayId) ch[t] = sh.dayId;
  for (const [t, id] of Object.entries(map)) if (id === sh.dayId && !on.has(t)) ch[t] = null;
  if (!Object.keys(ch).length) { await saved(sh); return; }
  setBusy('保存中…');
  const n = await writeDayMap(ch, signal);
  await saved(sh); dayMapToast(n, sh.dayId);
}
async function saveDayMapAll(sh, signal) {
  const map = S.xunji?.dayMap || {}, ch = {};
  sh.titles.forEach((t, i) => { const v = fval('dm-' + i); if ((map[t] ?? '') !== v) ch[t] = v || null; });
  if (!Object.keys(ch).length) { await saved(sh); return; }
  setBusy('保存中…');
  const n = await writeDayMap(ch, signal);
  await saved(sh); dayMapToast(n, undefined);
}

/* ---------- 通知 (Web Push) ----------
   The page registers /sw.js. 开启通知 asks for permission inside the tap, subscribes this device with the server's VAPID
   key (GET /api/push/key) and hands the subscription to the server. The pushes are empty: sw.js asks /api/push/next
   what to show. Each time the page opens with a subscription it is handed over again (a new server key: subscribed
   again first). Which kinds come: profile/prefs.push. iOS: only from the home-screen icon (16.4+). */
const PUSH_KINDS = [['report', '日报写好了', 'Claude 处理完、日报写好时'], ['proposal', '有提案等你拍板', '计划改动、训记模版要你同意时'],
  ['reply', '回复了你的留言', '你交代的事有回音时'], ['remind', '提醒', '该称体重、该拍身材照这类']];
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64u(str) {
  const t = String(str).replace(/-/g, '+').replace(/_/g, '/'), b = atob(t + '='.repeat((4 - t.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const pushApi = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
// 'ios-tab' (iPhone in Safari: add to the home screen first) · 'no' · 'checking' · 'denied' · 'off' · 'on'
function pushState() {
  const P = S.push;
  if (isIOS() && !standalone() && !pushApi()) return 'ios-tab';
  if (!pushApi() || P.regErr) return 'no';
  if (!P.ready) return 'checking';
  if (Notification.permission === 'denied') return 'denied';
  return P.sub && Notification.permission === 'granted' ? 'on' : 'off';
}
async function pushInit() {
  const P = S.push; if (P.init) return; P.init = true;
  if (!('serviceWorker' in navigator)) { render(); return; }
  // a tap on a notification: sw.js focuses this window and says where to go
  navigator.serviceWorker.addEventListener('message', e => { const m = e.data; if (m && m.type === 'lsj-open') openFromPush(m.url); });
  try { navigator.serviceWorker.startMessages?.(); } catch (e) {}
  try { P.reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
  catch (e) { P.regErr = true; P.ready = true; render(); return; }
  if (!pushApi() || !P.reg.pushManager) { P.ready = true; render(); return; }
  await pushRefresh(true);
}
// The browser's push service may not answer at all (no connection to it): give up after ms.
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'push_timeout' }), ms))]);
const keyOf = sub => { try { const k = sub?.options?.applicationServerKey; return k ? b64u(k) : null; } catch (e) { return null; } };
async function pushRefresh(resend) {
  const P = S.push;
  try { P.sub = await P.reg.pushManager.getSubscription(); } catch (e) { P.sub = null; }
  try { const k = await req('GET', '/api/push/key'); P.key = k.key; P.subs = k.subs; } catch (e) {}
  if (resend && P.sub && P.key && Notification.permission === 'granted') {
    try {
      const own = keyOf(P.sub);
      if (own && own !== P.key) {  // the server has a new key: this subscription is worth nothing to it
        const old = P.sub.endpoint;
        await P.sub.unsubscribe().catch(() => {});
        req('DELETE', '/api/push/subscribe', { endpoint: old }).catch(() => {});
        const reg = await within(navigator.serviceWorker.ready, 10000);
        P.sub = await within(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(P.key) }), 20000);
      }
      const r = await req('POST', '/api/push/subscribe', P.sub.toJSON()); P.subs = r.subs;
    } catch (e) {}
  }
  P.ready = true; render();
}
function pushErr(e) {
  const n = e?.name;
  if (n === 'NotAllowedError') return '通知被拒绝了：要在系统设置里允许薄肌研究所发通知';
  if (n === 'AbortError' || n === 'NotSupportedError') return '这个浏览器连不上推送服务，换 Safari（从主屏幕打开）或 Chrome 试试';
  if (n === 'InvalidStateError') return '通知服务还没准备好，刷新页面后再点一次';
  if (e?.code === 'push_timeout') return '推送服务一直没回应，检查网络后再点一次';
  if (e?.code === 'unknown_push_service') return '这个浏览器的推送服务不在名单里，换 Safari 或 Chrome 试试';
  return errMsg(e);
}
// 开启通知: Notification.requestPermission() first, straight from the tap (iOS wants that), then subscribe and tell the server.
async function pushEnable() {
  const P = S.push; if (P.busy) return;
  if (!pushApi() || !P.reg) { toast('这台设备收不了通知', true); return; }
  P.busy = true; render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast(perm === 'denied' ? '通知被拒绝了：要在系统设置里允许薄肌研究所发通知' : '没有允许通知，想开的时候再点一次', true); return; }
    if (!P.key) { const k = await req('GET', '/api/push/key'); P.key = k.key; }
    const reg = await within(navigator.serviceWorker.ready, 10000);
    let sub = await reg.pushManager.getSubscription();
    if (sub && keyOf(sub) && keyOf(sub) !== P.key) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await within(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(P.key) }), 20000);
    const r = await req('POST', '/api/push/subscribe', sub.toJSON());
    P.sub = sub; P.subs = r.subs;
    toast('通知开好了，点「发一条试试」看看');
  } catch (e) { toast(pushErr(e), true); }
  finally { P.busy = false; render(); }
}
async function pushTest(btn) {
  if (btn.disabled) return; btn.disabled = true;
  try {
    const r = await req('POST', '/api/push/test', {});
    if (!r.subs) toast('这个账号还没有开通知的设备', true);
    else if (r.sent) toast(`发出去了${r.subs > 1 ? `（${r.sent}/${r.subs} 台设备）` : ''}，几秒内会收到`);
    else toast('推送服务没接这条，过一会儿再试', true);
  } catch (e) { toast(e?.code === 'rate_limited' ? '一分钟内发得太多了，过一会儿再试' : errMsg(e), true); }
  btn.disabled = false;
}
// 关闭: this device only (the server forgets it, the browser drops the subscription).
async function pushOff(btn) {
  const P = S.push, sub = P.sub; if (!sub || btn.disabled) return;
  btn.disabled = true;
  try {
    const r = await req('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
    P.sub = null; P.subs = r.subs;
    toast('这台设备不再收通知');
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
  render();
}
// The four kinds, switched on the 我的 page: merged into profile/prefs.push at once.
const pushLocal = {};
const pushKindOn = k => k in pushLocal ? pushLocal[k] : pushOn(k);
async function setPushKind(k, on) {
  if (!S.db || !PUSH_KINDS.some(([x]) => x === k)) return;
  pushLocal[k] = on; render();
  try { await mergeDoc('profile', 'prefs', { push: { [k]: on }, updatedAt: nowIso() }); }
  catch (e) { toast(errMsg(e), true); }
  delete pushLocal[k]; render();
}
// Where a tapped notification points: a tab of this page (/#claude), a session (/#workout=<id>) or an exercise
// (/#ex=<名字>), or another page of the site.
function openFromPush(url) {
  try {
    const u = new URL(url || '/', location.origin); if (u.origin !== location.origin) return;
    if (u.pathname !== '/' && u.pathname !== '/index.html') { location.href = u.pathname + u.search + u.hash; return; }
    const dl = deepLink(u.hash); if (dl) { deep = dl; openDeep(); return; }
    const t = u.hash.slice(1); if (TABS.includes(t)) setTab(t);
  } catch (e) {}
}
/* Deep links (B9): #workout=<id> opens that session's details on 今日, #ex=<动作名> the exercise's 动作进步. Kept until
   the data they need is there (draw tries again); a session not among the loaded ones is fetched and its month loaded. */
function deepLink(h) {
  const m = /^#(workout|ex)=(.+)$/.exec(String(h || '')); if (!m) return null;
  let v = m[2]; try { v = decodeURIComponent(v); } catch (e) {}
  return { k: m[1], v: v.trim() };
}
let deep = deepLink(location.hash), deepAsked = '';
function openDeep() {
  if (!deep || !S.me || !S.db || !S.loaded.has('workouts')) return;
  const d = deep;
  if (d.k === 'workout') {
    if (!S.workouts.some(w => w.id === d.v)) {
      if (deepAsked === d.v) return;
      deepAsked = d.v;
      S.db.collection('workouts').doc(d.v).get().then(r => { if (r.exists && isDate(r.data?.date)) S.db.ensure(r.data.date); else { deep = null; toast('没有这次训练了', true); try { history.replaceState(history.state, '', hashOf(S.tab)); } catch (e) {} } }).catch(() => { deep = null; });
      return;
    }
    deep = null;
    if (S.tab !== 'today') setTab('today'); else try { history.replaceState(null, '', '#today'); } catch (e) {}
    if (LIVE.open && LIVE.mode === 'edit') return;
    if (S.sheet) { closeSheet(); if (S.sheet) return; }
    openWorkout(d.v);
  } else if (d.k === 'ex') {
    if (!window.LSJData?.openEx || !['plan', 'profile'].every(k => S.loaded.has(k))) return;
    deep = null;
    if (S.tab !== 'today') setTab('today'); else try { history.replaceState(null, '', '#today'); } catch (e) {}
    openExSheet(d.v);
  }
}
function pushSection() {
  if (!S.me) return '';
  const st = pushState(), P = S.push;
  const tag = { on: ['good', '已开'], off: ['ok', '没开'], denied: ['adjust', '被系统拒绝'], no: ['ok', '这台设备不支持'], 'ios-tab': ['ok', '要先加到主屏幕'], checking: ['ok', '正在检查'] }[st];
  const intro = 'Claude 写好日报、有提案等你拍板、回复了你的留言时，手机上弹一条通知。';
  let body;
  if (st === 'ios-tab') body = `<p>${intro}</p><div class="standalone-note"><p>iPhone 上要从主屏幕打开才能收通知：先在 Safari 里点分享 →「添加到主屏幕」，再从主屏幕打开薄肌研究所，回到这里开启（要 iOS 16.4 以上）。</p></div>`;
  else if (st === 'no') body = `<p class="meta">这个浏览器收不了网页通知。iPhone 要 iOS 16.4 以上、从主屏幕图标打开；电脑上用 Chrome、Edge、Firefox 或 Safari。</p>`;
  else if (st === 'checking') body = '<p class="meta">正在看这台设备能不能收通知…</p>';
  else if (st === 'denied') body = `<p class="meta">${isIOS() ? '到 iPhone 的「设置 → 通知 → 薄肌研究所」打开「允许通知」，' : '在浏览器的网站设置里允许这个网站发通知，'}再回来点「开启通知」。</p><div class="btns"><button type="button" class="btn ghost sm" data-act="push-on"${P.busy ? ' disabled' : ''}>开启通知</button></div>`;
  else if (st === 'off') body = `<p>${intro}</p>${P.subs ? `<p class="meta">这个账号已经有 ${esc(P.subs)} 台设备开着通知。</p>` : ''}<div class="btns"><button type="button" class="btn primary sm" data-act="push-on"${P.busy ? ' disabled' : ''}>${P.busy ? '开启中…' : '开启通知'}</button></div>`;
  else body = `<p class="meta">这台设备会收到通知${P.subs > 1 ? `，这个账号一共 ${esc(P.subs)} 台设备开着` : ''}。</p><div class="btns"><button type="button" class="btn ghost sm" data-act="push-test">发一条试试</button><button type="button" class="btn ghost sm" data-act="push-off">关闭</button></div>`;
  const kinds = st === 'on' || (P.subs > 0 && st !== 'checking') ? `<div class="tgls push-k">${PUSH_KINDS.map(([k, l, sub]) => `<label class="tgl"><span>${esc(l)}<small>${esc(sub)}</small></span><input type="checkbox" class="sw" data-push="${k}"${pushKindOn(k) ? ' checked' : ''}></label>`).join('')}</div>` : '';
  return `<section class="sec me-sec" id="sec-push"><div class="sec-h"><h2>通知</h2><span class="tag ${tag[0]}">${tag[1]}</span></div><div class="panel panel-pad sync">${body}${kinds}</div></section>`;
}

/* ---------- account & users ---------- */
async function refreshMe() { try { S.me = { ...S.me, ...(await req('GET', '/api/me')) }; applyMe(); render(); } catch (e) {} }
async function loadUsers() {
  if (S.me?.role !== 'admin') return;
  try { S.users = (await req('GET', '/api/admin/users')).users; } catch (e) { toast(errMsg(e), true); }
  render();
  loadInvites();
}
function openPassword(forced) {
  if (S.sheet?.type === 'password') return;
  if (S.sheet) closeSheet(true);
  S.sheet = { type: 'password', forced: !!forced, saveAct: 'save-password', photos: [], removed: [] };
  showSheet(forced ? '设置你自己的密码' : '修改密码', `
    ${forced ? '<p class="hint" style="margin:0">你现在用的是管理员给的临时密码，换成只有你知道的密码后就能开始记录。</p>' : ''}
    <form id="pw-form" style="display:flex;flex-direction:column;gap:16px"><input type="text" autocomplete="username" value="${esc(S.me?.username || '')}" hidden>
    <div class="field"><label for="f-cur">${forced ? '临时密码' : '当前密码'}</label><input type="password" id="f-cur" autocomplete="current-password"></div>
    <div class="field"><label for="f-new">新密码</label><input type="password" id="f-new" autocomplete="new-password" placeholder="至少 8 位"></div>
    <div class="field"><label for="f-new2">再输一次新密码</label><input type="password" id="f-new2" autocomplete="new-password"></div></form>
    ${forced ? '' : '<p class="hint" style="margin:0">改完后，其他设备上的登录会失效，要用新密码重新登录。</p>'}`, footer('save-password', false));
  if (forced) $('.sheet-h .icon-btn', sheetEl)?.remove();
}
async function savePassword(sh, signal) {
  const cur = $('#f-cur', sheetEl).value, nw = $('#f-new', sheetEl).value, nw2 = $('#f-new2', sheetEl).value;
  if (nw.length < 8) throw badInput('新密码至少 8 位', 'f-new');
  if (nw !== nw2) throw badInput('两次输入的新密码不一样', 'f-new2');
  setBusy('保存中…');
  try { S.me = { ...S.me, ...(await req('POST', '/api/me/password', { current: cur, new: nw }, { signal })) }; }
  catch (e) { throw e?.code === 'rate_limited' ? { code: 'pw_rate_limited' } : e; }
  closeSheet(true); toast('密码已更新');
  if (!S.db) startData(); else render();
  refreshMe();
}
function openName() {
  S.sheet = { type: 'name', photos: [], removed: [] };
  showSheet('改名字', `<div class="field"><label for="f-name">显示的名字</label><input type="text" id="f-name" maxlength="40" value="${esc(S.me?.name || '')}"></div>`, footer('save-name', false));
  formReady('save-name');
}
async function saveName(sh, signal) {
  const name = fval('f-name'); if (!name) throw badInput('名字不能为空', 'f-name');
  setBusy('保存中…'); S.me = { ...S.me, ...(await req('PATCH', '/api/me', { name }, { signal })) };
  sh.saved = true; closeSheet(true); render(); toast('已更新'); loadUsers();
}
function pwBox(user, pw, fresh) {
  const text = `薄肌研究所 ${location.origin}\n用户名：${user.username}\n临时密码：${pw}`;
  return `<div class="pwbox"><div class="lbl">${fresh ? '账号已创建' : '密码已重置'}，把登录信息发给${esc(user.name)}</div>
    <div class="pw">${esc(pw)}</div>
    <p class="hint" style="margin:0">地址 ${esc(location.origin)} · 用户名 ${esc(user.username)}。对方第一次登录后要改成自己的密码。这个临时密码只显示这一次。</p>
    <button type="button" class="btn ghost sm" data-act="copy" data-v="${esc(text)}">复制登录信息</button></div>`;
}
function openNewUser() {
  S.sheet = { type: 'user-new', saveAct: 'create-user', photos: [], removed: [] };
  showSheet('新建账号', `
    <div class="field"><label for="f-username">用户名</label><input type="text" id="f-username" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="登录用，例如 xiaowang"><p class="hint" style="margin:0">2–32 位小写字母、数字或 _ . -，创建后不能改。</p></div>
    <div class="field"><label for="f-name">显示的名字</label><input type="text" id="f-name" maxlength="40" placeholder="例如 小王"></div>
    <div class="field"><span class="lbl">角色</span>${seg('role', [['member', '成员'], ['admin', '管理员']], 'member')}<p class="hint" style="margin:0">管理员可以新建和管理账号，但同样看不到别人的记录。</p></div>`,
    '<button type="button" class="btn primary main" data-act="create-user" id="save-btn">创建</button>');
}
async function createUser(sh, signal) {
  setBusy('创建中…');
  const r = await req('POST', '/api/admin/users', { username: fval('f-username'), name: fval('f-name'), role: segVal('role') || 'member' }, { signal });
  sh.busy = false;
  $('.sheet-b', sheetEl).innerHTML = pwBox(r.user, r.password, true);
  $('.sheet-f', sheetEl).innerHTML = '<button type="button" class="btn primary main" data-act="close">完成</button>';
  loadUsers();
}
function openUser(id) {
  const u = (S.users || []).find(x => x.id === id); if (!u) return;
  const self = u.id === S.me?.id;
  S.sheet = { type: 'user', id: u.id, user: u, photos: [], removed: [] };
  showSheet(`${u.name} · @${u.username}`, `
    <div class="field"><label for="f-name">显示的名字</label><input type="text" id="f-name" maxlength="40" value="${esc(u.name)}"></div>
    <div class="field"><span class="lbl">角色</span>${self ? '<p class="hint" style="margin:0">不能修改自己的角色。</p>' : seg('role', [['member', '成员'], ['admin', '管理员']], u.role)}</div>
    <p class="hint" style="margin:0">${esc(u.records)} 条饮食和训练记录${u.pending ? `，${esc(u.pending)} 条等 Claude 处理` : ''}。创建于 ${esc(fmtTs(u.createdAt))}${u.lastSeen ? `，最近使用 ${esc(fmtTs(u.lastSeen))}` : ''}。</p>
    <div id="pw-out"></div>
    ${self ? '' : `<div class="acct-actions"><button type="button" class="btn ghost sm" data-act="user-reset">重置密码</button><button type="button" class="btn ghost sm" data-act="user-toggle">${u.disabled ? '启用账号' : '停用账号'}</button><button type="button" class="btn ghost sm danger" data-act="user-del">删除账号</button></div>
    <p class="hint" style="margin:0">停用后对方会立刻退出、不能再登录，记录保留。删除会清除这个人的全部记录和照片，不能恢复。</p>`}`,
    '<button type="button" class="btn primary main" data-act="user-save" id="save-btn">保存</button>');
  formReady('user-save');
}
// Two taps for anything that can't be taken back: the first turns the button red and asks again for a few seconds.
function confirmTap(btn, ask, normal, ms = 4500) {
  if (btn.classList.contains('confirm')) return true;
  btn.classList.add('confirm'); btn.textContent = ask;
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove('confirm'); btn.textContent = normal; } }, ms);
  return false;
}
async function saveUser(sh, signal) {
  const u = sh.user;
  const body = { name: fval('f-name') }; const role = segVal('role');
  if (role && role !== u.role) body.role = role;
  setBusy('保存中…'); await req('PATCH', `/api/admin/users/${encodeURIComponent(u.id)}`, body, { signal });
  sh.saved = true; closeSheet(true); toast('已保存'); if (u.id === S.me.id) refreshMe();
  loadUsers();
}
async function userAction(kind, btn) {
  const sh = S.sheet; if (!sh || sh.busy) return; const u = sh.user;
  const busy = on => { sh.busy = on; sheetEl.querySelectorAll('.acct-actions button').forEach(b => { b.disabled = on; }); };
  try {
    if (kind === 'reset') {
      if (!confirmTap(btn, `确认重置 @${u.username} 的密码`, '重置密码')) return;
      busy(true);
      const r = await req('POST', `/api/admin/users/${encodeURIComponent(u.id)}/reset`);
      busy(false); btn.classList.remove('confirm'); btn.textContent = '重置密码';
      $('#pw-out', sheetEl).innerHTML = pwBox(r.user, r.password, false);
    } else if (kind === 'toggle') {
      if (!u.disabled && !confirmTap(btn, `确认停用 @${u.username}`, '停用账号')) return;
      busy(true);
      await req('PATCH', `/api/admin/users/${encodeURIComponent(u.id)}`, { disabled: !u.disabled });
      closeSheet(true); toast(u.disabled ? '已启用' : '已停用，对方已被退出登录');
    } else if (kind === 'del') {
      if (!confirmTap(btn, `确认删除 @${u.username} 和全部数据`, '删除账号', 5000)) return;
      busy(true); await req('DELETE', `/api/admin/users/${encodeURIComponent(u.id)}`);
      closeSheet(true); toast('账号和数据已删除');
    }
    loadUsers();
  } catch (e) { if (S.sheet === sh) busy(false); toast(errMsg(e), true); }
}
// Opened from the home-screen icon (iOS standalone): no back button, so nothing may navigate the page away.
const standalone = () => navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
// 导出我的数据: fetched first, then a sheet whose button hands the file over (share sheet → 存储到文件, or a download).
// Two taps on purpose: iOS only opens the share sheet straight from a tap, and the fetch can take a while.
let exportFile = null;
async function exportData(btn) {
  if (btn.disabled) return; btn.disabled = true;
  try {
    const r = await fetch('/api/export', { credentials: 'same-origin' });
    if (!r.ok) throw { code: r.status === 401 ? 'unauthenticated' : 'unavailable', status: r.status };
    const blob = await r.blob(), name = `薄肌研究所-${today()}.json`;
    exportFile = { blob, name };
    S.sheet = { type: 'export' };
    showSheet('导出我的数据', `<div class="prose"><p>已经准备好：${esc(name)}（${Math.max(1, Math.round(blob.size / 1024))} KB），里面是你的全部记录（不含照片）。</p>
      <p class="hint">点下面的按钮，选「存储到"文件"」就能存在手机上。</p></div>`,
      '<button type="button" class="btn primary main" data-act="export-save">存储或分享</button>');
  } catch (e) { toast(e?.status ? errMsg(e) : '导出没成功，稍后再试', true); }
  btn.disabled = false;
}
async function exportSave() {
  const x = exportFile; if (!x) return;
  const file = typeof File === 'function' ? new File([x.blob], x.name, { type: 'application/json' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: x.name }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }  // otherwise fall through to a plain download
  }
  const url = URL.createObjectURL(x.blob), a = Object.assign(document.createElement('a'), { href: url, download: x.name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function copyText(text, btn) {
  const fallback = () => {
    const pw = btn.closest('.pwbox')?.querySelector('.pw');
    if (pw) { const r = document.createRange(); r.selectNodeContents(pw); getSelection().removeAllRanges(); getSelection().addRange(r); }
    toast(pw ? '没能复制，已经选中了，请长按手动复制' : `没能复制，请手动复制：${text}`, true);
  };
  try { navigator.clipboard.writeText(text).then(() => toast('已复制'), fallback); } catch (e) { fallback(); }
}

/* ---------- Apple 健康同步: the upload token made and copied with one tap ----------
   Safari only lets a page write the clipboard inside the tap itself, so the clipboard gets a promise of the text
   (ClipboardItem) right away and the token fills it once the server answers; elsewhere it is copied when it comes.
   Copied or not, the token is shown once with its own 复制 button, and the next step (下载快捷指令) under it. */
function makeToken() {
  if (S.tokenBusy) return;
  S.tokenBusy = true; S.tokenCopied = false; render();
  const got = req('POST', '/api/me/tokens', { name: 'iPhone 快捷指令' }).then(r => r.token);
  let copied = null;
  if (typeof window.ClipboardItem === 'function' && navigator.clipboard?.write) {
    try {
      copied = navigator.clipboard.write([new ClipboardItem({ 'text/plain': got.then(t => new Blob([`Bearer ${t}`], { type: 'text/plain' })) })]).then(() => true, () => false);
    } catch (e) { copied = null; }
  }
  got.then(async t => {
    let ok = copied ? await copied : false;
    if (!ok) { try { await navigator.clipboard.writeText(`Bearer ${t}`); ok = true; } catch (e) {} }
    S.newToken = t; S.tokenCopied = ok;
    toast(ok ? (standalone() ? '令牌已复制，下一步到 Safari 里下载快捷指令' : '令牌已复制，下一步：下载快捷指令') : '令牌生成好了，点「复制」把它复制下来');
    loadTokens();
  }, e => toast(errMsg(e), true)).finally(() => { S.tokenBusy = false; render(); });
}

/* ---------- 你的数据怎么处理 (/privacy) ----------
   Shown in a sheet: the page is read from the server and its text put in (no navigation, so the home-screen app keeps
   its place and the 新人引导 stays where it was). Only the headings, lists and paragraphs of that page are taken. */
async function openPrivacy() {
  let html = '';
  try {
    const r = await fetch('/privacy', { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    if (!r.ok) throw new Error(String(r.status));
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html'), wrap = doc.querySelector('.wrap');
    if (!wrap) throw new Error('page');
    wrap.querySelectorAll('script,style,link,.top,footer,h1').forEach(el => el.remove());
    wrap.querySelectorAll('*').forEach(el => { for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name); });
    wrap.querySelectorAll('a[href]').forEach(a => { if (!/^https?:/.test(a.getAttribute('href'))) a.removeAttribute('href'); else { a.target = '_blank'; a.rel = 'noopener noreferrer'; } });
    html = wrap.innerHTML;
  } catch (e) { toast('连不上服务器，稍后再看', true); return; }
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'privacy', photos: [], removed: [] };
  showSheet('你的数据怎么处理', `<div class="privacy-doc">${html}</div>`, '<button type="button" class="btn primary main" data-act="close">知道了</button>');
}

/* ---------- 加到主屏幕 ----------
   iPhone Safari (and Android browsers) not opened from the home screen: a strip at the top of the page that can be
   closed for good (lsj-a2hs-off); 怎么加 shows the steps, drawn with our own shapes (no Apple artwork). The same steps
   are the 新人引导's 加到主屏幕 page. */
const isAndroid = () => /Android/i.test(navigator.userAgent);
const a2hsShown = () => !!S.me && !standalone() && (isIOS() || isAndroid()) && !lsGet('lsj-a2hs-off') && !onb.open;
const SVG_SHARE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6v11.2"/><path d="M8.2 7.2L12 3.6l3.8 3.6"/><path d="M8.8 10.2H7a1.6 1.6 0 0 0-1.6 1.6v7.6A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6v-7.6A1.6 1.6 0 0 0 17 10.2h-1.8"/></svg>';
const SVG_ADDSQ = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
const SVG_PHONE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.8" width="11" height="18.4" rx="2.6"/><path d="M10.5 18h3"/><path d="M12 7v6M9 10h6"/></svg>';
function a2hsStrip() {
  if (!a2hsShown()) return '';
  return `<div class="a2hs" role="note"><button type="button" class="a2hs-t" data-act="a2hs">${SVG_PHONE}<span>加到主屏幕，用起来像 App</span><span class="link-t">怎么加</span></button><button type="button" class="icon-btn sm a2hs-x" data-act="a2hs-off" aria-label="不再提示">×</button></div>`;
}
function a2hsSteps() {
  if (isAndroid()) {
    return `<ol class="a2-steps">
      <li><div class="a2-h"><b class="a2-n">1</b>点浏览器右上角的「⋮」菜单</div></li>
      <li><div class="a2-h"><b class="a2-n">2</b>点「添加到主屏幕」或「安装应用」</div></li>
      <li><div class="a2-h"><b class="a2-n">3</b>回到主屏幕，点「薄肌研究所」图标打开</div></li></ol>`;
  }
  return `<ol class="a2-steps">
    <li><div class="a2-h"><b class="a2-n">1</b>点 Safari 的分享按钮</div>
      <div class="a2-pic a2-bar" aria-hidden="true"><span class="a2-k">‹</span><span class="a2-url">${location.host ? esc(location.host) : '薄肌研究所'}</span><span class="a2-k hl">${SVG_SHARE}</span><span class="a2-k">⋯</span></div>
      <p class="hint">在屏幕底部（iPad 在右上角）。看不到的话先点地址栏旁边的「⋯」，再点「分享」。</p></li>
    <li><div class="a2-h"><b class="a2-n">2</b>往下滑，点「添加到主屏幕」</div>
      <div class="a2-pic a2-menu" aria-hidden="true"><span class="a2-row">添加到阅读列表<i></i></span><span class="a2-row hl">添加到主屏幕${SVG_ADDSQ}</span><span class="a2-row">添加书签<i></i></span></div></li>
    <li><div class="a2-h"><b class="a2-n">3</b>点右上角的「添加」</div>
      <div class="a2-pic a2-add" aria-hidden="true"><span class="a2-x">取消</span><img src="/icons/icon-180.png" alt="" width="40" height="40"><span class="a2-name">薄肌研究所</span><span class="a2-ok hl">添加</span></div>
      <p class="hint">如果有「作为网页 App 打开」的开关，让它开着。</p></li>
    <li><div class="a2-h"><b class="a2-n">4</b>回到主屏幕，点「薄肌研究所」图标打开</div>
      <p class="hint">像 App 一样全屏，还能收 Claude 的通知。第一次打开可能要再登录一次，用同一个用户名和密码。</p></li></ol>`;
}
function openA2hs() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'a2hs', photos: [], removed: [] };
  showSheet('加到主屏幕', `<p class="hint" style="margin:0">从主屏幕的图标打开，薄肌研究所就像一个 App：全屏、打开快，还能收通知。</p>${a2hsSteps()}`,
    '<button type="button" class="btn primary main" data-act="close">知道了</button>');
}

/* ---------- 新人引导 ----------
   Three steps, full screen, over the page: ① what this is and how the data is handled (「我知道了」 writes
   prefs.consentAt: the photos and records go to Claude, i.e. Anthropic; /privacy opens in a sheet on top), ② the least
   Claude needs for a plan (sex, age, height, weight, goal, days a week; the rest gets defaults and can be filled in
   「我的」 later) saved to profile/main with needsReview, ③ the 临时目标 worked out from that at once, when the plan
   will come, and a big 「拍下一顿」 (prefs.onboardedAt). Everything else (style, persona, where training is logged, the
   home screen, notifications, Apple 健康) is not asked here: the Safari strip, the first-review question about
   notifications and 「我的」 cover it. It opens by itself for an account without profile/main, and for one made after
   invites came (CONSENT_SINCE) that hasn't said 「我知道了」; never once onboardedAt is there, nor after 跳过 on this
   device (lsj-onb-later:<uid>). 「我的」 opens it again from the start. */
const CONSENT_SINCE = '2026-10-17';  // accounts made before this were in use before the guide existed (fitness-review: the same)
const PROFILE_DEFAULTS = { minutes: 60, place: 'gym', level: 'new' };  // what step ② doesn't ask; changed in 「我的 → 基础信息」
const onb = { open: false, step: 'hello', busy: false, tried: false, form: {} };
const onbEl = $('#onb');
const onbLaterKey = () => 'lsj-onb-later:' + (S.me?.id || '');
const legacyAccount = () => String(S.me?.createdAt || '') < CONSENT_SINCE && !!S.profile;
const ONB_STEPS = ['hello', 'basics', 'start'];
function onbWanted() {
  if (!S.me || S.me.mustChange || !S.db || !S.loaded.has('profile')) return false;
  const p = prefs();
  if (p.onboardedAt || lsGet(onbLaterKey())) return false;
  return !S.profile || (!p.consentAt && !legacyAccount());
}
// Once the profile has loaded: open by itself if it should (one try per page load), at the first step not done.
function onbCheck() {
  if (onb.tried || !S.me || !S.loaded.has('profile') || !S.db) return;
  if (S.sheet || LIVE.open) return;  // after that's done
  onb.tried = true;
  if (onbWanted()) openOnb(!prefs().consentAt ? 'hello' : !hasBasics() ? 'basics' : 'start');
}
const hasBasics = (p = S.profile) => !!p && ['male', 'female'].includes(p.sex) && [p.age, p.height, p.weight].every(isNum) && GOALS.some(([g]) => g === p.goal) && Number.isInteger(p.days) && p.days >= 1 && p.days <= 7;
function openOnb(step = 'hello') {
  if (onb.open) return;
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  toggleMenu(false);
  const p = S.profile || {};
  onb.open = true; onb.busy = false; onb.step = ONB_STEPS.includes(step) ? step : 'hello';
  onb.form = { sex: p.sex || null, age: p.age ?? '', height: p.height ?? '', weight: p.weight ?? '', goal: p.goal || null, days: p.days ? String(p.days) : null };
  document.documentElement.classList.add('onb-lock');
  drawOnb(true); render();
}
function closeOnb() {
  onb.open = false; onb.busy = false;
  document.documentElement.classList.remove('onb-lock');
  drawOnb(); render();
}
const ONB_OK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const onbSeg = (g, opts, v, cls = '') => `<div class="seg req ${cls}" data-group="ob-${g}" role="group">${opts.map(([x, l]) => `<button type="button" data-act="seg" data-v="${esc(x)}" aria-pressed="${String(x) === String(v ?? '')}">${l}</button>`).join('')}</div>`;
// 临时目标 as a row of four numbers and the water, with what they are.
function tempTargetsHTML(tt) {
  if (!tt) return '';
  return `<div class="tt"><div class="targets">${MACROS.map(([k, l, u, c]) => `<div class="tg" style="--c:${c}"><div class="k">${l}</div><div class="v">${fmt(tt[k])}<small>${u}</small></div></div>`).join('')}</div>
    <p class="tt-w">喝水 <b class="num">${fmt(tt.water)}</b> ml</p><p class="tt-note"><span class="tag tmp">临时目标</span>按你填的资料估的，Claude 做计划后会细调。</p></div>`;
}
const ONB = {
  hello() {
    const c = prefs().consentAt;
    return {
      body: `<div class="onb-hero"><img class="onb-icon" src="/icons/icon-180.png" alt="" width="64" height="64"><h1 class="onb-t" id="onb-t"><span>薄肌研究所</span>：你的 AI 私教</h1></div>
        <p class="onb-lead">开饭前拍一张，练的时候逐组打勾。Claude 每天看两次：估每餐的热量、点评训练、写日报，按你的情况做计划、慢慢调。</p>
        <div class="onb-card"><h2>你的数据怎么处理</h2><ul>
          <li>你记的饭、训练、身体数据和照片，存在薄肌研究所这台服务器上。</li>
          <li>Claude（Anthropic 公司的 AI）在维护者的电脑上看你的记录，<b>看的时候照片和记录会发给 Anthropic</b>。</li>
          <li>管理员和维护者能看到所有人的数据；你随时可以导出，或者注销、全部删掉。</li></ul>
          <a class="link" href="/privacy" data-act="privacy">详细说明：你的数据怎么处理</a></div>
        ${c ? `<p class="onb-ok">${ONB_OK}你在 ${esc(fmtTs(c))} 点过「我知道了」</p>` : '<p class="hint">点「我知道了」之前，Claude 不看你的照片，只看文字和数字。</p>'}`,
      main: c ? '下一步' : '我知道了', alt: c ? '' : ['onb-next', '先不确认，往下'],
    };
  },
  basics() {
    const f = onb.form;
    return {
      body: `<h1 class="onb-t" id="onb-t">说说你自己</h1>
        <p class="onb-lead">六项就够 Claude 做第一份计划，填完马上给你一个临时目标。</p>
        <div class="onb-form">
          <div class="field"><span class="lbl">性别</span>${onbSeg('sex', [['male', '男'], ['female', '女']], f.sex)}</div>
          <div class="row3"><div class="field"><label for="ob-age">年龄</label>${numIn('ob-age', f.age, { int: true })}</div><div class="field"><label for="ob-h">身高 cm</label>${numIn('ob-h', f.height)}</div><div class="field"><label for="ob-w">体重 kg</label>${numIn('ob-w', f.weight)}</div></div>
          <div class="field"><span class="lbl">主要目标</span>${onbSeg('goal', GOALS, f.goal, 'g3')}</div>
          <div class="field"><span class="lbl">每周能练几天</span>${onbSeg('days', [1, 2, 3, 4, 5, 6, 7].map(n => [String(n), String(n)]), f.days, 'num-seg')}</div>
        </div>
        <p class="hint">每次练多久、在哪练、伤病和忌口，以后在「我的 → 基础信息」里补；没补的先按每次 60 分钟、健身房、新手来排。</p>`,
      main: '下一步',
    };
  },
  start() {
    const tt = tempTargets(), runs = runTimes(), noPlan = !S.plan && !!S.db;
    const sched = `Claude 每天 ${runs.join(' 和 ')} 看一次`;
    return {
      body: `<h1 class="onb-t" id="onb-t">从今天开始</h1>
        ${tt ? `<p class="onb-lead">${S.plan ? '计划已经有了，去今日开始记。先按这个吃：' : '先按这个吃：'}</p>${tempTargetsHTML(tt)}`
          : S.plan ? '<p class="onb-lead">计划已经有了，去今日开始记。</p>' : '<p class="onb-lead">资料还没填全，填好后这里会给你一个临时目标；Claude 也要靠它做计划。</p>'}
        <div class="onb-card onb-eta"><p><b>${esc(sched)}</b>${S.plan ? '。' : '。训练安排可以自己搭（下面「自己搭一套」，今天就能练），它下次看的时候补上饮食目标、给建议；也可以等它做一份计划，到时出现在「训练」页。'}</p>
          <p class="meta">这之前拍下吃的每一顿，它第一次看的时候就能对着你真实的饮食来定。</p></div>
        ${prefs().consentAt ? '' : '<p class="hint">你还没点「我知道了」：Claude 先不看你的照片。想让它看，在「我的」里重新打开引导。</p>'}`,
      // the person plans, Claude assists: a template is the main way in (B3); the camera and waiting for Claude under it
      main: noPlan ? '自己搭一套' : S.assets ? '拍下一顿' : '开始用', mainAct: noPlan ? 'onb-tpl' : 'onb-snap',
      alt: noPlan ? (S.assets ? ['onb-snap', '先拍下一顿'] : ['onb-finish', '先看看']) : S.assets ? ['onb-finish', '先看看'] : '',
      alt2: noPlan ? ['onb-wait', '等 Claude 做一份'] : '',
    };
  },
};
// 等 Claude 做一份 from the guide: the guide is done, the explanation opens.
function onbWait() { onbFinish(false); openPlanWait(); }
// 先自己搭一套 from the guide's last step: the guide is done, the template sheet opens.
function onbTpl() {
  if (!prefs().onboardedAt && S.db) patchPrefs({ onboardedAt: nowIso() }).catch(() => {});
  closeOnb();
  if (S.tab !== 'today' || S.date !== today()) { S.date = today(); setTab('today'); }
  openPlanTpl({});
}
function drawOnb(top) {
  if (!onbEl) return;
  if (!onb.open) { if (!onbEl.hidden) { onbEl.hidden = true; onbEl.innerHTML = ''; } return; }
  const i = ONB_STEPS.indexOf(onb.step), st = ONB[onb.step]();
  const busy = onb.busy;
  const alt = (st.alt ? `<button type="button" class="link" data-act="${st.alt[0]}"${busy ? ' disabled' : ''}>${st.alt[1]}</button>` : '')
    + (st.alt2 ? `<button type="button" class="link onb-alt2" data-act="${st.alt2[0]}"${busy ? ' disabled' : ''}>${st.alt2[1]}</button>` : '');
  const html = `<div class="onb-in" role="dialog" aria-modal="true" aria-labelledby="onb-t">
    <div class="onb-top"><span class="onb-prog" role="img" aria-label="第 ${i + 1} 步，共 ${ONB_STEPS.length} 步">${ONB_STEPS.map((s, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</span><span class="onb-n num">${i + 1}/${ONB_STEPS.length}</span><button type="button" class="link onb-skip" data-act="onb-skip">跳过</button></div>
    <div class="onb-b" data-step="${onb.step}">${st.body}</div>
    <div class="onb-f"><button type="button" class="btn primary onb-main" data-act="${st.mainAct || 'onb-main'}"${busy ? ' disabled' : ''}>${busy ? '保存中…' : st.main}</button>
      ${i > 0 || alt ? `<div class="onb-nav">${i > 0 ? `<button type="button" class="link" data-act="onb-back"${busy ? ' disabled' : ''}>上一步</button>` : '<span></span>'}${alt}</div>` : ''}</div></div>`;
  if (!top && onbEl.innerHTML === html && !onbEl.hidden) return;
  // a field being typed in keeps its focus and caret across the redraw
  const ae = document.activeElement, fid = ae && ae.id && ae.tagName === 'INPUT' && onbEl.contains(ae) ? ae.id : null;
  const caret = fid ? [ae.selectionStart, ae.selectionEnd] : null;
  const y = top ? 0 : onbEl.scrollTop;
  onbEl.innerHTML = html; onbEl.hidden = false; onbEl.scrollTop = y;
  const fe = fid && document.getElementById(fid);
  if (fe) { fe.focus({ preventScroll: true }); try { fe.setSelectionRange(caret[0], caret[1]); } catch (e) {} }
  else if (top) $('#onb-t', onbEl)?.focus?.({ preventScroll: true });
}
function onbGo(d) {
  const i = Math.max(0, ONB_STEPS.indexOf(onb.step));
  onb.step = ONB_STEPS[Math.min(ONB_STEPS.length - 1, Math.max(0, i + d))]; drawOnb(true);
}
// Saves what the step needs; a save that fails keeps the step (and says why).
async function onbSave(fn) {
  if (onb.busy) return false;
  onb.busy = true; drawOnb();
  try { await fn(); return true; }
  catch (e) {
    toast(e?.code === 'invalid_input' ? e.message : errMsg(e), true);
    if (e?.field) requestAnimationFrame(() => { const el = document.getElementById(e.field); if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); } });
    return false;
  } finally { onb.busy = false; drawOnb(); }
}
// Step ②: the six answers, checked like the profile form; the rest of profile/main gets PROFILE_DEFAULTS when empty.
function onbBasics() {
  const f = onb.form, num = (k, label, o) => {
    const v = parseNum(f[k], o.int);
    if (v == null) throw badInput(`先填${label}`, o.id);
    if (Number.isNaN(v) || v < o.min || v > o.max) throw badInput(Number.isNaN(v) ? `${label}填的不是数字` : `${label}应该在 ${o.min}–${o.max} 之间`, o.id);
    return v;
  };
  if (!f.sex) throw badInput('先选性别');
  const out = { sex: f.sex, age: num('age', '年龄', { int: true, min: 10, max: 100, id: 'ob-age' }), height: num('height', '身高', { min: 100, max: 250, id: 'ob-h' }), weight: num('weight', '体重', { min: 20, max: 400, id: 'ob-w' }) };
  if (!f.goal) throw badInput('先选主要目标');
  if (!f.days) throw badInput('先选每周能练几天');
  return { ...out, goal: f.goal, days: Number(f.days) };
}
async function onbMain() {
  if (onb.busy) return;
  const p = prefs();
  if (onb.step === 'hello') { if (!p.consentAt && !await onbSave(() => patchPrefs({ consentAt: nowIso() }))) return; }
  else if (onb.step === 'basics') {
    let fields; try { fields = onbBasics(); } catch (e) { toast(e.message, true); if (e.field) { const el = document.getElementById(e.field); el?.setAttribute('aria-invalid', 'true'); el?.focus(); } return; }
    const was = S.profile, changed = !was || changedFields(fields, was).length;
    if (changed && !await onbSave(async () => {
      const fill = Object.fromEntries(Object.entries(PROFILE_DEFAULTS).filter(([k]) => was?.[k] == null || was[k] === ''));
      await saveFields('profile', 'main', clone(was), { ...fill, ...fields, needsReview: true, updatedAt: nowIso() });
      if (!prefs().trainIn && !xjUser()) await patchPrefs({ trainIn: 'app' });  // a new person logs training here
    })) return;
  }
  onbGo(1);
}
// Step ③: 拍下一顿 opens the camera inside the same tap (as 「拍照记一餐」), and the guide is done.
function onbFinish(snap) {
  if (snap && S.assets && !camBusy) camIn.click();
  if (!prefs().onboardedAt && S.db) patchPrefs({ onboardedAt: nowIso() }).catch(() => {});
  closeOnb();
  if (S.tab !== 'today' || S.date !== today()) { S.date = today(); setTab('today'); }
  if (!snap) toast('开饭前点下面中间的「＋」→「拍照记一餐」');
}
function onbSkip() {
  lsSet(onbLaterKey(), today());
  closeOnb();
  toast('引导收起来了，在「我的」里随时能重新打开');
}

/* ---------- 邀请 (admins): a link a friend signs up with (/join?code=…). The code is shown only when it is made. ---------- */
const INV_ST = { active: ['good', '能用'], used: ['ok', '用完了'], expired: ['ok', '过期了'], revoked: ['adjust', '已撤销'] };
async function loadInvites() {
  if (S.me?.role !== 'admin') return;
  try { S.invites = (await req('GET', '/api/admin/invites')).invites || []; }
  catch (e) { if (e?.status === 404) S.invites = false; }  // a server without invites: the part stays hidden
  render();
}
function inviteRow(v) {
  const [cls, txt] = INV_ST[v.status] || ['ok', String(v.status || '')];
  const who = (Array.isArray(v.users) ? v.users : []).map(u => `${esc(u.name || u.username)}<span class="tm">@${esc(u.username)}</span>`).join('、');
  const when = v.status === 'active' ? `${fmtTs(v.expiresAt)} 前有效` : v.status === 'expired' ? `${fmtTs(v.expiresAt)} 过期` : v.status === 'revoked' && v.revokedAt ? `${fmtTs(v.revokedAt)} 撤销` : '';
  const bits = [`注册了 ${v.uses ?? 0}/${v.maxUses ?? 1}`, v.status === 'active' ? `还能用 ${v.left ?? 0} 次` : '', when].filter(Boolean).join(' · ');
  return `<div class="inv-row"><div class="inv-m"><span class="inv-t">${v.note ? esc(v.note) : '<span class="meta">没写备注</span>'}<span class="tag ${cls}">${txt}</span></span>
    <span class="meta">${esc(bits)}</span>${who ? `<span class="inv-who">注册的人：${who}</span>` : ''}</div>
    ${v.status === 'active' ? `<button type="button" class="btn ghost sm danger" data-act="inv-revoke" data-id="${esc(v.id)}">撤销</button>` : ''}</div>`;
}
function invitesHTML() {
  if (S.invites === false) return '';
  const xs = Array.isArray(S.invites) ? S.invites : [], act = xs.filter(v => v.status === 'active'), old = xs.filter(v => v.status !== 'active');
  return `<div class="sub-h inv-h">邀请朋友注册</div><div class="panel panel-pad inv">
    <p>生成一个邀请链接发给朋友，他打开后自己设用户名和密码，注册完就能用，是普通成员。</p>
    <div class="btns"><button type="button" class="btn primary sm" data-act="inv-new">生成邀请链接</button></div>
    ${S.invites == null ? '<p class="meta">正在读取…</p>' : ''}
    ${act.length ? `<div class="inv-list">${act.map(inviteRow).join('')}</div>` : ''}
    ${old.length ? `<details class="steps-det" data-key="inv-old"><summary>用不了的 ${old.length} 个</summary><div class="inv-list">${old.map(inviteRow).join('')}</div></details>` : ''}
    <p class="hint" style="margin:0">链接只在生成时显示一次。拿到链接的人都能注册，只私下发给你信任的人；有人注册了你会收到通知。</p></div>`;
}
function openInvite() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'invite', saveAct: 'inv-create', photos: [], removed: [] };
  showSheet('生成邀请链接', `
    <div class="field"><label for="inv-note">备注（可不填）</label><input type="text" id="inv-note" maxlength="40" autocomplete="off" placeholder="例如：小王，一起练">
      <p class="hint" style="margin:0"><b>被邀请的人也看得到这句</b>（注册页上会显示），别写只给自己看的话。最多 40 字。</p></div>
    <div class="field"><span class="lbl">能注册几个账号</span>${seg('inv-uses', [1, 2, 5, 10, 20].map(n => [String(n), `${n} 个`]), '1', 'req')}</div>
    <div class="field"><span class="lbl">几天内有效</span>${seg('inv-days', [3, 7, 14, 30, 90].map(n => [String(n), `${n} 天`]), '14', 'req')}</div>
    <p class="hint" style="margin:0">次数用完或过期后自动失效，也可以随时撤销；已经注册的账号不受影响。</p>`,
    '<button type="button" class="btn primary main" data-act="inv-create" id="save-btn">生成</button>');
}
async function createInvite(sh, signal) {
  const note = fval('inv-note');
  if (note.length > 40) throw badInput('备注最多 40 个字', 'inv-note');
  setBusy('生成中…');
  const r = await req('POST', '/api/admin/invites', { note, maxUses: +segVal('inv-uses') || 1, days: +segVal('inv-days') || 14 }, { signal });
  sh.busy = false; sh.invite = r;
  const v = r.invite || {}, share = typeof navigator.share === 'function';
  $('.sheet-b', sheetEl).innerHTML = `<div class="pwbox inv-out"><div class="lbl">邀请链接（只显示这一次）</div><div class="pw link-pw">${esc(r.link)}</div>
      <p class="hint" style="margin:0">邀请码 <b>${esc(r.code)}</b> · 能注册 ${esc(v.maxUses ?? 1)} 个账号 · ${esc(fmtTs(v.expiresAt))} 前有效${v.note ? ` · 对方会看到备注「${esc(v.note)}」` : ''}</p>
      <div class="btns">${share ? '<button type="button" class="btn primary sm" data-act="inv-share">分享</button>' : ''}<button type="button" class="btn ${share ? 'ghost' : 'primary'} sm" data-act="copy" data-v="${esc(r.link)}">复制链接</button></div></div>
    <p class="hint" style="margin:0">关掉以后就看不到这个链接了，先分享或复制出去。弄丢了就撤销它，再生成一个。</p>`;
  $('.sheet-f', sheetEl).innerHTML = '<button type="button" class="btn ghost main" data-act="close">完成</button>';
  S.invites = Array.isArray(S.invites) ? [v, ...S.invites.filter(x => x.id !== v.id)] : S.invites;
  loadInvites();
}
async function shareInvite() {
  const r = S.sheet?.invite; if (!r) return;
  try { await navigator.share({ title: '薄肌研究所邀请', text: '来薄肌研究所一起记饭、记训练，Claude 当私教。用这个链接注册：', url: r.link }); }
  catch (e) { if (e?.name !== 'AbortError') toast('没能打开分享，点「复制链接」发给他', true); }
}
async function revokeInvite(id, btn) {
  if (!id || btn.disabled || !confirmTap(btn, '确认撤销', '撤销')) return;
  btn.disabled = true;
  try {
    const r = await req('DELETE', `/api/admin/invites/${encodeURIComponent(id)}`);
    if (r.invite && Array.isArray(S.invites)) S.invites = S.invites.map(v => v.id === id ? r.invite : v);
    toast('邀请撤销了，用它注册过的账号不受影响');
  } catch (e) { btn.disabled = false; toast(errMsg(e), true); }
  render();
}

/* ---------- 注销账号 (DELETE /api/me {password}) ----------
   The password, then a second tap; everything of this account goes on the server. This phone forgets what it kept for
   the account (drafts, the water queue, the session being logged) and goes to the login page. */
function openDeleteMe() {
  if (S.sheet) { closeSheet(); if (S.sheet) return; }
  S.sheet = { type: 'delete-me', photos: [], removed: [] };
  showSheet('注销账号', `<div class="prose">
      <p>注销后马上删除：你的账号、全部记录和照片、Apple 健康的上传令牌、训记 key 和通知订阅。<b>删了不能恢复。</b></p>
      <p class="hint">服务器每天的备份里还会留一份，最多 14 天后自动删掉。想留一份记录，先在「账号」里点「导出我的数据」。</p></div>
    ${S.me?.role === 'admin' ? '<p class="hint" style="margin:0">你是管理员：没有别的管理员的话，要先把管理员交给别人才能注销。</p>' : ''}
    <form id="del-form" style="display:flex;flex-direction:column;gap:16px"><input type="text" autocomplete="username" value="${esc(S.me?.username || '')}" hidden>
    <div class="field"><label for="f-delpw">输入密码确认</label><input type="password" id="f-delpw" autocomplete="current-password"></div></form>`,
    '<button type="button" class="btn ghost danger main" data-act="acct-del-go" id="save-btn">注销账号</button>');
}
async function deleteMe(btn) {
  const sh = S.sheet; if (sh?.type !== 'delete-me' || sh.busy) return;
  const pwEl = $('#f-delpw', sheetEl), pw = pwEl?.value || '';
  if (!pw) { toast('先输入密码', true); pwEl?.focus(); return; }
  if (!confirmTap(btn, '确认注销，全部删除', '注销账号', 5000)) return;
  sh.busy = true; btn.disabled = true; btn.textContent = '注销中…'; sheetMsg(null);
  try { await req('DELETE', '/api/me', { password: pw }); }
  catch (e) {
    if (S.sheet !== sh) return;
    sh.busy = false; btn.disabled = false; btn.classList.remove('confirm'); btn.textContent = '注销账号';
    const m = e?.code === 'wrong_password' ? '密码不对' : e?.code === 'last_admin' ? '你是最后一个管理员，不能注销：先把管理员交给别人'
      : e?.status === 429 || e?.code === 'rate_limited' ? '试得太多了，10 分钟后再试' : errMsg(e);
    sheetMsg(`<span><b>没有注销</b> · ${esc(m)}</span>`);
    if (e?.code === 'wrong_password') { pwEl.value = ''; pwEl.focus(); }
    return;
  }
  sh.saved = true;
  await forgetAccount();
  location.replace('/login');
}
async function forgetAccount() {
  const uid = S.me?.id; if (!uid) return;
  const jobs = [...drafts.keys()].filter(k => k.startsWith(uid + '|')).map(k => dropDraft(k));
  ['lsj-water-q:', 'lsj-live:', 'lsj-wo-draft:', 'lsj-onb-later:', 'lsj-push-ask:'].forEach(p => lsSet(p + uid, null));
  ['lsj-resume', 'lsj-uid', 'lsj-tab'].forEach(k => lsSet(k, null));
  try { if (S.push.sub) jobs.push(S.push.sub.unsubscribe()); } catch (e) {}
  await Promise.race([Promise.allSettled(jobs), sleep(1500)]);
}

/* ---------- delete ---------- */
async function onDelete(btn) {
  const sh = S.sheet; if (!sh || sh.busy) return;
  if (!confirmTap(btn, '确认删除', '删除', 4000)) return;
  const col = { meal: 'meals', workout: 'workouts', body: 'body', progress: 'progress' }[sh.type];
  try {
    sh.busy = true;
    await retry1(() => S.db.collection(col).doc(sh.id).delete());
    for (const pid of [...photoList(sh.existing?.photos), ...photoList(sh.existing?.leftovers)]) { try { await S.assets?.delete(pid); } catch (e) {} }
    sh.saved = true; if (sh.dkey) dropDraft(sh.dkey);
    closeSheet(true); toast('已删除');
  } catch (e) { sh.busy = false; toast(errMsg(e), true); }
}

/* ---------- menu / lightbox / toast ---------- */
const menuEl = $('#menu'), lbEl = $('#lightbox'), toastEl = $('#toast');
// ＋ (v9): four big buttons — 拍一餐 (the camera; 从相册选 under it), 快捷记一笔, 喝水 (+250 / +500 logged straight
// away), 体重 (the body form, on the weight) — and one line of the rest (手动记一餐 · 拍身材照 · 补记训练 · 告诉 Claude).
// While a session runs, 继续训练 on top. 开练 lives on 「今天」 and the 训练 tab, 从训记同步 on the 训练 tab and the
// 今日 training card's 「⋯」.
const ICON = {
  cam: '<svg class="i" viewBox="0 0 24 24"><path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>',
  bolt: '<svg class="i" viewBox="0 0 24 24"><path d="M13.5 3L5.5 13.5h5.5L9.5 21l8-10.5h-5.5z"/></svg>',
  drop: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3.5c3.4 4.1 6 7.3 6 10.6a6 6 0 0 1-12 0c0-3.3 2.6-6.5 6-10.6z"/><path d="M9.2 14.4a2.9 2.9 0 0 0 2.6 2.7"/></svg>',
  dumbbell: '<svg class="i" viewBox="0 0 24 24"><path d="M7 7v10M17 7v10M4 9.5v5M20 9.5v5M7 12h10"/></svg>',
  scale: '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.8 10.2a4.6 4.6 0 0 1 6.4 0"/><path d="M12 10.4l1.4-1.8"/></svg>',
};
function menuHTML() {
  const compose = typeof LC()?.compose === 'function', act = activeWo();
  const live = act ? `<button type="button" class="mn-live" data-act="lv-open" role="menuitem"><span class="mi">${ICON.dumbbell}</span><span class="mt"><b>${esc(vt('btn.liveGo', '继续训练'))}${isFresh(act) ? ` · <span class="num" data-lv-clock>${esc(lvElapsed(act))}</span>` : ''}</b>${isFresh(act) ? '' : '<small>上次的训练还没点完成</small>'}</span>${CHEV_R}</button>` : '';
  const camT = LV()?.on() ? vt('btn.camMeal', '拍一餐') : '拍一餐';
  const cam = S.assets
    ? `<div class="mn-t mn-cam"><button type="button" class="mn-main" data-act="cam-meal" role="menuitem"><span class="mi">${ICON.cam}</span><b>${esc(camT)}</b></button><button type="button" class="mn-sub" data-act="album-meal" role="menuitem">从相册选</button></div>`
    : `<button type="button" class="mn-t mn-main" data-act="new-meal" role="menuitem"><span class="mi">${ICON.cam}</span><b>记一餐</b></button>`;
  const quick = `<button type="button" class="mn-t mn-main mn-quick" data-act="quick-list" role="menuitem"><span class="mi">${ICON.bolt}</span><b>快捷记一笔</b><small>常吃的点一下</small></button>`;
  const water = `<div class="mn-t mn-water"><span class="mn-h"><span class="mi">${ICON.drop}</span><b>喝水</b></span><span class="mn-wb">${[250, 500].map(ml => `<button type="button" class="mn-w" data-act="menu-water" data-ml="${ml}" role="menuitem" aria-label="喝了 ${ml} 毫升"><span class="num">+${ml}</span></button>`).join('')}</span></div>`;
  const weigh = `<button type="button" class="mn-t mn-main mn-weigh" data-act="menu-weigh" role="menuitem"><span class="mi">${ICON.scale}</span><b>体重</b><small>记今天的</small></button>`;
  const more = [['new-meal', '手动记一餐'], ['progress-new', '拍身材照'], ['new-workout', '补记训练'], compose ? ['compose', '告诉 Claude'] : null].filter(Boolean)
    .map(([a, l]) => `<button type="button" class="mn-more-b" data-act="${a}" role="menuitem">${l}</button>`).join('');
  return `${live}<div class="mn-grid">${cam}${quick}${water}${weigh}</div><div class="mn-more"><span class="mn-more-k">更多</span><span class="mn-more-l">${more}</span></div>`;
}
// 从相册选: a picture already taken, the same one-tap meal as the camera.
const albumIn = (() => {
  const el = document.createElement('input');
  Object.assign(el, { type: 'file', id: 'album-in', accept: 'image/*', className: 'vh', tabIndex: -1 });
  el.setAttribute('aria-hidden', 'true');
  el.addEventListener('change', () => { const f = el.files?.[0]; el.value = ''; if (f) camMeal(f); });
  document.body.appendChild(el);
  return el;
})();
// 喝水 with a toast to take it back (the ＋ menu, 「今天」 and the water card).
function waterTap(ml, d = S.date) {
  if (!(ml > 0)) return;
  addWater(ml, 'water', d);
  toast(vt('toast.water', '记下 {ml} ml', { ml, seed: Date.now() }), false, () => undoWater(d));
}
// The menu is a layer like a sheet: it holds a history entry, so the system back button closes it first (#L7).
function toggleMenu(open) {
  const show = open === undefined ? menuEl.hidden : !!open;
  if (show) $('.menu-card', menuEl).innerHTML = menuHTML();
  const was = !menuEl.hidden;
  menuEl.hidden = !show;
  $('.tab.add')?.setAttribute('aria-expanded', String(show));
  if (was !== show) layerSync();
}
function openLightbox(src) { lbEl.innerHTML = `<img src="${esc(src)}" alt="照片大图">`; lbEl.hidden = false; }
let tt, toastFn = null;
// A short message at the bottom; with `undo`, it carries a button (撤销, or `label`) for a few seconds.
function toast(msg, err, undo, label = '撤销') {
  toastFn = undo || null;
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" class="toast-act" data-act="toast-undo">${esc(label)}</button>` : ''}`;
  toastEl.className = 'toast' + (err ? ' err' : '') + (undo ? ' act' : ''); toastEl.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => { toastEl.hidden = true; toastFn = null; }, undo ? 6000 : err ? 4200 : 2600);
}
function setTab(t) {
  t = tabOf(t);  // 反馈 lives inside 数据 now
  const was = S.tab, sub = SUB_TABS.includes(t), fromMain = !SUB_TABS.includes(was);
  if (t !== S.tab) { S.newToken = null; S.healthSetup = false; S.planGone = []; S.planAdj = false; }  // 训练's 调整 and its 已删掉 rows end with the tab
  // Claude and 我的 remember the tab they were opened from; from a tab (nothing over the page) they get their own
  // history entry, so the system back button returns there too
  if (sub && fromMain && was !== t) S.backTab = was;
  S.tab = t; lsSet('lsj-tab', t);
  try {
    if (location.hash !== hashOf(t)) {
      if (sub && fromMain && !openLayers() && !pushed && !syncT) { history.pushState({ lsjSub: 1 }, '', hashOf(t)); S.subPushed = true; }
      else history.replaceState(history.state, '', hashOf(t));
    }
  } catch (e) {}
  if (!sub) S.subPushed = false;
  window.scrollTo(0, 0); render();
  if (t === 'me' && S.db) { refreshMe(); loadUsers(); loadTokens(); loadXj(); if (S.push.reg) pushRefresh(false); }
  if ((t === 'plan' || t === 'claude') && S.db) loadXj();
}
// Another tab, and for the Claude tab the section to scroll to (claude.js reads S.claudeFocus and clears it).
function go(tab, focus) { S.claudeFocus = focus || null; setTab(tab); }
// 「‹」 on Claude / 我的: back where they were opened from (the history entry they pushed, when there is one).
function subBack() {
  const to = SUB_TABS.includes(S.backTab) ? 'today' : S.backTab || 'today';
  if (S.subPushed && history.state?.lsjSub && !pushed) { history.back(); return; }  // popstate → hashTab → that tab
  setTab(to);
}
function hashTab() {
  const dl = deepLink(location.hash); if (dl) { deep = dl; openDeep(); return; }
  const h = location.hash.slice(1);
  if (!h && SUB_TABS.includes(S.tab)) { setTab(S.backTab); return; }  // an entry from before the page named its tab
  if (!/^(today|plan|train|claude|data|feedback|me)$/.test(h)) return;
  const t = tabOf(h); if (t !== S.tab) setTab(t);
}
// a layer's entry being popped (layerSync) lands on an older hash: the popstate below puts the tab's back first
window.addEventListener('hashchange', () => { if (popSkip > 0) return; hashTab(); });
/* The layers over a tab (a sheet, a full-screen page, 训练中) each hold one history entry, so the system back button
   closes the top one first. Opening and closing only call layerSync; after the event it pushes or pops entries until
   they match the layers open (a sheet swapped for another in one tap changes nothing). With no layer open, back is a
   tab change by its hash. */
let pushed = 0, popSkip = 0, syncT = 0;
const openLayers = () => (sheetEl.hidden ? 0 : 1) + (HIST.open ? 1 : 0) + (LIVE.open ? 1 : 0) + (menuEl.hidden ? 0 : 1);
function layerSync() {
  if (syncT) return;
  syncT = setTimeout(() => {
    syncT = 0;
    const want = openLayers();
    try {
      if (want > pushed) { for (; pushed < want; pushed++) history.pushState({ lsj: 'layer' }, '', location.href); }
      else if (want < pushed) { const n = pushed - want; pushed = want; popSkip++; history.go(-n); }
    } catch (e) {}
  }, 0);
}
window.addEventListener('popstate', () => {
  if (popSkip > 0) {
    popSkip--;
    // the entry gone back to still has the hash from when the layer opened; the tab may have changed since (去「训练」,
    // 收工 → 今日): it gets the tab's own, so the hashchange that follows finds nothing to switch
    try { if (location.hash !== hashOf(S.tab)) history.replaceState(history.state, '', hashOf(S.tab)); } catch (e) {}
    return;
  }
  if (pushed > 0) {
    pushed--;
    // the top layer; a form with unsaved changes asks first (the entry comes back while it stays open)
    if (!menuEl.hidden) toggleMenu(false);
    else if (!sheetEl.hidden) closeSheet();
    else if (HIST.open) closeHist();
    else if (LIVE.open) { if (LIVE.mode === 'edit') lvEditClose(); else closeLive(); }
    layerSync();
    return;
  }
  hashTab();
});
function goDate(d) { if (!isDate(d)) return; S.date = d; S.todoOpen = false; render(); }
// Back to the login page with the open form saved as a draft; the page reopens it after signing in.
async function relogin() {
  const sh = S.sheet;
  if (sh?.form && sh.dkey) {
    await writeDraft();
    lsSet('lsj-resume', JSON.stringify({ uid: S.me?.id, type: sh.type, id: sh.isNew ? null : sh.id, date: fval('f-date') || sh.id }));
  }
  location.href = '/login';
}
function tryResume() {
  const raw = lsGet('lsj-resume'); if (!raw || !S.me || !draftsReady || S.sheet) return;
  if (!['meals', 'workouts', 'body', 'profile', 'plan'].every(k => S.loaded.has(k))) return;
  lsSet('lsj-resume', null);
  let r = null; try { r = JSON.parse(raw); } catch (e) {}
  if (!r || r.uid !== S.me.id) return;
  if (r.type === 'meal') openMeal(r.id);
  else if (r.type === 'workout' || r.type === 'xunji') openWorkout(r.id);
  else if (r.type === 'body' && isDate(r.date)) { S.date = r.date; render(); openBody(r.date); }
  else if (r.type === 'profile') openProfile();
  else if (r.type === 'progress') openProgress();
}

/* ---------- events ---------- */
const SAVES = {
  'save-meal': saveMeal, 'save-workout': saveWorkout, 'save-body': saveBody, 'save-profile': saveProfile, 'save-password': savePassword, 'save-name': saveName,
  'user-save': saveUser, 'create-user': createUser, 'save-prefs': savePrefs, 'save-diet': saveDiet, 'save-quick': saveQuick, 'save-planex': savePlanEx, 'save-daymeta': saveDayMeta,
  'save-schedule': saveSchedule, 'save-qlog': saveQuickLog, 'save-sleep': saveSleep, 'save-health': saveHealth, 'save-xunji': saveXunji, 'save-xjkey': saveXjKey,
  'save-daymap': saveDayMap, 'save-daymap-day': saveDayMapDay, 'save-daymap-all': saveDayMapAll, 'save-progress': saveProgress,
  'lv-save': saveLive, 'inv-create': createInvite,
};
// Opening a sheet from inside another one: only once the first has closed (it may ask about unsaved changes).
const swapSheet = open => { closeSheet(); if (!S.sheet) open(); };
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act;
  if (/^[cd]-/.test(a)) return;  // claude.js (c-…) and stats.js (d-…) handle their own
  const inSheet = sheetEl.contains(t);
  const inMenu = !menuEl.hidden && menuEl.contains(t);
  if (inMenu && a !== 'menu-close') toggleMenu(false);
  if (inSheet && t.dataset.close) closeSheet(true);  // a sheet of choices: the choice replaces it
  const rowI = () => +t.closest('[data-i]').dataset.i;
  const sh = S.sheet;
  switch (a) {
    case 'tab': if (inSheet && S.sheet) closeSheet(true); setTab(t.dataset.tab); break;
    case 'sub-back': subBack(); break;
    case 'tb-food': $('#sec-food')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); break;
    case 'tb-train': $('#sec-train')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); break;
    case 'cb-reviews': showReviews(); break;
    case 'push-ask-go': S.meFocus = 'sec-push'; go('me'); break;
    case 'push-ask-x': lsSet('lsj-push-asked', today()); render(); toast('好，不提醒。想要的话在「我的 → 通知」里开'); break;
    case 'feel-open': openFeel(); break;
    case 'todo-all': S.todoAll = t.dataset.d; render(); break;
    case 'after-all': S.afterAll = today(); render(); break;
    case 'menu-water': waterTap(+t.dataset.ml, today()); break;
    case 'menu-weigh': openBody(today()); requestAnimationFrame(() => $('#f-w', sheetEl)?.focus()); break;
    case 'album-meal': if (!camBusy) albumIn.click(); break;
    case 'me-sec': openMeSec(t.dataset.k); break;
    case 'train-in-open': openTrainIn(); break;
    case 'date': goDate(t.dataset.d); break;
    case 'week': goDate(addDays(S.date, +t.dataset.n)); break;
    case 'today': goDate(today()); break;
    case 'retry': if (!S.me) { bootTries = 0; boot(); } else { S.db?.sync(true); flushAllWater(); } break;
    case 'add-menu': toggleMenu(); break;
    case 'menu-close': toggleMenu(false); break;
    case 'new-meal': openMeal(null, { date: inMenu ? today() : S.date }); break;
    case 'new-workout': openWorkout(null, t.dataset.day, { date: inMenu ? today() : S.date }); break;
    case 'bj-go': { const d = fval('bj-date'), pd = segVal('bj-day'); closeSheet(true); lvNew(isDate(d) && d <= today() ? d : today(), pd && pd !== 'free' ? pd : null); break; }
    case 'new-body': openBody(inMenu ? today() : S.date); break;
    case 'progress-new': openProgress(); break;
    case 'pp-view': { const p = sh?.slots?.[t.dataset.k]; if (p?.url) openLightbox(p.url); break; }
    case 'pp-del': { const p = sh?.slots?.[t.dataset.k]; if (!p) break; if (p.orig) sh.removed.push(p.id); else if (p.local) URL.revokeObjectURL(p.url); sh.slots[t.dataset.k] = null; drawSlots(); break; }
    case 'feel': tapFeel(t.dataset.k, +t.dataset.v); break;
    case 'push-on': pushEnable(); break;
    case 'onb-open': openOnb('hello'); break;
    case 'onb-basics': openOnb('basics'); break;
    case 'onb-skip': if (onb.step === 'start') onbFinish(false); else onbSkip(); break;
    case 'onb-back': if (!onb.busy) onbGo(-1); break;
    case 'onb-next': if (!onb.busy) onbGo(1); break;
    case 'onb-main': onbMain(); break;
    case 'onb-snap': onbFinish(true); break;
    case 'onb-finish': onbFinish(false); break;
    case 'onb-tpl': onbTpl(); break;
    case 'onb-wait': onbWait(); break;
    case 'plan-wait': openPlanWait(); break;
    case 'plan-review': askPlanReview(t); break;
    case 'privacy': e.preventDefault(); openPrivacy(); break;
    case 'a2hs': openA2hs(); break;
    case 'a2hs-off': lsSet('lsj-a2hs-off', today()); render(); toast('不再提示。想加的话，「我的 → 加到主屏幕」里有步骤'); break;
    case 'inv-new': openInvite(); break;
    case 'inv-share': shareInvite(); break;
    case 'inv-revoke': revokeInvite(t.dataset.id, t); break;
    case 'acct-del': openDeleteMe(); break;
    case 'acct-del-go': deleteMe(t); break;
    case 'token-go': makeToken(); break;
    case 'pk-cat': if (sh?.pk) { sh.pk.cat = t.dataset.v; drawPick(); } break;  // the picker's 动作库 part
    case 'push-test': pushTest(t); break;
    case 'push-off': pushOff(t); break;
    case 'place-hide': if (sh?.type === 'meal') { (sh.placeHide = sh.placeHide || []).push(t.dataset.n); drawPlaceTip(); } break;
    case 'places-ask': lc('compose', '我常去的店：'); break;
    case 'water-today': openWater(today()); break;
    case 'compose': lc('compose'); break;
    case 'go': if (inSheet && S.sheet) closeSheet(true); go(t.dataset.tab, t.dataset.focus); break;
    case 'report': openReport(t.dataset.id); break;
    case 'intake-info': openIntakeInfo(S.date); break;
    case 'train-more': openTrainMore(t.dataset.d || S.date); break;
    case 'day-switch': openDaySwitch(t.dataset.d || S.date); break;
    case 'tr-sheet': trToggle(t.dataset.d || S.date); break;
    case 'deload-open': openDeloadSheet(); break;
    case 'phase-open': openPhaseSheet(); break;
    case 'muscle-open': openMuscleSheet(); break;
    case 'diet-open': openDietSheet(S.date); break;
    case 'day-page': openHist({ view: 'day', id: t.dataset.id }); break;
    case 'ex-page': openHist({ view: 'exs' }); break;
    case 'tpl-ask': askTemplates(t); break;
    case 'daymap': editDayMap(t.dataset.t); break;
    case 'daymap-day': openDayMapDay(t.dataset.id); break;
    case 'daymap-all': openDayMapAll(); break;
    case 'health-setup': S.healthSetup = !S.healthSetup; render(); break;
    case 'meal': openMeal(t.dataset.id); break;
    case 'workout': openWorkout(t.dataset.id); break;
    case 'profile': openProfile(); break;
    case 'prefs': openPrefs(); break;
    case 'logout': {
      // this device stops getting this account's notifications (the browser keeps its subscription: the next sign-in
      // here hands it over again, to whoever signs in)
      const ep = S.push.sub?.endpoint;
      (ep ? req('DELETE', '/api/push/subscribe', { endpoint: ep }, { timeout: 5000 }).catch(() => {}) : Promise.resolve())
        .then(() => fetch('/api/logout', { method: 'POST' })).finally(() => { location.href = '/login'; });
      break;
    }
    case 'close': closeSheet(); break;
    case 'close-cancel': sheetMsg(null); break;
    case 'close-keep': writeDraft().finally(() => { closeSheet(true); toast('先放着了，下次打开接着填'); }); break;
    case 'close-drop': { const k = S.sheet?.dkey; if (k) dropDraft(k); closeSheet(true); break; }
    case 'draft-discard': { if (!sh) break; const r = sh.reopen; dropDraft(sh.dkey).finally(() => { closeSheet(true); r?.(); }); break; }
    case 'retry-save': if (S.sheet?.saveAct) runSave(SAVES[S.sheet.saveAct]); break;
    case 'relogin': relogin(); break;
    case 'toast-undo': { const f = toastFn; toastFn = null; toastEl.hidden = true; f?.(); break; }
    case 'seg': {
      const g = t.closest('.seg'); const was = t.getAttribute('aria-pressed') === 'true';
      const required = ['slot', 'day', 'kind', 'role'].includes(g.dataset.group) || g.classList.contains('req');
      if (was && required) break;
      g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      if (!was) t.setAttribute('aria-pressed', 'true');
      if (g.dataset.group === 'day') pickDay(t.dataset.v);
      if (g.dataset.group?.startsWith('ob-') && onb.open) onb.form[g.dataset.group.slice(3)] = t.dataset.v;  // 新人引导 ②
      if (g.dataset.group === 'ml') { const f = $('#f-ml', sheetEl); if (f) { f.value = ''; f.removeAttribute('aria-invalid'); } }
      if (g.dataset.group === 'theme') applyTheme(t.dataset.v);  // preview; saved with the sheet
      if (g.dataset.group === 'style') applyStyle(t.dataset.v);
      if (g.dataset.group === 'mult') drawQlSum();
      if (g.dataset.group === 'slot' && sh?.type === 'qlog' && fval('f-date') !== today()) { const f = $('#f-time', sheetEl); if (f) f.value = SLOT_TIME[t.dataset.v] || f.value; }
      if (sh?.type === 'water') updateWaterBtn();
      break;
    }
    case 'chip': t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true')); break;
    case 'ph-view': { const p = S.sheet?.[t.dataset.k || 'photos']?.[+t.dataset.i]; if (p) openLightbox(p.url); break; }
    case 'ph-del': {
      const list = S.sheet?.[t.dataset.k || 'photos']; const i = +t.dataset.i; const p = list?.[i]; if (!p) break;
      if (p.id) S.sheet.removed.push(p.id); if (p.local) URL.revokeObjectURL(p.url);
      list.splice(i, 1); drawPhotos(); break;
    }
    case 'meal-fb': mealFeedback(t); break;
    case 'todo': toggleDone(t.dataset.id, +t.dataset.i); break;
    case 'todo-skip': skipAction(t.dataset.id, +t.dataset.i); break;
    case 'todo-open': S.todoOpen = true; render(); requestAnimationFrame(() => $('#q-todo')?.focus()); break;
    case 'todo-add': addTodo(S.date); break;
    case 'mytodo': tickTodo(t.dataset.d, t.dataset.id); break;
    case 'mytodo-del': delTodo(t.dataset.d, t.dataset.id); break;
    case 'meal-all': mealAteAll(t.dataset.id, t); break;
    case 'meal-left': mealLeft(t.dataset.id); break;
    case 'quick-log': quickLog(+t.dataset.i, t.dataset.n, t); break;
    case 'quick-list': openQuickList(); break;
    case 'quick-pick': swapSheet(() => openQuickLog(+t.dataset.i)); break;
    case 'quick-edit': if (inSheet) swapSheet(openQuickEdit); else openQuickEdit(); break;
    case 'manual-clear': ['kcal', 'protein', 'carbs', 'fat'].forEach(k => { const f = $('#mn-' + k, sheetEl); if (f) { f.value = ''; f.removeAttribute('aria-invalid'); } }); break;
    case 'cam-meal': if (!camBusy) camIn.click(); break;
    case 'ask-opt': sendAnswer(t.dataset.v); break;
    case 'ask-send': sendAnswer(t.closest('.ask')?.querySelector('.ask-text')?.value); break;
    case 'ask-edit': { const el = $('#ask-box', sheetEl); if (el && S.sheet?.existing) { el.outerHTML = askHTML(S.sheet.existing, true); $('#ask-box .ask-text', sheetEl)?.focus(); } break; }
    case 'item-fix': openFix(t); break;
    case 'fix-kind': pickFix(t); break;
    case 'fix-save': saveFix(t, false); break;
    case 'fix-clear': saveFix(t, true); break;
    case 'fix-cancel': { t.closest('li')?.querySelector('.it')?.setAttribute('aria-expanded', 'false'); t.closest('.fix')?.remove(); break; }
    case 'quick-weigh': quickWeigh(); break;
    case 'skip-weigh': lsSet('lsj-noweigh', S.date); render(); break;
    case 'lb-close': lbEl.hidden = true; lbEl.innerHTML = ''; break;
    case 'del': onDelete(t); break;
    case 'fill-desc': { const ta = $('#f-desc', sheetEl); if (ta) { const v = ta.value.trim(); ta.value = v ? `${v.replace(/[、，,\s]+$/, '')}、${t.dataset.v}` : t.dataset.v; grow(ta); drawPlaceTip(); } break; }
    case 'water-add': waterTap(+t.dataset.ml); break;
    case 'day-plan': setDayPlan(t.dataset.d || S.date, t.dataset.v); break;
    case 'water-undo': undoWater(); break;
    case 'water-more': openWater(S.date); break;
    case 'habits-info': openHabitsInfo(); break;
    case 'save-water': saveWater(); break;
    case 'we-open': if (sh?.type === 'water') { sh.edit = +t.dataset.i; drawWaterList(); $('#we-ml', sheetEl)?.focus(); } break;
    case 'we-cancel': if (sh?.type === 'water') { sh.edit = null; drawWaterList(); } break;
    case 'we-save': waterEdit(false); break;
    case 'we-del': waterEdit(true); break;
    case 'w-clear': weightAct('clear'); break;
    case 'w-auto': weightAct('auto'); break;
    case 'bf-clear': weightAct('clear', 'bf'); break;
    case 'bf-auto': weightAct('auto', 'bf'); break;
    case 'sleep-open': { const d = t.dataset.d || S.date; if (inSheet) swapSheet(() => openSleep(d)); else openSleep(d); break; }
    case 'sleep-clear': sleepAction('clear', t); break;
    case 'sleep-auto': sleepAction('auto', t); break;
    case 'health-open': openHealth(t.dataset.d || S.date); break;
    case 'plan-restore': restoreCustom(t.dataset.p, t); break;
    case 'diet-edit': if (inSheet) swapSheet(openDiet); else openDiet(); break;
    case 'day-new': openDayMeta(null); break;
    case 'pd-adj': S.planAdj = !S.planAdj; render(); break;
    case 'pd-del': planDayDelete(t.dataset.id); break;
    case 'pd-up': case 'pd-down': planDayMove(t.dataset.id, a === 'pd-up' ? -1 : 1); break;
    case 'pd-rot': planDayRot(t.dataset.id); break;
    case 'pd-undo': S.planGone.find(g => g.id === t.dataset.id)?.undo(); break;
    case 'pd-mode': planRotMode(t.dataset.v === 'rot'); break;
    case 'pd-wk': planWeekday(+t.dataset.i); break;
    case 'dp-meta': openDayMeta(t.dataset.id || HIST.id); break;
    case 'dp-more': openDayMore(t.dataset.id || HIST.id); break;
    case 'dp-copy': planDayCopy(t.dataset.id); break;
    case 'dp-rot': planDayRot(t.dataset.id); break;
    case 'dp-del': { const id = t.dataset.id; if (HIST.open && HIST.view === 'day' && HIST.id === id) closeHist(); if (S.tab !== 'plan') setTab('plan'); planDayDelete(id); break; }
    case 'dp-adj': HIST.adj = !HIST.adj; drawHist(); break;
    case 'px-open': openPlanEx(t.dataset.id, +t.dataset.i); break;
    case 'px-add': openPlanPick(t.dataset.id); break;
    case 'px-del': planExDel(t.dataset.id, +t.dataset.i); break;
    case 'px-up': case 'px-down': planExMove(t.dataset.id, +t.dataset.i, a === 'px-up' ? -1 : 1); break;
    case 'px-undo': HIST.gone[+t.dataset.k]?.undo(); break;
    case 'sched-edit': openSchedule(); break;
    case 'qe-add': sh.items.push({ name: '', when: 'any' }); drawQE(); $('#qe-list .qe:last-child input[data-q="name"]', sheetEl)?.focus(); break;
    case 'qe-del': { const i = rowI(); const [x] = sh.items.splice(i, 1); drawQE(); toast(`删掉了「${x.name || '未命名'}」`, false, () => { if (S.sheet === sh) { sh.items.splice(Math.min(i, sh.items.length), 0, x); drawQE(); sheetChanged(); } }); break; }
    case 'qe-up': case 'qe-down': if (moveItem(sh.items, rowI(), a === 'qe-up' ? -1 : 1)) drawQE(); break;
    case 'qe-when': { const x = sh.items[rowI()]; if (x) { x.when = t.dataset.v; t.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === t))); } break; }
    case 'ro-up': case 'ro-down': if (moveItem(sh.items, rowI(), a === 'ro-up' ? -1 : 1)) drawRot(); break;
    case 'ro-x': sh.items.splice(rowI(), 1); drawRot(); break;
    case 'ro-add': if (!sh.items.includes(t.dataset.id)) { sh.items.push(t.dataset.id); drawRot(); } break;
    case 'xj-sync': xjSync(); break;
    case 'xj-keys-del': delXjKeys(t); break;
    case 'train-in': setTrainIn(t.dataset.v, t); break;
    // 训练中
    case 'lv-start': startLive(t.dataset.day); break;
    case 'lv-open': openLive(); break;
    case 'lv-min': closeLive(); break;
    case 'lv-edit': lvEdit(t.dataset.id); break;
    case 'lv-edit-close': lvEditClose(); break;
    case 'lv-edit-drop': lvEnd(); break;
    case 'lv-ex': lvExpand(+t.dataset.i); break;
    case 'lv-focus': lvFocusRow(t); break;
    case 'lv-step': lvStep(+t.dataset.i, +t.dataset.j, t.dataset.f, +t.dataset.d); break;
    case 'lv-tick': lvTick(+t.dataset.i, +t.dataset.j); break;
    case 'lv-tick-focus': if (LIVE.focus) lvTick(LIVE.focus.i, LIVE.focus.j); break;
    case 'lv-set-menu': lvSetMenu(+t.dataset.i, +t.dataset.j); break;
    case 'lv-set-warm': lvSetMark(+t.dataset.i, +t.dataset.j, 'warmup'); break;
    case 'lv-set-drop': lvSetMark(+t.dataset.i, +t.dataset.j, 'drop'); break;
    case 'lv-set-del': lvSetDel(+t.dataset.i, +t.dataset.j); break;
    case 'lv-set-add': lvSetAdd(+t.dataset.i, false); break;
    case 'lv-warm-add': lvSetAdd(+t.dataset.i, true); break;
    case 'lv-drop-add': lvDropAdd(+t.dataset.i); break;
    case 'lv-drop-after': lvDropAdd(+t.dataset.i, +t.dataset.j); break;
    case 'lv-ex-hist-all': { const x = LIVE.w?.exercises?.[+t.dataset.i]; if (x) openExSheet(x.name); break; }  // the exercise's sheet (动作进步)
    case 'lv-det': { const i = +t.dataset.i; LIVE.detOpen = LIVE.detOpen?.i === i ? null : { i }; drawLive(); break; }  // 目标 / 上次 / 配重 under 这次
    case 'lv-cons': toast('静息心率或 HRV 连续两天偏差：保持上次的重量、不冲纪录，晚上早点睡'); break;
    // 动作详情 (stats.js) from any exercise name; from a session's details the sheet gets 「‹ 那次训练」 (one swap, no more)
    case 'ex-open': openExSheet(t.dataset.n, inSheet && sh && (sh.type === 'workout' || sh.type === 'xunji') && !sh.isNew && !sh.backEx ? { backWo: sh.id } : null); break;
    case 'ex-back': { const n = S.sheet?.backEx; if (S.sheet) S.sheet.backEx = null; closeSheet(true); openExSheet(n); break; }
    case 'health-sync': runHealthShortcut(); break;
    case 'lv-watch-ok': lsSet('lsj-watch-tip', '1'); drawLive(); break;
    // 训练历史
    case 'hist': openHist(); break;
    case 'hs-back': closeHist(); break;
    case 'hs-m': histMonth(+t.dataset.n); break;
    case 'hs-day': histDay(t.dataset.d); break;
    case 'hs-f': if (HIST.filter !== t.dataset.v) { HIST.filter = t.dataset.v; HIST.n = 30; drawHist(); } break;
    case 'hs-wo': openWorkout(t.dataset.id); break;
    case 'hs-part': if (HIST.part !== t.dataset.v) { HIST.part = t.dataset.v; drawHist(); } break;
    case 'hs-today': { closeHist(); if (S.date !== today()) S.date = today(); setTab('today'); break; }
    case 'hs-more': histMore(); break;
    case 'hs-start': { const day = t.dataset.day; closeHist(); startLive(day); break; }  // the plan day's page: the page goes, the session starts
    case 'lv-ex-menu': lvExMenu(+t.dataset.i); break;
    case 'lv-ex-swap': lvPicker(+t.dataset.i); break;
    case 'lv-ex-note': lvNote(+t.dataset.i); break;
    case 'lv-note-save': lvNoteSave(); break;
    case 'lv-ex-up': case 'lv-ex-down': lvMove(+t.dataset.i, a === 'lv-ex-up' ? -1 : 1); break;
    case 'lv-ex-del': lvExDel(+t.dataset.i); break;
    case 'lv-ex-kind': lvSetKind(+t.dataset.i, t.dataset.k); break;
    case 'lv-ex-add': lvPicker(null); break;
    case 'pk-pick': pickGo(t.dataset.n); break;
    case 'pk-new': pickGo(sh?.pk?.q, t.dataset.k); break;
    case 'lv-rir': lvRir(t.dataset.v); break;
    case 'lv-set-rpe': lvSetRpe(+t.dataset.i, +t.dataset.j, t.dataset.v); break;
    case 'rp-plan': rpDecide(t, t.dataset.id, +t.dataset.k, true); break;
    case 'rp-once': rpDecide(t, t.dataset.id, +t.dataset.k, false); break;
    case 'day-from-wo': { const w = S.workouts.find(x => x.id === t.dataset.id); if (w) planDayFrom(w); break; }
    case 'deload-go': deloadGo(t); break;
    case 'deload-no': lsSet(deloadKey(), today()); render(); toast('好，一周内不再提'); break;
    case 'plan-tpl': openPlanTpl({ swap: !!S.plan }); break;
    case 'plan-swap': openPlanSwap(); break;
    case 'tp-days': if (sh?.type === 'plan-tpl') { sh.tp.days = +t.dataset.v; tplRebuild(); drawTpl(); } break;
    case 'tp-place': if (sh?.type === 'plan-tpl') { sh.tp.place = t.dataset.v; tplRebuild(); drawTpl(); } break;
    case 'tp-open': if (sh?.type === 'plan-tpl') { sh.tp.open = sh.tp.open === t.dataset.id ? '' : t.dataset.id; tplRebuild(); drawTpl(); } break;
    case 'tp-swap': if (sh?.type === 'plan-tpl') tplSwap(+t.dataset.d, +t.dataset.i); break;
    case 'tp-go': savePlanTpl(t); break;
    case 'tpl-guide-off': lsSet(tplGuideKey(), 'off'); render(); break;
    case 'px-sets': if (sh?.type === 'plan-ex') { const x = sh.items[0], n = Math.max(1, Math.min(10, (parseInt(x.sets, 10) || 3) + +t.dataset.d)); x.sets = n; const el = t.parentElement.querySelector('.de-n'); if (el) el.textContent = String(n); } break;
    case 'px-rest': if (sh?.type === 'plan-ex') { const x = sh.items[0]; x.rest = t.dataset.v ? `${t.dataset.v}s` : ''; const inp = sheetEl.querySelector('[data-e="rest"]'); if (inp) inp.value = x.rest; t.parentElement.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b === t))); } break;
    case 'px-step': if (sh?.type === 'plan-ex') { const x = sh.items[0], v = Number(t.dataset.v); if (v > 0) x.step = v; else delete x.step; t.parentElement.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b === t))); } break;
    case 'px-swap': if (sh?.type === 'plan-ex') { const id = sh.dayId, sw = { i: sh.i, name0: sh.name0 }; swapSheet(() => openPlanPick(id, sw)); } break;
    case 'px-copy': case 'px-move': if (sh?.type === 'plan-ex') planExTo(sh, t.dataset.to, a === 'px-move'); break;
    case 'px-del-sheet': if (sh?.type === 'plan-ex') { const { dayId, i, name0 } = sh; sh.saved = true; closeSheet(true); planExDel(dayId, i, name0); } break;
    case 'lv-more': lvMore(); break;
    case 'lv-rest-sub': lvRestAdd(-30); break;
    case 'lv-rest-add': lvRestAdd(30); break;
    case 'lv-rest-skip': lvRestStop(); break;
    case 'lv-finish': lvFinish(); break;
    case 'lv-discard': lvDiscard(t); break;
    case 'lv-del-edit': lvDelEdit(t); break;
    case 'lv-stale-finish': lvStaleFinish(); break;
    case 'lv-stale-drop': { const day = sh?.dayId; lvDiscard(t, () => startLive(day)); break; }
    case 'xj-key': openXjKey(t.dataset.kind); break;
    case 'xj-key-del': delXjKey(t, t.dataset.kind); break;
    case 'acct-pw': openPassword(false); break;
    case 'acct-name': openName(); break;
    case 'logout-others': req('POST', '/api/me/logout-others').then(r => { toast(`已退出 ${r.removed} 台其他设备`); refreshMe(); }, e => toast(errMsg(e), true)); break;
    case 'user-new': openNewUser(); break;
    case 'user': openUser(t.dataset.id); break;
    case 'user-reset': userAction('reset', t); break;
    case 'user-toggle': userAction('toggle', t); break;
    case 'user-del': userAction('del', t); break;
    case 'copy': copyText(t.dataset.v, t); break;
    case 'copy-url': copyText(t.dataset.v, t); break;
    case 'export': exportData(t); break;
    case 'export-save': exportSave(); break;
    case 'token-new': createToken(); break;
    case 'token-del': req('DELETE', '/api/me/tokens/' + encodeURIComponent(t.dataset.id)).then(() => { toast('已撤销，用这个令牌的快捷指令会同步失败'); loadTokens(); }, e => toast(errMsg(e), true)); break;
    default: if (SAVES[a]) submit(a);
  }
  if (inSheet && S.sheet && !['close', 'close-keep', 'close-drop', 'close-cancel', 'draft-discard'].includes(a)) { if (S.sheet.type === 'profile') profileReplan(); sheetChanged(); }
});
viewEl.addEventListener('change', e => {
  if (e.target.classList?.contains('day-pick')) setDayPlan(S.date, e.target.value);
  if (e.target.dataset?.push) setPushKind(e.target.dataset.push, e.target.checked);
  if (e.target.dataset?.pref === 'advanced') setAdvanced(e.target.checked, e.target);
});
// 进阶显示 from 「我的」: merged into profile/prefs; the page follows at once.
async function setAdvanced(on, el) {
  if (!S.db) { if (el) el.checked = !on; return; }
  const was = S.prefs ? clone(S.prefs) : null;
  S.prefs = { ...(S.prefs || {}), advanced: !!on }; render();
  try { await saveFields('profile', 'prefs', was, { advanced: !!on, updatedAt: nowIso() }); toast(on ? '进阶显示开了：RPE、递减组、训练量这些都会显示' : '进阶显示关了：专业的数和词先收起来'); }
  catch (e) { S.prefs = was; render(); toast(errMsg(e), true); }
}
viewEl.addEventListener('input', e => {
  if (e.target.id === 'q-w') { S.qw = e.target.value; markNum(e.target); }
  if (e.target.id === 'q-todo') S.qt = e.target.value;
});
viewEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  if (e.target.id === 'q-w') quickWeigh();
  if (e.target.id === 'q-todo') { e.preventDefault(); addTodo(S.date); }
});
// The date at the top: a transparent date input; the picker opens on tap (showPicker where a click alone doesn't).
topEl.addEventListener('click', e => { if (e.target.id === 'top-date-in') { try { e.target.showPicker?.(); } catch (err) {} } });
topEl.addEventListener('change', e => { if (e.target.id === 'top-date-in' && isDate(e.target.value)) goDate(e.target.value); });
// Number fields go red as soon as they hold something that isn't a number.
function markNum(el, int) {
  const v = parseNum(el.value, int ?? !!el.dataset.int);
  if (Number.isNaN(v)) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  return v;
}
sheetEl.addEventListener('input', e => {
  const el = e.target, sh = S.sheet;
  if (el.id === 'f-replan' && sh) sh.replanTouched = true;  // the person's own choice from now on
  if (el.dataset.num) markNum(el);
  if (el.classList?.contains('grow')) grow(el);
  if (el.id === 'f-desc' && sh?.type === 'meal') drawPlaceTip();
  if (sh?.type === 'water' && el.id === 'f-ml') { if (el.value.trim()) sheetEl.querySelectorAll('[data-group="ml"] button').forEach(b => b.setAttribute('aria-pressed', 'false')); updateWaterBtn(); }
  if (el.id === 'f-ml' && el.value.trim()) sheetEl.querySelectorAll('[data-group="ml"] button').forEach(b => b.setAttribute('aria-pressed', 'false'));
  if (el.id === 'f-title' && sh?.type === 'workout') sh.title = el.value;
  if (el.dataset.q && sh?.type === 'quick-edit') {  // 快捷清单 rows keep what was typed; numbers are read on save
    const x = sh.items[+el.closest('.qe').dataset.i];
    if (x) { x[el.dataset.q] = el.value; if (el.dataset.q !== 'name') markNum(el); }
  }
  if (el.dataset.e && sh?.type === 'plan-ex') {
    sh.items[0][el.dataset.e] = el.value;
    if (el.dataset.e === 'rest') el.closest('.de-f')?.querySelectorAll('.de-rest .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v && `${b.dataset.v}s` === el.value.trim())));
  }
  if (sh?.type === 'diet') dietInput(el);
  if (sh?.type === 'profile') profileReplan();
  if (sh?.pk && el.id === 'lp-q') { sh.pk.q = el.value; drawPick(); }
  if (sh?.type === 'live-more' && el.id === 'lv-title') lvMoreInput(el);
  sheetChanged();
});
sheetEl.addEventListener('change', e => {
  const el = e.target, sh = S.sheet;
  if (el.dataset?.ph) onFiles(el);
  if (el.dataset?.pp) onSlotFile(el);
  if (el.id === 'f-date') updateDateChip();
  if (el.id === 'f-date' && sh?.type === 'qlog') { const tf = $('#f-time', sheetEl); if (tf) tf.value = el.value === today() ? nowHM() : SLOT_TIME[segVal('slot')] || tf.value; }
  if (el.id === 'dr-on') { const box = $('#dr-box', sheetEl); if (box) box.hidden = !el.checked; dietHints(); }
  if (el.id === 'ro-on' && sh?.type === 'schedule') schedMode(el.checked);
  if (el.id === 'f-replan' && sh) sh.replanTouched = true;
  if (sh?.type === 'profile') profileReplan();
  if (sh?.type === 'live-more') lvMoreInput(el);
  sheetChanged();
});
// 新人引导 ②: what is typed is kept in onb.form (the step redraws from it), numbers checked as they are typed.
onbEl?.addEventListener('input', e => {
  const el = e.target, k = { 'ob-age': 'age', 'ob-h': 'height', 'ob-w': 'weight' }[el.id];
  if (k) { onb.form[k] = el.value; markNum(el); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (S.sheet?.type === 'workout' || LIVE.open) && wakeOn()) keepAwake(true);
  if (document.visibilityState === 'visible') { liveTick(); if (LIVE.w && LIVE.rev !== LIVE.savedRev) lvSave(); }
  if (document.visibilityState === 'hidden') writeDraft();
});
window.addEventListener('pagehide', () => { writeDraft(); });
// Enter sends an answer to Claude / saves an item correction (not while an IME is still composing).
sheetEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  const c = e.target.classList;
  if (c?.contains('ask-text')) { e.preventDefault(); sendAnswer(e.target.value); }
  else if (c?.contains('fix-note')) { e.preventDefault(); saveFix(e.target, false); }
  else if (e.target.id === 'we-ml' || e.target.id === 'we-t') { e.preventDefault(); waterEdit(false); }
  else if (e.target.id === 'lp-q' && S.sheet?.pk) { e.preventDefault(); pickEnter(e.target.value); }
});
document.addEventListener('submit', e => { e.preventDefault(); if (e.target.id === 'pw-form') submit('save-password'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!lbEl.hidden) { lbEl.hidden = true; return; } if (!menuEl.hidden) { toggleMenu(false); return; } if (S.sheet || !sheetEl.hidden) { closeSheet(); return; } if (HIST.open) { closeHist(); return; } if (LIVE.open && LIVE.mode === 'live') closeLive(); } });

/* ---------- data ---------- */
// Every request times out (photos after 45 s, the rest after 20 s) and can be cancelled through `signal`.
async function req(method, url, body, o = {}) {
  const isBlob = body instanceof Blob;
  const ctl = new AbortController(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, o.timeout || (isBlob ? 45000 : 20000));
  const stop = () => ctl.abort();
  if (o.signal) { if (o.signal.aborted) ctl.abort(); else o.signal.addEventListener('abort', stop); }
  let res, data;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin', signal: ctl.signal,
      headers: { ...(isBlob ? { 'Content-Type': body.type || 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) },
      body: isBlob ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    data = await res.json().catch(e => { if (e?.name === 'AbortError') throw e; return {}; });
  } catch (e) {
    if (o.signal?.aborted) throw { code: 'aborted', message: '已取消' };
    if (timedOut) throw { code: 'timeout', message: '网络太慢，超时了' };
    throw { code: 'unavailable', message: '网络不可用' };
  } finally { clearTimeout(timer); o.signal?.removeEventListener('abort', stop); }
  if (res.status === 401) {
    // With a form open, don't navigate away: the form is kept and the person signs in again from the sheet.
    if (S.sheet && S.sheet.type !== 'password') { S.authLost = true; if (!sheetEl.querySelector('[data-act="relogin"]')) failBar('登录已失效，先别关，重新登录后再保存', 'relogin', '重新登录'); }
    else if (o.stay) S.authLost = true;  // the caller keeps what it has in a form first (一拍记一餐)
    else location.href = '/login';
    throw { code: 'unauthenticated', message: '需要登录' };
  }
  if (data.error?.code === 'must_change_password') openPassword(true);
  if (!res.ok) throw { ...(data.error && typeof data.error === 'object' ? data.error : {}), code: data.error?.code || (res.status >= 500 ? 'unavailable' : 'invalid_argument'), message: data.error?.message || res.statusText, status: res.status };
  return data;
}
// Collections the page reads: [order, limit, how rows become state, loaded keys].
const byDate = rows => Object.fromEntries(rows.map(r => [r.date || r.id, { ...r, date: r.date || r.id }]).filter(([d]) => isDate(d)));
const byDateDesc = (a, z) => String(z.date).localeCompare(String(a.date));
const COLS = {
  meals: ['date', 600, rows => { S.meals = rows.filter(r => isDate(r.date)).sort(byDateDesc); }, ['meals']],
  // a session still being logged (status 'active', 训练中) is kept apart: S.activeWorkout, the newest one; S.workouts
  // (and so every card, the 五件套, records and stats.js) only has finished ones
  workouts: ['date', 300, rows => {
    const ok = rows.filter(r => isDate(r.date)), act = ok.filter(r => r.status === 'active');
    S.activeWorkout = act.sort((a, z) => String(z.startedAt || z.createdAt || '').localeCompare(String(a.startedAt || a.createdAt || '')))[0] || null;
    S.workouts = ok.filter(r => r.status !== 'active').sort(byDateDesc);
  }, ['workouts']],
  body: ['date', 200, rows => { S.body = byDate(rows); }, ['body']],
  water: ['date', 200, rows => { S.water = byDate(rows); }, ['water']],
  sleep: ['date', 200, rows => { S.sleep = byDate(rows); }, ['sleep']],
  days: ['date', 200, rows => { S.days = byDate(rows); }, ['days']],
  health: ['date', 200, rows => { S.health = byDate(rows); }, ['health']],
  todos: ['date', 200, rows => { S.todos = byDate(rows); }, ['todos']],
  reports: ['createdAt', 120, rows => { S.reports = rows.sort((a, z) => String(z.createdAt || '').localeCompare(String(a.createdAt || ''))); }, ['reports']],
  plan: [null, 20, rows => { S.plan = rows.find(r => r.id === 'current') || null; }, ['plan']],
  profile: [null, 5, rows => { S.profile = rows.find(r => r.id === 'main') || null; S.prefs = rows.find(r => r.id === 'prefs') || null; prefsLoaded(); }, ['profile', 'prefs']],
  meta: [null, 50, rows => { const g = id => rows.find(r => r.id === id) || null; S.status = g('status'); S.xunji = g('xunji'); S.insights = g('insights'); S.memory = g('memory'); S.foods = g('foods'); S.places = g('places'); }, ['status', 'xunji', 'insights', 'memory', 'foods', 'places']],
  // 身材照, newest first (stats.js shows them side by side)
  progress: ['date', 100, rows => { S.progress = rows.filter(r => isDate(r.date)).sort(byDateDesc); }, ['progress']],
  // Claude's side (claude.js): proposals and questions, the person's messages, what Claude did
  inbox: ['createdAt', 100, rows => { S.inbox = rows.sort((a, z) => String(z.createdAt || '').localeCompare(String(a.createdAt || ''))); }, ['inbox']],
  messages: ['createdAt', 100, rows => { S.messages = rows.sort((a, z) => String(z.createdAt || '').localeCompare(String(a.createdAt || ''))); }, ['messages']],
  log: ['at', 100, rows => { S.log = rows.sort((a, z) => String(z.at || '').localeCompare(String(a.at || ''))); }, ['log']],
};
// Collections a server from before the Claude tab doesn't have: treated as empty there.
const OPTIONAL_COLS = ['inbox', 'messages', 'log', 'progress'];
// Collections with a date per record: an older stretch is loaded on demand (S.db.ensure) and kept across reloads.
const DATE_COLS = ['meals', 'workouts', 'body', 'water', 'sleep', 'days', 'health', 'todos', 'reports'];
const netErr = e => e?.code === 'unavailable' || e?.code === 'timeout';
function onLoadErr(e) { if (netErr(e) && S.dbState !== 'offline') { S.dbState = 'offline'; render(); } }
// Our REST API behind a small store. The page keeps a copy of each collection (with versions); its own writes update
// that copy from the write's response, and a 15 s poll of the revision number reloads everything when someone else
// (Claude, Apple Health, another phone) changed something.
function makeStore() {
  const raw = {}, revs = {}, wseq = {};
  // collections this server doesn't have (an older server without inbox / messages / log): empty, never asked again
  const absent = new Set();
  // cover[col]: from this date on everything is loaded ('' = the whole collection); ranging[col]: a range load in flight
  const cover = {}, ext = {}, ranging = {}, rangeFail = {};
  let lastRev = -1, own = 0, polling = false;
  const back = () => { if (S.dbState !== 'ok') { S.dbState = 'ok'; flushAllWater(); render(); } };
  function derive(col) {
    if (!raw[col]) return;
    COLS[col][2]([...raw[col]].map(([id, x]) => ({ ...x.data, id })));
    COLS[col][3].forEach(k => S.loaded.add(k));
    render(); tryResume();
    if (col === 'workouts') liveSync();
  }
  async function load(col) {
    const [order, n] = COLS[col];
    if (absent.has(col)) return;
    const qs = new URLSearchParams(); if (order) { qs.set('order', order); qs.set('dir', 'desc'); } if (n) qs.set('limit', String(n));
    for (let i = 0; i < 3; i++) {
      const seq = wseq[col] || 0;
      let r;
      try { r = await req('GET', `/api/c/${col}?${qs}`); }
      catch (e) {
        if (!OPTIONAL_COLS.includes(col) || (e?.status !== 400 && e?.status !== 404)) throw e;
        absent.add(col); raw[col] = new Map(); derive(col); return;
      }
      back();
      if ((wseq[col] || 0) !== seq && i < 2) continue;  // one of our writes landed meanwhile: this list may predate it
      const fresh = new Map(r.docs.map(d => [d.id, { data: d.data, version: d.version }]));
      if (DATE_COLS.includes(col)) {
        // the oldest date in a full page may be cut off half way: only the dates after it are complete
        const edge = r.docs.length >= n ? r.docs.map(d => d.data?.date).filter(isDate).sort()[0] || '' : '';
        if (ext[col] && edge && raw[col]) for (const [id, x] of raw[col]) if (!fresh.has(id) && isDate(x.data?.date) && x.data.date <= edge) fresh.set(id, x);
        cover[col] = !edge ? '' : ext[col] && ext[col] <= edge ? ext[col] : addDays(edge, 1);
      }
      raw[col] = fresh;
      revs[col] = r.rev; derive(col); return;
    }
  }
  // Make sure every date collection is loaded from `from` on: the dates before what the first page held are fetched
  // with a date range and merged in (nothing newer is dropped).
  function ensure(from) {
    if (!isDate(from)) return;
    for (const col of DATE_COLS) {
      const c = cover[col];
      if (!raw[col] || !c || c <= from || ranging[col] || Date.now() - (rangeFail[col] || 0) < 30000) continue;
      ranging[col] = true;
      const qs = new URLSearchParams({ limit: '5000' });
      qs.append('where', `date:gte:${JSON.stringify(from)}`); qs.append('where', `date:lte:${JSON.stringify(c)}`);
      req('GET', `/api/c/${col}?${qs}`).then(r => {
        const m = raw[col]; if (!m) return;
        for (const d of r.docs) if (!m.has(d.id)) m.set(d.id, { data: d.data, version: d.version });
        ext[col] = ext[col] && ext[col] < from ? ext[col] : from;
        if (cover[col] && cover[col] > from) cover[col] = from;
        derive(col);
      }).catch(e => { rangeFail[col] = Date.now(); onLoadErr(e); }).finally(() => { ranging[col] = false; });
    }
  }
  const loadAll = () => Promise.all(Object.keys(COLS).map(c => load(c).catch(onLoadErr)));
  async function sync(force) {
    if (polling && !force) return; polling = true;
    try {
      const { rev } = await req('GET', '/api/rev');
      back();
      const diff = rev - lastRev;
      if (force || lastRev < 0 || diff < 0 || diff > own) { lastRev = rev; own = 0; await loadAll(); }
      else if (diff > 0) { lastRev = rev; own -= diff; }  // only our own writes, already applied
    } catch (e) { onLoadErr(e); }
    polling = false;
  }
  function local(col, id, doc) {
    wseq[col] = (wseq[col] || 0) + 1;
    if (!raw[col]) return;
    if (doc && doc.data) raw[col].set(id, { data: doc.data, version: doc.version }); else raw[col].delete(id);
    derive(col);
  }
  function docRef(col, id) {
    const url = `/api/d/${col}/${encodeURIComponent(id)}`;
    const write = async (method, data, o = {}) => {
      own++;
      try {
        const r = await req(method, url, data, { headers: o.ifVersion != null ? { 'If-Match': String(o.ifVersion) } : null, signal: o.signal, stay: o.stay });
        local(col, id, method === 'DELETE' ? null : r);
        return r;
      } catch (e) { own--; throw e; }
    };
    return {
      id,
      async get(o = {}) {  // {exists, version (0 when missing), data}
        try { const d = await req('GET', url, undefined, { signal: o.signal }); return { exists: true, version: d.version, data: d.data }; }
        catch (e) { if (e.code === 'not_found') return { exists: false, version: 0, data: null }; throw e; }
      },
      set: (data, o) => write('PUT', data, o),
      update: (data, o) => write('PATCH', data, o),
      delete: o => write('DELETE', undefined, o),
    };
  }
  // The copy on this phone, if that collection has loaded (a doc missing from it is tried as new; the server says if not).
  function cached(col, id) {
    const m = raw[col]; if (!m) return null;
    const x = m.get(id);
    return x ? { exists: true, version: x.version, data: clone(x.data) } : { exists: false, version: 0, data: null };
  }
  function start() {
    Promise.all(Object.keys(COLS).map(c => load(c).catch(onLoadErr))).then(() => {
      const rs = Object.keys(COLS).filter(c => !absent.has(c)).map(c => revs[c]);
      if (lastRev < 0 && rs.every(v => v != null)) lastRev = Math.min(...rs);
    });
    setInterval(() => { if (document.visibilityState === 'visible') sync(false); }, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(false); });
  }
  return { collection: col => ({ doc: id => docRef(col, id) }), cached, sync, start, ensure, cover: () => ({ ...cover }) };
}
const photoStore = {
  upload: (blob, o) => req('POST', '/api/photos', blob, o),
  delete: id => req('DELETE', '/api/photos/' + encodeURIComponent(id)),
};

// The app may sit in the background overnight: when "today" moves on, follow it if today was on screen.
let shownToday = today();
function rollDay() {
  const t = today(); if (t === shownToday) return;
  if (S.date === shownToday) S.date = t;
  shownToday = t; render();
}
// Parts of 今天 that change with the clock alone: the after-meal chips, the protein card, the stale Health line.
// Redrawn when one of them would look different from the last draw.
let clockShown = '';
function clockSig() {
  if (S.tab !== 'today' || S.date !== today()) return '';
  return [S.meals.filter(askAfter).map(m => m.id).join(','), tmin(nowHM()) >= 18 * 60, lateNow(), nextRunTxt(), healthStale(S.date), feelShown(S.date)].join('|');
}
function clockTick() { if (document.visibilityState === 'visible' && clockSig() !== clockShown) render(); }
document.addEventListener('visibilitychange', clockTick);
setInterval(clockTick, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rollDay(); });
window.addEventListener('pageshow', rollDay);
setInterval(rollDay, 60000);

function applyMe() {
  syncDayStart();  // profile/prefs.dayStartHour first, then the server's value for this account
  if (S.me?.id) lsSet('lsj-uid', S.me.id);
}
// Starting up retries until the server answers (with backoff, when the network comes back, when the app is reopened,
// or from the banner's 重试); until then the page says 正在读取 rather than showing an empty day.
let bootTimer = null, booting = false, bootTries = 0, draftsReady = false;
async function boot() {
  if (booting || S.me) return;
  booting = true; clearTimeout(bootTimer);
  try { S.me = await req('GET', '/api/me'); }
  catch (e) {
    booting = false;
    if (e.code === 'unauthenticated') return;
    S.dbState = 'offline'; bootTries++; render();
    bootTimer = setTimeout(boot, Math.min(60000, 2000 * 2 ** Math.min(bootTries - 1, 5)));
    return;
  }
  booting = false; S.dbState = 'ok';
  applyMe();
  loadWaterQueue();
  loadDrafts().catch(() => {}).finally(() => { draftsReady = true; tryResume(); });
  if (S.me.mustChange) { render(); openPassword(true); return; }
  startData();
}
function startData() {
  if (S.db) return;
  S.db = makeStore(); S.assets = photoStore; S.canPhoto = true; S.dbState = 'ok';
  draw();
  flushAllWater();  // taps made while signing in, or left over from last time
  if (S.tab === 'me') { loadUsers(); loadTokens(); }
  loadXj();
  S.db.start();
  pushInit();
}
window.addEventListener('online', () => { if (!S.me) { bootTries = 0; boot(); } else { S.db?.sync(true); flushAllWater(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !S.me) boot(); });

// 「Claude」 answers on a meal or a workout: answer {text, at, q} with needsReview, on the latest version.
async function answerAsk(col, id, text) {
  if (!['meals', 'workouts'].includes(col) || !S.db) throw { code: 'invalid_argument', message: '没法回答这条' };
  const rec = (col === 'meals' ? S.meals : S.workouts).find(x => x.id === id), a = askOf(rec);
  if (!a) throw { code: 'not_found', message: '这个问题已经不在了' };
  text = String(text || '').trim().slice(0, 200);
  if (!text) throw badInput('先写一句再回答');
  const answer = { text, at: nowIso(), q: a.q };
  await patchDoc(col, id, () => ({ answer, needsReview: true }));
  return answer;
}
// profile/prefs fields from outside the 偏好设置 sheet (claude.js: autonomy): merged onto the latest version.
async function patchPrefs(patch) {
  if (!S.db) throw { code: 'unavailable', message: '网络不可用' };
  if (!patch || typeof patch !== 'object') return null;
  return saveFields('profile', 'prefs', S.prefs ? clone(S.prefs) : null, { ...patch, updatedAt: nowIso() });
}

// 动作进步 (stats.js's sheet) from an exercise name anywhere: over 训练中 straight away; over a sheet (a session's
// details) that sheet closes first, a form with unsaved changes asks first and the name has to be tapped again.
// 动作详情 (stats.js) over whatever is open; o.backWo: the session it was opened from (「‹ 那次训练」 in the sheet).
function openExSheet(name, o) {
  const f = window.LSJData?.openEx, key = String(name || '').trim();
  if (typeof f !== 'function' || !key) return;
  if (S.loaded.has('workouts') && !exRows().some(r => r.name === key)) { toast(`还没有「${key}」的记录`); return; }
  if (S.sheet) { if (S.sheet.form && isDirty()) { closeSheet(); return; } S.sheet.backEx = null; closeSheet(true); }
  try { f(key, o && typeof o === 'object' ? o : {}); } catch (e) { console.error(e); }
}
// 「‹ 那次训练」 in 动作详情: back to the session's details.
function woBack(id) { if (S.sheet) closeSheet(true); if (S.workouts.some(w => w.id === id)) openWorkout(id); }
// 简称 in the 训练日 form: its placeholder follows the name being typed
sheetEl.addEventListener('input', e => { if (e.target.id === 'dm-name' && S.sheet?.type === 'day-meta') { const s = $('#dm-short', sheetEl); if (s) s.placeholder = dayShort({ id: S.sheet.dayId || '', name: e.target.value }) || '胸'; } });

// For stats.js (数据) and claude.js (Claude): the page's state and helpers. S is the live object; the names also go
// on window.
window.LSJ = {
  S, $, esc, today, addDays, daysBetween, parseD, isoWd, fmtDay, fmtTs, fmtRel, md, mdw, fmt, numTxt, isDate, isNum, median, lsGet, lsSet, hm,
  intake, mealNums, targetsFor, dayKind, plannedDay, waterTarget, waterDay, waterSum, drinkIntake, latestWeight, weightSrc, weightCleared,
  planDays, rotation, trainedOn, weekCount, woStats, setTxt, setsTxt, workSets, hasSetData, exHistory, activityBonus, recovery,
  dayShort, dayShortOf, exPart, exInfo, exRx, ruleRx, stepOf, humanTarget, woTitle, openExSheet,
  exMuscles, muscleWeights, planWeeklySets, MUSCLES, MUSCLE_RANGE, deloadDue, inDeload, deloadSets, openPlanTpl, openDayEdit: id => openDayPage(id),
  hval, hIgnored, healthWin, recBase, hrv3, rhrFlag, hrvFlag,
  dayActions, isDone, isSkipped, todoItems, statsHTML, goalsHTML, reportHTML, reportBody, openReport, showSheet, closeSheet, render, toast, errMsg, confirmTap, seg, chips,
  prefs, prefOn, advOn, advanced: advOn, waterPresets, restPref, ensureRange: from => S.db?.ensure(from),
  req, answerAsk, askOf, editDayMap, xjSync, pendingCount, savePrefs: patchPrefs, go, newId, patchDoc, retry1, nowIso,
  openMeal: id => openMeal(id), openWorkout: (id, dayId, opts) => openWorkout(id, dayId, opts || {}), openRecord: (col, id) => col === 'meals' ? openMeal(id) : openWorkout(id),
  openPhoto, openProgress: d => openProgress(isDate(d) ? d : today()),
  KINDS, GOALS, LEVELS, SLOTS, MACROS, MKEYS, RATING, WD, DRINK_MACROS,
  dayStartHour: () => dayStart, nextRunTxt, runTimes, tempTargets,
  openHist, openDietSheet, woBack, planExs, rxFor,
  openXjKey: kind => { if (S.sheet) { closeSheet(); if (S.sheet) return; } openXjKey(kind === 'template' ? 'template' : 'train'); },
};
// Skip names app.js keeps for itself on window (savePrefs is the 偏好设置 sheet's save inside app.js; on window it
// would only confuse).
Object.assign(window, Object.fromEntries(Object.entries(window.LSJ).filter(([k]) => k !== 'savePrefs')));
draw();
boot();
// The service worker (the offline copy of the page, and notifications) is registered on every start, signed in or not
// yet; pushInit registers the same one again once signed in.
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
// claude.js and stats.js load after this file: draw again once they are there (the Claude tab, its badge).
document.addEventListener('DOMContentLoaded', render);
})();

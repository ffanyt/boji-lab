/* 薄肌研究所 · Claude: the person's back-and-forth with their coach. The page (右上角 ✦, S.tab 'claude') is one line on
   when Claude looks, what waits for the person's say (plan proposals, 训记 template writes, Claude's questions), a box
   to tell Claude something, and one timeline of the exchange, newest first: what they wrote and Claude's replies, the
   reports, the plan changes Claude made (with 撤回) and the proposals they decided. Two more pieces for app.js's pages:
   todayHTML() (今日's 「等你拍板」, compact) and meHTML() (我的 → Claude: how much Claude may do, its voice, what it
   remembers, everything it did, the dishes it knows, the 训记 titles), each row opening a sheet.
   A render from app.js's state (window.LSJ, like stats.js); every tap is data-act="c-…", handled by this file's own
   listeners on document, so the pieces work on whichever page shows them. Records and their fields:
   docs/data-model.md (inbox, messages, log, reports, meta/memory, meta/foods). */
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

/* ---------- utils ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = v => Array.isArray(v) ? v : [];
const str = v => typeof v === 'string' ? v : v == null ? '' : String(v);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const nowIso = () => new Date().toISOString();
const ms = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; };
const WD = '日一二三四五六';
const md = d => `${+String(d).slice(5, 7)}/${+String(d).slice(8, 10)}`;
const mdw = d => `${md(d)}（周${WD[parseD(d).getDay()]}）`;
const numTxt = v => Number.isInteger(v) ? v.toLocaleString('en-US') : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
const dayStart = () => { const h = has('dayStartHour') ? A.dayStartHour() : 5; return Number.isInteger(h) ? h : 5; };
// The person's "today" (their day start included); app.js knows it, this is only the fallback.
function tday() {
  if (has('today')) return A.today();
  const d = new Date(); if (d.getHours() < dayStart()) d.setDate(d.getDate() - 1);
  return ymd(d);
}
// A timestamp's day the way the person counts days (01:30 belongs to the evening before), and its clock time.
function dayOf(iso) { const d = new Date(iso); if (isNaN(d)) return ''; if (d.getHours() < dayStart()) d.setDate(d.getDate() - 1); return ymd(d); }
const clockOf = iso => { const d = new Date(iso); return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function dayWord(d, t = tday()) { return d === t ? '今天' : d === addDays(t, -1) ? '昨天' : d === addDays(t, 1) ? '明天' : md(d); }
const when = iso => { const d = dayOf(iso); return d ? `${dayWord(d)} ${clockOf(iso)}` : ''; };
const toast = (m, err, fn, label) => { if (has('toast')) A.toast(m, err, fn, label); };
const rerender = () => { if (has('render')) A.render(); };
const newId = p => has('newId') ? A.newId(p) : p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const planDays = () => has('planDays') ? arr(A.planDays()) : arr(S.plan?.training?.days);
const SLOTS = { breakfast: '早餐', lunch: '午餐', snack: '加餐', dinner: '晚餐', late: '夜宵' };
const KINDS = { daily: '日报', weekly: '周报', plan: '计划', phase: '阶段', guide: '说明' };  // short: the tag sits in a row
const CHEV = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const BACK = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

function errTxt(e) {
  const m = { stale: '计划已经变了，等 Claude 重新出提案', no_template_key: '还没存训记模版 key：在「我的 → 训记」里填', not_open: '这条已经处理过了，刷新看看',
    already_undone: '已经撤回过了', gone: e?.message }[e?.code];
  if (m) return m;
  if (/[一-鿿]/.test(e?.message || '') && !['conflict', 'invalid_argument'].includes(e?.code)) return e.message;  // the server's own reason
  return has('errMsg') ? A.errMsg(e) : '没成功，稍后再试';
}
// The decisions only the page may make (同意 / 不要 / 回答 / 撤回): the server's own endpoints, not a document write.
async function post(url, body = {}, o = {}) {
  if (has('req')) return A.req('POST', url, body, o);
  let res, data;
  try {
    res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    data = await res.json().catch(() => ({}));
  } catch (e) { throw { code: 'unavailable', message: '网络不可用' }; }
  if (res.status === 401) { location.href = '/login'; throw { code: 'unauthenticated' }; }
  if (!res.ok) throw { ...(isObj(data.error) ? data.error : {}), code: data.error?.code || (res.status >= 500 ? 'unavailable' : 'invalid_argument'), status: res.status };
  return data;
}
// A write onto the latest copy of one document: build(cur) gives {set}, {update} or {del} (null: nothing to write).
// It goes on the version read; when someone else wrote meanwhile (Claude, another phone), it reads again and rebuilds.
async function writeDoc(col, id, build) {
  const ref = S.db.collection(col).doc(id);
  let cur = S.db.cached(col, id) || await ref.get();
  for (let i = 0; ; i++) {
    const w = build(cur);
    if (!w) return null;
    try {
      if (w.del) return await ref.delete({ ifVersion: cur.version });
      if (w.update) return await ref.update(w.update, { ifVersion: cur.version });
      return await ref.set(w.set, { ifVersion: cur.version });
    } catch (e) { if (e?.code !== 'conflict' || i >= 3) throw e; cur = await ref.get(); }
  }
}
function go(tab, focus) {
  if (has('go')) return A.go(tab, focus);
  if (focus) S.claudeFocus = focus;
  const b = document.querySelector(`[data-act="tab"][data-tab="${tab}"]`);
  if (b) b.click(); else { S.tab = tab; rerender(); }
}
// A sheet that only shows things (like stats.js): app.js's close button and Escape take it down. sh: the type, or
// {type, …} kept on S.sheet (this file's sheets redraw themselves from it, see refreshSheet).
function openSheet(sh, title, body, foot = '<button type="button" class="btn ghost main" data-act="close">关闭</button>') {
  if (!has('showSheet')) return false;
  if (S.sheet && has('closeSheet')) A.closeSheet();
  if (S.sheet) return false;  // a form with unsaved changes asked first
  S.sheet = typeof sh === 'string' ? { type: sh } : { ...sh, html: body, foot };
  A.showSheet(title, body, foot);
  return true;
}
const closeSheet = () => { if (has('closeSheet')) A.closeSheet(true); };

/* ---------- view state (this visit) ---------- */
const busy = {};                    // "inbox:<id>", "log:<id>", "ans:<key>", "msg:<id>", "send", "auto" → a request in flight
const ansDraft = {};                // what was typed under a question
const seenNow = new Set();          // replies shown during this visit keep their 「新」 until the page is left
const seenWriting = new Set();      // replySeen on its way to the server
const seenWait = new Set();         // replies waiting for the person to stop typing
const decided = new Set();          // inbox items decided or answered here, until the next read says so
let draft = lsGet('lsj-c-draft') || '', draftKind = lsGet('lsj-c-draft-kind') || null;
let logAll = false, noTplKey = false, autoLocal = null, personaLocal = null, tlDays = 14, tlN = 5;
function setDraft(v, kind) {
  draft = String(v ?? '').slice(0, 500);
  if (kind !== undefined) draftKind = kind || null;
  if (!draft.trim()) draftKind = null;
  lsSet('lsj-c-draft', draft); lsSet('lsj-c-draft-kind', draftKind);
}

/* ---------- what needs the person ---------- */
const inboxOpen = () => arr(S.inbox).filter(x => isObj(x) && x.status === 'open' && !decided.has(x.id));
const isProposal = x => x.kind === 'plan' || x.kind === 'xunji';
const hasReply = m => isObj(m.reply) && typeof m.reply.text === 'string' && !!m.reply.text.trim();
// Claude's question on a meal or a workout (review.ask) and the answer that goes with it: the same test as app.js.
function askOf(rec) {
  const a = rec?.review?.ask; if (!isObj(a) || typeof a.q !== 'string' || !a.q.trim()) return null;
  const ans = isObj(rec.answer) && typeof rec.answer.text === 'string' && rec.answer.text ? rec.answer : null;
  const fits = ans && (typeof ans.q === 'string' ? ans.q === a.q : Date.parse(ans.at) >= (Date.parse(rec.review.reviewedAt || '') || 0));
  return { q: a.q, options: arr(a.options).filter(o => typeof o === 'string' && o.trim()).slice(0, 8), answer: fits ? ans : null };
}
// Meals and workouts of the last 7 days that carry a question: [{col, rec, a}], newest first.
function recAsks(t = tday()) {
  const from = addDays(t, -6), out = [];
  for (const [col, list] of [['meals', S.meals], ['workouts', S.workouts]]) {
    for (const rec of arr(list)) { if (!(str(rec.date) >= from)) continue; const a = askOf(rec); if (a) out.push({ col, rec, a }); }
  }
  return out.sort((x, y) => str(y.rec.date).localeCompare(str(x.rec.date)) || str(y.rec.time).localeCompare(str(x.rec.time)));
}
function needs() {
  if (!bind()) return { proposals: 0, questions: 0, replies: 0 };
  queueRefresh();
  if (S.tab !== 'claude') { seenNow.clear(); tlDays = 14; tlN = 5; }
  const open = inboxOpen();
  return {
    proposals: open.filter(isProposal).length,
    questions: open.filter(x => x.kind === 'question').length + recAsks().filter(x => !x.a.answer).length,
    replies: arr(S.messages).filter(m => isObj(m) && hasReply(m) && !m.replySeen && !seenWriting.has(m.id)).length,
  };
}
function badge() { const n = needs(); return n.proposals + n.questions + n.replies; }

/* ---------- 1. when Claude looks ---------- */
function nextRun(auto) {
  const n = auto?.next; if (typeof n !== 'string' || !n) return '';
  if (/^\d{1,2}:\d{2}$/.test(n)) return n;
  const d = dayOf(n); if (!d) return '';
  const t = tday();
  return d === t ? clockOf(n) : `${dayWord(d, t)} ${clockOf(n)}`;
}
const nextTxt = () => nextRun(S.status?.auto) || (has('nextRunTxt') ? A.nextRunTxt() : '');
// 「上次看 10/19 23:30 · 下次约 15:00 · 看了 8 餐 1 次训练」: the only place on this page that says when.
function topHTML() {
  const st = isObj(S.status) ? S.status : {}, auto = isObj(st.auto) ? st.auto : null;
  const p = isObj(st.processed) ? st.processed : {};
  const seen = [isNum(p.meals) && p.meals ? `${p.meals} 餐` : '', isNum(p.workouts) && p.workouts ? `${p.workouts} 次训练` : ''].filter(Boolean).join(' ');
  const nx = nextTxt();
  const bits = st.lastRunAt ? [`上次看 ${when(st.lastRunAt)}`, nx ? `下次约 ${nx}` : '', seen ? `看了 ${seen}` : '']
    : ['Claude 还没看过你的记录', nx ? `下次约 ${nx}` : ''];
  const failed = auto && auto.ok === false ? `<span class="cl-warn">上次没看完${auto.at ? `（${esc(when(auto.at))}）` : ''}，下次接着看</span>` : '';
  return `<p class="cl-top" id="cl-top">${bits.filter(Boolean).map(b => `<span>${esc(b)}</span>`).join('')}${failed}</p>`;
}

/* ---------- 2. 等你拍板 ---------- */
// How a plan value reads: paths are plan/current's dot paths (training.days.<id>… goes by the day's id).
const PL = {
  'diet.kcal': '训练日热量', 'diet.protein': '训练日蛋白质', 'diet.carbs': '训练日碳水', 'diet.fat': '训练日脂肪', 'diet.water': '喝水目标',
  'diet.restDay': '休息日目标', 'diet.restDay.kcal': '休息日热量', 'diet.restDay.protein': '休息日蛋白质', 'diet.restDay.carbs': '休息日碳水', 'diet.restDay.fat': '休息日脂肪',
  'diet.quick': '快捷清单', 'diet.guidelines': '饮食要点', 'diet.meals': '一天怎么吃', 'diet': '饮食目标', 'training': '训练安排',
  'training.schedule': '每周安排', 'training.rotation': '轮换顺序', 'training.note': '训练说明', 'training.days': '训练日', phase: '阶段', summary: '计划概要', notes: 'Claude 的说明',
};
const DAYF = { name: '名字', focus: '重点', note: '说明', exercises: '动作' };
const MAC = [['kcal', '', 'kcal'], ['protein', '蛋白质', 'g'], ['carbs', '碳水', 'g'], ['fat', '脂肪', 'g']];
const dayRe = /^training\.days\.([^.]+)(?:\.(.+))?$/;
function pathLabel(p) {
  if (PL[p]) return PL[p];
  const m = dayRe.exec(p);
  if (m) { const d = planDays().find(x => x?.id === m[1]); return m[2] ? `${m[1]} 日 · ${DAYF[m[2]] || m[2]}` : `${m[1]} 日${d?.name ? `（${d.name}）` : ''}`; }
  return p;
}
const schedTxt = s => [1, 2, 3, 4, 5, 6, 7].filter(i => s?.[i]).map(i => `周${WD[i % 7]} ${s[i]}`).join('、') || '全部休息';
const macroTxt = o => MAC.filter(([k]) => isNum(o?.[k])).map(([k, l, u]) => `${l ? l + ' ' : ''}${numTxt(o[k])} ${u}`).join(' · ');
function valTxt(path, v) {
  const leaf = path.split('.').pop();
  if (v == null) return { 'training.rotation': '不轮换', 'diet.restDay': '和训练日一样', 'diet.quick': '没有' }[path] || (/^training\.days\.[^.]+$/.test(path) ? '没有这一天' : '没设');
  if (isNum(v)) return numTxt(v) + ({ kcal: ' kcal', protein: ' g', carbs: ' g', fat: ' g', water: ' ml' }[leaf] || '');
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (leaf === 'schedule' && isObj(v)) return schedTxt(v);
  if (Array.isArray(v)) {
    if (!v.length) return '空';
    if (v.every(x => typeof x === 'string')) return v.join(leaf === 'rotation' ? ' → ' : '、');
    if (v.every(x => isObj(x) && x.name)) return v.map(x => x.name).join('、');
    if (v.every(x => isObj(x) && x.slot)) return v.map(x => x.slot).join('、');
    return `${v.length} 项`;
  }
  if (isObj(v)) {
    if ('exercises' in v || ('name' in v && 'id' in v)) return `${v.name || v.id || ''}${Array.isArray(v.exercises) ? ` · ${v.exercises.length} 个动作` : ''}`;
    return macroTxt(v) || '…';
  }
  return String(v);
}
const exSpec = e => [isNum(e.sets) || e.sets ? `${e.sets}×${e.reps ?? ''}` : '', str(e.load)].filter(Boolean).join(' · ');
const quickSpec = q => [isNum(q.kcal) ? `${numTxt(q.kcal)} kcal` : '', isNum(q.protein) ? `蛋白质 ${numTxt(q.protein)} g` : ''].filter(Boolean).join(' · ');
// Two lists of named things (exercises, the quick list) as what changed, went and came: [[kind, name, text]].
function nameDiff(a, b, spec, extra) {
  const an = new Map(), bn = new Map(), out = [], gone = [], came = [];
  a.filter(isObj).forEach(x => an.set(str(x.name), x)); b.filter(isObj).forEach(x => bn.set(str(x.name), x));
  for (const x of b.filter(isObj)) {
    const o = an.get(str(x.name));
    if (!o) { came.push(['add', x.name, spec(x)]); continue; }
    const parts = [];
    if (spec(o) !== spec(x)) parts.push(`${spec(o) || '—'} → ${spec(x) || '—'}`);
    if (extra) parts.push(...extra(o, x));
    if (parts.length) out.push(['mod', x.name, parts.join('；')]);
  }
  for (const x of a.filter(isObj)) if (!bn.has(str(x.name))) gone.push(['del', x.name, spec(x)]);
  const all = [...out, ...gone, ...came];
  if (!all.length && a.map(x => str(x?.name)).join('|') !== b.map(x => str(x?.name)).join('|')) all.push(['mod', '顺序', '调整了先后']);
  return all;
}
const exExtra = (o, x) => [str(o.rest) !== str(x.rest) ? `休息 ${o.rest || '—'} → ${x.rest || '—'}` : '', str(o.cue) !== str(x.cue) ? '要点改了' : ''].filter(Boolean);
function dayDiff(a, b) {
  const out = [];
  for (const k of ['name', 'focus', 'note']) if (str(a[k]) !== str(b[k])) out.push(['mod', DAYF[k], `${str(a[k]) || '—'} → ${str(b[k]) || '—'}`]);
  return out.concat(nameDiff(arr(a.exercises), arr(b.exercises), exSpec, exExtra));
}
function schedDiff(a, b) {
  const out = [];
  for (let i = 1; i <= 7; i++) { const x = str(a?.[i]) || '休息', y = str(b?.[i]) || '休息'; if (x !== y) out.push(['mod', `周${WD[i % 7]}`, `${x} → ${y}`]); }
  return out;
}
const DM = { add: ['+', '新加'], del: ['−', '去掉'], mod: ['•', '改'] };
const diffHTML = list => list.length
  ? `<ul class="cl-dl">${list.map(([k, n, t]) => `<li class="${k}"><span class="cl-dm" aria-label="${DM[k][1]}">${DM[k][0]}</span><span><b>${esc(n)}</b>${t ? ` <span class="cl-ds">${esc(t)}</span>` : ''}</span></li>`).join('')}</ul>`
  : '<p class="cl-ds">看起来没有变化</p>';
function chgHTML(ch) {
  const path = str(ch.path), label = str(ch.label) || pathLabel(path), from = ch.from, to = ch.to, m = dayRe.exec(path);
  let diff = null;
  if (m && m[2] === 'exercises' && Array.isArray(from) && Array.isArray(to)) diff = nameDiff(from, to, exSpec, exExtra);
  else if (m && !m[2] && isObj(from) && isObj(to)) diff = dayDiff(from, to);
  else if (m && !m[2] && isObj(to) && from == null) diff = arr(to.exercises).filter(isObj).map(e => ['add', e.name, exSpec(e)]);
  else if (path === 'training.schedule' && isObj(from) && isObj(to)) diff = schedDiff(from, to);
  else if (path === 'diet.quick' && Array.isArray(to)) diff = nameDiff(arr(from), to, quickSpec);
  const ft = typeof ch.fromText === 'string' && ch.fromText ? ch.fromText : valTxt(path, from);
  const tt = typeof ch.toText === 'string' && ch.toText ? ch.toText : valTxt(path, to);
  const line = m && !m[2] && to == null ? `<span class="cl-v"><b class="cl-new del">删掉这一天</b><span class="cl-old">${esc(ft)}</span></span>`
    : m && !m[2] && from == null ? `<span class="cl-v"><b class="cl-new">新加一天：${esc(tt)}</b></span>`
    : `<span class="cl-v"><span class="cl-old">${esc(ft)}</span><span class="cl-arr" aria-label="改成">→</span><b class="cl-new">${esc(tt)}</b></span>`;
  const showLine = !diff || ch.toText || (m && !m[2] && (from == null || to == null));
  return `<li class="cl-chg"><span class="cl-chg-l">${esc(label)}</span>${showLine ? line : ''}${diff && !(m && !m[2] && to == null) ? diffHTML(diff) : ''}</li>`;
}

// 训记 Agent 模版: read from the mutation itself (what will really be written), not from Claude's summary.
const tplNames = () => new Map(arr(S.xunji?.agentTemplates).filter(isObj).map(t => [str(t.template_id), str(t.name)]));
function setTxt(s) {
  if (!isObj(s)) return '';
  const sec = [s.time, s.duration, s.seconds, s.sec].find(isNum);
  const reps = isNum(s.reps) ? `${s.reps}` : '';
  if (sec != null && !reps) return `${sec} 秒`;
  if (s.selfWeight) return `自重${reps ? ` × ${reps}` : ''}`;
  if (isNum(s.weight)) return `${numTxt(s.weight)} ${esc(s.unit || 'kg')}${reps ? ` × ${reps}` : ''}`;
  return reps ? `${reps} 次 · 重量自己填` : '';
}
function mvRow(mv, oneInc) {
  const sets = arr(mv.sets), first = setTxt(sets[0]), last = setTxt(sets[sets.length - 1]);
  const same = sets.every(s => setTxt(s) === first);
  const main = sets.length ? `${sets.length} 组 · ${same ? first : `${first} … ${last}`}` : '组数没写';
  const p = isObj(mv.progression) ? mv.progression : null;
  const prog = p && isNum(p.target_reps) ? `${oneInc || !isNum(p.reps_increment) ? '' : `每次 +${p.reps_increment} 次，`}到 ${p.target_reps} 次后${isNum(p.weight_increment) ? ` +${numTxt(p.weight_increment)} kg` : '加重'}${isNum(p.reset_reps) ? `，回到 ${p.reset_reps} 次` : ''}` : '';
  return `<li><span class="cl-mv-n">${esc(mv.name || '（没写名字）')}</span><span class="cl-mv-s">${main}</span>${prog ? `<span class="cl-mv-p">${esc(prog)}</span>` : ''}</li>`;
}
function xunjiHTML(x) {
  const mu = isObj(x.mutation) ? x.mutation : {}, ups = arr(mu.upserts).filter(isObj), dels = arr(mu.deletes), days = isObj(x.days) ? x.days : {};
  const names = tplNames(), pd = new Map(planDays().filter(isObj).map(d => [d.id, d]));
  const incs = new Set(ups.flatMap(u => arr(u.movements)).map(m => m?.progression?.reps_increment).filter(isNum));
  const oneInc = incs.size === 1 ? [...incs][0] : null;
  const many = ups.length > 2;
  const blocks = ups.map((u, i) => {
    const isNew = !u.template_id, dayId = days[u.client_id] || days[u.template_id], day = dayId ? pd.get(dayId) : null;
    const was = !isNew && names.get(str(u.template_id)), mvs = arr(u.movements).filter(isObj);
    return `<details class="cl-tpl" data-key="cl-tpl-${esc(x.id)}-${i}"${many ? '' : ' open'}><summary>
        <span class="cl-op ${isNew ? 'new' : 'upd'}">${isNew ? '新建' : '更新'}</span><b class="cl-tpl-n">${esc(u.name || '（没写名字）')}</b>
        <span class="cl-tpl-s">${day?.name && day.name !== u.name ? `对应「${esc(day.name)}」 · ` : ''}${mvs.length} 个动作${was && was !== u.name ? ` · 原来叫「${esc(was)}」` : ''}</span></summary>
      <ul class="cl-mv">${mvs.map(m => mvRow(m, oneInc != null)).join('')}</ul></details>`;
  });
  const delRows = dels.map(d => { const id = str(isObj(d) ? d.template_id : d), n = names.get(id); return `<div class="cl-tpl cl-tpl-del"><span class="cl-op del">删除</span><b class="cl-tpl-n">${n ? esc(n) : '一个模版'}</b>${n ? '' : `<span class="cl-tpl-s">${esc(id.slice(-6))}</span>`}</div>`; });
  const fu = isObj(mu.folder_update) && mu.folder_update.name ? `<p class="cl-ds">文件夹改名为「${esc(mu.folder_update.name)}」</p>` : '';
  const rule = oneInc != null ? `<p class="cl-ds">递增：每练一次每组多做 ${numTxt(oneInc)} 次，做到目标次数后加重量、次数退回起点。</p>` : '';
  // x.summary is bin/xunji's check output: the same as the blocks above, so it isn't repeated
  return `<div class="cl-tpls">${blocks.join('')}${delRows.join('')}</div>${fu}${rule}`;
}
function tplKey() {
  if (noTplKey) return false;
  const k = S.xunji?.keys;  // meta/xunji.keys follows every sync; GET /api/xunji (S.xj) only when it is read again
  if (isObj(k) && 'template' in k) return !!k.template;
  if (isObj(S.xj) && 'hasTemplateKey' in S.xj) return !!S.xj.hasTemplateKey;
  return null;  // not known: the server says so when it is missing
}
// 同意 / 写进训记 (or 先去存模版 key) and 不要, for a card (cls '') or a sheet's footer (cls 'main' on the first).
function propBtns(x, inSheet) {
  const b = busy['inbox:' + x.id], dis = b ? ' disabled' : '';
  const isX = x.kind === 'xunji', key = isX ? tplKey() : true;
  const yes = isX && key === false
    ? `<button type="button" class="btn primary${inSheet ? ' main' : ''}" data-act="c-gokey">先去存模版 key</button>`
    : `<button type="button" class="btn primary${inSheet ? ' main' : ''}" data-act="c-accept" data-id="${esc(x.id)}"${dis}>${b === 'accept' ? (isX ? '正在写进训记…' : '正在改…') : isX ? '写进训记' : '同意'}</button>`;
  const no = `<button type="button" class="btn ghost" data-act="c-decline" data-id="${esc(x.id)}"${dis}>${b === 'decline' ? '…' : '不要'}</button>`;
  return inSheet ? no + yes : yes + no;
}
function propHTML(x, inSheet) {
  const isX = x.kind === 'xunji', key = isX ? tplKey() : true;
  const body = isX ? xunjiHTML(x) : `<ul class="cl-chgs">${arr(x.changes).filter(isObj).map(chgHTML).join('') || '<li class="cl-ds">（这个提案没写改什么）</li>'}</ul>`;
  return `<article class="${inSheet ? '' : 'panel '}cl-prop" id="${inSheet ? 'cl-ps' : 'cl-p'}-${esc(x.id)}">
    <div class="cl-prop-h">${inSheet ? '' : `<span class="cl-kind">${isX ? '写进训记' : '改计划'}</span>`}<span class="cl-when">${esc(when(x.createdAt))}</span></div>
    <h3>${esc(x.title || (isX ? '写进训记' : '计划改动'))}</h3>${x.why ? `<p class="cl-why">${esc(x.why)}</p>` : ''}
    ${body}
    ${isX && key === false ? '<p class="cl-ds">写进训记要用训记的「模版 key」，存在「我的 → 训记」里。</p>' : isX ? '<p class="cl-ds">只改训记里「Agent 模版」这个文件夹，你的训练记录不动。</p>' : ''}
    ${inSheet ? '' : `<div class="cl-acts">${propBtns(x)}</div>`}</article>`;
}
const DONE = {
  accepted: ['cl-k-ok', '同意了'], declined: ['cl-k-no', '不要了'], failed: ['cl-k-fail', '没写成'], stale: ['cl-k-no', '过期了'], done: ['cl-k-ok', '办完了'],
};

/* ---------- Claude's questions ---------- */
function recLabel(col, r) {
  if (col === 'meals') {
    const what = str(r.desc).trim() || arr(r.review?.items).map(i => str(i?.name)).filter(Boolean).slice(0, 2).join('、');
    return [`${md(r.date)} ${SLOTS[r.slot] || '一餐'}`, what];
  }
  return [`${md(r.date)} 训练`, str(r.title)];
}
const askKey = (col, rec) => `${col === 'meals' ? 'm' : 'w'}:${rec.id}`;
function ansBox(key, options, b) {
  const dis = b ? ' disabled' : '';
  return `${options.length ? `<div class="cl-opts">${options.map(o => `<button type="button" class="chip" data-act="c-ans-opt" data-k="${esc(key)}" data-v="${esc(o)}"${dis}>${esc(o)}</button>`).join('')}</div>` : ''}
    <div class="cl-ans"><input type="text" id="c-ans-${esc(key)}" data-k="${esc(key)}" maxlength="200" enterkeyhint="send" autocomplete="off" aria-label="回答 Claude" placeholder="${options.length ? '或者自己写…' : '写一句回答'}" value="${esc(ansDraft[key] || '')}"${dis}><button type="button" class="btn primary sm" data-act="c-ans-send" data-k="${esc(key)}"${dis}>${b ? '…' : '发送'}</button></div>`;
}
const qOpts = x => arr(x.options).filter(o => typeof o === 'string' && o.trim()).slice(0, 8);
const recLink = (col, rec) => { const [l, s] = recLabel(col, rec); return `<button type="button" class="cl-q-rec" data-act="c-open-rec" data-col="${col}" data-id="${esc(rec.id)}"><span class="ag-mark" aria-hidden="true"></span><span>关于 <b>${esc(l)}</b>${s ? ` · ${esc(s)}` : ''}</span><span class="cl-go">${col === 'meals' ? '看这一餐' : '看这次训练'}</span></button>`; };
function questionCards(t) {
  return [
    ...inboxOpen().filter(x => x.kind === 'question').map(x => `<article class="panel cl-q"><div class="cl-q-h"><span class="ag-mark" aria-hidden="true"></span><span class="cl-when">${esc(when(x.createdAt))}</span></div>
      <p class="cl-q-q">${esc(x.q || x.title || '')}</p>${x.why ? `<p class="cl-why">${esc(x.why)}</p>` : ''}${ansBox('i:' + x.id, qOpts(x), busy['ans:i:' + x.id])}</article>`),
    ...recAsks(t).filter(x => !x.a.answer).map(({ col, rec, a }) => `<article class="panel cl-q">${recLink(col, rec)}
        <p class="cl-q-q">${esc(a.q)}</p>${ansBox(askKey(col, rec), a.options, busy['ans:' + askKey(col, rec)])}</article>`),
  ];
}
function decideHTML(t) {
  const props = inboxOpen().filter(isProposal), qs = questionCards(t), n = props.length + qs.length;
  if (!n) return '';
  return `<section class="sec cl-sec" id="cl-decide"><div class="sec-h"><h2>等你拍板</h2><span class="count">${n}</span></div>
    ${props.length ? `<div id="cl-proposals">${props.map(x => propHTML(x)).join('')}</div>` : ''}${qs.length ? `<div id="cl-questions">${qs.join('')}</div>` : ''}</section>`;
}

/* ---------- 3. 告诉 Claude ---------- */
const QUICK = [
  ['这周没空', '这周没空，只能练 '], ['身体不舒服', '身体不舒服：'], ['想换个动作', '想换个动作：'], ['不想吃…', '不想再吃'],
  ['把计划写进训记', '把现在的计划写进训记模版', 'xunji-templates'],
];
const xjLinked = () => !!(S.xunji?.linked || S.xj?.hasKey || S.xunji?.keys?.train || S.xunji?.keys?.template);
function quickList() {
  const xjOpen = inboxOpen().some(x => x.kind === 'xunji');
  return QUICK.map((q, i) => [i, ...q]).filter(([, , , k]) => k !== 'xunji-templates' || (xjLinked() && S.prefs?.trainIn !== 'app' && !xjOpen));
}
const quickChips = () => `<div class="chips cl-quick">${quickList().map(([i, l]) => `<button type="button" class="chip" data-act="c-chip" data-i="${i}">${esc(l)}</button>`).join('')}</div>`;
const PH = '比如：这周出差只能练 3 天 / 左膝有点疼 / 不想再吃鸡胸了';
function composeHTML() {
  const b = busy.send;
  return `<section class="sec cl-sec" id="cl-compose"><div class="sec-h"><h2>告诉 Claude</h2></div>
    <div class="panel cl-compose">
      <textarea id="c-msg" rows="2" maxlength="500" placeholder="${PH}" aria-label="告诉 Claude 的话"${b ? ' disabled' : ''}>${esc(draft)}</textarea>
      ${quickChips()}
      <div class="cl-compose-f"><span class="cl-hint">Claude 下次处理时照办，回复在下面</span><button type="button" class="btn primary sm" data-act="c-send"${b ? ' disabled' : ''}>${b ? '发送中…' : '发送'}</button></div>
    </div></section>`;
}
async function send(text, kind) {
  if (!bind() || !S.db) throw { code: 'unavailable', message: '还没连上服务器' };
  text = String(text ?? '').trim().slice(0, 500);
  if (!text) throw { code: 'invalid_input', message: '先写一句再发送' };
  const id = newId('m');
  const data = { text, createdAt: nowIso(), status: 'new', needsReview: true };
  if (kind) data.kind = kind;
  await S.db.collection('messages').doc(id).set(data, { ifVersion: 0 });
  return { id, ...data };
}
async function sendDraft(fromSheet) {
  if (busy.send) return;
  const el = document.getElementById(fromSheet ? 'c-cmp' : 'c-msg');
  const text = (el ? el.value : draft).trim();
  if (!text) { if (fromSheet) closeSheet(); else { toast('先写一句再发送', true); el?.focus(); } return; }
  busy.send = true;
  if (fromSheet) { const btn = document.getElementById('c-cmp-btn'); if (btn) { btn.disabled = true; btn.textContent = '发送中…'; } }
  else rerender();
  try {
    await send(text, draftKind);
    setDraft('', null);
    if (fromSheet) closeSheet();
    const away = S.tab !== 'claude';
    toast(away ? '已告诉 Claude，下次处理时会看' : '已告诉 Claude', false, away ? () => go('claude', 'messages') : undefined, away ? '去看看' : undefined);
  } catch (e) {
    toast(e?.code === 'invalid_input' ? e.message : errTxt(e), true);
    if (fromSheet) { const btn = document.getElementById('c-cmp-btn'); if (btn) { btn.disabled = false; btn.textContent = '发送'; } }
  }
  busy.send = false; rerender();
}
// The sheet for telling Claude something from anywhere (＋, 今日). It shares the draft with the page's box.
function compose(prefill, kind) {
  if (!bind()) return;
  if (typeof prefill === 'string' && prefill.trim()) setDraft(prefill, kind ?? null);
  else if (kind) draftKind = kind;
  const body = `<textarea id="c-cmp" rows="4" maxlength="500" placeholder="${PH}" aria-label="告诉 Claude 的话">${esc(draft)}</textarea>
    ${quickChips()}<p class="hint" style="margin:0">Claude 下次处理时照办，回复在右上角 ✦ 里。</p>`;
  if (!openSheet('c-compose', '告诉 Claude', body, `<button type="button" class="btn ${draft.trim() ? 'primary' : 'ghost'} main" data-act="c-cmp-send" id="c-cmp-btn">${draft.trim() ? '发送' : '关闭'}</button>`)) return;
  const el = document.getElementById('c-cmp');
  if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} grow(el); }
}
function chipFill(i, inSheet) {
  const q = QUICK[i]; if (!q) return;
  const el = document.getElementById(inSheet ? 'c-cmp' : 'c-msg');
  const cur = (el ? el.value : draft).trim(), isPre = !cur || QUICK.some(x => x[1].trim() === cur);
  setDraft(isPre ? q[1] : `${cur}；${q[1]}`, isPre ? (q[2] || null) : (q[2] || draftKind));
  if (el) { el.value = draft; el.focus(); try { el.setSelectionRange(draft.length, draft.length); } catch (e) {} grow(el); }
  if (inSheet) cmpBtn();
}
function cmpBtn() {
  const b = document.getElementById('c-cmp-btn'); if (!b || b.disabled) return;
  const on = !!draft.trim();
  b.textContent = on ? '发送' : '关闭'; b.classList.toggle('primary', on); b.classList.toggle('ghost', !on);
}
async function delMsg(id, btn) {
  if (has('confirmTap') && !A.confirmTap(btn, '确认删除', '删除')) return;
  busy['msg:' + id] = true; btn.disabled = true;
  try {
    await writeDoc('messages', id, cur => {
      if (!cur.exists) return null;
      if (cur.data?.status !== 'new') throw { code: 'gone', message: 'Claude 已经处理了这条，删不了' };
      return { del: true };
    });
    toast('删掉了');
  } catch (e) { toast(errTxt(e), true); }
  delete busy['msg:' + id]; rerender();
}
// A reply counts as seen once it has been on screen; the write waits while the person is typing on this page,
// since the redraw it brings would interrupt the input method.
function markSeen(id) {
  if (seenWriting.has(id) || !S.db) return;
  const m = arr(S.messages).find(x => x.id === id); if (!m || m.replySeen) return;
  seenNow.add(id);
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && document.getElementById('view')?.contains(a); };
  if (typing()) {
    if (!seenWait.has(id)) { seenWait.add(id); document.addEventListener('focusout', () => { seenWait.delete(id); setTimeout(() => markSeen(id), 50); }, { once: true }); }
    return;
  }
  seenWriting.add(id);
  writeDoc('messages', id, cur => cur.exists && hasReply(cur.data || {}) && !cur.data.replySeen ? { update: { replySeen: true } } : null)
    .catch(() => {}).finally(() => { seenWriting.delete(id); });
}
let io = null;
function watchReplies() {
  io?.disconnect(); io = null;
  const els = [...document.querySelectorAll('#view .cl-reply[data-unseen]')];
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach(el => markSeen(el.dataset.id)); return; }
  io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io?.unobserve(e.target); markSeen(e.target.dataset.id); } }, { threshold: 0.5 });
  els.forEach(el => io.observe(el));
}

/* ---------- 4. 往来: one timeline, newest first ---------- */
const isScalar = v => v == null || isNum(v) || typeof v === 'string';
// What 撤回 puts back, when Claude's sentence doesn't already say it.
function undoDet(x) {
  const said = v => isNum(v) && [String(v), numTxt(v)].some(t => str(x.text).includes(t));
  return arr(x.undo?.changes).filter(isObj).slice(0, 3).filter(c => isScalar(c.from) && isScalar(c.to) && !(said(c.from) && said(c.to)))
    .map(c => { const p = str(c.path); return `${str(c.label) || pathLabel(p)} ${valTxt(p, c.from)} → ${valTxt(p, c.to)}`; }).join('；');
}
function undoBtn(x) {
  const ch = arr(x.undo?.changes).filter(isObj), b = busy['log:' + x.id];
  if (ch.length && !x.undone) return `<button type="button" class="btn ghost sm cl-undo" data-act="c-undo" data-id="${esc(x.id)}"${b ? ' disabled' : ''}>${b ? '…' : '撤回'}</button>`;
  return x.undone ? `<span class="tag ok"${x.undone.at ? ` title="${esc(when(x.undone.at))}"` : ''}>已撤回</span>` : '';
}
// Everything there is to put on the line: {k, at, day, pin?, …}. pin: shown whatever its age (a message still waiting
// for Claude, a reply not seen yet).
function tlItems(t) {
  const out = [], put = (o, at) => { const d = isDate(at) ? at : dayOf(at); if (d) out.push({ ...o, at: str(at), day: d }); };
  for (const m of arr(S.messages)) {
    if (!isObj(m) || typeof m.text !== 'string') continue;
    const rep = hasReply(m) && ms(m.reply.at) > ms(m.createdAt) ? m.reply.at : m.createdAt;
    put({ k: 'msg', m, pin: m.status === 'new' || (hasReply(m) && !m.replySeen) }, rep || m.createdAt);
  }
  for (const r of arr(S.reports)) if (isObj(r) && r.kind) put({ k: 'rep', r }, r.createdAt || r.date);
  // the plan changes Claude made on its own (they carry undo); its other plan lines say what a proposal or a report says
  for (const x of arr(S.log)) if (isObj(x) && x.kind === 'plan' && x.at && x.text && arr(x.undo?.changes).length) put({ k: 'chg', x }, x.at);
  for (const x of arr(S.inbox)) {
    if (!isObj(x) || x.status === 'open') continue;
    if (isProposal(x) && DONE[x.status]) put({ k: 'dec', x }, x.decidedAt || x.createdAt);
    else if (x.kind === 'question' && (x.status === 'answered' || x.status === 'done')) {
      const ans = isObj(x.answer) && x.answer.text ? x.answer : null;
      put({ k: 'ans', q: x.q || x.title || '', a: ans?.text || '', wait: x.status === 'answered' && !!x.needsReview }, ans?.at || x.decidedAt || x.createdAt);
    }
  }
  for (const { col, rec, a } of recAsks(t)) if (a.answer) put({ k: 'ans', q: a.q, a: a.answer.text, wait: !!rec.needsReview, col, rec }, a.answer.at || rec.updatedAt);
  return out.sort((a, z) => (ms(z.at) || ms(z.day + 'T12:00:00')) - (ms(a.at) || ms(a.day + 'T12:00:00')));
}
const dayTxt = d => dayWord(d);
function repLine(r) {
  const title = str(r.title).trim();
  if (r.kind === 'daily' && isDate(r.date)) return `${md(r.date)} ${title}`;
  if (r.kind === 'weekly' && isDate(r.date)) return `${md(r.date)}–${md(addDays(r.date, 6))} ${title}`;
  return title || KINDS[r.kind] || '报告';
}
function tlRow(i) {
  if (i.k === 'msg') {
    const m = i.m, fresh = hasReply(m) && (!m.replySeen || seenNow.has(m.id));
    const st = m.status === 'new' ? ' · 等 Claude 看' : '';
    const del = m.status === 'new' ? `<button type="button" class="cl-del" data-act="c-msg-del" data-id="${esc(m.id)}"${busy['msg:' + m.id] ? ' disabled' : ''}>删除</button>` : '';
    const reply = hasReply(m) ? `<div class="cl-reply${fresh ? ' fresh' : ''}" data-id="${esc(m.id)}"${!m.replySeen ? ' data-unseen="1"' : ''}><span class="ag-mark" aria-hidden="true"></span>
        <div><p>${esc(m.reply.text)}</p><small>Claude · ${esc(when(m.reply.at))}${fresh ? ' · <b>新</b>' : ''}</small></div></div>` : '';
    return `<li class="cl-tl-i cl-tl-msg"><span class="kind cl-k-you">你说</span><div class="cl-tl-m"><p class="cl-msg-t">${esc(m.text)}</p>
      <div class="cl-tl-s"><small>${esc(when(m.createdAt))}${m.kind === 'xunji-templates' ? ' · 训记模版' : ''}${st}</small>${del}</div>${reply}</div></li>`;
  }
  if (i.k === 'rep') {
    const r = i.r;
    return `<li class="cl-tl-i cl-tl-b"><button type="button" class="cl-tl-r" data-act="c-rep" data-id="${esc(r.id)}"><span class="kind ${esc(r.kind)}">${esc(KINDS[r.kind] || '报告')}</span>
      <span class="cl-tl-m"><b>${esc(repLine(r))}</b></span>${CHEV}</button></li>`;
  }
  if (i.k === 'chg') {
    const x = i.x, det = undoDet(x);
    return `<li class="cl-tl-i"><span class="kind cl-k-chg">改计划</span><div class="cl-tl-m${x.undone ? ' undone' : ''}"><span>${esc(x.text)}</span><small>${det ? `${esc(det)} · ` : ''}${esc(when(x.at))}</small></div>${undoBtn(x)}</li>`;
  }
  if (i.k === 'dec') {
    const x = i.x, [cls, l] = DONE[x.status];
    const why = x.status === 'failed' ? str(x.result?.error) || '训记没接受，Claude 会重新准备'
      : x.status === 'stale' ? '计划已经变了，Claude 会重新出提案' : x.status === 'accepted' && x.kind === 'xunji' ? '已写进训记' : '';
    return `<li class="cl-tl-i"><span class="kind ${cls}">${l}</span><div class="cl-tl-m"><span>${esc(x.title || (x.kind === 'xunji' ? '写进训记' : '计划改动'))}</span>${why ? `<small>${esc(why)}</small>` : ''}</div><span class="cl-tl-d">${esc(dayTxt(i.day))}</span></li>`;
  }
  // a question Claude asked, answered
  const about = i.col ? `（${esc(recLabel(i.col, i.rec)[0])}）` : '';
  return `<li class="cl-tl-i"><span class="kind cl-k-ans">你答了</span><div class="cl-tl-m"><span>${esc(i.q)}${about}</span><small>你答：<b>${esc(i.a)}</b>${i.wait ? ' · 等 Claude 看' : ''}</small></div><span class="cl-tl-d">${esc(dayTxt(i.day))}</span></li>`;
}
// The newest 5 (a message still waiting for Claude or a reply not seen yet always); 看更早的 adds 20 more and 30 days.
function timelineHTML(t) {
  const all = tlItems(t), from = addDays(t, -(tlDays - 1));
  const shown = all.filter(i => i.day >= from || i.pin).filter((i, n) => n < tlN || i.pin), rest = all.length - shown.length;
  const none = all.length ? `近 ${tlDays} 天没有往来。` : '日报、周报，你写给 Claude 的话和它的回复，它改过的计划，都按时间排在这里。';
  return `<section class="sec cl-sec" id="cl-timeline"><div class="sec-h"><h2>往来</h2></div>
    ${shown.length ? `<ul class="panel cl-tl">${shown.map(tlRow).join('')}</ul>` : `<p class="cl-none">${none}</p>`}
    ${rest ? `<button type="button" class="link cl-more" data-act="c-tl-more">看更早的 · ${rest} 条</button>` : ''}</section>`;
}
async function undo(id, btn) {
  if (has('confirmTap') && !A.confirmTap(btn, '确认撤回', '撤回')) return;
  busy['log:' + id] = true; rerender();
  try { await post(`/api/log/${encodeURIComponent(id)}/undo`); toast('已撤回，计划改回去了'); }
  catch (e) { toast(e?.code === 'stale' ? '计划后来又改过，撤回不了；要改回去就在「训练」页改' : errTxt(e), true); }
  delete busy['log:' + id];
  S.db?.sync(true); rerender();
}
function openReport(id) {
  const r = arr(S.reports).find(x => x.id === id); if (!r) return;
  if (has('openReport')) return A.openReport(r);
  openSheet('c-rep', `${KINDS[r.kind] || '报告'}${r.date ? ` · ${mdw(r.date)}` : ''}`, has('reportHTML') ? A.reportHTML(r, true) : `<p>${esc(r.summary || '')}</p>`);
}

/* ---------- 今日: 等你拍板, compact (todayHTML) ---------- */
// Rows inside app.js's Claude card, no heading of their own. A proposal is one line: its kind, its title (a tap: the
// whole proposal in a sheet) and 同意 / 不要. A 训记 proposal is never written from here: the person sees the templates
// first (CLAUDE.md), so its button opens that sheet. A question is its line (a tap: the sheet with the input) and its
// options, one tap answers; the last chip 「写一句…」 puts a box in their place (qOpen), sent the same way.
const tb = (act, label, attrs = '', pri = false) => `<button type="button" class="cl-tb${pri ? ' pri' : ''}" data-act="${act}"${attrs}><span>${esc(label)}</span></button>`;
function propRow(x) {
  const b = busy['inbox:' + x.id], dis = b ? ' disabled' : '', isX = x.kind === 'xunji', id = ` data-id="${esc(x.id)}"`;
  const yes = isX && tplKey() === false ? tb('c-gokey', '去存 key', '', true) : isX ? tb('c-prop', '看模版', id, true) : tb('c-accept', b === 'accept' ? '…' : '同意', id + dis, true);
  const btns = yes + tb('c-decline', b === 'decline' ? '…' : '不要', id + dis);
  return `<div class="cl-tr"><button type="button" class="cl-tr-t" data-act="c-prop"${id} aria-label="看这个提案：${esc(x.title || '')}"><span class="cl-kind">${isX ? '训记' : '改计划'}</span><b>${esc(x.title || (isX ? '写进训记' : '计划改动'))}</b></button><span class="cl-tr-b">${btns}</span></div>`;
}
let qOpen = null;  // the 今日 question whose 「写一句…」 box is open (its key)
// The box that takes the chips' place: its own ids (c-tans-…), so it never meets the sheet's box for the same question.
function qBox(key) {
  const b = busy['ans:' + key], dis = b ? ' disabled' : '', k = ` data-k="${esc(key)}"`;
  return `<div class="cl-tr-a"><input type="text" id="c-tans-${esc(key)}"${k} maxlength="200" enterkeyhint="send" autocomplete="off" aria-label="回答 Claude" placeholder="写一句回答" value="${esc(ansDraft[key] || '')}"${dis}>
    ${tb('c-tans-send', b ? '…' : '发送', k + dis, true)}<button type="button" class="cl-tx" data-act="c-tans-x"${k} aria-label="收起，回到选项"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
}
const qChips = (key, options) => {
  const dis = busy['ans:' + key] ? ' disabled' : '', k = ` data-k="${esc(key)}"`;
  return `<div class="cl-tr-o" role="group" aria-label="选一个回答">${options.map(o => `<button type="button" class="cl-tc" data-act="c-ans-opt"${k} data-v="${esc(o)}"${dis}><span>${esc(o)}</span></button>`).join('')}<button type="button" class="cl-tc cl-tc-w" data-act="c-tans-open"${k}${dis}><span>写一句…</span></button></div>`;
};
function qRow(q, key, options) {
  const k = ` data-k="${esc(key)}"`;
  const line = `<button type="button" class="cl-tr-t" data-act="c-q"${k}><b><span class="cl-tr-ql">Claude 问：</span>${esc(q)}</b></button>`;
  return `<div class="cl-tr cl-tr-q" data-k="${esc(key)}">${line}${qOpen === key ? qBox(key) : qChips(key, options)}</div>`;
}
// 「写一句…」: the box goes in right in the tap (iOS opens the keyboard only for a focus inside the tap), in the middle
// of the screen so the keyboard doesn't cover it.
function qWrite(key, btn) {
  qOpen = key;
  const o = btn.closest('.cl-tr-o'); if (!o) { rerender(); return; }
  o.outerHTML = qBox(key);
  const el = document.getElementById('c-tans-' + key); if (!el) return;
  el.focus({ preventScroll: true }); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
  el.scrollIntoView({ block: 'center' });
}
function qClose(key) {
  if (qOpen === key) qOpen = null;
  rerender();
}
// What waits for the person: [{key, html}] — proposals, then Claude's questions (inbox, then meals and workouts).
function waiting() {
  const open = inboxOpen();
  return [
    ...open.filter(isProposal).map(propRow),
    ...open.filter(x => x.kind === 'question').map(x => qRow(x.q || x.title || '', 'i:' + x.id, qOpts(x))),
    ...recAsks().filter(x => !x.a.answer).map(x => qRow(x.a.q, askKey(x.col, x.rec), x.a.options)),
  ];
}
function todayHTML() {
  if (!bind() || !S.loaded) return '';
  queueRefresh();
  const items = waiting();
  if (!items.length) return '';
  const shown = items.slice(0, 3), more = items.length - shown.length;
  return `<div class="cl-today" id="cl-today">${shown.join('')}${more ? `<button type="button" class="cl-t-more" data-act="c-go" data-to="decide"><span>还有 ${more} 件</span>${CHEV}</button>` : ''}</div>`;
}
// A question in a sheet: what it is about (a meal, a workout), the question, why, the options and a box to write in.
function findQ(key) {
  const t = key.slice(0, 1), id = key.slice(2);
  if (t === 'i') { const x = arr(S.inbox).find(i => i.id === id); return x ? { q: x.q || x.title || '', why: x.why, options: qOpts(x), open: x.status === 'open' && !decided.has(id), at: x.createdAt } : null; }
  const col = t === 'm' ? 'meals' : 'workouts', rec = arr(S[col]).find(r => r.id === id), a = rec && askOf(rec);
  return a ? { q: a.q, options: a.options, open: !a.answer, col, rec } : null;
}
function qSheet(key) {
  const x = findQ(key), close = '<button type="button" class="btn ghost main" data-act="close">关闭</button>';
  if (!x || !x.open) return ['<p class="cl-none">这个问题已经回答过了，Claude 下次处理时会看。</p>', close, 'done'];
  const b = busy['ans:' + key];
  return [`${x.col ? recLink(x.col, x.rec) : ''}<p class="cl-q-q">${esc(x.q)}</p>${x.why ? `<p class="cl-why">${esc(x.why)}</p>` : ''}${ansBox(key, x.options, b)}`, close, `open${b ? '-busy' : ''}`];
}
function openQ(key) {
  if (!findQ(key)) return;
  const [b, f, sig] = qSheet(key);
  if (!openSheet({ type: 'c-q', key, sig }, 'Claude 问你', b, f)) return;
  if (!findQ(key)?.options.length) document.getElementById('c-ans-' + key)?.focus();
}
// 详情: the proposal as on the Claude page, its buttons in the footer. Redrawn with the data (refreshSheet).
function propSheet(id) {
  const x = arr(S.inbox).find(i => i.id === id), close = '<button type="button" class="btn ghost main" data-act="close">关闭</button>';
  if (!x) return ['<p class="cl-none">这个提案已经不在了。</p>', close];
  if (x.status !== 'open' || decided.has(id)) {
    const l = DONE[x.status]?.[1];
    return [`<p class="cl-none">这个提案已经处理过了${l && x.status !== 'open' ? `（${l}）` : ''}。</p>`, close];
  }
  return [propHTML(x, true), propBtns(x, true)];
}
function openProp(id) {
  const x = arr(S.inbox).find(i => i.id === id); if (!x) return;
  const [b, f] = propSheet(id);
  openSheet({ type: 'c-prop', id }, x.kind === 'xunji' ? '写进训记' : '改计划', b, f);
}

/* ---------- 我的 → Claude (meHTML) and its sheets ---------- */
const MK = [['food', '饮食'], ['habit', '习惯'], ['schedule', '作息'], ['training', '训练'], ['body', '身体'], ['pref', '偏好'], ['other', '其他']];
const MKN = Object.fromEntries(MK);
const memItems = () => arr(S.memory?.items).filter(x => isObj(x) && typeof x.text === 'string' && x.text.trim());
const SRC = { label: '成分表', feedback: '你纠正过', estimate: 'Claude 估的' };
const PERSONAS = { coach: '正经教练', abstract: '抽象搭子', roast: '毒舌教练' };
const ME = { autonomy: 'Claude 的工作方式', persona: 'Claude 说话的人设', memory: 'Claude 记得的', log: 'Claude 做过的', foods: '常吃的菜和分量' };
const autonomy = () => autoLocal || (S.prefs?.autonomy === 'ask' ? 'ask' : 'small');
// Claude's voice: prefs.persona; unset follows the page style (正经 → coach, otherwise abstract), as bin/lsj pending does.
const persona = () => personaLocal || (['coach', 'abstract', 'roast'].includes(S.prefs?.persona) ? S.prefs.persona : S.prefs?.style === 'clean' ? 'coach' : 'abstract');
const logList = () => arr(S.log).filter(x => isObj(x) && x.at && x.text);
const foodLists = () => { const f = isObj(S.foods) ? S.foods : {}; return [arr(f.dishes).filter(d => isObj(d) && d.name), arr(f.notes).filter(n => typeof n === 'string' && n.trim())]; };
const dayMap = () => isObj(S.xunji?.dayMap) ? Object.entries(S.xunji.dayMap) : [];
function meHTML() {
  if (!bind()) return '';
  queueRefresh();
  // the markup of app.js's 我的 rows (me-row: a title, a line under it, ›), so this group looks like the others there
  const row = (k, l, v) => `<button type="button" class="me-row cl-me-r" data-act="c-me" data-v="${k}"><span class="me-rt"><b>${esc(l)}</b><small>${esc(v)}</small></span><svg class="i chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>`;
  const mem = memItems().length, logs = logList(), [dishes, notes] = foodLists(), dm = dayMap();
  const undoable = logs.filter(x => arr(x.undo?.changes).length && !x.undone).length;
  const rows = [
    row('autonomy', '工作方式', autonomy() === 'ask' ? '什么都先问我' : '小调整直接做'),
    row('persona', '说话的人设', PERSONAS[persona()]),
    row('memory', 'Claude 记得的', mem ? `${mem} 条` : '还没有'),
    logs.length ? row('log', 'Claude 做过的', undoable ? `${undoable} 条能撤回` : when(logs[0].at)) : '',
    dishes.length || notes.length ? row('foods', '常吃的菜', [dishes.length ? `${dishes.length} 道菜` : '', notes.length ? `${notes.length} 条笔记` : ''].filter(Boolean).join(' · ')) : '',
    dm.length && xjLinked() && S.prefs?.trainIn !== 'app' && has('editDayMap') ? row('daymap', '训记对应', `${dm.length} 个训练标题`) : '',
  ];
  return `<div class="panel me-g cl-me">${rows.join('')}</div>`;
}
function radio(act, k, on, t, sub, dis) {
  return `<button type="button" class="cl-opt" role="radio" aria-checked="${on}" data-act="${act}" data-v="${k}"${dis ? ' disabled' : ''}><span class="cl-radio" aria-hidden="true"></span><span><b>${t}</b><small>${esc(sub)}</small></span></button>`;
}
function autonomyBody() {
  const v = autonomy(), d = !!busy.auto;
  return `<div class="panel cl-autop"><div class="cl-opts2" role="radiogroup" aria-label="Claude 能自己做多少">
      ${radio('c-auto', 'small', v === 'small', '小调整直接做，事后告诉我', '按规则加减下次的重量和次数、热量 ±150 kcal 以内、喝水目标。做了记在「Claude 做过的」，可以一键撤回', d)}
      ${radio('c-auto', 'ask', v === 'ask', '什么都先问我', '所有计划改动都先做成提案，你同意了才改', d)}</div>
    <ul class="cl-rules"><li>换动作、改每周安排、热量变动超过 150 kcal 这样的大改，总是先给你提案。</li><li>写进训记的东西每次都要你同意。</li><li>你在「训练」页自己改过的地方，Claude 不会悄悄改回去。</li></ul></div>`;
}
function personaBody() {
  const v = persona(), d = !!busy.persona;
  return `<div class="panel cl-autop"><div class="cl-opts2" role="radiogroup" aria-label="Claude 说话的人设">
      ${radio('c-persona', 'coach', v === 'coach', '正经教练', '平实、具体，有一说一', d)}
      ${radio('c-persona', 'abstract', v === 'abstract', '抽象搭子', '玩梗、发疯文学，像群里的损友：「蛋白质：我人呢？」', d)}
      ${radio('c-persona', 'roast', v === 'roast', '毒舌教练', '专挑你偷懒的地方损：「1.8 升就敢叫大水？」，损完给做法', d)}</div>
    <ul class="cl-rules"><li>换的是日报、点评、回复和通知的说法，数字和建议一样具体。</li><li>不管哪个人设，都不拿身材、体重、长相开玩笑；说到受伤、不舒服时用正经的说法。</li><li>下次处理时生效。</li></ul></div>`;
}
function memoryBody() {
  const items = memItems();
  const groups = MK.map(([k, l]) => [l, items.filter(x => (MKN[x.kind] ? x.kind : 'other') === k)]).filter(([, xs]) => xs.length);
  const mem = groups.length
    ? groups.map(([l, xs]) => `<div class="cl-mg"><h3>${l}</h3><ul>${xs.map(x => `<li><button type="button" class="cl-mem-r" data-act="c-mem-edit" data-id="${esc(x.id)}"><span>${esc(x.text)}</span>${x.by === 'user' ? '<span class="cl-by">你加的</span>' : ''}${CHEV}</button></li>`).join('')}</ul></div>`).join('')
    : '<p class="cl-none">Claude 还没记下关于你的事。处理记录时它会把学到的写在这里，你也可以自己告诉它。</p>';
  return `<div class="panel cl-memp">${mem}<button type="button" class="cl-add" data-act="c-mem-new">+ 告诉 Claude 一件关于你的事</button></div>
    ${items.length ? '<p class="hint" style="margin:0">Claude 每次处理前都会看这些。不对的点开改或删；删掉 Claude 记的，它不会再记回来。</p>' : ''}`;
}
const LOGK = { run: '处理', plan: '改计划', xunji: '训记', memory: '记住', message: '回复', decision: '你的决定' };
function logRow(x) {
  const det = undoDet(x);
  return `<li class="cl-log-r${x.undone ? ' undone' : ''}"><span class="cl-log-tm num">${esc(clockOf(x.at))}</span>
    <div class="cl-log-m"><span class="cl-log-k k-${esc(x.kind)}">${esc(LOGK[x.kind] || '其他')}</span>${esc(x.text || '')}${det ? `<small>${esc(det)}</small>` : ''}</div>${undoBtn(x)}</li>`;
}
function logBody() {
  const t = tday(), list = logList().slice(0, 100);
  if (!list.length) return '<p class="cl-none">Claude 还没做过什么。它每次处理完会在这里记一笔。</p>';
  const shown = logAll ? list : list.slice(0, 12);
  let html = '', cur = null;
  for (const x of shown) {
    const d = dayOf(x.at);
    if (d !== cur) {
      if (cur !== null) html += '</ul>';
      cur = d;
      const w = d === t ? '今天 · ' : d === addDays(t, -1) ? '昨天 · ' : '';
      html += `<h3 class="cl-day">${w}${esc(mdw(d))}</h3><ul class="cl-log">`;
    }
    html += logRow(x);
  }
  html += '</ul>';
  return `<div class="panel cl-logp">${html}</div>
    ${list.length > shown.length ? `<button type="button" class="link cl-more" data-act="c-log-more">再看 ${list.length - shown.length} 条</button>` : ''}
    <p class="hint" style="margin:0">小调整 Claude 会直接做，记在这里；带「撤回」的可以一键改回去。</p>`;
}
function foodsBody() {
  const [dishes, notes] = foodLists();
  if (!dishes.length && !notes.length) return '<p class="cl-none">还没有。你纠正过的菜、包装上的成分表，Claude 会记在这里，下次估同样的菜先看它。</p>';
  const dishRow = (d, i) => {
    // 「一碗 约 300 g」; a unit that already is a weight (「100 g」) is shown once
    const gTxt = isNum(d.g) && !/\d\s*(g|克|ml|毫升)$/i.test(str(d.unit)) ? ` 约 ${numTxt(d.g)} g` : '';
    const unit = [str(d.place), d.unit ? `每${str(d.unit)}${gTxt}` : ''].filter(Boolean).join(' · ');
    const nut = [isNum(d.kcal) ? `${numTxt(d.kcal)} kcal` : '', isNum(d.protein) ? `蛋白质 ${numTxt(d.protein)} g` : ''].filter(Boolean).join(' · ');
    return `<li class="cl-fd"><div><b>${esc(d.name)}</b>${unit ? `<small>${esc(unit)}</small>` : ''}<span class="cl-fd-n">${esc(nut)}${SRC[d.source] ? ` <i>${SRC[d.source]}</i>` : ''}</span></div><button type="button" class="cl-del" data-act="c-dish-del" data-i="${i}" data-n="${esc(d.name)}">删除</button></li>`;
  };
  const list0 = arr(S.foods?.dishes), notes0 = arr(S.foods?.notes);
  return `${dishes.length ? `<ul class="cl-fds">${dishes.map(d => dishRow(d, list0.indexOf(d))).join('')}</ul>` : ''}
    ${notes.length ? `<ul class="cl-fds">${notes.map(n => `<li class="cl-fd"><div><span>${esc(n)}</span></div><button type="button" class="cl-del" data-act="c-note-del" data-i="${notes0.indexOf(n)}" data-n="${esc(n.slice(0, 40))}">删除</button></li>`).join('')}</ul>` : ''}
    <p class="hint" style="margin:0">估同样的菜时 Claude 先看这里。不对的删掉，下次估错了在那一餐点「估高了 / 估低了」。</p>`;
}
const meBody = k => ({ autonomy: autonomyBody, persona: personaBody, memory: memoryBody, log: logBody, foods: foodsBody }[k] || (() => ''))();
function openMe(k) {
  if (!bind()) return;
  if (k === 'daymap') { if (has('editDayMap')) A.editDayMap(); return; }
  if (!ME[k]) return;
  openSheet({ type: 'c-me', kind: k }, ME[k], meBody(k));
}
// This file's sheets show live data: redrawn after each page draw (app.js calls badge / view / todayHTML / meHTML on
// every draw) when what they would show has changed. The open ones of their <details> stay open.
let refQ = false;
function queueRefresh() { if (refQ) return; refQ = true; queueMicrotask(() => { refQ = false; refreshSheet(); }); }
function refreshSheet() {
  const sh = S?.sheet; if (!sh || !['c-me', 'c-prop', 'c-q'].includes(sh.type)) return;
  const b = document.querySelector('#sheet .sheet-b'), f = document.querySelector('#sheet .sheet-f'); if (!b) return;
  const [body, foot, sig] = sh.type === 'c-me' ? [meBody(sh.kind), null] : sh.type === 'c-prop' ? propSheet(sh.id) : qSheet(sh.key);
  // a question's sheet has a box being typed in: redrawn only when it is sent, done or answered elsewhere
  if (sig != null ? sig !== sh.sig : body !== sh.html) {
    sh.sig = sig;
    const open = new Set([...b.querySelectorAll('details[data-key][open]')].map(d => d.dataset.key));
    b.innerHTML = body; sh.html = body;
    b.querySelectorAll('details[data-key]').forEach(d => { if (open.has(d.dataset.key)) d.open = true; });
  }
  if (foot != null && f && foot !== sh.foot) { f.innerHTML = foot; sh.foot = foot; }
}
let memSheet = null;  // {id|null, text, kind, back}: what the open sheet started from; back: opened from 记得的
function openMem(id) {
  const x = id ? memItems().find(m => m.id === id) : null;
  if (id && !x) return;
  const back = S.sheet?.type === 'c-me' && S.sheet.kind === 'memory';
  memSheet = { id: x ? x.id : null, text: x ? x.text : '', kind: x && MKN[x.kind] ? x.kind : 'other', by: x?.by, back };
  const segH = has('seg') ? A.seg('c-mkind', MK, memSheet.kind, 'req cl-mk')
    : `<div class="seg req cl-mk" data-group="c-mkind" role="group">${MK.map(([v, l]) => `<button type="button" data-act="seg" data-v="${v}" aria-pressed="${v === memSheet.kind}">${l}</button>`).join('')}</div>`;
  const who = x ? `${x.by === 'user' ? '你' : 'Claude'} ${esc(when(x.at))} 记的${x.editedAt ? '，改过' : ''}。${x.by === 'user' ? '' : '删掉后 Claude 不会再记回来。'}` : 'Claude 每次处理前都会看「记得的」，计划和点评会照着来。';
  const body = `<div class="field"><label for="c-mem-t">${x ? '内容' : '想让 Claude 记住什么'}</label><textarea id="c-mem-t" rows="3" maxlength="120" placeholder="比如：周末常回家，练不了">${esc(memSheet.text)}</textarea></div>
    <div class="field"><span class="lbl">分类</span>${segH}</div><p class="hint" style="margin:0">${who}</p>`;
  const foot = `${x ? '<button type="button" class="btn ghost danger" data-act="c-mem-del">删掉</button>' : ''}<button type="button" class="btn ghost main" data-act="c-mem-save" id="c-mem-btn">关闭</button>`;
  if (!openSheet('c-mem', x ? '改一条' : '告诉 Claude 一件关于你的事', body, foot)) return;
  if (back) document.querySelector('#sheet .sheet-h')?.insertAdjacentHTML('afterbegin', `<button type="button" class="icon-btn sheet-back" data-act="c-mem-back" aria-label="回到 Claude 记得的">${BACK}</button>`);
  if (!x) document.getElementById('c-mem-t')?.focus();
}
// Done with one item: back to the list it was opened from (same tap, so no history entry changes), or just closed.
function memDone() { const back = memSheet?.back; memSheet = null; closeSheet(); if (back) openMe('memory'); }
const memVals = () => ({ text: (document.getElementById('c-mem-t')?.value || '').trim().slice(0, 120), kind: document.querySelector('#sheet [data-group="c-mkind"] [aria-pressed="true"]')?.dataset.v || memSheet?.kind || 'other' });
function memBtn() {
  const b = document.getElementById('c-mem-btn'); if (!b || !memSheet || b.disabled) return;
  const v = memVals(), dirty = !!v.text && (v.text !== memSheet.text || v.kind !== memSheet.kind);
  b.textContent = dirty ? '保存' : '关闭'; b.classList.toggle('primary', dirty); b.classList.toggle('ghost', !dirty);
}
// meta/memory on its version; fn changes items / forgotten (false: nothing to write).
const memWrite = fn => writeDoc('meta', 'memory', cur => {
  const d = cur.exists && isObj(cur.data) ? cur.data : {};
  const items = arr(d.items).filter(isObj), forgotten = arr(d.forgotten).filter(s => typeof s === 'string');
  if (fn(items, forgotten) === false) return null;
  return { set: { ...d, items, forgotten: forgotten.slice(-50), updatedAt: nowIso() } };
});
async function saveMem(btn) {
  const sh = memSheet; if (!sh) return closeSheet();
  const v = memVals();
  if (!v.text || (v.text === sh.text && v.kind === sh.kind)) { if (!v.text && !sh.id) toast('先写一句', true); else memDone(); return; }
  btn.disabled = true; btn.textContent = '保存中…';
  const at = nowIso();
  try {
    await memWrite(items => {
      if (!sh.id) { items.push({ id: newId('k'), text: v.text, kind: v.kind, by: 'user', at }); return; }
      const x = items.find(i => i.id === sh.id);
      if (!x) throw { code: 'gone', message: '这一条刚被 Claude 改过或删掉了，关掉再看看' };
      x.text = v.text; x.kind = v.kind; x.editedAt = at;
    });
    memDone(); toast(sh.id ? '改好了' : '记下了，Claude 下次处理时会看');
  } catch (e) { btn.disabled = false; memBtn(); toast(errTxt(e), true); }
}
async function delMem(btn) {
  const sh = memSheet; if (!sh?.id) return;
  if (has('confirmTap') && !A.confirmTap(btn, '再点一次删掉', '删掉')) return;
  btn.disabled = true;
  try {
    await memWrite((items, forgotten) => {
      const i = items.findIndex(x => x.id === sh.id); if (i < 0) return false;
      const [x] = items.splice(i, 1);
      if (x.by !== 'user' && !forgotten.includes(x.text)) forgotten.push(x.text);
    });
    memDone(); toast(sh.by === 'user' ? '删掉了' : '删掉了，Claude 不会再记回来');
  } catch (e) { btn.disabled = false; toast(errTxt(e), true); }
}
async function delFood(kind, i, name, btn) {
  if (has('confirmTap') && !A.confirmTap(btn, '确认删除', '删除')) return;
  btn.disabled = true;
  // the row that was tapped: by its place in the list, checked against its name (the list may have changed since)
  const list0 = kind === 'dish' ? arr(S.foods?.dishes) : arr(S.foods?.notes);
  const fits = v => kind === 'dish' ? isObj(v) && v.name === name : typeof v === 'string' && v.slice(0, 40) === name;
  const shown = fits(list0[i]) ? list0[i] : list0.find(fits);
  if (!shown) { btn.disabled = false; return; }
  try {
    await writeDoc('meta', 'foods', cur => {
      const d = cur.exists && isObj(cur.data) ? cur.data : null; if (!d) return null;
      if (kind === 'dish') {
        const list = arr(d.dishes), j = list.findIndex(x => isObj(x) && isObj(shown) && x.name === shown.name && str(x.place) === str(shown.place) && str(x.unit) === str(shown.unit));
        return j < 0 ? null : { update: { dishes: list.filter((_, k) => k !== j), updatedAt: nowIso() } };
      }
      const list = arr(d.notes), j = list.indexOf(shown);
      return j < 0 ? null : { update: { notes: list.filter((_, k) => k !== j), updatedAt: nowIso() } };
    });
    toast(kind === 'dish' ? `删掉了「${name}」` : '删掉了');
  } catch (e) { btn.disabled = false; toast(errTxt(e), true); }
  rerender();
}
async function setPersona(v) {
  if (!['coach', 'abstract', 'roast'].includes(v) || v === persona() || busy.persona || !S.db) return;
  personaLocal = v; busy.persona = true; rerender();
  try {
    if (has('savePrefs') && A.savePrefs.length <= 1) await A.savePrefs({ persona: v });
    else await writeDoc('profile', 'prefs', cur => cur.exists ? { update: { persona: v, updatedAt: nowIso() } } : { set: { persona: v, updatedAt: nowIso() } });
    toast({ coach: '好的，以后正经说话', abstract: '好的，以后整点抽象的', roast: '行，以后不惯着你' }[v]);
  } catch (e) { toast(errTxt(e), true); }
  personaLocal = null; busy.persona = false; rerender();
}
async function setAutonomy(v) {
  if (!['small', 'ask'].includes(v) || v === autonomy() || busy.auto || !S.db) return;
  autoLocal = v; busy.auto = true; rerender();
  try {
    if (has('savePrefs') && A.savePrefs.length <= 1) await A.savePrefs({ autonomy: v });
    else await writeDoc('profile', 'prefs', cur => cur.exists ? { update: { autonomy: v, updatedAt: nowIso() } } : { set: { autonomy: v, updatedAt: nowIso() } });
    toast(v === 'ask' ? '好的，以后改计划都先问你' : '好的，小调整直接做，事后告诉你');
  } catch (e) { toast(errTxt(e), true); }
  autoLocal = null; busy.auto = false; rerender();
}

/* ---------- answers and decisions ---------- */
async function decide(id, act) {
  const k = 'inbox:' + id; if (busy[k]) return;
  const x = arr(S.inbox).find(i => i.id === id); if (!x) return;
  busy[k] = act; rerender();
  let ok = false;
  try {
    const r = await post(`/api/inbox/${encodeURIComponent(id)}/${act}`, {}, { timeout: x.kind === 'xunji' ? 60000 : 20000 });
    const d = [r?.doc?.data, r?.inbox?.data, r?.data, r?.inbox, r?.doc].find(o => isObj(o) && typeof o.status === 'string');
    ok = true;
    if (d?.status === 'failed' || r?.failed === true) toast(`没写成：${str(d?.result?.error) || '训记没接受，Claude 会重新准备'}`, true);
    else if (act === 'decline') toast(x.kind === 'xunji' ? '好的，不写了' : '好的，计划不改');
    else toast(x.kind === 'xunji' ? '已写进训记，打开训记的「Agent 模版」就能看到' : '计划改好了');
  } catch (e) {
    if (e?.code === 'no_template_key') noTplKey = true;
    // 训记 refused it, or the proposal didn't pass the checks: the proposal is now 「没写成」 with the same reason
    const failed = e?.inbox?.data?.status === 'failed' || /^(xunji_|invalid_mutation$|bad_proposal$)/.test(e?.code || '');
    if (failed || e?.code === 'stale' || e?.code === 'not_open') ok = true;  // decided either way: off the list
    toast(failed ? `没${x.kind === 'xunji' ? '写成' : '改成'}：${errTxt(e)}` : errTxt(e), true);
  }
  delete busy[k];
  if (ok) { decided.add(id); if (S.sheet?.type === 'c-prop' && S.sheet.id === id) closeSheet(); }
  S.db?.sync(true); rerender();
}
async function answer(key, text) {
  text = String(text ?? '').trim().slice(0, 200);
  const bk = 'ans:' + key;
  if (busy[bk]) return;
  if (!text) { toast('先写一句再发送', true); (document.getElementById('c-ans-' + key) || document.getElementById('c-tans-' + key))?.focus(); return; }
  const [t, id] = [key.slice(0, 1), key.slice(2)], at = nowIso();
  busy[bk] = true; rerender();
  try {
    if (t === 'i') { await post(`/api/inbox/${encodeURIComponent(id)}/accept`, { text }); decided.add(id); }  // → answered, answer {text, at}
    else {
      const col = t === 'm' ? 'meals' : 'workouts', rec = arr(S[col]).find(r => r.id === id);
      if (has('answerAsk')) await A.answerAsk(col, id, text);
      else await writeDoc(col, id, cur => cur.exists ? { update: { answer: { text, at, q: rec?.review?.ask?.q ?? cur.data?.review?.ask?.q }, needsReview: true } } : null);
    }
    delete ansDraft[key];
    if (qOpen === key) qOpen = null;
    if (S.sheet?.type === 'c-q' && S.sheet.key === key) closeSheet();
    toast('已回答，Claude 下次处理时会看');
    if (t === 'i') S.db?.sync(true);
  } catch (e) { if (e?.code === 'not_open') decided.add(id); toast(e?.code === 'not_open' ? '这个问题已经回答过或过期了' : errTxt(e), true); if (t === 'i') S.db?.sync(true); }
  delete busy[bk]; rerender();
}
function openRec(col, id) {
  const rec = arr(S[col]).find(r => r.id === id); if (!rec) return;
  const f = col === 'meals' ? 'openMeal' : 'openWorkout';
  if (has(f)) return A[f](id);
  if (has('openRecord')) return A.openRecord(col, id);
  S.date = rec.date; go('today');  // the day it was on, where the record can be opened
}

/* ---------- the page ---------- */
// go('claude', focus): where to land. The parts that moved to 我的 open their sheet instead.
const FOCUS = { decide: 'cl-decide', proposals: 'cl-proposals', questions: 'cl-questions', replies: 'cl-timeline', messages: 'cl-timeline', timeline: 'cl-timeline', reports: 'cl-timeline', compose: 'cl-compose' };
function jump(to) {
  if (ME[to]) { openMe(to); return; }
  if (/^p:/.test(to)) to = document.getElementById('cl-p-' + to.slice(2)) ? 'cl-p-' + to.slice(2) : 'proposals';
  const el = document.getElementById(FOCUS[to] || to) || document.getElementById('cl-decide');
  if (!el) return;
  const target = to === 'replies' ? el.querySelector('.cl-reply.fresh') || el : el;
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el.classList.remove('cl-flash'); void el.offsetWidth; el.classList.add('cl-flash');
  if (to === 'compose') document.getElementById('c-msg')?.focus({ preventScroll: true });
}
const grow = el => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 260) + 'px'; };
let afterQ = false, focusWas = null;
function after() {
  afterQ = false;
  if (S.tab !== 'claude') return;
  const ta = document.getElementById('c-msg');
  grow(ta);
  if (ta && focusWas && document.activeElement !== ta) { ta.focus(); try { ta.setSelectionRange(focusWas[0], focusWas[1]); } catch (e) {} }
  focusWas = null;
  if (S.claudeFocus) { const f = S.claudeFocus; S.claudeFocus = null; requestAnimationFrame(() => jump(f)); }
  watchReplies();
}
function view() {
  if (!bind()) return '<div class="panel empty">正在读取…</div>';
  queueRefresh();
  const ae = document.activeElement;
  focusWas = ae?.id === 'c-msg' ? [ae.selectionStart, ae.selectionEnd] : null;
  if (!afterQ) { afterQ = true; queueMicrotask(after); }
  if (!['status', 'meals', 'workouts', 'plan'].every(k => S.loaded.has(k))) return '<div class="panel empty">正在读取…</div>';
  const t = tday();
  return `<div class="cl-page">${topHTML()}${decideHTML(t)}${composeHTML()}${timelineHTML(t)}</div>`;
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  // the 分类 control in the 记得的 sheet is app.js's seg (it flips the buttons first); the main button follows it
  if (e.target.closest?.('#sheet [data-group="c-mkind"]')) queueMicrotask(memBtn);
  const t = e.target.closest?.('[data-act^="c-"]'); if (!t || !bind()) return;
  const id = t.dataset.id;
  switch (t.dataset.act) {
    case 'c-accept': decide(id, 'accept'); break;
    case 'c-decline': decide(id, 'decline'); break;
    case 'c-prop': openProp(id); break;
    case 'c-q': openQ(t.dataset.k); break;
    case 'c-gokey': noTplKey = false; if (S.sheet) closeSheet(); if (S.sheet) break; if (has('openXjKey')) A.openXjKey('template'); else go('me'); break;
    case 'c-tans-open': qWrite(t.dataset.k, t); break;
    case 'c-tans-send': answer(t.dataset.k, document.getElementById('c-tans-' + t.dataset.k)?.value); break;
    case 'c-tans-x': qClose(t.dataset.k); break;
    case 'c-go': go('claude', t.dataset.to); break;
    case 'c-jump': jump(t.dataset.to); break;
    case 'c-ans-opt': answer(t.dataset.k, t.dataset.v); break;
    case 'c-ans-send': answer(t.dataset.k, document.getElementById('c-ans-' + t.dataset.k)?.value); break;
    case 'c-open-rec': openRec(t.dataset.col, id); break;
    case 'c-chip': chipFill(+t.dataset.i, !!t.closest('#sheet')); break;
    case 'c-send': sendDraft(false); break;
    case 'c-cmp-send': sendDraft(true); break;
    case 'c-msg-del': delMsg(id, t); break;
    case 'c-tl-more': tlN += 20; tlDays += 30; if (has('ensureRange')) A.ensureRange(addDays(tday(), -tlDays)); rerender(); break;
    case 'c-undo': undo(id, t); break;
    case 'c-rep': openReport(id); break;
    case 'c-me': openMe(t.dataset.v); break;
    case 'c-log-more': logAll = true; refreshSheet(); break;
    case 'c-mem-new': openMem(null); break;
    case 'c-mem-edit': openMem(id); break;
    case 'c-mem-save': saveMem(t); break;
    case 'c-mem-del': delMem(t); break;
    case 'c-mem-back': memSheet = null; closeSheet(); openMe('memory'); break;
    case 'c-dish-del': delFood('dish', +t.dataset.i, t.dataset.n, t); break;
    case 'c-note-del': delFood('note', +t.dataset.i, t.dataset.n, t); break;
    case 'c-auto': setAutonomy(t.dataset.v); break;
    case 'c-persona': setPersona(t.dataset.v); break;
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'c-msg' || el.id === 'c-cmp') { setDraft(el.value); grow(el); if (el.id === 'c-cmp') cmpBtn(); }
  else if (el.id === 'c-mem-t') memBtn();
  else if (el.dataset?.k && /^c-t?ans-/.test(el.id || '')) ansDraft[el.dataset.k] = el.value;
});
// the 今日 box once the keyboard is up (iOS slides it in after the focus): kept in the middle of what is left
document.addEventListener('focusin', e => {
  const el = e.target;
  if (/^c-tans-/.test(el?.id || '')) setTimeout(() => { if (document.activeElement === el) el.scrollIntoView({ block: 'center' }); }, 350);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  const el = e.target;
  if (/^c-t?ans-/.test(el.id || '') && el.dataset?.k) { e.preventDefault(); answer(el.dataset.k, el.value); }
});

window.LSJClaude = { view, badge, needs, compose, send, todayHTML, meHTML, openMe };
})();

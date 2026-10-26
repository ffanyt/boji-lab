/* voice.js — 薄肌研究所「互联网抽象风」的文案库（window.LSJVoice）。

   只在 <html data-style="abstract"> 时给抽象文案，否则原样返回 fallback（正经文案），所以页面只要每次 render 都走这里，
   切换风格后下一次 render 文案就跟着变。返回的都是纯文本（html() 除外），插进 HTML 前照常 esc()。

   加载：index.html 的 <head> 里，abstract.css 后面、app.js 前面，最好**不加 defer**：
     <link rel="stylesheet" href="/abstract.css">
     <script src="/voice.js"></script>
   它一执行就按 localStorage「lsj-style」（app.js 的 applyStyle 写的；'clean' 是正经，没有就是 abstract）设好
   <html data-style>，第一帧就是对的风格（CSP 不允许内联脚本，这一步只能放在外部文件里）。放在 app.js 后面加 defer
   也能用：app.js 第一次 draw 时还没有 LSJVoice，用的是正经文案，DOMContentLoaded 那次 render 就换过来了。
   风格的切换、保存（profile/prefs.style）和状态栏颜色由 app.js 的 applyStyle / themeMeta 管，这里只读 data-style。

   用法：
     LSJVoice.on()                         现在是不是抽象风
     LSJVoice.t(key, fallback, vars)       一句界面文案。fallback 是正经说法（不传就用下面 FALLBACK 里的）；
                                           vars 里的 {n} {name} 之类替换进去；vars.seed 换一个选句子的种子
                                           （默认按今天的日期，同一天同一句，不会每次 render 都跳）
     LSJVoice.html(key, fallback, vars)    同 t()，但句子本身先转义，vars 原样插入（给 `<b class="num">…</b>` 用）
     LSJVoice.slogan(date)                 今日页标题下的每日一句；按日期固定，36 条轮着来，连续 36 天不重样。正经风返回 ''
     LSJVoice.focusLine(text, date)        训练日的一句。text 传计划日的 name + focus（如「胸 肩 三头」），按里面最先出现的
                                           部位词选：胸 背 腿 肩 手臂/二头/三头 核心/腹 全身 上肢 有氧 休息；带「恢复」
                                           （恢复偏差的日子）给保守的一句。正经风返回 ''
     LSJVoice.habit(key, ok, value, opts)  五件套每项的短句。key: water | sleep | egg | stand | lean（别名 protein、
                                           steps、train）；ok: 做到没有；value: 正经风原样返回的值（传 '' 就什么都不显示）；
                                           opts: {date, rest}，或直接传日期字符串。lean 在休息日（opts.rest，或 value 是
                                           「休息日」）给「躺平合法」那组。每项 2–3 句随日期换
     LSJVoice.pick(listKey, seed, fallback) 从一组句子里按 seed 取一句（listKey 是下面 LINES 里任何一个 key，比如
                                           'slogan'、'habit.water.ok'、'focus.legs'、'toast.saved'）。正经风返回 fallback || ''
     LSJVoice.style()                      现在的风格（'abstract' | 'clean'，和 app.js 的 STYLES 一样）
     LSJVoice.applyStyle(style)            同 app.js 的 applyStyle（'clean' 去掉 data-style），给没有 app.js 的页面用
     LSJVoice.barColor(dark)               状态栏（meta theme-color）的颜色，和 app.js 的 themeMeta 一致
     LSJVoice.keys()                       [{key, fallback, sample}]，所有 t() 的 key（调试、写文档用）

   key 列表（正经 fallback → 抽象示例；完整的见下面 FALLBACK 和 LINES）：
     空状态   empty.meals 还没有记饮食。开饭前拍一张，吃完再补吃了多少就行。 → 干饭人的第一张照片还没来。开饭前拍一张，…
              empty.mealsPast 这天没有记饮食。 → 这天吃了啥，是个谜。
              empty.food 还没有饮食记录 → 今天的饭还没上桌
              empty.dayFold 这天没有饮食和喝水记录。 → 这天的饭和水：查无此记录。
              empty.waterPast 这天没记喝水 → 这天的水，一滴没记
              empty.weight 还没有体重记录。早上起床、上完厕所、吃喝之前称，每周至少 4 次。 → 秤还没收到你的消息。…
              empty.workouts 还没有训练记录。按计划记一次训练，或连上训记让 Claude 同步过来。 → 训练记录：空空如也。…
              empty.restPast 这天没有训练记录，算休息日。 → 这天没练，按休息日算，躺平合法。
              empty.plan 还没有训练计划。到「我的」填好基础信息，Claude 会做一份。 → 计划还没出生。…
     toast    toast.meal 已记一餐 · toast.quick 记下了：{name} · toast.saved 已保存 · toast.weight 体重已记下 ·
              toast.water 记下 {ml} ml · toast.workout 训练已保存 · toast.syncNew 导入 {n} 条新训练 ·
              toast.syncUpd 更新了 {n} 条训练 · toast.syncNone 训记里没有新的训练 · toast.pr 有新纪录 ·
              toast.undo 已撤销 · toast.deleted 已删除 · toast.told 已告诉 Claude · toast.answered 已回答，Claude 下次处理时会看 ·
              toast.netErr 没保存上，检查网络后再点一次
     按钮     btn.camMeal 拍照记一餐 · btn.newMeal 记一餐 · btn.sync 从训记同步 · btn.syncPlan 练完了，从训记同步 ·
              btn.syncAgain 再从训记同步 · btn.syncMaybe 练了？从训记同步 · btn.syncing 同步中… · btn.liveStart 开始训练 ·
              btn.liveAgain + 再练一次 · btn.liveDay 按这天开练 · btn.liveGo 继续训练 · btn.liveDone 完成
     训练中   live.bar 训练进行中 · live.pr 新纪录！ · live.restDone 休息结束 · live.allDone 都练完了，点这里收工 ·
              live.empty 还没有动作。… · live.dropped 这次训练放弃了 · live.doneTitle 练完了
     简报卡   brief.title Claude · brief.more 看全文 · brief.next 接下来 · brief.new {n} 条新记录 ·
              brief.notYet Claude 还没看今天的记录。
     需要你   needs.label 需要你 · needs.proposals {n} 个提案等你拍板 · needs.questions Claude 问了 {n} 个问题 ·
              needs.reply Claude 回复了你 · needs.replies Claude 回复了你 {n} 条
     摄入     intake.left 还差 {n} · intake.over 超了 {n} · intake.protein 蛋白质还差 {n} g，补一份：
     喝水     water.left 离目标还差 {n} ml · water.leftBig 大水达成，离目标还差 {n} ml（喝到 2 升、还没到这天的目标）·
              water.done 喝够了（到了这天的饮水目标；「大水」只指五件套的 2 升，这里不用）
     称体重   weigh.title 今天还没称体重 · weigh.hint 起床、上完厕所、吃东西前称最准。看的是一周的平均，每周至少称 4 次。
     节标题   sec.habits 五件套 · sec.meals 饮食 · sec.train 训练
   （「喝水卡 还差 X ml」现在正经页面上没有，fallback 是给正经风也想显示时用的；只想在抽象风显示，就判断 on()。）

   文案底线：玩梗不低俗、不骂人；不拿身材、体重、长相开玩笑；不鼓励节食、熬夜、过量训练；不碰政治、地域、性别梗；
   不用真人和品牌的梗；只用中文和少量英文。数字和建议照原样保留，梗只是加在旁边的一句。 */
(() => {
'use strict';
const root = document.documentElement;
// Same values as app.js's STYLES / profile/prefs.style: 'abstract' (default) or 'clean' (正经, no data-style).
const CLEAN = ['clean', 'plain'];
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };

// Before the first paint: the remembered style (localStorage lsj-style, written by app.js's applyStyle); none means
// abstract, the default. 正经 has no data-style at all, like app.js does it.
{ const s = lsGet('lsj-style'); if (CLEAN.includes(s)) root.removeAttribute('data-style'); else root.dataset.style = 'abstract'; }

const on = () => root.dataset.style === 'abstract';
const style = () => on() ? 'abstract' : 'clean';

/* ---------- picking a line ---------- */
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const pad = n => String(n).padStart(2, '0');
function todayStr() {
  try { const t = window.LSJ?.today?.(); if (isDay(t)) return t; } catch (e) {}
  const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dayNum = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const gcd = (a, b) => b ? gcd(b, a % b) : a;
// Index into a list of n. A date walks the list with a step that shares no factor with n, so consecutive days never
// repeat until all n have come up; salt shifts the start so two lists don't move in lockstep.
function idx(n, seed, salt = '') {
  if (n <= 1) return 0;
  if (seed == null || seed === '') seed = todayStr();
  if (isDay(seed)) {
    const step = [7, 11, 13, 17, 19, 23, 29, 31, 37].find(p => gcd(p, n) === 1) || 1;
    return ((dayNum(seed) * step + hash(salt)) % n + n) % n;
  }
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.floor(seed) + hash(salt)) % n;
  return hash(salt + '|' + String(seed)) % n;
}
const fill = (s, vars) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? String(vars[k]) : m);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- the plain wording (what the page says now) ---------- */
const FALLBACK = {
  'empty.meals': '还没有记饮食。开饭前拍一张，吃完再补吃了多少就行。',
  'empty.mealsPast': '这天没有记饮食。',
  'empty.food': '还没有饮食记录',
  'empty.dayFold': '这天没有饮食和喝水记录。',
  'empty.waterPast': '这天没记喝水',
  'empty.weight': '还没有体重记录。早上起床、上完厕所、吃喝之前称，每周至少 4 次。',
  'empty.workouts': '还没有训练记录。按计划记一次训练，或连上训记让 Claude 同步过来。',
  'empty.restPast': '这天没有训练记录，算休息日。',
  'empty.plan': '还没有训练计划。到「我的」填好基础信息，Claude 会做一份。',
  'toast.meal': '已记一餐',
  'toast.quick': '记下了：{name}',
  'toast.saved': '已保存',
  'toast.weight': '体重已记下',
  'toast.water': '记下 {ml} ml',
  'toast.workout': '训练已保存',
  'toast.syncNew': '导入 {n} 条新训练',
  'toast.syncUpd': '更新了 {n} 条训练',
  'toast.syncNone': '训记里没有新的训练',
  'toast.pr': '有新纪录',
  'toast.undo': '已撤销',
  'toast.deleted': '已删除',
  'toast.told': '已告诉 Claude',
  'toast.answered': '已回答，Claude 下次处理时会看',
  'toast.netErr': '没保存上，检查网络后再点一次',
  'btn.camMeal': '拍照记一餐',
  'btn.newMeal': '记一餐',
  'btn.sync': '从训记同步',
  'btn.syncPlan': '练完了，从训记同步',
  'btn.syncAgain': '再从训记同步',
  'btn.syncMaybe': '练了？从训记同步',
  'btn.syncing': '同步中…',
  'btn.liveStart': '开始训练',
  'btn.liveAgain': '+ 再练一次',
  'btn.liveDay': '按这天开练',
  'btn.liveGo': '继续训练',
  'btn.liveDone': '完成',
  'live.bar': '训练进行中',
  'live.pr': '新纪录！',
  'live.restDone': '休息结束',
  'live.allDone': '都练完了，点这里收工',
  'live.empty': '还没有动作。点「加动作」，从计划、练过的或动作库里挑，也可以直接写名字。',
  'live.dropped': '这次训练放弃了',
  'live.doneTitle': '练完了',
  'brief.title': 'Claude',
  'brief.more': '看全文',
  'brief.next': '接下来',
  'brief.new': '{n} 条新记录',
  'brief.notYet': 'Claude 还没看今天的记录。',
  'needs.label': '需要你',
  'needs.proposals': '{n} 个提案等你拍板',
  'needs.questions': 'Claude 问了 {n} 个问题',
  'needs.reply': 'Claude 回复了你',
  'needs.replies': 'Claude 回复了你 {n} 条',
  'intake.left': '还差 {n}',
  'intake.over': '超了 {n}',
  'intake.protein': '蛋白质还差 {n} g，补一份：',
  'water.left': '离目标还差 {n} ml',
  'water.leftBig': '大水达成，离目标还差 {n} ml',
  'water.done': '喝够了',
  'weigh.title': '今天还没称体重',
  'weigh.hint': '起床、上完厕所、吃东西前称最准。看的是一周的平均，每周至少称 4 次。',
  'sec.habits': '五件套',
  'sec.meals': '饮食',
  'sec.train': '训练',
};

/* ---------- the abstract wording ---------- */
const LINES = {
  // 空状态：先一句梗，后面的做法照原样
  'empty.meals': ['干饭人的第一张照片还没来。开饭前拍一张，吃完再补吃了多少就行。', '饭桌还没开张。开饭前拍一张，吃完再补吃了多少就行。'],
  'empty.mealsPast': ['这天吃了啥，是个谜。', '这天的饭没留下任何证据。'],
  'empty.food': ['今天的饭还没上桌', '干饭记录：空'],
  'empty.dayFold': ['这天的饭和水：查无此记录。'],
  'empty.waterPast': ['这天的水，一滴没记'],
  'empty.weight': ['秤还没收到你的消息。早上起床、上完厕所、吃喝之前称，每周至少 4 次。'],
  'empty.workouts': ['训练记录：空空如也。按计划练一次，或连上训记让 Claude 搬过来。'],
  'empty.restPast': ['这天没练，按休息日算，躺平合法。'],
  'empty.plan': ['计划还没出生。到「我的」填好基础信息，Claude 给你安排上。'],
  // toast：数字照原样
  'toast.meal': ['这顿记上了', '干饭打卡成功', '饭已入账'],
  'toast.quick': ['{name}，已入账', '{name}，记上了'],
  'toast.saved': ['存好了，稳稳的', '已保存，拿捏', '保存成功，安心'],
  'toast.weight': ['体重记下了，看的是一周的趋势', '已上秤打卡，趋势比一天的数要紧'],
  'toast.water': ['咕咚，+{ml} ml', '又灌了 {ml} ml', '+{ml} ml，水润了'],
  'toast.workout': ['这练记上了，铁没白撸', '训练入账，肌肉在偷偷加班'],
  'toast.syncNew': ['训记搬运完成：{n} 条新训练', '从训记搬来 {n} 条新训练'],
  'toast.syncUpd': ['训记搬运完成：更新了 {n} 条', '更新了 {n} 条训练，已对齐'],
  'toast.syncNone': ['训记里空空的，没有新训练', '训记那边没有新货'],
  'toast.pr': ['新纪录！给自己鼓个掌', '破纪录了，稳稳拿下'],
  'toast.undo': ['撤回成功，当无事发生', '已撤销，无事发生'],
  'toast.deleted': ['删了，干干净净', '已删除，不留痕迹'],
  'toast.told': ['收到，Claude 记小本本上了', '已传话给 Claude'],
  'toast.answered': ['回答已送达，Claude 下次处理时会看'],
  'toast.netErr': ['网络开小差，没保存上，检查后再点一次'],
  // 按钮：一个 key 一句，按钮不跳
  'btn.camMeal': ['先拍再干饭'],
  'btn.newMeal': ['记一顿'],
  'btn.sync': ['从训记搬运'],
  'btn.syncPlan': ['练完了，从训记搬过来'],
  'btn.syncAgain': ['再从训记搬一次'],
  'btn.syncMaybe': ['练了？从训记搬过来'],
  'btn.syncing': ['搬运中…'],
  'btn.liveStart': ['开练！'],
  'btn.liveAgain': ['+ 再来一练'],
  'btn.liveDay': ['就练这天'],
  'btn.liveGo': ['回去接着练'],
  'btn.liveDone': ['收工'],
  // 训练中（数字照原样；不鼓励过量训练）
  'live.bar': ['正在撸铁'],
  'live.pr': ['新纪录！', '破纪录了！', '纪录被你拿下了！'],
  'live.restDone': ['歇够了，上铁', '休息结束，下一组'],
  'live.allDone': ['全部拿下，点这里收工', '练完了，收工'],
  'live.empty': ['动作清单空空如也。点「加动作」，从计划、练过的或动作库里挑，也可以直接写名字。'],
  'live.dropped': ['这次先不算，下次再来', '已放弃，当无事发生'],
  'live.doneTitle': ['收工！', '今日份撸铁完成'],
  // 简报卡、需要你
  'brief.title': ['Claude 嘴替'],
  'brief.more': ['展开唠唠'],
  'brief.next': ['接下来整点啥'],
  'brief.new': ['{n} 条新料'],
  'brief.notYet': ['Claude 还在路上，今天的记录它还没看。', 'Claude 还没开工，今天的记录它还没看。'],
  'needs.label': ['需要你出马'],
  'needs.proposals': ['{n} 个提案，等你一锤定音'],
  'needs.questions': ['Claude 有 {n} 个灵魂拷问'],
  'needs.reply': ['Claude 回你了，速看'],
  'needs.replies': ['Claude 回了你 {n} 条，速看'],
  // 摄入、喝水、称体重（数字照原样，不评价体重）
  'intake.left': ['还能吃 {n}', '额度还剩 {n}'],
  'intake.over': ['超了 {n}，看一周别慌', '超了 {n}，一顿不算啥'],
  'intake.protein': ['蛋白质还差 {n} g，安排一份：', '蛋白质还差 {n} g，来一份：'],
  // 喝水卡比的是计划的饮水目标；「大水」是五件套的 2 升，只在已经喝到 2 升时提一句（water.leftBig）
  'water.left': ['离今日目标还差 {n} ml', '今日水量 KPI 还差 {n} ml'],
  'water.leftBig': ['大水达成，离今日目标还差 {n} ml', '大水拿下了，离今日目标还差 {n} ml'],
  'water.done': ['今日目标喝够了', '水桶本桶，目标拿下'],
  'weigh.title': ['今天还没和秤见面', '秤在等你打卡'],
  'weigh.hint': ['起床、上完厕所、吃东西前称最准。看一周的平均，一天的数不算数，每周至少称 4 次。'],
  // 节标题（可选）
  'sec.habits': ['五件套'],
  'sec.meals': ['干饭'],
  'sec.train': ['撸铁'],

  // 每日一句
  'slogan': [
    '今日份牛马健身，打卡！', '弱者喝饮料，强者喝大水', '薄肌不会自己长出来', '先把蛋白质吃够再发疯',
    '精神状态：稳定地想练', '别卷了，先卷一下蛋白质', '今天也是被哑铃需要的一天', '铁不会骗人，铁只会变重',
    '健身是给未来的自己打钱', '情绪不稳定，就去稳定地练', '主打一个吃好睡好练好', '今日 KPI：喝够、吃够、睡够',
    '家人们谁懂啊，练完真的会快乐', '已读计划，正在执行', '别问，问就是在练', '早睡是最便宜的补剂',
    '肌肉正在加载中……', '发疯不如发力', '先喝一大杯水，再决定要不要发疯', '蛋白质到账，肌肉才肯上班',
    '进步不靠狠，靠每天来', '练不动就练轻点，来了就算赢', '休息也是计划的一部分', '少刷五分钟手机，多睡五分钟觉',
    '一杯水下肚，CPU 重新启动', '别熬了，鹰都睡了', '训练是充电，不是放电', '吃饭不积极，肌肉有意见',
    '先完成，再完美', '今天也要做个情绪稳定的干饭人', '稳住，按计划来就能赢', '哑铃在等你，它不催',
    '记录到位，进步自己会来', '今天的小目标：喝够水', '慢慢来，比较快', '打工是为了吃饭，吃饭是为了练',
  ],

  // 五件套
  'habit.water.ok': ['灌满了', '水桶本桶', '水润了'],
  'habit.water.no': ['差一口', '再灌点', '再来一杯'],
  'habit.sleep.ok': ['睡成猪了', '满电复活', '睡饱了'],
  'habit.sleep.no': ['熬鹰中', '电量不足', '今晚早睡'],
  'habit.egg.ok': ['蛋白质拉满', '蛋够了', '肌肉吃饱'],
  'habit.egg.no': ['在路上', '还差点蛋', '肌肉饿着'],
  'habit.stand.ok': ['腿没白长', '步数拉满', '走起来了'],
  'habit.stand.no': ['屁股焊椅子上了', '起来走走', '久坐警告'],
  'habit.lean.ok': ['练了', '铁已撸', '薄肌 +1'],
  'habit.lean.no': ['还没练', '铁在等你', '哑铃想你'],
  'habit.lean.rest': ['躺平合法', '带薪休息', '合法摆烂'],

  // 训练日的一句（按部位）
  'focus.chest': ['今天胸怀天下', '推就完了，胸会记住的', '卧推不骗人'],
  'focus.back': ['背不练就驼了', '今天给背上点强度', '拉就完了，背会记住的'],
  'focus.legs': ['练腿不练腿，迟早要后悔', '腿日到了，别想跑', '深蹲一下，人生就稳了'],
  'focus.shoulders': ['肩宽一寸，帅一分', '今天给肩膀加点戏', '推举起来，气场就有了'],
  'focus.arms': ['今天专心搞手臂', '二头三头，一个都不能少', '弯举一下，快乐加倍'],
  'focus.core': ['核心稳了，人生就稳了', '平板支撑，稳如老狗', '今天和核心好好聊聊'],
  'focus.full': ['全身都安排上了', '从头练到脚，一个不落', '今天雨露均沾'],
  'focus.upper': ['上半身全员到齐', '今天上肢开会，全员出席'],
  'focus.cardio': ['心肺也要练，走起', '有氧安排上，喘就对了'],
  'focus.rest': ['今日躺平合法', '休息日，肌肉在偷偷长', '合法休息，理直气壮'],
  'focus.easy': ['今天保守点，稳住就是赢', '恢复没跟上：保持重量，不冲纪录'],
  'focus.any': ['照计划练，别加戏', '按计划来，稳稳拿下', '今天也是被铁需要的一天'],
};

// Body-part words in a plan day's name / focus → the list. The one that comes first in the text wins
// (「胸 肩 三头」 is a chest day, 「背 二头」 a back day).
const PARTS = [
  ['easy', ['恢复', 'easy']],
  ['rest', ['休息', '躺平', 'rest']],
  ['full', ['全身', 'full']],
  ['upper', ['上肢', '上半身', 'upper']],
  ['legs', ['腿', '臀', '下肢', '深蹲', 'leg']],
  ['back', ['背', '拉', 'back', 'pull']],
  ['chest', ['胸', '卧推', 'chest']],
  ['shoulders', ['肩', 'shoulder']],
  ['arms', ['手臂', '二头', '三头', '臂', 'arm']],
  ['core', ['核心', '腹', 'core', 'abs']],
  ['cardio', ['有氧', '跑', '骑', '游泳', 'cardio']],
];
function partOf(text) {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return 'any';
  // 恢复 and 休息 decide on their own wherever they are; otherwise the earliest body part
  for (const k of ['easy', 'rest']) if (PARTS.find(p => p[0] === k)[1].some(w => s.includes(w))) return k;
  let best = 'any', at = Infinity;
  for (const [k, ws] of PARTS) for (const w of ws) { const i = s.indexOf(w); if (i >= 0 && i < at) { at = i; best = k; } }
  return best;
}

const HABIT_ALIAS = { protein: 'egg', steps: 'stand', train: 'lean', training: 'lean' };

/* ---------- API ---------- */
function t(key, fallback, vars) {
  const fb = fallback ?? FALLBACK[key] ?? '';
  const xs = LINES[key];
  if (!on() || !Array.isArray(xs) || !xs.length) return fill(fb, vars);
  return fill(xs[idx(xs.length, vars?.seed, key)], vars);
}
function html(key, fallback, vars) {
  const fb = fallback ?? FALLBACK[key] ?? '';
  const xs = LINES[key];
  const tpl = on() && Array.isArray(xs) && xs.length ? xs[idx(xs.length, vars?.seed, key)] : fb;
  return esc(tpl).replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? String(vars[k]) : m);
}
function slogan(date) {
  if (!on()) return '';
  const xs = LINES.slogan;
  return xs[idx(xs.length, isDay(date) ? date : todayStr(), 'slogan')];
}
function focusLine(text, date) {
  if (!on()) return '';
  const xs = LINES['focus.' + partOf(text)] || LINES['focus.any'];
  return xs[idx(xs.length, isDay(date) ? date : todayStr(), 'focus')];
}
function habit(key, ok, value, opts) {
  const o = typeof opts === 'string' ? { date: opts } : (opts && typeof opts === 'object' ? opts : {});
  if (!on()) return value == null ? '' : String(value);
  const k = HABIT_ALIAS[key] || key;
  const rest = k === 'lean' && (o.rest === true || value === '休息日' || value === 'rest');
  const xs = LINES[`habit.${k}.${rest ? 'rest' : ok ? 'ok' : 'no'}`];
  if (!xs) return value == null ? '' : String(value);
  return xs[idx(xs.length, isDay(o.date) ? o.date : todayStr(), 'habit.' + k)];
}
function pick(listKey, seed, fallback) {
  const xs = LINES[listKey];
  if (!on() || !Array.isArray(xs) || !xs.length) return fallback == null ? '' : String(fallback);
  return xs[idx(xs.length, seed, listKey)];
}
// Status bar colour (meta theme-color) for the current style.
const barColor = dark => on() ? (dark ? '#0A0A0B' : '#FFF6D9') : (dark ? '#0E1217' : '#F1F3F5');
function syncBar() {
  const th = root.dataset.theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const dark = th === 'dark' || (th !== 'light' && /dark/.test(m.media || ''));
    m.content = barColor(dark);
  });
}
// The same as app.js's applyStyle (use that one in app.js); here for pages without app.js.
function applyStyle(s) {
  const clean = CLEAN.includes(s);
  if (clean) root.removeAttribute('data-style'); else root.dataset.style = 'abstract';
  lsSet('lsj-style', clean ? 'clean' : null);
  syncBar();
}
const keys = () => Object.keys(FALLBACK).map(key => ({ key, fallback: FALLBACK[key], sample: (LINES[key] || [])[0] ?? FALLBACK[key] }));

window.LSJVoice = { on, style, t, html, slogan, focusLine, habit, pick, applyStyle, barColor, keys, FALLBACK, LINES };
// the status bar follows the style once the <meta> tags are parsed
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncBar, { once: true }); else syncBar();
})();

# 薄肌研究所 · 数据结构

`CLAUDE.md` 会自动加载这份文件。页面、服务器、`bin/lsj`、`bin/xunji` 和两个 skill 都按这里的字段读写。
页面和日报共用的计算口径（这天算训练日还是休息日、活动加餐、恢复、牛奶豆浆算不算吃的、一餐按哪个数算）写在 `CLAUDE.md` 的「口径」一节。

每条记录是 `{collection, id, version, updatedAt, data}`，下面列的是 `data` 里的字段。所有时间都是 ISO 字符串，日期是本地日期 `YYYY-MM-DD`（时区是服务器的 `LSJ_TZ`，一天从几点算起每个人自己设，见 `profile/prefs` 和 `CLAUDE.md`）。`needsReview: true` 表示用户新建或修改过，等 Claude 处理；Claude 处理完写成 `false`。

**用户说了算**：页面上能改的东西（目标、计划、快捷清单、一餐的热量、睡眠和体重、哪天不算）用户改了就以用户的为准。Claude 不悄悄覆盖，想改就在日报或周报里提建议，用户同意了再改。

| 集合 | 一条是什么 | 谁写 |
|---|---|---|
| `meals/<id>` | 一餐 | 页面；Claude 写 `review` |
| `workouts/<id>` | 一次训练（`xj-…` 是训记导入的） | 页面、`bin/xunji` 或服务器（网页上的「从训记同步」，Apple Watch 的心率和消耗）；Claude 写 `review` |
| `body/<日期>` | 体重、睡眠时长、腰围、睡眠截图 | 页面、服务器（Apple 健康） |
| `sleep/<日期>` | 一晚的睡眠（醒来那天） | 服务器（Apple 健康）、页面（用户改的）、Claude（读截图） |
| `health/<日期>` | Apple 健康的每日数据 | 服务器；页面只写 `ignore` |
| `water/<日期>` | 喝水 | 页面 |
| `progress/<日期>` | 身材照（正面、侧面、背面） | 页面；Claude 写 `review` |
| `days/<日期>` | 这天实际练哪天 | 页面（Claude 也可以写） |
| `todos/<日期>` | 用户自己加的「今天要做的」 | 页面 |
| `profile/main`、`profile/prefs` | 基础信息、偏好设置 | 页面 |
| `plan/current`、`plan_history/<…>` | 当前计划和旧计划 | Claude；用户可以在页面上改（记在 `custom`） |
| `reports/<id>` | 日报、周报、计划说明 | Claude；页面只写 `done`、`skip` |
| `inbox/<id>` | Claude 找用户拍板的事：计划提案、训记模版写入、问题 | Claude；服务器（用户同意、不要）和页面（回答）改状态 |
| `messages/<id>` | 用户交代给 Claude 的事 | 页面；Claude 写 `reply` |
| `log/<id>` | Claude 做过的事（能撤回的带 `undo`） | Claude、服务器；页面只通过撤回接口 |
| `meta/foods`、`meta/xunji`、`meta/status`、`meta/insights`、`meta/memory`、`meta/places` | 常吃的菜、训记同步状态、上次处理状态、各项数据的判断、Claude 记得的事、常去的店怎么点 | Claude、`bin/xunji`、服务器；`meta/memory` 和 `meta/xunji.dayMap` 页面也能改 |

## `meals/<id>`：一餐（页面写入）
```
date, slot: breakfast|lunch|snack|dinner|late, time: "HH:MM",   // late 是夜宵
photos: [资源id],                        // 开吃前拍的（用户也常把饭后照放在这里，见 fitness-review）
leftovers: [资源id],                     // 吃完剩下的（饭后情况里拍的）
desc: 文字描述,
portion: all|most|half|little|null      // 吃了多少：约 100% / 75% / 50% / 25%
fullness: 1-5|null                       // 1 还很饿 2 有点饿 3 刚好 4 很饱 5 撑了
feelings: [精力充沛|满足|犯困|腹胀|胃不舒服|还想吃|口渴], notes,
manual?: {kcal, protein?, carbs?, fat?}, // 用户自己填的数（包装上的成分表、外卖 App 标的），见下面「一餐按哪个数算」
feedback?: high|low,                     // 用户点了「估高了 / 估低了」，同时 needsReview 变 true；Claude 重估后删掉
corrections?: [{item, kind: none|half|wrong, note?}],   // 用户在点评里逐项标的：没吃 / 吃了一半 / 不是这个（note 写其实是什么），同时 needsReview 变 true；Claude 按它重算后删掉
answer?: {text, at, q},                  // 用户对 review.ask 的回答（q 是当时的问题），同时 needsReview 变 true；Claude 用完后删掉 answer 和 review.ask
quick?: [{name, kcal, protein, carbs, fat}],   // 用户从快捷清单点「记一笔」记的（可以选日期、餐次、时间和份数，份数已经乘进数字，名字后面带「×0.5」之类），没有照片，needsReview: false
needsReview, createdAt, updatedAt,
review?: {                               // Claude 写
  kcal, protein, carbs, fat,             // 实际吃下去的量（已扣掉剩下的），g
  items: [{name, amount, kcal}],         // 各项 kcal 加起来等于 kcal
  rating: good|ok|adjust, comment, tip, reviewedAt,
  basis: {photos, leftovers, portion, desc, manual?},  // 这次估算依据的照片 id、剩菜照 id、portion、desc、用户填的数
  ask?: {q, options?: [..]}               // 有一样拿不准、又影响 100 kcal 以上时问一句（页面显示成按钮），照样先给估算
}
```
**一餐按哪个数算**（页面、`bin/lsj day`、图表都一样）：热量和三大营养素逐项取 `manual` 里的数；`manual` 没有这一项就取 `review` 的；都没有就取 `quick` 的合计。有 `manual.kcal`、`review.kcal` 或 `quick` 的餐算进摄入，其余是待处理。用户填了或改了 `manual` 时 `needsReview` 变 true：Claude 照用户的数，只补 `manual` 里没有的营养素（和热量对得上），再写点评。

`fullness` 是 5 级量表，不要写成"X 分饱"。
`review.basis` 用来判断要不要重估：用户只改了感受、饱腹感这类字段时，basis 没变，数字保持不变（规则见 `fitness-review`）。
餐次的显示顺序是早餐、午餐、加餐、晚餐、夜宵；同一天里按时间排，日界之前的时间（默认 0:00–4:59）排在 23:59 后面。页面猜餐次时，22:00 到日界之间是夜宵。
页面上的快捷操作：最近 3 天（今天和前两天）的餐，没填 `portion`、没有剩菜照、不是只有 `quick` 的，行上有「吃完了」（写 `portion: "all"`、`needsReview: true`）和「剩了些」（打开表单拍剩菜）；「拍照记一餐」直接建一餐 `{date, slot, time, photos: [id], needsReview: true}`；快捷清单随时都能打开。页面判断问题有没有答过：`answer.q` 等于 `review.ask.q`。

## `workouts/<id>`：一次训练（页面写入）
```
date, planDayId: 计划日 id|null, title,  // 手动记录的 title 用户可以改
status?: "active",                       // 「训练中」界面正在记、还没点完成（边练边保存）；完成时删掉这个字段。active 的不算训练、不点评
startedAt?, endedAt?,                     // 「训练中」开始、完成的时间（ISO）
// 「训练中」记的组和训记导入的写法一样：负重 {kg, reps, done}；自重 {bodyweight: true, kg（加的负重）|null, reps, done}；
// 辅助 {bodyweight: true, assist, kg: null, reps, done}；计时 {kg: null, sec, done}；热身 warmup: true、递减组 drop: true；
// 有氧动作 {name, cardio: true, metrics: {min, km?, kcal?}, sets: []}；动作上可以有用户写的 note
exercises: [{name, target: "4×6–8 · RPE 8 · 休息 120s", restSec, sets: [{kg, reps, done}]}],
durationMin, rpe: 5-10（可以有 .5）, feelings: [状态很好|力量涨了|疲劳|没睡好|肌肉酸痛|关节不适|时间紧],
notes, photos: [资源id], needsReview, createdAt, updatedAt,
heartRate?: {avg, max, min, n?, source?, at?},   // 这次训练的心率（次/分）：训记导入的只有 avg/max/min；「训练中」记的来自 Apple Watch（source: "apple-health"，见下）
kcal?, kcalSource?: "apple-health",       // 这次训练的消耗（活动能量，kcal）：训记导入的是训记给的；「训练中」记的来自 Apple Watch
review?: {                               // Claude 写
  rating: good|ok|adjust, comment, wins: [..], next: [..],
  nextByExercise: {"杠铃卧推": "62.5kg × 8", …},   // 下次每个动作的具体建议，动作名和记录里一致
  ask?: {q, options?: [..]},             // 比如训记标题对不上计划日时问「这次练的是哪天」，options 写 ["A 胸肩三头", "B 背二头", …]
  reviewedAt
},
answer?: {text, at, q}                   // 用户对 review.ask 的回答，同时 needsReview 变 true
```
**每组的 RPE**：「训练中」里用户可以给一组记 `rpe`（6–10，组号菜单里选），和训记导入的组上的 `rpe` 同一个字段；页面的「这次怎么练」规则会看它（上次次数到了上限但 `rpe ≥ 9.5` 就先不加重）。

**递减组**：「训练中」里递减组是一组 `drop: true`，紧跟在它所属的那组正式组后面；可以连着几组（递减链，每组比上一组轻），每组单独打勾（训记导入的递减组 `done` 跟着它所属的那组）。递减组算进完成组数和训练量，但不是工作组（看进步、定下次重量只看正式组），也不算纪录。热身组（`warmup: true`）不算完成组数和训练量。

**手表的心率和消耗**：「训练中」记的训练（没有 `source`）可以从 Apple Watch 拿到心率和消耗。用户在手表上开一个「传统力量训练」，练完运行「同步健康」快捷指令，它会传最近两天的心率明细（`hr`）和活动能量明细（`kcals`，见 `health` 一节）。服务器取开始时间落在这次训练 `startedAt`–`endedAt` 之间的样本（两头都算，按绝对时间比；有手表的样本时只用手表的，见 `health` 一节的 `src`），写：
- `heartRate: {avg, max, min, n, source: "apple-health", at}`：至少 5 个样本才写；`avg`、`max`、`min` 取整，`n` 是样本数，`at` 是写入时间
- `kcal`（样本求和，取整）和 `kcalSource: "apple-health"`

只给这样的训练写：不是训记导入的、已经点了完成（没有 `status: "active"`）、有 `startedAt` 和 `endedAt`、`startedAt` 在最近 3 天内、时长不超过 5 小时（忘了点完成、第二天才点的那种不算）。一次同步可能只拿到半次训练，所以已有的 apple-health 值只在新的样本数不少于旧的（心率）、或消耗不比旧的少（kcal）时才替换，和已存的一样就不写；`heartRate` 不是 apple-health 写的、或者已有 `kcal` 而 `kcalSource` 不是 apple-health 的（用户或别处写的），都不动。只改这几个字段（version 加 1），不动 `needsReview`、`review` 和其他字段；原始样本不存。

`nextByExercise` 会显示在「今天」的计划卡（按计划里的动作名找最近一次建议）、这次训练的详情里、「训练 → 动作」的动作详情里，以及下次在网页上记录同一动作时（"Claude 建议：…"，里面的 kg 数和次数会作为默认值）。所以格式固定写成 `"<重量>kg × <次数>"`，自重动作写 `"自重 × 12"`；可以在后面加括号补充，如 `"22.5kg × 12（最后一组 25kg × 8）"`。超过 21 天的建议页面不再显示，也不再当默认值（正好 21 天前的还算）。页面取建议里第一个「X kg」当默认重量、第一个「× N」当默认次数。

训记导入的训练（`workouts/xj-<训记 localid>`，`source: "xunji"`）多出的字段，以及组里的 `warmup`、`drop`、`bodyweight`、`assist`、`rpe`、`sec`、`superset` 和有氧动作的写法，见 `CLAUDE.md` 的「训记」一节。这些训练的内容以训记为准，页面上改不了；用户可以补充只存在薄肌研究所里的 `mine`：
```
mine?: {notes?, feelings?: [..], rpe?, planDayId?: 计划日 id | ""}   // "" 是"练了，但不是计划里的某天"
```
用户改 `mine` 时 `needsReview` 变 true，页面同时把 `mine.planDayId` 写进顶层 `planDayId`（`""` 写成 null）。同步（`bin/xunji` 和网页上的「从训记同步」）不动 `mine`；`mine.planDayId` 是字符串时 `planDayId` 按它，不再按 `dayMap`，`target` 也按它填。点评时把 `mine` 里的感受、RPE、备注和训记自己的 `notes` 一起看。

## `body/<YYYY-MM-DD>`：身体数据（页面写入）
`date, weight (kg), sleep (h), waist (cm), arm?, chest?, hip?, thigh? (cm), bodyFat? (%), notes, photos: [资源id], needsReview, weightSource?, sleepSource?, weightAuto?, bodyFatSource?, bodyFatAuto?, feel?, updatedAt`

- 围度：`waist` 腰围（肚脐一圈，呼气后）、`arm` 臂围（放松时最粗处）、`chest` 胸围、`hip` 臀围、`thigh` 大腿围，cm，一位小数。页面在「身体数据」的「更多围度」里填
- `bodyFat`：体脂率 %，一位小数。手填或 Apple 健康同步（体脂秤），规则和体重一样：服务器写自动值时同时写 `bodyFatAuto`、`bodyFatSource: "apple-health"`；`bodyFatSource: "manual"` 的不被覆盖
- `feel: {energy, sore, stress, at}`：晨间状态，各 1–5（精力 1 很差 … 5 很好；酸痛 1 不酸 … 5 很酸；压力 1 很轻松 … 5 很大），「今日」页早上点的。不触发 `needsReview`，Claude 处理时用在恢复和训练建议里

- 没称体重的那天，「今天」页顶部会提示用户空腹称一下（可以点「今天不称」关掉；`profile/prefs.weighCard: false` 就一直不提示）
- `sleep` 是睡着的小时数（自动同步时由服务器写入，`sleepSource: "apple-health"`）
- `weightSource` / `sleepSource`：`"apple-health"` 是服务器从 Apple 健康写的，`"manual"` 是用户在页面上改的。服务器写自动体重时同时写 `weightAuto`。体重算手填（Apple 健康不覆盖）：`weightSource: "manual"`；或没有 `weightSource` 但有 `weight`；或 `weight` 和 `weightAuto` 不一样。`sleepSource: "manual"` 时 `body.sleep` 不被覆盖，但 `sleep/<date>` 照写（`sleep/<date>` 本身是 `manual` 的除外）
- 用户清除同步来的体重（秤上的数不对）：`{weight: null, weightSource: "manual"}`，之后同步也不会再写回来。「恢复自动」：有 `weightAuto` 就 `{weight: weightAuto, weightSource: "apple-health"}`，没有就删掉 `weight` 和 `weightSource`
- 体重按这个人的日界归日（默认 5 点：凌晨 1:30 称的算前一天），取这一天第一次称的；步数、活动能量、静息心率、HRV 仍按自然日
- `photos` 是用户上传的睡眠截图，上传新截图时 `needsReview: true`，Claude 读完截图后写 `sleep/<date>` 并把它改成 `false`

## `sleep/<YYYY-MM-DD>`：一晚的睡眠（日期是醒来那天）
```
source: apple-health|screenshot|manual, date,
asleep, core, deep, rem, awake, inBed,      // 分钟
bedtime: "23:40", wake: "07:05",            // 入睡、醒来（本地时间）
start, end (ISO), samples, syncedAt,
cleared?: true, editedAt?                   // 只有 manual 的有
```
`source: "manual"` 是用户在页面上改的（手表没戴好、记错了）：改过的一晚只有用户填的字段；`cleared: true` 是用户说"这晚数据不对"，当作没有这晚的数据。服务器同步时不覆盖 `manual` 的一晚，也不动那天的 `body.sleep`，通知里写「睡眠：这晚你手动改过，没覆盖」。页面上「恢复自动」会删掉这条并去掉 `body.sleep` 和 `sleepSource`，下次同步重新写。

自动同步：iPhone 快捷指令「同步健康」带着用户自己生成的上传令牌（`lsj_…`，只能调用 `POST /api/ingest/health` 和旧的 `/api/ingest/sleep`，读不到任何数据）上传。每种数据一个请求 `{"metric": "sleep|weight|bodyfat|steps|active|rhr|hrv|hr|kcals", "v": 值（一行一个）, "s": 开始日期（ISO 8601，一行一个）, "e": 结束日期（只有睡眠要）, "src": 来源（只有 hr、kcals 有，可选）}`；也接受一次发完的 `{"sleep_v", "sleep_s", "sleep_e", "steps_v", "steps_s", …}`。

睡眠：取样本里睡得最久的那一晚，手表分期（核心、深睡、REM）优先于 iPhone 的笼统「睡眠」，重叠的部分只算一次，写入 `sleep/<醒来日期>` 和 `body/<醒来日期>.sleep`。所有时间先换算到 `LSJ_TZ`。如果 `sleep/<date>` 已有一晚开始得不比新的晚、睡得更久（快捷指令回看窗口从半夜开始，只拿到后半夜），就不覆盖 `sleep/` 和 `body.sleep`，通知里写「睡眠：已有更完整的一晚，没覆盖」。已存的没有 `start`（截图来的）时只比睡眠时长。`sleep_v/_s/_e` 行数对不上会报问题，不再硬配对。其他数据写入 `health/<日期>`（见下）。返回的 `message` 汇总当天已经同步到的全部数据，给快捷指令弹通知；认不出的睡眠样本值放在 `unknownValues` 里。

## `health/<YYYY-MM-DD>`：Apple 健康的每日数据（服务器写入）
`date, steps, activeKcal, restingHR, hrv (ms, SDNN), weight?, bodyFat? (%), n: {rhr, hrv, weight, bodyFat?}（各用了几个样本）, source: "apple-health", syncedAt, ignore?: ["steps"|"activeKcal"|"restingHR"|"hrv"]`

步数和活动能量按天求和（快捷指令里按天分组，手表和手机不会重复算），静息心率和 HRV 取当天平均，体重取当天第一次。体重同时写进 `body/<日期>.weight`（`weightSource: "apple-health"`），但用户自己填过的体重不会被覆盖。当天的数字随同步次数累积（白天同步的步数是到那时为止的）。快捷指令每次往回取几天，最早那天可能只取到后半天，所以步数和活动能量只往大里更新，静息心率、HRV、体重只在样本数不少于已存的时才覆盖。

`hr`（心率明细，次/分，30–230 之外的丢掉）和 `kcals`（活动能量明细，kcal；带 kJ、千焦的换算成 kcal，和 `active` 一样）是一条条样本，快捷指令传最近两天的。它们不按天合计、**不写进** `health/<日期>`，也不影响 `active`、`rhr`，只用来算「训练中」记的训练的心率和消耗（见 `workouts` 一节）。这两种还带 `src`：每个样本的来源（设备名，一行一个，一次发完的写法是 `hr_src`、`kcals_src`）。练的时候手机也在身上、也会记活动能量，加起来会叠两遍，所以一个训练窗口里有来源名含 `Watch` 或「手表」（不分大小写）的样本时只算这些，有几个手表来源取样本最多的那个；没有手表的样本就全算。`src` 没有、是空的或行数和 `v` 对不上时不管它，全算，也不报问题。来源名不存。对上了训练时，返回的 `message` 加一行，如「训练心率：10/16 胸 肩 三头 均 126 · 最高 158 · 消耗 290 kcal」；没对上就不加。

`ignore` 是用户在页面上标的「这天不算」（没戴表、表戴松了、生病）。服务器同步时保留它。被标的那项在所有地方都当作这天没有数据：活动加餐和它的基线、恢复判断和基线、图表、平均值、日报。

页面和日报怎么用这些数字（活动加餐、恢复）见 `CLAUDE.md` 的「口径」。

## `water/<YYYY-MM-DD>`：喝水（页面写入，每天一条）
`date, entries: [{id, t: "HH:MM"|null, ml, kind: water|tea|coffee|milk|soy|other}], total (ml), updatedAt`

- `id` 由页面生成（`h…`），离线重放时靠它去重，旧条目可能没有（用户改这一条时页面补上）
- 用户可以改或删任意一条，`total` 由 `entries` 重新算
- `t` 为 null 表示事后补记
- 含糖饮料用户会记到饮食里，这里只算补水。没有 `needsReview`，日报里直接读当天的 `total`
- `milk`（全脂牛奶）和 `soy`（无糖豆浆）既算喝水，也算吃的：页面和日报把它们按下面的值算进当天摄入（每 100 ml）

| kind | kcal | 蛋白质 g | 碳水 g | 脂肪 g |
|---|---|---|---|---|
| `milk` 全脂牛奶 | 65 | 3.2 | 4.8 | 3.6 |
| `soy` 无糖豆浆 | 31 | 3.0 | 1.2 | 1.6 |

## `progress/<YYYY-MM-DD>`：身材照（页面写，Claude 写 review）
```
date, photos: {front?: 资源id, side?: 资源id, back?: 资源id}, note?, needsReview,
review?: {comment, compareTo: "YYYY-MM-DD", changes?: [..], reviewedAt}   // Claude 和上一次对比写的
```
每两周左右拍一次（同一时间、同样光线和衣服、同一个位置）。新拍或换了照片时 `needsReview: true`。「数据」页并排对比两次。照片和其他照片一样只存在服务器上，Claude 处理时会发给 Anthropic。

## `days/<YYYY-MM-DD>`：这天实际练哪天（页面写入，只在和计划不一样时才有）
`date, plan: 训练日 id（"A"）| "rest", updatedAt`

用户在「今天 → 训练」里点了和默认不同的那天才会写；点回默认的就删掉这条。Claude 也可以在用户说"这天练了"时替他写这条。怎么判断某天是训练日还是休息日见 `CLAUDE.md`。

## `todos/<YYYY-MM-DD>`：用户自己加的「今天要做的」（页面写入）
`date, items: [{id, text（最多 80 字）, done}], updatedAt`

显示在「今天要做的」里，排在 Claude 给的几条后面。Claude 只读不写：周报统计「建议做到」时不算这些，但可以看用户自己在关心什么。

## `meta/foods`：这个人常吃的菜（Claude 写）
```
notes: ["某食堂的红烧鸡腿一只约 150g（带骨）", …],
dishes: [{name, place, unit, g, kcal, protein, fat, carbs, source: label|feedback|estimate, n}],
updatedAt
```
- 用户纠正过估算（`feedback`、备注、对话里说）后，Claude **必须**把学到的分量和做法写在这里，以后估同样的菜先看它。用户在 `manual` 里填的包装食品数也可以记成 `source: "label"`
- `dishes` 一项是一道菜的一个单位：`unit` 是"一片""一碗""一盒"这样的单位，`g` 是一个单位多少克，`kcal`、`protein`、`fat`、`carbs` 是一个单位的量；`place` 是在哪吃或哪个牌子；`source`：`label` 包装上的营养成分表，`feedback` 用户纠正过，`estimate` Claude 估的；`n` 是这条被用上或确认过几次
- 关于某个人的事实（分量习惯、常去的店、忌口）写进他自己的 `meta/foods` 或 `profile`，不要写进 Claude 的 memory

## `meta/places`：常去的店怎么点（Claude 写）
```
places: [{name: "肯德基", kind: 快餐|食堂|外卖|便利店|火锅|其他, aliases?: ["KFC"],
          picks: [{name: "嫩牛五方 + 玉米 + 无糖可乐", kcal?, protein?, note?}],   // 2–4 个照目标搭的组合
          avoid?: [..], tips?: [..], n: 吃过几次, lastAt: "YYYY-MM-DD"}],
updatedAt
```
显示在「今日 → 摄入 → 目标」那个 sheet 的最后一节「常去的店怎么点」；记一餐时描述里出现 `name` 或 `aliases`，表单里提示这家怎么点。

## `meta/xunji`：训记同步状态（`bin/xunji` 和服务器写）
- `dayMap`：`{训记训练标题: 计划日 id}`，同步时据此填 `planDayId` 和每个动作的 `target`（sync 会保留它；训练上有 `mine.planDayId` 的按 `mine`）。用户可以在「训练」页改，改完页面调 `POST /api/xunji/remap` 按新的对应关系重算
- `templates`：`"declined"` 是用户说过不要 Claude 写训记 Agent 模版，有这一项时不再提议写模版；`"web"` 是用户要在网页上确认后写（sync 会保留它）
- `webSync: {at, ok, new, updated, error?}`：网页上「从训记同步」最近一次的结果（服务器写，不动其他字段）
- `keys: {train: bool, template: bool}`：服务器上存了哪种训记 key（服务器在存、删 key 时写）
- `agentTemplates: [{template_id, name, version?}]`、`agentTemplatesAt`：训记「Agent 模版」文件夹里现在有什么（服务器在存模版 key 时、每次写模版后读一次）；训记返回的格式认不出来时 `agentTemplates` 是空的，原文的前 2000 字放在 `agentTemplatesRaw`
- `templatesState: {"<计划日 id>": {name, template_id?, at, planUpdatedAt}}`：哪个计划日什么时候写进了训记，`planUpdatedAt` 是当时计划的 `updatedAt`；计划之后又改了，页面显示「计划改过，训记里还是旧的」
- 其余是 `bin/xunji` 的同步状态（`lastSyncAt`、`lastSyncDate`、`linked`、`imported`）

## `meta/insights`：各项数据的判断（Claude 每次处理时写）
```
date: "YYYY-MM-DD",        // 用到哪天的数据
updatedAt,
cards: {                   // 每项一句判断 + 一个具体做法，显示在「数据」页对应的卡片上
  weight?, body?, progress?, sleep?, recovery?, activity?, diet?, training?: {say, do?, level?: good|ok|adjust}
}
```
`weight` 体重、`body` 围度和体脂率、`progress` 增肌（或减脂、薄肌）进度、`sleep` 睡眠、`recovery` 静息心率和 HRV、`activity` 步数和活动能量、`diet` 饮食、`training` 训练。页面总是标「Claude · 日期」；超过 7 天的会变淡，和卡片现在的数对不上时提示「数据有更新，等下次处理」。写法见 `fitness-review` 第 4 步。

## `meta/memory`：Claude 记得的关于这个人的事（Claude 写，页面能增改删）
```
items: [{id, text（一句话，最多 120 字）, kind: food|habit|schedule|training|body|pref|other, by: claude|user, at, editedAt?}],
forgotten?: [text, …],     // 用户删掉的 Claude 记的条目原文（最多 50 条），Claude 不再记回来
updatedAt
```
显示在「Claude → Claude 记得的」。Claude 每次处理先读；学到以后用得上的事实就加一条（`by: "claude"`）；`by: "user"` 的是用户自己写的，Claude 不改不删。常吃的菜的分量放 `meta/foods`，不重复写在这里。

## `inbox/<id>`：Claude 找用户拍板的事（Claude 写；状态由服务器和页面改）
```
kind: plan|xunji|question, title（≤ 24 字）, why（1–3 句）, createdAt, by: "claude",
status: open|accepted|declined|answered|failed|stale|done, decidedAt?,
needsReview?,             // 用户做了决定（同意、不要、回答，或者训记提交失败）时变 true，Claude 看过后改 false

// kind = plan：计划改动
changes: [{path, label, from, to, fromText?, toText?}],

// kind = xunji：写进训记的 Agent 模版
mutation: {upserts, deletes, folder_update?},   // 训记模版接口的请求体原文（不含 confirmed、mutation_id），页面按它逐个列出模版和动作
days?: {"<client_id 或 template_id>": "<计划日 id>"},
summary?: [..],           // Claude 写的说明，只用于显示
result?: {ok, at, error?, response?},            // 服务器提交后写

// kind = question：不属于某一餐、某次训练的问题
q, options?: [..], answer?: {text, at}           // 用户回答：POST /api/inbox/<id>/accept 带 {text}，服务器写 answer，status 改 answered
```
- `path` 用 `plan/current` 里的点路径，和 `plan.custom` 同一套（`diet.kcal`、`diet.restDay`、`diet.restDay.kcal`、`diet.water`、`diet.quick`、`training.schedule`、`training.rotation`、`training.days.<id>`、`training.days.<id>.exercises`……）。`training.days` 下一段是训练日 id，其他数组整个替换；根只能是 `diet`、`training`、`phase`、`summary`、`notes`。`from` 是提案时这条路径的值（不存在是 null），`to` 是改后的完整值（null 是删掉）
- 用户点「同意」（`POST /api/inbox/<id>/accept`，只接受网页登录）：
  - plan：服务器逐条比对 `from` 和计划里的当前值，全部一致才在一次写入里改 `plan/current`（`updatedAt` 改成现在，不改 `version`，不写 `plan_history`），并把 `custom` 里等于这些路径或在它们下面的条目删掉（用户同意的是 Claude 的建议）；`custom` 里在它们上面的条目（比如整个 `training.days.B`）留着，同意的改动并进它的 `was`。有一条对不上就整个不改，状态 `stale`（409）
  - xunji：服务器用这个人的模版 key 把 `mutation` 提交给训记（加 `confirmed: true` 和 `mutation_id`），成功 `accepted`，失败 `failed`（`result.error` 写原因）
- 点「不要」（`POST /api/inbox/<id>/decline`）：`declined`
- 提案本身有问题（路径不合规则、少了 `to`）：状态 `failed`（400 `bad_proposal`）；训记提交失败也是 `failed`，`result.error` 写原因，`result.response` 是训记返回的原文（截到 4096 字）
- 每次决定服务器都写一条 `log`（`kind: "decision"`）
- 同一路径有新提案时 Claude 把旧的改成 `stale`；同一个人只有一个 `open` 的训记提案

## `messages/<id>`：用户交代给 Claude 的事（页面写，Claude 回复）
`text（≤ 500 字）, createdAt, kind?: "xunji-templates" | "plan-review", status: new|done, needsReview, reply?: {text, at}, replySeen?`

页面新建时 `status: "new"`、`needsReview: true`（`kind` 是快捷入口带的意图，比如「训练」页上的「让 Claude 把计划写进训记」）。Claude 处理时照办，写 `reply`、`status: "done"`、`needsReview: false`。页面显示过回复后写 `replySeen: true`（「Claude」标签上的角标靠它）。还没处理的用户可以删。

## `log/<id>`：Claude 做过的事（Claude 和服务器写）
```
at, kind: run|plan|xunji|memory|message|decision, text（一句话）, ref?（服务器写的条目指向的 "inbox/<id>" 或 "log/<id>"）,
undo?: {changes: [{path, label?, from, to}]},   // 能撤回的计划改动，path 规则同 inbox
undone?: {at}                                   // 服务器写
```
id 是 `YYYYMMDD-HHMMSS-<4 位随机>`。显示在「Claude → Claude 做过的」。带 `undo` 的有「撤回」按钮（`POST /api/log/<id>/undo`，只接受网页登录）：服务器检查每条路径的当前值等于 `to`，都对上才改回 `from`（同一次写入），写 `undone` 和一条新的 `log`；对不上 409 `stale`。

## `profile/main`：基础信息（页面写入）
```
sex: male|female, age, height, weight, targetWeight?（目标体重 kg）,
goal: fatloss|muscle|lean|recomp|strength|health,     // lean 是「薄肌」：体脂低、有线条、不追求大块
days: 每周训练天数 1–7, minutes: 每次分钟数 10–300, place: gym|home|bodyweight, level: new|some|adv,
diet: 饮食习惯与忌口, injuries: 伤病, notes, needsReview, updatedAt
```
`needsReview: true` 说明用户保存资料时勾了「让 Claude 按新资料重新做计划」（改了关键项时默认勾上，用户可以取消）。没勾的改动不要求重做计划，Claude 照常处理时看一眼就行。

## `profile/prefs`：偏好设置（页面写入，没有 needsReview）
```
dayStartHour?: 0–12,          // 一天从几点算起；没写就用服务器的 LSJ_DAY_START_HOUR
theme?: auto|light|dark,
notify?: {plan?, weigh?, water?},   // 「同步健康」通知里的三种提醒，没写的算开
weighCard?, staleHealth?,     // 「今天」页的称体重提示、健康数据过时提示，没写算开
habits?,                      // 「今日」页的五件套（大水、大睡、大蛋、大站、薄肌），没写算开
waterPresets?: [ml, …],       // 喝水卡片上的按钮（1–6 个）
restTimer?: {on?, sec?},      // 手动记训练的休息计时器：开关、动作没写休息时间时的默认秒数
trainIn?: app|both|xunji,     // 训练记在哪：app 只用薄肌研究所的「训练中」，both 两个都用（训练中为主，训记照常同步、模版照常写），xunji 只用训记；没写时连了训记（meta/xunji.linked）算 both，否则 app。app 时页面不显示训记的东西，Claude 不同步训记、不提议训记模版
consentAt?,                   // 新人引导里点「我知道了」（照片和记录会交给 Claude 分析）的时间；没有的账号 Claude 先不看照片
onboardedAt?,                 // 走完新人引导的时间
autonomy?: small|ask,         // Claude 能自己做主到什么程度：small（默认）小调整直接改、可撤回，其余做成提案；ask 一切改动都做成提案
feelCard?,                    // 「今日」页早上的晨间状态卡，没写算开
style?: abstract|clean,       // 页面风格：abstract 互联网抽象风（默认）、clean 正经的
persona?: coach|abstract|roast,   // Claude 说话的人设：正经教练、抽象搭子、毒舌教练；没写时 style 是 clean 就是 coach，否则 abstract
advanced?: bool,              // 「进阶显示」：RPE、递减组 / 热身组按钮、训练量、e1RM、静息心率和 HRV 这些专业的东西显不显示；没写时 profile.level 是 some / adv 算开，new 或没填算关。只影响显示，数据照存
push?: {report?, proposal?, reply?, remind?},   // 四类推送通知的开关，没写的算开（要先在「我的 → 通知」里开启）
updatedAt
```
服务器（体重归日、快捷指令提醒、训记网页同步）、`bin/lsj`、`bin/xunji` 都按这个人的 `dayStartHour` 算日期。改了只影响之后记的，之前的记录不挪。

## `plan/current`：当前计划（Claude 写，用户可以改）
```
version, updatedAt, phase: "第 1 阶段 · 适应期（1/05–2/01）", summary, notes,
training: {
  note,
  schedule: {"1": "A", "3": "B", "5": "C"},     // ISO 周几（1=周一 … 7=周日）→ 训练日 id，没列出的是休息日
  rotation?: ["A", "B", "C", "D"],               // 可选：按固定顺序轮着练。排了训练的日子（今天及以后）练上一次练过的下一个，错过的不跳过
  days: [{id: "A", name, short?, focus, note,    // short 是页面上显示的简称（≤ 4 字，如「胸」「上肢」），没有就取 name 的第一段
          exercises: [{name, sets: 4, reps: "6–8", load: "RPE 7–8" 或 "60kg", rest: "120s", cue, step?}]}]   // step 是这个动作加重一档是多少 kg（可选，用户在编辑器里选；没有就按历史和器材推，见 CLAUDE.md「这次怎么练」）
},
diet: {
  kcal, protein, carbs, fat,                      // 训练日目标
  restDay?: {kcal, protein, carbs, fat},          // 休息日覆盖值，只写不同的字段
  water,                                          // 每天喝水目标 ml；不写时页面按 35 ml/kg 估
  guidelines: [..], meals: [{slot: "早餐", idea}],
  quick?: [{name, kcal, protein, carbs, fat, when: any|late}]   // 4–6 个快速补蛋白 / 深夜能吃的选择，从用户真会买的东西里挑；late 是适合深夜的
},
custom?: {"<路径>": {at, was}},                    // 用户在页面上改过的地方，见下
phaseInfo?: {name, start, end, focus?, deload?: {start, end}, next?},  // 阶段进度：「训练」页按它画进度条（第几周、减量周、下一阶段）
template?: {name, at, keep}                       // 用户在「训练」页「自己搭一套」选的模版（名字、什么时候；keep 是他要不要 Claude 保留他选的训练日），见下
```
页面会按 `sets` 生成对应数量的记录行。`id` 用一两个字符（A/B/C），只在数据里用（`planDayId`、`days/<日期>.plan`、`training.days.<id>`、`dayMap`、提案的 path）；页面上徽标、chip 和标题显示的是**简称**：`short`，没有就是 `name` 按空格、`·`、`、` 切开的第一段（「胸 肩 三头」→「胸」，最多 4 字），都没有才显示 `id`。用户在「训练」页编辑训练日时可以填简称。Claude 写给用户的文字里也按名字叫训练日（「胸日」「练胸那天」），要对应字母时写成「胸（A）」。旧计划在覆盖前复制到 `plan_history/<YYYY-MM-DD>-v<version>`。

**用户自己搭的计划（`template`）**：没有计划的人可以在「训练」页（或新人引导）从模版（全身 2–3 天、推拉腿、上下肢 4 天……）搭一套，有计划的人也可以「换一套」。页面写 `training`（`schedule`、`rotation`、`days`）、`phase`、`phaseInfo`、`template: {name, at, keep}`，`diet` 留空（有计划的保留原来的 `diet`）；新建时 `version: 1`，换一套时先把旧计划原样存到 `plan_history/<日期>-v<version>-page`，不改 `version`。`keep: true`（「Claude 只给建议，不改我的训练日」，所有人默认开）时 `custom` 里记下每个 `training.days.<id>`、`training.schedule`、`training.rotation`（新建的 `was` 是 null），Claude 只补 `diet`、只提建议；`keep: false`（他自己关掉开关）时不写 `custom`，Claude 第一次做计划可以按资料调整动作和组数，但保留他选的分化和天数。`diet.kcal` 没有时页面按基础信息算临时目标，Claude 下次处理时补上 `diet`（`/fitness-plan`）。

**页面还会写的两处**：`phaseInfo.deload: {start, end}`——用户在「今日」页点了「这周减量」（页面按停滞、连续没做满、晨间状态差、恢复偏差、整体 RPE 高提示）；训练记录里 `exercises[i].replaced: "<原来的动作名>"`——训练中换了动作，收工时选「以后都练这个」时页面同时把计划日里的动作换掉（记进 `custom`）。

**用户改过的地方（`custom`）**：用户可以在「训练」页改训练日（动作、组数、次数、重量、休息、要点，加减训练日）、周安排和轮换顺序，在「今日 → 摄入 → 目标」改饮食目标、休息日目标、喝水目标，在快捷记一笔里改快捷清单。每改一处，页面在 `custom` 里记一条，路径是 `diet.kcal`、`diet.protein`、`diet.carbs`、`diet.fat`、`diet.water`、`diet.restDay`、`diet.quick`、`training.schedule`、`training.rotation`、`training.days.<id>` 之一；`was` 是用户第一次改之前的值（用户新加的训练日 `was` 是 null）。改回和 `was` 一样、或点了「恢复建议值」，这一条就删掉。页面改计划时更新 `updatedAt`，不改 `version`，不写 `plan_history`。

Claude 对 `custom` 里的路径：
- 处理和调整计划时**不覆盖**。觉得该改，就在周报或日报的 `actions` 里提（"休息日热量你设的 2400，比建议高 200，这两周体重涨得偏快，可以回到 2200"），用户在页面上自己改或者在对话里同意后再改
- 用户在对话里让 Claude 重做计划时，可以覆盖，在计划说明里写清楚哪些改回了建议值；覆盖的路径从 `custom` 里删掉
- 写计划时保留 `custom`（`set plan/current` 时把它带上）

## `reports/<id>`：反馈（Claude 写）
```
kind: daily|weekly|plan|phase|guide, date, title, summary（段落用 \n 分隔）,   // phase 是阶段总结
stats?: [{label, value, target?, unit?, prev?}],
goals?: [{label, hit, of}],              // 周报：各项做到了几天，如 {"label": "蛋白质达标", "hit": 5, "of": 7}
sections?: [{heading, items: [..]}], actions?: [..], createdAt,
actionsFor?: "YYYY-MM-DD",               // actions 是给哪天做的：这天没过完时写的就是这天，过完了写的是下一天
done?: {"0": true, …},                   // 页面写：用户勾掉的 actions 序号
skip?: {"1": true, …}                    // 页面写：用户点了「不做」的 actions 序号
```
- 「今天」页顶部的「今天要做的」显示 `actionsFor` 是这天的日报里没被 `skip` 的前 3 条 actions，再加上用户自己的 `todos/<这天>`。可以勾掉（写 `done`）或点「不做」（写 `skip`）。重写同一份日报时，actions 没变就把原来的 `done` 和 `skip` 带上；变了就都不带
- id 规则：`daily-YYYY-MM-DD`、`weekly-YYYY-MM-DD`（周一的日期）、`plan-YYYY-MM-DD-v<version>`
- `stats`：放 3–5 个最要紧的数（周报可以多到 8 个），「今天」和「数据」里显示成一排小标签（窄屏会折行），例如 `{"label": "热量", "value": 2150, "target": 2400, "unit": "kcal"}`、`{"label": "睡眠", "value": "6.8", "unit": "h"}`。`{label, value, target, unit}` 显示成「蛋白质 62 /150 g」，数字最多一位小数，`value` 也可以是短文本。`prev` 是上一期的值（周报写上周的），页面显示成「↑ 120」。数字放这里，`summary` 只写判断。「今天」页的当日点评直接显示 summary、stats 和「接下来」（actions），sections 收在「展开」里
- 写法（标题长度、summary 句数、日期怎么写）见 `fitness-review` 第 4、5 步

## `meta/status`（Claude 写）
`lastRunAt, processed: {meals, workouts}, note, auto?: {ok, at, next?, times?}`

`auto` 和定时处理有关：`ok`、`at` 是无人值守运行（`/fitness-review auto …`）自己写的（这次有没有跑完、什么时候）；`next`（下次运行的时间，ISO）、`times`（`["15:00", "23:30"]`）是 `scripts/auto-review.sh` 写的，页面显示「下次处理约 23:30」。写 `meta/status` 时用 update/merge，不要把别人写的字段冲掉。

## 邀请（服务器表，不是集合）
`invites(id, code_hash, note, max_uses, uses, expires_at, created_by, created_at, revoked_at)`：管理员在「我的 → 用户管理」生成，邀请码只在生成时显示一次，库里只存哈希；`note` 会显示给被邀请的人。朋友打开 `/join?code=…` 自己注册（成为 member、直接登录），`users.invite_id` 记着用的哪个邀请。注册后推送给管理员「新朋友注册了」。注册和检查邀请码按 IP 限流（10 分钟失败 10 次、每小时最多注册 5 个）。

## 推送通知（服务器表，不是集合）
加到主屏幕的薄肌研究所可以收通知（iOS 16.4 以上）。`push_subs` 存每台设备的订阅，`push_queue` 存要显示的通知（每人最近 50 条）。服务器只发**不带内容**的推送，手机上的 service worker（`/sw.js`）收到后用 cookie 请求 `GET /api/push/next` 取标题和正文，所以推送服务商看不到内容。Claude 处理完用 `bin/lsj notify` 发（按 `profile/prefs.push` 过滤）。VAPID 密钥在 `LSJ_DATA/vapid.json`。

**延时提醒**（组间计时用，只接受网页登录）：`POST /api/push/later` `{delaySec: 10–900 的整数, title ≤ 40 字, body ≤ 80 字, url: 站内路径（和 notify 一样校验，没写就是 `/`）}` → `{id}`，到点时服务器按 `remind` 类发（`prefs.push.remind` 关了就不发），走同一个 `push_queue` 和每分钟 6 条的限制。同一个人同时只有一条：再 POST 就替换旧的（旧 id 作废）；每人每分钟最多安排 10 次（429）。没有订阅、或 `remind` 关了，返回 `{id: null, skipped: "nosub" | "off"}`，不排。`DELETE /api/push/later/<id>` 取消，不存在或已发也返回 `{ok: true}`。只在服务进程内存里，重启就丢；停用或删除账号时一起取消。

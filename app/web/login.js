/* 登录页（/login）、用邀请码注册（/join，同一个 login.html）和「你的数据怎么处理」（/privacy）共用。
   第一帧之前：按 localStorage 的 lsj-style（app.js 写的；'clean' 是正经，没有就是抽象）和 lsj-theme（'light' / 'dark'，没有就跟系统）
   设好 <html data-style / data-theme>，/join 再加 data-mode="join"（login.html 的样式据此只显示注册表单）。CSP 不允许内联脚本，
   所以这个文件在 <head> 里同步加载（不加 defer），表单的事件等 DOMContentLoaded 再绑。
   注册：先 POST /api/join/check 看邀请码（链接里的 ?code= 会自动填好、自动检查），通过后填用户名、名字、密码，
   POST /api/join 建账号并直接登录，然后进首页。 */
(() => {
'use strict';
const root = document.documentElement;
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const style = lsGet('lsj-style'), theme = lsGet('lsj-theme');
if (style === 'clean' || style === 'plain') root.removeAttribute('data-style'); else root.dataset.style = 'abstract';
if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
const joining = location.pathname === '/join';
if (joining) root.dataset.mode = 'join';
// The browser bar's colour: the page's ground in this theme and style (the same values as app.js's themeMeta).
{
  const ab = root.dataset.style === 'abstract', t = root.dataset.theme || 'auto';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const dark = t === 'auto' ? /dark/.test(m.media) : t === 'dark';
    m.content = ab ? (dark ? '#0A0A0B' : '#FFF6D9') : dark ? '#0E1217' : '#F1F3F5';
  });
}

const $ = id => document.getElementById(id);
const OFFLINE = '连不上服务器，检查网络';

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, err: d.error || {}, data: d };
}

function setupLogin() {
  $('f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('go'), err = $('err');
    btn.disabled = true; err.textContent = '';
    try {
      const r = await post('/api/login', { username: $('un').value.trim().toLowerCase(), password: $('pw').value });
      if (r.ok) { location.href = '/'; return; }
      err.textContent = r.status === 429 || r.err.code === 'rate_limited' ? '试得太多了，10 分钟后再试' : r.err.code === 'wrong_password' ? '用户名或密码不对' : '登录失败，稍后再试';
    } catch (x) { err.textContent = OFFLINE; }
    btn.disabled = false;
  });
}

// What the sign-up shows for each error code (the server answers a wrong, used-up, expired or revoked code alike).
const JOIN_ERRORS = {
  invalid_invite: '邀请码不对或已失效：找发给你的人要一个新的',
  bad_username: '用户名只能用 2–32 位小写字母、数字或 _ . -',
  weak_password: '密码至少 8 位',
  username_taken: '这个用户名有人用了，换一个',
  cross_site: '注册失败：请直接在浏览器里打开邀请链接',
};
const joinError = r => r.status === 429 || r.err.code === 'rate_limited'
  ? (r.err.message || '试得太多了，过一会儿再试') : JOIN_ERRORS[r.err.code] || '注册失败，稍后再试';
const USERNAME = /^[a-z0-9_.-]{2,32}$/;

function setupJoin() {
  document.title = '注册 · 薄肌研究所';
  const step1 = $('j1'), step2 = $('j2'), codeIn = $('code');
  let code = '';
  const show = two => {
    step1.hidden = two; step2.hidden = !two;
    (two ? $('ju') : codeIn).focus({ preventScroll: true });
  };
  async function check() {
    const btn = $('j1-go'), err = $('j1-err');
    const typed = codeIn.value.trim();
    if (!typed) { err.textContent = '先填邀请码'; codeIn.focus(); return; }
    btn.disabled = true; btn.textContent = '正在检查…'; err.textContent = '';
    try {
      const r = await post('/api/join/check', { code: typed });
      if (r.ok) {
        code = typed;
        $('j2-ok').textContent = '邀请码可以用' + (r.data.note ? ` · ${r.data.note}` : '');
        show(true);
      } else err.textContent = joinError(r);
    } catch (x) { err.textContent = OFFLINE; }
    btn.disabled = false; btn.textContent = '下一步';
  }
  step1.addEventListener('submit', e => { e.preventDefault(); check(); });
  $('j2-back').addEventListener('click', e => { e.preventDefault(); $('j2-err').textContent = ''; show(false); codeIn.select(); });
  step2.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('j2-go'), err = $('j2-err');
    const username = $('ju').value.trim().toLowerCase(), password = $('jp').value;
    err.textContent = '';
    if (!USERNAME.test(username)) { err.textContent = JOIN_ERRORS.bad_username; $('ju').focus(); return; }
    if (password.length < 8) { err.textContent = JOIN_ERRORS.weak_password; $('jp').focus(); return; }
    if (password !== $('jp2').value) { err.textContent = '两次输的密码不一样'; $('jp2').focus(); return; }
    btn.disabled = true; btn.textContent = '正在注册…';
    try {
      const r = await post('/api/join', { code, username, name: $('jn').value.trim(), password });
      if (r.ok) { location.replace('/'); return; }
      err.textContent = joinError(r);
      if (r.err.code === 'invalid_invite') { $('j1-err').textContent = err.textContent; show(false); }
      else if (r.err.code === 'username_taken' || r.err.code === 'bad_username') $('ju').focus();
    } catch (x) { err.textContent = OFFLINE; }
    btn.disabled = false; btn.textContent = '注册并登录';
  });
  const fromLink = new URLSearchParams(location.search).get('code');
  if (fromLink) { codeIn.value = fromLink.slice(0, 20); check(); }
  else codeIn.focus({ preventScroll: true });
}

document.addEventListener('DOMContentLoaded', () => {
  if (joining && $('j1')) setupJoin();
  else if ($('f')) setupLogin();
});
})();

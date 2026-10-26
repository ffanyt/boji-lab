#!/usr/bin/env python3
"""Render the 薄肌研究所 home-screen icons and iOS launch screens (PNG) with headless Chrome.

    deploy/make-icons.py                  everything: app/web/icons/*.png and app/web/splash/*.png
    deploy/make-icons.py --only icons     just the icons (or --only splash)
    deploy/make-icons.py --chrome PATH    another Chrome / Chromium (default: $CHROME, else Google Chrome in /Applications)
    deploy/make-icons.py --port N         DevTools port (default 9363)

Sources (edit these, then run the script; the PNGs are never edited by hand):
  app/web/icons/icon.svg      the app icon. #lsj-bg is the full-bleed ground, #lsj-art the sticker on it; the
                              maskable icon keeps the ground and scales #lsj-art into the central safe zone.
                              Everything is drawn as shapes, so the file needs no font.
  app/web/icons/favicon.svg   the browser-tab icon (simpler, transparent corners)
  SPLASH_CSS / SPLASH_HTML    below: the launch screen (icon, 「薄肌研究所」, 「你的 AI 私教」), light and dark

Output:
  icons/icon-180.png (apple-touch-icon), icon-192.png, icon-512.png, icon-maskable-512.png, favicon-32.png
  splash/splash-<W>x<H>-light.png and -dark.png for every iPhone in DEVICES (W×H in device pixels, portrait)

The launch-screen text is set in PingFang SC (a macOS system font) with a hairline stroke to make it heavier, so run
this on a Mac; 「AI」 uses the self-hosted Barlow Condensed in app/web/fonts. No network access, no outside services.

Needs Python 3.9+ (standard library only) and Google Chrome. Chrome runs headless with a throwaway profile, listens
on 127.0.0.1:<port>, and is stopped by its own PID when the script ends.
After running it, deploy as usual (deploy/deploy.sh); the server serves /icons/*.png|svg and /splash/*.png.
"""
import argparse
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'app', 'web')
ICONS = os.path.join(WEB, 'icons')
SPLASH = os.path.join(WEB, 'splash')
DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# iPhone screens: (CSS width, CSS height, device pixel ratio), portrait
DEVICES = [
    (375, 667, 2),   # SE 2nd/3rd gen, 8, 7, 6s
    (375, 812, 3),   # X, XS, 11 Pro, 12 mini, 13 mini
    (390, 844, 3),   # 12, 12 Pro, 13, 13 Pro, 14, 16e
    (393, 852, 3),   # 14 Pro, 15, 15 Pro, 16
    (402, 874, 3),   # 16 Pro, 17, 17 Pro
    (414, 896, 2),   # XR, 11
    (414, 896, 3),   # XS Max, 11 Pro Max
    (420, 912, 3),   # Air
    (428, 926, 3),   # 12 Pro Max, 13 Pro Max, 14 Plus
    (430, 932, 3),   # 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    (440, 956, 3),   # 16 Pro Max, 17 Pro Max
]

# Maskable icon: the safe zone is a circle of radius 40% of the icon. 0.68 keeps the egg and its sparkles inside it.
MASKABLE_SCALE = 0.68

THEMES = {
    'light': dict(bg='#FFF6D9', dots='rgba(17,17,17,.075)', ink='#111111', frame='#111111', frame_shadow='#111111',
                  hl='#FFE14D', pill='#C3FF3A', pill_bd='#111111', pill_shadow='#111111'),
    'dark': dict(bg='#0A0A0B', dots='rgba(255,255,255,.07)', ink='#F7F5EE', frame='#EDEBE4', frame_shadow='#C3FF3A',
                 hl='#5B2BC4', pill='#C3FF3A', pill_bd='#111111', pill_shadow='#9B6BFF'),
}

SPLASH_CSS = '''
@font-face{font-family:"Barlow Condensed";font-weight:700;src:url("%(fonts)s/barlow-condensed-700.woff2") format("woff2")}
html,body{margin:0;height:100%%}
body{background-color:%(bg)s;background-image:radial-gradient(%(dots)s 1.2px,transparent 1.7px);background-size:18px 18px;
  background-position:center;color:%(ink)s;font-family:"PingFang SC",sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding-bottom:6vh;box-sizing:border-box}
.icon{width:128px;height:128px;border-radius:29px;border:3px solid %(frame)s;box-shadow:6px 6px 0 %(frame_shadow)s;
  overflow:hidden;display:block;box-sizing:content-box}
.icon img{width:100%%;height:100%%;display:block}
h1{margin:34px 0 0;font-size:44px;line-height:1;font-weight:600;letter-spacing:.14em;
  -webkit-text-stroke:1.3px currentColor;padding:0 .08em 0 .22em;  /* left = right + the trailing letter-spacing */
  background:linear-gradient(transparent 56%%,%(hl)s 56%%,%(hl)s 94%%,transparent 94%%)}
.pill{margin-top:22px;padding:7px 15px 7px 16px;border-radius:999px;background:%(pill)s;color:#111111;
  border:2px solid %(pill_bd)s;box-shadow:3px 3px 0 %(pill_shadow)s;transform:rotate(-2.5deg);
  font-size:16px;line-height:1.2;font-weight:600;letter-spacing:.06em;-webkit-text-stroke:.3px #111111}
.pill b{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:1.18em;letter-spacing:.04em;
  -webkit-text-stroke:0;margin:0 .06em}
'''
SPLASH_HTML = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>%(css)s</style>
<body><div class="icon"><img src="%(icon)s" alt=""></div><h1>薄肌研究所</h1><div class="pill">你的 <b>AI</b> 私教</div></body></html>'''


# ---------------------------------------------------------------- a minimal DevTools client (stdlib websocket)

class CDP:
    def __init__(self, ws_url):
        u = urlparse(ws_url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f'GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n'
                           f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError('DevTools closed the connection')
            buf += chunk
        if b' 101 ' not in buf.split(b'\r\n', 1)[0]:
            raise RuntimeError('DevTools refused the websocket')
        self.buf = buf.split(b'\r\n\r\n', 1)[1]
        self.next_id = 0

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise RuntimeError('DevTools closed the connection')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _message(self):
        data = b''
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7f
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            payload = self._read(n)
            if b1 & 0x0f == 8:
                raise RuntimeError('DevTools closed the connection')
            data += payload
            if b1 & 0x80:
                return json.loads(data)

    def call(self, method, **params):
        self.next_id += 1
        data = json.dumps({'id': self.next_id, 'method': method, 'params': params}).encode()
        n, mask = len(data), os.urandom(4)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else
                                bytes([0x80 | 126]) + struct.pack('>H', n) if n < 65536 else
                                bytes([0x80 | 127]) + struct.pack('>Q', n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        while True:
            msg = self._message()
            if msg.get('id') == self.next_id:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})


class Chrome:
    """Headless Chrome with a throwaway profile; stopped by PID on exit."""

    def __init__(self, binary, port):
        self.binary, self.port = binary, port

    def __enter__(self):
        if not os.path.exists(self.binary):
            sys.exit(f'Chrome not found: {self.binary} (use --chrome PATH)')
        with socket.socket() as s:
            if s.connect_ex(('127.0.0.1', self.port)) == 0:
                sys.exit(f'port {self.port} is already in use (use --port N)')
        self.profile = tempfile.mkdtemp(prefix='lsj-icons-')
        self.proc = subprocess.Popen(
            [self.binary, '--headless=new', f'--remote-debugging-port={self.port}', '--remote-debugging-address=127.0.0.1',
             f'--user-data-dir={self.profile}', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
             '--hide-scrollbars', '--force-color-profile=srgb', '--allow-file-access-from-files', 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        page = None
        for _ in range(150):
            if self.proc.poll() is not None:
                self._cleanup()
                sys.exit('Chrome exited during startup')
            try:
                tabs = json.loads(opener.open(f'http://127.0.0.1:{self.port}/json', timeout=2).read())
                page = next((t for t in tabs if t.get('type') == 'page'), None)
                if page:
                    break
            except OSError:
                pass
            time.sleep(0.1)
        if not page:
            self.__exit__()
            sys.exit('Chrome did not open its DevTools port')
        self.cdp = CDP(page['webSocketDebuggerUrl'])
        self.cdp.call('Page.enable')
        return self

    def _cleanup(self):
        shutil.rmtree(self.profile, ignore_errors=True)

    def __exit__(self, *exc):
        if self.proc.poll() is None:
            os.kill(self.proc.pid, 15)  # SIGTERM to our own Chrome, by PID
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                os.kill(self.proc.pid, 9)
                self.proc.wait(5)
        self._cleanup()

    def render(self, html, out, width, height, scale, transparent=False):
        """Lay the page out at width×height CSS px and save a width*scale × height*scale PNG."""
        page = os.path.join(self.profile, 'page.html')
        with open(page, 'w', encoding='utf-8') as f:
            f.write(html)
        c = self.cdp
        c.call('Emulation.setDeviceMetricsOverride', width=width, height=height, deviceScaleFactor=scale, mobile=False)
        c.call('Emulation.setDefaultBackgroundColorOverride',
               color={'r': 0, 'g': 0, 'b': 0, 'a': 0 if transparent else 1})
        c.call('Page.navigate', url='file://' + page + f'?t={time.time()}')
        for _ in range(300):
            r = c.call('Runtime.evaluate', expression='document.readyState', returnByValue=True)
            if r['result'].get('value') == 'complete':
                break
            time.sleep(0.03)
        r = c.call('Runtime.evaluate', returnByValue=True, awaitPromise=True, expression=(
            'Promise.all([document.fonts.ready].concat(Array.from(document.images, i => i.decode())))'
            '.then(() => Array.from(document.images).every(i => i.naturalWidth > 0))'))
        if not r['result'].get('value'):
            raise RuntimeError(f'{out}: an image did not load')
        time.sleep(0.05)
        shot = c.call('Page.captureScreenshot', format='png', captureBeyondViewport=False,
                      clip={'x': 0, 'y': 0, 'width': width, 'height': height, 'scale': 1})
        data = base64.b64decode(shot['data'])
        got = struct.unpack('>II', data[16:24])
        want = (round(width * scale), round(height * scale))
        if data[:8] != b'\x89PNG\r\n\x1a\n' or got != want:
            raise RuntimeError(f'{out}: got {got}, expected {want}')
        tmp = out + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, out)
        print(f'{os.path.relpath(out, ROOT)}  {want[0]}×{want[1]}  {len(data) // 1024} KB')


def file_url(path):
    return 'file://' + urllib.request.pathname2url(os.path.abspath(path))


def svg_text(name):
    with open(os.path.join(ICONS, name), encoding='utf-8') as f:
        text = f.read()
    return text[text.index('<svg'):]


def icon_page(svg, size, extra_css=''):
    return (f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}'
            f'svg{{display:block;width:{size}px;height:{size}px}}{extra_css}</style>{svg}')


def make_icons(chrome):
    icon = svg_text('icon.svg')
    for size in (180, 192, 512):
        chrome.render(icon_page(icon, size), os.path.join(ICONS, f'icon-{size}.png'), size, size, 1)
    maskable = (f'#lsj-art{{transform:scale({MASKABLE_SCALE});transform-origin:512px 512px}}')
    chrome.render(icon_page(icon, 512, maskable), os.path.join(ICONS, 'icon-maskable-512.png'), 512, 512, 1)
    chrome.render(icon_page(svg_text('favicon.svg'), 32), os.path.join(ICONS, 'favicon-32.png'), 32, 32, 1,
                  transparent=True)


def make_splash(chrome):
    icon = file_url(os.path.join(ICONS, 'icon.svg'))
    fonts = file_url(os.path.join(WEB, 'fonts'))
    for theme, colors in THEMES.items():
        css = SPLASH_CSS % dict(colors, fonts=fonts)
        html = SPLASH_HTML % dict(css=css, icon=icon)
        for w, h, dpr in DEVICES:
            chrome.render(html, os.path.join(SPLASH, f'splash-{w * dpr}x{h * dpr}-{theme}.png'), w, h, dpr)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n', 1)[0])
    ap.add_argument('--only', choices=('icons', 'splash'))
    ap.add_argument('--chrome', default=os.environ.get('CHROME') or DEFAULT_CHROME)
    ap.add_argument('--port', type=int, default=9363)
    a = ap.parse_args()
    for name in ('icon.svg', 'favicon.svg'):
        if not os.path.isfile(os.path.join(ICONS, name)):
            sys.exit(f'missing source: app/web/icons/{name}')
    os.makedirs(SPLASH, exist_ok=True)
    with Chrome(a.chrome, a.port) as chrome:
        if a.only in (None, 'icons'):
            make_icons(chrome)
        if a.only in (None, 'splash'):
            make_splash(chrome)


if __name__ == '__main__':
    main()

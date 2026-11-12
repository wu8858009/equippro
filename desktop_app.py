"""設備管家 desktop app.

Serves the web app from a small local HTTP server (threaded, so parallel
script loads never get dropped) and shows it in a pywebview window. Data is
kept in %APPDATA%\\ShebeiGuanjia\\data.json with daily backups.

Env vars for testing:
  SG_DATA_DIR   use this folder instead of %APPDATA%\\ShebeiGuanjia
  SG_OFFSCREEN  1 = place the window off screen
  SG_SELFTEST   seconds; quit after that many seconds and print a status line
"""
import base64
import ctypes
import datetime
import json
import os
import secrets
import shutil
import sys
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import webview

APP_NAME = '設備管家'
BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, 'web') if getattr(sys, 'frozen', False) else BASE_DIR
DATA_DIR = os.environ.get('SG_DATA_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), 'ShebeiGuanjia')
DATA_FILE = os.path.join(DATA_DIR, 'data.json')
PREFS_FILE = os.path.join(DATA_DIR, 'prefs.json')  # sync settings + remembered login
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
TOKEN = secrets.token_urlsafe(24)
ALLOWED = ('index.html', 'css/', 'js/', 'icons/', 'manifest.webmanifest')
write_lock = threading.Lock()
window = None


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def save_db(text):
    json.loads(text)  # refuse to store anything that is not valid JSON
    with write_lock:
        write_atomic(DATA_FILE, text)
        daily_backup()


def daily_backup():
    """One copy per day, newest 30 kept."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    name = os.path.join(BACKUP_DIR, f'data_{datetime.date.today():%Y%m%d}.json')
    if not os.path.exists(name):
        shutil.copyfile(DATA_FILE, name)
        old = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith('data_'))
        for f in old[:-30]:
            try:
                os.remove(os.path.join(BACKUP_DIR, f))
            except OSError:
                pass


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _authorized(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        return secrets.compare_digest(self.headers.get('X-SG-Token', '') or (q.get('t') or [''])[0], TOKEN)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n).decode('utf-8') if n else ''

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/api/'):
            if not self._authorized():
                return self._json({'ok': False}, 403)
            if path == '/api/db':
                return self._json({'ok': True, 'db': read_json(DATA_FILE), 'prefs': read_json(PREFS_FILE, {}), 'path': DATA_DIR})
            return self._json({'ok': False}, 404)
        rel = path.lstrip('/') or 'index.html'
        if not rel.startswith(ALLOWED):
            return self._json({'ok': False}, 404)
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self._authorized():
            return self._json({'ok': False}, 403)
        try:
            if path == '/api/db':
                save_db(self._body())
                return self._json({'ok': True})
            if path == '/api/prefs':
                prefs = json.loads(self._body() or '{}')
                with write_lock:
                    write_atomic(PREFS_FILE, json.dumps(prefs, ensure_ascii=False))
                return self._json({'ok': True})
            if path == '/api/savefile':
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                name = os.path.basename((q.get('name') or ['export.csv'])[0]) or 'export.csv'
                text = self._body()
                ext = os.path.splitext(name)[1].lower()
                types = {'.csv': ('CSV 檔 (*.csv)', '所有檔案 (*.*)'), '.jpg': ('JPEG 圖片 (*.jpg)', '所有檔案 (*.*)'),
                         '.xlsx': ('Excel 活頁簿 (*.xlsx)', '所有檔案 (*.*)')}.get(
                    ext, ('JSON 檔 (*.json)', '所有檔案 (*.*)'))
                res = window.create_file_dialog(webview.FileDialog.SAVE, directory=os.path.join(os.path.expanduser('~'), 'Documents'),
                                                save_filename=name, file_types=types)
                if not res:
                    return self._json({'ok': False, 'cancelled': True})
                target = res if isinstance(res, str) else res[0]
                if text.startswith('data:') and ';base64,' in text[:80]:  # photos arrive as data URLs
                    with open(target, 'wb') as f:
                        f.write(base64.b64decode(text.split(',', 1)[1]))
                else:
                    with open(target, 'w', encoding='utf-8', newline='') as f:
                        f.write(text)
                return self._json({'ok': True, 'path': target})
        except Exception as e:  # report instead of dropping the connection
            return self._json({'ok': False, 'error': str(e)}, 500)
        return self._json({'ok': False}, 404)


def single_instance():
    """Returns False if another copy is already running."""
    if os.name != 'nt' or os.environ.get('SG_SELFTEST'):
        return True
    ctypes.windll.kernel32.CreateMutexW(None, False, 'ShebeiGuanjia_SingleInstance')
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        ctypes.windll.user32.MessageBoxW(None, '設備管家已經開啟了，請到工作列切換視窗。', APP_NAME, 0x40)
        return False
    return True


def centered_geometry(want_w, want_h):
    """Window size (logical px) that fits the primary screen's work area (the
    area not covered by the taskbar), and the x/y that centers it there.
    pywebview only centers when the window is smaller than the screen, so a
    1320x860 window on a laptop or a 125%/150% scaled display ended up
    pushed to a corner."""
    if os.name != 'nt':
        return want_w, want_h, None, None
    try:
        user32 = ctypes.windll.user32
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)  # same as pywebview; harmless if already set
        except Exception:
            pass

        class RECT(ctypes.Structure):
            _fields_ = [('left', ctypes.c_long), ('top', ctypes.c_long), ('right', ctypes.c_long), ('bottom', ctypes.c_long)]
        r = RECT()
        if not user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0):  # SPI_GETWORKAREA, physical px
            raise OSError('SPI_GETWORKAREA failed')
        try:
            scale = user32.GetDpiForSystem() / 96.0
        except Exception:
            scale = 1.0
        left, top = r.left / scale, r.top / scale
        avail_w, avail_h = (r.right - r.left) / scale, (r.bottom - r.top) / scale
        w = int(min(want_w, avail_w * 0.94))
        h = int(min(want_h, avail_h * 0.94))
        x = int(left + (avail_w - w) / 2)
        y = int(top + (avail_h - h) / 2)
        return w, h, x, y
    except Exception:
        return want_w, want_h, None, None


def selftest(win, seconds):
    time.sleep(seconds)
    try:
        status = win.evaluate_js("JSON.stringify({splash: !!document.getElementById('splash'), app: document.getElementById('app').innerHTML.length,"
                                 " desktop: !!(window.SG && SG.desktop), title: document.title})")
    except Exception as e:
        status = 'ERR ' + str(e)
    print('SELFTEST', status, flush=True)
    try:
        print('GEOMETRY', win.x, win.y, win.width, win.height, centered_geometry(1320, 860), flush=True)
    except Exception as e:
        print('GEOMETRY ERR', e, flush=True)
    win.destroy()


def main():
    global window
    if not single_instance():
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_address[1]}/index.html?desktop=1&t={TOKEN}'
    width, height, x, y = centered_geometry(1320, 860)
    kw = dict(width=width, height=height, x=x, y=y, min_size=(380, 560), text_select=True)
    if os.environ.get('SG_OFFSCREEN'):
        kw.update(x=-4000, y=-4000)
    window = webview.create_window(APP_NAME, url, **kw)
    st = os.environ.get('SG_SELFTEST')
    # Private mode: data lives in DATA_FILE/PREFS_FILE, and a fresh browser
    # profile avoids "resource in use" errors when the app is reopened quickly.
    webview.start(selftest if st else None, (window, float(st)) if st else None, private_mode=True)
    server.shutdown()


if __name__ == '__main__':
    main()

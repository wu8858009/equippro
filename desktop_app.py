"""設備管家 desktop app.

Serves the web app from a small local HTTP server (threaded, so parallel
script loads never get dropped) and shows it in a pywebview window. Data is
kept in %APPDATA%\\ShebeiGuanjia\\data.json with daily backups.

Runs in the background: closing the window hides it to the system tray
(the page keeps syncing and raises Windows notifications through the tray
icon); 「結束」 in the tray menu really quits. `--tray` starts hidden (used
by the start-with-Windows entry). Opening the exe again just shows the
running copy.

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

APP_NAME = '設備管家 PRO'
BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, 'web') if getattr(sys, 'frozen', False) else BASE_DIR
DATA_DIR = os.environ.get('SG_DATA_DIR') or os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), 'ShebeiGuanjia')
DATA_FILE = os.path.join(DATA_DIR, 'data.json')
PREFS_FILE = os.path.join(DATA_DIR, 'prefs.json')  # sync settings + remembered login
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')
INSTANCE_FILE = os.path.join(DATA_DIR, 'instance.json')  # port+token of the running copy
TOKEN = secrets.token_urlsafe(24)
ALLOWED = ('index.html', 'css/', 'js/', 'icons/', 'manifest.webmanifest')
RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
RUN_NAME = 'ShebeiGuanjiaPRO'
write_lock = threading.Lock()
window = None
tray = None
quitting = False
hint_shown = False


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
            if path == '/api/autostart':
                return self._json({'ok': True, 'on': get_autostart()})
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
            if path == '/api/notify':
                body = json.loads(self._body() or '{}')
                notify(str(body.get('title') or APP_NAME)[:60], str(body.get('body') or '')[:240])
                return self._json({'ok': True})
            if path == '/api/autostart':
                body = json.loads(self._body() or '{}')
                set_autostart(bool(body.get('on')))
                return self._json({'ok': True, 'on': get_autostart()})
            if path == '/api/bg':
                return self._json({'ok': True})  # tray preference lives in prefs.json (read at close time)
            if path == '/api/openfile':
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                name = os.path.basename((q.get('name') or ['file.pdf'])[0]) or 'file.pdf'
                name = ''.join(c for c in name if c not in '<>:"/\\|?*') or 'file.pdf'
                text = self._body()
                if not (text.startswith('data:') and ';base64,' in text[:80]):
                    return self._json({'ok': False, 'error': '檔案格式錯誤'})
                folder = os.path.join(os.environ.get('TEMP') or DATA_DIR, 'ShebeiGuanjia')
                os.makedirs(folder, exist_ok=True)
                target = os.path.join(folder, name)
                with open(target, 'wb') as f:
                    f.write(base64.b64decode(text.split(',', 1)[1]))
                if os.environ.get('SG_SELFTEST') or os.environ.get('SG_NO_OPEN'):
                    return self._json({'ok': True, 'path': target, 'opened': False})
                os.startfile(target)  # default program (PDF reader / photo viewer)
                return self._json({'ok': True, 'path': target})
            if path == '/api/show':
                show_window()
                return self._json({'ok': True})
            if path == '/api/savefile':
                q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                name = os.path.basename((q.get('name') or ['export.csv'])[0]) or 'export.csv'
                text = self._body()
                ext = os.path.splitext(name)[1].lower()
                types = {'.csv': ('CSV 檔 (*.csv)', '所有檔案 (*.*)'), '.jpg': ('JPEG 圖片 (*.jpg)', '所有檔案 (*.*)'),
                         '.pdf': ('PDF 文件 (*.pdf)', '所有檔案 (*.*)'),
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
    """Returns False if another copy is already running (after asking that
    copy to show its window, e.g. when it is hidden in the tray)."""
    if os.name != 'nt' or os.environ.get('SG_SELFTEST'):
        return True
    ctypes.windll.kernel32.CreateMutexW(None, False, 'ShebeiGuanjia_SingleInstance')
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        info = read_json(INSTANCE_FILE, {}) or {}
        try:
            import urllib.request
            req = urllib.request.Request(f"http://127.0.0.1:{int(info['port'])}/api/show", data=b'{}',
                                         headers={'X-SG-Token': info['token']}, method='POST')
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            ctypes.windll.user32.MessageBoxW(None, '設備管家已經在執行中（右下角系統匣）。', APP_NAME, 0x40)
        return False
    return True


# ---------------------------------------------------------------- background / tray
def exe_command():
    if getattr(sys, 'frozen', False):
        return f'"{sys.executable}" --tray'
    pyw = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    return f'"{pyw if os.path.exists(pyw) else sys.executable}" "{os.path.abspath(__file__)}" --tray'


def get_autostart():
    if os.name != 'nt':
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, RUN_NAME)
            return True
    except OSError:
        return False


def set_autostart(on):
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        if on:
            winreg.SetValueEx(k, RUN_NAME, 0, winreg.REG_SZ, exe_command())
        else:
            try:
                winreg.DeleteValue(k, RUN_NAME)
            except OSError:
                pass


def notify(title, body):
    if tray is not None:
        try:
            tray.notify(body or ' ', title)
            return
        except Exception:
            pass
    if os.name == 'nt':
        ctypes.windll.user32.MessageBeep(0x40)


def show_window():
    def run():
        try:
            window.show()
            window.restore()
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


def tray_enabled():
    bg = (read_json(PREFS_FILE, {}) or {}).get('sg_bg') or {}
    return bg.get('tray', True)


def on_closing():
    """Closing the window hides it to the tray unless the user turned that
    off or chose 結束. Must not touch the window from this thread (the GUI
    thread is waiting for us), hence the helper thread."""
    global hint_shown
    if quitting or tray is None or os.environ.get('SG_SELFTEST') or not tray_enabled():
        return True

    def hide():
        time.sleep(0.05)
        try:
            window.hide()
        except Exception:
            pass
    threading.Thread(target=hide, daemon=True).start()
    if not hint_shown:
        hint_shown = True
        notify(APP_NAME, '仍在背景執行，會繼續同步並提醒新報修。要開啟請點右下角圖示；要結束請在圖示上按右鍵 →「結束」。')
    return False


def quit_app():
    global quitting
    quitting = True
    try:
        if tray is not None:
            tray.stop()
    except Exception:
        pass
    try:
        window.destroy()
    except Exception:
        pass


def start_tray():
    """System-tray icon (pystray) with 開啟／立即同步／開機啟動／結束."""
    global tray
    try:
        import pystray
        from PIL import Image
    except Exception:
        return None
    try:
        img = Image.open(os.path.join(WEB_DIR, 'icons', 'icon-192.png')).resize((64, 64))
    except Exception:
        img = Image.new('RGBA', (64, 64), (13, 148, 136, 255))

    def sync_now(icon, item):
        def run():
            try:
                window.evaluate_js('window.SG && SG.sync && SG.sync.syncNow().catch(function(){})')
            except Exception:
                pass
        threading.Thread(target=run, daemon=True).start()

    def toggle_auto(icon, item):
        try:
            set_autostart(not get_autostart())
        except Exception:
            pass

    menu = pystray.Menu(
        pystray.MenuItem('開啟設備管家', lambda icon, item: show_window(), default=True),
        pystray.MenuItem('立即同步', sync_now),
        pystray.MenuItem('開機時自動啟動', toggle_auto, checked=lambda item: get_autostart()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem('結束', lambda icon, item: quit_app()),
    )
    tray = pystray.Icon('ShebeiGuanjiaPRO', img, APP_NAME, menu)
    threading.Thread(target=tray.run, daemon=True).start()
    return tray


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
    print('SELFTEST', status, 'tray=' + str(tray is not None), flush=True)
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
    try:
        write_atomic(INSTANCE_FILE, json.dumps({'port': server.server_address[1], 'token': TOKEN, 'pid': os.getpid()}))
    except OSError:
        pass
    width, height, x, y = centered_geometry(1320, 860)
    start_hidden = '--tray' in sys.argv
    kw = dict(width=width, height=height, x=x, y=y, min_size=(380, 560), text_select=True, hidden=start_hidden)
    if os.environ.get('SG_OFFSCREEN'):
        kw.update(x=-4000, y=-4000)
    window = webview.create_window(APP_NAME, url, **kw)
    window.events.closing += on_closing
    start_tray()
    st = os.environ.get('SG_SELFTEST')
    # Private mode: data lives in DATA_FILE/PREFS_FILE, and a fresh browser
    # profile avoids "resource in use" errors when the app is reopened quickly.
    webview.start(selftest if st else None, (window, float(st)) if st else None, private_mode=True)
    try:
        if tray is not None:
            tray.stop()
    except Exception:
        pass
    try:
        os.remove(INSTANCE_FILE)
    except OSError:
        pass
    server.shutdown()


if __name__ == '__main__':
    main()

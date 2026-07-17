"""EquipPro desktop launcher.

Wraps the existing web app (index.html + css/js) in a native desktop
window using pywebview, so the same code that runs on GitHub Pages also
runs as a Windows desktop app. Unlike the browser version — where data
lives only inside the browser's hidden local storage — this launcher also
mirrors the app's data into a plain JSON file, so it's visible, portable,
and safe to back up. The desktop app and a browser tab still don't share
data with each other.

Setup (once):
    pip install pywebview

Run:
    python desktop_app.py
"""
import os
import shutil
import sys
import webview

# When frozen by PyInstaller, bundled data files (index.html, css/, js/) are
# extracted to sys._MEIPASS at runtime instead of living next to this script.
RESOURCE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(RESOURCE_DIR, "index.html")

# The data file lives in the user's per-user AppData folder rather than next
# to the .exe, so it survives no matter how a new release is installed —
# overwriting the same .exe in place, or unzipping a fresh copy into a brand
# new folder. (Falls back to the script/exe folder if APPDATA isn't set,
# e.g. on non-Windows.)
if getattr(sys, "frozen", False):
    _LEGACY_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    _LEGACY_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.environ.get("APPDATA", _LEGACY_DIR), "EquipPro")
DATA_PATH = os.path.join(DATA_DIR, "equippro_data.json")
_LEGACY_DATA_PATH = os.path.join(_LEGACY_DIR, "equippro_data.json")


def _migrate_legacy_data():
    """One-time move of data from the old next-to-the-exe location, so
    users upgrading from an earlier version don't lose their existing
    records when this launcher switches to the AppData location."""
    if os.path.exists(DATA_PATH) or not os.path.exists(_LEGACY_DATA_PATH):
        return
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        shutil.copy2(_LEGACY_DATA_PATH, DATA_PATH)
    except OSError as e:
        print(f"[警告] 搬移舊資料檔失敗：{e}")


WINDOW_TITLE = "EquipPro — 企業級設備更換紀錄與價位管理系統"


class Api:
    """Exposed to the page as window.pywebview.api — see js/storage.js."""

    def load_data(self):
        if not os.path.exists(DATA_PATH):
            return "{}"
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                return f.read()
        except OSError as e:
            print(f"[警告] 讀取資料檔失敗：{e}")
            return "{}"

    def save_data(self, data_json):
        # Write to a temp file then atomically replace the real one, so an
        # overlapping call (JS can fire several saves back-to-back) can never
        # leave the data file with interleaved, corrupted content — each
        # write either fully lands or doesn't touch the file at all.
        tmp_path = DATA_PATH + ".tmp"
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(data_json)
            os.replace(tmp_path, DATA_PATH)
            return True
        except OSError as e:
            print(f"[警告] 寫入資料檔失敗：{e}")
            return False


def main():
    _migrate_legacy_data()

    if not os.path.exists(INDEX_PATH):
        print(f"[錯誤] 找不到 index.html：{INDEX_PATH}")
        sys.exit(1)

    webview.create_window(
        title=WINDOW_TITLE,
        url=INDEX_PATH,
        width=1360,
        height=860,
        min_size=(960, 600),
        text_select=True,
        js_api=Api(),
        maximized=True,  # auto-fit the current screen on launch; user can still un-maximize
    )
    webview.start()


if __name__ == "__main__":
    main()

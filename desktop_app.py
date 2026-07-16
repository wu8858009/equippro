"""EquipPro desktop launcher.

Wraps the existing web app (index.html + css/js) in a native desktop
window using pywebview, so the same code that runs on GitHub Pages also
runs as a Windows desktop app. Unlike the browser version — where data
lives only inside the browser's hidden local storage — this launcher also
mirrors the app's data into a plain JSON file next to the .exe, so it's
visible, portable, and safe to back up. The desktop app and a browser tab
still don't share data with each other.

Setup (once):
    pip install pywebview

Run:
    python desktop_app.py
"""
import os
import sys
import webview

# When frozen by PyInstaller, bundled data files (index.html, css/, js/) are
# extracted to sys._MEIPASS at runtime instead of living next to this script.
RESOURCE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
INDEX_PATH = os.path.join(RESOURCE_DIR, "index.html")

# The data file, on the other hand, must live next to the actual .exe (not
# the temporary _MEIPASS extraction folder, which gets wiped between runs)
# so it persists across restarts and is easy for the user to find or back up.
if getattr(sys, "frozen", False):
    DATA_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    DATA_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(DATA_DIR, "equippro_data.json")

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
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(data_json)
            os.replace(tmp_path, DATA_PATH)
            return True
        except OSError as e:
            print(f"[警告] 寫入資料檔失敗：{e}")
            return False


def main():
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
    )
    webview.start()


if __name__ == "__main__":
    main()

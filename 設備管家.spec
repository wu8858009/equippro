# -*- mode: python ; coding: utf-8 -*-
# Build: python -m PyInstaller --noconfirm 設備管家.spec  ->  dist\設備管家.exe
datas = [('index.html', 'web'), ('manifest.webmanifest', 'web'), ('css', 'web/css'), ('js', 'web/js'), ('icons', 'web/icons')]

a = Analysis(['desktop_app.py'], pathex=[], binaries=[], datas=datas, hiddenimports=['pystray._win32', 'PIL.Image'], hookspath=[],
             runtime_hooks=[], excludes=['tkinter', 'unittest', 'pydoc', 'numpy', 'cryptography', 'PIL._avif', 'PIL.AvifImagePlugin', 'PIL.ImageQt', 'PIL.ImageTk', 'PIL._webp'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='設備管家', debug=False, strip=False, upx=False,
          runtime_tmpdir=None, console=False, icon='icon.ico')

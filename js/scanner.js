/* 設備管家 — QR code scanner (camera, or decode a photo).
   Uses the browser's BarcodeDetector when it can read QR codes (Android
   Chrome, desktop Chrome/Edge) and falls back to jsQR (loaded on demand),
   which also covers iPhone Safari. */
(function () {
  'use strict';
  const SG = window.SG;
  const { util: U, db: DB, ui: UI } = SG;
  const esc = U.esc;

  let jsqrLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrLoading) jsqrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/jsQR.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => { jsqrLoading = null; reject(new Error('無法載入掃描元件')); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }

  let detector = null;
  async function nativeDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ('BarcodeDetector' in window) {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      }
    } catch (e) { detector = false; }
    return detector;
  }

  // Decodes one frame/image source drawn into `canvas`. Returns text or null.
  async function decode(source, canvas, w, h, thorough) {
    const det = await nativeDetector();
    if (det) {
      try {
        const codes = await det.detect(source);
        if (codes && codes.length) return codes[0].rawValue;
        if (!thorough) return null;
      } catch (e) { /* fall through to jsQR */ }
    }
    const jsQR = await loadJsQR();
    const scale = Math.min(1, (thorough ? 1600 : 720) / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, canvas.width, canvas.height);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
    return r ? r.data : null;
  }

  // What to do with a scanned text: equipment labels open the quick page.
  function handle(text) {
    const t = String(text || '').trim();
    const m = /#\/(?:qr|eq)\/([A-Za-z0-9_-]+)/.exec(t);
    let eq = m ? DB.get('equipment', m[1]) : null;
    if (!eq) {
      const low = t.toLowerCase();
      eq = DB.all('equipment').find((e) => (e.code && e.code.toLowerCase() === low) || (e.serial && e.serial.toLowerCase() === low)) || null;
    }
    if (eq) {
      UI.toast('✅ ' + eq.name);
      UI.go('#/qr/' + eq.id);
      return;
    }
    if (m) {
      UI.toast('這張標籤的設備不在這台裝置上（可能已刪除，或還沒同步）', 'error');
      return;
    }
    const isUrl = /^https?:\/\//i.test(t);
    const box = UI.modal({
      title: '掃描結果',
      body: `<p class="small muted">這不是設備管家的標籤，內容是：</p><div class="scan-text">${esc(t)}</div>`,
      actions: [
        { label: '複製', onClick: async () => { try { await navigator.clipboard.writeText(t); UI.toast('已複製'); } catch (e) { UI.toast('無法複製', 'error'); } return false; } },
        { label: '用這段文字搜尋', onClick: () => UI.go('#/search/' + encodeURIComponent(t.slice(0, 60))) },
        ...(isUrl ? [{ label: '開啟連結', kind: 'primary', onClick: () => { window.open(t, '_blank', 'noopener'); } }] : [{ label: '關閉', kind: 'primary' }])
      ]
    });
    return box;
  }

  const Scanner = (SG.scanner = {
    handle,
    async fromFile(file) {
      if (!file) return null;
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error('無法讀取這張圖片'));
          i.src = url;
        });
        return await decode(img, document.createElement('canvas'), img.naturalWidth, img.naturalHeight, true);
      } finally { URL.revokeObjectURL(url); }
    },
    // Opens the scanner. onResult(text) defaults to `handle`.
    open(onResult = handle) {
      const canCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
      let stream = null, running = true, devices = [], devIndex = -1, torchOn = false, busy = false;
      const canvas = document.createElement('canvas');
      const m = UI.modal({
        title: '掃描 QR Code', wide: true,
        body: `<div class="scan-wrap">
            <video class="scan-video" playsinline muted autoplay></video>
            <div class="scan-frame"><i></i><i></i><i></i><i></i><b class="scan-line"></b></div>
            <div class="scan-msg">${canCamera ? '正在開啟相機…' : '這個瀏覽器無法使用相機，請用「從相片掃描」'}</div>
          </div>
          <p class="small muted center">把設備上的 QR 標籤對準框內，會自動辨識並打開該設備</p>
          <div class="btn-row scan-btns">
            <button class="btn" id="sc-photo">🖼️ 從相片掃描</button>
            <button class="btn" id="sc-switch" hidden>🔄 切換鏡頭</button>
            <button class="btn" id="sc-torch" hidden>🔦 手電筒</button>
          </div>`,
        actions: [{ label: '關閉' }],
        onClose: () => { running = false; stop(); }
      });
      m.el.classList.add('scan-modal');
      const video = UI.$('.scan-video', m.body);
      const msg = UI.$('.scan-msg', m.body);
      const say = (t) => { msg.textContent = t; msg.hidden = !t; };

      function stop() {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      const done = (text) => {
        running = false;
        if (navigator.vibrate) navigator.vibrate(80);
        m.close();
        setTimeout(() => onResult(text), 150);
      };

      async function start() {
        stop();
        if (!canCamera) { UI.$('.scan-frame', m.body).hidden = true; return; }
        try {
          const constraints = devIndex >= 0 && devices[devIndex]
            ? { video: { deviceId: { exact: devices[devIndex].deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
            : { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (!running) return stop();
          video.srcObject = stream;
          await video.play().catch(() => {});
          say('');
          try {
            devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
            UI.$('#sc-switch', m.body).hidden = devices.length < 2;
          } catch (e) { /* ignore */ }
          const track = stream.getVideoTracks()[0];
          const caps = track && track.getCapabilities ? track.getCapabilities() : {};
          UI.$('#sc-torch', m.body).hidden = !caps.torch;
          loop();
        } catch (e) {
          UI.$('.scan-frame', m.body).hidden = true;
          say(e && e.name === 'NotAllowedError' ? '沒有相機權限。請在瀏覽器設定中允許使用相機，或改用「從相片掃描」。'
            : e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') ? '找不到相機，請改用「從相片掃描」。'
              : '無法開啟相機：' + (e && e.message ? e.message : e));
        }
      }

      let last = 0;
      async function loop() {
        if (!running || !stream) return;
        const now = performance.now();
        if (!busy && now - last > 160 && video.readyState >= 2 && video.videoWidth) {
          busy = true; last = now;
          try {
            const text = await decode(video, canvas, video.videoWidth, video.videoHeight, false);
            if (text && running) return done(text);
          } catch (e) { /* keep trying */ }
          busy = false;
        }
        requestAnimationFrame(loop);
      }

      UI.$('#sc-photo', m.body).onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          say('辨識中…');
          try {
            const text = await Scanner.fromFile(f);
            if (text) return done(text);
            say('這張照片裡找不到 QR Code，請拍清楚一點再試');
          } catch (e) { say(e.message); }
        };
        inp.click();
      };
      UI.$('#sc-switch', m.body).onclick = () => { devIndex = (devIndex + 1) % devices.length; say('切換中…'); start(); };
      UI.$('#sc-torch', m.body).onclick = async () => {
        const track = stream && stream.getVideoTracks()[0];
        if (!track) return;
        torchOn = !torchOn;
        try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { UI.toast('這支手機不支援手電筒', 'error'); }
      };
      start();
      return m;
    }
  });
})();

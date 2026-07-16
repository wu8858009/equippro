/* EPM.photos — image compression, photo picker widget, lightbox viewer */
(function () {
  const MAX_PHOTOS = 5;
  const MAX_DIM = 1280;
  const QUALITY = 0.82;

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('不是圖片檔案'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width, height = img.height;
          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
            else { width = Math.round(width * MAX_DIM / height); height = MAX_DIM; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', QUALITY));
        };
        img.onerror = () => reject(new Error('圖片讀取失敗'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('檔案讀取失敗'));
      reader.readAsDataURL(file);
    });
  }

  function previewInNewTab(src) {
    const win = window.open('', '_blank');
    if (!win) return; // popup blocked — silently skip rather than error
    win.document.write(
      '<title>照片預覽</title><body style="margin:0;background:#111;display:flex;' +
      'align-items:center;justify-content:center;min-height:100vh;">' +
      '<img src="' + src + '" style="max-width:100%;max-height:100vh;" /></body>'
    );
  }

  // Mounts an editable photo-picker widget inside `root`. `photos` is the
  // live array backing the widget (mutated in place, so the caller can read
  // its current contents at submit time); `onChange` fires after every
  // add/remove.
  function mountPicker(root, photos, onChange) {
    function render() {
      root.innerHTML = `
        <div class="photo-grid">
          ${photos.map((src, i) => `
            <div class="photo-thumb" data-view="${i}">
              <img src="${src}" alt="照片 ${i + 1}" />
              <button type="button" class="photo-remove" data-remove="${i}" aria-label="移除照片">✕</button>
            </div>`).join('')}
          ${photos.length < MAX_PHOTOS ? `
            <label class="photo-add">
              <input type="file" accept="image/*" multiple hidden />
              <span>＋ 新增照片</span>
            </label>` : ''}
        </div>
        <div class="photo-hint">最多 ${MAX_PHOTOS} 張，會自動壓縮以節省儲存空間</div>`;

      root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // the remove button sits inside the thumb's own (lightbox-opening) click target
        photos.splice(Number(b.dataset.remove), 1);
        render();
        if (onChange) onChange(photos);
      }));
      // The picker lives inside a form that's already showing in the shared
      // modal — opening the lightbox there would overwrite modal-root and
      // destroy the in-progress form. Preview in a new tab instead.
      root.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => {
        previewInNewTab(photos[Number(el.dataset.view)]);
      }));
      const fileInput = root.querySelector('.photo-add input[type=file]');
      if (fileInput) {
        fileInput.addEventListener('change', async () => {
          const files = Array.from(fileInput.files || []).slice(0, MAX_PHOTOS - photos.length);
          for (const file of files) {
            try {
              const dataUrl = await compressImage(file);
              photos.push(dataUrl);
            } catch (e) {
              console.error('照片處理失敗', e);
            }
          }
          render();
          if (onChange) onChange(photos);
        });
      }
    }
    render();
  }

  // Read-only thumbnail row for tables (no add/remove). Tag it with the
  // owning record's id via data-open-photos; the caller wires a click
  // listener (see app.js) that looks the record back up and opens the
  // lightbox — keeps this module decoupled from any particular data list.
  function thumbRowHtml(photos, recordId) {
    if (!photos || !photos.length) return '<span class="muted">—</span>';
    return `<div class="photo-mini-row" data-open-photos="${recordId}">
      ${photos.slice(0, 3).map((src) => `<img class="photo-mini" src="${src}" alt="照片" />`).join('')}
      ${photos.length > 3 ? `<span class="photo-mini-more">+${photos.length - 3}</span>` : ''}
    </div>`;
  }

  function openLightbox(photos, startIndex) {
    if (!photos || !photos.length || !window.EPM.app) return;
    let idx = startIndex || 0;
    const html = `
      <div class="modal-header"><h3>照片（<span id="lightbox-pos">${idx + 1}</span>/${photos.length}）</h3><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="lightbox-body">
        ${photos.length > 1 ? '<button type="button" class="lightbox-nav lightbox-prev" id="lb-prev" aria-label="上一張">‹</button>' : ''}
        <img id="lightbox-img" src="${photos[idx]}" alt="照片" />
        ${photos.length > 1 ? '<button type="button" class="lightbox-nav lightbox-next" id="lb-next" aria-label="下一張">›</button>' : ''}
      </div>`;
    window.EPM.app.openModal(html, {
      onMount: (root) => {
        const img = root.querySelector('#lightbox-img');
        const pos = root.querySelector('#lightbox-pos');
        function show() { img.src = photos[idx]; if (pos) pos.textContent = String(idx + 1); }
        const prev = root.querySelector('#lb-prev');
        const next = root.querySelector('#lb-next');
        if (prev) prev.addEventListener('click', () => { idx = (idx - 1 + photos.length) % photos.length; show(); });
        if (next) next.addEventListener('click', () => { idx = (idx + 1) % photos.length; show(); });
      }
    });
  }

  window.EPM.photos = { compressImage, mountPicker, thumbRowHtml, openLightbox, MAX_PHOTOS };
})();

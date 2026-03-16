// ============================================================
// ARMORY — Frontend JS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // ── Photo drop zone ────────────────────────────────────────
  const zone    = document.getElementById('photoDropZone');
  const input   = document.getElementById('photoInput');
  const listEl  = document.getElementById('fileList');

  if (zone && input && listEl) {
    // Click zone → open file picker
    zone.addEventListener('click', () => input.click());

    // Drag-over visual
    zone.addEventListener('dragenter', e => { e.preventDefault(); zone.classList.add('file-drop-zone--active'); });
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('file-drop-zone--active'); });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('file-drop-zone--active');
    });

    // Drop: merge dropped files into the hidden input
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('file-drop-zone--active');
      const dt = new DataTransfer();
      // Keep any previously selected files
      Array.from(input.files).forEach(f => dt.items.add(f));
      Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
      input.files = dt.files;
      renderFileList();
    });

    // Normal file-picker change
    input.addEventListener('change', renderFileList);

    function fmtSize(bytes) {
      return bytes < 1024 * 1024
        ? Math.round(bytes / 1024) + ' KB'
        : (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function escHtml(str) {
      return str.replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      );
    }

    function renderFileList() {
      listEl.innerHTML = '';
      const files = Array.from(input.files);
      if (!files.length) return;

      files.forEach((file, i) => {
        const row = document.createElement('div');
        row.className = 'file-list-item';
        row.innerHTML =
          '<span class="file-list-item__primary">' + (i === 0 ? '★' : '') + '</span>' +
          '<span class="file-list-item__name">' + escHtml(file.name) + '</span>' +
          '<span class="file-list-item__size">' + fmtSize(file.size) + '</span>' +
          '<button type="button" class="file-list-item__remove" title="Remove">✕</button>';
        row.querySelector('.file-list-item__remove').addEventListener('click', () => {
          const dt = new DataTransfer();
          Array.from(input.files).filter((_, j) => j !== i).forEach(f => dt.items.add(f));
          input.files = dt.files;
          renderFileList();
        });
        listEl.appendChild(row);
      });
    }
  }

  // ── Auto-dismiss success alerts after 5s ───────────────────
  document.querySelectorAll('.alert--success').forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, 5000);
  });

  // ── Confirm dangerous actions ──────────────────────────────
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', e => {
      if (!confirm(el.dataset.confirm)) e.preventDefault();
    });
  });

  // ── Active nav link highlight ──────────────────────────────
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.style.color = 'var(--text)';
    }
  });

  // ── NFA checkbox toggle ────────────────────────────────────
  const nfaCheckbox = document.getElementById('isNfa');
  const nfaFields   = document.getElementById('nfaFields');
  if (nfaCheckbox && nfaFields) {
    nfaCheckbox.addEventListener('change', function () {
      nfaFields.style.display = this.checked ? 'block' : 'none';
    });
  }

  // ── Main photo viewer thumb clicks ─────────────────────────
  document.querySelectorAll('.photo-thumb').forEach(thumb => {
    thumb.addEventListener('click', function () {
      const mainImg = document.getElementById('photoMainImg');
      if (mainImg) mainImg.src = this.src;
      document.querySelectorAll('.photo-thumb-wrap').forEach(w => w.classList.remove('photo-thumb-wrap--active'));
      this.closest('.photo-thumb-wrap').classList.add('photo-thumb-wrap--active');
    });
  });

  // ── Keyboard shortcuts ─────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' || e.key === 'N') window.location.href = '/inventory/new';
    if (e.key === '/') {
      e.preventDefault();
      const searchInput = document.querySelector('.search-input');
      if (searchInput) searchInput.focus();
    }
  });

});

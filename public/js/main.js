// ============================================================
// ARMORY — Frontend JS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // File drop zone highlight
  document.querySelectorAll('.file-drop-zone').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.style.borderColor = '#c8963c';
      zone.style.background = 'rgba(200,150,60,0.05)';
    });
    zone.addEventListener('dragleave', () => {
      zone.style.borderColor = '';
      zone.style.background = '';
    });
    zone.addEventListener('drop', () => {
      zone.style.borderColor = '';
      zone.style.background = '';
    });
  });

  // Auto-dismiss alerts after 5s
  document.querySelectorAll('.alert--success').forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    }, 5000);
  });

  // Confirm dangerous actions
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', e => {
      if (!confirm(el.dataset.confirm)) e.preventDefault();
    });
  });

  // Highlight active nav link
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('href') === currentPath) {
      link.style.color = 'var(--text)';
    }
  });

  // NFA checkbox toggle (inline backup if EJS inline script not present)
  const nfaCheckbox = document.getElementById('isNfa');
  const nfaFields = document.getElementById('nfaFields');
  if (nfaCheckbox && nfaFields) {
    nfaCheckbox.addEventListener('change', function () {
      nfaFields.style.display = this.checked ? 'block' : 'none';
    });
  }

  // Photo input preview
  const photoInput = document.getElementById('photoInput');
  const filePreview = document.getElementById('filePreview');
  if (photoInput && filePreview) {
    photoInput.addEventListener('change', function () {
      filePreview.innerHTML = '';
      Array.from(this.files).forEach((file, i) => {
        const reader = new FileReader();
        reader.onload = e => {
          const div = document.createElement('div');
          div.className = 'file-preview-item';
          div.innerHTML = `
            <img src="${e.target.result}" alt="${file.name}">
            <span class="preview-label">${i === 0 ? '★ PRIMARY' : ''}</span>
          `;
          filePreview.appendChild(div);
        };
        reader.readAsDataURL(file);
      });
    });
  }

  // Main photo viewer click on thumbs
  document.querySelectorAll('.photo-thumb').forEach(thumb => {
    thumb.addEventListener('click', function () {
      const mainImg = document.getElementById('photoMainImg');
      if (mainImg) mainImg.src = this.src;
      document.querySelectorAll('.photo-thumb-wrap').forEach(w => w.classList.remove('photo-thumb-wrap--active'));
      this.closest('.photo-thumb-wrap').classList.add('photo-thumb-wrap--active');
    });
  });

  // Keyboard shortcut: N = new firearm (when not in input)
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'n' || e.key === 'N') {
      window.location.href = '/inventory/new';
    }
    if (e.key === '/' ) {
      e.preventDefault();
      const searchInput = document.querySelector('.search-input');
      if (searchInput) searchInput.focus();
    }
  });

});

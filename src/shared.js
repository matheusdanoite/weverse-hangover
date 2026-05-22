// ═══════════════════════════════════════════
// WEVERSE HANGOVER — shared utilities
// ═══════════════════════════════════════════

// ── Lightbox singleton ──
let _lightbox = null;
let _lightboxOnClose = null;

const _SEND_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

function getLightbox() {
  if (_lightbox) return _lightbox;
  const ov = document.createElement('div');
  ov.className = 'lightbox-overlay';
  ov.innerHTML = `
    <div class="lightbox-panel">
      <button class="lightbox-close" type="button" aria-label="Fechar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="lightbox-img-wrap">
        <img class="lightbox-img" src="" alt="desenho" />
      </div>
      <div class="lightbox-replies-area"></div>
    </div>
  `;
  const closeLb = () => {
    ov.classList.remove('open');
    if (_lightboxOnClose) { _lightboxOnClose(); _lightboxOnClose = null; }
  };
  ov.querySelector('.lightbox-close').addEventListener('click', closeLb);
  ov.addEventListener('click', e => { if (e.target === ov) closeLb(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) closeLb(); });
  document.body.appendChild(ov);
  _lightbox = ov;
  return ov;
}

export function openLightbox(src, { onOpen, onClose } = {}) {
  const lb = getLightbox();
  lb.querySelector('.lightbox-img').src = src;
  const repliesArea = lb.querySelector('.lightbox-replies-area');
  repliesArea.innerHTML = `
    <div class="lightbox-thread"></div>
    <div class="lightbox-composer hidden">
      <input class="lightbox-reply-input" type="text" placeholder="responder..." maxlength="200" autocomplete="off" />
      <button class="lightbox-reply-send reply-send" type="button" disabled>${_SEND_SVG}</button>
    </div>
  `;
  _lightboxOnClose = onClose || null;
  lb.classList.add('open');
  if (onOpen) onOpen(repliesArea.querySelector('.lightbox-thread'), repliesArea.querySelector('.lightbox-composer'));
}

// Global delegated listeners
document.addEventListener('click', e => {
  // Close any open post menu
  document.querySelectorAll('.post-menu.open').forEach(m => m.classList.remove('open'));
});

export function gradientCSS(g) {
  if (!g || g.length !== 2) return 'linear-gradient(to bottom right, #ff2d78 0%, #9b59ff 100%)';
  return `linear-gradient(to bottom right, ${g[0]} 0%, ${g[1]} 100%)`;
}

export function setGradientBg(el, colors) {
  el.style.backgroundImage = gradientCSS(colors);
  el.style.backgroundSize = '130% 130%';
  el.style.backgroundPosition = 'center center';
}

export function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Relative time (e.g. "3m", "2h") — used by main feed */
export function formatTime(ts) {
  if (!ts) return 'agora';
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 30) return 'agora';
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Absolute timestamp (dd/mm/yy HH:MM) — used by admin panel */
export function formatTimeAbs(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Builds a post card <article> element using the shared visual structure.
 *
 * @param {string} id         Firestore document ID
 * @param {object} data       Post data from Firestore
 * @param {object} opts
 *   me            {object|null}  Current user profile ({ id, name, gradient })
 *   modNames      {Set}          Set of moderator display names (for ★ badge)
 *   onLike        {function}     Called with (id, data) — omit for read-only
 *   onReplyClick  {function}     Called with (articleEl) when reply btn clicked
 *                                and no .reply-input exists in the card yet
 *   onDelete      {function}     Called with (id, articleEl) — renders delete btn
 *   formatTimeFn  {function}     Custom time formatter; defaults to formatTime
 */
export function buildPostCard(id, data, opts = {}) {
  const {
    me = null,
    modNames = new Set(),
    onLike = null,
    onReplyClick = null,
    onDelete = null,
    onSelfDelete = null,
    onReport = null,
    formatTimeFn = formatTime,
  } = opts;

  const isDrawing = data.type === 'drawing';
  const liked     = (data.likedBy || []).includes(me?.id);
  const likeCount = (data.likedBy || []).length;
  const replyCount = data.replyCount || 0;
  const isMod  = modNames.has(data.author);
  const isMine = data.authorId === me?.id;
  const reported = (data.reportedBy || []).includes(me?.id);
  const grad   = gradientCSS(data.gradient?.length === 2 ? data.gradient : null);

  const drawingSrc = isDrawing && typeof data.message === 'string' &&
    /^data:image\/(png|jpeg|gif|webp);base64,/.test(data.message)
    ? data.message
    : '';
  const contentHTML = isDrawing
    ? (drawingSrc ? `<img class="post-drawing" src="${drawingSrc}" alt="desenho" loading="lazy" />` : '')
    : `<div class="post-content">${escapeHTML(data.message || '')}</div>`;

  const el = document.createElement('article');
  el.className = 'post';
  if (isMine) el.classList.add('is-mine');
  el.dataset.id = id;

  el.innerHTML = `
    <div class="avatar avatar-md" style="background-image:${grad};background-size:130% 130%;background-position:center center"></div>
    <div class="post-body">
      <div class="post-header">
        <span class="post-author">${escapeHTML(data.author || 'anônimo')}</span>
        ${isMod  ? '<span class="mod-star">★</span>' : ''}
        <span class="post-time">${formatTimeFn(data.createdAt)}</span>
        <span class="post-doc-id">${id}</span>
      </div>
      ${contentHTML}
      ${data.maintainNote ? `
      <div class="maintain-note">
        <div class="maintain-sep"></div>
        <div class="maintain-note-text"><span class="maintain-note-label">nota do moderador</span>${escapeHTML(data.maintainNote)}</div>
      </div>` : ''}
      <div class="post-actions">
        <button class="action-btn like-btn ${liked ? 'liked' : ''}" type="button">
          <svg width="17" height="17" viewBox="0 0 24 24"
            fill="${liked ? 'currentColor' : 'none'}"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span class="count">${likeCount}</span>
        </button>
        <button class="action-btn reply-btn" type="button">
          <svg width="17" height="17" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          <span class="count">${replyCount}</span>
        </button>
        ${onDelete ? `
        <button class="action-btn delete-btn" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          deletar
        </button>` : ''}
      </div>
      <div class="replies-section"></div>
    </div>
    ${(isMine && onSelfDelete) || (!isMine && onReport) ? `
    <div class="post-menu">
      <button class="post-menu-btn" type="button" aria-label="mais opções">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8"/>
          <circle cx="12" cy="12" r="1.8"/>
          <circle cx="12" cy="19" r="1.8"/>
        </svg>
      </button>
      <div class="post-menu-dropdown">
        ${isMine && onSelfDelete ? `<button class="menu-item menu-danger post-selfdelete-btn" type="button">Apagar meu post</button>` : ''}
        ${!isMine && onReport ? `<button class="menu-item post-report-btn${reported ? ' reported' : ''}" type="button" ${reported ? 'disabled' : ''}>${reported ? 'Reportado' : 'Reportar post'}</button>` : ''}
      </div>
    </div>` : ''}
  `;

  if (onLike) {
    el.querySelector('.like-btn').addEventListener('click', () => onLike(id, data));
  }

  el.querySelector('.reply-btn').addEventListener('click', () => {
    const section = el.querySelector('.replies-section');
    const composer = section?.querySelector('.reply-composer');
    if (composer) {
      composer.classList.toggle('open');
      if (composer.classList.contains('open')) {
        composer.querySelector('.reply-input')?.focus();
        composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else if (onReplyClick) {
      onReplyClick(el);
      requestAnimationFrame(() => {
        const newComposer = section?.querySelector('.reply-composer');
        if (newComposer) {
          newComposer.classList.add('open');
          newComposer.querySelector('.reply-input')?.focus();
        }
      });
    }
  });

  if (onDelete) {
    el.querySelector('.delete-btn').addEventListener('click', () => onDelete(id, el));
  }

  const menuBtn = el.querySelector('.post-menu-btn');
  const menuEl  = el.querySelector('.post-menu');
  if (menuBtn && menuEl) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menuEl.classList.contains('open');
      document.querySelectorAll('.post-menu.open').forEach(m => m.classList.remove('open'));
      if (!isOpen) menuEl.classList.add('open');
    });

    if (onSelfDelete) {
      const btn = el.querySelector('.post-selfdelete-btn');
      if (btn) btn.addEventListener('click', () => {
        menuEl.classList.remove('open');
        onSelfDelete(id, el);
      });
    }

    if (onReport) {
      const btn = el.querySelector('.post-report-btn');
      if (btn) btn.addEventListener('click', () => {
        menuEl.classList.remove('open');
        onReport(id, data);
      });
    }
  }

  return el;
}

/**
 * Updates the interactive parts of an existing post card in-place
 * (like count, reply count, timestamp) without rebuilding the element.
 */
export function updatePostCard(el, data, me, formatTimeFn = formatTime) {
  const liked     = (data.likedBy || []).includes(me?.id);
  const likeCount = (data.likedBy || []).length;
  const replyCount = data.replyCount || 0;
  const reported  = (data.reportedBy || []).includes(me?.id);

  const likeBtn = el.querySelector('.like-btn');
  if (likeBtn) {
    likeBtn.classList.toggle('liked', liked);
    likeBtn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
    likeBtn.querySelector('.count').textContent = likeCount;
  }

  const replyCnt = el.querySelector('.reply-btn .count');
  if (replyCnt) replyCnt.textContent = replyCount;

  const timeEl = el.querySelector('.post-time');
  if (timeEl) timeEl.textContent = formatTimeFn(data.createdAt);

  const reportBtn = el.querySelector('.post-report-btn');
  if (reportBtn) {
    if (reported) {
      reportBtn.classList.add('reported');
      reportBtn.disabled = true;
      reportBtn.textContent = 'Reportado';
    } else {
      reportBtn.classList.remove('reported');
      reportBtn.disabled = false;
      reportBtn.textContent = 'Reportar post';
    }
  }
}

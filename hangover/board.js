// ═══════════════════════════════════════════
// HANGUL HANGOVER — Mural ao vivo
// Rotação: curtidos → recentes → comentados
// ═══════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import {
  getFirestore, collection, query, orderBy, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

const firebaseConfig = await fetch('/api/config').then(r => r.json());
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const MOD_NAMES = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.name));
const POSTS = 'hangul_messages';

// ── DOM ──
const boardScene     = document.getElementById('boardGrid');
const emptyState     = document.getElementById('emptyState');
const viewBadge      = document.getElementById('viewBadge');
const viewBadgeIcon  = document.getElementById('viewBadgeIcon');
const viewBadgeLabel = document.getElementById('viewBadgeLabel');

// ── Data store ──
const allPosts    = new Map(); // id → { id, data, replies[] }
const replyUnsubs = new Map(); // id → unsubFn

// ── View rotation state ──
const VIEWS     = ['curtidos', 'recentes', 'comentados', 'olho', 'nudge'];
const DURATIONS = { curtidos: 14000, recentes: 16000, comentados: 18000, olho: 16000, nudge: 15000 };
const BADGE     = {
  curtidos:   { icon: '♥',  label: 'mais curtidos'        },
  recentes:   { icon: '✦',  label: 'mais recentes'        },
  comentados: { icon: '💬', label: 'mais comentados'      },
  olho:       { icon: '◉',  label: 'estamos de olho em…'  },
  nudge:      { icon: '✧',  label: 'participe!'           },
  breaking:   { icon: '⚡', label: 'breaking news'        },
};

let viewIndex         = 0;
let viewTimer         = null;
let curtidosOffset    = 0;   // 0 = top 1–3 | 3 = top 4–6 | 6 = top 7–9
let curtidosLastIds   = '';
let curtidosSameCount = 0;
let comentadosIndex   = 0;
const olhoShown       = new Set(); // IDs já exibidos na view "olho"
let isBreaking        = false;
let breakingTimer     = null;
let isReady           = false;

// ── Helpers ──
function formatTime(ts) {
  if (!ts) return 'agora';
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 30)    return 'agora';
  if (diff < 60)    return `${Math.floor(diff)}s atrás`;
  if (diff < 3600)  return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function gradientCSS(g) {
  if (!g || g.length !== 2) return 'linear-gradient(135deg, #ff2d78, #9b59ff)';
  return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
}

function likesOf(data)  { return (data.likedBy || []).length; }
function repliesOf(data){ return data.replyCount || 0; }

function textFS(len, featured) {
  if (featured) {
    if (len <= 20)  return 'clamp(1.6rem, 3.5cqi, 5.5rem)';
    if (len <= 50)  return 'clamp(1.3rem, 2.8cqi, 4.5rem)';
    if (len <= 100) return 'clamp(1.1rem, 2.3cqi, 3.5rem)';
    if (len <= 180) return 'clamp(0.95rem, 1.9cqi, 2.8rem)';
    return                 'clamp(0.85rem, 1.6cqi, 2.2rem)';
  }
  if (len <= 18)  return 'clamp(1.4rem, 5cqi,   7rem)';
  if (len <= 40)  return 'clamp(1.2rem, 4cqi,   5.5rem)';
  if (len <= 80)  return 'clamp(1rem,   3.2cqi, 4.5rem)';
  if (len <= 140) return 'clamp(0.9rem, 2.6cqi, 3.5rem)';
  if (len <= 220) return 'clamp(0.82rem,2.1cqi, 2.8rem)';
  return                 'clamp(0.75rem,1.8cqi, 2.3rem)';
}

// ── Reply subscriptions ──
function ensureReplies(id) {
  if (replyUnsubs.has(id)) return;
  const q = query(
    collection(db, POSTS, id, 'replies'),
    orderBy('createdAt', 'desc'),
    limit(3)
  );
  const unsub = onSnapshot(q, snap => {
    const e = allPosts.get(id);
    if (e) e.replies = snap.docs.map(d => d.data());
  });
  replyUnsubs.set(id, unsub);
}

function pruneReplies(keepIds) {
  replyUnsubs.forEach((unsub, id) => {
    if (!keepIds.has(id)) { unsub(); replyUnsubs.delete(id); }
  });
}

// ── Firestore listener ──
const postsQ = query(collection(db, POSTS), orderBy('createdAt', 'desc'), limit(80));

onSnapshot(postsQ, snap => {
  if (snap.empty) {
    allPosts.clear();
    emptyState.classList.remove('hidden');
    boardScene.innerHTML = '';
    clearTimeout(viewTimer);
    clearTimeout(breakingTimer);
    isReady = false;
    isBreaking = false;
    return;
  }
  emptyState.classList.add('hidden');

  // Captura docs genuinamente novos antes de atualizar o mapa
  const newlyAdded = [];
  if (isReady && !isBreaking) {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') newlyAdded.push(change.doc);
    });
  }

  const incoming = new Set();
  snap.docs.forEach(d => {
    incoming.add(d.id);
    const e = allPosts.get(d.id);
    if (e) e.data = d.data();
    else   allPosts.set(d.id, { id: d.id, data: d.data(), replies: [] });
  });
  allPosts.forEach((_, id) => { if (!incoming.has(id)) allPosts.delete(id); });

  // Keep replies subscribed for top 5 most commented
  const topCommented = [...allPosts.values()]
    .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
    .slice(0, 5);
  const keepIds = new Set(topCommented.map(p => p.id));
  topCommented.forEach(p => ensureReplies(p.id));
  pruneReplies(keepIds);

  if (!isReady) {
    isReady = true;
    startViews();
  } else if (newlyAdded.length) {
    // Exibe o post mais recente entre os que chegaram agora
    const newest = newlyAdded.sort(
      (a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0)
    )[0];
    showBreakingNews(allPosts.get(newest.id));
  }
});

// ── Breaking News ──
function showBreakingNews(post) {
  if (!post) return;
  isBreaking = true;
  clearTimeout(viewTimer);
  clearTimeout(breakingTimer);

  updateBadge('breaking');
  boardScene.classList.add('scene-exit');

  setTimeout(() => {
    boardScene.innerHTML = '';
    boardScene.className = 'board-scene view-breaking scene-enter';
    renderBreaking(post);
  }, 440);

  // Retoma o ciclo após 10s (+ margem da transição de entrada)
  breakingTimer = setTimeout(() => {
    isBreaking = false;
    renderCurrentView();
    scheduleNext();
  }, 10940);
}

function renderBreaking(post) {
  const label = document.createElement('div');
  label.className = 'breaking-label';
  label.innerHTML = '<span class="breaking-dot"></span>BREAKING NEWS';
  boardScene.appendChild(label);

  const wrap = document.createElement('div');
  wrap.className = 'breaking-card-wrap';
  wrap.appendChild(buildPostCard(post, { featured: true, delay: 0.15 }));
  boardScene.appendChild(wrap);
}

// ── View: Nudge / Participe ──
function renderNudge() {
  boardScene.className = 'board-scene view-nudge scene-enter';

  const cta = document.createElement('div');
  cta.className = 'nudge-cta';
  cta.textContent = 'faça parte da conversa';
  boardScene.appendChild(cta);

  const qr = document.createElement('img');
  qr.className = 'nudge-qr';
  qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=10&data=${encodeURIComponent('https://weverse-hangover.pages.dev')}`;
  qr.alt = 'QR Code — weverse-hangover.pages.dev';
  boardScene.appendChild(qr);

  const url = document.createElement('div');
  url.className = 'nudge-url';
  url.textContent = 'weverse-hangover.pages.dev';
  boardScene.appendChild(url);
}

// ── View controller ──
function startViews() {
  renderCurrentView();
  scheduleNext();
}

function scheduleNext() {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    viewIndex = (viewIndex + 1) % VIEWS.length;
    renderCurrentView();
    scheduleNext();
  }, DURATIONS[VIEWS[viewIndex]]);
}

function renderCurrentView() {
  const view = VIEWS[viewIndex];
  updateBadge(view);
  transitionTo(() => {
    if      (view === 'curtidos')   renderCurtidos();
    else if (view === 'recentes')   renderRecentes();
    else if (view === 'comentados') renderComentados();
    else if (view === 'olho')       renderOlho();
    else                            renderNudge();
  });
}

function updateBadge(view) {
  const { icon, label } = BADGE[view];
  viewBadgeIcon.textContent  = icon;
  viewBadgeLabel.textContent = label;
  viewBadge.classList.remove('badge-pop');
  void viewBadge.offsetWidth;
  viewBadge.classList.add('badge-pop');
}

function transitionTo(fn) {
  boardScene.classList.add('scene-exit');
  setTimeout(() => {
    boardScene.innerHTML = '';
    fn();
  }, 440);
}

// ── View: Mais Recentes ──
function renderRecentes() {
  const posts = [...allPosts.values()]
    .sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0))
    .slice(0, 4);

  if (!posts.length) return;
  boardScene.className = 'board-scene view-recentes scene-enter';
  posts.forEach((p, i) => boardScene.appendChild(buildPostCard(p, { delay: i * 0.09 })));
}

// ── View: Mais Curtidos ──
function renderCurtidos() {
  const sorted = [...allPosts.values()]
    .filter(p => likesOf(p.data) > 1)
    .sort((a, b) => likesOf(b.data) - likesOf(a.data));

  if (!sorted.length) { renderRecentes(); return; }

  // Rotation logic: shift to next band if same posts repeat twice
  const slice = sorted.slice(curtidosOffset, curtidosOffset + 3);
  const ids   = slice.map(p => p.id).join(',');

  if (ids === curtidosLastIds) {
    curtidosSameCount++;
    if (curtidosSameCount >= 2) {
      const next = curtidosOffset + 3;
      curtidosOffset    = (next < 9 && sorted.length > next) ? next : 0;
      curtidosSameCount = 0;
    }
  } else {
    curtidosLastIds   = ids;
    curtidosSameCount = 1;
  }

  const posts    = sorted.slice(curtidosOffset, curtidosOffset + 3);
  const rankBase = curtidosOffset + 1;
  if (!posts.length) return;

  boardScene.className = 'board-scene view-curtidos scene-enter';

  boardScene.appendChild(buildPostCard(posts[0], { rank: rankBase, featured: true, delay: 0 }));

  const right = document.createElement('div');
  right.className = 'curtidos-right';
  if (posts[1]) right.appendChild(buildPostCard(posts[1], { rank: rankBase + 1, delay: 0.12 }));
  if (posts[2]) right.appendChild(buildPostCard(posts[2], { rank: rankBase + 2, delay: 0.22 }));
  boardScene.appendChild(right);
}

// ── View: Mais Comentados ──
function renderComentados() {
  const sorted = [...allPosts.values()]
    .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
    .slice(0, 5)
    .filter(p => repliesOf(p.data) > 0);

  if (!sorted.length) { renderRecentes(); return; }

  const idx  = comentadosIndex % sorted.length;
  const post = sorted[idx];
  const rank = idx + 1;
  comentadosIndex = (comentadosIndex + 1) % sorted.length;

  boardScene.className = 'board-scene view-comentados scene-enter';

  boardScene.appendChild(buildPostCard(post, { rank, featured: true, delay: 0 }));

  const right = document.createElement('div');
  right.className = 'comentados-right';

  const header = document.createElement('div');
  header.className = 'comentados-header';
  header.textContent = 'últimos comentários';
  right.appendChild(header);

  const replies = post.replies || [];
  if (!replies.length) {
    const empty = document.createElement('div');
    empty.className = 'comentados-empty';
    empty.textContent = 'carregando comentários...';
    right.appendChild(empty);
  } else {
    replies.slice(0, 3).forEach((r, i) => right.appendChild(buildReplyCard(r, i * 0.12)));
  }

  boardScene.appendChild(right);
}

// ── View: Estamos de olho em… ──
function getOlhoPosts() {
  const curtidosIds = new Set(
    [...allPosts.values()]
      .filter(p => likesOf(p.data) > 1)
      .sort((a, b) => likesOf(b.data) - likesOf(a.data))
      .slice(0, 9).map(p => p.id)
  );
  const recentesIds = new Set(
    [...allPosts.values()]
      .sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0))
      .slice(0, 4).map(p => p.id)
  );
  const comentadosIds = new Set(
    [...allPosts.values()]
      .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
      .slice(0, 5)
      .filter(p => repliesOf(p.data) > 0)
      .map(p => p.id)
  );
  return [...allPosts.values()].filter(p =>
    !curtidosIds.has(p.id) && !recentesIds.has(p.id) && !comentadosIds.has(p.id)
  );
}

function renderOlho() {
  const eligible = getOlhoPosts();
  if (!eligible.length) { renderRecentes(); return; }

  let unseen = eligible.filter(p => !olhoShown.has(p.id));
  if (!unseen.length) {
    olhoShown.clear();
    unseen = eligible;
  }

  // Mais recentes primeiro entre os não exibidos
  unseen.sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0));
  const toShow = unseen.slice(0, 4);
  toShow.forEach(p => olhoShown.add(p.id));

  boardScene.className = 'board-scene view-olho scene-enter';
  toShow.forEach((p, i) => boardScene.appendChild(buildPostCard(p, { delay: i * 0.09 })));
}

// ── Card builders ──
function buildPostCard(post, { rank, featured = false, delay = 0 } = {}) {
  const { id, data } = post;
  const isDrawing    = data.type === 'drawing';
  const grad         = gradientCSS(data.gradient);
  const lk           = likesOf(data);
  const rc           = repliesOf(data);

  const card = document.createElement('article');
  card.className = 'post-card' + (featured ? ' card-featured' : '');
  card.style.animationDelay = `${delay}s`;
  card.dataset.postId = id;

  let body;
  if (isDrawing) {
    const drawingSrc = typeof data.message === 'string' && data.message.startsWith('data:image/') ? data.message : '';
    body = drawingSrc ? `<div class="drawing-wrap"><img class="card-drawing" src="${drawingSrc}" alt="desenho" loading="lazy"/></div>` : '';
  } else {
    const msg = data.message || '';
    const fs  = textFS(msg.length, featured);
    body = `<div class="card-body"><p class="card-text" style="font-size:${fs}">${escapeHTML(msg)}</p></div>`;
  }

  const rankEl = rank
    ? `<div class="rank-badge${featured ? ' rank-featured' : ''}">#${rank}</div>`
    : '';

  card.innerHTML = `
    ${rankEl}
    <div class="card-author-row">
      <div class="card-avatar" style="background:${grad}"></div>
      <div class="card-author">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <span class="card-author-name">${escapeHTML(data.author || 'anônimo')}</span>
          ${MOD_NAMES.has(data.author) ? '<span class="card-mod-star">★</span>' : ''}
        </div>
        <span class="card-time">${formatTime(data.createdAt)}</span>
      </div>
    </div>
    ${body}
    <div class="card-footer">
      <div class="card-counts">
        <span class="card-count like-count ${lk > 0 ? 'has-value' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${lk > 0 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span>${lk}</span>
        </span>
        <span class="card-count reply-count ${rc > 0 ? 'has-value' : ''}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          <span>${rc}</span>
        </span>
      </div>
    </div>
  `;
  return card;
}

function buildReplyCard(reply, delay = 0) {
  const card = document.createElement('div');
  card.className = 'reply-card';
  card.style.animationDelay = `${delay}s`;

  const isDrawing = reply.type === 'drawing';
  const msg       = reply.message || '';

  const drawingSrc = isDrawing && msg.startsWith('data:image/') ? msg : '';
  const body = isDrawing
    ? (drawingSrc ? `<div class="reply-drawing-wrap"><img src="${drawingSrc}" alt="desenho" loading="lazy"/></div>` : '')
    : `<p class="reply-card-text">${escapeHTML(msg)}</p>`;

  card.innerHTML = `
    <div class="reply-card-header">
      <span class="reply-card-author">${escapeHTML(reply.author || 'anônimo')}</span>
      <span class="reply-card-time">${formatTime(reply.createdAt)}</span>
    </div>
    ${body}
  `;
  return card;
}

// ── Refresh timestamps every 30s ──
setInterval(() => {
  document.querySelectorAll('[data-post-id] .card-time').forEach(el => {
    const card = el.closest('[data-post-id]');
    const post = allPosts.get(card?.dataset.postId);
    if (post) el.textContent = formatTime(post.data.createdAt);
  });
}, 30000);

// ── Background particles ──
(function particles() {
  const container = document.getElementById('bgParticles');
  const colors = ['#ff2d78', '#9b59ff', '#00d4ff', '#ff6ba6', '#d926a9'];
  for (let i = 0; i < 50; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    const size  = Math.random() * 5 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `
      width:${size}px;height:${size}px;background:${color};
      left:${Math.random() * 100}%;
      animation-duration:${Math.random() * 20 + 14}s;
      animation-delay:${Math.random() * 20}s;
      box-shadow:0 0 ${size * 4}px ${color}55;
    `;
    container.appendChild(p);
  }
})();

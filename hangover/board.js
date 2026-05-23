// ═══════════════════════════════════════════
// WEVERSE HANGOVER — Kinetic VJ Board
// Rotação: curtidos → recentes → comentados → bombando → nudge
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
const kineticBg      = document.getElementById('kineticBg');
const boardScene     = document.getElementById('boardGrid');
const emptyState     = document.getElementById('emptyState');
const viewLabelWrap  = document.getElementById('viewLabelWrap');
const viewLabelText  = document.getElementById('viewLabelText');
const viewLabelSub   = document.getElementById('viewLabelSub');
const postCountVal   = document.getElementById('postCountVal');
const tickerTrack    = document.getElementById('tickerTrack');
const liveClock      = document.getElementById('liveClock');

// ── Data store ──
const allPosts    = new Map();
const replyUnsubs = new Map();

// ── View rotation ──
const VIEWS     = ['curtidos', 'recentes', 'comentados', 'bombando', 'nudge'];
const DURATIONS = { curtidos: 14000, recentes: 14000, comentados: 18000, bombando: 16000, nudge: 15000 };

const VIEW_CFG = {
  curtidos:  { label: 'MAIS CURTIDOS',    sub: 'TOP DA NOITE',              tint: 'default' },
  recentes:  { label: 'AGORA',            sub: 'ACABOU DE CHEGAR',          tint: 'hot'     },
  comentados:{ label: 'DISCUTINDO AGORA', sub: 'MAIS RESPOSTAS DA NOITE',   tint: 'cool'    },
  bombando:  { label: 'E TEM MAIS…',      sub: 'POSTS QUE MERECEM ATENÇÃO', tint: 'default' },
  nudge:     { label: '',                 sub: '',                           tint: 'hot'     },
  breaking:  { label: '',                 sub: '',                           tint: 'hot'     },
};

let viewIndex         = 0;
let viewTimer         = null;
let curtidosOffset    = 0;
let curtidosLastIds   = '';
let curtidosSameCount = 0;
let comentadosIndex   = 0;
const olhoShown       = new Set();
let isBreaking        = false;
let breakingTimer     = null;
let isReady           = false;
let isPaused          = false;

const BOMBANDO_BADGES = ['AINDA SEM SER VISTO', 'SÓ UM CURTIDO', 'MERECE MAIS', 'PASSOU BATIDO'];

const DRAWING_RE = /^data:image\/(png|jpeg|gif|webp);base64,/;
function isDrawing(d) { return d.type === 'drawing' && typeof d.message === 'string' && DRAWING_RE.test(d.message); }

// ── Helpers ──
function gradientCSS(g) {
  if (!g || g.length < 2) return 'linear-gradient(135deg,#ff2d78,#9b59ff)';
  return `linear-gradient(135deg,${g[0]},${g[1]})`;
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatTime(ts) {
  if (!ts) return 'agora';
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const diff  = (Date.now() - date.getTime()) / 1000;
  if (diff < 30)    return 'agora';
  if (diff < 60)    return `${Math.floor(diff)}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function likesOf(data)   { return (data.likedBy || []).length; }
function repliesOf(data) { return data.replyCount || 0; }

// ── Live clock ──
function updateClock() {
  const n = new Date();
  liveClock.textContent =
    String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
}
setInterval(updateClock, 1000);
updateClock();

// ── Stats & ticker ──
function computeStats() {
  let totalLikes = 0, totalReplies = 0;
  const authorCount = new Map();
  for (const { data } of allPosts.values()) {
    totalLikes   += likesOf(data);
    totalReplies += repliesOf(data);
    const a = data.author || 'anônimo';
    authorCount.set(a, (authorCount.get(a) || 0) + 1);
  }
  let topAuthor = '', topCount = 0;
  for (const [name, count] of authorCount) {
    if (count > topCount) { topAuthor = name; topCount = count; }
  }
  return { totalPosts: allPosts.size, totalLikes, totalReplies, topAuthor, topCount };
}

function updateTicker() {
  const s = computeStats();
  const items = [
    `${s.totalPosts} posts`,
    `${s.totalLikes} ♥`,
    `${s.totalReplies} respostas`,
    s.topAuthor ? `${s.topAuthor} lidera` : null,
    'poste agora',
  ].filter(Boolean);

  const all = [...items, ...items];
  tickerTrack.innerHTML = '';
  for (const text of all) {
    const span = document.createElement('span');
    span.className = 'ticker-item';
    span.innerHTML = `${escapeHTML(text)}<span>★</span>`;
    tickerTrack.appendChild(span);
  }
}

function updatePostCount() {
  postCountVal.textContent = allPosts.size;
}

// ── Author chip builder ──
function buildAuthorChip(author, gradient, size, isMod) {
  const initial = (author || '?').charAt(0).toUpperCase();
  const wrap = document.createElement('div');
  wrap.className = 'author-chip';
  wrap.style.cssText = `width:${size}px;height:${size}px;`;

  const inner = document.createElement('div');
  inner.className = 'author-chip-inner';
  inner.style.cssText = `
    width:${size}px;height:${size}px;
    background:${gradientCSS(gradient)};
    font-size:${Math.round(size * 0.4)}px;
  `;
  inner.textContent = initial;
  wrap.appendChild(inner);

  if (isMod) {
    const badge = document.createElement('div');
    badge.className = 'author-chip-mod';
    const s2 = Math.round(size * 0.4);
    badge.style.cssText = `width:${s2}px;height:${s2}px;font-size:${Math.round(size * 0.22)}px;`;
    badge.textContent = '★';
    wrap.appendChild(badge);
  }
  return wrap;
}

// ── Corner ticks ──
function addCornerTicks(el, color = '#ff2d78', sz = 20) {
  const T = `2px solid ${color}`;
  const corners = [
    { top:'10px', left:'10px',   borderTop:T, borderLeft:T   },
    { top:'10px', right:'10px',  borderTop:T, borderRight:T  },
    { bottom:'10px', left:'10px',  borderBottom:T, borderLeft:T  },
    { bottom:'10px', right:'10px', borderBottom:T, borderRight:T },
  ];
  for (const styles of corners) {
    const tick = document.createElement('div');
    tick.className = 'ctick';
    tick.style.width  = sz + 'px';
    tick.style.height = sz + 'px';
    Object.assign(tick.style, styles);
    el.appendChild(tick);
  }
}

// ── Big count ──
function buildBigCount(value, icon, color) {
  const el = document.createElement('div');
  el.className = 'big-count';
  el.innerHTML = `
    <div class="big-count-val" style="color:${color};text-shadow:0 0 16px ${color}80;">${value}</div>
    <div class="big-count-icon" style="color:${color};">${icon}</div>
  `;
  return el;
}

// ── View switcher ──
function applyView(view) {
  const cfg = VIEW_CFG[view] || VIEW_CFG.curtidos;
  kineticBg.className = `kinetic-bg tint-${cfg.tint}`;

  const hideLabel = view === 'nudge' || view === 'breaking';
  viewLabelWrap.classList.toggle('label-hidden', hideLabel);
  boardScene.classList.toggle('no-label', hideLabel);

  if (!hideLabel) {
    viewLabelText.textContent = cfg.label;
    viewLabelSub.textContent  = cfg.sub ? `// ${cfg.sub}` : '';
  }
}

// ── Reply subscriptions ──
function ensureReplies(id) {
  if (replyUnsubs.has(id)) return;
  const q = query(
    collection(db, POSTS, id, 'replies'),
    orderBy('createdAt', 'desc'),
    limit(5)
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
    isReady = false; isBreaking = false;
    updateTicker();
    return;
  }
  emptyState.classList.add('hidden');

  const newlyAdded = [];
  if (isReady && !isBreaking) {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'added') newlyAdded.push(ch.doc);
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

  const topCommented = [...allPosts.values()]
    .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
    .slice(0, 5);
  const keepIds = new Set(topCommented.map(p => p.id));
  topCommented.forEach(p => ensureReplies(p.id));
  pruneReplies(keepIds);

  updatePostCount();
  updateTicker();

  if (!isReady) {
    isReady = true;
    startViews();
  } else if (newlyAdded.length && !isPaused) {
    const newest = newlyAdded.sort(
      (a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0)
    )[0];
    showBreakingNews(allPosts.get(newest.id));
  }
});

// ── View controller ──
function startViews() {
  renderCurrentView();
  scheduleNext();
}

function scheduleNext() {
  clearTimeout(viewTimer);
  if (isPaused) return;
  viewTimer = setTimeout(() => {
    viewIndex = (viewIndex + 1) % VIEWS.length;
    renderCurrentView();
    scheduleNext();
  }, DURATIONS[VIEWS[viewIndex]]);
}

function renderCurrentView() {
  const view = VIEWS[viewIndex];
  applyView(view);
  transitionTo(() => {
    if      (view === 'curtidos')   renderCurtidos();
    else if (view === 'recentes')   renderRecentes();
    else if (view === 'comentados') renderComentados();
    else if (view === 'bombando')   renderBombando();
    else                            renderNudge();
  });
}

function transitionTo(fn) {
  boardScene.classList.add('scene-exit');
  setTimeout(() => {
    boardScene.innerHTML = '';
    boardScene.classList.remove('scene-exit');
    fn();
  }, 440);
}

// ── Breaking news interrupt ──
function showBreakingNews(post) {
  if (!post) return;
  isBreaking = true;
  clearTimeout(viewTimer);
  clearTimeout(breakingTimer);

  applyView('breaking');
  boardScene.classList.add('scene-exit');
  setTimeout(() => {
    boardScene.innerHTML = '';
    boardScene.classList.remove('scene-exit');
    renderBreakingCard(post, 'POSTADO AGORA MESMO');
  }, 440);

  breakingTimer = setTimeout(() => {
    isBreaking = false;
    applyView(VIEWS[viewIndex]);
    renderCurrentView();
    scheduleNext();
  }, 10940);
}

// ════════════════════════════════════════
// RENDER: MAIS CURTIDOS
// ════════════════════════════════════════
function renderCurtidos() {
  const sorted = [...allPosts.values()]
    .filter(p => likesOf(p.data) > 0)
    .sort((a, b) => likesOf(b.data) - likesOf(a.data));

  if (!sorted.length) { renderRecentes(); return; }

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

  // ── Hero card ──
  const hero = posts[0];
  const heroData = hero.data;
  const heroLikes = likesOf(heroData);
  const heroReplies = repliesOf(heroData);
  const heroMod = MOD_NAMES.has(heroData.author);

  const heroCard = document.createElement('article');
  heroCard.className = 'hero-card';
  heroCard.dataset.postId = hero.id;
  addCornerTicks(heroCard, '#ff2d78', 20);

  const heroRankEl = document.createElement('div');
  heroRankEl.className = 'hero-rank';
  heroRankEl.textContent = rankBase;
  heroCard.appendChild(heroRankEl);

  const meta = document.createElement('div');
  meta.className = 'hero-meta';
  meta.innerHTML = `
    <span class="hero-meta-tag">POST #${String(allPosts.size).padStart(4,'0')}</span>
    <span class="hero-momentum">↑ ${heroLikes} curtidas</span>
  `;
  heroCard.appendChild(meta);

  const textEl = document.createElement('div');
  textEl.className = 'hero-text';
  if (isDrawing(heroData)) {
    const img = document.createElement('img');
    img.src = heroData.message; img.alt = 'desenho';
    img.style.cssText = 'max-width:100%;max-height:200px;object-fit:contain;border-radius:8px;background:#fff;';
    textEl.appendChild(img);
    if (heroData.caption) {
      const cap = document.createElement('div');
      cap.className = 'board-caption';
      cap.textContent = heroData.caption;
      textEl.appendChild(cap);
    }
  } else {
    textEl.textContent = heroData.message || '';
  }
  heroCard.appendChild(textEl);

  const footer = document.createElement('div');
  footer.className = 'hero-footer';
  footer.appendChild(buildAuthorChip(heroData.author, heroData.gradient, 72, heroMod));
  const authorInfo = document.createElement('div');
  authorInfo.className = 'hero-author-info';
  authorInfo.innerHTML = `
    <div class="hero-author-name">@${escapeHTML(heroData.author || 'anônimo')}</div>
    <div class="hero-author-time">${formatTime(heroData.createdAt)} atrás</div>
  `;
  footer.appendChild(authorInfo);
  const counts = document.createElement('div');
  counts.className = 'hero-counts';
  counts.appendChild(buildBigCount(heroLikes, '♥', '#ff2d78'));
  counts.appendChild(buildBigCount(heroReplies, '💬', '#9b59ff'));
  footer.appendChild(counts);
  heroCard.appendChild(footer);
  boardScene.appendChild(heroCard);

  // ── Side cards (#2 and #3) ──
  const rightCol = document.createElement('div');
  rightCol.className = 'curtidos-right';

  for (let i = 1; i <= 2; i++) {
    if (!posts[i]) continue;
    const p = posts[i];
    const pd = p.data;
    const pLikes = likesOf(pd);
    const pReplies = repliesOf(pd);
    const pMod = MOD_NAMES.has(pd.author);

    const card = document.createElement('article');
    card.className = 'side-card';
    card.dataset.postId = p.id;
    card.style.animationDelay = `${i * 0.12}s`;
    addCornerTicks(card, 'rgba(255,255,255,0.3)', 16);

    const rank = document.createElement('div');
    rank.className = 'side-rank';
    rank.textContent = rankBase + i;
    card.appendChild(rank);

    const sideMeta = document.createElement('div');
    sideMeta.className = 'side-meta';
    sideMeta.innerHTML = `<span class="side-meta-tag">${formatTime(pd.createdAt)} atrás</span>`;
    card.appendChild(sideMeta);

    const sideText = document.createElement('div');
    sideText.className = 'side-text';
    if (isDrawing(pd)) {
      const img = document.createElement('img');
      img.src = pd.message; img.alt = 'desenho';
      img.style.cssText = 'max-width:100%;max-height:90px;object-fit:contain;border-radius:4px;background:#fff;';
      sideText.appendChild(img);
      if (pd.caption) {
        const cap = document.createElement('div');
        cap.className = 'board-caption';
        cap.textContent = pd.caption;
        sideText.appendChild(cap);
      }
    } else {
      sideText.textContent = pd.message || '';
    }
    card.appendChild(sideText);

    const sideFooter = document.createElement('div');
    sideFooter.className = 'side-footer';
    sideFooter.appendChild(buildAuthorChip(pd.author, pd.gradient, 44, pMod));
    const sName = document.createElement('div');
    sName.className = 'side-author-name';
    sName.textContent = '@' + (pd.author || 'anônimo');
    sideFooter.appendChild(sName);
    const sCounts = document.createElement('div');
    sCounts.className = 'side-counts';
    sCounts.innerHTML = `<span class="count-likes">♥${pLikes}</span><span class="count-replies">💬${pReplies}</span>`;
    sideFooter.appendChild(sCounts);
    card.appendChild(sideFooter);
    rightCol.appendChild(card);
  }

  boardScene.appendChild(rightCol);
}

// ════════════════════════════════════════
// RENDER: RECENTES (breaking layout, most recent post)
// ════════════════════════════════════════
function renderRecentes() {
  const sorted = [...allPosts.values()]
    .sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0));

  if (!sorted.length) return;
  const post = sorted[0];
  const timeStr = `POSTADO ${formatTime(post.data.createdAt)}`.toUpperCase();
  renderBreakingCard(post, timeStr === 'POSTADO AGORA' ? 'CHEGOU AGORA MESMO' : `POSTADO HÁ ${formatTime(post.data.createdAt).toUpperCase()}`);
}

// ════════════════════════════════════════
// SHARED: breaking card layout
// ════════════════════════════════════════
function renderBreakingCard(post, timeStr) {
  boardScene.className = `board-scene view-breaking no-label scene-enter`;

  const ghost = document.createElement('div');
  ghost.className = 'breaking-novo';
  ghost.textContent = 'NOVO';
  boardScene.appendChild(ghost);

  const timeLabel = document.createElement('div');
  timeLabel.className = 'breaking-time-label';
  timeLabel.innerHTML = `
    <span class="breaking-time-dot"></span>
    <span class="breaking-time-text">${escapeHTML(timeStr)}</span>
  `;
  boardScene.appendChild(timeLabel);

  const d = post.data;
  const isMod = MOD_NAMES.has(d.author);

  const card = document.createElement('div');
  card.className = 'breaking-card';
  addCornerTicks(card, '#ff2d78', 28);

  const hdr = document.createElement('div');
  hdr.className = 'breaking-card-header';
  hdr.appendChild(buildAuthorChip(d.author, d.gradient, 84, isMod));
  const aInfo = document.createElement('div');
  aInfo.innerHTML = `
    <div class="breaking-author-name">@${escapeHTML(d.author || 'anônimo')}</div>
    <div class="breaking-author-sub">postou agora mesmo</div>
  `;
  hdr.appendChild(aInfo);
  card.appendChild(hdr);

  if (isDrawing(d)) {
    const img = document.createElement('img');
    img.className = 'breaking-drawing';
    img.src = d.message; img.alt = 'desenho';
    card.appendChild(img);
    if (d.caption) {
      const cap = document.createElement('div');
      cap.className = 'board-caption';
      cap.textContent = d.caption;
      card.appendChild(cap);
    }
  } else {
    const textEl = document.createElement('div');
    textEl.className = 'breaking-text';
    textEl.textContent = d.message || '';
    card.appendChild(textEl);
  }

  boardScene.appendChild(card);
}

// ════════════════════════════════════════
// RENDER: COMENTADOS
// ════════════════════════════════════════
function renderComentados() {
  const sorted = [...allPosts.values()]
    .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
    .filter(p => repliesOf(p.data) > 0)
    .slice(0, 5);

  if (!sorted.length) { renderRecentes(); return; }

  const idx  = comentadosIndex % sorted.length;
  const post = sorted[idx];
  comentadosIndex = (comentadosIndex + 1) % sorted.length;

  boardScene.className = 'board-scene view-comentados scene-enter';

  const d = post.data;
  const isMod = MOD_NAMES.has(d.author);
  const lk = likesOf(d);
  const rc = repliesOf(d);

  // ── Left: original post ──
  const postCard = document.createElement('article');
  postCard.className = 'comentados-post';
  addCornerTicks(postCard, '#00d4ff', 16);

  const topRow = document.createElement('div');
  topRow.innerHTML = `
    <span class="comentados-label">O POST</span>
    <span class="comentados-timestamp">${formatTime(d.createdAt)}</span>
  `;
  postCard.appendChild(topRow);

  const textEl = document.createElement('div');
  textEl.className = 'comentados-text';
  if (isDrawing(d)) {
    const img = document.createElement('img');
    img.src = d.message; img.alt = 'desenho';
    img.style.cssText = 'max-width:100%;max-height:180px;object-fit:contain;border-radius:8px;background:#fff;';
    textEl.appendChild(img);
    if (d.caption) {
      const cap = document.createElement('div');
      cap.className = 'board-caption';
      cap.textContent = d.caption;
      textEl.appendChild(cap);
    }
  } else {
    textEl.textContent = d.message || '';
  }
  postCard.appendChild(textEl);

  const postFooter = document.createElement('div');
  postFooter.className = 'comentados-post-footer';
  postFooter.appendChild(buildAuthorChip(d.author, d.gradient, 64, isMod));
  const pName = document.createElement('div');
  pName.className = 'comentados-post-author';
  pName.textContent = '@' + (d.author || 'anônimo');
  postFooter.appendChild(pName);
  const pCounts = document.createElement('div');
  pCounts.className = 'comentados-post-counts';
  pCounts.innerHTML = `
    <span style="color:var(--pink-lt);font-size:28px;font-family:var(--font-mono);font-weight:800;">♥${lk}</span>
    <span style="color:var(--cyan);font-size:28px;font-family:var(--font-mono);font-weight:800;">💬${rc}</span>
  `;
  postFooter.appendChild(pCounts);
  postCard.appendChild(postFooter);
  boardScene.appendChild(postCard);

  // ── Right: replies ──
  const repliesCol = document.createElement('div');
  repliesCol.className = 'comentados-replies';

  const repliesHdr = document.createElement('div');
  repliesHdr.className = 'comentados-replies-header';
  repliesHdr.textContent = '▼ ÚLTIMAS RESPOSTAS';
  repliesCol.appendChild(repliesHdr);

  const replies = post.replies || [];
  if (!replies.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--text-muted);font-size:14px;letter-spacing:2px;padding:20px 0;font-family:var(--font-mono);';
    empty.textContent = 'carregando respostas…';
    repliesCol.appendChild(empty);
  } else {
    for (let i = 0; i < Math.min(replies.length, 5); i++) {
      const r = replies[i];
      const bubble = document.createElement('div');
      bubble.className = 'reply-bubble';

      const bHdr = document.createElement('div');
      bHdr.className = 'reply-bubble-header';
      bHdr.appendChild(buildAuthorChip(r.author, r.gradient, 28, MOD_NAMES.has(r.author)));
      const bMeta = document.createElement('span');
      bMeta.className = 'reply-bubble-author';
      bMeta.textContent = '@' + (r.author || 'anônimo');
      bHdr.appendChild(bMeta);
      const bTime = document.createElement('span');
      bTime.className = 'reply-bubble-time';
      bTime.textContent = '—' + formatTime(r.createdAt);
      bHdr.appendChild(bTime);
      bubble.appendChild(bHdr);

      if (isDrawing(r)) {
        const img = document.createElement('img');
        img.src = r.message; img.alt = 'desenho';
        img.style.cssText = 'max-height:44px;object-fit:contain;border-radius:4px;background:#fff;';
        bubble.appendChild(img);
      } else {
        const bText = document.createElement('div');
        bText.className = 'reply-bubble-text';
        bText.textContent = r.message || '';
        bubble.appendChild(bText);
      }
      repliesCol.appendChild(bubble);
    }
  }

  if (rc > 5) {
    const more = document.createElement('div');
    more.className = 'comentados-more';
    more.innerHTML = `<span>+${rc - 5} outras respostas</span><span class="comentados-more-line"></span><span>→</span>`;
    repliesCol.appendChild(more);
  }

  boardScene.appendChild(repliesCol);
}

// ════════════════════════════════════════
// RENDER: E TEM MAIS (bombando / underdogs)
// ════════════════════════════════════════
function getBombandoPosts() {
  const topLikesIds = new Set(
    [...allPosts.values()]
      .sort((a, b) => likesOf(b.data) - likesOf(a.data))
      .slice(0, 9).map(p => p.id)
  );
  const topRecentIds = new Set(
    [...allPosts.values()]
      .sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0))
      .slice(0, 4).map(p => p.id)
  );
  const topRepliesIds = new Set(
    [...allPosts.values()]
      .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
      .slice(0, 5).filter(p => repliesOf(p.data) > 0).map(p => p.id)
  );
  return [...allPosts.values()].filter(p =>
    !topLikesIds.has(p.id) && !topRecentIds.has(p.id) && !topRepliesIds.has(p.id)
  );
}

function renderBombando() {
  const eligible = getBombandoPosts();
  if (!eligible.length) { renderCurtidos(); return; }

  let unseen = eligible.filter(p => !olhoShown.has(p.id));
  if (!unseen.length) { olhoShown.clear(); unseen = eligible; }

  unseen.sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0));
  const toShow = unseen.slice(0, 4);
  toShow.forEach(p => olhoShown.add(p.id));

  boardScene.className = 'board-scene view-bombando scene-enter';

  toShow.forEach((post, i) => {
    const d = post.data;
    const isMod = MOD_NAMES.has(d.author);
    const lk = likesOf(d);
    const rc = repliesOf(d);
    const badge = BOMBANDO_BADGES[i] || 'MERECE MAIS';

    const row = document.createElement('div');
    row.className = 'bombando-row';
    row.style.animationDelay = `${i * 0.08}s`;

    const idx = document.createElement('div');
    idx.className = 'bombando-idx';
    idx.textContent = `0${i + 1}`;
    row.appendChild(idx);

    const content = document.createElement('div');
    content.className = 'bombando-content';
    const bText = document.createElement('div');
    bText.className = 'bombando-text';
    if (isDrawing(d)) {
      const img = document.createElement('img');
      img.src = d.message; img.alt = 'desenho';
      img.className = 'bombando-drawing-img';
      bText.appendChild(img);
      if (d.caption) {
        const cap = document.createElement('span');
        cap.className = 'board-caption';
        cap.textContent = d.caption;
        bText.appendChild(cap);
      }
    } else {
      bText.textContent = d.message || '';
    }
    content.appendChild(bText);

    const bAuthor = document.createElement('div');
    bAuthor.className = 'bombando-author';
    bAuthor.appendChild(buildAuthorChip(d.author, d.gradient, 26, isMod));
    const baName = document.createElement('span');
    baName.className = 'bombando-author-name';
    baName.textContent = '@' + (d.author || 'anônimo');
    bAuthor.appendChild(baName);
    const baTime = document.createElement('span');
    baTime.className = 'bombando-author-time';
    baTime.textContent = '· ' + formatTime(d.createdAt);
    bAuthor.appendChild(baTime);
    content.appendChild(bAuthor);
    row.appendChild(content);

    const bBadge = document.createElement('div');
    bBadge.className = 'bombando-badge';
    bBadge.textContent = badge;
    row.appendChild(bBadge);

    const bCounts = document.createElement('div');
    bCounts.className = 'bombando-counts';
    bCounts.innerHTML = `
      <span style="color:var(--pink-lt);font-size:20px;">♥ ${lk}</span>
      <span style="color:var(--text-dim);font-size:16px;">💬 ${rc}</span>
    `;
    row.appendChild(bCounts);
    boardScene.appendChild(row);
  });
}

// ════════════════════════════════════════
// RENDER: NUDGE / PARTICIPE
// ════════════════════════════════════════
function renderNudge() {
  boardScene.className = 'board-scene view-nudge no-label scene-enter';

  // Left: POSTE / AGORA / MESMO
  const left = document.createElement('div');
  left.className = 'nudge-left';

  const ghostStack = document.createElement('div');
  ghostStack.className = 'nudge-ghost-stack';
  for (const word of ['POSTE','AGORA','MESMO']) {
    const el = document.createElement('span');
    el.className = 'nudge-ghost-word';
    el.textContent = word;
    ghostStack.appendChild(el);
  }
  left.appendChild(ghostStack);

  const solidStack = document.createElement('div');
  solidStack.className = 'nudge-solid-stack';
  const words = [
    { text:'POSTE', cls:'nudge-word nudge-word-white'    },
    { text:'AGORA', cls:'nudge-word nudge-word-gradient' },
    { text:'MESMO', cls:'nudge-word nudge-word-white'    },
  ];
  for (const { text, cls } of words) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    solidStack.appendChild(el);
  }
  left.appendChild(solidStack);
  boardScene.appendChild(left);

  // Right: QR + URL
  const right = document.createElement('div');
  right.className = 'nudge-right';

  const caption = document.createElement('div');
  caption.className = 'nudge-caption';
  caption.textContent = 'escaneie · poste · apareça aqui em segundos';
  right.appendChild(caption);

  const qrWrap = document.createElement('div');
  qrWrap.className = 'nudge-qr-wrap';
  const qrImg = document.createElement('img');
  qrImg.className = 'nudge-qr-img';
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent('https://weverse-hangover.pages.dev')}`;
  qrImg.alt = 'QR Code — weverse-hangover.pages.dev';
  qrWrap.appendChild(qrImg);
  right.appendChild(qrWrap);

  const url = document.createElement('div');
  url.className = 'nudge-url';
  url.textContent = 'WEVERSE-HANGOVER.PAGES.DEV';
  right.appendChild(url);

  boardScene.appendChild(right);
}

// ── Pause / resume ──
const pauseIndicator = document.getElementById('pauseIndicator');

function togglePause() {
  isPaused = !isPaused;
  pauseIndicator.classList.toggle('visible', isPaused);

  if (isPaused) {
    clearTimeout(viewTimer);
    clearTimeout(breakingTimer);
  } else {
    isBreaking = false;
    applyView(VIEWS[viewIndex]);
    renderCurrentView();
    scheduleNext();
  }
}

document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (isReady) togglePause();
  } else if (e.code === 'ArrowRight' && isReady) {
    e.preventDefault();
    isBreaking = false;
    clearTimeout(viewTimer);
    clearTimeout(breakingTimer);
    viewIndex = (viewIndex + 1) % VIEWS.length;
    renderCurrentView();
    if (!isPaused) scheduleNext();
  } else if (e.code === 'ArrowLeft' && isReady) {
    e.preventDefault();
    isBreaking = false;
    clearTimeout(viewTimer);
    clearTimeout(breakingTimer);
    viewIndex = (viewIndex - 1 + VIEWS.length) % VIEWS.length;
    renderCurrentView();
    if (!isPaused) scheduleNext();
  }
});

// ── Refresh timestamps every 30s ──
setInterval(() => {
  document.querySelectorAll('.hero-author-time').forEach(el => {
    const card = el.closest('[data-post-id]');
    const post = card && allPosts.get(card.dataset.postId);
    if (post) el.textContent = formatTime(post.data.createdAt) + ' atrás';
  });
}, 30000);

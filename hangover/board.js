import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import {
  getFirestore, collection, query, orderBy, limit, onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';

const firebaseConfig = await fetch('/api/config').then(r => r.json());
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const MOD_NAMES = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.name));
const POSTS = 'hangul_messages';

const kineticBg      = document.getElementById('kineticBg');
const boardScene     = document.getElementById('boardScene');
const emptyState     = document.getElementById('emptyState');
const viewLabelWrap  = document.getElementById('viewLabelWrap');
const viewLabelText  = document.getElementById('viewLabelText');
const statPostsVal   = document.querySelector('#statPosts .stat-val');
const statLikesVal   = document.querySelector('#statLikes .stat-val');

const allPosts    = new Map();
const replyUnsubs = new Map();

const VIEWS     = ['trending', 'agora', 'thread', 'descobertas', 'participe'];
const DURATIONS = { trending: 14000, agora: 12000, thread: 18000, descobertas: 14000, participe: 12000 };

const VIEW_CFG = {
  trending:    { label: 'TRENDING',       tint: 'default' },
  agora:       { label: 'AGORA',          tint: 'hot'     },
  thread:      { label: 'THREAD EM FOCO', tint: 'cool'    },
  descobertas: { label: 'DESCOBERTAS',    tint: 'default' },
  participe:   { label: '',               tint: 'hot'     },
  breaking:    { label: '',               tint: 'hot'     },
};

let viewIndex         = 0;
let viewTimer         = null;
let trendingOffset    = 0;
let trendingLastIds   = '';
let trendingSameCount = 0;
let threadIndex       = 0;
const olhoShown       = new Set();
let isBreaking        = false;
let breakingTimer     = null;
let isReady           = false;
let isPaused          = false;

const DESCOBERTAS_BADGES = ['AINDA SEM SER VISTO', 'SÓ UM CURTIDO', 'MERECE MAIS', 'PASSOU BATIDO'];

const DRAWING_RE = /^data:image\/(png|jpeg|gif|webp);base64,/;
function isDrawing(d) { return d.type === 'drawing' && typeof d.message === 'string' && DRAWING_RE.test(d.message); }

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

function chipSize(kind) {
  const w = window.innerWidth;
  if (kind === 'hero')  return Math.round(Math.min(Math.max(w * 0.06, 40), 80));
  if (kind === 'side')  return Math.round(Math.min(Math.max(w * 0.038, 28), 52));
  if (kind === 'reply') return Math.round(Math.min(Math.max(w * 0.024, 20), 32));
  return Math.round(Math.min(Math.max(w * 0.05, 32), 64));
}

function buildAuthorChip(author, gradient, size, isMod) {
  const initial = (author || '?').charAt(0).toUpperCase();
  const wrap = document.createElement('div');
  wrap.className = 'author-chip';
  wrap.style.cssText = `width:${size}px;height:${size}px;background:${gradientCSS(gradient)};font-size:${Math.round(size * 0.4)}px;`;
  wrap.textContent = initial;

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

const SVG_REPLIES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" style="width:1em;height:1em;vertical-align:middle;"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 4V5z"/></svg>`;

function fitText(el, maxPx, minPx) {
  if (el.querySelector('img')) return;
  let size = maxPx;
  el.style.fontSize = size + 'px';
  while (size > minPx && el.scrollHeight > el.clientHeight) {
    size -= 2;
    el.style.fontSize = size + 'px';
  }
}

function buildBigCount(value, icon, color) {
  const el = document.createElement('div');
  el.className = 'big-count';
  el.innerHTML = `
    <div class="big-count-val" style="color:${color};text-shadow:0 0 16px ${color}80;">${value}</div>
    <div class="big-count-icon" style="color:${color};">${icon}</div>
  `;
  return el;
}

function updateStats() {
  const totalPosts = allPosts.size;
  let totalLikes = 0;
  allPosts.forEach(e => { totalLikes += likesOf(e.data); });
  if (statPostsVal) statPostsVal.textContent = totalPosts;
  if (statLikesVal) statLikesVal.textContent = totalLikes;
}

function applyView(view) {
  const cfg = VIEW_CFG[view] || VIEW_CFG.trending;
  kineticBg.className = `kinetic-bg tint-${cfg.tint}`;

  const hideLabel = view === 'participe' || view === 'breaking';
  viewLabelWrap.classList.toggle('label-hidden', hideLabel);
  boardScene.classList.toggle('no-label', hideLabel);

  if (!hideLabel) {
    viewLabelText.textContent = cfg.label;
  }
}

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

const postsQ = query(collection(db, POSTS), orderBy('createdAt', 'desc'), limit(80));

onSnapshot(postsQ, snap => {
  if (snap.empty) {
    allPosts.clear();
    emptyState.classList.remove('hidden');
    boardScene.innerHTML = '';
    clearTimeout(viewTimer);
    clearTimeout(breakingTimer);
    isReady = false; isBreaking = false;
    updateStats();
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

  updateStats();

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
    if      (view === 'trending')    renderTrending();
    else if (view === 'agora')       renderAgora();
    else if (view === 'thread')      renderThread();
    else if (view === 'descobertas') renderDescobertas();
    else                             renderParticipe();
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
// RENDER: TRENDING
// ════════════════════════════════════════
function renderTrending() {
  const sorted = [...allPosts.values()]
    .filter(p => likesOf(p.data) > 0)
    .sort((a, b) => likesOf(b.data) - likesOf(a.data));

  if (!sorted.length) { renderAgora(); return; }

  const slice = sorted.slice(trendingOffset, trendingOffset + 3);
  const ids   = slice.map(p => p.id).join(',');
  if (ids === trendingLastIds) {
    trendingSameCount++;
    if (trendingSameCount >= 2) {
      const next = trendingOffset + 3;
      trendingOffset    = (next < 9 && sorted.length > next) ? next : 0;
      trendingSameCount = 0;
    }
  } else {
    trendingLastIds   = ids;
    trendingSameCount = 1;
  }

  const posts    = sorted.slice(trendingOffset, trendingOffset + 3);
  const rankBase = trendingOffset + 1;
  if (!posts.length) return;

  boardScene.className = 'board-scene view-trending scene-enter';

  const hero = posts[0];
  const heroData = hero.data;
  const heroLikes = likesOf(heroData);
  const heroReplies = repliesOf(heroData);
  const heroMod = MOD_NAMES.has(heroData.author);

  const heroCard = document.createElement('article');
  heroCard.className = 'hero-card';

  const heroRankEl = document.createElement('div');
  heroRankEl.className = 'hero-rank';
  heroRankEl.textContent = rankBase;
  heroCard.appendChild(heroRankEl);

  const textEl = document.createElement('div');
  textEl.className = 'hero-text';
  if (isDrawing(heroData)) {
    const img = document.createElement('img');
    img.src = heroData.message; img.alt = 'desenho';
    img.style.cssText = 'max-width:100%;height:100%;object-fit:contain;border-radius:8px;background:#fff;display:block;';
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
  footer.appendChild(buildAuthorChip(heroData.author, heroData.gradient, chipSize('hero'), heroMod));
  const authorInfo = document.createElement('div');
  authorInfo.className = 'hero-author-info';
  authorInfo.innerHTML = `<div class="hero-author-name">@${escapeHTML(heroData.author || 'anônimo')}</div>`;
  footer.appendChild(authorInfo);
  const counts = document.createElement('div');
  counts.className = 'hero-counts';
  counts.appendChild(buildBigCount(heroLikes, '♥', '#ff2d78'));
  counts.appendChild(buildBigCount(heroReplies, SVG_REPLIES, '#9b59ff'));
  footer.appendChild(counts);
  heroCard.appendChild(footer);
  boardScene.appendChild(heroCard);

  const rightCol = document.createElement('div');
  rightCol.className = 'trending-right';

  for (let i = 1; i <= 2; i++) {
    if (!posts[i]) continue;
    const p = posts[i];
    const pd = p.data;
    const pLikes = likesOf(pd);
    const pReplies = repliesOf(pd);
    const pMod = MOD_NAMES.has(pd.author);

    const card = document.createElement('article');
    card.className = 'side-card';
    card.style.animationDelay = `${i * 0.12}s`;

    const rank = document.createElement('div');
    rank.className = 'side-rank';
    rank.textContent = rankBase + i;
    card.appendChild(rank);

    const sideText = document.createElement('div');
    sideText.className = 'side-text';
    if (isDrawing(pd)) {
      const img = document.createElement('img');
      img.src = pd.message; img.alt = 'desenho';
      img.style.cssText = 'max-width:100%;height:100%;object-fit:contain;border-radius:4px;background:#fff;display:block;';
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
    sideFooter.appendChild(buildAuthorChip(pd.author, pd.gradient, chipSize('side'), pMod));
    const sName = document.createElement('div');
    sName.className = 'side-author-name';
    sName.textContent = '@' + (pd.author || 'anônimo');
    sideFooter.appendChild(sName);
    const sCounts = document.createElement('div');
    sCounts.className = 'side-counts';
    sCounts.innerHTML = `<span class="count-likes">♥${pLikes}</span><span class="count-replies">${SVG_REPLIES}${pReplies}</span>`;
    sideFooter.appendChild(sCounts);
    card.appendChild(sideFooter);
    rightCol.appendChild(card);
  }

  boardScene.appendChild(rightCol);

  requestAnimationFrame(() => {
    const w = window.innerWidth;
    const ht = boardScene.querySelector('.hero-text');
    if (ht) fitText(ht, Math.round(w * 0.055), Math.round(w * 0.018));
    boardScene.querySelectorAll('.side-text').forEach(el =>
      fitText(el, Math.round(w * 0.035), Math.round(w * 0.012))
    );
  });
}

// ════════════════════════════════════════
// RENDER: AGORA (most recent)
// ════════════════════════════════════════
function renderAgora() {
  const sorted = [...allPosts.values()]
    .sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0));

  if (!sorted.length) return;
  const post = sorted[0];
  const timeStr = formatTime(post.data.createdAt);
  const label = timeStr === 'agora' ? 'CHEGOU AGORA MESMO' : `POSTADO HÁ ${timeStr.toUpperCase()}`;
  renderBreakingCard(post, label);
}

// ════════════════════════════════════════
// SHARED: breaking card layout
// ════════════════════════════════════════
function renderBreakingCard(post, timeStr) {
  boardScene.className = 'board-scene view-agora no-label scene-enter';

  const ghost = document.createElement('div');
  ghost.className = 'breaking-ghost';
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

  const hdr = document.createElement('div');
  hdr.className = 'breaking-card-header';
  hdr.appendChild(buildAuthorChip(d.author, d.gradient, chipSize('hero'), isMod));
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
// RENDER: THREAD (comentados)
// ════════════════════════════════════════
function renderThread() {
  const sorted = [...allPosts.values()]
    .sort((a, b) => repliesOf(b.data) - repliesOf(a.data))
    .filter(p => repliesOf(p.data) > 0)
    .slice(0, 5);

  if (!sorted.length) { renderAgora(); return; }

  const idx  = threadIndex % sorted.length;
  const post = sorted[idx];
  threadIndex = (threadIndex + 1) % sorted.length;

  boardScene.className = 'board-scene view-thread scene-enter';

  const d = post.data;
  const isMod = MOD_NAMES.has(d.author);
  const lk = likesOf(d);
  const rc = repliesOf(d);

  const postCard = document.createElement('article');
  postCard.className = 'thread-post';

  const topRow = document.createElement('div');
  topRow.innerHTML = `
    <span class="thread-label">O POST</span>
    <span class="thread-timestamp">${formatTime(d.createdAt)}</span>
  `;
  postCard.appendChild(topRow);

  const textEl = document.createElement('div');
  textEl.className = 'thread-text';
  if (isDrawing(d)) {
    const img = document.createElement('img');
    img.src = d.message; img.alt = 'desenho';
    img.style.cssText = `max-width:100%;max-height:40%;object-fit:contain;border-radius:8px;background:#fff;`;
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
  postFooter.className = 'thread-post-footer';
  postFooter.appendChild(buildAuthorChip(d.author, d.gradient, chipSize('default'), isMod));
  const pName = document.createElement('div');
  pName.className = 'thread-post-author';
  pName.textContent = '@' + (d.author || 'anônimo');
  postFooter.appendChild(pName);

  const w = window.innerWidth;
  const cntSize = Math.round(Math.min(Math.max(w * 0.022, 14), 26));
  const pCounts = document.createElement('div');
  pCounts.className = 'thread-post-counts';
  pCounts.innerHTML = `
    <span style="color:var(--pink-lt);font-size:${cntSize}px;font-family:var(--font-mono);font-weight:800;">♥${lk}</span>
    <span style="color:var(--cyan);font-size:${cntSize}px;font-family:var(--font-mono);font-weight:800;">${SVG_REPLIES}${rc}</span>
  `;
  postFooter.appendChild(pCounts);
  postCard.appendChild(postFooter);
  boardScene.appendChild(postCard);

  const repliesCol = document.createElement('div');
  repliesCol.className = 'thread-replies';

  const repliesHdr = document.createElement('div');
  repliesHdr.className = 'thread-replies-header';
  repliesHdr.textContent = '▼ ÚLTIMAS RESPOSTAS';
  repliesCol.appendChild(repliesHdr);

  const replies = post.replies || [];
  if (!replies.length) {
    const empty = document.createElement('div');
    empty.style.cssText = `color:var(--text-muted);font-size:clamp(0.6rem,1.1vw,1rem);letter-spacing:0.1em;padding:16px 0;font-family:var(--font-mono);`;
    empty.textContent = 'carregando respostas…';
    repliesCol.appendChild(empty);
  } else {
    for (let i = 0; i < Math.min(replies.length, 5); i++) {
      const r = replies[i];
      const bubble = document.createElement('div');
      bubble.className = 'reply-bubble';

      const bHdr = document.createElement('div');
      bHdr.className = 'reply-bubble-header';
      bHdr.appendChild(buildAuthorChip(r.author, r.gradient, chipSize('reply'), MOD_NAMES.has(r.author)));
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
        img.style.cssText = `max-height:clamp(32px,5vh,56px);object-fit:contain;border-radius:4px;background:#fff;`;
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
    more.className = 'thread-more';
    more.innerHTML = `<span>+${rc - 5} outras respostas</span><span class="thread-more-line"></span><span>→</span>`;
    repliesCol.appendChild(more);
  }

  boardScene.appendChild(repliesCol);
}

// ════════════════════════════════════════
// RENDER: DESCOBERTAS (underdogs)
// ════════════════════════════════════════
function getDescovertasPosts() {
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

function renderDescobertas() {
  const eligible = getDescovertasPosts();
  if (!eligible.length) { renderTrending(); return; }

  let unseen = eligible.filter(p => !olhoShown.has(p.id));
  if (!unseen.length) { olhoShown.clear(); unseen = eligible; }

  unseen.sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0));
  const toShow = unseen.slice(0, 4);
  toShow.forEach(p => olhoShown.add(p.id));

  boardScene.className = 'board-scene view-descobertas scene-enter';

  const w = window.innerWidth;
  const countSize = Math.round(Math.min(Math.max(w * 0.016, 12), 20));

  toShow.forEach((post, i) => {
    const d = post.data;
    const isMod = MOD_NAMES.has(d.author);
    const lk = likesOf(d);
    const rc = repliesOf(d);
    const badge = DESCOBERTAS_BADGES[i] || 'MERECE MAIS';

    const row = document.createElement('div');
    row.className = 'descobertas-row';
    row.style.animationDelay = `${i * 0.08}s`;

    const idx = document.createElement('div');
    idx.className = 'descobertas-idx';
    idx.textContent = `0${i + 1}`;
    row.appendChild(idx);

    const content = document.createElement('div');
    content.className = 'descobertas-content';
    const bTextWrap = document.createElement('div');
    bTextWrap.className = 'descobertas-text-wrap';
    if (isDrawing(d)) {
      const img = document.createElement('img');
      img.src = d.message; img.alt = 'desenho';
      img.className = 'descobertas-drawing-img';
      bTextWrap.appendChild(img);
      if (d.caption) {
        const bText = document.createElement('div');
        bText.className = 'descobertas-text';
        bText.textContent = d.caption;
        bTextWrap.appendChild(bText);
      }
    } else {
      const bText = document.createElement('div');
      bText.className = 'descobertas-text';
      bText.textContent = d.message || '';
      bTextWrap.appendChild(bText);
    }
    content.appendChild(bTextWrap);

    const bAuthor = document.createElement('div');
    bAuthor.className = 'descobertas-author';
    bAuthor.appendChild(buildAuthorChip(d.author, d.gradient, chipSize('reply'), isMod));
    const baName = document.createElement('span');
    baName.className = 'descobertas-author-name';
    baName.textContent = '@' + (d.author || 'anônimo');
    bAuthor.appendChild(baName);
    const baTime = document.createElement('span');
    baTime.className = 'descobertas-author-time';
    baTime.textContent = '· ' + formatTime(d.createdAt);
    bAuthor.appendChild(baTime);
    content.appendChild(bAuthor);
    row.appendChild(content);

    const bBadge = document.createElement('div');
    bBadge.className = 'descobertas-badge';
    bBadge.textContent = badge;
    row.appendChild(bBadge);

    const bCounts = document.createElement('div');
    bCounts.className = 'descobertas-counts';
    bCounts.innerHTML = `
      <span style="color:var(--pink-lt);font-size:${countSize}px;">♥ ${lk}</span>
      <span style="color:var(--text-dim);font-size:${countSize}px;">${SVG_REPLIES} ${rc}</span>
    `;
    row.appendChild(bCounts);
    boardScene.appendChild(row);
  });
}

// ════════════════════════════════════════
// RENDER: PARTICIPE (nudge / QR)
// ════════════════════════════════════════
function renderParticipe() {
  boardScene.className = 'board-scene view-participe no-label scene-enter';

  const left = document.createElement('div');
  left.className = 'participe-left';

  const ghostStack = document.createElement('div');
  ghostStack.className = 'participe-ghost-stack';
  for (const word of ['POSTE','AGORA','MESMO']) {
    const el = document.createElement('span');
    el.className = 'participe-ghost-word';
    el.textContent = word;
    ghostStack.appendChild(el);
  }
  left.appendChild(ghostStack);

  const solidStack = document.createElement('div');
  solidStack.className = 'participe-solid-stack';
  const words = [
    { text:'POSTE', cls:'participe-word participe-word-white'    },
    { text:'AGORA', cls:'participe-word participe-word-gradient' },
    { text:'MESMO', cls:'participe-word participe-word-white'    },
  ];
  for (const { text, cls } of words) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    solidStack.appendChild(el);
  }
  left.appendChild(solidStack);
  boardScene.appendChild(left);

  const right = document.createElement('div');
  right.className = 'participe-right';

  const caption = document.createElement('div');
  caption.className = 'participe-caption';
  caption.textContent = 'escaneie · poste · apareça aqui em segundos';
  right.appendChild(caption);

  const qrWrap = document.createElement('div');
  qrWrap.className = 'participe-qr-wrap';
  const qrImg = document.createElement('img');
  qrImg.className = 'participe-qr-img';
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent('https://weverse-hangover.pages.dev')}`;
  qrImg.alt = 'QR Code — weverse-hangover.pages.dev';
  qrWrap.appendChild(qrImg);
  right.appendChild(qrWrap);

  const url = document.createElement('div');
  url.className = 'participe-url';
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

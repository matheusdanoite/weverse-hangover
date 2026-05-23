import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import {
  getFirestore, collection, onSnapshot, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';
import {
  gradientCSS, escapeHTML, highlightMentions, formatTime
} from '../src/shared.js';

const POSTS = 'hangul_messages';

const firebaseConfig = await fetch('/api/config').then(r => r.json());
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const MOD_NAMES = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.name));

const gridInner = document.getElementById('gridInner');
const columns = [
  document.createElement('div'),
  document.createElement('div'),
  document.createElement('div')
];
columns.forEach(col => {
  col.className = 'board-column';
  gridInner.appendChild(col);
});

const gridScroll = document.getElementById('gridScroll');
const loadingEl = document.getElementById('boardLoading');
const emptyEl = document.getElementById('boardEmpty');

const postsMap = new Map();
let allPosts = [];
let shuffledQueue = [];

let paused = false;
let scrollSpeed = 0.6; // px per frame
let firstLoad = true;

const newPostsQueue = [];
let isOverlayActive = false;

const BUFFER_AHEAD_PX = 1500;

function getActualHeight(el) {
  const oA = el.style.animation;
  const oT = el.style.transform;
  const oTr = el.style.transition;
  el.style.animation = 'none';
  el.style.transform = 'none';
  el.style.transition = 'none';
  const h = el.getBoundingClientRect().height;
  el.style.animation = oA;
  el.style.transform = oT;
  el.style.transition = oTr;
  return h;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getNextPost() {
  if (allPosts.length === 0) return null;
  if (shuffledQueue.length === 0) {
    shuffledQueue = shuffle(allPosts);
  }
  return shuffledQueue.shift();
}

function buildCard(id, data, isNew = false) {
  const isDrawing = data.type === 'drawing';
  const likeCount = (data.likedBy || []).length;
  const replyCount = data.replyCount || 0;
  const isMod = MOD_NAMES.has(data.author);

  const grad = data.avatarPhoto
    ? `url(${data.avatarPhoto})`
    : gradientCSS(data.gradient?.length === 2 ? data.gradient : null);
  const avatarBgExtra = data.avatarPhoto
    ? 'background-size:cover;background-position:center center'
    : 'background-size:130% 130%;background-position:center center';

  const drawingSrc = isDrawing && typeof data.message === 'string' &&
    /^data:image\/(png|jpeg|gif|webp);base64,/.test(data.message)
    ? data.message
    : '';

  let textClass = 'text-md';
  if (!isDrawing && typeof data.message === 'string') {
    const len = data.message.length;
    if (len < 30) textClass = 'text-xl';
    else if (len < 70) textClass = 'text-lg';
    else if (len < 130) textClass = 'text-md';
    else textClass = 'text-sm';
  }

  const contentHTML = isDrawing
    ? (drawingSrc
      ? `<img class="card-drawing" src="${drawingSrc}" alt="desenho" loading="lazy" />`
      : '')
    : `<div class="card-text ${textClass}">${highlightMentions(escapeHTML(data.message || ''))}</div>`;

  const el = document.createElement('div');
  el.className = `board-card`;
  el.dataset.id = id;

  el.innerHTML = `
    <div class="card-header">
      <div class="card-avatar" style="background-image:${grad};${avatarBgExtra}"></div>
      <span class="card-author">${escapeHTML(data.author || 'anônimo')}</span>
      ${isMod ? '<span class="card-mod-star">★</span>' : ''}
    </div>
    ${contentHTML}
    ${isNew ? '' : `
    <div class="card-stats">
      <span class="card-stat ${likeCount > 0 ? 'has-likes' : ''}">
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill="${likeCount > 0 ? 'currentColor' : 'none'}"
          stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <span class="stat-num">${likeCount}</span>
      </span>
      <span class="card-stat">
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        <span class="stat-num">${replyCount}</span>
      </span>
    </div>
    `}
  `;

  return el;
}

function processNewPostQueue() {
  if (isOverlayActive || newPostsQueue.length === 0) return;

  isOverlayActive = true;
  const { id, data } = newPostsQueue.shift();

  const overlay = document.getElementById('newPostOverlay');
  const container = document.getElementById('newPostContainer');
  
  if (data.type === 'drawing') {
    container.classList.remove('is-text');
  } else {
    container.classList.add('is-text');
  }

  const card = buildCard(id, data, true);
  container.innerHTML = '';
  container.appendChild(card);

  requestAnimationFrame(() => {
    overlay.classList.add('active');

    setTimeout(() => {
      overlay.classList.remove('active');
      overlay.classList.add('exit');

      setTimeout(() => {
        overlay.classList.remove('exit');
        container.innerHTML = '';
        isOverlayActive = false;
        
        // Push the card to the front of the queue so it appears next on grid organically
        shuffledQueue.unshift([id, data]);
        
        processNewPostQueue();
      }, 800);
    }, 2800);
  });
}

function filterPosts(entries) {
  return entries.filter(([, data]) => {
    const rc = data.reportedBy?.length || 0;
    const mc = data.maintainedCount || 0;
    return !(rc >= 7 && rc > mc);
  });
}

function updateEmpty() {
  if (allPosts.length === 0) {
    emptyEl.classList.remove('hidden');
    gridScroll.classList.add('hidden');
  } else {
    emptyEl.classList.add('hidden');
    gridScroll.classList.remove('hidden');
  }
}

let colState = [
  { scroll: 0, mult: 1.0, direction: -1 }, // Left column: Up
  { scroll: 0, mult: 0.65, direction: 1 }, // Middle column: Down (slower)
  { scroll: 0, mult: 1.15, direction: -1 } // Right column: Up (faster)
];

function checkAndFeedColumn(i) {
  const col = columns[i];
  const state = colState[i];
  const viewH = gridScroll.clientHeight || window.innerHeight;

  if (state.direction === -1) { // Scrolling UP
    if (col.scrollHeight - state.scroll < viewH + BUFFER_AHEAD_PX) {
      const post = getNextPost();
      if (post) col.appendChild(buildCard(post[0], post[1]));
    }
    const cards = col.children;
    while (cards.length > 0) {
      const firstCard = cards[0];
      const hExact = getActualHeight(firstCard);
      const cardBottom = firstCard.offsetTop + hExact;
      if (cardBottom < state.scroll - 1000) {
        const h = hExact + 16;
        const currentPadding = parseFloat(col.style.paddingTop || 0);
        col.style.paddingTop = (currentPadding + h) + 'px';
        firstCard.remove();
      } else {
        break;
      }
    }
    if (state.scroll > 10000000) {
      const currentPadding = parseFloat(col.style.paddingTop || 0);
      const amountToSubtract = Math.min(10000000, currentPadding);
      if (amountToSubtract > 0) {
        state.scroll -= amountToSubtract;
        col.style.paddingTop = (currentPadding - amountToSubtract) + 'px';
      }
    }
    col.style.transform = `translateY(${-state.scroll}px)`;
  } else { // Scrolling DOWN
    if (state.scroll > -BUFFER_AHEAD_PX) {
      const post = getNextPost();
      if (post) {
        const card = buildCard(post[0], post[1]);
        col.insertBefore(card, col.firstChild);
        const h = getActualHeight(card) + 16;
        state.scroll -= h;
      }
    }
    const cards = col.children;
    while (cards.length > 0) {
      const lastCard = cards[cards.length - 1];
      const cardTop = lastCard.offsetTop;
      if (cardTop + state.scroll > viewH + 1000) {
        lastCard.remove();
      } else {
        break;
      }
    }
    col.style.transform = `translateY(${state.scroll}px)`;
  }
}

function removeCardSmoothly(id) {
  const existingCards = gridInner.querySelectorAll(`.board-card[data-id="${id}"]`);
  existingCards.forEach(card => {
    const col = card.closest('.board-column');
    if (!col) return;
    const colIndex = columns.indexOf(col);
    const state = colState[colIndex];
    
    const hExact = getActualHeight(card);
    const h = hExact + 16;
    const cardBottom = card.offsetTop + hExact;
    const cardTop = card.offsetTop;
    
    const viewH = gridScroll.clientHeight || window.innerHeight;

    let isAbove = false;
    let isVisible = false;

    if (state.direction === -1) { // UP
      isAbove = cardBottom <= state.scroll;
      isVisible = cardBottom > state.scroll && cardTop < state.scroll + viewH;
    } else { // DOWN
      isAbove = cardBottom <= -state.scroll;
      isVisible = cardBottom > -state.scroll && cardTop < -state.scroll + viewH;
    }

    if (isVisible) {
      card.style.transition = 'opacity 0.4s ease, margin-top 0.4s ease, transform 0.4s ease';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.8)';
      card.style.marginTop = `-${h}px`;
      card.style.overflow = 'hidden';
      setTimeout(() => card.remove(), 400);
    } else {
      if (isAbove) {
        if (state.direction === -1) {
          const currentPadding = parseFloat(col.style.paddingTop || 0);
          col.style.paddingTop = (currentPadding + h) + 'px';
        } else {
          state.scroll += h;
        }
      }
      card.remove();
    }
  });
}

function autoScroll() {
  if (!paused && allPosts.length > 0) {
    for (let i = 0; i < 3; i++) {
      colState[i].scroll += scrollSpeed * colState[i].mult;
      checkAndFeedColumn(i);
    }
  }
  requestAnimationFrame(autoScroll);
}

// ── Particles ──
function createParticles() {
  const container = document.getElementById('bgParticles');
  const colors = ['#ff2d78', '#9b59ff', '#00d4ff', '#ff6ba6', '#ffd700'];
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 4;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = (12 + Math.random() * 18) + 's';
    p.style.animationDelay = (Math.random() * 15) + 's';
    container.appendChild(p);
  }
}

// ── Keyboard controls ──
const pauseIndicator = document.getElementById('pauseIndicator');

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    pauseIndicator.classList.toggle('visible', paused);
  }
  if (e.code === 'ArrowUp') {
    scrollSpeed = Math.min(scrollSpeed + 0.2, 3);
  }
  if (e.code === 'ArrowDown') {
    scrollSpeed = Math.max(scrollSpeed - 0.2, 0.2);
  }
});

// ── Firebase real-time listener ──
const q = query(
  collection(db, POSTS),
  orderBy('createdAt', 'desc'),
  limit(200)
);

const scheduledPosts = new Map();

setInterval(() => {
  const now = Date.now();
  let hasNew = false;
  scheduledPosts.forEach((data, id) => {
    if (data.createdAt && data.createdAt.toMillis() <= now) {
      scheduledPosts.delete(id);
      postsMap.set(id, data);
      const _rc = data.reportedBy?.length || 0;
      const _mc = data.maintainedCount || 0;
      if (!(_rc >= 7 && _rc > _mc)) {
        newPostsQueue.push({ id, data });
        hasNew = true;
      }
    }
  });
  if (hasNew && !isOverlayActive) {
    processNewPostQueue();
  }
}, 10000);

onSnapshot(q, (snap) => {
  const newPostIds = [];
  const now = Date.now();

  snap.docChanges().forEach((change) => {
    const id = change.doc.id;
    const data = change.doc.data();
    const isFuture = data.createdAt && data.createdAt.toMillis() > Date.now();

    if (change.type === 'added') {
      if (isFuture) {
        scheduledPosts.set(id, data);
      } else {
        postsMap.set(id, data);
        if (!firstLoad) {
          newPostIds.push(id);
        }
      }
    } else if (change.type === 'modified') {
      if (isFuture) {
        scheduledPosts.set(id, data);
        if (postsMap.has(id)) {
          postsMap.delete(id);
          removeCardSmoothly(id);
        }
      } else {
        if (scheduledPosts.has(id)) {
          scheduledPosts.delete(id);
          postsMap.set(id, data);
          newPostIds.push(id);
        } else if (postsMap.has(id)) {
          postsMap.set(id, data);
          const existingCards = gridInner.querySelectorAll(`.board-card[data-id="${id}"]`);
          existingCards.forEach(card => {
            const likeCount = (data.likedBy || []).length;
            const replyCount = data.replyCount || 0;
            const likeStat = card.querySelector('.card-stat');
            if (likeStat) {
              likeStat.classList.toggle('has-likes', likeCount > 0);
              likeStat.querySelector('svg').setAttribute('fill', likeCount > 0 ? 'currentColor' : 'none');
              const statNumEl = likeStat.querySelector('.stat-num');
              const newText = likeCount.toString();
              if (statNumEl && statNumEl.textContent !== newText) {
                statNumEl.textContent = newText;
                likeStat.classList.add('pop');
                setTimeout(() => likeStat.classList.remove('pop'), 300);
              }
            }
            const replyStat = card.querySelectorAll('.card-stat')[1];
            if (replyStat) {
              const statNumEl = replyStat.querySelector('.stat-num');
              const newText = replyCount.toString();
              if (statNumEl && statNumEl.textContent !== newText) {
                statNumEl.textContent = newText;
                replyStat.classList.add('pop');
                setTimeout(() => replyStat.classList.remove('pop'), 300);
              }
            }
          });
        }
      }
    } else if (change.type === 'removed') {
      postsMap.delete(id);
      scheduledPosts.delete(id);
      removeCardSmoothly(id);
    }
  });

  allPosts = filterPosts(Array.from(postsMap.entries()));

  if (firstLoad) {
    firstLoad = false;
    loadingEl.classList.add('hidden');
    updateEmpty();

    if (allPosts.length > 0) {
      shuffledQueue = shuffle(allPosts);
      for (let i = 0; i < 3; i++) {
        const viewH = gridScroll.clientHeight || window.innerHeight;
        let h = 0;
        while(h < viewH + BUFFER_AHEAD_PX) {
          const post = getNextPost();
          if (!post) break;
          const card = buildCard(post[0], post[1]);
          columns[i].appendChild(card);
          h += getActualHeight(card) + 16;
        }
      }
    }
    requestAnimationFrame(autoScroll);
  } else {
    for (const id of newPostIds) {
      const data = postsMap.get(id);
      if (data) {
        const _rc = data.reportedBy?.length || 0;
        const _mc = data.maintainedCount || 0;
        if (_rc >= 7 && _rc > _mc) continue;
        newPostsQueue.push({ id, data });
      }
    }
    
    processNewPostQueue();
    updateEmpty();
  }
}, (err) => {
  console.error('Firestore listen error:', err);
  loadingEl.classList.add('hidden');
});

createParticles();

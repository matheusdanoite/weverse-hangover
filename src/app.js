// ═══════════════════════════════════════════
// HANGUL HANGOVER — Social Feed Logic
// ═══════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';
import {
  getFirestore, collection, collectionGroup, addDoc, doc, updateDoc, serverTimestamp,
  query, orderBy, limit, onSnapshot, arrayUnion, arrayRemove, increment,
  where, getDocs, deleteDoc, getDoc, setDoc
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';
import {
  gradientCSS, setGradientBg, escapeHTML,
  formatTime, buildPostCard, updatePostCard,
} from './shared.js';

// ── Firebase + moderator profiles (fetched from server — emails never in client JS) ──
const firebaseConfig = await fetch('/api/config').then(r => r.json());
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const POSTS = 'hangul_messages';
const USERS = 'hangul_usernames';

const MODERATORS = Object.fromEntries(
  (firebaseConfig.moderatorProfiles || []).map(p => [p.email, p])
);
const MOD_NAMES   = new Set(Object.values(MODERATORS).map(p => p.name));
const ADMIN_EMAILS = Object.keys(MODERATORS);
const GOOGLE_PROVIDER = new GoogleAuthProvider();

// ═══════════════════════════════════════════
// LOCAL STORAGE / USER STATE
// ═══════════════════════════════════════════
const LS = {
  USER: 'hangul.user',
  SEEN: 'hangul.seenPosts',
  BASE: 'hangul.notifsBase',
};

function uuid() {
  return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function loadUser() {
  try { return JSON.parse(localStorage.getItem(LS.USER)) || null; }
  catch { return null; }
}
function saveUser(u) { localStorage.setItem(LS.USER, JSON.stringify(u)); }

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(LS.SEEN)) || []); }
  catch { return new Set(); }
}
function saveSeen(set) {
  const arr = Array.from(set).slice(-500);
  localStorage.setItem(LS.SEEN, JSON.stringify(arr));
}

function loadBaseline() {
  try { return JSON.parse(localStorage.getItem(LS.BASE)) || {}; }
  catch { return {}; }
}
function saveBaseline(b) { localStorage.setItem(LS.BASE, JSON.stringify(b)); }

let me = loadUser();
const seenAtStart = loadSeen();
const seenThisSession = new Set();
let notifBaseline = loadBaseline();


// ═══════════════════════════════════════════
// TERMS MODAL
// ═══════════════════════════════════════════
const termsOverlay = document.getElementById('termsOverlay');
const termsClose = document.getElementById('termsClose');
const openTermsBtn = document.getElementById('openTermsBtn');
const termsCheck = document.getElementById('termsCheck');
const onboardSubmit = document.getElementById('onboardSubmit');

openTermsBtn.addEventListener('click', () => termsOverlay.classList.remove('hidden'));
termsClose.addEventListener('click', () => termsOverlay.classList.add('hidden'));
termsOverlay.addEventListener('click', (e) => {
  if (e.target === termsOverlay) termsOverlay.classList.add('hidden');
});

termsCheck.addEventListener('change', () => {
  onboardSubmit.disabled = !termsCheck.checked;
});

// ═══════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════
const PALETTE = [
  '#ff2d78','#9b59ff','#00d4ff','#ff6ba6','#ffb800',
  '#34e89e','#fc466b','#3f5efb','#f7971e','#ffd200',
  '#d926a9','#0f3443','#e040fb','#00bcd4','#ff5722',
];

function randomColor() {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function randomPair() {
  const a = randomColor();
  let b = randomColor();
  while (b === a) b = randomColor();
  return [a, b];
}

const onboardOverlay = document.getElementById('onboardingOverlay');
const onboardName = document.getElementById('onboardName');
const color1 = document.getElementById('color1');
const color2 = document.getElementById('color2');
const swatch1 = document.getElementById('swatch1');
const swatch2 = document.getElementById('swatch2');
const avatarPreview = document.getElementById('avatarPreview');

function updateAvatarPreview() {
  setGradientBg(avatarPreview, [color1.value, color2.value]);
  swatch1.style.background = color1.value;
  swatch2.style.background = color2.value;
}

color1.addEventListener('input', updateAvatarPreview);
color2.addEventListener('input', updateAvatarPreview);

function openOnboarding() {
  const [c1, c2] = randomPair();
  color1.value = c1;
  color2.value = c2;
  termsCheck.checked = false;
  onboardSubmit.disabled = true;
  updateAvatarPreview();
  onboardOverlay.classList.remove('hidden');
  setTimeout(() => onboardName.focus(), 150);
}

const nameError = document.getElementById('nameError');

onboardName.addEventListener('input', () => {
  const clean = onboardName.value.replace(/[^a-zA-Z0-9._]/g, '');
  if (clean !== onboardName.value) onboardName.value = clean;
  nameError.classList.add('hidden');
});

onboardSubmit.addEventListener('click', async () => {
  if (!termsCheck.checked) return;
  const name = onboardName.value.trim();
  if (!name) {
    onboardName.focus();
    onboardName.style.borderColor = 'var(--pink-neon)';
    onboardName.style.boxShadow = '0 0 0 3px var(--pink-glow)';
    setTimeout(() => { onboardName.style.borderColor = ''; onboardName.style.boxShadow = ''; }, 1500);
    return;
  }

  nameError.classList.add('hidden');
  onboardSubmit.disabled = true;
  onboardSubmit.textContent = 'verificando...';

  try {
    const normalized = name.toLowerCase();
    let taken = false;
    try {
      const snap = await getDoc(doc(db, USERS, normalized));
      taken = snap.exists();
    } catch {
      // Se não conseguir checar (permissão/rede), prossegue
    }

    if (taken) {
      nameError.classList.remove('hidden');
      onboardName.focus();
      return;
    }

    const id = uuid();
    const gradient = [color1.value, color2.value];
    me = { id, name, gradient };
    saveUser(me);

    try {
      await setDoc(doc(db, USERS, normalized), {
        userId: id,
        displayName: name,
        createdAt: serverTimestamp()
      });
    } catch {
      // Reserva falhou silenciosamente; conta local já foi criada
    }

    onboardOverlay.classList.add('hidden');
    paintUserUI();
    updateReplyCcomposersGradient();
  } finally {
    onboardSubmit.disabled = !termsCheck.checked;
    onboardSubmit.textContent = 'entrar ✦';
  }
});

function paintUserUI() {
  if (!me) return;
  setGradientBg(document.getElementById('miniAvatar'), me.gradient);
  setGradientBg(document.getElementById('composerAvatar'), me.gradient);
}

if (!me) openOnboarding();
else paintUserUI();

// ── Admin auth ──
onAuthStateChanged(auth, async (user) => {
  if (user && MODERATORS[user.email]) {
    const profile = MODERATORS[user.email];
    me = { ...profile };
    saveUser(me);
    onboardOverlay.classList.add('hidden');
    paintUserUI();
    updateReplyCcomposersGradient();
    try {
      await setDoc(doc(db, USERS, profile.name), {
        userId: profile.id,
        displayName: profile.name,
        createdAt: serverTimestamp()
      });
    } catch {}
  } else if (!user && Object.values(MODERATORS).some(p => p.id === me?.id)) {
    Object.values(LS).forEach(k => localStorage.removeItem(k));
    me = null;
    location.reload();
  }
});

// Gatilho secreto: 5 toques na marca (topbar ou onboarding)
let _adminTaps = 0;
let _adminTapTimer;
function _handleAdminTap() {
  _adminTaps++;
  clearTimeout(_adminTapTimer);
  _adminTapTimer = setTimeout(() => { _adminTaps = 0; }, 1500);
  if (_adminTaps >= 5) {
    _adminTaps = 0;
    if (auth.currentUser) signOut(auth);
    else signInWithPopup(auth, GOOGLE_PROVIDER).catch(() => {});
  }
}
document.querySelector('.brand').addEventListener('click', _handleAdminTap);
document.querySelector('.onboarding-header').addEventListener('click', _handleAdminTap);

// ═══════════════════════════════════════════
// PROFILE MODAL
// ═══════════════════════════════════════════
const profileOverlay = document.getElementById('profileOverlay');
const profileModalClose = document.getElementById('profileModalClose');
const profileAvatar = document.getElementById('profileAvatar');
const profileNameDisplay = document.getElementById('profileNameDisplay');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const deleteDataBtn = document.getElementById('deleteDataBtn');

document.getElementById('profileBtn').addEventListener('click', openProfileModal);
profileModalClose.addEventListener('click', () => profileOverlay.classList.add('hidden'));
profileOverlay.addEventListener('click', (e) => {
  if (e.target === profileOverlay) profileOverlay.classList.add('hidden');
});

function openProfileModal() {
  if (!me) { openOnboarding(); return; }
  setGradientBg(profileAvatar, me.gradient);
  profileNameDisplay.textContent = me.name;
  profileOverlay.classList.remove('hidden');
}

downloadPdfBtn.addEventListener('click', async () => {
  if (!me) return;
  profileOverlay.classList.add('hidden');
  await downloadMyPostsAsPDF();
});

deleteDataBtn.addEventListener('click', async () => {
  if (!me) return;
  const confirmed = confirm(
    `Deletar todos os seus dados?\n\nIsso remove permanentemente todos os seus posts da Hangul Hangover.\n\nEsta ação não pode ser desfeita.`
  );
  if (!confirmed) return;
  profileOverlay.classList.add('hidden');
  await deleteUserData();
});

async function downloadMyPostsAsPDF() {
  const myPosts = [];
  postsMap.forEach((data, id) => {
    if (data.authorId === me?.id) myPosts.push({ id, ...data });
  });

  if (myPosts.length === 0) {
    showToast('você ainda não tem posts');
    return;
  }

  myPosts.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

  let postsHTML = '';
  for (const post of myPosts) {
    const time = post.createdAt
      ? new Date(post.createdAt.seconds * 1000).toLocaleString('pt-BR')
      : '';
    postsHTML += `<div class="post">
      <div class="time">${time}</div>`;
    if (post.type === 'drawing') {
      postsHTML += `<img src="${post.message}" alt="desenho" />`;
    } else {
      postsHTML += `<div class="content">${escapeHTML(post.message).replace(/\n/g, '<br>')}</div>`;
    }
    postsHTML += `</div>`;
  }

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<title>Meus posts — Hangul Hangover</title>
<style>
  body{font-family:sans-serif;padding:24px;max-width:540px;margin:0 auto;color:#111;}
  h1{font-size:22px;margin-bottom:4px;}
  .sub{color:#666;font-size:13px;margin-bottom:24px;}
  .post{border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:14px;break-inside:avoid;}
  .time{color:#999;font-size:11px;margin-bottom:6px;}
  .content{white-space:pre-wrap;font-size:15px;line-height:1.5;}
  img{max-width:180px;border-radius:6px;display:block;margin-top:6px;}
  @media print{body{padding:0;}}
</style></head><body>
<h1>Meus posts na Hangul Hangover</h1>
<div class="sub">${escapeHTML(me.name)} · ${new Date().toLocaleDateString('pt-BR')}</div>
${postsHTML}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('permita pop-ups para baixar'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

async function deleteUserData() {
  showToast('deletando dados...');
  try {
    const postsQ = query(collection(db, POSTS), where('authorId', '==', me.id));
    const repliesQ = query(collectionGroup(db, 'replies'), where('authorId', '==', me.id));
    const [postsSnap, repliesSnap] = await Promise.all([getDocs(postsQ), getDocs(repliesQ)]);
    await Promise.all([
      ...postsSnap.docs.map(d => deleteDoc(d.ref)),
      ...repliesSnap.docs.map(d => deleteDoc(d.ref)),
    ]);
    try { await deleteDoc(doc(db, USERS, me.name.toLowerCase())); } catch {}
    Object.values(LS).forEach(k => localStorage.removeItem(k));
    showToast('dados deletados!');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    console.error('delete error', err);
    showToast('erro ao deletar. tente via @hangul.hangover');
  }
}

// ═══════════════════════════════════════════
// COMPOSER
// ═══════════════════════════════════════════
const composerPill = document.getElementById('composerPill');
const composerExpandedPanel = document.getElementById('composerExpandedPanel');
const pillInput = document.getElementById('pillInput');
const messageField = document.getElementById('messageField');
const charCount = document.getElementById('charCount');
const charCountWrapper = document.getElementById('charCountWrapper');
const submitBtn = document.getElementById('submitBtn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoading = submitBtn.querySelector('.btn-loading');
const toggleDraw = document.getElementById('toggleDraw');
const toggleIconWrap = document.getElementById('toggleIconWrap');
const drawSection = document.getElementById('drawSection');
const drawCanvas = document.getElementById('drawCanvas');
const brushColorInput = document.getElementById('brushColor');
const colorPreview = document.getElementById('colorPreview');
const clearCanvasBtn = document.getElementById('clearCanvas');
const drawControls = document.getElementById('drawControls');

const CANVAS_W = 600;
const CANVAS_H = 800;

let inputMode = 'text';
let brushColor = '#ff2d78';
const brushRadius = 5; // medium only
let isDrawing = false;
let lastX = 0, lastY = 0;

const ctx = drawCanvas.getContext('2d');
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

// SVG icons
const SVG_BRUSH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/><path d="M14.5 17.5 4.5 15"/></svg>`;
const SVG_TEXT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`;

function updateToggleIcon() {
  if (inputMode === 'text') {
    toggleIconWrap.innerHTML = SVG_BRUSH;
  } else {
    toggleIconWrap.innerHTML = SVG_TEXT;
  }
}
updateToggleIcon();

function getCanvasPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const sx = CANVAS_W / rect.width;
  const sy = CANVAS_H / rect.height;
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
}

function startDraw(e) {
  e.preventDefault();
  isDrawing = true;
  const p = getCanvasPos(e);
  lastX = p.x; lastY = p.y;
  ctx.beginPath();
  ctx.arc(lastX, lastY, brushRadius, 0, Math.PI * 2);
  ctx.fillStyle = brushColor;
  ctx.fill();
}

function draw(e) {
  e.preventDefault();
  if (!isDrawing) return;
  const p = getCanvasPos(e);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = brushColor;
  ctx.lineWidth = brushRadius * 2;
  ctx.stroke();
  lastX = p.x; lastY = p.y;
}

function stopDraw() { isDrawing = false; }

drawCanvas.addEventListener('mousedown', startDraw);
drawCanvas.addEventListener('mousemove', draw);
drawCanvas.addEventListener('mouseup', stopDraw);
drawCanvas.addEventListener('mouseleave', stopDraw);
drawCanvas.addEventListener('touchstart', startDraw, { passive: false });
drawCanvas.addEventListener('touchmove', draw, { passive: false });
drawCanvas.addEventListener('touchend', stopDraw);

brushColorInput.addEventListener('input', (e) => {
  brushColor = e.target.value;
  colorPreview.style.background = brushColor;
});

clearCanvasBtn.addEventListener('click', () => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
});

toggleDraw.addEventListener('click', () => {
  if (inputMode === 'text') {
    inputMode = 'draw';
    toggleDraw.classList.add('active');
    drawSection.classList.remove('hidden');
    messageField.classList.add('hidden');
    charCountWrapper.classList.add('hidden');
    drawControls.classList.remove('hidden');
    expandComposer();
  } else {
    inputMode = 'text';
    toggleDraw.classList.remove('active');
    drawSection.classList.add('hidden');
    messageField.classList.remove('hidden');
    charCountWrapper.classList.remove('hidden');
    drawControls.classList.add('hidden');
  }
  updateToggleIcon();
  updateSubmitDisabled();
});

// ── Pill expand / collapse ──
function expandComposer() {
  composerPill.classList.add('active');
  composerExpandedPanel.style.display = 'block';
}

function collapseComposer() {
  if (inputMode !== 'text') return;
  if (pillInput.value.trim() || messageField.value.trim()) return;
  composerPill.classList.remove('active');
  composerExpandedPanel.style.display = 'none';
}

pillInput.addEventListener('focus', expandComposer);

pillInput.addEventListener('input', () => {
  messageField.value = pillInput.value;
  messageField.style.height = 'auto';
  messageField.style.height = messageField.scrollHeight + 'px';
  const len = pillInput.value.length;
  charCount.textContent = len;
  charCountWrapper.classList.toggle('over', len > 300);
  updateSubmitDisabled();
});

// Auto-resize textarea + sync back to pill
messageField.addEventListener('input', () => {
  pillInput.value = messageField.value.split('\n')[0].slice(0, 60);
  messageField.style.height = 'auto';
  messageField.style.height = messageField.scrollHeight + 'px';
  const len = messageField.value.length;
  charCount.textContent = len;
  charCountWrapper.classList.toggle('over', len > 300);
  updateSubmitDisabled();
});

document.addEventListener('click', e => {
  if (composerPill.contains(e.target) || composerExpandedPanel.contains(e.target)) return;
  collapseComposer();
});

function updateSubmitDisabled() {
  if (inputMode === 'text') {
    submitBtn.disabled = messageField.value.trim().length === 0;
  } else {
    submitBtn.disabled = false;
  }
}
updateSubmitDisabled();

submitBtn.addEventListener('click', handleSubmit);

async function handleSubmit() {
  if (!me) { openOnboarding(); return; }
  const text = messageField.value.trim();
  if (inputMode === 'text' && !text) return;

  submitBtn.disabled = true;
  btnText.classList.add('hidden');
  btnLoading.classList.remove('hidden');

  try {
    let message;
    if (inputMode === 'text') {
      message = text;
    } else {
      message = drawCanvas.toDataURL('image/jpeg', 0.7);
      if (message.length > 200_000) {
        showToast('desenho muito grande, simplifique um pouco');
        return;
      }
    }

    const docData = {
      type: inputMode === 'text' ? 'text' : 'drawing',
      message,
      author: me.name,
      authorId: me.id,
      gradient: me.gradient,
      likedBy: [],
      replyCount: 0,
      createdAt: serverTimestamp()
    };
    await addDoc(collection(db, POSTS), docData);

    messageField.value = '';
    pillInput.value = '';
    messageField.style.height = 'auto';
    charCount.textContent = '0';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (inputMode === 'draw') toggleDraw.click();

    showToast('postado!');
  } catch (err) {
    console.error(err);
    showToast('erro ao postar');
  } finally {
    submitBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
    updateSubmitDisabled();
  }
}

// ═══════════════════════════════════════════
// FEED RENDERING
// ═══════════════════════════════════════════
const feed = document.getElementById('feed');
const emptyFeed = document.getElementById('emptyFeed');

let activeTab = 'all';

function getPostsForTab(tab) {
  const all = [];
  for (const [id, data] of postsMap.entries()) {
    const _rc = data.reportedBy?.length || 0;
    const _mc = data.maintainedCount || 0;
    if (_rc >= 3 && _rc > _mc) continue;
    all.push([id, data]);
  }
  const cmp = (a, b) => (b[1].createdAt?.seconds || 0) - (a[1].createdAt?.seconds || 0);
  switch (tab) {
    case 'texts':    return all.filter(([, d]) => d.type !== 'drawing').sort(cmp);
    case 'drawings': return all.filter(([, d]) => d.type === 'drawing').sort(cmp);
    case 'top':      return all.slice().sort((a, b) => (b[1].likedBy?.length || 0) - (a[1].likedBy?.length || 0)).slice(0, 10);
    case 'mods':     return all.filter(([, d]) => MOD_NAMES.has(d.author)).sort(cmp);
    default:         return all.sort(cmp);
  }
}

function updateTabCounts() {
  const all = [];
  for (const [, data] of postsMap.entries()) {
    const _rc = data.reportedBy?.length || 0;
    const _mc = data.maintainedCount || 0;
    if (_rc >= 3 && _rc > _mc) continue;
    all.push(data);
  }
  const cntAll      = document.getElementById('cnt-all');
  const cntTexts    = document.getElementById('cnt-texts');
  const cntDrawings = document.getElementById('cnt-drawings');
  const cntMods     = document.getElementById('cnt-mods');
  if (cntAll)      cntAll.textContent      = all.length;
  if (cntTexts)    cntTexts.textContent    = all.filter(d => d.type !== 'drawing').length;
  if (cntDrawings) cntDrawings.textContent = all.filter(d => d.type === 'drawing').length;
  if (cntMods)     cntMods.textContent     = all.filter(d => MOD_NAMES.has(d.author)).length;
}

// ── Feed Tabs ──
const feedTabs = document.getElementById('feedTabs');

function moveIndicator(btn) {
  if (!btn || !feedTabs) return;
  const rect     = btn.getBoundingClientRect();
  const hostRect = feedTabs.getBoundingClientRect();
  feedTabs.style.setProperty('--ind-x', (rect.left - hostRect.left + feedTabs.scrollLeft) + 'px');
  feedTabs.style.setProperty('--ind-w', rect.width + 'px');
}

feedTabs.addEventListener('click', e => {
  const btn = e.target.closest('.feed-tab');
  if (!btn) return;
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  activeTab = btn.dataset.tab;
  moveIndicator(btn);
  btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  renderFeed();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('resize', () => {
  const active = document.querySelector('.feed-tab.active');
  if (active) moveIndicator(active);
});

requestAnimationFrame(() => {
  const active = document.querySelector('.feed-tab.active');
  if (active) moveIndicator(active);
});

const cardElements = new Map();
const replySubs = new Map();

// IntersectionObserver: mark as "seen" after 1.5s in view
const seenObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.dataset.id;
      if (!id) return;
      const timeout = setTimeout(() => {
        if (entry.target.isConnected) markSeen(id);
      }, 1500);
      entry.target._seenTimeout = timeout;
    } else {
      if (entry.target._seenTimeout) {
        clearTimeout(entry.target._seenTimeout);
        entry.target._seenTimeout = null;
      }
    }
  });
}, { threshold: 0.6 });

// IntersectionObserver: lazy-load reply subscriptions
const replySubObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const postEl = entry.target;
      const id = postEl.dataset.id;
      if (id && !replySubs.has(id)) {
        initReplySection(id, postEl);
      }
    }
  });
}, { rootMargin: '120px', threshold: 0 });

function markSeen(id) {
  if (seenThisSession.has(id) || seenAtStart.has(id)) return;
  seenThisSession.add(id);
  saveSeen(new Set([...seenAtStart, ...seenThisSession]));
}


function buildPostElement(id, data) {
  const el = buildPostCard(id, data, {
    me,
    modNames: MOD_NAMES,
    onLike: toggleLike,
    onReplyClick: (el) => initReplySection(id, el),
    onSelfDelete: (id, el) => selfDeletePost(id, el),
    onReport: (id, data) => reportPost(id, data),
  });
  seenObserver.observe(el);
  replySubObserver.observe(el);
  return el;
}

async function selfDeletePost(id, el) {
  if (!confirm('Apagar seu post permanentemente?')) return;
  el.classList.add('deleting');
  try {
    await deleteDoc(doc(db, POSTS, id));
  } catch (err) {
    el.classList.remove('deleting');
    showToast('erro ao apagar post');
  }
}

async function reportPost(id, data) {
  if (!me) return openOnboarding();
  const current = postsMap.get(id) ?? pendingNewPosts.get(id) ?? data;
  if ((current.reportedBy || []).includes(me.id)) {
    showToast('você já reportou este post');
    return;
  }
  try {
    await updateDoc(doc(db, POSTS, id), { reportedBy: arrayUnion(me.id) });
    showToast('post reportado');
    // Notify moderators
    fetch('/api/notify_mods', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': firebaseConfig.internalKey || '',
      },
      body: JSON.stringify({ postId: id, text: `"${(current.message || '').slice(0, 30)}..." foi denunciado.` })
    }).catch(console.error);
  } catch (err) {
    showToast('erro ao reportar');
  }
}

function updatePostElement(el, id, data) {
  updatePostCard(el, data, me);
}

async function toggleLike(id, data) {
  if (!me) return openOnboarding();
  const ref = doc(db, POSTS, id);
  const liked = (data.likedBy || []).includes(me.id);
  try {
    await updateDoc(ref, { likedBy: liked ? arrayRemove(me.id) : arrayUnion(me.id) });
  } catch (err) {
    console.error('like error', err);
  }
}

// ═══════════════════════════════════════════
// INLINE REPLIES (thread)
// ═══════════════════════════════════════════
function initReplySection(id, postEl) {
  if (replySubs.has(id)) return;
  const section = postEl.querySelector('.replies-section');
  if (!section) return;

  const grad = me ? gradientCSS(me.gradient) : gradientCSS(['#ff2d78', '#9b59ff']);

  section.innerHTML = `
    <div class="reply-thread" id="thread_${id}"></div>
    <div class="reply-composer">
      <div class="avatar avatar-sm reply-avatar" style="background-image:${grad};background-size:130% 130%;background-position:center center"></div>
      <input class="reply-input" type="text" placeholder="responder..." maxlength="200" autocomplete="off" />
      <button class="reply-send" type="button" disabled>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  `;

  const input = section.querySelector('.reply-input');
  const sendBtn = section.querySelector('.reply-send');

  input.addEventListener('input', () => {
    sendBtn.disabled = input.value.trim().length === 0;
  });

  const submit = async () => {
    const txt = input.value.trim();
    if (!txt || !me) return;
    sendBtn.disabled = true;
    // Pré-incrementa baseline para que resposta ao próprio post não gere notificação
    const isSelfReply = postsMap.get(id)?.authorId === me.id;
    if (isSelfReply) {
      if (!notifBaseline[id]) notifBaseline[id] = { likes: 0, replies: 0 };
      notifBaseline[id].replies += 1;
      saveBaseline(notifBaseline);
    }
    try {
      await addDoc(collection(db, POSTS, id, 'replies'), {
        message: txt,
        author: me.name,
        authorId: me.id,
        gradient: me.gradient,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, POSTS, id), { replyCount: increment(1) });
      input.value = '';
    } catch (err) {
      console.error('reply error', err);
      if (isSelfReply) {
        notifBaseline[id].replies = Math.max(0, notifBaseline[id].replies - 1);
        saveBaseline(notifBaseline);
      }
    } finally {
      sendBtn.disabled = true;
    }
  };

  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  const q = query(collection(db, POSTS, id, 'replies'), orderBy('createdAt', 'asc'), limit(50));
  const unsub = onSnapshot(q, (snap) => renderReplyThread(id, snap));
  replySubs.set(id, unsub);
}

function renderReplyThread(id, snap) {
  const thread = document.getElementById(`thread_${id}`);
  if (!thread) return;
  thread.innerHTML = '';
  snap.forEach(d => {
    const r = d.data();
    const grad = r.gradient?.length === 2 ? gradientCSS(r.gradient) : gradientCSS(['#ff2d78', '#9b59ff']);
    const item = document.createElement('div');
    item.className = 'thread-item';
    item.innerHTML = `
      <div class="avatar avatar-sm" style="background-image:${grad};background-size:130% 130%;background-position:center center"></div>
      <div class="reply-body">
        <div class="reply-header">
          <span class="reply-author">${escapeHTML(r.author || 'anônimo')}</span>
          ${MOD_NAMES.has(r.author) ? '<span class="mod-star mod-star-sm">★</span>' : ''}
          <span class="reply-time">${formatTime(r.createdAt)}</span>
        </div>
        <div class="reply-content">${escapeHTML(r.message)}</div>
      </div>
    `;
    thread.appendChild(item);
  });
}

function updateReplyCcomposersGradient() {
  if (!me) return;
  document.querySelectorAll('.reply-avatar').forEach(el => {
    setGradientBg(el, me.gradient);
  });
}

// ═══════════════════════════════════════════
// MAIN POSTS LISTENER (with pending buffer)
// ═══════════════════════════════════════════
const postsMap = new Map();
const pendingNewPosts = new Map();
let initialLoadDone = false;

const postsQ = query(collection(db, POSTS), orderBy('createdAt', 'desc'), limit(150));

onSnapshot(postsQ, (snapshot) => {
  if (snapshot.empty) {
    feed.innerHTML = '';
    emptyFeed.classList.remove('hidden');
    return;
  }
  emptyFeed.classList.add('hidden');

  if (!initialLoadDone) {
    snapshot.forEach(d => postsMap.set(d.id, d.data()));
    initialLoadDone = true;
    renderFeed();
    updateNotifications();
    return;
  }

  // Process changes incrementally
  let hasNewFromOthers = false;
  snapshot.docChanges().forEach(change => {
    const id = change.doc.id;
    const data = change.doc.data();

    if (change.type === 'added') {
      if (data.authorId === me?.id) {
        // Own post: show immediately
        postsMap.set(id, data);
      } else {
        // Other user's post: buffer
        pendingNewPosts.set(id, data);
        hasNewFromOthers = true;
      }
    } else if (change.type === 'modified') {
      if (postsMap.has(id)) postsMap.set(id, data);
      if (pendingNewPosts.has(id)) pendingNewPosts.set(id, data);
    } else if (change.type === 'removed') {
      postsMap.delete(id);
      pendingNewPosts.delete(id);
    }
  });

  if (hasNewFromOthers) {
    showUpdateButton();
  }

  renderFeed();
  updateNotifications();
});

// ── Floating update button ──
const updateFeedBtn = document.getElementById('updateFeedBtn');
const updateCount = document.getElementById('updateCount');

function showUpdateButton() {
  updateCount.textContent = pendingNewPosts.size;
  updateFeedBtn.classList.remove('hidden');
}

function hideUpdateButton() {
  updateFeedBtn.classList.add('hidden');
}

updateFeedBtn.addEventListener('click', () => {
  pendingNewPosts.forEach((data, id) => postsMap.set(id, data));
  pendingNewPosts.clear();
  hideUpdateButton();
  renderFeed();
});

function renderFeed() {
  const posts = getPostsForTab(activeTab);
  updateTabCounts();

  // Rank strip (only for Trending)
  let rankStrip = feed.querySelector('.rank-strip');
  if (activeTab === 'top') {
    if (!rankStrip) {
      rankStrip = document.createElement('div');
      rankStrip.className = 'rank-strip';
      rankStrip.textContent = 'posts mais curtidos da noite';
      feed.insertBefore(rankStrip, feed.firstChild);
    }
  } else {
    rankStrip?.remove();
  }

  if (posts.length === 0) {
    feed.querySelectorAll('[data-id]').forEach(el => {
      seenObserver.unobserve(el);
      replySubObserver.unobserve(el);
      const id = el.dataset.id;
      if (replySubs.has(id)) { replySubs.get(id)(); replySubs.delete(id); }
      cardElements.delete(id);
      el.remove();
    });
    if (!feed.querySelector('.tab-empty')) {
      const empty = document.createElement('div');
      empty.className = 'tab-empty';
      empty.innerHTML = '<span class="icon">✦</span><p>nada por aqui ainda.</p>';
      feed.appendChild(empty);
    }
    return;
  }

  feed.querySelector('.tab-empty')?.remove();
  renderInto(feed, posts);

  // Rank badges
  feed.querySelectorAll('.post[data-id]').forEach((el, i) => {
    if (activeTab === 'top') {
      el.classList.add('post-rank');
      el.dataset.rank = '#' + (i + 1);
    } else {
      el.classList.remove('post-rank');
      el.removeAttribute('data-rank');
    }
  });
}

function renderInto(container, list) {
  const desiredIds = list.map(([id]) => id);
  // Only operate on elements that represent posts (have data-id)
  Array.from(container.querySelectorAll('[data-id]')).forEach(child => {
    if (!desiredIds.includes(child.dataset.id)) {
      seenObserver.unobserve(child);
      replySubObserver.unobserve(child);
      const id = child.dataset.id;
      if (replySubs.has(id)) { replySubs.get(id)(); replySubs.delete(id); }
      child.remove();
      cardElements.delete(id);
    }
  });
  list.forEach(([id, data], idx) => {
    let existing = container.querySelector(`[data-id="${id}"]`);
    if (!existing) {
      existing = buildPostElement(id, data);
      cardElements.set(id, existing);
    } else {
      updatePostElement(existing, id, data);
    }
    // Position among data-id siblings only
    const postsInContainer = Array.from(container.querySelectorAll('[data-id]'));
    const current = postsInContainer[idx];
    if (current !== existing) container.insertBefore(existing, current || null);
  });
}

// Refresh relative timestamps — only for cards visible in the viewport
setInterval(() => {
  if (document.visibilityState === 'hidden') return;
  const vh = window.innerHeight;
  cardElements.forEach((el, id) => {
    if (!el.isConnected) return;
    const { top, bottom } = el.getBoundingClientRect();
    if (bottom < 0 || top > vh) return;
    const data = postsMap.get(id);
    if (data) updatePostCard(el, data, me);
  });
}, 30000);

// ═══════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════
const notifBtn = document.getElementById('notifBtn');
const notifBadge = document.getElementById('notifBadge');
const notifDrawer = document.getElementById('notifDrawer');
const notifClose = document.getElementById('notifClose');
const notifList = document.getElementById('notifList');
const drawerBackdrop = document.getElementById('drawerBackdrop');

function ownPosts() {
  const out = [];
  postsMap.forEach((data, id) => {
    if (data.authorId === me?.id) out.push([id, data]);
  });
  return out;
}

function othersLikes(data) {
  return (data.likedBy || []).filter(uid => uid !== me?.id).length;
}

function updateNotifications() {
  if (!me) { notifBadge.classList.add('hidden'); return; }
  let unread = 0;
  ownPosts().forEach(([id, data]) => {
    const base = notifBaseline[id] || { likes: 0, replies: 0 };
    const likes = othersLikes(data);
    const replies = data.replyCount || 0;
    if (likes > base.likes || replies > base.replies) unread++;
  });
  if (unread > 0) {
    notifBadge.textContent = unread;
    notifBadge.classList.remove('hidden');
  } else {
    notifBadge.classList.add('hidden');
  }
}

function openNotifDrawer() {
  renderNotifList();
  notifDrawer.classList.remove('hidden');
  drawerBackdrop.classList.remove('hidden');
}

function closeNotifDrawer() {
  notifDrawer.classList.add('hidden');
  drawerBackdrop.classList.add('hidden');
  ownPosts().forEach(([id, data]) => {
    notifBaseline[id] = {
      likes: othersLikes(data),
      replies: data.replyCount || 0
    };
  });
  saveBaseline(notifBaseline);
  updateNotifications();
}

function renderNotifList() {
  notifList.innerHTML = '';
  const own = ownPosts();
  const items = [];
  own.forEach(([id, data]) => {
    const base = notifBaseline[id] || { likes: 0, replies: 0 };
    const likes = othersLikes(data);
    const replies = data.replyCount || 0;
    const dLikes = likes - base.likes;
    const dReplies = replies - base.replies;
    const hasNew = dLikes > 0 || dReplies > 0;
    if (!likes && !replies) return;
    items.push({ id, data, likes, replies, dLikes, dReplies, hasNew });
  });
  items.sort((a, b) => {
    if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1;
    return (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0);
  });

  if (items.length === 0) {
    notifList.innerHTML = '<div class="notif-empty">meio vazio aqui...<br></div>';
    return;
  }

  items.forEach(({ id, data, likes, replies, dLikes, dReplies, hasNew }) => {
    const preview = data.type === 'drawing'
      ? '[desenho]'
      : (data.message || '').slice(0, 60) + ((data.message || '').length > 60 ? '…' : '');
    const wrap = document.createElement('div');
    wrap.className = 'notif-item' + (hasNew ? ' unread' : '');
    let lines = '';
    const heartFilled = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const heartEmpty = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const chatIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;

    if (dLikes > 0) lines += `<div class="notif-line">${heartFilled} +${dLikes} ${dLikes === 1 ? 'curtida nova' : 'curtidas novas'} (total ${likes})</div>`;
    else if (likes > 0) lines += `<div class="notif-line" style="color:var(--text-secondary)">${heartEmpty} ${likes} ${likes === 1 ? 'curtida' : 'curtidas'}</div>`;
    if (dReplies > 0) lines += `<div class="notif-line">${chatIcon} +${dReplies} ${dReplies === 1 ? 'resposta nova' : 'respostas novas'} (total ${replies})</div>`;
    else if (replies > 0) lines += `<div class="notif-line" style="color:var(--text-secondary)">${chatIcon} ${replies} ${replies === 1 ? 'resposta' : 'respostas'}</div>`;

    wrap.innerHTML = `${lines}<div class="notif-context">"${escapeHTML(preview)}"</div>`;
    wrap.addEventListener('click', () => {
      closeNotifDrawer();
      const el = document.querySelector(`.post[data-id="${id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          const input = el.querySelector('.reply-input');
          if (input) input.focus();
        }, 400);
      }
    });
    notifList.appendChild(wrap);
  });
}

notifBtn.addEventListener('click', openNotifDrawer);
notifClose.addEventListener('click', closeNotifDrawer);
drawerBackdrop.addEventListener('click', closeNotifDrawer);

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
const successToast = document.getElementById('successToast');
let toastTimeout;
function showToast(text) {
  successToast.querySelector('.toast-text').textContent = text;
  clearTimeout(toastTimeout);
  successToast.classList.add('show');
  toastTimeout = setTimeout(() => successToast.classList.remove('show'), 2400);
}

// ═══════════════════════════════════════════
// BACKGROUND PARTICLES
// ═══════════════════════════════════════════
(function particles() {
  const container = document.getElementById('bgParticles');
  const colors = ['#ff2d78', '#9b59ff', '#00d4ff', '#ff6ba6', '#d926a9'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.classList.add('particle');
    const size = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `width:${size}px;height:${size}px;background:${color};left:${Math.random() * 100}%;animation-duration:${Math.random() * 15 + 12}s;animation-delay:${Math.random() * 15}s;box-shadow:0 0 ${size * 3}px ${color}40;`;
    container.appendChild(p);
  }
})();

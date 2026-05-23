import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, Timestamp, query, orderBy, onSnapshot, limit, increment,
  getDoc, getDocs, where, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';
import { getMessaging, getToken } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging.js';
import {
  gradientCSS, escapeHTML, formatTimeAbs,
  buildPostCard, openLightbox,
} from '../src/shared.js';

const firebaseConfig = await fetch('/api/config').then(r => r.json());
const MOD_NAMES = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.name));
const MOD_IDS   = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.id));

const POSTS = 'hangul_messages';
const BANS  = 'hangul_bans';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── DOM ──
const loginScreen        = document.getElementById('loginScreen');
const adminShell         = document.getElementById('adminShell');
const loadingScreen      = document.getElementById('loadingScreen');
const loginBtn           = document.getElementById('loginBtn');
const enablePushBtn      = document.getElementById('enablePushBtn');
const searchToggleBtn    = document.getElementById('searchToggleBtn');
const searchBar          = document.getElementById('searchBar');
const searchInput        = document.getElementById('searchInput');
const reportsList        = document.getElementById('reportsList');
const reportsSectionLabel = document.getElementById('reportsSectionLabel');
const postsCountTools    = document.getElementById('postsCountTools');
const composeAvatarInput = document.getElementById('composeAvatarInput');
const composeAvatarBtn   = document.getElementById('composeAvatarBtn');
const composeAvatar      = document.getElementById('composeAvatar');
const composeCustomName  = document.getElementById('composeCustomName');
const composeCustomTime  = document.getElementById('composeCustomTime');
const composeText        = document.getElementById('composeText');
const composeCount       = document.getElementById('composeCount');
const composeBtn         = document.getElementById('composeBtn');
const toastEl            = document.getElementById('toast');
const confirmOverlay     = document.getElementById('confirmOverlay');
const confirmTitle       = document.getElementById('confirmTitle');
const confirmDesc        = document.getElementById('confirmDesc');
const confirmCancel      = document.getElementById('confirmCancel');
const confirmOk          = document.getElementById('confirmOk');
const maintainOverlay    = document.getElementById('maintainOverlay');
const maintainDesc       = document.getElementById('maintainDesc');
const maintainNoteWrap   = document.getElementById('maintainNoteWrap');
const maintainNoteInput  = document.getElementById('maintainNoteInput');
const maintainCancel     = document.getElementById('maintainCancel');
const maintainOk         = document.getElementById('maintainOk');
const tabReports          = document.getElementById('tabReports');
const tabIdols            = document.getElementById('tabIdols');
const idolsList           = document.getElementById('idolsList');
const profileSelector     = document.getElementById('profileSelector');
const profileSelectorList = document.getElementById('profileSelectorList');
const editModalOverlay    = document.getElementById('editModalOverlay');
const editModalText       = document.getElementById('editModalText');
const editModalTime       = document.getElementById('editModalTime');
const editModalCancel     = document.getElementById('editModalCancel');
const editModalSave       = document.getElementById('editModalSave');

let allPosts            = [];
let modProfile          = null;
let pendingConfirm      = null;
let pendingMaintain     = null;
let toastTimer          = null;
let unsubscribePosts    = null;
let composeAvatarPhotoData = null;
let activeTab           = 'reports';
let idolProfiles        = [];
let selectedIdolProfile = null;
let pendingEdit         = null;
let idolReplyUnsubs     = {};

function getDeviceId() {
  let id = localStorage.getItem('hangul.adm.deviceId');
  if (!id) {
    id = crypto.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('hangul.adm.deviceId', id);
  }
  return id;
}

// ── Toast ──
function showToast(text, type = '') {
  toastEl.textContent = text;
  toastEl.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ── Confirm (delete) ──
function openConfirm(title, desc, onOk) {
  confirmTitle.textContent = title;
  confirmDesc.textContent  = desc;
  confirmOverlay.classList.remove('hidden');
  pendingConfirm = onOk;
}
confirmCancel.addEventListener('click', () => {
  confirmOverlay.classList.add('hidden');
  pendingConfirm = null;
});
confirmOk.addEventListener('click', () => {
  confirmOverlay.classList.add('hidden');
  if (pendingConfirm) { pendingConfirm(); pendingConfirm = null; }
});

// ── Manter dialog ──
function openMaintainDialog(post, onOk) {
  const count = post.reportedBy?.length || 0;
  const needsNote = count >= 7;
  maintainDesc.textContent = `Post de @${post.author || 'anônimo'} com ${count} denúncia${count !== 1 ? 's' : ''}. O post voltará a ser visível para todos.`;
  maintainNoteWrap.classList.toggle('hidden', !needsNote);
  maintainNoteInput.value = '';
  maintainOk.disabled = needsNote;
  maintainOverlay.classList.remove('hidden');
  pendingMaintain = { post, onOk, needsNote };
  if (needsNote) setTimeout(() => maintainNoteInput.focus(), 100);
}

maintainNoteInput.addEventListener('input', () => {
  if (pendingMaintain?.needsNote) {
    maintainOk.disabled = maintainNoteInput.value.trim().length === 0;
  }
});

maintainCancel.addEventListener('click', () => {
  maintainOverlay.classList.add('hidden');
  pendingMaintain = null;
});

maintainOk.addEventListener('click', () => {
  if (!pendingMaintain) return;
  if (pendingMaintain.needsNote && !maintainNoteInput.value.trim()) return;
  const note = maintainNoteInput.value.trim();
  const { post, onOk } = pendingMaintain;
  maintainOverlay.classList.add('hidden');
  pendingMaintain = null;
  onOk(post, note);
});

// ── Auth ──
loginBtn.addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { showToast('erro ao entrar: ' + e.message, 'error'); }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    adminShell.classList.add('hidden');
    return;
  }
  let idToken;
  try { idToken = await user.getIdToken(); }
  catch {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    showToast('erro ao obter token. tente novamente', 'error');
    return;
  }
  let res;
  try {
    res = await fetch('/api/adm/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    showToast('sem conexão. tente novamente', 'error');
    return;
  }
  if (res.status === 401 || res.status === 403) {
    await signOut(auth);
    showToast('acesso negado', 'error');
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    return;
  }
  if (!res.ok) {
    loadingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    showToast('erro no servidor. tente novamente', 'error');
    return;
  }
  modProfile = await res.json();
  loginScreen.classList.add('hidden');
  loadingScreen.classList.add('hidden');
  adminShell.classList.remove('hidden');
  adminShell.classList.add('tools-active');

  // Init compose avatar with mod gradient
  composeAvatar.style.backgroundImage = gradientCSS(modProfile.gradient);
  composeAvatar.style.backgroundSize = '130% 130%';
  composeAvatar.style.backgroundPosition = 'center center';

  setDefaultComposeTime();
  loadPosts();
  loadIdolProfiles();

  if ('serviceWorker' in navigator && 'Notification' in window) {
    if (Notification.permission === 'default') {
      enablePushBtn.style.display = 'flex';
      enablePushBtn.title = 'Ativar notificações push';
    } else if (Notification.permission === 'granted') {
      setupFCM();
    } else if (Notification.permission === 'denied') {
      _markPushDenied();
    }
  }
});

async function setupFCM() {
  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);
    const currentToken = await getToken(messaging, {
      vapidKey: 'BDWpogUdy0kNGEdHXCBE1Qvi_w49ABjRT20UT0CeZelZaeiqAwoSGi_ck1un1esau9jzy86mF_1Ver-L8rTpmQM',
      serviceWorkerRegistration: registration
    });
    if (currentToken && modProfile) {
      // Chave por admin + dispositivo: evita que um login em outro device apague o token deste
      await setDoc(doc(db, 'hangul_fcm_tokens', `${modProfile.id}_${getDeviceId()}`), {
        token: currentToken,
        role: 'mod',
        updatedAt: serverTimestamp()
      });
      enablePushBtn.style.display = 'none';

      // Notificações em foreground (quando a aba /adm/ está aberta e visível)
      const bc = new BroadcastChannel('hangul-push');
      bc.addEventListener('message', ({ data }) => {
        showToast(`🔔 ${data.body || data.title}`, 'success');
      });
    }
  } catch (err) {
    console.log('FCM setup failed or blocked:', err);
  }
}

function _markPushDenied() {
  enablePushBtn.disabled = true;
  enablePushBtn.title = 'Notificações bloqueadas — altere nas configurações do browser';
  enablePushBtn.style.opacity = '0.4';
  enablePushBtn.style.cursor = 'not-allowed';
  enablePushBtn.style.display = 'flex';
}

enablePushBtn.addEventListener('click', async () => {
  if (enablePushBtn.disabled) return;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    setupFCM();
  } else if (permission === 'denied') {
    _markPushDenied();
    showToast('notificações bloqueadas pelo browser', 'error');
  }
});

// ── Admin Composer ──

function setDefaultComposeTime() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  composeCustomTime.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function resetCompose() {
  composeText.value = '';
  composeText.style.height = 'auto';
  composeCount.textContent = '0/300';
  composeBtn.disabled = true;
  composeCustomName.value = '';
  composeAvatarPhotoData = null;
  composeAvatarInput.value = '';
  composeAvatarBtn.classList.remove('has-photo');
  if (modProfile) {
    composeAvatar.style.backgroundImage = gradientCSS(modProfile.gradient);
    composeAvatar.style.backgroundSize = '130% 130%';
    composeAvatar.style.backgroundPosition = 'center center';
  }
  setDefaultComposeTime();
}

// Resize photo to at most 200×200 before storing
function resizePhoto(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 200;
      const scale = Math.min(MAX / img.width, MAX / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

composeAvatarBtn.addEventListener('click', () => composeAvatarInput.click());

composeAvatarInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('arquivo não é uma imagem', 'error'); return; }
  const data = await resizePhoto(file);
  if (!data) { showToast('erro ao processar imagem', 'error'); return; }
  composeAvatarPhotoData = data;
  composeAvatar.style.backgroundImage = `url(${data})`;
  composeAvatar.style.backgroundSize = 'cover';
  composeAvatar.style.backgroundPosition = 'center center';
  composeAvatarBtn.classList.add('has-photo');
});

composeText.addEventListener('input', () => {
  const len = composeText.value.length;
  composeCount.textContent = `${len}/300`;
  composeCount.classList.toggle('over', len > 300);
  composeBtn.disabled = len === 0 || len > 300;
  composeText.style.height = 'auto';
  composeText.style.height = composeText.scrollHeight + 'px';
});

composeBtn.addEventListener('click', async () => {
  const text = composeText.value.trim();
  if (!text || !modProfile) return;
  composeBtn.disabled = true;
  composeBtn.textContent = '…';
  try {
    const customName = composeCustomName.value.trim();
    const isIdol = !!customName;
    const author = customName || modProfile.name;

    let gradient = selectedIdolProfile ? selectedIdolProfile.gradient : modProfile.gradient;
    let avatarPhoto = composeAvatarPhotoData;

    if (isIdol && !selectedIdolProfile) {
      const nameKey = 'idol_' + customName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const existing = await getDoc(doc(db, 'hangul_usernames', nameKey));
      if (existing.exists()) {
        const data = existing.data();
        if (!data.isIdolProfile) {
          showToast('nome já em uso por outro usuário', 'error');
          composeBtn.disabled = false;
          composeBtn.textContent = 'postar';
          return;
        }
        gradient = data.gradient || gradient;
        avatarPhoto = avatarPhoto || data.avatarPhoto;
      } else {
        await setDoc(doc(db, 'hangul_usernames', nameKey), {
          name: customName,
          isIdolProfile: true,
          gradient: modProfile.gradient,
          ...(avatarPhoto ? { avatarPhoto } : {}),
          createdBy: modProfile.id,
          createdAt: serverTimestamp(),
        });
        const newProfile = {
          id: nameKey, name: customName, isIdolProfile: true,
          gradient: modProfile.gradient,
          ...(avatarPhoto ? { avatarPhoto } : {}),
        };
        idolProfiles.push(newProfile);
        renderProfileSelector();
      }
    }

    let createdAt;
    const timeVal = composeCustomTime.value;
    if (timeVal) {
      createdAt = Timestamp.fromDate(new Date(timeVal));
    } else {
      createdAt = serverTimestamp();
    }

    const postData = {
      type: 'text', message: text,
      author, authorId: modProfile.id,
      gradient,
      likedBy: [], likeCount: 0, replyCount: 0,
      createdAt,
      ...(avatarPhoto ? { avatarPhoto } : {}),
      ...(isIdol ? { isIdolPost: true } : {}),
    };

    await addDoc(collection(db, POSTS), postData);
    const prevProfile = selectedIdolProfile;
    resetCompose();
    if (prevProfile) selectIdolProfile(prevProfile);
    showToast('postado!', 'success');
  } catch (e) {
    showToast('erro ao postar: ' + e.message, 'error');
  } finally {
    composeBtn.disabled = composeText.value.trim().length === 0;
    composeBtn.textContent = 'postar';
  }
});

// ── Search toggle ──
searchToggleBtn.addEventListener('click', () => {
  if (searchBar.style.display === 'none') {
    searchBar.style.display = 'block';
    searchInput.focus();
  } else {
    searchBar.style.display = 'none';
    searchInput.value = '';
    renderReports();
  }
});

// ── Load posts ──
function loadPosts() {
  if (unsubscribePosts) unsubscribePosts();

  reportsList.innerHTML = `<div class="state-loading">
    <svg class="spinner" width="26" height="26" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="rgba(255,45,120,0.3)" stroke-width="3" fill="none"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#ff2d78" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg></div>`;

  const q = query(collection(db, POSTS), orderBy('createdAt', 'desc'), limit(120));
  unsubscribePosts = onSnapshot(q,
    (snap) => {
      allPosts = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      if (activeTab === 'idols') renderIdols();
      else renderReports();
    },
    (e) => {
      reportsList.innerHTML = `<div class="state-empty"><p>erro: ${escapeHTML(String(e.message || e))}</p></div>`;
      showToast('erro ao carregar', 'error');
    }
  );
}

// ── Render reports (inline, replaces postList) ──
function renderReports() {
  if (activeTab !== 'reports') return;
  const search = searchInput.value.toLowerCase().trim();

  if (search) {
    reportsSectionLabel.style.display = 'none';
    const results = allPosts
      .filter(p =>
        (p.author || '').toLowerCase().includes(search) ||
        (p.message || '').toLowerCase().includes(search) ||
        (p.caption || '').toLowerCase().includes(search)
      )
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    reportsList.innerHTML = '';
    if (results.length === 0) {
      reportsList.innerHTML = `<div class="state-empty"><p>nenhum resultado para "${escapeHTML(search)}"</p></div>`;
      return;
    }
    results.forEach(post => reportsList.appendChild(buildReportItem(post)));
    return;
  }

  const pending = allPosts
    .filter(p => (p.reportedBy?.length || 0) > (p.maintainedCount || 0))
    .sort((a, b) => {
      const da = (a.reportedBy?.length || 0) - (a.maintainedCount || 0);
      const db2 = (b.reportedBy?.length || 0) - (b.maintainedCount || 0);
      return db2 - da;
    });

  if (pending.length > 0) {
    reportsSectionLabel.style.display = 'flex';
    postsCountTools.textContent = String(pending.length);
  } else {
    reportsSectionLabel.style.display = 'none';
    postsCountTools.textContent = '';
  }

  reportsList.innerHTML = '';
  if (pending.length === 0) {
    reportsList.innerHTML = `<div class="state-empty"><p>sem denúncias pendentes ✓</p></div>`;
    return;
  }

  pending.forEach(post => reportsList.appendChild(buildReportItem(post)));
}

function buildReportItem(post) {
  const wrap = document.createElement('div');
  wrap.className = 'report-post-wrap';

  const card = buildPostCard(post.docId, post, {
    me: modProfile,
    modNames: MOD_NAMES,
    formatTimeFn: formatTimeAbs,
  });
  addBanHandlers(card, post);
  wrap.appendChild(card);

  const actionBar = document.createElement('div');
  actionBar.className = 'report-action-bar';

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-report-del';
  delBtn.type = 'button';
  delBtn.textContent = 'Deletar';
  delBtn.addEventListener('click', () => {
    const count = post.reportedBy?.length || 0;
    openConfirm(
      'Deletar post denunciado?',
      `De @${post.author || 'anônimo'} — ${count} denúncia${count !== 1 ? 's' : ''}. Ação permanente.`,
      async () => {
        try {
          await deleteDoc(doc(db, POSTS, post.docId));
          allPosts = allPosts.filter(p => p.docId !== post.docId);
          renderReports();
          showToast('post deletado', 'success');
        } catch (e) {
          showToast('erro: ' + e.message, 'error');
        }
      }
    );
  });

  const maintainBtn = document.createElement('button');
  maintainBtn.className = 'btn-report-maintain';
  maintainBtn.type = 'button';
  maintainBtn.textContent = 'Manter';
  maintainBtn.addEventListener('click', () => {
    openMaintainDialog(post, (post, note) => doMaintainPost(post, note));
  });

  actionBar.appendChild(delBtn);
  actionBar.appendChild(maintainBtn);
  wrap.appendChild(actionBar);

  return wrap;
}

async function doMaintainPost(post, note) {
  try {
    const updateData = { maintainedCount: post.reportedBy?.length || 0 };
    if (note) updateData.maintainNote = note;
    await updateDoc(doc(db, POSTS, post.docId), updateData);
    allPosts = allPosts.map(p =>
      p.docId === post.docId
        ? { ...p, maintainedCount: updateData.maintainedCount, ...(note ? { maintainNote: note } : {}) }
        : p
    );
    renderReports();
    showToast('post mantido', 'success');
  } catch (e) {
    showToast('erro: ' + e.message, 'error');
  }
}

// ── Ban user ──
async function banUser(authorId, authorName) {
  try {
    await setDoc(doc(db, BANS, authorId), {
      bannedAt: serverTimestamp(),
      bannedBy: modProfile.name,
      bannedName: authorName,
    });
    const snap = await getDocs(query(collection(db, POSTS), where('authorId', '==', authorId)));
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, POSTS, d.id))));
    showToast(`@${authorName} banido. ${snap.size} post${snap.size !== 1 ? 's' : ''} deletado${snap.size !== 1 ? 's' : ''}.`, 'success');
  } catch (e) {
    showToast('erro ao banir: ' + e.message, 'error');
  }
}

function addBanHandlers(card, post) {
  // Never ban mod accounts or idol posts created by mods
  if (MOD_NAMES.has(post.author) || MOD_IDS.has(post.authorId) || !post.authorId) return;
  card.querySelectorAll('.avatar-md, .post-author').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirm(
        `Banir @${post.author || 'anônimo'}?`,
        `O dispositivo será banido permanentemente e todos os posts deletados.`,
        () => banUser(post.authorId, post.author || 'anônimo')
      );
    });
  });
}

// ── Events ──
searchInput.addEventListener('input', renderReports);

// ── Drawing lightbox ──
document.addEventListener('click', e => {
  const img = e.target.closest('.post-drawing');
  if (!img || !img.src) return;
  const postEl = img.closest('[data-id]');
  const postId = postEl?.dataset.id;
  const post = allPosts.find(p => p.docId === postId);
  let _lbUnsub = null;
  openLightbox(img.src, {
    caption: post?.caption || null,
    onOpen: (threadEl, composerEl, actionsEl) => {
      if (actionsEl && post) renderAdminLightboxActions(actionsEl, postId, post);
      if (!postId) return;
      const q = query(collection(db, POSTS, postId, 'replies'), orderBy('createdAt', 'asc'), limit(50));
      _lbUnsub = onSnapshot(q, snap => renderAdminLightboxThread(threadEl, snap, postId));
      if (modProfile && composerEl) wireAdminLightboxComposer(composerEl, postId);
    },
    onClose: () => { _lbUnsub?.(); _lbUnsub = null; },
  });
});

function renderAdminLightboxActions(actionsEl, postId, post) {
  if (!actionsEl || !post) return;
  const liked = (post.likedBy || []).includes(modProfile?.id);
  const likeCount = (post.likedBy || []).length;
  const replyCount = post.replyCount || 0;
  actionsEl.innerHTML = `
    <button class="action-btn like-btn ${liked ? 'liked' : ''}" type="button">
      <svg width="17" height="17" viewBox="0 0 24 24"
        fill="${liked ? 'currentColor' : 'none'}"
        stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      <span class="count">${likeCount}</span>
    </button>
    <button class="action-btn reply-btn" type="button" disabled style="pointer-events:none">
      <svg width="17" height="17" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <span class="count">${replyCount}</span>
    </button>
  `;
  actionsEl.querySelector('.like-btn').addEventListener('click', async () => {
    await adminToggleLike(postId, post);
    const updatedPost = allPosts.find(p => p.docId === postId);
    if (updatedPost) renderAdminLightboxActions(actionsEl, postId, updatedPost);
  });
}

async function adminToggleLike(id, data) {
  if (!modProfile) return;
  const liked = (data.likedBy || []).includes(modProfile.id);
  try {
    await updateDoc(doc(db, POSTS, id), {
      likedBy: liked ? arrayRemove(modProfile.id) : arrayUnion(modProfile.id),
      likeCount: increment(liked ? -1 : 1)
    });
    const post = allPosts.find(p => p.docId === id);
    if (post) {
      post.likedBy = liked
        ? (post.likedBy || []).filter(u => u !== modProfile.id)
        : [...(post.likedBy || []), modProfile.id];
    }
  } catch (e) {
    showToast('erro ao curtir: ' + e.message, 'error');
  }
}

function renderAdminLightboxThread(threadEl, snap, postId) {
  threadEl.innerHTML = '';
  if (snap.empty) {
    threadEl.innerHTML = '<div class="lightbox-empty">nenhum comentário ainda.</div>';
    return;
  }
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
          <span class="reply-time">${formatTimeAbs(r.createdAt)}</span>
        </div>
        <div class="reply-content">${escapeHTML(r.message || '')}</div>
      </div>
    `;
    const delBtn = document.createElement('button');
    delBtn.className = 'reply-delete';
    delBtn.textContent = '✕';
    delBtn.title = `deletar resposta de @${r.author || 'anônimo'}`;
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Deletar resposta de @${r.author || 'anônimo'}?`)) return;
      try {
        await deleteDoc(doc(db, POSTS, postId, 'replies', d.id));
        item.remove();
        showToast('resposta deletada', 'success');
      } catch (err) {
        showToast('erro: ' + err.message, 'error');
      }
    });
    item.appendChild(delBtn);
    threadEl.appendChild(item);
  });
}

function wireAdminLightboxComposer(composerEl, postId) {
  composerEl.classList.remove('hidden');
  const input = composerEl.querySelector('.lightbox-reply-input');
  const sendBtn = composerEl.querySelector('.lightbox-reply-send');
  input.addEventListener('input', () => { sendBtn.disabled = input.value.trim().length === 0; });
  const submit = async () => {
    const txt = input.value.trim();
    if (!txt || !modProfile) return;
    sendBtn.disabled = true;
    try {
      await addDoc(collection(db, POSTS, postId, 'replies'), {
        message: txt, author: modProfile.name, authorId: modProfile.id,
        gradient: modProfile.gradient, createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, POSTS, postId), {
        replyCount: increment(1),
        lastReplyAuthor: modProfile.name,
        lastReplyText: txt.slice(0, 100),
      });
      input.value = '';
    } catch (err) {
      showToast('erro ao responder: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = true;
    }
  };
  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
}

// ── Offline Site Control ──
const toggleOfflineBtn = document.getElementById('toggleOfflineBtn');
let isSystemOffline = false;

if (toggleOfflineBtn) {
  onSnapshot(doc(db, 'hangul_bans', 'SYSTEM_OFFLINE'), (snap) => {
    if (snap.exists()) {
      isSystemOffline = snap.data().isOffline || false;
      toggleOfflineBtn.textContent = isSystemOffline ? 'Colocar no ar' : 'Retirar do ar';
      toggleOfflineBtn.className = isSystemOffline ? 'btn-report-maintain' : 'btn-report-del';
    }
  });

  toggleOfflineBtn.addEventListener('click', async () => {
    try {
      const newStatus = !isSystemOffline;
      if (newStatus) {
        if (!confirm('Tem certeza que deseja retirar o site do ar para os usuários comuns?')) return;
      }
      await setDoc(doc(db, 'hangul_bans', 'SYSTEM_OFFLINE'), { isOffline: newStatus }, { merge: true });
      showToast(newStatus ? 'Site offline' : 'Site online', 'success');
    } catch (err) {
      showToast('erro ao alterar status: ' + err.message, 'error');
    }
  });
}

// ── Countdown Control ──
const countdownTimeInput = document.getElementById('countdownTimeInput');
const toggleCountdownBtn = document.getElementById('toggleCountdownBtn');
let isCountdownActive = false;

if (toggleCountdownBtn && countdownTimeInput) {
  // Default to 2026-05-23T22:00
  countdownTimeInput.value = "2026-05-23T22:00";

  onSnapshot(doc(db, 'hangul_bans', 'SYSTEM_COUNTDOWN'), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      isCountdownActive = data.active || false;
      if (data.targetTime) {
        // Format targetTime for datetime-local (YYYY-MM-DDThh:mm)
        const d = new Date(data.targetTime);
        if (!isNaN(d)) {
          const pad = n => String(n).padStart(2, '0');
          countdownTimeInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      }
      toggleCountdownBtn.textContent = isCountdownActive ? 'Encerrar Contagem' : 'Iniciar Contagem';
      toggleCountdownBtn.className = isCountdownActive ? 'btn-report-del' : 'btn-report-maintain';
    }
  });

  toggleCountdownBtn.addEventListener('click', async () => {
    try {
      const newStatus = !isCountdownActive;
      const targetTimeVal = countdownTimeInput.value;
      if (!targetTimeVal && newStatus) {
        showToast('Defina o horário alvo', 'error');
        return;
      }
      let targetTimeIso = null;
      if (targetTimeVal) {
        const d = new Date(targetTimeVal);
        targetTimeIso = d.toISOString();
      }
      await setDoc(doc(db, 'hangul_bans', 'SYSTEM_COUNTDOWN'), {
        active: newStatus,
        targetTime: targetTimeIso
      }, { merge: true });
      showToast(newStatus ? 'Contagem iniciada' : 'Contagem encerrada', 'success');
    } catch (err) {
      showToast('Erro ao atualizar contagem: ' + err.message, 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ── Tabs ──
// ═══════════════════════════════════════════════════════════════

function setActiveTab(tab) {
  activeTab = tab;
  tabReports.classList.toggle('active', tab === 'reports');
  tabIdols.classList.toggle('active', tab === 'idols');

  reportsList.style.display    = tab === 'reports' ? '' : 'none';
  idolsList.style.display      = tab === 'idols'   ? '' : 'none';
  profileSelector.style.display = tab === 'idols'   ? '' : 'none';

  // Hide search when switching tabs
  searchBar.style.display = 'none';
  searchInput.value = '';

  // Hide reports label when on idols tab
  if (tab === 'reports') {
    renderReports();
  } else {
    reportsSectionLabel.style.display = 'none';
    loadIdolProfiles();
    renderIdols();
  }
}

tabReports.addEventListener('click', () => setActiveTab('reports'));
tabIdols.addEventListener('click',   () => setActiveTab('idols'));

// ═══════════════════════════════════════════════════════════════
// ── Idol Profiles ──
// ═══════════════════════════════════════════════════════════════

async function loadIdolProfiles() {
  try {
    // 1. Load canonical profiles already registered
    const usernamesSnap = await getDocs(
      query(collection(db, 'hangul_usernames'), where('isIdolProfile', '==', true))
    );
    const fromUsernames = usernamesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const registeredNames = new Set(fromUsernames.map(p => p.name));

    // 2. Scan all idol posts to discover profiles not yet registered
    const postsSnap = await getDocs(
      query(collection(db, POSTS), where('isIdolPost', '==', true))
    );
    const discoveredMap = new Map();
    postsSnap.docs.forEach(d => {
      const p = d.data();
      if (!p.author || registeredNames.has(p.author)) return;
      const existing = discoveredMap.get(p.author);
      // Prefer entry with avatarPhoto
      if (!existing || (!existing.avatarPhoto && p.avatarPhoto)) {
        discoveredMap.set(p.author, {
          name: p.author,
          gradient: p.gradient || ['#ff2d78', '#9b59ff'],
          avatarPhoto: p.avatarPhoto || null,
        });
      }
    });

    // 3. Backfill discovered profiles into hangul_usernames for cross-admin persistence
    const backfilledProfiles = [];
    const backfillOps = [];
    discoveredMap.forEach((profile, name) => {
      const nameKey = 'idol_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const localProfile = {
        id: nameKey, name, isIdolProfile: true,
        gradient: profile.gradient,
        ...(profile.avatarPhoto ? { avatarPhoto: profile.avatarPhoto } : {}),
      };
      backfilledProfiles.push(localProfile);
      backfillOps.push(
        setDoc(doc(db, 'hangul_usernames', nameKey), {
          name, isIdolProfile: true,
          gradient: profile.gradient,
          ...(profile.avatarPhoto ? { avatarPhoto: profile.avatarPhoto } : {}),
          discoveredAt: serverTimestamp(),
        }, { merge: true })
      );
    });

    if (backfillOps.length > 0) await Promise.allSettled(backfillOps);

    idolProfiles = [...fromUsernames, ...backfilledProfiles];
    renderProfileSelector();
  } catch (e) {
    console.log('Failed to load idol profiles:', e);
  }
}

function renderProfileSelector() {
  profileSelectorList.innerHTML = '';

  idolProfiles.forEach(profile => {
    const pill = document.createElement('button');
    pill.className = 'profile-pill' + (selectedIdolProfile?.id === profile.id ? ' active' : '');
    pill.type = 'button';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'profile-pill-avatar';
    if (profile.avatarPhoto) {
      avatarEl.style.backgroundImage = `url(${profile.avatarPhoto})`;
      avatarEl.style.backgroundSize = 'cover';
    } else {
      avatarEl.style.backgroundImage = gradientCSS(profile.gradient || ['#ff2d78', '#9b59ff']);
    }

    pill.appendChild(avatarEl);
    pill.appendChild(document.createTextNode(profile.name));
    pill.addEventListener('click', () => selectIdolProfile(profile));
    profileSelectorList.appendChild(pill);
  });

  const newPill = document.createElement('button');
  newPill.className = 'profile-pill profile-pill-new' + (selectedIdolProfile === null && idolProfiles.length > 0 ? ' active' : '');
  newPill.type = 'button';
  newPill.textContent = '+ novo perfil';
  newPill.addEventListener('click', () => selectIdolProfile(null));
  profileSelectorList.appendChild(newPill);
}

function selectIdolProfile(profile) {
  selectedIdolProfile = profile;
  renderProfileSelector();

  if (profile) {
    composeCustomName.value = profile.name;
    composeCustomName.readOnly = true;
    composeCustomName.style.opacity = '.7';

    if (profile.avatarPhoto) {
      composeAvatarPhotoData = profile.avatarPhoto;
      composeAvatar.style.backgroundImage = `url(${profile.avatarPhoto})`;
      composeAvatar.style.backgroundSize = 'cover';
      composeAvatarBtn.classList.add('has-photo');
    } else {
      composeAvatarPhotoData = null;
      composeAvatar.style.backgroundImage = gradientCSS(profile.gradient || modProfile.gradient);
      composeAvatar.style.backgroundSize = '130% 130%';
      composeAvatarBtn.classList.remove('has-photo');
    }
  } else {
    composeCustomName.value = '';
    composeCustomName.readOnly = false;
    composeCustomName.style.opacity = '';
    composeAvatarPhotoData = null;
    if (modProfile) {
      composeAvatar.style.backgroundImage = gradientCSS(modProfile.gradient);
      composeAvatar.style.backgroundSize = '130% 130%';
    }
    composeAvatar.style.backgroundPosition = 'center center';
    composeAvatarBtn.classList.remove('has-photo');
  }
}

// ═══════════════════════════════════════════════════════════════
// ── Idols Tab — Post list ──
// ═══════════════════════════════════════════════════════════════

function renderIdols() {
  if (activeTab !== 'idols') return;

  const idolPosts = allPosts
    .filter(p => p.isIdolPost === true)
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  // Remember which reply sections are currently open
  const openSections = new Set();
  idolsList.querySelectorAll('.idol-post-wrap[data-post-id]').forEach(wrap => {
    const content = wrap.querySelector('.idol-replies-content');
    if (content && content.style.display !== 'none') openSections.add(wrap.dataset.postId);
  });

  // Unsubscribe all reply listeners (DOM is being rebuilt)
  Object.values(idolReplyUnsubs).forEach(fn => fn?.());
  idolReplyUnsubs = {};

  idolsList.innerHTML = '';

  if (idolPosts.length === 0) {
    idolsList.innerHTML = '<div class="state-empty"><p>nenhum post idol ainda</p></div>';
    return;
  }

  idolPosts.forEach(post => {
    const wrap = buildIdolItem(post);
    idolsList.appendChild(wrap);
    if (openSections.has(post.docId)) {
      wrap.querySelector('.idol-replies-toggle')?.click();
    }
  });
}

function buildIdolItem(post) {
  const wrap = document.createElement('div');
  wrap.className = 'idol-post-wrap';
  wrap.dataset.postId = post.docId;

  const card = buildPostCard(post.docId, post, {
    me: modProfile,
    modNames: MOD_NAMES,
    formatTimeFn: formatTimeAbs,
  });
  wrap.appendChild(card);

  const actionBar = document.createElement('div');
  actionBar.className = 'idol-action-bar';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-idol-edit';
  editBtn.type = 'button';
  editBtn.textContent = 'Editar';
  editBtn.addEventListener('click', () => openEditModal(post));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-idol-del';
  delBtn.type = 'button';
  delBtn.textContent = 'Deletar';
  delBtn.addEventListener('click', () => {
    openConfirm(
      'Deletar post idol?',
      `De @${post.author || 'anônimo'}. Ação permanente.`,
      async () => {
        try {
          await deleteDoc(doc(db, POSTS, post.docId));
          showToast('post deletado', 'success');
        } catch (e) {
          showToast('erro: ' + e.message, 'error');
        }
      }
    );
  });

  actionBar.appendChild(editBtn);
  actionBar.appendChild(delBtn);
  wrap.appendChild(actionBar);
  wrap.appendChild(buildIdolRepliesSection(post));

  return wrap;
}

function buildIdolRepliesSection(post) {
  const section = document.createElement('div');
  section.className = 'idol-replies-section';

  const toggle = document.createElement('button');
  toggle.className = 'idol-replies-toggle';
  toggle.type = 'button';
  toggle.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
    <span>${post.replyCount || 0} respostas</span>`;
  section.appendChild(toggle);

  const content = document.createElement('div');
  content.className = 'idol-replies-content';
  content.style.display = 'none';

  const thread = document.createElement('div');
  thread.className = 'idol-replies-thread';
  thread.innerHTML = '<div class="replies-empty">carregando…</div>';
  content.appendChild(thread);

  // Reply composer
  const composer = document.createElement('div');
  composer.className = 'idol-reply-composer';

  const input = document.createElement('input');
  input.className = 'idol-reply-input';
  input.type = 'text';
  input.placeholder = 'responder…';
  input.maxLength = 300;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'idol-reply-send';
  sendBtn.type = 'button';
  sendBtn.textContent = 'enviar';
  sendBtn.disabled = true;

  input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });

  const submitReply = async () => {
    const txt = input.value.trim();
    if (!txt || !modProfile) return;
    sendBtn.disabled = true;

    const replyAuthor  = selectedIdolProfile ? selectedIdolProfile.name  : modProfile.name;
    const replyGrad    = selectedIdolProfile ? selectedIdolProfile.gradient : modProfile.gradient;
    const replyAvatar  = selectedIdolProfile?.avatarPhoto || null;

    try {
      await addDoc(collection(db, POSTS, post.docId, 'replies'), {
        message: txt,
        author: replyAuthor,
        authorId: modProfile.id,
        gradient: replyGrad,
        ...(replyAvatar ? { avatarPhoto: replyAvatar } : {}),
        ...(selectedIdolProfile ? { isIdolPost: true } : {}),
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, POSTS, post.docId), {
        replyCount: increment(1),
        lastReplyAuthor: replyAuthor,
        lastReplyText: txt.slice(0, 100),
      });
      input.value = '';
    } catch (err) {
      showToast('erro ao responder: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = true;
    }
  };

  sendBtn.addEventListener('click', submitReply);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitReply(); } });

  composer.appendChild(input);
  composer.appendChild(sendBtn);
  content.appendChild(composer);
  section.appendChild(content);

  toggle.addEventListener('click', () => {
    const isOpen = content.style.display !== 'none';
    if (isOpen) {
      content.style.display = 'none';
      toggle.classList.remove('open');
    } else {
      content.style.display = '';
      toggle.classList.add('open');
      if (!idolReplyUnsubs[post.docId]) {
        const q = query(collection(db, POSTS, post.docId, 'replies'), orderBy('createdAt', 'asc'), limit(50));
        idolReplyUnsubs[post.docId] = onSnapshot(q, snap => {
          renderIdolReplyThread(thread, snap, post.docId);
          const span = toggle.querySelector('span');
          if (span) span.textContent = `${snap.size} respostas`;
        });
      }
    }
  });

  return section;
}

function renderIdolReplyThread(thread, snap, postId) {
  thread.innerHTML = '';
  if (snap.empty) {
    thread.innerHTML = '<div class="replies-empty">nenhuma resposta ainda</div>';
    return;
  }
  snap.forEach(d => {
    const r = d.data();
    const grad = r.gradient?.length === 2 ? gradientCSS(r.gradient) : gradientCSS(['#ff2d78', '#9b59ff']);

    const item = document.createElement('div');
    item.className = 'idol-reply-item';

    const avatar = document.createElement('div');
    avatar.className = 'idol-reply-avatar';
    if (r.avatarPhoto) {
      avatar.style.backgroundImage = `url(${r.avatarPhoto})`;
      avatar.style.backgroundSize = 'cover';
    } else {
      avatar.style.backgroundImage = grad;
    }

    const body = document.createElement('div');
    body.className = 'idol-reply-body';
    body.innerHTML = `
      <div class="idol-reply-meta">
        <span class="idol-reply-author">${escapeHTML(r.author || 'anônimo')}</span>
        <span>${formatTimeAbs(r.createdAt)}</span>
      </div>
      <div class="idol-reply-text">${escapeHTML(r.message || '')}</div>`;

    const delBtn = document.createElement('button');
    delBtn.className = 'idol-reply-del';
    delBtn.textContent = '✕';
    delBtn.title = `deletar resposta de @${r.author || 'anônimo'}`;
    delBtn.addEventListener('click', async () => {
      if (!confirm(`Deletar resposta de @${r.author || 'anônimo'}?`)) return;
      try {
        await deleteDoc(doc(db, POSTS, postId, 'replies', d.id));
        showToast('resposta deletada', 'success');
      } catch (err) {
        showToast('erro: ' + err.message, 'error');
      }
    });

    item.appendChild(avatar);
    item.appendChild(body);
    item.appendChild(delBtn);
    thread.appendChild(item);
  });
}

// ═══════════════════════════════════════════════════════════════
// ── Edit Modal ──
// ═══════════════════════════════════════════════════════════════

function openEditModal(post) {
  editModalText.value = post.message || '';
  if (post.createdAt?.seconds) {
    const d = new Date(post.createdAt.seconds * 1000);
    const pad = n => String(n).padStart(2, '0');
    editModalTime.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    editModalTime.value = '';
  }
  editModalSave.disabled = false;
  pendingEdit = { docId: post.docId };
  editModalOverlay.classList.remove('hidden');
  setTimeout(() => editModalText.focus(), 50);
}

editModalText.addEventListener('input', () => {
  editModalSave.disabled = !editModalText.value.trim();
});

editModalCancel.addEventListener('click', () => {
  editModalOverlay.classList.add('hidden');
  pendingEdit = null;
});

editModalSave.addEventListener('click', async () => {
  if (!pendingEdit) return;
  const newText = editModalText.value.trim();
  if (!newText) return;
  editModalSave.disabled = true;
  try {
    const updateData = { message: newText };
    if (editModalTime.value) {
      updateData.createdAt = Timestamp.fromDate(new Date(editModalTime.value));
    }
    await updateDoc(doc(db, POSTS, pendingEdit.docId), updateData);

    const post = allPosts.find(p => p.docId === pendingEdit.docId);
    if (post) {
      post.message = newText;
      if (editModalTime.value) post.createdAt = updateData.createdAt;
    }

    editModalOverlay.classList.add('hidden');
    pendingEdit = null;
    showToast('post atualizado', 'success');
    renderIdols();
  } catch (e) {
    showToast('erro ao salvar: ' + e.message, 'error');
  } finally {
    editModalSave.disabled = false;
  }
});

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-auth.js';
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, setDoc,
  serverTimestamp, query, orderBy, getDocs, limit, increment
} from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-firestore.js';
import { getMessaging, getToken } from 'https://www.gstatic.com/firebasejs/11.8.1/firebase-messaging.js';
import {
  gradientCSS, escapeHTML, formatTimeAbs,
  buildPostCard, updatePostCard,
} from '../src/shared.js';

const firebaseConfig = await fetch('/api/config').then(r => r.json());
const MOD_NAMES = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.name));

const POSTS = 'hangul_messages';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── DOM ──
const loginScreen        = document.getElementById('loginScreen');
const adminShell         = document.getElementById('adminShell');
const loadingScreen      = document.getElementById('loadingScreen');
const loginBtn           = document.getElementById('loginBtn');
const reportsBtn         = document.getElementById('reportsBtn');
const reportsOverlay     = document.getElementById('reportsOverlay');
const reportsClose       = document.getElementById('reportsClose');
const reportsOverlayCount= document.getElementById('reportsOverlayCount');
const reportsOverlayList = document.getElementById('reportsOverlayList');
const reportsBadge       = document.getElementById('reportsBadge');
const enablePushBtn      = document.getElementById('enablePushBtn');
const searchToggleBtn    = document.getElementById('searchToggleBtn');
const searchBar          = document.getElementById('searchBar');
const searchInput        = document.getElementById('searchInput');
const postList           = document.getElementById('postList');
const postsCountTools    = document.getElementById('postsCountTools');
const composeAvatar      = document.getElementById('composeAvatar');
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

let allPosts        = [];
let modProfile      = null;
let pendingConfirm  = null;
let pendingMaintain = null;
let toastTimer      = null;

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
  const needsNote = count >= 3;
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
    // Network failure — keep session alive, let user retry
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
    // Server error — don't sign out, let user retry
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
  composeAvatar.style.backgroundImage = gradientCSS(modProfile.gradient);
  loadPosts();
  
  // Initialize Web Push for Moderators
  if ('serviceWorker' in navigator && 'Notification' in window) {
    if (Notification.permission === 'default') {
      enablePushBtn.style.display = 'flex';
    } else if (Notification.permission === 'granted') {
      setupFCM();
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
      await setDoc(doc(db, 'hangul_fcm_tokens', modProfile.id), {
        token: currentToken,
        role: 'mod',
        updatedAt: serverTimestamp()
      });
      enablePushBtn.style.display = 'none';
    }
  } catch (err) {
    console.log('FCM setup failed or blocked:', err);
  }
}

enablePushBtn.addEventListener('click', async () => {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    setupFCM();
  } else {
    enablePushBtn.style.display = 'none';
  }
});

// ── Reports overlay ──
reportsBtn.addEventListener('click', () => reportsOverlay.classList.add('open'));
reportsClose.addEventListener('click', () => reportsOverlay.classList.remove('open'));

// ── Admin Composer ──
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
    await addDoc(collection(db, POSTS), {
      type: 'text', message: text,
      author: modProfile.name, authorId: modProfile.id,
      gradient: modProfile.gradient,
      likedBy: [], replyCount: 0,
      createdAt: serverTimestamp(),
    });
    composeText.value = '';
    composeText.style.height = 'auto';
    composeCount.textContent = '0/300';
    showToast('postado!', 'success');
    await loadPosts();
  } catch (e) {
    showToast('erro ao postar: ' + e.message, 'error');
  } finally {
    composeBtn.disabled = false;
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
    renderPosts();
  }
});

// ── Load posts ──
async function loadPosts() {
  postList.innerHTML = `<div class="state-loading">
    <svg class="spinner" width="26" height="26" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="rgba(255,45,120,0.3)" stroke-width="3" fill="none"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#ff2d78" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg></div>`;
  try {
    const q    = query(collection(db, POSTS), orderBy('createdAt', 'desc'), limit(120));
    const snap = await getDocs(q);
    allPosts   = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
    updateReports();
    renderPosts();
  } catch (e) {
    postList.innerHTML = `<div class="state-empty"><p>erro: ${escapeHTML(String(e.message || e))}</p></div>`;
    showToast('erro ao carregar', 'error');
  }
}

// ── Reports ──
function updateReports() {
  // A post needs review when it has more reports than the last maintained count
  const pending = allPosts
    .filter(p => (p.reportedBy?.length || 0) > (p.maintainedCount || 0))
    .sort((a, b) => {
      const da = (a.reportedBy?.length || 0) - (a.maintainedCount || 0);
      const db2= (b.reportedBy?.length || 0) - (b.maintainedCount || 0);
      return db2 - da;
    });

  if (pending.length > 0) {
    reportsBadge.textContent = pending.length;
    reportsBadge.classList.remove('hidden');
    reportsBtn.classList.add('has-reports');
  } else {
    reportsBadge.classList.add('hidden');
    reportsBtn.classList.remove('has-reports');
  }

  reportsOverlayCount.textContent = `${pending.length} post${pending.length !== 1 ? 's' : ''}`;
  reportsOverlayCount.classList.toggle('hidden', pending.length === 0);

  reportsOverlayList.innerHTML = '';
  if (pending.length === 0) {
    reportsOverlayList.innerHTML = `<div class="reports-empty">sem denúncias pendentes ✓</div>`;
    return;
  }

  pending.forEach(post => reportsOverlayList.appendChild(buildReportItem(post)));
}

function buildReportItem(post) {
  const wrap = document.createElement('div');
  wrap.className = 'report-post-wrap';

  // Post card (read-only — no like/reply/delete handlers)
  const card = buildPostCard(post.docId, post, {
    me: modProfile,
    modNames: MOD_NAMES,
    formatTimeFn: formatTimeAbs,
  });
  wrap.appendChild(card);

  // Action bar
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
          updateReports();
          renderPosts();
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
    updateReports();
    renderPosts();
    showToast('post mantido', 'success');
  } catch (e) {
    showToast('erro: ' + e.message, 'error');
  }
}

// ── Render feed ──
function renderPosts() {
  const search = searchInput.value.toLowerCase().trim();
  const filtered = allPosts.filter(p => {
    if (search) {
      const ok = (p.author || '').toLowerCase().includes(search)
              || (p.message || '').toLowerCase().includes(search);
      if (!ok) return false;
    }
    return true;
  });
  if (postsCountTools) postsCountTools.textContent = `${filtered.length} post${filtered.length !== 1 ? 's' : ''}`;
  if (!filtered.length) {
    postList.innerHTML = `<div class="state-empty"><p>nenhum post encontrado</p></div>`;
    return;
  }
  postList.innerHTML = '';
  filtered.forEach(p => postList.appendChild(buildAdminPostCard(p)));
}

function buildAdminPostCard(post) {
  return buildPostCard(post.docId, post, {
    me: modProfile,
    modNames: MOD_NAMES,
    formatTimeFn: formatTimeAbs,
    onDelete: (id, el) => confirmDelete(post, el),
    onReplyClick: (el) => toggleRepliesSection(post, el),
  });
}

// ── Replies section (on-demand toggle) ──
async function toggleRepliesSection(post, articleEl) {
  const section  = articleEl.querySelector('.replies-section');
  const replyBtn = articleEl.querySelector('.reply-btn');

  if (section.children.length > 0) {
    section.innerHTML = '';
    replyBtn.classList.remove('open');
    return;
  }

  replyBtn.classList.add('open');
  const thread = document.createElement('div');
  thread.className = 'reply-thread';

  try {
    const q    = query(collection(db, POSTS, post.docId, 'replies'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    if (snap.empty) {
      const empty = document.createElement('p');
      empty.className = 'replies-empty';
      empty.textContent = 'ainda sem respostas';
      thread.appendChild(empty);
    } else {
      snap.forEach(d => thread.appendChild(buildReplyItem(d.id, d.data(), post.docId)));
    }
  } catch (e) {
    showToast('erro ao carregar respostas', 'error');
  }

  section.appendChild(thread);
  section.appendChild(buildReplyComposer(post.docId, thread, post));
}

function buildReplyItem(replyId, r, postId) {
  const item = document.createElement('div');
  item.className = 'thread-item';

  const av = document.createElement('div');
  av.className = 'avatar avatar-sm';
  av.style.backgroundImage = gradientCSS(r.gradient);
  item.appendChild(av);

  const body = document.createElement('div');
  body.className = 'reply-body';
  body.innerHTML = `
    <div class="reply-header">
      <span class="reply-author">${escapeHTML(r.author || 'anônimo')}</span>
      <span class="reply-time">${formatTimeAbs(r.createdAt)}</span>
    </div>
    <div class="reply-content">
      ${r.type === 'drawing' && typeof r.message === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(r.message)
        ? `<img class="post-drawing" src="${r.message}" alt="desenho" loading="lazy" />`
        : escapeHTML(r.message || '')
      }
    </div>
  `;
  item.appendChild(body);

  const delBtn = document.createElement('button');
  delBtn.className = 'reply-delete';
  delBtn.textContent = '✕';
  delBtn.title = `deletar resposta de @${r.author || 'anônimo'}`;
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Deletar resposta de @${r.author || 'anônimo'}?`)) return;
    try {
      await deleteDoc(doc(db, POSTS, postId, 'replies', replyId));
      item.remove();
      showToast('resposta deletada', 'success');
    } catch (e) {
      showToast('erro: ' + e.message, 'error');
    }
  });
  item.appendChild(delBtn);

  return item;
}

function buildReplyComposer(postId, threadEl, post) {
  const wrap = document.createElement('div');
  wrap.className = 'reply-composer';

  const av = document.createElement('div');
  av.className = 'avatar avatar-sm';
  av.style.backgroundImage = modProfile ? gradientCSS(modProfile.gradient) : '';
  wrap.appendChild(av);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'reply-input';
  input.placeholder = 'escrever resposta…';
  input.maxLength = 200;
  wrap.appendChild(input);

  const send = document.createElement('button');
  send.className = 'reply-send';
  send.disabled = true;
  send.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>`;
  wrap.appendChild(send);

  input.addEventListener('input', () => { send.disabled = input.value.trim().length === 0; });

  const submit = async () => {
    const txt = input.value.trim();
    if (!txt || !modProfile) return;
    send.disabled = true;
    try {
      await addDoc(collection(db, POSTS, postId, 'replies'), {
        type: 'text', message: txt,
        author: modProfile.name, authorId: modProfile.id,
        gradient: modProfile.gradient, createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, POSTS, postId), { replyCount: increment(1) });
      threadEl.querySelector('.replies-empty')?.remove();
      const fakeTs = { toDate: () => new Date() };
      threadEl.appendChild(buildReplyItem('_local_' + Date.now(), {
        type: 'text', message: txt,
        author: modProfile.name, gradient: modProfile.gradient,
        createdAt: fakeTs,
      }, postId));
      const localPost = allPosts.find(p => p.docId === postId);
      if (localPost) localPost.replyCount = (localPost.replyCount || 0) + 1;
      post.replyCount = (post.replyCount || 0) + 1;
      input.value = '';
      showToast('resposta enviada!', 'success');
    } catch (e) {
      showToast('erro: ' + e.message, 'error');
    } finally {
      send.disabled = input.value.trim().length === 0;
    }
  };

  send.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  return wrap;
}

// ── Delete post ──
function confirmDelete(post, el) {
  const preview = post.type === 'drawing' ? '[desenho]' : `"${(post.message || '').slice(0, 60)}…"`;
  openConfirm(
    'Deletar post?',
    `De @${post.author || 'anônimo'}: ${preview}\n\nEsta ação é permanente.`,
    () => doDeletePost(post, el)
  );
}

async function doDeletePost(post, el) {
  el.classList.add('deleting');
  try {
    await deleteDoc(doc(db, POSTS, post.docId));
    allPosts = allPosts.filter(p => p.docId !== post.docId);
    el.remove();
    showToast('post deletado', 'success');
  } catch (e) {
    el.classList.remove('deleting');
    showToast('erro: ' + e.message, 'error');
  }
}

// ── Events ──
searchInput.addEventListener('input', renderPosts);

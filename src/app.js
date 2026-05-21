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

const MOD_NAMES = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.name));
const MOD_IDS   = new Set((firebaseConfig.moderatorProfiles || []).map(p => p.id));
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
}

if (!me) openOnboarding();
else paintUserUI();

// ── Admin auth ──
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/adm/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) { await signOut(auth); return; }
      const profile = await res.json();
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
    } catch { await signOut(auth); }
  } else if (!user && MOD_IDS.has(me?.id)) {
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

  const [g1, g2] = me.gradient?.length === 2 ? me.gradient : ['#ff2d78', '#9b59ff'];
  const exportDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const count = myPosts.length;

  let postsHTML = '';
  for (const post of myPosts) {
    const time = post.createdAt
      ? new Date(post.createdAt.seconds * 1000).toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
      : '';
    const [pg1, pg2] = post.gradient?.length === 2 ? post.gradient : [g1, g2];
    const likes   = (post.likedBy || []).length;
    const replies = post.replyCount || 0;
    const isDrawing = post.type === 'drawing';

    postsHTML += `
    <div class="post-card">
      <div class="post-header">
        <div class="post-avatar" style="background:linear-gradient(135deg,${pg1} 0%,${pg2} 100%)"></div>
        <div>
          <div class="post-author">${escapeHTML(post.author || 'anônimo')}</div>
          <div class="post-time">${time}</div>
        </div>
      </div>
      ${isDrawing
        ? `<img class="post-drawing" src="${post.message}" alt="desenho" />`
        : `<div class="post-content">${escapeHTML(post.message || '').replace(/\n/g, '<br>')}</div>`
      }
      <div class="post-footer">
        <span class="post-stat">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          ${likes}
        </span>
        <span class="post-stat">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          ${replies}
        </span>
      </div>
    </div>`;
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Meus posts — Hangul Hangover</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Outfit',sans-serif;background:#1a0a2e;color:#f0e6ff;min-height:100vh}
    .page{max-width:580px;margin:0 auto;padding:36px 24px 60px}
    .brand{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,.1)}
    .brand-logo{width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#ff2d78 0%,#9b59ff 100%);flex-shrink:0}
    .brand-w1{font-size:1.25rem;font-weight:800;letter-spacing:.1em;color:#ff2d78}
    .brand-w2{font-size:1.25rem;font-weight:300;letter-spacing:.18em;color:#9b59ff}
    .brand-sub{font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(240,230,255,.4);margin-top:3px}
    .profile-block{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:16px;margin-bottom:10px}
    .profile-avatar{width:48px;height:48px;border-radius:50%;flex-shrink:0;border:2px solid rgba(255,255,255,.18)}
    .profile-name{font-size:1rem;font-weight:700}
    .profile-meta{font-size:.68rem;color:rgba(240,230,255,.45);margin-top:2px}

    .post-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid}
    .post-header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
    .post-avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;border:1px solid rgba(255,255,255,.15)}
    .post-author{font-size:.86rem;font-weight:700}
    .post-time{font-size:.64rem;color:rgba(240,230,255,.4);margin-top:1px}
    .post-content{font-size:.92rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:#e8deff}
    .post-drawing{max-width:200px;border-radius:8px;display:block;border:1px solid rgba(255,255,255,.1);margin-top:4px}
    .post-footer{display:flex;gap:14px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)}
    .post-stat{display:flex;align-items:center;gap:4px;font-size:.7rem;color:rgba(240,230,255,.4)}

    .doc-footer{margin-top:40px;padding-top:16px;border-top:1px solid rgba(255,255,255,.1);font-size:.63rem;color:rgba(240,230,255,.3);display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px}
  </style>
</head>
<body>
<div class="page">
  <div class="brand">
    <div class="brand-logo"></div>
    <div>
      <div><span class="brand-w1">WEVERSE </span><span class="brand-w2">HANGOVER</span></div>
      <div class="brand-sub">relatório de dados pessoais</div>
    </div>
  </div>
  <div class="profile-block">
    <div class="profile-avatar" style="background:linear-gradient(135deg,${g1} 0%,${g2} 100%)"></div>
    <div>
      <div class="profile-name">${escapeHTML(me.name)}</div>
      <div class="profile-meta">${count} post${count !== 1 ? 's' : ''}</div>
    </div>
  </div>
  ${postsHTML}
  <div class="doc-footer">
    <span>Hangul Hangover</span>
    <span>Exportado em ${exportDate}</span>
  </div>
</div>
<div id="gen-status" style="position:fixed;bottom:16px;right:16px;background:rgba(26,10,46,.95);border:1px solid rgba(155,89,255,.3);color:rgba(240,230,255,.7);font-family:'Outfit',sans-serif;font-size:.72rem;padding:8px 14px;border-radius:8px;z-index:9999">Gerando PDF…</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<script>window.addEventListener('load',async function(){
  var s=document.getElementById('gen-status');
  try{
    s.style.display='none';
    var canvas=await html2canvas(document.querySelector('.page'),{scale:2,useCORS:true,backgroundColor:'#1a0a2e',logging:false});
    s.style.display='';
    var W=canvas.width/2,H=canvas.height/2;
    var pdf=new window.jspdf.jsPDF({orientation:'p',unit:'px',format:[W,H]});
    pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,W,H);
    pdf.save('meus-posts-hangul-hangover.pdf');
    s.textContent='PDF gerado! Esta aba pode ser fechada.';
    setTimeout(function(){try{window.close();}catch(e){}},2000);
  }catch(e){
    s.style.display='';
    s.textContent='Erro ao gerar PDF. Use Ctrl+P → Salvar como PDF.';
    s.style.borderColor='rgba(255,45,120,.3)';s.style.color='#ff2d78';
  }
});<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (!win) { showToast('permita pop-ups para baixar'); return; }
  setTimeout(() => URL.revokeObjectURL(url), 15000);
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
const drawControls = document.getElementById('drawControls');
const eraserBtn = document.getElementById('eraserBtn');
const rainbowBtn = document.getElementById('rainbowBtn');

const CANVAS_W = 600;
const CANVAS_H = 800;

let inputMode = 'text';
let brushColor = '#ff2d78';
const brushRadius = 5;
let isDrawing = false;
let lastX = 0, lastY = 0;
let isRainbow = false;
let rainbowHue = 0;

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

function currentColor() {
  if (isRainbow) {
    rainbowHue = (rainbowHue + 4) % 360;
    return `hsl(${rainbowHue}, 100%, 50%)`;
  }
  return brushColor;
}

function startDraw(e) {
  e.preventDefault();
  isDrawing = true;
  const p = getCanvasPos(e);
  lastX = p.x; lastY = p.y;
  ctx.beginPath();
  ctx.arc(lastX, lastY, brushRadius, 0, Math.PI * 2);
  ctx.fillStyle = currentColor();
  ctx.fill();
}

function draw(e) {
  e.preventDefault();
  if (!isDrawing) return;
  const p = getCanvasPos(e);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = currentColor();
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

function deactivateRainbow() {
  isRainbow = false;
  rainbowBtn.classList.remove('rainbow-active');
}

brushColorInput.addEventListener('input', (e) => {
  brushColor = e.target.value;
  colorPreview.style.background = brushColor;
  deactivateRainbow();
  eraserBtn.classList.remove('eraser-active');
});

eraserBtn.addEventListener('click', () => {
  brushColor = '#ffffff';
  colorPreview.style.background = '#ffffff';
  deactivateRainbow();
  eraserBtn.classList.toggle('eraser-active');
});

rainbowBtn.addEventListener('click', () => {
  isRainbow = !isRainbow;
  rainbowBtn.classList.toggle('rainbow-active', isRainbow);
  eraserBtn.classList.remove('eraser-active');
  if (isRainbow) {
    brushColor = '#ff2d78';
    colorPreview.style.background = brushColor;
  }
});

toggleDraw.addEventListener('click', () => {
  if (inputMode === 'text') {
    inputMode = 'draw';
    toggleDraw.classList.add('active');
    drawSection.classList.remove('hidden');
    composerPill.classList.add('draw-mode');
    charCountWrapper.classList.add('hidden');
    drawControls.classList.remove('hidden');
    expandComposer();
  } else {
    inputMode = 'text';
    toggleDraw.classList.remove('active');
    drawSection.classList.add('hidden');
    composerPill.classList.remove('draw-mode');
    charCountWrapper.classList.remove('hidden');
    drawControls.classList.add('hidden');
    deactivateRainbow();
    eraserBtn.classList.remove('eraser-active');
    messageField.focus();
  }
  updateToggleIcon();
  updateSubmitDisabled();
});

// ── Pill expand / collapse ──
function expandComposer() {
  if (composerPill.classList.contains('active')) return;
  // Pin current height so CSS transition has a start value
  messageField.style.height = messageField.offsetHeight + 'px';
  composerPill.classList.add('active');
  // Let the browser compute the new layout, then animate to expanded height
  requestAnimationFrame(() => {
    messageField.style.height = Math.max(messageField.scrollHeight, 60) + 'px';
  });
}

function collapseComposer() {
  if (inputMode !== 'text') return;
  if (messageField.value.trim()) return;
  messageField.style.height = '22px';
  composerPill.classList.remove('active');
  // After transition, clear inline height so CSS takes over
  setTimeout(() => {
    if (!composerPill.classList.contains('active')) messageField.style.height = '';
  }, 380);
}

// Clicking anywhere on the pill focuses the textarea (expands it)
composerPill.addEventListener('click', (e) => {
  if (!e.target.closest('button')) messageField.focus();
});

messageField.addEventListener('focus', expandComposer);

// Auto-resize textarea on input — bypasses height transition while typing
messageField.addEventListener('input', () => {
  messageField.style.transition = 'none';
  messageField.style.height = 'auto';
  messageField.style.height = messageField.scrollHeight + 'px';
  // Restore transition on next frame so open/close still animates
  requestAnimationFrame(() => { messageField.style.transition = ''; });
  const len = messageField.value.length;
  charCount.textContent = len;
  charCountWrapper.classList.toggle('over', len > 300);
  updateSubmitDisabled();
});

document.addEventListener('click', e => {
  if (composerPill.contains(e.target)) return;
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

function buildDrawingTile(id, data) {
  const liked = (data.likedBy || []).includes(me?.id);
  const likeCount = (data.likedBy || []).length;
  const el = document.createElement('div');
  el.className = 'drawing-tile';
  el.dataset.id = id;
  el.innerHTML = `
    <img class="post-drawing tile-img" src="${data.message || ''}" alt="desenho" loading="lazy" />
    <div class="tile-overlay">
      <button class="tile-like-btn${liked ? ' liked' : ''}" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24"
          fill="${liked ? 'currentColor' : 'none'}"
          stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        ${likeCount > 0 ? `<span class="tile-like-count">${likeCount}</span>` : ''}
      </button>
    </div>
  `;
  el.querySelector('.tile-like-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLike(id, postsMap.get(id) || data);
  });
  seenObserver.observe(el);
  return el;
}

function updateDrawingTile(el, data) {
  const liked = (data.likedBy || []).includes(me?.id);
  const likeCount = (data.likedBy || []).length;
  const btn = el.querySelector('.tile-like-btn');
  if (!btn) return;
  btn.classList.toggle('liked', liked);
  btn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
  let countEl = btn.querySelector('.tile-like-count');
  if (likeCount > 0) {
    if (!countEl) {
      countEl = document.createElement('span');
      countEl.className = 'tile-like-count';
      btn.appendChild(countEl);
    }
    countEl.textContent = likeCount;
  } else {
    countEl?.remove();
  }
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
      headers: { 'Content-Type': 'application/json' },
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
  const liked = (data.likedBy || []).includes(me.id);
  if (data.authorId === me.id && !liked) {
    showConfirmToast('Alguém te ama mais que você?', () => _doLike(id, data, liked), null);
    return;
  }
  await _doLike(id, data, liked);
}

async function _doLike(id, data, liked) {
  const ref = doc(db, POSTS, id);
  try {
    const updates = { likedBy: liked ? arrayRemove(me.id) : arrayUnion(me.id) };
    if (!liked && data.authorId !== me.id) {
      updates.lastLikerName = me.name;
      updates.lastLikerGradient = me.gradient;
      updates.lastLikerId = me.id;
    }
    await updateDoc(ref, updates);
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
      await updateDoc(doc(db, POSTS, id), {
        replyCount: increment(1),
        lastReplyAuthor: me.name,
        lastReplyText: txt.slice(0, 100)
      });
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
    const replyId = d.id;
    const grad = r.gradient?.length === 2 ? gradientCSS(r.gradient) : gradientCSS(['#ff2d78', '#9b59ff']);
    const isMine = r.authorId === me?.id;
    const reported = (r.reportedBy || []).includes(me?.id);
    const liked = (r.likedBy || []).includes(me?.id);
    const likeCount = (r.likedBy || []).length;
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
        <div class="reply-actions">
          <button class="reply-like-btn ${liked ? 'liked' : ''}" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24"
              fill="${liked ? 'currentColor' : 'none'}"
              stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            ${likeCount > 0 ? `<span>${likeCount}</span>` : ''}
          </button>
        </div>
      </div>
      <div class="post-menu">
        <button class="post-menu-btn" type="button" aria-label="mais opções">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.8"/>
            <circle cx="12" cy="12" r="1.8"/>
            <circle cx="12" cy="19" r="1.8"/>
          </svg>
        </button>
        <div class="post-menu-dropdown">
          ${isMine ? `<button class="menu-item menu-danger reply-selfdelete-btn" type="button">Apagar minha resposta</button>` : ''}
          ${!isMine ? `<button class="menu-item reply-report-btn${reported ? ' reported' : ''}" type="button" ${reported ? 'disabled' : ''}>${reported ? 'Reportado' : 'Reportar resposta'}</button>` : ''}
        </div>
      </div>
    `;

    item.querySelector('.reply-like-btn').addEventListener('click', () => toggleReplyLike(id, replyId, r));

    const menuBtn = item.querySelector('.post-menu-btn');
    const menuEl  = item.querySelector('.post-menu');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menuEl.classList.contains('open');
      document.querySelectorAll('.post-menu.open').forEach(m => m.classList.remove('open'));
      if (!isOpen) menuEl.classList.add('open');
    });

    if (isMine) {
      item.querySelector('.reply-selfdelete-btn')?.addEventListener('click', () => {
        menuEl.classList.remove('open');
        selfDeleteReply(id, replyId, item);
      });
    } else {
      item.querySelector('.reply-report-btn')?.addEventListener('click', () => {
        menuEl.classList.remove('open');
        reportReply(id, replyId, r);
      });
    }

    thread.appendChild(item);
  });
}

async function toggleReplyLike(postId, replyId, data) {
  if (!me) return openOnboarding();
  const ref = doc(db, POSTS, postId, 'replies', replyId);
  const liked = (data.likedBy || []).includes(me.id);
  try {
    await updateDoc(ref, { likedBy: liked ? arrayRemove(me.id) : arrayUnion(me.id) });
  } catch (err) {
    console.error('reply like error', err);
  }
}

async function selfDeleteReply(postId, replyId, itemEl) {
  if (!confirm('Apagar sua resposta permanentemente?')) return;
  itemEl.style.opacity = '0.4';
  itemEl.style.pointerEvents = 'none';
  try {
    await deleteDoc(doc(db, POSTS, postId, 'replies', replyId));
    await updateDoc(doc(db, POSTS, postId), { replyCount: increment(-1) });
  } catch {
    itemEl.style.opacity = '';
    itemEl.style.pointerEvents = '';
    showToast('erro ao apagar resposta');
  }
}

async function reportReply(postId, replyId, replyData) {
  if (!me) return openOnboarding();
  if ((replyData.reportedBy || []).includes(me.id)) {
    showToast('você já reportou esta resposta');
    return;
  }
  try {
    await updateDoc(doc(db, POSTS, postId, 'replies', replyId), { reportedBy: arrayUnion(me.id) });
    showToast('resposta reportada');
  } catch {
    showToast('erro ao reportar');
  }
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

  const isGallery = activeTab === 'drawings';
  feed.classList.toggle('feed-gallery', isGallery);

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

  if (isGallery) {
    renderGallery(feed, posts);
  } else {
    renderInto(feed, posts);
  }

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

function renderGallery(container, list) {
  const desiredIds = new Set(list.map(([id]) => id));
  Array.from(container.querySelectorAll('[data-id]')).forEach(child => {
    const id = child.dataset.id;
    if (!desiredIds.has(id) || !child.classList.contains('drawing-tile')) {
      seenObserver.unobserve(child);
      replySubObserver.unobserve(child);
      if (replySubs.has(id)) { replySubs.get(id)(); replySubs.delete(id); }
      child.remove();
      cardElements.delete(id);
    }
  });
  list.forEach(([id, data], idx) => {
    let existing = container.querySelector(`[data-id="${id}"].drawing-tile`);
    if (!existing) {
      existing = buildDrawingTile(id, data);
      cardElements.set(id, existing);
    } else {
      updateDrawingTile(existing, data);
    }
    const postsInContainer = Array.from(container.querySelectorAll('[data-id]'));
    const current = postsInContainer[idx];
    if (current !== existing) container.insertBefore(existing, current || null);
  });
}

function renderInto(container, list) {
  const desiredIds = list.map(([id]) => id);
  Array.from(container.querySelectorAll('[data-id]')).forEach(child => {
    // Remove if not in list OR if it's a gallery tile (wrong type for list mode)
    if (!desiredIds.includes(child.dataset.id) || child.classList.contains('drawing-tile')) {
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
    const base = notifBaseline[id] || { likes: 0, replies: 0, reportNotified: 0, maintainNotified: 0 };
    const likes = othersLikes(data);
    const replies = data.replyCount || 0;
    const reportCount = data.reportedBy?.length || 0;
    const maintainCount = data.maintainedCount || 0;
    if (likes > (base.likes || 0)) unread++;
    if (replies > (base.replies || 0)) unread++;
    if (reportCount >= 3 && reportCount > maintainCount && reportCount > (base.reportNotified || 0)) unread++;
    if (maintainCount > 0 && data.maintainNote && maintainCount >= reportCount && reportCount >= 3 && maintainCount > (base.maintainNotified || 0)) unread++;
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
      replies: data.replyCount || 0,
      reportNotified: data.reportedBy?.length || 0,
      maintainNotified: data.maintainedCount || 0
    };
  });
  saveBaseline(notifBaseline);
  updateNotifications();
}

function nameGradient(name) {
  const palette = ['#ff2d78','#9b59ff','#00d4ff','#ff6ba6','#ffb800','#34e89e','#fc466b','#3f5efb','#d926a9'];
  let h = 0;
  for (const c of (name || '?')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  const i = h % palette.length;
  const j = (i + 3) % palette.length;
  return `linear-gradient(135deg, ${palette[i]} 0%, ${palette[j]} 100%)`;
}

function renderNotifList() {
  notifList.innerHTML = '';
  const own = ownPosts();
  const items = [];

  const heartSVG  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
  const chatSVG   = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
  const alertSVG  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
  const checkSVG  = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  const drawSVG   = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/></svg>`;

  own.forEach(([id, data]) => {
    const base = notifBaseline[id] || { likes: 0, replies: 0, reportNotified: 0, maintainNotified: 0 };
    const likes         = othersLikes(data);
    const replies       = data.replyCount || 0;
    const reportCount   = data.reportedBy?.length || 0;
    const maintainCount = data.maintainedCount || 0;
    const postDate      = data.createdAt?.seconds || 0;
    const isDrawing     = data.type === 'drawing';
    const postPreviewText = isDrawing ? '' : (data.message || '').slice(0, 100);

    if (likes > 0) {
      const hasNew  = likes > (base.likes || 0);
      const liker   = data.lastLikerName || 'alguém';
      const extra   = likes - 1;
      const textHTML = extra > 0
        ? `<strong>${escapeHTML(liker)}</strong> +${extra} curtiram seu post.`
        : `<strong>${escapeHTML(liker)}</strong> curtiu seu post.`;
      const likerGradient = data.lastLikerGradient || null;
      const otherLikerIds = (data.likedBy || [])
        .filter(uid => uid !== me?.id && uid !== data.lastLikerId)
        .slice(-3);
      items.push({ id, postDate, hasNew, icon: heartSVG, type: 'like', avatarName: liker, extra, textHTML, isDrawing, preview: postPreviewText, likerGradient, otherLikerIds });
    }

    if (replies > 0) {
      const hasNew  = replies > (base.replies || 0);
      const author  = data.lastReplyAuthor || 'alguém';
      const extra   = replies - 1;
      const textHTML = extra > 0
        ? `<strong>${escapeHTML(author)}</strong> e mais ${extra} comentaram no seu post.`
        : `<strong>${escapeHTML(author)}</strong> comentou no seu post.`;
      const preview = data.lastReplyText
        ? data.lastReplyText.slice(0, 100)
        : postPreviewText;
      items.push({ id, postDate, hasNew, icon: chatSVG, type: 'comment', avatarName: author, extra, textHTML, isDrawing, preview });
    }

    const isRemoved = reportCount >= 3 && reportCount > maintainCount;
    if (isRemoved) {
      const hasNew = reportCount > (base.reportNotified || 0);
      items.push({ id, postDate, hasNew, icon: alertSVG, type: 'report', avatarName: null, extra: 0, textHTML: 'Seu post recebeu três denúncias e foi retirado para avaliação dos hosts.', isDrawing, preview: postPreviewText });
    }

    const isRestored = reportCount >= 3 && maintainCount >= reportCount && data.maintainNote;
    if (isRestored) {
      const hasNew = maintainCount > (base.maintainNotified || 0);
      items.push({ id, postDate, hasNew, icon: checkSVG, type: 'restore', avatarName: null, extra: 0, textHTML: 'Após análise dos moderadores, seu post voltou ao ar.', isDrawing, preview: (data.maintainNote || '').slice(0, 100) });
    }
  });

  items.sort((a, b) => {
    if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1;
    return b.postDate - a.postDate;
  });

  if (items.length === 0) {
    notifList.innerHTML = '<div class="notif-empty">meio vazio aqui...<br></div>';
    return;
  }

  items.forEach(({ id, hasNew, icon, type, avatarName, extra, textHTML, isDrawing, preview, likerGradient, otherLikerIds }) => {
    const wrap = document.createElement('div');
    wrap.className = `notif-item notif-type-${type}${hasNew ? ' unread' : ''}`;

    let avatarsHTML = '';
    if (avatarName) {
      if (type === 'like' && otherLikerIds?.length > 0) {
        for (const sid of [...otherLikerIds].reverse()) {
          const grad = nameGradient(sid);
          avatarsHTML += `<div class="notif-avatar notif-avatar-secondary" style="background-image:${grad}"></div>`;
        }
      }
      const grad = likerGradient ? gradientCSS(likerGradient) : nameGradient(avatarName);
      avatarsHTML += `<div class="notif-avatar" style="background-image:${grad}">${escapeHTML(avatarName.charAt(0).toUpperCase())}</div>`;
      if (type !== 'like' && extra > 0) avatarsHTML += `<div class="notif-avatar notif-avatar-more">+${extra}</div>`;
    }

    let previewHTML = '';
    if (isDrawing) {
      previewHTML = `<div class="notif-post-preview is-drawing">${drawSVG} desenho</div>`;
    } else if (preview) {
      previewHTML = `<div class="notif-post-preview">${escapeHTML(preview)}${preview.length >= 100 ? '…' : ''}</div>`;
    }

    wrap.innerHTML = `
      <div class="notif-type-chip">${icon}</div>
      <div class="notif-content">
        ${avatarsHTML ? `<div class="notif-avatars">${avatarsHTML}</div>` : ''}
        <p class="notif-text">${textHTML}</p>
        ${previewHTML}
      </div>`;

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
  successToast.classList.remove('hidden');
  successToast.classList.add('show');
  toastTimeout = setTimeout(() => {
    successToast.classList.remove('show');
    successToast.classList.add('hidden');
  }, 2400);
}

const confirmToast = document.getElementById('confirmToast');
function showConfirmToast(text, onYes, onNo) {
  confirmToast.querySelector('.confirm-toast-text').textContent = text;
  confirmToast.querySelector('.confirm-yes').onclick = () => {
    confirmToast.classList.remove('show');
    confirmToast.classList.add('hidden');
    onYes();
  };
  confirmToast.querySelector('.confirm-no').onclick = () => {
    confirmToast.classList.remove('show');
    confirmToast.classList.add('hidden');
    if (onNo) onNo();
  };
  confirmToast.classList.remove('hidden');
  confirmToast.classList.add('show');
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

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { postId, text } = await request.json();
    if (!postId || !/^[a-zA-Z0-9]{10,30}$/.test(postId)) {
      return new Response('Invalid postId', { status: 400 });
    }
    const safeText = typeof text === 'string' ? text.slice(0, 100) : '';

    // 1. Get Google OAuth Token (Requires Firebase Service Account)
    const serviceAccount = env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) : null;
    
    if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
      console.warn("FCM disabled: Missing FIREBASE_SERVICE_ACCOUNT env var.");
      return new Response(JSON.stringify({ success: false, reason: "FCM missing config" }), { status: 200 });
    }

    const token = await getGoogleAuthToken(serviceAccount.client_email, serviceAccount.private_key);

    const projectId = serviceAccount.project_id;

    // 2. Verify that the post exists and has at least one report in Firestore
    const postUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/hangul_messages/${postId}`;
    const postRes = await fetch(postUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!postRes.ok) {
      return new Response(JSON.stringify({ success: false, reason: 'Post not found' }), { status: 200 });
    }
    const postDoc = await postRes.json();
    const reportedBy = postDoc.fields?.reportedBy?.arrayValue?.values;
    if (!reportedBy || reportedBy.length === 0) {
      return new Response(JSON.stringify({ success: false, reason: 'No reports on post' }), { status: 200 });
    }

    // 3. Fetch mod tokens from Firestore (REST API)
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/hangul_fcm_tokens`;
    
    const fsResponse = await fetch(firestoreUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const fsData = await fsResponse.json();
    
    // { fcmToken, docName } — docName é o caminho completo do Firestore (usado para deletar tokens inválidos)
    const tokenDocs = [];
    if (fsData.documents) {
      fsData.documents.forEach(fsDoc => {
        if (fsDoc.fields?.role?.stringValue === 'mod' && fsDoc.fields.token) {
          tokenDocs.push({ fcmToken: fsDoc.fields.token.stringValue, docName: fsDoc.name });
        }
      });
    }

    if (tokenDocs.length === 0) {
      return new Response(JSON.stringify({ success: true, reason: "No mods found" }), { status: 200 });
    }

    // 4. Send Push Notifications via FCM HTTP v1
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    const origin = new URL(request.url).origin;

    // Promise.allSettled garante que um token inválido não cancela os demais
    const fcmResults = await Promise.allSettled(
      tokenDocs.map(({ fcmToken, docName }) =>
        fetch(fcmUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: {
              token: fcmToken,
              notification: {
                title: "Nova Denúncia no Hangul",
                body: safeText || "Um post acaba de ser denunciado."
              },
              webpush: {
                fcm_options: { link: `${origin}/adm/` }
              }
            }
          })
        }).then(res => ({ status: res.status, docName }))
      )
    );

    // Remove tokens obsoletos: FCM retorna 404 para tokens expirados/desregistrados
    const staleDocNames = fcmResults
      .filter(r => r.status === 'fulfilled' && (r.value.status === 404 || r.value.status === 410))
      .map(r => r.value.docName);

    if (staleDocNames.length > 0) {
      await Promise.allSettled(
        staleDocNames.map(docName =>
          fetch(`https://firestore.googleapis.com/v1/${docName}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          })
        )
      );
    }

    const sent = fcmResults.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
    return new Response(JSON.stringify({ success: true, sent, total: tokenDocs.length }), { status: 200 });

  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Minimal JWT Signer for Google Auth in Cloudflare Workers (Edge)
async function getGoogleAuthToken(clientEmail, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const strHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const strClaim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signatureInput = `${strHeader}.${strClaim}`;

  // Parse PEM private key
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  let pemContents = privateKey.replace(pemHeader, "").replace(pemFooter, "");
  pemContents = pemContents.replace(/\s/g, ""); // Remove all whitespace/newlines
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signatureInput));
  const strSignature = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signatureInput}.${strSignature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  return data.access_token;
}
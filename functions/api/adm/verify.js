export async function onRequest(context) {
  const { env, request } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let idToken;
  try {
    const body = await request.json();
    idToken = body?.idToken;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (!idToken) return new Response('Bad Request', { status: 400 });

  // Verify token with Firebase REST API
  let email;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return new Response('Unauthorized', { status: 401 });
    const data = await res.json();
    email = data.users?.[0]?.email;
    if (!email) return new Response('Unauthorized', { status: 401 });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }

  let profiles = [];
  try { profiles = JSON.parse(env.MODERATOR_PROFILES || '[]'); } catch {}

  const profile = profiles.find(p => p.email === email);
  if (!profile) return new Response('Unauthorized', { status: 401 });

  const { email: _e, ...safeProfile } = profile;
  return new Response(JSON.stringify(safeProfile), {
    headers: { 'Content-Type': 'application/json' },
  });
}

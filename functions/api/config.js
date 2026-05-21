export function onRequest(context) {
  const { env } = context;
  let moderatorProfiles = [];
  try { moderatorProfiles = JSON.parse(env.MODERATOR_PROFILES || '[]'); } catch {}
  // Strip email — verified server-side by /api/adm/verify
  const safeProfiles = moderatorProfiles.map(({ email: _e, ...rest }) => rest);
  return new Response(
    JSON.stringify({
      apiKey:             env.FIREBASE_API_KEY,
      authDomain:         env.FIREBASE_AUTH_DOMAIN,
      projectId:          env.FIREBASE_PROJECT_ID,
      storageBucket:      env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId:  env.FIREBASE_MESSAGING_SENDER_ID,
      appId:              env.FIREBASE_APP_ID,
      moderatorProfiles:  safeProfiles,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=3600',
      },
    }
  );
}

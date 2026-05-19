export function onRequest(context) {
  const { env } = context;
  let moderatorProfiles = [];
  try { moderatorProfiles = JSON.parse(env.MODERATOR_PROFILES || '[]'); } catch {}
  return new Response(
    JSON.stringify({
      apiKey:             env.FIREBASE_API_KEY,
      authDomain:         env.FIREBASE_AUTH_DOMAIN,
      projectId:          env.FIREBASE_PROJECT_ID,
      storageBucket:      env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId:  env.FIREBASE_MESSAGING_SENDER_ID,
      appId:              env.FIREBASE_APP_ID,
      moderatorProfiles,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}

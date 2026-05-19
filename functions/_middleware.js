const BLOCKED = new Set([
  '/.dev.vars',
  '/.firebaserc',
  '/firebase.json',
  '/firestore.rules',
]);

export function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  if (BLOCKED.has(pathname)) {
    return new Response('Not Found', { status: 404 });
  }
  return context.next();
}

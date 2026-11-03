const BUCKET = 'my-first-bucket';

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

async function identifyUser(request, env) {
  const auth = request.headers.get('Authorization') || '';

  if (!auth.startsWith('Bearer ')) return null;

  const token = auth.slice(7);
  const apiKey = env.FIREBASE_WEB_API_KEY;

  if (!apiKey) throw new Error('Firebase API key is missing.');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    }
  );

  if (!response.ok) return null;

  const data = await response.json();
  const user = data.users?.[0];

  return user?.localId
    ? { uid: user.localId, token }
    : null;
}

async function isGroupMember(groupId, uid, token, env) {
  const db = (
    env.FIREBASE_DATABASE_URL ||
    'https://smart-learn-hub-73667-default-rtdb.europe-west1.firebasedatabase.app'
  ).replace(/\/+$/, '');

  const response = await fetch(
    `${db}/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(token)}`
  );

  if (!response.ok) return false;

  const member = await response.json();
  return member !== null && member !== false;
}

export async function onRequest({ request, env }) {

  if (request.method === 'GET') {
    return new Response('File URL function is running', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  try {
    const user = await identifyUser(request, env);

    if (!user) {
      return json({ error: 'Authentication required.' }, 401);
    }

    if (!env.DBBYTE_API_KEY) {
      return json({ error: 'DBByte storage is not configured.' }, 500);
    }

    const body = await request.json();
    const key = String(body.key || '');
    const groupId = String(body.groupId || '');

    if (!key || key.startsWith('/') || key.includes('..')) {
      return json({ error: 'Invalid file key.' }, 400);
    }

    if (key.startsWith('private/')) {
      if (!key.startsWith(`private/${user.uid}/`)) {
        return json({ error: 'You cannot access this private file.' }, 403);
      }
    } else if (key.startsWith('group/')) {
      if (!groupId) {
        return json({ error: 'Group ID is required.' }, 400);
      }

      const allowed = await isGroupMember(
        groupId, user.uid, user.token, env
      );

      if (!allowed) {
        return json({ error: 'You are not a member of this group.' }, 403);
      }
    } else {
      return json({ error: 'Invalid file location.' }, 403);
    }

    const expiresIn = Math.min(
      Math.max(Number(body.expiresIn) || 3600, 60),
      604800
    );

    const encodedKey = key
      .split('/')
      .map(encodeURIComponent)
      .join('/');

    const response = await fetch(
      `https://api.dbbyte.com/storage/${BUCKET}/sign/${encodedKey}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.DBBYTE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn })
      }
    );

    const responseText = await response.text();

    let result = {};
    try {
      result = JSON.parse(responseText);
    } catch {}

    if (!response.ok) {
      return json({
        error: `DBByte signing failed (${response.status}): ${
          result.error || responseText || 'Unknown error'
        }`
      }, response.status);
    }

    if (!result.url) {
      return json({
        error: 'DBByte did not return a signed URL.'
      }, 502);
    }

    return json({
      url: result.url,
      expiresIn
    });

  } catch (error) {
    console.error('File URL error:', error);

    return json({
      error: error.message || 'Unexpected file URL error.'
    }, 500);
  }
}
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const FIREBASE_API_KEY_FALLBACK = 'AIzaSyBalfqEksKXbrcfVCqrrWkILx_V7up25Xs';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 180_000;
const MAX_SYSTEM_CHARS = 16_000;
const MAX_IMAGES = 3;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateImageUrl(value) {
  const url = String(value || '').trim();
  if (!url || url.length > MAX_BODY_BYTES) {
    throw inputError('The attached image is missing or too large.');
  }
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Unsupported image URL');
    }
    return url;
  } catch {
    throw inputError('The attached image URL is not valid.');
  }
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || !rawMessages.length || rawMessages.length > 50) {
    throw inputError('The AI request must include between 1 and 50 messages.');
  }
  let imageCount = 0;
  const messages = rawMessages.map((message) => {
    if (!message || typeof message !== 'object') throw inputError('An AI message is malformed.');
    const role = String(message.role || 'user');
    if (!['system', 'user', 'assistant'].includes(role)) throw inputError('An AI message role is not supported.');
    let content = message.content;
    if (typeof content === 'string') {
      if (content.length > MAX_MESSAGE_CHARS) throw inputError('The AI prompt is too long.');
      return { role, content };
    }
    if (!Array.isArray(content)) throw inputError('An AI message has unsupported content.');
    const parts = [];
    let textChars = 0;
    for (const part of content) {
      if (typeof part === 'string') {
        textChars += part.length;
        parts.push({ type: 'text', text: part });
      } else if (part && (part.type === 'text' || typeof part.text === 'string')) {
        const text = String(part.text || '');
        textChars += text.length;
        if (text) parts.push({ type: 'text', text });
      } else if (part && (part.type === 'image_url' || part.image_url)) {
        imageCount += 1;
        parts.push({
          type: 'image_url',
          image_url: { url: validateImageUrl(part.image_url?.url || part.url) }
        });
      }
      if (textChars > MAX_MESSAGE_CHARS) throw inputError('The AI prompt is too long.');
    }
    return { role, content: parts.length ? parts : '' };
  });
  if (!messages.some((message) => message.role === 'user')) {
    throw inputError('The AI request is missing a user message.');
  }
  return { messages, imageCount };
}

function normalizeImageInputs(imageInputs) {
  if (!Array.isArray(imageInputs)) return [];
  return imageInputs.map((image) => validateImageUrl(image?.image_url?.url || image?.url));
}

async function identifyFirebaseUser(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 8192) return null;

  const apiKey = env.FIREBASE_WEB_API_KEY || FIREBASE_API_KEY_FALLBACK;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    }
  );
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  const user = data.users?.[0];
  return user?.localId ? { uid: user.localId } : null;
}

function providerError(responseStatus, providerMessage) {
  if (responseStatus === 401 || responseStatus === 403) {
    return json({ error: 'Groq rejected GROQ_AI_KEY. Check that the deployment secret is valid.' }, 502);
  }
  if (responseStatus === 429) {
    return json({ error: 'The AI provider is rate-limiting requests. Wait briefly, then try again.' }, 429);
  }
  if (responseStatus >= 500) {
    return json({ error: 'The AI provider is temporarily unavailable. Try again shortly.' }, 502);
  }
  const detail = String(providerMessage || '').slice(0, 300);
  return json({
    error: detail
      ? `Groq rejected the AI request: ${detail}`
      : 'Groq rejected the AI request. Check the configured model and prompt.'
  }, 502);
}

export async function handleChatRequest(request, env = {}) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ error: 'Could not read the AI request.' }, 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'The AI request is too large. Reduce the image or document size and try again.' }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'The AI request must contain valid JSON.' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'The AI request is malformed.' }, 400);
  }

  let user;
  try {
    user = await identifyFirebaseUser(request, env);
  } catch {
    return json({ error: 'Could not verify your Firebase sign-in. Try again.' }, 502);
  }
  if (!user) return json({ error: 'Your sign-in is missing or expired. Sign in again, then retry.' }, 401);

  const apiKey = env.GROQ_AI_KEY;
  if (!apiKey) {
    return json({ error: 'AI is not configured. Add GROQ_AI_KEY as a server-side hosting secret.' }, 503);
  }

  let normalized;
  try {
    normalized = normalizeMessages(body.messages);
    let imageUrls = normalizeImageInputs(body.imageInputs);
    const hasEmbeddedImages = normalized.imageCount > 0;
    if (!hasEmbeddedImages && imageUrls.length) {
      const lastUser = [...normalized.messages].reverse().find((message) => message.role === 'user');
      const text = typeof lastUser.content === 'string' ? lastUser.content : '';
      const imageParts = imageUrls.slice(0, MAX_IMAGES).map((url) => ({ type: 'image_url', image_url: { url } }));
      lastUser.content = [...(text ? [{ type: 'text', text }] : []), ...imageParts];
      normalized.imageCount = imageParts.length;
    }
    if (normalized.imageCount > MAX_IMAGES) {
      return json({ error: 'Image analysis supports up to three images per request.' }, 400);
    }
  } catch (error) {
    return json({ error: error.message || 'The AI request is invalid.' }, error.status || 400);
  }

  const mode = String(body.mode || 'chat').slice(0, 40);
  const suppliedSystem = typeof body.system === 'string' ? body.system.trim().slice(0, MAX_SYSTEM_CHARS) : '';
  const systemMessages = normalized.messages
    .filter((message) => message.role === 'system')
    .map((message) => typeof message.content === 'string'
      ? message.content
      : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'))
    .filter(Boolean);
  const instructions = [suppliedSystem, ...systemMessages];
  if (['quiz', 'exam', 'single-quiz', 'extract'].includes(mode)) {
    instructions.push('For this quiz or extraction task, return only valid JSON matching the requested schema. Do not include Markdown fences or extra prose.');
  }
  const userMessages = normalized.messages.filter((message) => message.role !== 'system');
  const providerMessages = [
    { role: 'system', content: instructions.join('\n\n').slice(0, MAX_SYSTEM_CHARS) || 'You are a helpful study assistant.' },
    ...userMessages
  ];

  const hasImages = normalized.imageCount > 0;
  const model = hasImages
    ? String(env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b')
    : String(env.GROQ_MODEL || 'openai/gpt-oss-20b');
  const tokenLimit = mode === 'extract' ? 8192 : ['quiz', 'exam'].includes(mode) ? 4096 : 2048;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);

  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: providerMessages,
        max_completion_tokens: tokenLimit,
        stream: false
      }),
      signal: controller.signal
    });
    const responseText = await response.text();
    let result = {};
    try { result = responseText ? JSON.parse(responseText) : {}; } catch {}
    if (!response.ok) return providerError(response.status, result.error?.message || result.error);
    if (!result.choices?.[0]?.message) {
      return json({ error: 'The AI provider returned an empty response. Try again.' }, 502);
    }
    return json({
      choices: result.choices,
      model: result.model,
      usage: result.usage
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return json({ error: 'The AI request timed out. Try again with a shorter quiz or prompt.' }, 504);
    }
    return json({ error: 'Could not reach the AI provider. Check the hosting network and try again.' }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

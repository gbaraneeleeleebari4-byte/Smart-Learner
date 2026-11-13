import { handleChatRequest } from '../functions/_shared/chat.mjs';

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const headers = new Headers();
    for (const [name, rawValue] of Object.entries(req.headers || {})) {
      if (['host', 'content-length', 'connection', 'transfer-encoding'].includes(name.toLowerCase())) continue;
      const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
      if (typeof value === 'string') headers.set(name, value);
    }
    headers.set('Content-Type', 'application/json');
    const requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const host = req.headers?.host || 'localhost';
    const request = new Request(`https://${host}/api/chat`, {
      method: 'POST',
      headers,
      body: requestBody
    });
    const response = await handleChatRequest(request, process.env);
    response.headers.forEach((value, name) => res.setHeader(name, value));
    return res.status(response.status).send(await response.text());
  } catch (error) {
    console.error('AI proxy error:', error?.message || 'Unexpected error');
    return res.status(500).json({ error: 'The AI proxy could not process this request.' });
  }
}

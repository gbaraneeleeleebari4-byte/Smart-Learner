import assert from 'node:assert/strict';
import { handleChatRequest } from '../functions/_shared/chat.mjs';

const originalFetch = globalThis.fetch;
const fakeEnv = { GROQ_AI_KEY: 'synthetic-test-key' };
const identityUrl = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
let calls = [];
let groqStatus = 200;
let groqBody = { choices: [{ message: { role: 'assistant', content: '{"questions":[]}' } }] };

function request(body = {}, authorization = 'Bearer synthetic-firebase-token', method = 'POST') {
  const headers = authorization ? { Authorization: authorization } : {};
  return new Request('https://smart-learner.test/api/chat', {
    method,
    headers,
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (String(url).startsWith(identityUrl)) return response({ users: [{ localId: 'synthetic-uid' }] });
  if (String(url) === groqUrl) return response(groqBody, groqStatus);
  throw new Error(`Unexpected fetch URL: ${url}`);
};

try {
  calls = [];
  let result = await handleChatRequest(request({ messages: [{ role: 'user', content: 'Quiz?' }] }, ''), fakeEnv);
  assert.equal(result.status, 401, 'anonymous requests must be rejected');
  assert.equal(calls.length, 0, 'anonymous requests must not call Firebase or Groq');

  calls = [];
  result = await handleChatRequest(request({ messages: [{ role: 'user', content: 'Quiz?' }] }), {});
  assert.equal(result.status, 503, 'missing Groq key must be reported as configuration, not success');
  assert.equal(calls.length, 1, 'Firebase identity is checked before provider configuration');

  calls = [];
  groqStatus = 200;
  groqBody = { choices: [{ message: { role: 'assistant', content: '{"questions":[{"q":"2+2?"}]}' } }], model: 'openai/gpt-oss-20b' };
  result = await handleChatRequest(request({
    mode: 'quiz',
    system: 'Return quiz JSON.',
    name: 'Should not be forwarded',
    email: 'private@example.test',
    context: { private: true },
    messages: [{ role: 'user', content: 'Generate a quiz.' }]
  }), fakeEnv);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2, 'authenticated request should verify Firebase and call Groq');
  const upstream = calls.find((call) => call.url === groqUrl);
  assert.ok(upstream, 'Groq should receive the request');
  assert.equal(upstream.options.headers.Authorization, 'Bearer synthetic-test-key');
  const payload = JSON.parse(upstream.options.body);
  assert.equal(payload.model, 'openai/gpt-oss-20b');
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[0].content, /valid JSON/);
  assert.equal(payload.messages.at(-1).content, 'Generate a quiz.');
  assert.equal(payload.max_completion_tokens, 4096);
  assert.equal(JSON.stringify(payload).includes('private@example.test'), false, 'email must not be sent upstream');
  assert.equal(JSON.stringify(payload).includes('Should not be forwarded'), false, 'app metadata must not be sent upstream');
  const responseBody = await result.json();
  assert.equal(responseBody.choices[0].message.content, '{"questions":[{"q":"2+2?"}]}');

  calls = [];
  result = await handleChatRequest(request({
    mode: 'chat',
    messages: [{ role: 'user', content: 'Read this image.' }],
    imageInputs: [{ image_url: { url: 'data:image/png;base64,AA==' } }]
  }), fakeEnv);
  assert.equal(result.status, 200);
  const visionPayload = JSON.parse(calls.find((call) => call.url === groqUrl).options.body);
  assert.equal(visionPayload.model, 'qwen/qwen3.8-27b');
  assert.equal(visionPayload.messages.at(-1).content[1].type, 'image_url');

  calls = [];
  result = await handleChatRequest(request({
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'javascript:alert(1)' } }] }]
  }), fakeEnv);
  assert.equal(result.status, 400, 'unsafe image URLs must be rejected');
  assert.equal(calls.some((call) => call.url === groqUrl), false);

  calls = [];
  groqStatus = 429;
  groqBody = { error: { message: 'rate limit' } };
  result = await handleChatRequest(request({ messages: [{ role: 'user', content: 'Quiz?' }] }), fakeEnv);
  assert.equal(result.status, 429, 'provider rate limiting should be surfaced');
  assert.match((await result.json()).error, /rate-limiting/);

  calls = [];
  result = await handleChatRequest(request({}, 'Bearer synthetic-firebase-token', 'GET'), fakeEnv);
  assert.equal(result.status, 405, 'non-POST requests should be rejected');

  console.log('AI proxy tests passed.');
} finally {
  globalThis.fetch = originalFetch;
}

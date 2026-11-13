# Smart-Learner

Smart-Learner is a static Firebase application. The AI chat and quiz features call a same-origin `/api/chat` endpoint. The endpoint verifies the signed-in Firebase user before it sends a request to Groq; the Groq key stays on the server and is never exposed in the browser.

## Deploy the AI endpoint

The repository contains adapters for both hosting layouts already present in the project:

- **Cloudflare Pages:** `functions/api/chat.js` serves `/api/chat`.
- **Vercel:** `api/chat.js` serves `/api/chat`.

Deploy the repository root so the host can see `index.html` and the matching serverless function directory. The app’s AI requests are same-origin; do not point the browser directly at Groq or a third-party relay.

Configure these variables in the host’s server-side environment for Preview and Production:

- `GROQ_AI_KEY` — required secret containing the Groq API key.
- `FIREBASE_WEB_API_KEY` — recommended; the Firebase Web API key for the same project used by the app. A project-matched fallback is included for the current Firebase configuration.
- `GROQ_MODEL` — optional text model ID. Defaults to `openai/gpt-oss-20b`.
- `GROQ_VISION_MODEL` — optional image-capable model ID. Defaults to `qwen/qwen3.8-27b`; check the [current Groq model catalog](https://console.groq.com/docs/models) because vision model availability can change.

For Cloudflare Pages, add these under the project’s **Settings → Variables and Secrets**. For Vercel, add them under **Project Settings → Environment Variables**. Mark `GROQ_AI_KEY` as a secret, then redeploy so the function receives it. Never add provider keys to `index.html`, commit them, or prefix them as browser/public variables.

## Verify locally

The proxy regression tests use mocked Firebase and Groq responses; they do not make external requests or require real credentials:

```sh
node tests/ai-proxy.test.mjs
node tests/quiz-contract.test.mjs
```

The endpoint requires a user who is signed in through Firebase. If the app reports that AI is not configured, set `GROQ_AI_KEY` in the active hosting environment and redeploy.

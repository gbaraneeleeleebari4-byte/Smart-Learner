import { handleChatRequest } from '../_shared/chat.mjs';

export async function onRequest({ request, env }) {
  return handleChatRequest(request, env);
}

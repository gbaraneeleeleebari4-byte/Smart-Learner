import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const helper = source.match(/^function normalizeQuizQuestion\(question\)\{[\s\S]*?^\}/m)?.[0];
assert.ok(helper, 'shared quiz-question validator must remain defined in index.html');
const sandbox = {};
vm.runInNewContext(helper, sandbox);
const normalize = sandbox.normalizeQuizQuestion;

const valid = normalize({
  q: '  What is 2 + 2?  ',
  options: [' 3 ', '4', '5', '6'],
  answer: 1,
  topic: 'Arithmetic'
});
assert.equal(valid.q, 'What is 2 + 2?');
assert.deepEqual(Array.from(valid.options), ['3', '4', '5', '6']);
assert.equal(valid.answer, 1);

for (const answer of [-1, 1.5, 4, '1', NaN]) {
  assert.equal(normalize({ q: 'Question', options: ['A', 'B', 'C', 'D'], answer }), null,
    `invalid answer ${String(answer)} must be rejected`);
}
assert.equal(normalize({ q: 'Question', options: ['A', 'B', 'C', 'D', 'E'], answer: 0 }), null);
assert.equal(normalize({ q: 'Question', options: ['A', ' '], answer: 0 }), null);
assert.equal(normalize({ q: ' ', options: ['A', 'B'], answer: 0 }), null);

const endpointMatches = source.match(/const AI_ENDPOINTS = \[\{ url: '\/api\/chat'/g) || [];
assert.equal(endpointMatches.length, 1, 'frontend must use only the same-origin AI proxy');
const customQuizStart = source.indexOf('async function generateCustomQuiz(');
const customQuizEnd = source.indexOf('function showPracticeError(', customQuizStart);
const customQuizFlow = source.slice(customQuizStart, customQuizEnd);
assert.match(customQuizFlow, /await callAI\(/, 'personal quiz generation must use the AI proxy caller');
assert.match(customQuizFlow, /arr\.map\(normalizeQuizQuestion\)/, 'personal quiz generation must validate model output');
assert.match(customQuizFlow, /PQ = \{ phase:'run'/, 'valid questions must enter the practice runner');
assert.match(customQuizFlow, /renderPracticeQuestion\(\)/, 'the practice runner must render the first question');
const groupQuizStart = source.indexOf('async function startChatQuiz(');
const groupQuizEnd = source.indexOf('function renderChatQuizSession(', groupQuizStart);
const groupQuizFlow = source.slice(groupQuizStart, groupQuizEnd);
assert.match(groupQuizFlow, /arr\.map\(normalizeQuizQuestion\)/, 'group quizzes must validate model output');
assert.match(groupQuizFlow, /chatQuiz'\)\.set\(session\)/, 'valid group questions must be stored as a runnable session');
const pdfMarker = source.indexOf('AI extracting questions (parallel batches)');
const pdfFlow = source.slice(pdfMarker, source.indexOf('if (!valid.length)', pdfMarker));
assert.match(pdfFlow, /arr\.map\(normalizeQuizQuestion\)/, 'PDF-derived quizzes must validate model output');
const authMatches = source.match(/Authorization':`Bearer \$\{await currentAuthToken\(\)\}`/g) || [];
assert.equal(authMatches.length, 3, 'all three callAI implementations must attach the Firebase ID token');
const firstCallStart = source.indexOf('async function callAI(messages, mode, attachments=[])');
const firstCallEnd = source.indexOf('\nfunction buildUserContext', firstCallStart);
const middleCallStart = source.indexOf('callAI=async function(messages,mode,attachments=[])', firstCallEnd);
const middleCallEnd = source.indexOf('const buildSystemBase=buildSystem', middleCallStart);
const finalCallStart = source.indexOf('callAI=async function(messages,mode,attachments=[])', middleCallEnd);
const finalCallEnd = source.indexOf('const askAIBaseRepair=askAI;', finalCallStart);
for (const callBlock of [
  source.slice(firstCallStart, firstCallEnd),
  source.slice(middleCallStart, middleCallEnd),
  source.slice(finalCallStart, finalCallEnd)
]) {
  assert.doesNotMatch(callBlock, /(?:^|[,{]\s*)(?:prompt|name|email|context|attachments|documentInputs)\s*:/,
    'AI call payloads must not send personal profile or unnecessary attachment metadata');
}
const systemStart = source.indexOf('function buildSystem(mode){');
const systemEnd = source.indexOf('\nfunction extractVoiceMarker', systemStart);
const systemPrompt = source.slice(systemStart, systemEnd);
assert.doesNotMatch(systemPrompt, /buildUserContext|ctx\.(?:name|email|level|xp|streak|accuracy|rank|groups|weakTopics|isAdmin)/,
  'AI system prompts must not include learner identity, progress, group, or admin metadata');
assert.doesNotMatch(source, /script\.google\.com\/macros|\.web\.val\.run/,
  'obsolete external AI endpoints must not remain in the frontend');

console.log('Quiz contract and frontend wiring tests passed.');

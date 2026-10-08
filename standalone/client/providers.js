// The AI connection: provider presets, the player's settings, and the game's 'sample' capability over the relay.
import { N_ } from '../../src/js/i18n.js';
import { sha256Hex } from '../../src/js/util.js';
import { readLines } from '../lines.js';
import { tr } from './i18n.js';
import { post } from './net.js';

// endpoint presets are data; protocol differences live in the relay (../relay.js)
export const PROVIDERS = [
  ['openai', 'OpenAI', 'https://api.openai.com/v1', 'openai'],
  ['anthropic', 'Anthropic', 'https://api.anthropic.com/v1', 'anthropic'],
  ['gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'gemini'],
  ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
  ['groq', 'Groq', 'https://api.groq.com/openai/v1'],
  ['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
  ['mistral', 'Mistral', 'https://api.mistral.ai/v1'],
  ['xai', 'xAI', 'https://api.x.ai/v1'],
  ['together', 'Together', 'https://api.together.ai/v1'],
  ['fireworks', 'Fireworks', 'https://api.fireworks.ai/inference/v1'],
  ['deepinfra', 'DeepInfra', 'https://api.deepinfra.com/v1/openai'],
  ['cerebras', 'Cerebras', 'https://api.cerebras.ai/v1'],
  ['perplexity', 'Perplexity Sonar', 'https://api.perplexity.ai', 'perplexity'],
  ['nvidia', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1'],
  ['huggingface', 'Hugging Face', 'https://router.huggingface.co/v1'],
  ['ollama', 'Ollama', 'http://localhost:11434/v1'],
  ['lmstudio', 'LM Studio', 'http://localhost:1234/v1'],
  ['llamacpp', 'llama.cpp', 'http://localhost:8080/v1'],
  ['vllm', 'vLLM', 'http://localhost:8000/v1'],
  ['azure', 'Azure OpenAI', '', 'azure'],
  ['custom', N_('Custom'), ''],
].map(([id, name, endpoint, protocol = 'compatible']) => ({ id, name, endpoint, protocol }));

const DEFAULTS = {
  provider: 'openai',
  endpoint: PROVIDERS[0].endpoint,
  protocol: 'openai',
  model: '',
  maxTokens: 16384, // reasoning models count their thinking in it
  retries: 0,
  promptBytes: 200000,
  jsonMode: false,
  stream: true,
};
// The connection profiles live on the server (their keys never come back to the page); this is the page's copy.
let profiles = []; // each: name, config and whether it has a key
let active = '';
let blocked = null; // a key or account failure: later calls fail at once until the connection changes
const profileOf = name => profiles.find(p => p.name === name);
export const profileNames = () => profiles.map(p => p.name);
export const activeProfile = () => active;
// a profile's settings, or the defaults for a new one
export const profileConfig = name => ({ ...DEFAULTS, ...(profileOf(name) || {}).config });
export const providerConfig = () => profileConfig(active);
export const profileHasKey = name => !!(profileOf(name) || {}).hasKey;
async function take(path, body) {
  const view = await post(path, body);
  profiles = view.profiles;
  active = view.active;
  blocked = null;
  replay.clear();
}
export const loadConnection = () => take('/api/connection/get', {});
export const useProfile = name => take('/api/connection/use', { name });
export const deleteProfile = name => take('/api/connection/delete', { name });
// saves profile `name` (previous: the one it was, for a rename; none for a new one) and uses it; a blank key keeps its own
export const saveConnection = (name, previous, config, apiKey) =>
  take('/api/connection/set', { name, previous, config, apiKey });
export const providerUsage = { calls: 0, input: 0, output: 0 };
const replay = new Map(); // finished replies the game may ask for again (its cache option), for up to an hour

// What each relay failure says. The game reads codes (prompt.js FATAL, turn.js sampleError): these four keep theirs,
// and the rest become 'sampling_disabled', so the game makes no fallback calls and shows the message as is.
const PASS = new Set(['rate_limited', 'prompt_too_large', 'refused', 'cancelled']);
const BLOCKING = new Set(['not_granted', 'insufficient_credit']);
const TEXT = {
  not_configured: N_('Choose an AI provider and model in Settings to start playing.'),
  no_server: N_('Start the app with npm start, then reload this page.'),
  no_profile: N_('That profile is gone. Choose another in Settings.'),
  invalid_config: N_('Check the endpoint, model and limits in Settings.'),
  not_granted: N_('Authentication failed. Check your API key and access to this model.'),
  insufficient_credit: N_('The API account has insufficient credit or quota.'),
  provider_unavailable: N_('The provider is temporarily unavailable.'),
  invalid_request: N_('The provider rejected this request. Check the endpoint, model, JSON mode and output limit.'),
  no_model: N_('The provider does not know this model ID. Check its exact name in the model list of the provider.'),
  output_limit: N_('The reply hit the output limit. Increase it in Settings.'),
  timeout: N_('The provider timed out.'),
  provider_error: N_('Could not reach the provider. Check your connection and endpoint.'),
  no_vision: N_('Turn on image analysis and choose a vision model in Settings.'),
  bad_image: N_('Use a PNG, JPEG, WebP or GIF image smaller than 8 MB.'),
  rate_limited: N_('The provider rate limit was reached. Wait before trying again.'),
  prompt_too_large: N_('The model context limit was exceeded. Reduce recent memory.'),
  refused: N_('The provider refused this request.'),
  cancelled: N_('Cancelled'),
};
function failure(code) {
  const e = Object.assign(new Error(tr(TEXT[code] || N_('Request failed.'))), {
    code: PASS.has(code) ? code : 'sampling_disabled',
  });
  if (BLOCKING.has(code)) blocked = e;
  return e;
}

// the text of a JSON reply, parsed: fences and talk around it are left for the game's own lenient reading
function parseJson(text) {
  const t = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const o = JSON.parse(t);
    if (o && typeof o === 'object') return o; // some features ask for an array
  } catch {
    // not plain JSON: the game reads e.text more leniently (prompt.js extractJson)
  }
  throw Object.assign(new Error(tr('The reply was not valid JSON.')), { code: 'no_json', text });
}

async function imagePart(blob) {
  if (!providerConfig().vision) throw failure('no_vision');
  if (!(blob instanceof Blob) || blob.size > 8000000 || !/^image\/(png|jpeg|webp|gif)$/.test(blob.type))
    throw failure('bad_image');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { type: blob.type, data: btoa(binary) };
}

// one streamed request to the relay, resolving to the text, the model that answered and the token usage
async function relay(body, signal, onText) {
  const response = await post('/api/sample', body, { signal, raw: true }).catch(e => {
    throw signal.aborted ? e : failure(e.code);
  });
  let text = '',
    result = null;
  await readLines(response.body, line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw failure(event.error.code);
    if (event.text !== undefined) {
      text += event.text;
      if (onText) onText({ text });
    }
    if (event.done) result = { text, modelTierApplied: event.model, usage: event.usage };
  });
  if (!result) throw failure('provider_error');
  return result;
}

export async function sample(prompt, opts = {}) {
  if (blocked) throw blocked;
  if (!providerConfig().model) throw failure('not_configured');
  if (opts.signal && opts.signal.aborted) throw failure('cancelled');
  const quick = opts.modelTier === 'quick'; // Fast: the server uses the summary model when there is one
  const cacheKey =
    opts.cache && !opts.images
      ? await sha256Hex(new Blob([JSON.stringify([providerConfig(), quick, prompt, !!opts.json])]))
      : null;
  const cached = cacheKey && replay.get(cacheKey);
  if (cached && !opts.cache.refresh && cached.until > Date.now()) {
    if (opts.onText) opts.onText({ text: cached.result.text });
    return cached.result;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal) opts.signal.addEventListener('abort', abort, { once: true });
  // given up after a silence a little longer than the server's, however long a slow model keeps streaming
  let timer;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(abort, 310000);
  };
  idle();
  const onText = t => {
    idle();
    if (opts.onText) opts.onText(t);
  };
  try {
    const image = opts.images ? await imagePart(opts.images) : undefined;
    const result = await relay({ prompt, image, json: !!opts.json, quick, profile: active }, controller.signal, onText);
    providerUsage.calls++;
    providerUsage.input += (result.usage && result.usage.input) || 0;
    providerUsage.output += (result.usage && result.usage.output) || 0;
    if (cacheKey) {
      for (const [k, v] of replay) if (v.until < Date.now()) replay.delete(k);
      if (replay.size >= 32) replay.delete(replay.keys().next().value);
      replay.set(cacheKey, { result, until: Date.now() + Math.min(opts.cache.gcTime || 3600000, 3600000) });
    }
    return result;
  } catch (e) {
    if (controller.signal.aborted) throw failure(opts.signal && opts.signal.aborted ? 'cancelled' : 'timeout');
    throw e;
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', abort);
  }
}
sample.json = async (prompt, opts = {}) => parseJson((await sample(prompt, { ...opts, json: true })).text);
sample.limits = async () => {
  const c = providerConfig();
  return { maxPromptBytes: Math.min(c.promptBytes, 2000000), images: !!c.vision }; // the relay's ceiling
};

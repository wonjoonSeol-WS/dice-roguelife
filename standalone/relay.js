import { setTimeout as sleep } from 'node:timers/promises';
import { readLines } from './lines.js';

export const apiError = (code, message) => Object.assign(new Error(message), { code });
export function providerRequest({ config, apiKey = '', prompt, image, json = false }) {
  if (
    !config ||
    typeof prompt !== 'string' ||
    !prompt.trim() ||
    typeof config.model !== 'string' ||
    !config.model.trim()
  )
    throw apiError('invalid_config', 'A model and prompt are required.');
  const protocol = config.protocol || 'compatible';
  if (!['openai', 'compatible', 'anthropic', 'gemini', 'azure', 'perplexity'].includes(protocol))
    throw apiError('invalid_config', 'Unknown API protocol.');
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw apiError('invalid_config', 'Enter a valid API base URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))
  )
    throw apiError('invalid_config', 'Use HTTPS, or HTTP for a local model server.');
  if (!apiKey && !loopback) throw apiError('not_granted', 'An API key is required for this endpoint.');
  if (Buffer.byteLength(prompt) > Math.min(Number(config.promptBytes) || 200000, 2000000))
    throw apiError('prompt_too_large', 'The prompt exceeds your configured byte limit. Reduce recent memory.');
  const max = Math.max(64, Math.min(65536, Number(config.maxTokens) || 4096));
  const stream = config.stream !== false;
  const headers = { 'Content-Type': 'application/json' };
  let url = endpoint.href.replace(/\/$/, ''),
    body;
  if (protocol === 'anthropic') {
    url += '/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: max, stream, messages: [{ role: 'user', content: prompt }] };
  } else if (protocol === 'gemini') {
    url += `/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    headers['x-goog-api-key'] = apiKey;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: max } };
    if (json && config.jsonMode) body.generationConfig.responseMimeType = 'application/json';
  } else {
    if (protocol === 'azure') {
      url += `/openai/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion || '2024-10-21')}`;
      headers['api-key'] = apiKey;
    } else {
      url += protocol === 'perplexity' ? '/v1/sonar' : '/chat/completions';
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    }
    body = { model: config.model, stream, messages: [{ role: 'user', content: prompt }] };
    body[protocol === 'openai' || protocol === 'azure' ? 'max_completion_tokens' : 'max_tokens'] = max;
    if (json && config.jsonMode && !/json array/i.test(prompt)) body.response_format = { type: 'json_object' };
    if (stream && (protocol === 'openai' || config.provider === 'openrouter'))
      body.stream_options = { include_usage: true };
  }
  if (image) {
    if (
      !config.vision ||
      !/^image\/(png|jpeg|webp|gif)$/.test(image.type) ||
      typeof image.data !== 'string' ||
      image.data.length > 11000000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
    )
      throw apiError('invalid_config', 'Invalid image attachment or image analysis is disabled.');
    if (protocol === 'anthropic')
      body.messages[0].content = [
        { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } },
        { type: 'text', text: prompt },
      ];
    else if (protocol === 'gemini')
      body.contents[0].parts.push({ inlineData: { mimeType: image.type, data: image.data } });
    else
      body.messages[0].content = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } },
      ];
  }
  return { url, headers, body, protocol, stream };
}

export function normalizeEvent(protocol, value, streamed = true) {
  if (value.error || value.type === 'error')
    throw apiError('provider_error', 'The provider reported a stream error. Check the model and connection settings.');
  if (protocol === 'anthropic') {
    const usage = value.usage || value.message?.usage;
    return {
      text: streamed
        ? value.delta?.text || ''
        : (value.content || [])
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join(''),
      model: value.model || value.message?.model,
      usage: usage && { input: usage.input_tokens, output: usage.output_tokens },
      refused: value.delta?.stop_reason === 'refusal' || value.stop_reason === 'refusal',
      truncated: value.delta?.stop_reason === 'max_tokens' || value.stop_reason === 'max_tokens',
      complete: value.type === 'message_stop' || !streamed,
    };
  }
  if (protocol === 'gemini') {
    const candidate = value.candidates?.[0];
    return {
      text: (candidate?.content?.parts || [])
        .filter(p => !p.thought && p.text)
        .map(p => p.text)
        .join(''),
      model: value.modelVersion,
      usage: value.usageMetadata && {
        input: value.usageMetadata.promptTokenCount,
        output: value.usageMetadata.candidatesTokenCount,
      },
      refused:
        !!value.promptFeedback?.blockReason ||
        ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(candidate?.finishReason),
      truncated: candidate?.finishReason === 'MAX_TOKENS',
      complete: !!candidate?.finishReason || !streamed,
    };
  }
  const choice = value.choices?.[0],
    message = streamed ? choice?.delta : choice?.message;
  return {
    text: typeof message?.content === 'string' ? message.content : '',
    model: value.model,
    usage: value.usage && { input: value.usage.prompt_tokens, output: value.usage.completion_tokens },
    refused: !!message?.refusal || choice?.finish_reason === 'content_filter',
    truncated: choice?.finish_reason === 'length',
    complete: !!choice?.finish_reason || !streamed,
  };
}

export async function readSSE(body, onValue) {
  let data = [];
  const line = text => {
    if (!text) {
      if (data.length) {
        const payload = data.join('\n');
        data = [];
        if (payload !== '[DONE]') onValue(JSON.parse(payload));
      }
    } else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
  };
  await readLines(body, line);
  line('');
}

export function httpError(status, data = '') {
  let code =
    status === 401 || status === 403
      ? 'not_granted'
      : status === 429
        ? 'rate_limited'
        : status === 402
          ? 'insufficient_credit'
          : status >= 500
            ? 'provider_unavailable'
            : 'invalid_request';
  if (/insufficient_quota|insufficient.*(balance|credit)|credit balance/i.test(data)) code = 'insufficient_credit';
  else if (/context_length|context window|too many tokens/i.test(data)) code = 'prompt_too_large';
  // Gemini answers a bad key with 400, and an unknown model (on every provider) comes back as 404
  else if (/API_KEY_INVALID|API key not valid|invalid.{0,10}api.?key/i.test(data)) code = 'not_granted';
  else if (status === 404 || /model.{0,80}(not found|does not exist|not supported)/i.test(data)) code = 'no_model';
  return apiError(code, `HTTP ${status}`);
}

export async function relaySample(input, emit, signal, fetcher = fetch) {
  const request = providerRequest(input);
  const retries = Math.max(0, Math.min(2, Number(input.config.retries) || 0));
  const body = JSON.stringify(request.body);
  let response;
  for (let attempt = 0; attempt <= retries; attempt++) {
    response = await fetcher(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
      signal,
      redirect: 'error',
    });
    if (response.ok) break;
    const failure = httpError(response.status, await response.text());
    if (attempt === retries || !['rate_limited', 'provider_unavailable'].includes(failure.code)) throw failure;
    await sleep(Math.min(1000 * 2 ** attempt, 4000), undefined, { signal }).catch(() => {
      throw apiError('cancelled', 'Cancelled');
    });
  }
  let model = input.config.model,
    usage = {},
    complete = false,
    size = 0;
  const receive = (value, streamed = request.stream) => {
    const e = normalizeEvent(request.protocol, value, streamed);
    if (e.refused) throw apiError('refused', 'The provider refused this request.');
    if (e.truncated) throw apiError('output_limit', 'The reply hit the output limit. Increase it in Settings.');
    complete ||= e.complete;
    if (e.model) model = e.model;
    if (e.usage) for (const k of ['input', 'output']) if (Number.isFinite(e.usage[k])) usage[k] = e.usage[k];
    if (e.text) {
      size += Buffer.byteLength(e.text);
      if (size > 2000000) throw apiError('output_limit', 'The reply is too large.');
      emit({ text: e.text });
    }
  };
  if (request.stream && response.headers.get('content-type')?.includes('text/event-stream'))
    await readSSE(response.body, receive);
  else receive(await response.json(), false);
  if (!complete || !size) throw apiError('provider_error', 'The provider returned an empty or incomplete reply.');
  emit({ done: true, model, usage });
}

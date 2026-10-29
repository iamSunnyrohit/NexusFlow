import { config } from '../config.js';

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.larp.apiKey}`,
});

export class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function streamChat({ model, messages, temperature, maxTokens, signal, onDelta }) {
  const res = await fetch(`${config.larp.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(temperature != null && { temperature }),
      ...(maxTokens != null && { max_tokens: maxTokens }),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UpstreamError(`LarpRouter ${res.status}: ${text.slice(0, 300)}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let finishReason = null;

  const handleLine = async (line) => {
    if (!line.startsWith('data:')) return false; 
    const data = line.slice(5).trim();
    if (!data) return false;
    if (data === '[DONE]') return true;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return false; 
    }
    if (json.error) throw new UpstreamError(json.error.message || 'Upstream stream error', 502);
    const choice = json.choices?.[0];
    const delta = choice?.delta?.content;
    if (delta) await onDelta(delta); // awaited so token order and persistence stay sequential
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (json.usage) usage = json.usage;
    return false;
  };

  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (await handleLine(line)) {
        done = true;
        break;
      }
    }
  }
  if (!done && buffer.trim()) await handleLine(buffer.trim());

  return { usage, finishReason };
}

export async function completeOnce({ model, messages, temperature = 0, signal }) {
  const res = await fetch(`${config.larp.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });
  if (!res.ok) throw new UpstreamError(`LarpRouter ${res.status}`, res.status);
  const json = await res.json();
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    usage: json.usage || null,
  };
}

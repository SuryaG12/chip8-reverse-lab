/**
 * model.js — optional language-model explanations.
 *
 * The browser sends one trace event to an OpenAI-compatible chat endpoint and
 * asks for JSON statements that cite evidence. The response is parsed here and
 * then passed through verifyExplanation(); unsupported claims are shown as
 * rejected rather than trusted.
 *
 * The API key is only ever a function argument. Nothing in this module writes
 * it to storage.
 */

export const DEFAULT_ENDPOINT = 'https://api.openai.com/v1';

/** The exact JSON contract we ask the model to follow. */
export function buildExplanationPrompt(event) {
  const system = [
    'You explain one executed CHIP-8 instruction using only the supplied trace event.',
    'Reply with JSON only, no prose, in this shape:',
    '{"statements":[{"text":"...","evidence":[...]}]}',
    'Allowed evidence objects:',
    '{"type":"instruction","address":<number>,"opcode":<number>}',
    '{"type":"change","claim":<one object copied exactly from event.changes>}',
    '{"type":"display"}',
    '{"type":"unchanged"}',
    'Use "display" only when event.display is true.',
    'Use "unchanged" only when event.changes is empty and event.display is false.',
    'Cite "instruction" on every statement that describes what the opcode does.',
    'Never invent a register, timer, address, or value that is not in the event.',
    'If a sentence cannot be supported by the event, omit it.',
  ].join('\n');

  return {
    system,
    user: JSON.stringify({ event }, null, 2),
  };
}

/** Strip an optional ```json fence and parse the contract. */
export function parseModelExplanation(text, event) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The model returned an empty response.');
  }

  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw new Error('The model did not return valid JSON.');
  }

  if (!data || !Array.isArray(data.statements)) {
    throw new Error('The response has no "statements" array.');
  }

  const statements = data.statements.map((statement, index) => {
    if (!statement || typeof statement.text !== 'string' || !statement.text.trim()) {
      throw new Error(`Statement ${index + 1} has no text.`);
    }
    if (!Array.isArray(statement.evidence)) {
      throw new Error(`Statement ${index + 1} has no evidence array.`);
    }
    return { text: statement.text.trim(), evidence: statement.evidence };
  });

  return {
    seq: event.seq,
    address: event.address,
    opcode: event.opcode,
    summary: `Model explanation for ${event.text} at 0x${event.address.toString(16).toUpperCase().padStart(3, '0')}.`,
    statements,
  };
}

/**
 * Ask an OpenAI-compatible endpoint to explain one event.
 *
 * @param {{
 *   endpoint?: string,
 *   apiKey: string,
 *   model: string,
 *   event: object,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export async function requestModelExplanation({
  endpoint = DEFAULT_ENDPOINT,
  apiKey,
  model,
  event,
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error('Enter an API key.');
  if (!model) throw new Error('Enter a model name.');
  if (!event) throw new Error('Select a trace entry first.');

  const url = `${String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')}/chat/completions`;
  const { system, user } = buildExplanationPrompt(event);

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // The status code alone is still useful.
    }
    throw new Error(`Model request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return {
    explanation: parseModelExplanation(content, event),
    usage: data?.usage ?? null,
  };
}

/**
 * model.test.js — prompt, parsing and request tests for model explanations.
 * No network calls: fetch is injected.
 */

import { test, assertEqual, assertThrows } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN } from '../src/quirks.js';
import { createTrace, recordStep } from '../src/trace.js';
import { verifyExplanation } from '../src/explain.js';
import {
  buildExplanationPrompt,
  parseModelExplanation,
  requestModelExplanation,
} from '../src/model.js';

function makeEvent(opcode, setup = () => {}) {
  const cpu = new Chip8(MODERN);
  setup(cpu);
  const trace = createTrace();
  const pc = cpu.pc;
  cpu.memory[pc] = (opcode >> 8) & 0xFF;
  cpu.memory[pc + 1] = opcode & 0xFF;
  return recordStep(cpu, trace);
}

const ldEvent = () => makeEvent(0x602A);
const v0Change = (event) => event.changes.find((change) => change.kind === 'reg' && change.target === 'V0');

function fakeFetch(payload, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({
        choices: [{ message: { content: typeof payload === 'string' ? payload : JSON.stringify(payload) } }],
        usage: { total_tokens: 42 },
      }),
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    };
  };
  return { impl, calls };
}

test('the prompt includes the event and the evidence contract', () => {
  const event = ldEvent();
  const { system, user } = buildExplanationPrompt(event);

  assertEqual(system.includes('"type":"change"'), true);
  assertEqual(system.includes('Never invent'), true);
  assertEqual(user.includes('LD V0, 0x2A'), true);
  assertEqual(user.includes('0x2A'), true);
});

test('parseModelExplanation accepts plain and fenced JSON', () => {
  const event = ldEvent();
  const payload = JSON.stringify({
    statements: [{
      text: 'V0 receives 0x2A.',
      evidence: [{ type: 'change', claim: v0Change(event) }],
    }],
  });

  const plain = parseModelExplanation(payload, event);
  assertEqual(plain.statements.length, 1);
  assertEqual(plain.statements[0].text, 'V0 receives 0x2A.');
  assertEqual(plain.address, event.address);
  assertEqual(plain.opcode, event.opcode);

  const fenced = parseModelExplanation(`\`\`\`json\n${payload}\n\`\`\``, event);
  assertEqual(fenced.statements.length, 1);
});

test('parseModelExplanation rejects malformed responses', () => {
  const event = ldEvent();
  assertThrows(() => parseModelExplanation('', event));
  assertThrows(() => parseModelExplanation('not json', event));
  assertThrows(() => parseModelExplanation('{"statements": "nope"}', event));
  assertThrows(() => parseModelExplanation('{"statements":[{"evidence":[]}]}', event));
  assertThrows(() => parseModelExplanation('{"statements":[{"text":"x"}]}', event));
});

test('a model explanation that cites real evidence verifies', () => {
  const event = ldEvent();
  const explanation = parseModelExplanation(JSON.stringify({
    statements: [{
      text: 'V0 changed from 0x00 to 0x2A.',
      evidence: [{ type: 'change', claim: v0Change(event) }],
    }],
  }), event);

  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('a hallucinated model claim is rejected', () => {
  const event = ldEvent();
  const explanation = parseModelExplanation(JSON.stringify({
    statements: [{
      text: 'V7 changed from 0x00 to 0xFF.',
      evidence: [{
        type: 'change',
        claim: { kind: 'reg', target: 'V7', from: 0, to: 0xFF },
      }],
    }],
  }), event);

  const check = verifyExplanation(explanation, event);
  assertEqual(check.ok, false);
  assertEqual(check.unsupported.length, 1);
});

test('requestModelExplanation posts the contract and parses the answer', async () => {
  const event = ldEvent();
  const { impl, calls } = fakeFetch({
    statements: [{
      text: 'V0 changed from 0x00 to 0x2A.',
      evidence: [{ type: 'change', claim: v0Change(event) }],
    }],
  });

  const result = await requestModelExplanation({
    endpoint: 'https://example.com/v1/',
    apiKey: 'test-key',
    model: 'test-model',
    event,
    fetchImpl: impl,
  });

  assertEqual(calls.length, 1);
  assertEqual(calls[0].url, 'https://example.com/v1/chat/completions');
  assertEqual(calls[0].init.method, 'POST');
  assertEqual(calls[0].init.headers.Authorization, 'Bearer test-key');

  const body = JSON.parse(calls[0].init.body);
  assertEqual(body.model, 'test-model');
  assertEqual(body.temperature, 0);
  assertEqual(body.messages[0].role, 'system');

  assertEqual(result.usage.total_tokens, 42);
  assertEqual(verifyExplanation(result.explanation, event).ok, true);
});

test('requestModelExplanation validates its inputs', async () => {
  const event = ldEvent();
  const { impl } = fakeFetch({ statements: [] });

  let failed = false;
  try {
    await requestModelExplanation({ apiKey: '', model: 'm', event, fetchImpl: impl });
  } catch (error) {
    failed = true;
    assertEqual(error.message, 'Enter an API key.');
  }
  assertEqual(failed, true);

  failed = false;
  try {
    await requestModelExplanation({ apiKey: 'k', model: '', event, fetchImpl: impl });
  } catch (error) {
    failed = true;
    assertEqual(error.message, 'Enter a model name.');
  }
  assertEqual(failed, true);
});

test('requestModelExplanation surfaces HTTP errors', async () => {
  const event = ldEvent();
  const { impl } = fakeFetch('unauthorized', 401);

  let message = '';
  try {
    await requestModelExplanation({ apiKey: 'k', model: 'm', event, fetchImpl: impl });
  } catch (error) {
    message = error.message;
  }

  assertEqual(message.includes('401'), true);
  assertEqual(message.includes('unauthorized'), true);
});

test('requestModelExplanation rejects content that is not JSON', async () => {
  const event = ldEvent();
  const { impl } = fakeFetch('I think V0 is 42.');

  let message = '';
  try {
    await requestModelExplanation({ apiKey: 'k', model: 'm', event, fetchImpl: impl });
  } catch (error) {
    message = error.message;
  }

  assertEqual(message, 'The model did not return valid JSON.');
});

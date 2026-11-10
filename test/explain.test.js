/**
 * explain.test.js — tests for evidence-checked explanations.
 */

import { test, assertEqual } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN } from '../src/quirks.js';
import { createTrace, recordStep } from '../src/trace.js';
import { explainEvent, verifyExplanation } from '../src/explain.js';

/** Execute one opcode at the current PC and return its trace event. */
function makeEvent(opcode, setup = () => {}) {
  const cpu = new Chip8(MODERN);
  setup(cpu);
  const trace = createTrace();
  const pc = cpu.pc;
  cpu.memory[pc] = (opcode >> 8) & 0xFF;
  cpu.memory[pc + 1] = opcode & 0xFF;
  return recordStep(cpu, trace);
}

const texts = (explanation) => explanation.statements.map((statement) => statement.text);
const hasText = (explanation, fragment) => texts(explanation).some((text) => text.includes(fragment));

test('an LD explanation cites the opcode and the register change', () => {
  const event = makeEvent(0x602A);
  const explanation = explainEvent(event);

  assertEqual(explanation.seq, 1);
  assertEqual(explanation.summary, 'At 0x200, LD V0, 0x2A executed.');
  assertEqual(hasText(explanation, 'copies the immediate byte 0x2A into V0'), true);
  assertEqual(hasText(explanation, 'V0 changed from 0x00 to 0x2A'), true);
  assertEqual(hasText(explanation, 'PC advanced from 0x200 to 0x202'), true);

  const check = verifyExplanation(explanation, event);
  assertEqual(check.ok, true);
  assertEqual(check.unsupported.length, 0);
});

test('every generated statement carries evidence', () => {
  const event = makeEvent(0xA050);
  const explanation = explainEvent(event);

  assertEqual(explanation.statements.length > 0, true);
  for (const statement of explanation.statements) {
    assertEqual(Array.isArray(statement.evidence), true);
    assertEqual(statement.evidence.length > 0, true);
  }
});

test('a self-jump is explained without inventing a change', () => {
  const event = makeEvent(0x1200);
  const explanation = explainEvent(event);

  assertEqual(hasText(explanation, 'targets its own address'), true);
  assertEqual(hasText(explanation, 'produced no traced state change'), false);
  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('a taken skip is described as a skip', () => {
  const event = makeEvent(0x3105, (cpu) => { cpu.V[1] = 0x05; });
  const explanation = explainEvent(event);

  assertEqual(hasText(explanation, 'PC skipped from 0x200 to 0x204'), true);
  assertEqual(hasText(explanation, 'skips the next instruction'), true);
  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('CALL explains the pushed return address and stack change', () => {
  const event = makeEvent(0x2206);
  const explanation = explainEvent(event);

  assertEqual(hasText(explanation, 'pushes the return address 0x202'), true);
  assertEqual(hasText(explanation, 'stack pointer SP changed from 0 to 1'), true);
  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('FX33 explains each BCD memory write', () => {
  const event = makeEvent(0xF033, (cpu) => {
    cpu.I = 0x300;
    cpu.V[0] = 123;
  });
  const explanation = explainEvent(event);

  assertEqual(hasText(explanation, 'Memory at [300] changed from 0x00 to 0x01'), true);
  assertEqual(hasText(explanation, 'Memory at [301] changed from 0x00 to 0x02'), true);
  assertEqual(hasText(explanation, 'Memory at [302] changed from 0x00 to 0x03'), true);
  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('a waiting FX0A explains that nothing changes yet', () => {
  const event = makeEvent(0xF00A);
  const explanation = explainEvent(event);

  assertEqual(hasText(explanation, 'waiting for a key press'), true);
  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('a draw marks the display evidence', () => {
  const event = makeEvent(0xD015, (cpu) => {
    cpu.I = 0x300;
    cpu.memory[0x300] = 0xF0;
  });
  const explanation = explainEvent(event);

  assertEqual(hasText(explanation, 'display buffer was updated'), true);
  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('the verifier rejects a fabricated register claim', () => {
  const event = makeEvent(0x602A);
  const explanation = explainEvent(event);
  const bad = {
    ...explanation,
    statements: [
      ...explanation.statements,
      {
        text: 'V1 changed from 0x00 to 0x99.',
        evidence: [{ type: 'change', claim: { kind: 'reg', target: 'V1', from: 0, to: 0x99 } }],
      },
    ],
  };

  const check = verifyExplanation(bad, event);
  assertEqual(check.ok, false);
  assertEqual(check.unsupported.length, 1);
  assertEqual(check.unsupported[0], 'V1 changed from 0x00 to 0x99.');
});

test('the verifier rejects a display claim the trace did not record', () => {
  const event = makeEvent(0x602A);
  const bad = {
    address: event.address,
    opcode: event.opcode,
    statements: [
      {
        text: 'The display buffer was updated.',
        evidence: [{ type: 'display' }],
      },
    ],
  };

  assertEqual(verifyExplanation(bad, event).ok, false);
});

test('the verifier rejects a claim about a different instruction', () => {
  const event = makeEvent(0x602A);
  const explanation = explainEvent(event);

  assertEqual(verifyExplanation({ ...explanation, address: 0x300 }, event).ok, false);
  assertEqual(verifyExplanation({ ...explanation, opcode: 0x7001 }, event).ok, false);
});

test('the verifier rejects an "unchanged" claim when state did change', () => {
  const event = makeEvent(0x602A);
  const bad = {
    address: event.address,
    opcode: event.opcode,
    statements: [
      {
        text: 'This instruction produced no traced state change.',
        evidence: [{ type: 'unchanged' }],
      },
    ],
  };

  assertEqual(verifyExplanation(bad, event).ok, false);
});

test('the verifier rejects a statement with no evidence', () => {
  const event = makeEvent(0x602A);
  const bad = {
    address: event.address,
    opcode: event.opcode,
    statements: [{ text: 'Something happened.', evidence: [] }],
  };

  assertEqual(verifyExplanation(bad, event).ok, false);
});

test('the verifier accepts a custom claim that cites a real change', () => {
  const event = makeEvent(0x602A);
  const change = event.changes.find((item) => item.kind === 'reg' && item.target === 'V0');
  const explanation = {
    address: event.address,
    opcode: event.opcode,
    statements: [
      {
        text: 'The immediate value landed in V0.',
        evidence: [{ type: 'change', claim: change }],
      },
    ],
  };

  assertEqual(verifyExplanation(explanation, event).ok, true);
});

test('an unknown evidence type is refused', () => {
  const event = makeEvent(0x602A);
  const bad = {
    address: event.address,
    opcode: event.opcode,
    statements: [{ text: 'Trust me.', evidence: [{ type: 'vibes' }] }],
  };

  assertEqual(verifyExplanation(bad, event).ok, false);
});

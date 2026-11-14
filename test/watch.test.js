/**
 * watch.test.js — watch expression parsing and change detection.
 */

import { assertEqual, test } from './harness.js';
import {
  describeWatch,
  findWatchChanges,
  formatWatchHit,
  formatWatchValue,
  parseWatchInput,
  readWatchValue,
  snapshotWatchValues,
} from '../src/watch.js';

function state({ V = {}, I = 0, memory = {} } = {}) {
  return {
    V: Array.from({ length: 16 }, (_, index) => V[index] ?? 0),
    I,
    memory: Array.from({ length: 0x1000 }, (_, index) => memory[index] ?? 0),
  };
}

test('parseWatchInput accepts registers, I and memory addresses', () => {
  const v0 = parseWatchInput('V0').watch;
  assertEqual(v0.id, 'V0', 'V0 id');
  assertEqual(v0.kind, 'reg', 'V0 kind');
  assertEqual(v0.target, 0, 'V0 target');

  const vf = parseWatchInput('vf');
  assertEqual(vf.watch.id, 'VF', 'vf id');
  assertEqual(vf.watch.target, 15, 'vf target');

  const index = parseWatchInput('I').watch;
  assertEqual(index.id, 'I', 'I id');
  assertEqual(index.kind, 'ireg', 'I kind');

  const prefixed = parseWatchInput('0x2f4').watch;
  assertEqual(prefixed.id, 'M2F4', 'memory id');
  assertEqual(prefixed.kind, 'mem', 'memory kind');
  assertEqual(prefixed.target, 0x2f4, 'memory target');

  assertEqual(parseWatchInput('300').watch.id, 'M300', 'bare address');
  assertEqual(parseWatchInput('0x50').watch.target, 0x50, 'short address');
  assertEqual(parseWatchInput('  v7  ').watch.id, 'V7', 'whitespace');
});

test('parseWatchInput rejects nonsense', () => {
  for (const input of ['', '   ', 'V', 'V10', 'G1', '0x1000', 'hello', '-1']) {
    const result = parseWatchInput(input);
    assertEqual(Boolean(result.error), true, `rejects ${JSON.stringify(input)}`);
    assertEqual(Boolean(result.watch), false, `no watch for ${JSON.stringify(input)}`);
  }
});

test('readWatchValue reads registers, I and memory', () => {
  const machine = state({ V: { 0: 0x42, 15: 0xFF }, I: 0x2EA, memory: { 0x2F4: 0x01 } });

  assertEqual(readWatchValue(machine, { kind: 'reg', target: 0 }), 0x42, 'V0');
  assertEqual(readWatchValue(machine, { kind: 'reg', target: 15 }), 0xFF, 'VF');
  assertEqual(readWatchValue(machine, { kind: 'ireg' }), 0x2EA, 'I');
  assertEqual(readWatchValue(machine, { kind: 'mem', target: 0x2F4 }), 0x01, 'memory');
});

test('findWatchChanges reports only values that moved', () => {
  const watches = [
    { id: 'V0', kind: 'reg', target: 0 },
    { id: 'I', kind: 'ireg' },
    { id: 'M2F4', kind: 'mem', target: 0x2F4 },
  ];
  const before = state({ V: { 0: 0x01 }, I: 0x200, memory: { 0x2F4: 0x00 } });
  const after = state({ V: { 0: 0x33 }, I: 0x200, memory: { 0x2F4: 0x07 } });

  const values = snapshotWatchValues(before, watches);
  const changes = findWatchChanges(after, watches, values);

  assertEqual(changes.length, 2, 'changes');
  assertEqual(changes[0].watch.id, 'V0', 'first');
  assertEqual(changes[0].from, 0x01, 'from');
  assertEqual(changes[0].to, 0x33, 'to');
  assertEqual(changes[1].watch.id, 'M2F4', 'second');
  assertEqual(changes[1].to, 0x07, 'second to');

  assertEqual(findWatchChanges(before, watches, values).length, 0, 'no change');
});

test('watch labels and values are formatted for the UI', () => {
  assertEqual(describeWatch({ kind: 'reg', id: 'V0', target: 0 }), 'V0', 'register label');
  assertEqual(describeWatch({ kind: 'ireg' }), 'I', 'I label');
  assertEqual(describeWatch({ kind: 'mem', target: 0x2F4 }), '0x2F4', 'memory label');
  assertEqual(formatWatchValue({ kind: 'reg' }, 0x42), '0x42', 'byte value');
  assertEqual(formatWatchValue({ kind: 'ireg' }, 0x2EA), '0x2EA', 'index value');
});

test('formatWatchHit describes one or several changes', () => {
  const single = formatWatchHit(
    [{ watch: { kind: 'reg', id: 'V0', target: 0 }, from: 0x42, to: 0x33 }],
    0x21A,
  );
  assertEqual(single, 'Watchpoint: V0 changed 0x42 to 0x33 at 0x21A.', 'single');

  const many = formatWatchHit([
    { watch: { kind: 'reg', id: 'V0', target: 0 }, from: 0x42, to: 0x33 },
    { watch: { kind: 'ireg' }, from: 0x200, to: 0x2EA },
  ], 0x21A);
  assertEqual(many, 'Watchpoints at 0x21A: V0 0x42 to 0x33, I 0x200 to 0x2EA.', 'many');
});

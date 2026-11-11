/**
 * history.test.js — exact step-back snapshots.
 */

import { test, assertEqual } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN } from '../src/quirks.js';
import {
  captureHistoryState,
  createHistory,
  HISTORY_LIMIT,
  restoreHistoryState,
} from '../src/history.js';

function machine() {
  const cpu = new Chip8(MODERN);
  cpu.loadRom(new Uint8Array([0x60, 0x05, 0x70, 0x01, 0xA0, 0x50, 0xD0, 0x15]));
  return cpu;
}

const snapshotOf = (cpu) => ({
  pc: cpu.pc,
  I: cpu.I,
  sp: cpu.sp,
  delayTimer: cpu.delayTimer,
  soundTimer: cpu.soundTimer,
  waitingKey: cpu.waitingKey,
  vblankReady: cpu.vblankReady,
  drawFlag: cpu.drawFlag,
  V: Array.from(cpu.V),
  stack: Array.from(cpu.stack),
  memory: Array.from(cpu.memory),
  display: Array.from(cpu.display),
  keys: Array.from(cpu.keys),
});

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

test('captureHistoryState copies every mutable part of the CPU', () => {
  const cpu = machine();
  cpu.step();
  cpu.setKey(5, true);
  cpu.delayTimer = 7;
  const state = captureHistoryState(cpu);

  cpu.V[0] = 99;
  cpu.memory[0x200] = 0xEE;
  cpu.display[0] = 1;
  cpu.keys[5] = 0;
  cpu.pc = 0x999;

  assertEqual(state.V[0], 5, 'registers must not alias');
  assertEqual(state.memory[0x200], 0x60, 'memory must not alias');
  assertEqual(state.display[0], 0, 'display must not alias');
  assertEqual(state.keys[5], 1, 'keys must not alias');
  assertEqual(state.pc, 0x202);
});

test('restoreHistoryState puts back registers, memory, display and keys', () => {
  const cpu = machine();
  cpu.step();
  cpu.setKey(5, true);
  cpu.delayTimer = 7;
  cpu.display[0] = 1;
  const before = snapshotOf(cpu);
  const state = captureHistoryState(cpu);

  cpu.step();
  cpu.step();
  cpu.setKey(5, false);
  cpu.delayTimer = 0;
  cpu.display[0] = 0;

  restoreHistoryState(cpu, state);

  assertEqual(same(snapshotOf(cpu), before), true);
  assertEqual(cpu.pc, 0x202);
  assertEqual(cpu.V[0], 5);
  assertEqual(cpu.keys[5], 1);
  assertEqual(cpu.delayTimer, 7);
  assertEqual(cpu.display[0], 1);
  assertEqual(cpu.memory[0x200], 0x60);
});

test('one undo restores the state from before the last instruction', () => {
  const cpu = machine();
  const history = createHistory();
  history.record(cpu, { address: cpu.pc });
  cpu.step(); // V0 = 5

  assertEqual(cpu.V[0], 5);
  const entry = history.undo(cpu);

  assertEqual(entry.meta.address, 0x200);
  assertEqual(cpu.pc, 0x200);
  assertEqual(cpu.V[0], 0);
  assertEqual(history.size, 0);
});

test('multiple undos walk backwards in reverse order', () => {
  const cpu = machine();
  const history = createHistory();

  history.record(cpu, { address: cpu.pc });
  cpu.step();
  history.record(cpu, { address: cpu.pc });
  cpu.step();
  history.record(cpu, { address: cpu.pc });
  cpu.step();

  assertEqual(history.size, 3);
  assertEqual(history.undo(cpu).meta.address, 0x204);
  assertEqual(cpu.pc, 0x204);
  assertEqual(history.undo(cpu).meta.address, 0x202);
  assertEqual(cpu.pc, 0x202);
  assertEqual(history.undo(cpu).meta.address, 0x200);
  assertEqual(cpu.pc, 0x200);
  assertEqual(history.undo(cpu), null);
});

test('entries keep trace metadata and peek reads the next one', () => {
  const cpu = machine();
  const history = createHistory();
  history.record(cpu, { address: 0x200, traceLength: 4, traceTotal: 9 });

  assertEqual(history.peek().address, 0x200);
  assertEqual(history.peek().traceLength, 4);
  assertEqual(history.peek().traceTotal, 9);
  assertEqual(history.size, 1);

  history.peek().address = 0x999;
  assertEqual(history.peek().address, 0x200, 'peek must not expose stored metadata');
});

test('the limit drops the oldest entries', () => {
  const cpu = machine();
  const history = createHistory(2);

  cpu.pc = 0x200;
  history.record(cpu, { address: 0x200 });
  cpu.pc = 0x202;
  history.record(cpu, { address: 0x202 });
  cpu.pc = 0x204;
  history.record(cpu, { address: 0x204 });

  assertEqual(history.size, 2);
  assertEqual(history.undo(cpu).meta.address, 0x204);
  assertEqual(history.undo(cpu).meta.address, 0x202);
  assertEqual(history.undo(cpu), null);
  assertEqual(cpu.pc, 0x202);
});

test('clear empties the stack and the default limit is bounded', () => {
  const cpu = machine();
  const history = createHistory();
  history.record(cpu);
  history.record(cpu);
  history.clear();

  assertEqual(history.size, 0);
  assertEqual(history.undo(cpu), null);
  assertEqual(history.peek(), null);
  assertEqual(history.limit, HISTORY_LIMIT);
  assertEqual(HISTORY_LIMIT > 0, true);
});

test('a history of one still works and zero is clamped to one', () => {
  const cpu = machine();
  const history = createHistory(0);
  history.record(cpu);
  history.record(cpu);

  assertEqual(history.limit, 1);
  assertEqual(history.size, 1);
  assertEqual(history.undo(cpu) !== null, true);
});

test('undo restores a pending key wait exactly', () => {
  const cpu = machine();
  cpu.loadRom(new Uint8Array([0xF0, 0x0A]));
  const history = createHistory();
  history.record(cpu);
  cpu.setKey(5, true);
  cpu.step(); // FX0A waits for release: PC stays and waitingKey becomes 5

  assertEqual(cpu.waitingKey, 5);
  assertEqual(cpu.pc, 0x200);
  history.undo(cpu);
  assertEqual(cpu.waitingKey, -1);
  assertEqual(cpu.keys[5], 0);
  assertEqual(cpu.pc, 0x200);
});

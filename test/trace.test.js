/**
 * trace.test.js — unit tests for the evidence trace.
 */

import { test, assertEqual } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN, ORIGINAL_VIP } from '../src/quirks.js';
import {
  buildTraceEvent,
  captureMemoryWrites,
  captureState,
  createTrace,
  describeChanges,
  formatChange,
  recordStep,
} from '../src/trace.js';

const NEW_CPU = () => new Chip8(MODERN);

/** Put an opcode at the current PC and execute it, recording one trace event. */
function run(cpu, opcode, trace = createTrace()) {
  const pc = cpu.pc;
  cpu.memory[pc] = (opcode >> 8) & 0xFF;
  cpu.memory[pc + 1] = opcode & 0xFF;
  return recordStep(cpu, trace);
}

const findChange = (event, kind, target) => (
  event.changes.find((change) => change.kind === kind && (target === undefined || change.target === target))
);

test('captureState copies registers and scalars', () => {
  const cpu = NEW_CPU();
  cpu.V[3] = 0x2A;
  cpu.I = 0x300;
  cpu.delayTimer = 9;

  const state = captureState(cpu);
  assertEqual(state.pc, 0x200);
  assertEqual(state.I, 0x300);
  assertEqual(state.delayTimer, 9);
  assertEqual(state.V[3], 0x2A);

  state.V[3] = 0;
  state.I = 0;
  assertEqual(cpu.V[3], 0x2A, 'snapshot must not alias cpu.V');
  assertEqual(cpu.I, 0x300, 'snapshot must not alias cpu.I');
});

test('LD immediate records the register write and PC advance', () => {
  const cpu = NEW_CPU();
  const event = run(cpu, 0x602A);

  assertEqual(event.address, 0x200);
  assertEqual(event.bytes, '602A');
  assertEqual(event.text, 'LD V0, 0x2A');

  const pc = findChange(event, 'pc');
  assertEqual(pc.from, 0x200);
  assertEqual(pc.to, 0x202);

  const reg = findChange(event, 'reg', 'V0');
  assertEqual(reg.from, 0);
  assertEqual(reg.to, 0x2A);
});

test('a self-jump changes nothing', () => {
  const cpu = NEW_CPU();
  const event = run(cpu, 0x1200);

  assertEqual(event.changes.length, 0);
  assertEqual(event.display, false);
  assertEqual(describeChanges(event), 'no state change');
});

test('a taken skip advances PC by four', () => {
  const cpu = NEW_CPU();
  cpu.V[1] = 0x05;
  const event = run(cpu, 0x3105);

  const pc = findChange(event, 'pc');
  assertEqual(pc.from, 0x200);
  assertEqual(pc.to, 0x204);
});

test('a skip that is not taken advances PC by two', () => {
  const cpu = NEW_CPU();
  const event = run(cpu, 0x3105);

  const pc = findChange(event, 'pc');
  assertEqual(pc.from, 0x200);
  assertEqual(pc.to, 0x202);
});

test('CALL records the stack push and the jump', () => {
  const cpu = NEW_CPU();
  const event = run(cpu, 0x2206);

  assertEqual(findChange(event, 'sp').from, 0);
  assertEqual(findChange(event, 'sp').to, 1);
  assertEqual(findChange(event, 'pc').to, 0x206);
  assertEqual(cpu.stack[0], 0x202);
});

test('FX33 records all three BCD memory writes', () => {
  const cpu = NEW_CPU();
  cpu.I = 0x300;
  cpu.V[0] = 123;

  const event = run(cpu, 0xF033);

  const writes = event.changes.filter((change) => change.kind === 'mem');
  assertEqual(writes.length, 3);
  assertEqual(writes[0].target, '[300]');
  assertEqual(writes[0].to, 1);
  assertEqual(writes[1].to, 2);
  assertEqual(writes[2].to, 3);
});

test('FX55 records register writes', () => {
  const cpu = NEW_CPU();
  cpu.I = 0x300;
  cpu.V[0] = 0x11;
  cpu.V[1] = 0x22;

  const event = run(cpu, 0xF155);
  const writes = event.changes.filter((change) => change.kind === 'mem');

  assertEqual(writes.length, 2);
  assertEqual(writes[0].target, '[300]');
  assertEqual(writes[0].to, 0x11);
  assertEqual(writes[1].target, '[301]');
  assertEqual(writes[1].to, 0x22);
  assertEqual(findChange(event, 'I'), undefined, 'modern FX55 leaves I alone');
});

test('FX55 under the VIP preset also records the I increment', () => {
  const cpu = new Chip8(ORIGINAL_VIP);
  cpu.I = 0x300;
  cpu.V[0] = 0x11;
  cpu.V[1] = 0x22;

  const event = run(cpu, 0xF155);
  const index = findChange(event, 'I');

  assertEqual(index.from, 0x300);
  assertEqual(index.to, 0x302);
});

test('captureMemoryWrites only reports FX33 and FX55 targets', () => {
  const cpu = NEW_CPU();
  cpu.I = 0x300;

  assertEqual(captureMemoryWrites(cpu, 0xF033).length, 3);
  assertEqual(captureMemoryWrites(cpu, 0xF255).length, 3);
  assertEqual(captureMemoryWrites(cpu, 0xF065).length, 0);
  assertEqual(captureMemoryWrites(cpu, 0xD015).length, 0);
});

test('ANNN records the index register change', () => {
  const cpu = NEW_CPU();
  const event = run(cpu, 0xA300);
  const index = findChange(event, 'I');

  assertEqual(index.from, 0);
  assertEqual(index.to, 0x300);
});

test('FX15 records a delay-timer change', () => {
  const cpu = NEW_CPU();
  cpu.V[2] = 0x20;
  const event = run(cpu, 0xF215);
  const timer = findChange(event, 'dt');

  assertEqual(timer.from, 0);
  assertEqual(timer.to, 0x20);
});

test('drawing and clearing mark the display as changed', () => {
  const cpu = NEW_CPU();
  cpu.I = 0x300;
  cpu.memory[0x300] = 0xF0;
  const draw = run(cpu, 0xD015);
  assertEqual(draw.display, true);

  const clear = run(cpu, 0x00E0);
  assertEqual(clear.display, true);
});

test('a stale drawFlag does not mark unrelated instructions', () => {
  const cpu = NEW_CPU();
  cpu.drawFlag = true; // a draw happened but was not painted yet
  const event = run(cpu, 0x1200);

  assertEqual(event.display, false);
});

test('a waiting FX0A retry is recorded with no state change', () => {
  const cpu = NEW_CPU();
  const event = run(cpu, 0xF00A);

  assertEqual(event.text, 'LD V0, K');
  assertEqual(event.changes.length, 0);
  assertEqual(cpu.pc, 0x200, 'PC rewinds so the instruction runs again');
});

test('the trace log numbers events and caps its size', () => {
  const trace = createTrace(3);
  for (let i = 0; i < 5; i++) trace.record({ text: `op ${i}` });

  const entries = trace.snapshot();
  assertEqual(trace.size, 3);
  assertEqual(entries.length, 3);
  assertEqual(entries[0].seq, 3);
  assertEqual(entries[2].seq, 5);
  assertEqual(entries[2].text, 'op 4');
});

test('stats count totals, addresses, transitions, calls and draws', () => {
  const cpu = NEW_CPU();
  const trace = createTrace();

  run(cpu, 0x2206, trace); // CALL 0x206 from 0x200
  run(cpu, 0x1208, trace); // JP 0x208 from 0x206
  run(cpu, 0xD015, trace); // DRW at 0x208

  const stats = trace.stats();
  assertEqual(stats.total, 3);
  assertEqual(stats.retained, 3);
  assertEqual(stats.uniqueAddresses, 3);
  assertEqual(stats.calls, 1);
  assertEqual(stats.draws, 1);
  assertEqual(stats.last.address, 0x208);
  assertEqual(stats.last.seq, 3);

  const call = stats.transitions.find((item) => item.from === 0x200);
  assertEqual(call.to, 0x206);
  assertEqual(call.count, 1);

  const loop = stats.addresses.find((item) => item.address === 0x208);
  assertEqual(loop.count, 1);
  assertEqual(loop.opcode, 0xD015);
});

test('stats keep counting after old entries are evicted', () => {
  const trace = createTrace(3);
  for (let i = 0; i < 5; i++) {
    trace.record({
      address: 0x200,
      opcode: 0x1200,
      changes: [],
      display: false,
      text: 'JP 0x200',
    });
  }

  const stats = trace.stats();
  assertEqual(stats.total, 5);
  assertEqual(stats.retained, 3);
  assertEqual(stats.uniqueAddresses, 1);
  assertEqual(stats.addresses[0].count, 5);
  assertEqual(stats.transitions[0].count, 5);
  assertEqual(stats.transitions[0].from, 0x200);
  assertEqual(stats.transitions[0].to, 0x200);
});

test('clearing the trace resets its stats', () => {
  const trace = createTrace();
  trace.record({
    address: 0x200,
    opcode: 0x1200,
    changes: [],
    display: false,
    text: 'JP 0x200',
  });
  trace.clear();

  const stats = trace.stats();
  assertEqual(stats.total, 0);
  assertEqual(stats.retained, 0);
  assertEqual(stats.uniqueAddresses, 0);
  assertEqual(stats.addresses.length, 0);
  assertEqual(stats.transitions.length, 0);
  assertEqual(stats.calls, 0);
  assertEqual(stats.draws, 0);
  assertEqual(stats.last, null);
});

test('clearing the trace resets numbering', () => {
  const trace = createTrace();
  trace.record({ text: 'a' });
  trace.clear();

  assertEqual(trace.size, 0);
  assertEqual(trace.snapshot().length, 0);
  assertEqual(trace.record({ text: 'b' }).seq, 1);
});

test('recordStep returns the stored event with its sequence number', () => {
  const cpu = NEW_CPU();
  const trace = createTrace();
  const first = run(cpu, 0x6001, trace);
  const second = run(cpu, 0x7001, trace);

  assertEqual(first.seq, 1);
  assertEqual(second.seq, 2);
  assertEqual(trace.snapshot().length, 2);
});

test('formatChange renders registers, addresses and timers', () => {
  assertEqual(formatChange({ kind: 'reg', target: 'VA', from: 0, to: 0x2A }), 'VA 00 → 2A');
  assertEqual(formatChange({ kind: 'mem', target: '[300]', from: 0, to: 5 }), '[300] 00 → 05');
  assertEqual(formatChange({ kind: 'pc', target: 'PC', from: 0x200, to: 0x204 }), 'PC 200 → 204');
  assertEqual(formatChange({ kind: 'I', target: 'I', from: 0x50, to: 0x52 }), 'I 050 → 052');
  assertEqual(formatChange({ kind: 'sp', target: 'SP', from: 0, to: 1 }), 'SP 0 → 1');
  assertEqual(formatChange({ kind: 'dt', target: 'DT', from: 255, to: 254 }), 'DT 255 → 254');
});

test('describeChanges joins evidence and notes display updates', () => {
  assertEqual(
    describeChanges({
      changes: [
        { kind: 'pc', target: 'PC', from: 0x200, to: 0x202 },
        { kind: 'reg', target: 'V0', from: 0, to: 5 },
      ],
      display: false,
    }),
    'PC 200 → 202 · V0 00 → 05',
  );

  assertEqual(
    describeChanges({
      changes: [{ kind: 'pc', target: 'PC', from: 0x200, to: 0x202 }],
      display: true,
    }),
    'PC 200 → 202 · display updated',
  );

  assertEqual(describeChanges({ changes: [], display: true }), 'display updated');
});

test('buildTraceEvent diffs a supplied before-state', () => {
  const cpu = NEW_CPU();
  cpu.V[0] = 0x2A;
  cpu.pc = 0x202;
  const before = { pc: 0x200, I: 0, sp: 0, delayTimer: 0, soundTimer: 0, V: new Array(16).fill(0) };

  const event = buildTraceEvent(before, cpu, 0x602A);
  assertEqual(event.text, 'LD V0, 0x2A');
  assertEqual(findChange(event, 'reg', 'V0').to, 0x2A);
  assertEqual(findChange(event, 'pc').to, 0x202);
});

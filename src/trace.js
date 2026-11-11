/**
 * trace.js — record what each executed instruction actually changed.
 *
 * The trace is the evidence layer for "reverse mode": every entry says which
 * instruction ran, where, and exactly which registers, timers, memory bytes or
 * the display changed as a result. It is pure (no DOM) so the emulator, tests
 * and a future AI explanation layer can all rely on the same events.
 */

import { disassembleOpcode } from './disassembler.js';

/** Default number of events kept in memory. Older events fall off the front. */
export const TRACE_LIMIT = 200;

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');
const regName = (index) => `V${index.toString(16).toUpperCase()}`;

/**
 * Copy the scalar and register state needed to diff one instruction.
 *
 * @param {import('./cpu.js').Chip8} cpu
 * @returns {{ pc: number, I: number, sp: number, delayTimer: number, soundTimer: number, V: number[] }}
 */
export function captureState(cpu) {
  return {
    pc: cpu.pc,
    I: cpu.I,
    sp: cpu.sp,
    delayTimer: cpu.delayTimer,
    soundTimer: cpu.soundTimer,
    V: Array.from(cpu.V),
  };
}

/**
 * Memory addresses an opcode writes to, computed from the *pre-step* CPU.
 * Only FX33 (BCD) and FX55 (store registers) write memory during a step.
 *
 * @param {import('./cpu.js').Chip8} cpu
 * @param {number} opcode
 * @returns {Array<{ address: number, from: number }>}
 */
export function captureMemoryWrites(cpu, opcode) {
  if ((opcode & 0xF000) !== 0xF000) return [];

  const x = (opcode >> 8) & 0xF;
  const nn = opcode & 0xFF;
  const writes = [];
  const sample = (address) => {
    const addr = address & 0xFFF;
    writes.push({ address: addr, from: cpu.memory[addr] });
  };

  if (nn === 0x33) {
    sample(cpu.I);
    sample(cpu.I + 1);
    sample(cpu.I + 2);
  } else if (nn === 0x55) {
    for (let i = 0; i <= x; i++) sample(cpu.I + i);
  }

  return writes;
}

/** Format one change for display, e.g. `V3 00 → 2A` or `PC 200 → 204`. */
export function formatChange({ kind, target, from, to }) {
  switch (kind) {
    case 'pc':
      return `PC ${hex(from, 3)} → ${hex(to, 3)}`;
    case 'I':
      return `I ${hex(from, 3)} → ${hex(to, 3)}`;
    case 'reg':
    case 'mem':
      return `${target} ${hex(from, 2)} → ${hex(to, 2)}`;
    case 'sp':
      return `SP ${from} → ${to}`;
    case 'dt':
      return `DT ${from} → ${to}`;
    case 'st':
      return `ST ${from} → ${to}`;
    default:
      return `${target} ${from} → ${to}`;
  }
}

/** One human-readable line for an event's evidence, or "no state change". */
export function describeChanges(event) {
  const parts = event.changes.map(formatChange);
  if (event.display) parts.push('display updated');
  return parts.length ? parts.join(' · ') : 'no state change';
}

/**
 * Build a trace event by diffing the pre-step snapshot against the CPU's
 * current state. Exported for tests; prefer recordStep() at runtime.
 *
 * @param {ReturnType<typeof captureState>} before
 * @param {import('./cpu.js').Chip8} cpu  state AFTER the step
 * @param {number} opcode
 * @param {Array<{ address: number, from: number }>} [memoryWrites]
 */
export function buildTraceEvent(before, cpu, opcode, memoryWrites = []) {
  const decoded = disassembleOpcode(opcode);
  const changes = [];
  const add = (kind, target, from, to) => {
    if (from !== to) changes.push({ kind, target, from, to });
  };

  add('pc', 'PC', before.pc, cpu.pc);
  for (let index = 0; index < 16; index++) {
    add('reg', regName(index), before.V[index], cpu.V[index]);
  }
  add('I', 'I', before.I, cpu.I);
  add('sp', 'SP', before.sp, cpu.sp);
  add('dt', 'DT', before.delayTimer, cpu.delayTimer);
  add('st', 'ST', before.soundTimer, cpu.soundTimer);

  for (const { address, from } of memoryWrites) {
    add('mem', `[${hex(address, 3)}]`, from, cpu.memory[address]);
  }

  // Detect display writes from the opcode instead of cpu.drawFlag: the flag
  // can still be set from an earlier frame that has not been painted yet
  // (for example when a breakpoint pauses right after a DRW).
  const drew = opcode === 0x00E0
    || ((opcode & 0xF000) === 0xD000 && cpu.pc !== before.pc);

  return {
    address: before.pc,
    opcode,
    bytes: hex(opcode, 4),
    mnemonic: decoded.mnemonic,
    args: decoded.args,
    text: decoded.text,
    changes,
    display: drew,
  };
}

/**
 * Execute one instruction and record its evidence.
 *
 * @param {import('./cpu.js').Chip8} cpu
 * @param {{ record: (event: object) => object }} trace
 * @returns {object} the recorded event
 */
export function recordStep(cpu, trace) {
  const before = captureState(cpu);
  const opcode = cpu.getOpcodeAt(before.pc);
  const memoryWrites = captureMemoryWrites(cpu, opcode);

  cpu.step();

  const event = buildTraceEvent(before, cpu, opcode, memoryWrites);
  return trace.record(event);
}

/**
 * A bounded, ordered log of trace events, plus cumulative session stats.
 *
 * @param {number} [limit]
 */
export function createTrace(limit = TRACE_LIMIT) {
  let entries = [];
  let seq = 0;
  let calls = 0;
  let draws = 0;
  let addressCounts = new Map();
  let transitionCounts = new Map();

  const decrementEvent = (stored) => {
    const address = addressCounts.get(stored.address);
    if (address) {
      address.count -= 1;
      if (address.count <= 0) addressCounts.delete(stored.address);
    }

    const pcChange = (stored.changes || []).find((change) => change.kind === 'pc');
    const nextAddress = pcChange ? pcChange.to : stored.address;
    const key = `${stored.address}>${nextAddress}`;
    const transition = transitionCounts.get(key);
    if (transition) {
      transition.count -= 1;
      if (transition.count <= 0) transitionCounts.delete(key);
    }

    if ((stored.opcode >> 12) === 0x2) calls = Math.max(0, calls - 1);
    if (stored.display) draws = Math.max(0, draws - 1);
  };

  return {
    record(event) {
      seq += 1;
      const stored = { seq, ...event };
      entries.push(stored);
      if (entries.length > limit) entries = entries.slice(entries.length - limit);

      const address = addressCounts.get(stored.address) ?? {
        address: stored.address,
        opcode: stored.opcode,
        count: 0,
        firstSeq: seq,
      };
      address.count += 1;
      address.lastSeq = seq;
      addressCounts.set(stored.address, address);

      const pcChange = (stored.changes || []).find((change) => change.kind === 'pc');
      const nextAddress = pcChange ? pcChange.to : stored.address;
      const transitionKey = `${stored.address}>${nextAddress}`;
      const transition = transitionCounts.get(transitionKey) ?? {
        from: stored.address,
        to: nextAddress,
        count: 0,
      };
      transition.count += 1;
      transitionCounts.set(transitionKey, transition);

      if ((stored.opcode >> 12) === 0x2) calls += 1;
      if (stored.display) draws += 1;

      return stored;
    },

    snapshot() {
      return entries.slice();
    },

    /** Cumulative telemetry for session-level analysis. */
    stats() {
      const last = entries[entries.length - 1];
      return {
        total: seq,
        retained: entries.length,
        uniqueAddresses: addressCounts.size,
        addresses: Array.from(addressCounts.values())
          .map((entry) => ({ ...entry }))
          .sort((a, b) => b.count - a.count || a.address - b.address),
        transitions: Array.from(transitionCounts.values())
          .map((entry) => ({ ...entry }))
          .sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to),
        calls,
        draws,
        last: last
          ? { seq: last.seq, address: last.address, opcode: last.opcode, text: last.text }
          : null,
      };
    },

    /**
     * Rewind the log after stepping back.
     *
     * `length` is the number of retained events to keep and `total` is the
     * cumulative instruction count to restore. Events that already fell out of
     * the retention window cannot be decremented from the counters, but totals
     * and all retained evidence stay consistent.
     *
     * @param {number} length
     * @param {number} [total]
     * @returns {number} how many retained events were removed
     */
    rewindTo(length, total = seq) {
      const targetTotal = Math.max(0, Math.floor(total) || 0);
      // Keep only events at or before the restored cumulative count. This
      // also handles undoing past the retention window, where the retained
      // events are all newer than the restored state.
      const bySequence = entries.filter((entry) => entry.seq <= targetTotal).length;
      const target = Math.max(0, Math.min(Math.floor(length), bySequence, entries.length));
      const removed = entries.length - target;
      const affected = new Set();

      for (let index = entries.length - 1; index >= target; index--) {
        decrementEvent(entries[index]);
        affected.add(entries[index].address);
      }
      if (removed) entries = entries.slice(0, target);

      // The newest event for an address may have just been removed.
      for (const address of affected) {
        const entry = addressCounts.get(address);
        if (!entry) continue;
        for (let index = entries.length - 1; index >= 0; index--) {
          if (entries[index].address === address) {
            entry.lastSeq = entries[index].seq;
            break;
          }
        }
      }

      seq = Math.max(target, targetTotal);
      return removed;
    },

    clear() {
      entries = [];
      seq = 0;
      calls = 0;
      draws = 0;
      addressCounts = new Map();
      transitionCounts = new Map();
    },

    get size() {
      return entries.length;
    },

    /** Cumulative instruction count, including events no longer retained. */
    get total() {
      return seq;
    },
  };
}

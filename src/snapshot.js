/**
 * snapshot.js — save and restore the complete CPU state as plain JSON.
 *
 * A snapshot is deliberately self-contained: full memory (including the font
 * and the loaded ROM), the display buffer, registers, stack, timers and key
 * state. That makes it possible to resume exactly where a breakpoint left off,
 * even in a different tab. Validation is strict so a hand-edited or corrupt
 * file cannot put the CPU into an impossible state.
 */

import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  MAX_ROM_SIZE,
  MEMORY_SIZE,
  STACK_SIZE,
} from './cpu.js';

export const SNAPSHOT_FORMAT = 'chip8-reverse-lab.snapshot';
export const SNAPSHOT_VERSION = 1;

const PIXEL_COUNT = DISPLAY_WIDTH * DISPLAY_HEIGHT;

const isInteger = (value) => Number.isInteger(value);

function checkInteger(errors, name, value, min, max) {
  if (!isInteger(value) || value < min || value > max) {
    errors.push(`cpu.${name} must be an integer from ${min} to ${max}.`);
  }
}

function checkArray(errors, name, value, length, min, max) {
  if (!Array.isArray(value)) {
    errors.push(`cpu.${name} must be an array.`);
    return;
  }
  if (value.length !== length) {
    errors.push(`cpu.${name} must contain exactly ${length} values.`);
    return;
  }
  if (!value.every((item) => isInteger(item) && item >= min && item <= max)) {
    errors.push(`cpu.${name} values must be integers from ${min} to ${max}.`);
  }
}

function validateCpu(cpu) {
  const errors = [];
  if (!cpu || typeof cpu !== 'object') {
    return ['cpu must be an object.'];
  }

  checkInteger(errors, 'pc', cpu.pc, 0, MEMORY_SIZE - 1);
  checkInteger(errors, 'I', cpu.I, 0, MEMORY_SIZE - 1);
  checkInteger(errors, 'sp', cpu.sp, 0, STACK_SIZE);
  checkInteger(errors, 'delayTimer', cpu.delayTimer, 0, 255);
  checkInteger(errors, 'soundTimer', cpu.soundTimer, 0, 255);
  checkInteger(errors, 'waitingKey', cpu.waitingKey, -1, 15);

  checkArray(errors, 'V', cpu.V, 16, 0, 255);
  checkArray(errors, 'stack', cpu.stack, STACK_SIZE, 0, MEMORY_SIZE - 1);
  checkArray(errors, 'memory', cpu.memory, MEMORY_SIZE, 0, 255);
  checkArray(errors, 'display', cpu.display, PIXEL_COUNT, 0, 1);
  checkArray(errors, 'keys', cpu.keys, 16, 0, 1);

  if (typeof cpu.drawFlag !== 'boolean') errors.push('cpu.drawFlag must be a boolean.');
  if (typeof cpu.vblankReady !== 'boolean') errors.push('cpu.vblankReady must be a boolean.');

  return errors;
}

/**
 * Check a parsed snapshot before applying it.
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSnapshot(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['Snapshot must be a JSON object.'] };
  }
  if (data.format !== SNAPSHOT_FORMAT) {
    errors.push(`Unknown snapshot format (expected "${SNAPSHOT_FORMAT}").`);
  }
  if (data.version !== SNAPSHOT_VERSION) {
    errors.push(`Unsupported snapshot version (expected ${SNAPSHOT_VERSION}).`);
  }
  if (data.preset !== null && typeof data.preset !== 'string') {
    errors.push('preset must be a string or null.');
  }

  if (data.rom !== null && data.rom !== undefined) {
    if (typeof data.rom !== 'object' || typeof data.rom.name !== 'string') {
      errors.push('rom.name must be a string.');
    }
    if (!Array.isArray(data.rom.bytes) || data.rom.bytes.length === 0 || data.rom.bytes.length > MAX_ROM_SIZE) {
      errors.push(`rom.bytes must be a non-empty array of at most ${MAX_ROM_SIZE} bytes.`);
    } else if (!data.rom.bytes.every((byte) => isInteger(byte) && byte >= 0 && byte <= 255)) {
      errors.push('rom.bytes values must be integers from 0 to 255.');
    } else if (data.rom.size !== data.rom.bytes.length) {
      errors.push('rom.size must equal the number of ROM bytes.');
    }
  }

  errors.push(...validateCpu(data.cpu));
  return { ok: errors.length === 0, errors };
}

/**
 * Build a JSON-serializable snapshot of the CPU.
 *
 * @param {import('./cpu.js').Chip8} cpu
 * @param {{ rom?: { name: string, size: number, bytes: number[] } | null,
 *           preset?: string | null, createdAt?: Date | string | number }} [options]
 */
export function buildSnapshot(cpu, { rom = null, preset = null, createdAt = new Date() } = {}) {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    createdAt: new Date(createdAt).toISOString(),
    rom: rom
      ? { name: rom.name, size: rom.size, bytes: Array.from(rom.bytes) }
      : null,
    preset,
    cpu: {
      pc: cpu.pc,
      I: cpu.I,
      sp: cpu.sp,
      delayTimer: cpu.delayTimer,
      soundTimer: cpu.soundTimer,
      waitingKey: cpu.waitingKey,
      V: Array.from(cpu.V),
      stack: Array.from(cpu.stack),
      memory: Array.from(cpu.memory),
      display: Array.from(cpu.display),
      keys: Array.from(cpu.keys),
      drawFlag: Boolean(cpu.drawFlag),
      vblankReady: Boolean(cpu.vblankReady),
    },
  };
}

/**
 * Apply a validated snapshot to an existing CPU.
 * Throws with a readable message when the snapshot is invalid.
 *
 * @param {import('./cpu.js').Chip8} cpu
 * @param {object} snapshot
 */
export function applySnapshot(cpu, snapshot) {
  const check = validateSnapshot(snapshot);
  if (!check.ok) {
    throw new Error(`Invalid snapshot: ${check.errors[0]}`);
  }

  const state = snapshot.cpu;
  cpu.pc = state.pc;
  cpu.I = state.I;
  cpu.sp = state.sp;
  cpu.delayTimer = state.delayTimer;
  cpu.soundTimer = state.soundTimer;
  cpu.waitingKey = state.waitingKey;
  cpu.V.set(state.V);
  cpu.stack.set(state.stack);
  cpu.memory.set(state.memory);
  cpu.display.set(state.display);
  cpu.keys.set(state.keys);
  cpu.drawFlag = state.drawFlag;
  cpu.vblankReady = state.vblankReady;

  return cpu;
}

/**
 * A filesystem-safe snapshot name, e.g.
 * `chip8-state-my-rom-20261110-183000Z.json`.
 */
export function snapshotFilename(rom, createdAt = new Date()) {
  const base = (rom?.name || 'session')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'session';

  const stamp = new Date(createdAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');

  return `chip8-state-${base}-${stamp}.json`;
}

function sameBytes(a, b) {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Group changing byte addresses into contiguous ranges. */
function memoryRanges(left, right) {
  const ranges = [];
  let start = -1;

  for (let address = 0; address <= MEMORY_SIZE; address++) {
    const changed = address < MEMORY_SIZE && left[address] !== right[address];
    if (changed && start === -1) {
      start = address;
    } else if (!changed && start !== -1) {
      ranges.push({ start, end: address - 1, count: address - start });
      start = -1;
    }
  }

  return ranges;
}

function displayDiff(left, right) {
  let turnedOn = 0;
  let turnedOff = 0;
  let minX = DISPLAY_WIDTH;
  let minY = DISPLAY_HEIGHT;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < PIXEL_COUNT; index++) {
    if (left[index] === right[index]) continue;
    if (right[index]) turnedOn++;
    else turnedOff++;

    const x = index % DISPLAY_WIDTH;
    const y = Math.floor(index / DISPLAY_WIDTH);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    turnedOn,
    turnedOff,
    changed: turnedOn + turnedOff,
    bounds: maxX >= 0 ? { minX, minY, maxX, maxY } : null,
  };
}

/**
 * Compare two snapshots field by field.
 *
 * Returns only data, so the caller decides how to present it. Both snapshots
 * are validated first; an invalid one throws with a readable message instead of
 * producing a misleading diff.
 *
 * @param {object} a snapshot from `buildSnapshot` or a parsed file
 * @param {object} b snapshot from `buildSnapshot` or a parsed file
 */
export function diffSnapshots(a, b) {
  for (const [label, snapshot] of [['A', a], ['B', b]]) {
    const check = validateSnapshot(snapshot);
    if (!check.ok) {
      throw new Error(`Snapshot ${label} is invalid: ${check.errors[0]}`);
    }
  }

  const left = a.cpu;
  const right = b.cpu;

  const scalars = [
    { name: 'PC', from: left.pc, to: right.pc, hex: true },
    { name: 'I', from: left.I, to: right.I, hex: true },
    { name: 'SP', from: left.sp, to: right.sp, hex: false },
    { name: 'DT', from: left.delayTimer, to: right.delayTimer, hex: false },
    { name: 'ST', from: left.soundTimer, to: right.soundTimer, hex: false },
    { name: 'Wait', from: left.waitingKey, to: right.waitingKey, hex: false },
  ].map((row) => ({ ...row, changed: row.from !== row.to }));

  const registers = left.V.map((from, index) => ({
    name: `V${index.toString(16).toUpperCase()}`,
    from,
    to: right.V[index],
    changed: from !== right.V[index],
  }));

  const pressed = (keys) => keys
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  const keysA = pressed(left.keys);
  const keysB = pressed(right.keys);

  const ranges = memoryRanges(left.memory, right.memory);
  const display = displayDiff(left.display, right.display);
  const stackA = left.stack.slice(0, left.sp);
  const stackB = right.stack.slice(0, right.sp);
  const stackChanged = stackA.length !== stackB.length
    || stackA.some((value, index) => value !== stackB[index]);

  const changedRegisters = registers.filter((row) => row.changed).length;
  const changedScalars = scalars.filter((row) => row.changed).length;
  const memoryBytes = ranges.reduce((sum, range) => sum + range.count, 0);
  const sameRom = sameBytes(a.rom?.bytes, b.rom?.bytes);
  const samePreset = (a.preset ?? null) === (b.preset ?? null);

  return {
    equal: changedRegisters === 0
      && changedScalars === 0
      && memoryBytes === 0
      && display.changed === 0
      && !stackChanged
      && keysA.join() === keysB.join()
      && sameRom
      && samePreset,
    rom: {
      a: a.rom?.name ?? null,
      b: b.rom?.name ?? null,
      sameBytes: sameRom,
    },
    preset: { a: a.preset ?? null, b: b.preset ?? null, same: samePreset },
    createdAt: { a: a.createdAt ?? null, b: b.createdAt ?? null },
    scalars,
    registers,
    stack: {
      changed: stackChanged,
      a: stackA,
      b: stackB,
    },
    keys: {
      added: keysB.filter((key) => !keysA.includes(key)),
      removed: keysA.filter((key) => !keysB.includes(key)),
      changed: keysA.join() !== keysB.join(),
    },
    memory: { bytes: memoryBytes, ranges },
    display,
    counts: {
      registers: changedRegisters,
      scalars: changedScalars,
      memory: memoryBytes,
      pixels: display.changed,
    },
  };
}

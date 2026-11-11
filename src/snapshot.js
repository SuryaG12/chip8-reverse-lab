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

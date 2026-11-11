/**
 * snapshot.test.js — save/load state tests.
 */

import { test, assertEqual, assertThrows } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN, ORIGINAL_VIP } from '../src/quirks.js';
import {
  applySnapshot,
  buildSnapshot,
  snapshotFilename,
  validateSnapshot,
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
} from '../src/snapshot.js';

const FIXED = '2026-11-10T18:30:00.000Z';

function machine() {
  const cpu = new Chip8(MODERN);
  const rom = new Uint8Array([0xA0, 0x50, 0x60, 0x05, 0xD0, 0x15, 0x12, 0x06]);
  cpu.loadRom(rom);
  cpu.step(); // LD I, 0x050
  cpu.step(); // LD V0, 0x05
  cpu.step(); // DRW V0, V1, 5
  cpu.delayTimer = 12;
  cpu.soundTimer = 3;
  cpu.setKey(5, true);
  cpu.waitingKey = 5;
  cpu.vblankReady = true;
  return { cpu, rom };
}

function sampleSnapshot() {
  const { cpu, rom } = machine();
  return buildSnapshot(cpu, {
    rom: { name: 'demo.ch8', size: rom.length, bytes: Array.from(rom) },
    preset: 'modern',
    createdAt: FIXED,
  });
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test('a snapshot carries metadata, ROM bytes and complete CPU state', () => {
  const { cpu, rom } = machine();
  const snapshot = buildSnapshot(cpu, {
    rom: { name: 'demo.ch8', size: rom.length, bytes: Array.from(rom) },
    preset: 'modern',
    createdAt: FIXED,
  });

  assertEqual(snapshot.format, SNAPSHOT_FORMAT);
  assertEqual(snapshot.version, SNAPSHOT_VERSION);
  assertEqual(snapshot.createdAt, FIXED);
  assertEqual(snapshot.preset, 'modern');
  assertEqual(snapshot.rom.name, 'demo.ch8');
  assertEqual(snapshot.rom.size, rom.length);
  assertEqual(snapshot.rom.bytes.join(','), Array.from(rom).join(','));

  assertEqual(snapshot.cpu.pc, cpu.pc);
  assertEqual(snapshot.cpu.I, 0x50);
  assertEqual(snapshot.cpu.delayTimer, 12);
  assertEqual(snapshot.cpu.soundTimer, 3);
  assertEqual(snapshot.cpu.waitingKey, 5);
  assertEqual(snapshot.cpu.V.length, 16);
  assertEqual(snapshot.cpu.stack.length, 16);
  assertEqual(snapshot.cpu.memory.length, 4096);
  assertEqual(snapshot.cpu.display.length, 64 * 32);
  assertEqual(snapshot.cpu.keys.length, 16);
  assertEqual(snapshot.cpu.keys[5], 1);
  assertEqual(snapshot.cpu.drawFlag, true);
  assertEqual(snapshot.cpu.vblankReady, true);
});

test('a snapshot is plain JSON with no functions or typed arrays', () => {
  const snapshot = sampleSnapshot();
  const text = JSON.stringify(snapshot);

  assertEqual(text.includes('function'), false);
  assertEqual(Array.isArray(snapshot.cpu.memory), true);
  assertEqual(Array.isArray(snapshot.cpu.V), true);
  assertEqual(validateSnapshot(JSON.parse(text)).ok, true);
});

test('applying a snapshot restores registers, memory, display and keys', () => {
  const { cpu } = machine();
  const snapshot = sampleSnapshot();
  const target = new Chip8(MODERN);

  applySnapshot(target, snapshot);

  assertEqual(target.pc, cpu.pc);
  assertEqual(target.I, cpu.I);
  assertEqual(target.sp, cpu.sp);
  assertEqual(target.delayTimer, cpu.delayTimer);
  assertEqual(target.soundTimer, cpu.soundTimer);
  assertEqual(target.waitingKey, cpu.waitingKey);
  assertEqual(target.vblankReady, cpu.vblankReady);
  assertEqual(target.drawFlag, cpu.drawFlag);
  assertEqual(Array.from(target.V).join(','), Array.from(cpu.V).join(','));
  assertEqual(Array.from(target.stack).join(','), Array.from(cpu.stack).join(','));
  assertEqual(Array.from(target.memory).join(','), Array.from(cpu.memory).join(','));
  assertEqual(Array.from(target.display).join(','), Array.from(cpu.display).join(','));
  assertEqual(Array.from(target.keys).join(','), Array.from(cpu.keys).join(','));
  assertEqual(target.memory[0x200], 0xA0);
  assertEqual(target.display.includes(1), true);
});

test('a JSON round trip restores the same state', () => {
  const { cpu } = machine();
  const parsed = clone(sampleSnapshot());
  const target = new Chip8(MODERN);

  applySnapshot(target, parsed);

  assertEqual(target.pc, cpu.pc);
  assertEqual(target.memory[0x201], cpu.memory[0x201]);
  assertEqual(target.display[0], cpu.display[0]);
});

test('applying a snapshot leaves the CPU quirks alone', () => {
  const target = new Chip8(ORIGINAL_VIP);
  applySnapshot(target, sampleSnapshot());

  assertEqual(target.quirks.shiftUsesVY, ORIGINAL_VIP.shiftUsesVY);
  assertEqual(target.quirks.jumpUsesVX, ORIGINAL_VIP.jumpUsesVX);
});

test('a power-on snapshot has no ROM and still restores', () => {
  const snapshot = buildSnapshot(new Chip8(MODERN), { createdAt: FIXED });
  assertEqual(snapshot.rom, null);

  const target = new Chip8(MODERN);
  applySnapshot(target, snapshot);
  assertEqual(target.pc, 0x200);
  assertEqual(validateSnapshot(snapshot).ok, true);
});

test('validateSnapshot accepts a well-formed snapshot', () => {
  const check = validateSnapshot(sampleSnapshot());
  assertEqual(check.ok, true);
  assertEqual(check.errors.length, 0);
});

test('validateSnapshot rejects bad envelopes', () => {
  assertEqual(validateSnapshot(null).ok, false);
  assertEqual(validateSnapshot([]).ok, false);

  const wrongFormat = clone(sampleSnapshot());
  wrongFormat.format = 'something-else';
  assertEqual(validateSnapshot(wrongFormat).ok, false);

  const wrongVersion = clone(sampleSnapshot());
  wrongVersion.version = 99;
  assertEqual(validateSnapshot(wrongVersion).ok, false);
});

test('validateSnapshot rejects impossible CPU values', () => {
  const badPc = clone(sampleSnapshot());
  badPc.cpu.pc = 0x1000;
  assertEqual(validateSnapshot(badPc).ok, false);

  const badRegister = clone(sampleSnapshot());
  badRegister.cpu.V[0] = 256;
  assertEqual(validateSnapshot(badRegister).ok, false);

  const shortRegisters = clone(sampleSnapshot());
  shortRegisters.cpu.V.pop();
  assertEqual(validateSnapshot(shortRegisters).ok, false);

  const badPixel = clone(sampleSnapshot());
  badPixel.cpu.display[0] = 2;
  assertEqual(validateSnapshot(badPixel).ok, false);

  const badMemory = clone(sampleSnapshot());
  badMemory.cpu.memory.pop();
  assertEqual(validateSnapshot(badMemory).ok, false);

  const badKey = clone(sampleSnapshot());
  badKey.cpu.keys[0] = 2;
  assertEqual(validateSnapshot(badKey).ok, false);

  const badWait = clone(sampleSnapshot());
  badWait.cpu.waitingKey = 16;
  assertEqual(validateSnapshot(badWait).ok, false);

  const badFlag = clone(sampleSnapshot());
  badFlag.cpu.drawFlag = 'yes';
  assertEqual(validateSnapshot(badFlag).ok, false);
});

test('validateSnapshot rejects inconsistent ROM metadata', () => {
  const badSize = clone(sampleSnapshot());
  badSize.rom.size = 1;
  assertEqual(validateSnapshot(badSize).ok, false);

  const badByte = clone(sampleSnapshot());
  badByte.rom.bytes[0] = 300;
  assertEqual(validateSnapshot(badByte).ok, false);

  const tooBig = clone(sampleSnapshot());
  tooBig.rom.bytes = Array(4097).fill(0);
  tooBig.rom.size = 4097;
  assertEqual(validateSnapshot(tooBig).ok, false);
});

test('applySnapshot throws a readable error for invalid data', () => {
  const bad = clone(sampleSnapshot());
  bad.cpu.pc = -1;

  let message = '';
  try {
    applySnapshot(new Chip8(MODERN), bad);
  } catch (error) {
    message = error.message;
  }

  assertEqual(message.includes('Invalid snapshot'), true);
  assertEqual(message.includes('cpu.pc'), true);
});

test('applySnapshot refuses a non-object', () => {
  assertThrows(() => applySnapshot(new Chip8(MODERN), null));
});

test('snapshot filenames are deterministic and filesystem-safe', () => {
  assertEqual(
    snapshotFilename({ name: 'My ROM (v2).ch8' }, FIXED),
    'chip8-state-my-rom-v2-20261110-183000Z.json',
  );
  assertEqual(
    snapshotFilename({ name: '../../evil.ch8' }, FIXED),
    'chip8-state-evil-20261110-183000Z.json',
  );
  assertEqual(
    snapshotFilename(null, FIXED),
    'chip8-state-session-20261110-183000Z.json',
  );
});

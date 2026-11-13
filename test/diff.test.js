/**
 * diff.test.js — compare two saved snapshots.
 */

import { assertEqual, assertThrows, test } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN } from '../src/quirks.js';
import {
  buildSnapshot,
  diffSnapshots,
  SNAPSHOT_VERSION,
} from '../src/snapshot.js';

const FIXED = '2026-11-10T18:30:00.000Z';

function machine() {
  const cpu = new Chip8(MODERN);
  const rom = new Uint8Array([0x60, 0x05, 0x61, 0x06]);
  cpu.loadRom(rom);
  cpu.step(); // LD V0, 0x05
  return { cpu, rom };
}

function snap(cpu, rom, overrides = {}) {
  return buildSnapshot(cpu, {
    rom: { name: 'demo.ch8', size: rom.length, bytes: Array.from(rom) },
    preset: 'modern',
    createdAt: FIXED,
    ...overrides,
  });
}

test('diffSnapshots reports no changes for identical states', () => {
  const { cpu, rom } = machine();
  const diff = diffSnapshots(snap(cpu, rom), snap(cpu, rom));

  assertEqual(diff.equal, true, 'equal');
  assertEqual(diff.counts.registers, 0, 'registers');
  assertEqual(diff.counts.scalars, 0, 'scalars');
  assertEqual(diff.counts.memory, 0, 'memory');
  assertEqual(diff.counts.pixels, 0, 'pixels');
  assertEqual(diff.memory.ranges.length, 0, 'ranges');
  assertEqual(diff.rom.sameBytes, true, 'same rom');
});

test('diffSnapshots lists changed registers and scalars', () => {
  const { cpu, rom } = machine();
  const before = snap(cpu, rom);

  cpu.V[0] = 9;
  cpu.V[5] = 0xAB;
  cpu.pc = 0x244;
  cpu.I = 0x300;
  cpu.delayTimer = 40;

  const diff = diffSnapshots(before, snap(cpu, rom));

  assertEqual(diff.equal, false, 'equal');
  assertEqual(diff.counts.registers, 2, 'registers');
  assertEqual(diff.counts.scalars, 3, 'scalars');

  const v0 = diff.registers.find((row) => row.name === 'V0');
  assertEqual(v0.from, 5, 'V0 from');
  assertEqual(v0.to, 9, 'V0 to');
  assertEqual(v0.changed, true, 'V0 changed');

  const v1 = diff.registers.find((row) => row.name === 'V1');
  assertEqual(v1.changed, false, 'V1 unchanged');

  const pc = diff.scalars.find((row) => row.name === 'PC');
  assertEqual(pc.from, 0x202, 'PC from');
  assertEqual(pc.to, 0x244, 'PC to');
  assertEqual(pc.hex, true, 'PC is hex');
});

test('diffSnapshots groups changed memory into contiguous ranges', () => {
  const { cpu, rom } = machine();
  const before = snap(cpu, rom);

  cpu.memory[0x300] = 0xAA;
  cpu.memory[0x301] = 0xBB;
  cpu.memory[0x302] = 0xCC;
  cpu.memory[0x400] = 0xDD;

  const diff = diffSnapshots(before, snap(cpu, rom));

  assertEqual(diff.counts.memory, 4, 'bytes');
  assertEqual(diff.memory.ranges.length, 2, 'ranges');
  assertEqual(diff.memory.ranges[0].start, 0x300, 'first start');
  assertEqual(diff.memory.ranges[0].end, 0x302, 'first end');
  assertEqual(diff.memory.ranges[0].count, 3, 'first count');
  assertEqual(diff.memory.ranges[1].start, 0x400, 'second start');
});

test('diffSnapshots counts pixels turned on and off', () => {
  const { cpu, rom } = machine();
  const before = snap(cpu, rom);
  const after = snap(cpu, rom);

  after.cpu.display[0] = 1; // off to on
  after.cpu.display[65] = 1; // off to on
  before.cpu.display[2] = 1; // on to off

  const diff = diffSnapshots(before, after);

  assertEqual(diff.display.turnedOn, 2, 'turned on');
  assertEqual(diff.display.turnedOff, 1, 'turned off');
  assertEqual(diff.display.changed, 3, 'changed');
  assertEqual(diff.display.bounds.minX, 0, 'min x');
  assertEqual(diff.display.bounds.maxX, 2, 'max x');
  assertEqual(diff.display.bounds.minY, 0, 'min y');
  assertEqual(diff.display.bounds.maxY, 1, 'max y');
  assertEqual(diff.counts.pixels, 3, 'pixel count');
});

test('diffSnapshots reports keys added and released', () => {
  const { cpu, rom } = machine();
  cpu.setKey(1, true);
  const before = snap(cpu, rom);

  cpu.setKey(1, false);
  cpu.setKey(4, true);
  const diff = diffSnapshots(before, snap(cpu, rom));

  assertEqual(diff.keys.changed, true, 'changed');
  assertEqual(diff.keys.added.join(), '4', 'added');
  assertEqual(diff.keys.removed.join(), '1', 'removed');
});

test('diffSnapshots ignores unused stack slots', () => {
  const { cpu, rom } = machine();
  const before = snap(cpu, rom);
  cpu.stack[5] = 0x300; // stale value below the stack pointer
  const diff = diffSnapshots(before, snap(cpu, rom));

  assertEqual(diff.stack.changed, false, 'stack');
  assertEqual(diff.equal, true, 'equal');
});

test('diffSnapshots reports a deeper stack', () => {
  const { cpu, rom } = machine();
  const before = snap(cpu, rom);
  cpu.stack[0] = 0x244;
  cpu.sp = 1;
  const diff = diffSnapshots(before, snap(cpu, rom));

  assertEqual(diff.stack.changed, true, 'stack');
  assertEqual(diff.stack.b.length, 1, 'depth');
  assertEqual(diff.stack.b[0], 0x244, 'entry');
});

test('diffSnapshots flags a different ROM or preset', () => {
  const { cpu, rom } = machine();
  const other = new Uint8Array([0x60, 0x07]);

  const diff = diffSnapshots(
    snap(cpu, rom),
    snap(cpu, other, { preset: 'vip' }),
  );

  assertEqual(diff.rom.a, 'demo.ch8', 'rom a');
  assertEqual(diff.rom.sameBytes, false, 'same bytes');
  assertEqual(diff.preset.same, false, 'same preset');
  assertEqual(diff.equal, false, 'equal');
});

test('diffSnapshots rejects an invalid snapshot', () => {
  const { cpu, rom } = machine();
  const broken = snap(cpu, rom);
  broken.cpu.V = [1, 2];

  assertThrows(() => diffSnapshots(snap(cpu, rom), broken), 'invalid B');
  assertThrows(() => diffSnapshots({ version: SNAPSHOT_VERSION }, snap(cpu, rom)), 'invalid A');
});

/**
 * cpu.test.js — unit tests for the CHIP-8 CPU core.
 *
 * Each test builds a tiny program out of opcodes, runs it one step at a time,
 * then checks registers / memory / display.
 */

import { test, assertEqual, assertThrows } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN, ORIGINAL_VIP } from '../src/quirks.js';
import { FONT_START } from '../src/fontset.js';

/** Make a CPU, load a program given as an array of 16-bit opcodes. */
function makeCpu(opcodes, quirks = MODERN) {
  const cpu = new Chip8(quirks);
  const bytes = new Uint8Array(opcodes.length * 2);
  opcodes.forEach((op, i) => {
    bytes[i * 2] = op >> 8;      // high byte first
    bytes[i * 2 + 1] = op & 0xFF;
  });
  cpu.loadRom(bytes);
  return cpu;
}

/** Execute n instructions. */
function run(cpu, n) {
  for (let i = 0; i < n; i++) cpu.step();
}

// ---------------------------------------------------------------- power-on

test('power-on state: PC at 0x200, font loaded at 0x050', () => {
  const cpu = new Chip8();
  assertEqual(cpu.pc, 0x200, 'pc');
  assertEqual(cpu.memory[FONT_START], 0xF0, 'first byte of "0"');
  assertEqual(cpu.memory[FONT_START + 79], 0x80, 'last byte of "F"');
  assertEqual(cpu.display.length, 64 * 32, 'display size');
});

test('loadRom rejects a ROM that is too big', () => {
  assertThrows(() => new Chip8().loadRom(new Uint8Array(4000)));
});

test('getState returns a snapshot, not live references', () => {
  const cpu = makeCpu([0x6A2B]);
  cpu.step();
  const s = cpu.getState();
  assertEqual(s.V[0xA], 0x2B, 'VA');
  assertEqual(s.pc, 0x202, 'pc');
  s.V[0xA] = 0; // changing the snapshot must not change the CPU
  assertEqual(cpu.V[0xA], 0x2B, 'cpu VA unchanged');
});

// ------------------------------------------------------- flow control

test('6XNN sets a register, 7XNN adds and wraps without touching VF', () => {
  const cpu = makeCpu([0x6F09, 0x60FF, 0x7002]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 0x01, 'V0 wrapped');
  assertEqual(cpu.V[0xF], 9, 'VF untouched');
});

test('1NNN jumps', () => {
  const cpu = makeCpu([0x1300]);
  cpu.step();
  assertEqual(cpu.pc, 0x300);
});

test('2NNN calls and 00EE returns', () => {
  // 0x200: call 0x206 | 0x202: V1=1 | 0x204: loop | 0x206: V0=2 | 0x208: return
  const cpu = makeCpu([0x2206, 0x6101, 0x1204, 0x6002, 0x00EE]);
  run(cpu, 3); // call, V0=2, return
  assertEqual(cpu.V[0], 2, 'V0');
  assertEqual(cpu.pc, 0x202, 'returned to after the call');
  assertEqual(cpu.sp, 0, 'stack empty again');
  cpu.step();
  assertEqual(cpu.V[1], 1, 'execution continued after the call');
});

test('00EE with an empty stack throws and keeps PC on the bad instruction', () => {
  const cpu = makeCpu([0x00EE]);
  assertThrows(() => cpu.step());
  assertEqual(cpu.pc, 0x200, 'pc');
});

test('unknown opcode throws', () => {
  const cpu = makeCpu([0x5001]);
  assertThrows(() => cpu.step());
  assertEqual(cpu.pc, 0x200, 'pc');
});

test('3XNN skips when equal', () => {
  const cpu = makeCpu([0x6005, 0x3005, 0x6101, 0x6202]);
  run(cpu, 3);
  assertEqual(cpu.V[1], 0, 'skipped');
  assertEqual(cpu.V[2], 2, 'next one ran');
});

test('4XNN skips when not equal', () => {
  const cpu = makeCpu([0x6005, 0x4006, 0x6101, 0x6202]);
  run(cpu, 3);
  assertEqual(cpu.V[1], 0, 'skipped');
  assertEqual(cpu.V[2], 2, 'next one ran');
});

test('5XY0 skips when registers equal', () => {
  const cpu = makeCpu([0x6001, 0x6101, 0x5010, 0x6205, 0x6306]);
  run(cpu, 4);
  assertEqual(cpu.V[2], 0, 'skipped');
  assertEqual(cpu.V[3], 6, 'next one ran');
});

test('9XY0 skips when registers differ', () => {
  const cpu = makeCpu([0x6001, 0x6102, 0x9010, 0x6305, 0x6406]);
  run(cpu, 4);
  assertEqual(cpu.V[3], 0, 'skipped');
  assertEqual(cpu.V[4], 6, 'next one ran');
});

test('BNNN jumps to NNN + V0 by default', () => {
  const cpu = makeCpu([0x6005, 0x6307, 0xB300]);
  run(cpu, 3);
  assertEqual(cpu.pc, 0x305);
});

test('BNNN uses VX when jumpUsesVX is on', () => {
  const cpu = makeCpu([0x6005, 0x6307, 0xB300], { ...MODERN, jumpUsesVX: true });
  run(cpu, 3);
  assertEqual(cpu.pc, 0x307); // 0x300 + V3
});

// ------------------------------------------------------- arithmetic

test('8XY4 add sets carry', () => {
  const cpu = makeCpu([0x60FF, 0x6102, 0x8014]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 0x01, 'V0');
  assertEqual(cpu.V[0xF], 1, 'carry');
});

test('8XY4 with X = F: the flag wins over the result', () => {
  const cpu = makeCpu([0x6F80, 0x6080, 0x8F04]);
  run(cpu, 3);
  assertEqual(cpu.V[0xF], 1);
});

test('8XY5 subtract: VF = 1 when no borrow, 0 when borrow', () => {
  let cpu = makeCpu([0x6005, 0x6103, 0x8015]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 2, 'V0');
  assertEqual(cpu.V[0xF], 1, 'no borrow');

  cpu = makeCpu([0x6003, 0x6105, 0x8015]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 0xFE, 'V0 wrapped');
  assertEqual(cpu.V[0xF], 0, 'borrow');
});

test('8XY7 reverse subtract', () => {
  const cpu = makeCpu([0x6003, 0x6105, 0x8017]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 2, 'V0 = V1 - V0');
  assertEqual(cpu.V[0xF], 1, 'no borrow');
});

test('8XY1 OR', () => {
  const cpu = makeCpu([0x60F0, 0x610F, 0x8011]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 0xFF);
});

test('8XY2 AND', () => {
  const cpu = makeCpu([0x60F3, 0x610F, 0x8012]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 0x03);
});

test('8XY3 XOR', () => {
  const cpu = makeCpu([0x60FF, 0x610F, 0x8013]);
  run(cpu, 3);
  assertEqual(cpu.V[0], 0xF0);
});

test('logic ops reset VF only with the logicResetsVF quirk', () => {
  const prog = [0x6F05, 0x60F0, 0x610F, 0x8011];
  let cpu = makeCpu(prog, MODERN);
  run(cpu, 4);
  assertEqual(cpu.V[0xF], 5, 'MODERN leaves VF alone');

  cpu = makeCpu(prog, ORIGINAL_VIP);
  run(cpu, 4);
  assertEqual(cpu.V[0xF], 0, 'VIP resets VF');
});

test('8XY6 shift right: VX in place (modern) vs from VY (VIP)', () => {
  const prog = [0x6005, 0x6103, 0x8016]; // V0=5, V1=3
  let cpu = makeCpu(prog, MODERN);
  run(cpu, 3);
  assertEqual(cpu.V[0], 2, 'modern: 5 >> 1');
  assertEqual(cpu.V[0xF], 1, 'modern: bit shifted out');

  cpu = makeCpu(prog, ORIGINAL_VIP);
  run(cpu, 3);
  assertEqual(cpu.V[0], 1, 'VIP: 3 >> 1');
  assertEqual(cpu.V[0xF], 1, 'VIP: bit shifted out');
});

test('8XYE shift left', () => {
  const cpu = makeCpu([0x60C1, 0x800E]); // 0xC1 = 1100 0001
  run(cpu, 2);
  assertEqual(cpu.V[0], 0x82, 'V0');
  assertEqual(cpu.V[0xF], 1, 'top bit shifted out');
});

// ------------------------------------------------------- index / memory

test('ANNN sets I, FX1E adds to I', () => {
  const cpu = makeCpu([0xA100, 0x6005, 0xF01E]);
  run(cpu, 3);
  assertEqual(cpu.I, 0x105);
});

test('FX29 points I at the font sprite', () => {
  const cpu = makeCpu([0x600F, 0xF029]);
  run(cpu, 2);
  assertEqual(cpu.I, FONT_START + 15 * 5);
});

test('FX33 stores BCD digits', () => {
  const cpu = makeCpu([0x60FE, 0xA300, 0xF033]); // 254
  run(cpu, 3);
  assertEqual(cpu.memory[0x300], 2, 'hundreds');
  assertEqual(cpu.memory[0x301], 5, 'tens');
  assertEqual(cpu.memory[0x302], 4, 'ones');
});

test('FX55 stores registers; I changes only with loadStoreIncrementsI', () => {
  const prog = [0x6001, 0x6102, 0x6203, 0xA300, 0xF255];
  let cpu = makeCpu(prog, MODERN);
  run(cpu, 5);
  assertEqual(cpu.memory[0x300], 1);
  assertEqual(cpu.memory[0x301], 2);
  assertEqual(cpu.memory[0x302], 3);
  assertEqual(cpu.I, 0x300, 'modern: I unchanged');

  cpu = makeCpu(prog, ORIGINAL_VIP);
  run(cpu, 5);
  assertEqual(cpu.I, 0x303, 'VIP: I = I + X + 1');
});

test('FX65 loads registers', () => {
  const cpu = makeCpu([0xA300, 0xF265]);
  cpu.memory.set([7, 8, 9], 0x300);
  run(cpu, 2);
  assertEqual(cpu.V[0], 7);
  assertEqual(cpu.V[1], 8);
  assertEqual(cpu.V[2], 9);
});

test('CXNN masks the random byte', () => {
  const cpu = makeCpu([0xC00F]);
  cpu.random = () => 0xAB; // make "random" predictable
  cpu.step();
  assertEqual(cpu.V[0], 0x0B);
});

// ------------------------------------------------------- display

test('00E0 clears the screen', () => {
  const cpu = makeCpu([0x00E0]);
  cpu.display[100] = 1;
  cpu.step();
  assertEqual(cpu.display[100], 0);
});

test('DXYN draws the font "0" at (0,0)', () => {
  const cpu = makeCpu([0xA050, 0x6000, 0x6100, 0xD015]);
  run(cpu, 4);
  // Row 0 = 0xF0 = pixels 0-3 on. Row 1 = 0x90 = pixels 0 and 3 on.
  assertEqual(cpu.display[0], 1);
  assertEqual(cpu.display[3], 1);
  assertEqual(cpu.display[4], 0);
  assertEqual(cpu.display[64 + 0], 1);
  assertEqual(cpu.display[64 + 1], 0);
  assertEqual(cpu.display[64 + 3], 1);
  assertEqual(cpu.V[0xF], 0, 'no collision on a blank screen');
});

test('drawing the same sprite twice erases it and sets VF', () => {
  const cpu = makeCpu([0xA050, 0x6000, 0x6100, 0xD015, 0xD015]);
  run(cpu, 5);
  assertEqual(cpu.display[0], 0, 'erased');
  assertEqual(cpu.V[0xF], 1, 'collision');
});

test('sprites clip at the right edge when spriteClipping is on', () => {
  const cpu = makeCpu([0xA050, 0x603E, 0x6100, 0xD011], MODERN); // x = 62
  run(cpu, 4);
  assertEqual(cpu.display[62], 1);
  assertEqual(cpu.display[63], 1);
  assertEqual(cpu.display[0], 0, 'clipped, not wrapped');
});

test('sprites wrap at the right edge when spriteClipping is off', () => {
  const cpu = makeCpu([0xA050, 0x603E, 0x6100, 0xD011], { ...MODERN, spriteClipping: false });
  run(cpu, 4);
  assertEqual(cpu.display[0], 1, 'wrapped');
  assertEqual(cpu.display[1], 1, 'wrapped');
});

test('displayWait: DXYN stalls until tick60()', () => {
  const cpu = makeCpu([0xA050, 0xD015], { ...MODERN, displayWait: true });
  run(cpu, 2);
  assertEqual(cpu.pc, 0x202, 'still on the DXYN');
  assertEqual(cpu.display[0], 0, 'nothing drawn yet');
  cpu.tick60();
  cpu.step();
  assertEqual(cpu.pc, 0x204, 'moved on');
  assertEqual(cpu.display[0], 1, 'drawn');
});

// ------------------------------------------------------- input / timers

test('EX9E / EXA1 keypad skips', () => {
  // V0 = 5. EX9E skips if key 5 down. EXA1 skips if key 5 up.
  let cpu = makeCpu([0x6005, 0xE09E, 0x6101, 0x6202]);
  cpu.setKey(5, true);
  run(cpu, 3);
  assertEqual(cpu.V[1], 0, 'EX9E skipped (key down)');
  assertEqual(cpu.V[2], 2);

  cpu = makeCpu([0x6005, 0xE0A1, 0x6101, 0x6202]);
  run(cpu, 3);
  assertEqual(cpu.V[1], 0, 'EXA1 skipped (key up)');
  assertEqual(cpu.V[2], 2);
});

test('FX0A waits for a key press and release', () => {
  const cpu = makeCpu([0xF00A, 0x6101]);
  cpu.step();
  assertEqual(cpu.pc, 0x200, 'waiting, no key');
  cpu.setKey(5, true);
  cpu.step();
  cpu.step();
  assertEqual(cpu.pc, 0x200, 'still waiting while key is held');
  cpu.setKey(5, false);
  cpu.step();
  assertEqual(cpu.V[0], 5, 'stored key number');
  assertEqual(cpu.pc, 0x202, 'moved on');
});

test('timers count down at tick60 and FX07 reads the delay timer', () => {
  const cpu = makeCpu([0x603C, 0xF015, 0xF018, 0xF207]);
  run(cpu, 3);
  assertEqual(cpu.delayTimer, 60, 'delay set');
  assertEqual(cpu.soundTimer, 60, 'sound set');
  cpu.tick60();
  cpu.step();
  assertEqual(cpu.V[2], 59, 'FX07');
  assertEqual(cpu.soundTimer, 59, 'sound counted down');
});

test('timers stop at zero', () => {
  const cpu = new Chip8();
  cpu.tick60();
  assertEqual(cpu.delayTimer, 0);
  assertEqual(cpu.soundTimer, 0);
});

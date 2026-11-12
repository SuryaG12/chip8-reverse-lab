/**
 * pong-e2e.test.js - end-to-end checks against a real game ROM.
 *
 * Pong is not committed (see roms/README.md), so every test here skips when
 * roms/pong.ch8 is missing and CI stays green. This file reads the ROM from
 * disk, so it is registered in run-node.js only and never bundled for the
 * browser test page.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEqual, skip, test } from './harness.js';
import { litPixels, runRom } from '../scripts/rom-runner.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const romPath = join(root, 'roms', 'pong.ch8');
const rom = existsSync(romPath) ? new Uint8Array(readFileSync(romPath)) : null;

// Pong keeps the player paddle in VB and starts it at 0x0C. Each pass through
// the keypad checks moves it two pixels, then AND 0x1F wraps it on screen.
const PADDLE = 0xB;
const PADDLE_START = 0x0C;
const KEYPAD_CHECK = 0x232;
const PADDLE_STEP = 2;

function load() {
  if (!rom) skip('roms/pong.ch8 not found');
  return rom;
}

function play(hold, options = {}) {
  return runRom(load(), { steps: 6000, hold, ...options });
}

test('pong loads, runs a full frame and draws without an error', () => {
  const { cpu, executed, error } = play(null);
  assertEqual(error, null, 'error');
  assertEqual(executed, 6000, 'executed');
  assertEqual(cpu.V[PADDLE], PADDLE_START, 'idle paddle stays put');
  assertEqual(litPixels(cpu.display) > 0, true, 'drew something');
});

test('pong moves the paddle up while key 1 is held', () => {
  const { cpu } = play(0x1);
  // The timer expires once, then the paddle steps 7 times: 0x0C - 14 wraps.
  assertEqual(cpu.V[PADDLE], 0x1E, 'VB after holding key 1');
});

test('pong moves the paddle down while key 4 is held', () => {
  const { cpu } = play(0x4);
  assertEqual(cpu.V[PADDLE], 0x1A, 'VB after holding key 4');
});

test('pong breakpoint parks on SKNP and honors the held key', () => {
  const pressed = play(0x1, { steps: 20000, breakpoints: [KEYPAD_CHECK] });
  assertEqual(pressed.breakpointHit, KEYPAD_CHECK, 'breakpoint');
  assertEqual(pressed.cpu.pc, KEYPAD_CHECK, 'pc at the breakpoint');
  assertEqual(pressed.cpu.getOpcodeAt(KEYPAD_CHECK), 0xE0A1, 'SKNP V0');
  assertEqual(pressed.executed < 20000, true, 'stopped before the step limit');
  assertEqual(pressed.cpu.V[PADDLE], PADDLE_START, 'paddle untouched at the breakpoint');

  // Key 1 is held, so SKNP falls through to ADD VB, 0xFE and moves the paddle.
  pressed.cpu.step();
  assertEqual(pressed.cpu.pc, 0x234, 'fell through the skip');
  pressed.cpu.step();
  assertEqual(pressed.cpu.pc, 0x236, 'after the add');
  assertEqual(pressed.cpu.V[PADDLE], PADDLE_START - PADDLE_STEP, 'paddle moved up');

  // With the key released, the same SKNP skips the ADD entirely.
  const released = play(0x1, { steps: 20000, breakpoints: [KEYPAD_CHECK] });
  released.cpu.setKey(0x1, false);
  released.cpu.step();
  assertEqual(released.cpu.pc, 0x236, 'skipped the add');
  assertEqual(released.cpu.V[PADDLE], PADDLE_START, 'paddle did not move');
});

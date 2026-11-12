/**
 * rom-runner.mjs - run a ROM on the core without a browser.
 *
 * Shared by the rom:inspect and rom:check scripts. It has no Node-only imports,
 * so the test suite can exercise it in the browser as well.
 */

import { Chip8, DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../src/cpu.js';
import { MODERN, ORIGINAL_VIP } from '../src/quirks.js';

/**
 * Execute a ROM for at most `steps` instructions.
 *
 * Stops early when the program waits for a key (FX0A), and captures the first
 * CPU error instead of throwing so callers can report the failing PC.
 */
export function runRom(bytes, { steps = 5000, preset = 'modern', hold = null } = {}) {
  const cpu = new Chip8(preset === 'vip' ? ORIGINAL_VIP : MODERN);
  cpu.loadRom(bytes);
  if (hold !== null) cpu.setKey(hold, true);

  let executed = 0;
  let error = null;
  let waitingForKey = false;

  for (let step = 0; step < steps; step++) {
    // FX0A blocks until a key is pressed and released. Detect it before the
    // first phase too, because cpu.waitingKey only changes after a press.
    if (waitsForKey(cpu)) {
      waitingForKey = true;
      break;
    }
    try {
      cpu.step();
    } catch (stepError) {
      error = stepError;
      break;
    }
    executed++;
    // Timers tick at 60 Hz while the program runs.
    if (executed % 60 === 0) cpu.tick60();
  }

  return { cpu, executed, error, waitingForKey };
}

function waitsForKey(cpu) {
  if (cpu.waitingKey >= 0) return true;
  if ((cpu.getOpcodeAt(cpu.pc) & 0xF0FF) !== 0xF00A) return false;
  return !cpu.keys.some((key) => key === 1);
}

/** Draw the 64x32 display as text so a terminal can show the frame. */
export function renderAscii(display) {
  const rows = [];
  for (let y = 0; y < DISPLAY_HEIGHT; y++) {
    let line = '';
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      line += display[y * DISPLAY_WIDTH + x] ? '#' : '.';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

/** Count the pixels that are on. */
export function litPixels(display) {
  let lit = 0;
  for (const pixel of display) if (pixel) lit++;
  return lit;
}

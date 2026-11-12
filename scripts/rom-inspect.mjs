/**
 * rom-inspect.mjs - run a real CHIP-8 ROM headlessly and print what it did.
 *
 * This is a smoke test and debugging aid for the core in src/cpu.js. It does
 * not need a browser, and it never writes anything. Point it at any .ch8 file
 * on disk; ROMs are not committed to this repository.
 *
 * Usage:
 *   node scripts/rom-inspect.mjs roms/2-ibm-logo.ch8 --ascii
 *   node scripts/rom-inspect.mjs roms/6-keypad.ch8 --steps 120 --hold 5
 *   node scripts/rom-inspect.mjs roms/3-corax+.ch8 --steps 2000 --preset modern
 *
 * Options:
 *   --steps N       instructions to execute (default 500)
 *   --preset NAME   modern (default) or vip
 *   --hold KEY      hold a CHIP-8 key from step 0 (single hex digit, 0-F)
 *   --ascii         draw the final display as 64x32 text
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { hashRom } from '../src/library.js';
import { litPixels, renderAscii, runRom } from './rom-runner.mjs';

function parseArgs(argv) {
  const options = { file: null, steps: 500, preset: 'modern', hold: null, ascii: false };
  const rest = argv.slice(2);

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--ascii') options.ascii = true;
    else if (arg === '--steps') options.steps = Number(rest[++index]);
    else if (arg === '--preset') options.preset = rest[++index];
    else if (arg === '--hold') options.hold = rest[++index];
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (!options.file) options.file = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!options.file) throw new Error('Pass a .ch8 file to inspect.');
  if (!Number.isInteger(options.steps) || options.steps < 0) {
    throw new Error('--steps must be a non-negative integer.');
  }
  if (options.preset !== 'modern' && options.preset !== 'vip') {
    throw new Error('--preset must be modern or vip.');
  }
  if (options.hold !== null && !/^[0-9a-f]$/i.test(options.hold)) {
    throw new Error('--hold must be one hex digit, 0-F.');
  }
  return options;
}

function hex(value, width) {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function main() {
  const options = parseArgs(process.argv);
  const bytes = new Uint8Array(readFileSync(options.file));
  if (bytes.length === 0) throw new Error('That ROM is empty.');

  const { cpu, executed, error, waitingForKey } = runRom(bytes, {
    steps: options.steps,
    preset: options.preset,
    hold: options.hold === null ? null : parseInt(options.hold, 16),
  });

  console.log(`ROM      ${basename(options.file)} (${bytes.length} bytes)`);
  console.log(`Hash     ${hashRom(bytes)}`);
  console.log(`Preset   ${options.preset}`);
  console.log(`Steps    ${executed}${waitingForKey ? ' (stopped: waiting for a key)' : ''}`);
  if (error) console.log(`Error    ${error.message}`);
  console.log(`PC      0x${hex(cpu.pc, 3)}   opcode ${hex(cpu.getOpcodeAt(cpu.pc), 4)}`);
  console.log(`I       0x${hex(cpu.I, 3)}   SP ${cpu.sp}   DT ${cpu.delayTimer}   ST ${cpu.soundTimer}`);
  console.log(`V       ${Array.from(cpu.V, (value) => hex(value, 2)).join(' ')}`);
  if (cpu.sp > 0) {
    console.log(`Stack   ${Array.from(cpu.stack.slice(0, cpu.sp), (value) => `0x${hex(value, 3)}`).join(' ')}`);
  }
  console.log(`Display ${litPixels(cpu.display)} pixels on   frame hash ${hashRom(cpu.display)}`);

  if (options.ascii) {
    console.log('');
    console.log(renderAscii(cpu.display));
  }

  return error ? 1 : 0;
}

process.exitCode = main();

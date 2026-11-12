/**
 * rom-check.mjs - smoke-test every ROM in a folder against the core.
 *
 * ROMs are not committed, so this reads whatever real .ch8 files you put in
 * roms/ (or another folder). It executes each one headlessly, reports how far
 * it got, and exits non-zero if the CPU throws.
 *
 * Usage:
 *   node scripts/rom-check.mjs
 *   node scripts/rom-check.mjs roms --steps 20000
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { hashRom } from '../src/library.js';
import { litPixels, runRom } from './rom-runner.mjs';

function hex(value, width) {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function main() {
  const args = process.argv.slice(2);
  const stepsIndex = args.indexOf('--steps');
  const steps = stepsIndex === -1 ? 5000 : Number(args[stepsIndex + 1]);
  const presetIndex = args.indexOf('--preset');
  const preset = presetIndex === -1 ? 'modern' : args[presetIndex + 1];

  let dir = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--steps' || arg === '--preset') {
      index++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    if (dir) throw new Error(`Unexpected argument: ${arg}`);
    dir = arg;
  }
  dir ??= 'roms';

  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error('--steps must be a positive integer.');
  }
  if (preset !== 'modern' && preset !== 'vip') {
    throw new Error('--preset must be modern or vip.');
  }
  if (!existsSync(dir)) {
    console.log(`No ${dir} folder. Put real .ch8 files there and run again.`);
    return 0;
  }

  const files = readdirSync(dir)
    .filter((name) => /\.(ch8|c8|rom)$/i.test(name))
    .sort();

  if (files.length === 0) {
    console.log(`No ROMs in ${dir}. Download some test ROMs and run again.`);
    return 0;
  }

  let failures = 0;
  console.log(`Checking ${files.length} ROM${files.length === 1 ? '' : 's'} in ${dir} (${steps} steps each, ${preset})`);

  for (const name of files) {
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    const { cpu, executed, error, waitingForKey } = runRom(bytes, { steps, preset });
    const state = error ? 'FAIL' : 'ok  ';
    const note = waitingForKey ? ' waiting for key' : '';
    console.log(
      `${state} ${basename(name).padEnd(24)} ${String(executed).padStart(5)} steps` +
      `  ${String(litPixels(cpu.display)).padStart(4)} px  PC 0x${hex(cpu.pc, 3)}  ${hashRom(bytes)}${note}`,
    );
    if (error) {
      failures++;
      console.log(`     ${error.message}`);
    }
  }

  console.log(failures === 0
    ? `All ${files.length} ROMs ran without a CPU error.`
    : `${failures} of ${files.length} ROMs failed.`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = main();

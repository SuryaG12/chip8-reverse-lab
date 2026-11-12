import { assertEqual, test } from './harness.js';
import { litPixels, renderAscii, runRom } from '../scripts/rom-runner.mjs';

test('rom runner executes a program and reports state', () => {
  const { cpu, executed, error, waitingForKey } = runRom(new Uint8Array([0x60, 0x05]), { steps: 1 });
  assertEqual(executed, 1, 'executed');
  assertEqual(error, null, 'error');
  assertEqual(waitingForKey, false, 'waitingForKey');
  assertEqual(cpu.V[0], 5, 'V0');
  assertEqual(cpu.pc, 0x202, 'pc');
});

test('rom runner respects the step limit', () => {
  const { cpu, executed } = runRom(new Uint8Array([0x12, 0x00]), { steps: 25 });
  assertEqual(executed, 25, 'executed');
  assertEqual(cpu.pc, 0x200, 'pc');
});

test('rom runner stops at FX0A instead of spinning', () => {
  const { executed, waitingForKey } = runRom(new Uint8Array([0xF0, 0x0A]), { steps: 100 });
  assertEqual(executed, 0, 'executed');
  assertEqual(waitingForKey, true, 'waitingForKey');
});

test('rom runner captures an invalid opcode as an error', () => {
  const { executed, error } = runRom(new Uint8Array([0x50, 0x01]), { steps: 10 });
  assertEqual(executed, 0, 'executed');
  assertEqual(error?.message.startsWith('Unknown opcode'), true, 'error');
});

test('rom runner renders and counts display pixels', () => {
  const display = new Uint8Array(64 * 32);
  display[0] = 1;
  display[63] = 1;
  display[64 * 31] = 1;

  const lines = renderAscii(display).split('\n');
  assertEqual(lines.length, 32, 'rows');
  assertEqual(lines[0].length, 64, 'columns');
  assertEqual(lines[0][0], '#', 'top left');
  assertEqual(lines[0][63], '#', 'top right');
  assertEqual(lines[31][0], '#', 'bottom left');
  assertEqual(litPixels(display), 3, 'lit pixels');
});

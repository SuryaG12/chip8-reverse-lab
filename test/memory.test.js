/**
 * memory.test.js — hex-dump model, pagination and address parsing.
 */

import { test, assertEqual } from './harness.js';
import {
  buildMemoryRows,
  clampBase,
  formatHexDump,
  MEMORY_REGIONS,
  pageCount,
  pageForAddress,
  pageStart,
  parseAddressInput,
  regionAt,
  regionLabel,
  ROW_BYTES,
} from '../src/memory.js';

const memoryWith = (entries) => {
  const memory = new Uint8Array(4096);
  for (const [address, value] of entries) memory[address] = value;
  return memory;
};

test('memory regions cover the whole address space exactly once', () => {
  assertEqual(MEMORY_REGIONS.length, 4);
  assertEqual(MEMORY_REGIONS[0].start, 0x000);
  assertEqual(MEMORY_REGIONS[0].end, 0x04F);
  assertEqual(MEMORY_REGIONS[1].start, 0x050);
  assertEqual(MEMORY_REGIONS[1].end, 0x09F);
  assertEqual(MEMORY_REGIONS[2].start, 0x0A0);
  assertEqual(MEMORY_REGIONS[2].end, 0x1FF);
  assertEqual(MEMORY_REGIONS[3].start, 0x200);
  assertEqual(MEMORY_REGIONS[3].end, 0xFFF);
});

test('regionAt labels interpreter, font, reserved and program addresses', () => {
  assertEqual(regionAt(0x000).name, 'interpreter');
  assertEqual(regionAt(0x04F).name, 'interpreter');
  assertEqual(regionAt(0x050).name, 'font');
  assertEqual(regionAt(0x09F).name, 'font');
  assertEqual(regionAt(0x0A0).name, 'reserved');
  assertEqual(regionAt(0x1FF).name, 'reserved');
  assertEqual(regionAt(0x200).name, 'program');
  assertEqual(regionAt(0xFFF).name, 'program');
});

test('regionAt rejects out-of-range addresses', () => {
  assertEqual(regionAt(-1), null);
  assertEqual(regionAt(0x1000), null);
  assertEqual(regionAt(1.5), null);
  assertEqual(regionLabel(0x200), 'Program');
  assertEqual(regionLabel(0x1000), 'Out of range');
});

test('clampBase aligns down and keeps a full page in range', () => {
  assertEqual(clampBase(0x203), 0x200);
  assertEqual(clampBase(0x20F), 0x200);
  assertEqual(clampBase(0), 0);
  assertEqual(clampBase(-1), 0);
  assertEqual(clampBase(Number.NaN), 0);
  assertEqual(clampBase(0xFFF), 0xF00);
  assertEqual(clampBase(0xFFFF), 0xF00);
  assertEqual(clampBase(0x203, 32), 0x200);
  assertEqual(clampBase(0xFFF, 32), 0xE00);
});

test('pageCount and pageStart describe 256-byte pages', () => {
  assertEqual(ROW_BYTES, 16);
  assertEqual(pageCount(16), 16);
  assertEqual(pageCount(8), 32);
  assertEqual(pageStart(0), 0x000);
  assertEqual(pageStart(2), 0x200);
  assertEqual(pageStart(999), 0xF00);
  assertEqual(pageForAddress(0x2FF), 2);
  assertEqual(pageForAddress(0xFFF), 15);
  assertEqual(pageForAddress(0x200, 32), 1);
});

test('buildMemoryRows returns addresses, bytes, ASCII and region names', () => {
  const memory = memoryWith([[0x200, 0x41], [0x201, 0x42], [0x202, 0x00], [0x203, 0x7F]]);
  const rows = buildMemoryRows(memory, 0x200);

  assertEqual(rows.length, 16);
  assertEqual(rows[0].address, 0x200);
  assertEqual(rows[0].region, 'program');
  assertEqual(rows[0].regionLabel, 'Program');
  assertEqual(rows[0].bytes.length, 16);
  assertEqual(rows[0].bytes[0], 0x41);
  assertEqual(rows[0].bytes[1], 0x42);
  assertEqual(rows[0].bytes[3], 0x7F);
  assertEqual(rows[0].ascii.slice(0, 4), 'AB..');
  assertEqual(rows[15].address, 0x2F0);
});

test('buildMemoryRows handles the font and pads short memory', () => {
  const font = buildMemoryRows(memoryWith([[0x050, 0xF0]]), 0x050, 2);
  assertEqual(font[0].address, 0x050);
  assertEqual(font[0].region, 'font');
  assertEqual(font[0].bytes[0], 0xF0);

  const short = buildMemoryRows([0xAA], 0, 1);
  assertEqual(short[0].bytes[0], 0xAA);
  assertEqual(short[0].bytes[1], 0);
  assertEqual(short[0].ascii[0], '.');
});

test('parseAddressInput accepts hexadecimal with or without 0x', () => {
  assertEqual(parseAddressInput('200'), 0x200);
  assertEqual(parseAddressInput('0x200'), 0x200);
  assertEqual(parseAddressInput('0X0a0'), 0x0A0);
  assertEqual(parseAddressInput(' fff '), 0xFFF);
  assertEqual(parseAddressInput('0'), 0);
});

test('parseAddressInput rejects malformed or out-of-range input', () => {
  assertEqual(parseAddressInput(''), null);
  assertEqual(parseAddressInput('0x'), null);
  assertEqual(parseAddressInput('xyz'), null);
  assertEqual(parseAddressInput('1000'), null);
  assertEqual(parseAddressInput('0x10000'), null);
  assertEqual(parseAddressInput(null), null);
});

test('formatHexDump prints a 16-byte row with an ASCII column', () => {
  const memory = memoryWith([[0x200, 0x41], [0x201, 0x42]]);
  const dump = formatHexDump(memory, { base: 0x200, rows: 2 }).split('\n');

  assertEqual(dump.length, 2);
  assertEqual(dump[0].startsWith('0200  41 42 00'), true);
  assertEqual(dump[0].endsWith('|AB..............|'), true);
  assertEqual(dump[1].startsWith('0210  '), true);
});

test('formatHexDump defaults to the whole address space', () => {
  const dump = formatHexDump(new Uint8Array(4096)).split('\n');
  assertEqual(dump.length, 256);
  assertEqual(dump[0].startsWith('0000  00 00'), true);
  assertEqual(dump[255].startsWith('0FF0  00 00'), true);
});

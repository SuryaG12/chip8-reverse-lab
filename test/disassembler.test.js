/**
 * disassembler.test.js — unit tests for the opcode decoder.
 */

import { test, assertEqual } from './harness.js';
import { disassemble, disassembleOpcode } from '../src/disassembler.js';

const d = (op) => disassembleOpcode(op);

test('CLS, RET and SYS decode', () => {
  assertEqual(d(0x00E0).text, 'CLS');
  assertEqual(d(0x00EE).text, 'RET');
  assertEqual(d(0x0123).text, 'SYS 0x123');
});

test('jumps and calls decode their target', () => {
  assertEqual(d(0x1ABC).text, 'JP 0xABC');
  assertEqual(d(0x2345).text, 'CALL 0x345');
});

test('immediate skips decode', () => {
  assertEqual(d(0x3010).text, 'SE V0, 0x10');
  assertEqual(d(0x4123).text, 'SNE V1, 0x23');
});

test('register skip decodes; invalid 5XYN is unknown', () => {
  assertEqual(d(0x5120).text, 'SE V1, V2');
  assertEqual(d(0x5121).text, '??? 0x5121');
});

test('immediate load and add decode', () => {
  assertEqual(d(0x6A0F).text, 'LD VA, 0x0F');
  assertEqual(d(0x7B01).text, 'ADD VB, 0x01');
});

test('8XY0 through 8XY7 decode', () => {
  assertEqual(d(0x8120).text, 'LD V1, V2');
  assertEqual(d(0x8121).text, 'OR V1, V2');
  assertEqual(d(0x8122).text, 'AND V1, V2');
  assertEqual(d(0x8123).text, 'XOR V1, V2');
  assertEqual(d(0x8124).text, 'ADD V1, V2');
  assertEqual(d(0x8125).text, 'SUB V1, V2');
  assertEqual(d(0x8126).text, 'SHR V1');
  assertEqual(d(0x8127).text, 'SUBN V1, V2');
});

test('8XYE decodes as SHL; unknown low nibble is rejected', () => {
  assertEqual(d(0x812E).text, 'SHL V1');
  assertEqual(d(0x812F).text, '??? 0x812F');
});

test('9XY0 decodes; non-zero low nibble is unknown', () => {
  assertEqual(d(0x9120).text, 'SNE V1, V2');
  assertEqual(d(0x9121).text, '??? 0x9121');
});

test('I, jump-with-offset, random and draw decode', () => {
  assertEqual(d(0xA300).text, 'LD I, 0x300');
  assertEqual(d(0xB300).text, 'JP V0, 0x300');
  assertEqual(d(0xC10F).text, 'RND V1, 0x0F');
  assertEqual(d(0xD125).text, 'DRW V1, V2, 5');
});

test('keypad skips decode', () => {
  assertEqual(d(0xE19E).text, 'SKP V1');
  assertEqual(d(0xE1A1).text, 'SKNP V1');
  assertEqual(d(0xE100).text, '??? 0xE100');
});

test('FX timer, key, index and font instructions decode', () => {
  assertEqual(d(0xF107).text, 'LD V1, DT');
  assertEqual(d(0xF10A).text, 'LD V1, K');
  assertEqual(d(0xF115).text, 'LD DT, V1');
  assertEqual(d(0xF118).text, 'LD ST, V1');
  assertEqual(d(0xF11E).text, 'ADD I, V1');
  assertEqual(d(0xF129).text, 'LD F, V1');
});

test('FX BCD and register transfers decode', () => {
  assertEqual(d(0xF133).text, 'LD B, V1');
  assertEqual(d(0xF155).text, 'LD [I], V1');
  assertEqual(d(0xF165).text, 'LD V1, [I]');
});

test('unknown FX opcodes are rejected', () => {
  assertEqual(d(0xF100).text, '??? 0xF100');
});

test('the decoder returns mnemonic and args separately', () => {
  const ins = d(0x6A2B);
  assertEqual(ins.mnemonic, 'LD');
  assertEqual(ins.args, 'VA, 0x2B');
  assertEqual(ins.opcode, 0x6A2B);
});

test('opcodes are masked to 16 bits', () => {
  assertEqual(d(0x10000 | 0x00E0).text, 'CLS');
});

test('disassemble walks a range in two-byte steps', () => {
  const memory = new Uint8Array(4096);
  memory.set([0xA0, 0x50, 0x60, 0x0A, 0xD0, 0x15], 0x200);

  const list = disassemble(memory, 0x200, 0x206);
  assertEqual(list.length, 3);
  assertEqual(list[0].address, 0x200);
  assertEqual(list[0].bytes, 'A050');
  assertEqual(list[0].text, 'LD I, 0x050');
  assertEqual(list[1].address, 0x202);
  assertEqual(list[1].text, 'LD V0, 0x0A');
  assertEqual(list[2].address, 0x204);
  assertEqual(list[2].text, 'DRW V0, V1, 5');
});

test('disassemble ignores a trailing odd byte', () => {
  const memory = new Uint8Array(4096);
  memory.set([0x00, 0xE0, 0x12, 0x00, 0xFF], 0x200);

  const list = disassemble(memory, 0x200, 0x205);
  assertEqual(list.length, 2);
  assertEqual(list[0].text, 'CLS');
  assertEqual(list[1].text, 'JP 0x200');
});

test('disassemble clamps to the memory size', () => {
  const list = disassemble(new Uint8Array(16), 0, 9999);
  assertEqual(list.length, 8);
  assertEqual(list[0].address, 0);
  assertEqual(list[7].address, 14);
});

test('disassemble returns an empty list for an empty range', () => {
  assertEqual(disassemble(new Uint8Array(4096), 0x200, 0x200).length, 0);
  assertEqual(disassemble(new Uint8Array(4096), 0x200, 0x201).length, 0);
});

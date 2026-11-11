/**
 * search.test.js — trace filtering tests.
 */

import { test, assertEqual } from './harness.js';
import { eventHaystack, filterTrace, parseQuery } from '../src/search.js';

const make = (overrides = {}) => ({
  seq: 1,
  address: 0x208,
  opcode: 0x1208,
  bytes: '1208',
  mnemonic: 'JP',
  args: '0x208',
  text: 'JP 0x208',
  changes: [{ kind: 'pc', target: 'PC', from: 0x206, to: 0x208 }],
  display: false,
  ...overrides,
});

const entries = [
  make({
    seq: 1,
    address: 0x200,
    opcode: 0xA050,
    bytes: 'A050',
    mnemonic: 'LD',
    args: 'I, 0x050',
    text: 'LD I, 0x050',
    changes: [
      { kind: 'I', target: 'I', from: 0, to: 0x50 },
      { kind: 'pc', target: 'PC', from: 0x200, to: 0x202 },
    ],
  }),
  make({
    seq: 2,
    address: 0x202,
    opcode: 0x6000,
    bytes: '6000',
    mnemonic: 'LD',
    args: 'V0, 0x00',
    text: 'LD V0, 0x00',
    changes: [{ kind: 'pc', target: 'PC', from: 0x202, to: 0x204 }],
  }),
  make({
    seq: 3,
    address: 0x208,
    opcode: 0x1208,
    bytes: '1208',
    mnemonic: 'JP',
    args: '0x208',
    text: 'JP 0x208',
    changes: [{ kind: 'pc', target: 'PC', from: 0x208, to: 0x208 }],
  }),
];

const seqs = (list) => list.map((event) => event.seq);

test('parseQuery splits and lowercases tokens', () => {
  assertEqual(parseQuery('  JP   208 ').join(','), 'jp,208');
  assertEqual(parseQuery('').length, 0);
  assertEqual(parseQuery(null).length, 0);
});

test('an empty query returns a copy of the whole log', () => {
  const filtered = filterTrace(entries, '   ');
  assertEqual(filtered.length, 3);
  assertEqual(filtered === entries, false);
  assertEqual(seqs(filtered).join(','), '1,2,3');
});

test('filtering is case-insensitive on mnemonics', () => {
  assertEqual(seqs(filterTrace(entries, 'jp')).join(','), '3');
  assertEqual(seqs(filterTrace(entries, 'Ld')).join(','), '1,2');
});

test('filtering matches formatted and bare hex addresses', () => {
  assertEqual(seqs(filterTrace(entries, '0x208')).join(','), '3');
  assertEqual(seqs(filterTrace(entries, '208')).join(','), '3');
  assertEqual(seqs(filterTrace(entries, '0x202')).join(','), '2');
});

test('filtering matches opcode bytes and raw opcodes', () => {
  assertEqual(seqs(filterTrace(entries, 'a050')).join(','), '1');
  assertEqual(seqs(filterTrace(entries, '1208')).join(','), '3');
});

test('filtering matches registers mentioned in text or changes', () => {
  assertEqual(seqs(filterTrace(entries, 'v0')).join(','), '2');
  assertEqual(seqs(filterTrace(entries, 'i 050')).join(','), '1');
});

test('filtering matches formatted change summaries', () => {
  // 0x202 appears as the destination of event 1 and the source of event 2.
  assertEqual(seqs(filterTrace(entries, 'pc 202')).join(','), '1,2');
  assertEqual(seqs(filterTrace(entries, 'no state change')).length, 0);
});

test('multiple tokens must all match', () => {
  assertEqual(seqs(filterTrace(entries, 'jp 208')).join(','), '3');
  assertEqual(seqs(filterTrace(entries, 'jp 200')).length, 0);
  assertEqual(seqs(filterTrace(entries, 'ld v0')).join(','), '2');
});

test('an unmatched query returns nothing', () => {
  assertEqual(filterTrace(entries, 'nope').length, 0);
});

test('display and empty-change events are searchable', () => {
  const display = make({ seq: 9, changes: [], display: true });
  const quiet = make({ seq: 10, changes: [], display: false });

  assertEqual(eventHaystack(display).includes('display updated'), true);
  assertEqual(eventHaystack(quiet).includes('no state change'), true);
  assertEqual(seqs(filterTrace([display, quiet], 'display')).join(','), '9');
  assertEqual(seqs(filterTrace([display, quiet], 'no state')).join(','), '10');
});

test('filtering does not mutate the log', () => {
  const before = entries.map((event) => event.seq).join(',');
  filterTrace(entries, 'jp');
  assertEqual(entries.map((event) => event.seq).join(','), before);
  assertEqual(entries.length, 3);
});

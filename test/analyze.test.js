/**
 * analyze.test.js — session-level analysis tests.
 */

import { test, assertEqual } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN } from '../src/quirks.js';
import { createTrace, recordStep } from '../src/trace.js';
import { analyzeSession, findLoops, verifySessionAnalysis } from '../src/analyze.js';

function makeStats(overrides = {}) {
  return {
    total: 10,
    retained: 10,
    uniqueAddresses: 2,
    addresses: [
      { address: 0x204, opcode: 0x1204, count: 7, firstSeq: 4, lastSeq: 10 },
      { address: 0x200, opcode: 0xA050, count: 3, firstSeq: 1, lastSeq: 3 },
    ],
    transitions: [
      { from: 0x204, to: 0x204, count: 7 },
      { from: 0x200, to: 0x202, count: 3 },
    ],
    calls: 0,
    draws: 0,
    last: { seq: 10, address: 0x204, opcode: 0x1204, text: 'JP 0x204' },
    ...overrides,
  };
}

const texts = (analysis) => analysis.findings.map((finding) => finding.text);
const hasText = (analysis, fragment) => texts(analysis).some((text) => text.includes(fragment));

test('findLoops detects a self-loop', () => {
  const loops = findLoops([{ from: 0x204, to: 0x204, count: 7 }]);
  assertEqual(loops.length, 1);
  assertEqual(loops[0].addresses.length, 1);
  assertEqual(loops[0].addresses[0], 0x204);
  assertEqual(loops[0].leastEdgeCount, 7);
});

test('findLoops detects a multi-node cycle', () => {
  const loops = findLoops([
    { from: 0x200, to: 0x202, count: 5 },
    { from: 0x202, to: 0x204, count: 5 },
    { from: 0x204, to: 0x200, count: 5 },
  ]);

  assertEqual(loops.length, 1);
  assertEqual(loops[0].addresses.length, 3);
  assertEqual(loops[0].leastEdgeCount, 5);
  assertEqual(loops[0].addresses[0], 0x200);
  assertEqual(loops[0].addresses[2], 0x204);
});

test('findLoops ignores acyclic flow', () => {
  assertEqual(findLoops([
    { from: 0x200, to: 0x202, count: 1 },
    { from: 0x202, to: 0x204, count: 1 },
  ]).length, 0);
});

test('findLoops finds a loop inside a larger graph', () => {
  const loops = findLoops([
    { from: 0x200, to: 0x202, count: 1 },
    { from: 0x202, to: 0x204, count: 4 },
    { from: 0x204, to: 0x202, count: 4 },
  ]);

  assertEqual(loops.length, 1);
  assertEqual(loops[0].addresses.length, 2);
  assertEqual(loops[0].addresses[0], 0x202);
  assertEqual(loops[0].leastEdgeCount, 4);
});

test('analyzeSession reports totals, hotspot, loop and last instruction', () => {
  const analysis = analyzeSession(makeStats());

  assertEqual(analysis.empty, false);
  assertEqual(hasText(analysis, 'Executed 10 instructions across 2 distinct addresses'), true);
  assertEqual(hasText(analysis, 'hottest address was 0x204: 7 executions of JP 0x204'), true);
  assertEqual(hasText(analysis, 'self-loop at 0x204 ran 7 times'), true);
  assertEqual(hasText(analysis, 'last retained instruction was JP 0x204'), true);
  assertEqual(hasText(analysis, 'CALL was executed'), false);

  const check = verifySessionAnalysis(analysis, makeStats());
  assertEqual(check.ok, true);
  assertEqual(check.unsupported.length, 0);
});

test('analyzeSession reports calls and draws when they happened', () => {
  const stats = makeStats({ calls: 2, draws: 3 });
  const analysis = analyzeSession(stats);

  assertEqual(hasText(analysis, 'CALL was executed 2 times'), true);
  assertEqual(hasText(analysis, 'display was updated 3 times'), true);
  assertEqual(verifySessionAnalysis(analysis, stats).ok, true);
});

test('an empty session analyses cleanly', () => {
  const stats = makeStats({
    total: 0,
    retained: 0,
    uniqueAddresses: 0,
    addresses: [],
    transitions: [],
    last: null,
  });
  const analysis = analyzeSession(stats);

  assertEqual(analysis.empty, true);
  assertEqual(analysis.findings.length, 0);
  assertEqual(verifySessionAnalysis(analysis, stats).ok, true);
});

test('the verifier rejects a fabricated hotspot', () => {
  const stats = makeStats();
  const analysis = analyzeSession(stats);
  const bad = {
    ...analysis,
    findings: [
      ...analysis.findings,
      {
        text: 'The hottest address was 0x200.',
        evidence: [{ type: 'stat', name: 'hottest', address: 0x200, count: 99 }],
      },
    ],
  };

  const check = verifySessionAnalysis(bad, stats);
  assertEqual(check.ok, false);
  assertEqual(check.unsupported.length, 1);
});

test('the verifier rejects a fabricated loop', () => {
  const stats = makeStats();
  const bad = {
    ...analyzeSession(stats),
    findings: [
      {
        text: 'A giant loop was detected.',
        evidence: [{ type: 'stat', name: 'loop', addresses: [0x300, 0x302], leastEdgeCount: 50 }],
      },
    ],
  };

  assertEqual(verifySessionAnalysis(bad, stats).ok, false);
});

test('the verifier rejects fabricated call and draw counts', () => {
  const stats = makeStats({ calls: 1, draws: 1 });
  const bad = {
    ...analyzeSession(stats),
    findings: [
      {
        text: 'CALL ran 99 times.',
        evidence: [{ type: 'stat', name: 'calls', count: 99 }],
      },
      {
        text: 'The display updated 99 times.',
        evidence: [{ type: 'stat', name: 'draws', count: 99 }],
      },
    ],
  };

  assertEqual(verifySessionAnalysis(bad, stats).ok, false);
});

test('the verifier rejects a wrong last-event citation and unknown stats', () => {
  const stats = makeStats();
  const bad = {
    ...analyzeSession(stats),
    findings: [
      {
        text: 'The last instruction was somewhere else.',
        evidence: [{ type: 'stat', name: 'last', seq: 999 }],
      },
    ],
  };
  assertEqual(verifySessionAnalysis(bad, stats).ok, false);

  const unknown = {
    ...analyzeSession(stats),
    findings: [
      { text: 'Trust me.', evidence: [{ type: 'stat', name: 'vibes' }] },
    ],
  };
  assertEqual(verifySessionAnalysis(unknown, stats).ok, false);
});

test('the verifier rejects an empty analysis when instructions ran', () => {
  const stats = makeStats();
  assertEqual(verifySessionAnalysis({ empty: true, findings: [] }, stats).ok, false);
});

test('every session finding carries evidence', () => {
  const analysis = analyzeSession(makeStats({ calls: 1, draws: 1, uniqueAddresses: 2 }));
  for (const finding of analysis.findings) {
    assertEqual(Array.isArray(finding.evidence), true);
    assertEqual(finding.evidence.length > 0, true);
  }
});

test('analyzeSession works on stats from a real trace', () => {
  const cpu = new Chip8(MODERN);
  const trace = createTrace();
  const program = [0xA050, 0x6000, 0x6100, 0xD015, 0x1208, 0x1208];

  for (const opcode of program) {
    const pc = cpu.pc;
    cpu.memory[pc] = (opcode >> 8) & 0xFF;
    cpu.memory[pc + 1] = opcode & 0xFF;
    recordStep(cpu, trace);
  }

  const stats = trace.stats();
  const analysis = analyzeSession(stats);

  assertEqual(stats.total, 6);
  assertEqual(stats.addresses[0].address, 0x208);
  assertEqual(stats.addresses[0].count, 2);
  assertEqual(hasText(analysis, 'hottest address was 0x208'), true);
  assertEqual(hasText(analysis, 'self-loop at 0x208 ran 2 times'), true);
  assertEqual(verifySessionAnalysis(analysis, stats).ok, true);
});

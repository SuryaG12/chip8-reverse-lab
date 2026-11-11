/**
 * evidence.test.js — portable evidence report tests.
 */

import { test, assertEqual } from './harness.js';
import { Chip8 } from '../src/cpu.js';
import { MODERN } from '../src/quirks.js';
import { createTrace, recordStep } from '../src/trace.js';
import { analyzeSession } from '../src/analyze.js';
import {
  buildEvidenceReport,
  evidenceFilename,
  EVIDENCE_FORMAT,
  EVIDENCE_VERSION,
} from '../src/evidence.js';

function makeSession() {
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
  return { trace: trace.snapshot(), stats, analysis: analyzeSession(stats) };
}

function makeEmptySession() {
  const trace = createTrace();
  const stats = trace.stats();
  return { trace: trace.snapshot(), stats, analysis: analyzeSession(stats) };
}

const FIXED = '2026-11-10T18:30:00.000Z';

test('a report carries format metadata, ROM details and settings', () => {
  const { trace, stats, analysis } = makeSession();
  const report = buildEvidenceReport({
    rom: { name: 'demo.ch8', size: 12 },
    preset: 'modern',
    speed: 1500,
    stats,
    analysis,
    trace,
    generatedAt: FIXED,
  });

  assertEqual(report.format, EVIDENCE_FORMAT);
  assertEqual(report.version, EVIDENCE_VERSION);
  assertEqual(report.generatedAt, FIXED);
  assertEqual(report.rom.name, 'demo.ch8');
  assertEqual(report.rom.size, 12);
  assertEqual(report.preset, 'modern');
  assertEqual(report.speed, 1500);
});

test('a report summarises the session and keeps verified findings', () => {
  const { trace, stats, analysis } = makeSession();
  const report = buildEvidenceReport({
    rom: { name: 'demo.ch8', size: 12 },
    stats,
    analysis,
    trace,
    generatedAt: FIXED,
  });

  assertEqual(report.session.total, 6);
  assertEqual(report.session.retained, 6);
  assertEqual(report.session.uniqueAddresses, 5);
  assertEqual(report.session.calls, 0);
  assertEqual(report.session.draws, 1);
  assertEqual(report.session.addresses.length, 5);
  assertEqual(report.session.transitions.length > 0, true);
  assertEqual(report.session.findings.length > 0, true);
  assertEqual(report.session.verification.ok, true);
  assertEqual(report.session.verification.unsupported.length, 0);

  for (const finding of report.session.findings) {
    assertEqual(typeof finding.text, 'string');
    assertEqual(Array.isArray(finding.evidence), true);
    assertEqual(finding.evidence.length > 0, true);
  }
});

test('a report copies each retained event with a change summary', () => {
  const { trace, stats, analysis } = makeSession();
  const report = buildEvidenceReport({ stats, analysis, trace, generatedAt: FIXED });

  assertEqual(report.events.length, trace.length);
  assertEqual(report.events[0].seq, trace[0].seq);
  assertEqual(report.events.at(-1).seq, trace.at(-1).seq);

  for (const event of report.events) {
    assertEqual(typeof event.text, 'string');
    assertEqual(Array.isArray(event.changes), true);
    assertEqual(typeof event.summary, 'string');
    assertEqual(event.summary.length > 0, true);
  }

  const draw = report.events.find((event) => event.display);
  assertEqual(Boolean(draw), true);
  assertEqual(draw.summary.includes('display updated'), true);
});

test('a report survives a JSON round trip', () => {
  const { trace, stats, analysis } = makeSession();
  const report = buildEvidenceReport({ stats, analysis, trace, generatedAt: FIXED });
  const parsed = JSON.parse(JSON.stringify(report));

  assertEqual(parsed.session.total, 6);
  assertEqual(parsed.events.length, 6);
  assertEqual(parsed.session.verification.ok, true);
  assertEqual(parsed.events[0].address, report.events[0].address);
});

test('a report never includes credentials passed alongside the data', () => {
  const { trace, stats, analysis } = makeSession();
  const report = buildEvidenceReport({
    stats,
    analysis,
    trace,
    generatedAt: FIXED,
    apiKey: 'sk-should-not-leak',
  });

  assertEqual(JSON.stringify(report).includes('sk-should-not-leak'), false);
});

test('an empty session produces a valid empty report', () => {
  const { trace, stats, analysis } = makeEmptySession();
  const report = buildEvidenceReport({ stats, analysis, trace, generatedAt: FIXED });

  assertEqual(report.rom, null);
  assertEqual(report.session.total, 0);
  assertEqual(report.session.findings.length, 0);
  assertEqual(report.session.verification.ok, true);
  assertEqual(report.events.length, 0);
});

test('a tampered finding is marked unverified in the report', () => {
  const { trace, stats, analysis } = makeSession();
  const tampered = {
    ...analysis,
    findings: [
      ...analysis.findings,
      {
        text: 'A fabricated hotspot.',
        evidence: [{ type: 'stat', name: 'hottest', address: 0x300, count: 99 }],
      },
    ],
  };
  const report = buildEvidenceReport({ stats, analysis: tampered, trace, generatedAt: FIXED });

  assertEqual(report.session.verification.ok, false);
  assertEqual(report.session.verification.unsupported.length, 1);
});

test('filenames are deterministic and filesystem-safe', () => {
  assertEqual(
    evidenceFilename({ name: 'My ROM (v2).ch8' }, FIXED),
    'chip8-evidence-my-rom-v2-20261110-183000Z.json',
  );
  assertEqual(
    evidenceFilename({ name: '../../evil.ch8' }, FIXED),
    'chip8-evidence-evil-20261110-183000Z.json',
  );
  assertEqual(
    evidenceFilename(null, FIXED),
    'chip8-evidence-session-20261110-183000Z.json',
  );
});

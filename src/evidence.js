/**
 * evidence.js — package a session into a portable JSON report.
 *
 * The report is intentionally plain data: ROM metadata, cumulative session
 * stats, verified findings, and every retained trace event with a formatted
 * change summary. It contains no code and no API keys, so it can be shared or
 * attached to a bug report without leaking the model credential.
 */

import { verifySessionAnalysis } from './analyze.js';
import { describeChanges } from './trace.js';

export const EVIDENCE_FORMAT = 'chip8-reverse-lab.evidence';
export const EVIDENCE_VERSION = 1;

/**
 * Build a JSON-serializable evidence report.
 *
 * @param {{
 *   rom?: { name: string, size: number } | null,
 *   preset?: string | null,
 *   speed?: number | null,
 *   stats: object,
 *   analysis: object,
 *   trace: Array<object>,
 *   generatedAt?: Date | string | number,
 * }} options
 */
export function buildEvidenceReport({
  rom = null,
  preset = null,
  speed = null,
  stats,
  analysis,
  trace,
  generatedAt = new Date(),
}) {
  const findings = analysis?.findings ?? [];
  const verification = verifySessionAnalysis(analysis, stats);

  return {
    format: EVIDENCE_FORMAT,
    version: EVIDENCE_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    rom: rom ? { name: rom.name, size: rom.size } : null,
    preset,
    speed,
    session: {
      total: stats.total,
      retained: stats.retained,
      uniqueAddresses: stats.uniqueAddresses,
      calls: stats.calls,
      draws: stats.draws,
      addresses: stats.addresses.map(({ address, opcode, count, firstSeq, lastSeq }) => ({
        address,
        opcode,
        count,
        firstSeq,
        lastSeq,
      })),
      transitions: stats.transitions.map(({ from, to, count }) => ({ from, to, count })),
      findings: findings.map(({ text, evidence }) => ({ text, evidence })),
      verification,
    },
    events: trace.map((event) => ({
      seq: event.seq,
      address: event.address,
      opcode: event.opcode,
      bytes: event.bytes,
      text: event.text,
      changes: event.changes,
      display: Boolean(event.display),
      summary: describeChanges(event),
    })),
  };
}

/**
 * A filesystem-safe report name, e.g.
 * `chip8-evidence-my-rom-v2-20261110-183000Z.json`.
 *
 * @param {{ name?: string } | null} rom
 * @param {Date | string | number} generatedAt
 */
export function evidenceFilename(rom, generatedAt = new Date()) {
  const base = (rom?.name || 'session')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'session';

  const stamp = new Date(generatedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');

  return `chip8-evidence-${base}-${stamp}.json`;
}

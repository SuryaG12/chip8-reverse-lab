/**
 * memory.js — the 4 KB address space as a browsable hex dump.
 *
 * Pure data helpers: no DOM. The UI renders whatever buildMemoryRows() returns,
 * so pagination, region labels and formatting can be tested in Node.
 */

import { MEMORY_SIZE, PROGRAM_START } from './cpu.js';
import { FONT_CHAR_SIZE, FONT_START } from './fontset.js';

/** Bytes per hex-dump row. */
export const ROW_BYTES = 16;

/** Rows shown per page by default (256 bytes). */
export const PAGE_ROWS = 16;

const FONT_END = FONT_START + 16 * FONT_CHAR_SIZE; // 0x050 + 80 bytes

/** Named slices of the CHIP-8 address space. */
export const MEMORY_REGIONS = [
  { name: 'interpreter', label: 'Interpreter', start: 0x000, end: FONT_START - 1 },
  { name: 'font', label: 'Font', start: FONT_START, end: FONT_END - 1 },
  { name: 'reserved', label: 'Reserved', start: FONT_END, end: PROGRAM_START - 1 },
  { name: 'program', label: 'Program', start: PROGRAM_START, end: MEMORY_SIZE - 1 },
];

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');

/** The region containing an address, or null outside 0x000-0xFFF. */
export function regionAt(address) {
  if (!Number.isInteger(address) || address < 0 || address >= MEMORY_SIZE) return null;
  return MEMORY_REGIONS.find((region) => address >= region.start && address <= region.end) ?? null;
}

/** A short label such as "Font" or "Program", or "Out of range". */
export function regionLabel(address) {
  return regionAt(address)?.label ?? 'Out of range';
}

/**
 * Align a base address down to a 16-byte boundary and keep a full page
 * inside the 4 KB address space.
 */
export function clampBase(base, rows = PAGE_ROWS) {
  const safeRows = Math.max(1, Math.floor(rows));
  const span = Math.min(MEMORY_SIZE, safeRows * ROW_BYTES);
  const maxBase = MEMORY_SIZE - span;
  const value = Number.isFinite(base) ? Math.floor(base) : 0;
  const aligned = value - (((value % ROW_BYTES) + ROW_BYTES) % ROW_BYTES);
  return Math.max(0, Math.min(aligned, maxBase));
}

/** Number of full pages needed to cover all 4 KB. */
export function pageCount(rows = PAGE_ROWS) {
  return Math.ceil(MEMORY_SIZE / (Math.max(1, Math.floor(rows)) * ROW_BYTES));
}

/** Page index containing an address. */
export function pageForAddress(address, rows = PAGE_ROWS) {
  return Math.floor(clampBase(address, rows) / (Math.max(1, Math.floor(rows)) * ROW_BYTES));
}

/** First address of a page, clamped to the address space. */
export function pageStart(page, rows = PAGE_ROWS) {
  const size = Math.max(1, Math.floor(rows)) * ROW_BYTES;
  return clampBase(Math.max(0, Math.floor(page)) * size, rows);
}

/**
 * Build the rows for one page.
 *
 * @param {Uint8Array|number[]} memory
 * @param {number} [base]
 * @param {number} [rows]
 * @returns {Array<{ address: number, bytes: number[], ascii: string,
 *                   region: string, regionLabel: string }>}
 */
export function buildMemoryRows(memory, base = 0, rows = PAGE_ROWS) {
  const safeRows = Math.max(1, Math.floor(rows));
  const start = clampBase(base, safeRows);

  return Array.from({ length: safeRows }, (_, rowIndex) => {
    const address = start + rowIndex * ROW_BYTES;
    const bytes = Array.from({ length: ROW_BYTES }, (_, byteIndex) => {
      const value = memory?.[address + byteIndex] ?? 0;
      return Number.isInteger(value) ? value & 0xFF : 0;
    });

    return {
      address,
      bytes,
      ascii: bytes
        .map((byte) => (byte >= 0x20 && byte < 0x7F ? String.fromCharCode(byte) : '.'))
        .join(''),
      region: regionAt(address)?.name ?? 'out-of-range',
      regionLabel: regionLabel(address),
    };
  });
}

/**
 * Parse a base address typed by a user. Accepts `200`, `0x200` and `0X200`,
 * always as hexadecimal. Returns null for anything outside 0x000-0xFFF.
 */
export function parseAddressInput(text) {
  const cleaned = String(text ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,3}$/i.test(cleaned)) return null;
  const value = Number.parseInt(cleaned, 16);
  return value >= 0 && value < MEMORY_SIZE ? value : null;
}

/**
 * A plain-text hex dump for copying or saving, with an ASCII column.
 * Defaults to the whole address space.
 */
export function formatHexDump(memory, { base = 0, rows = MEMORY_SIZE / ROW_BYTES } = {}) {
  const start = clampBase(base, 1);
  const available = Math.floor((MEMORY_SIZE - start) / ROW_BYTES);
  const count = Math.max(1, Math.min(Math.floor(rows) || available, available));

  return buildMemoryRows(memory, start, count)
    .map((row) => {
      const bytes = row.bytes.map((byte) => hex(byte, 2)).join(' ');
      return `${hex(row.address, 4)}  ${bytes}  |${row.ascii}|`;
    })
    .join('\n');
}

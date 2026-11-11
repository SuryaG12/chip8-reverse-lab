/**
 * library.js — a small, validated ROM library stored in the browser.
 *
 * Entries are plain JSON: name, size, content hash, quirk preset, date and the
 * original bytes. The library never contains credentials or test ROMs from the
 * repository; it only holds files the user explicitly saves in their browser.
 */

import { MAX_ROM_SIZE } from './cpu.js';

export const LIBRARY_FORMAT = 'chip8-reverse-lab.library';
export const LIBRARY_VERSION = 1;
export const LIBRARY_LIMIT = 20;

/** Refuse to fill localStorage with ROMs beyond this total. */
export const LIBRARY_TOTAL_BYTES = 1024 * 1024;

const HEX_HASH = /^[0-9A-F]{8}$/;

/** FNV-1a, 32-bit. Stable across browsers and easy to test. */
export function hashRom(bytes) {
  let hash = 0x811C9DC5;
  for (const byte of bytes) {
    hash ^= byte & 0xFF;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, '0');
}

function cleanName(name) {
  const value = String(name ?? '').replace(/[\\/]+/g, '-').trim();
  return (value || 'untitled.ch8').slice(0, 120);
}

/** An empty, well-formed library. */
export function createLibrary() {
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, entries: [] };
}

/**
 * Build one library entry from a ROM.
 *
 * @param {{ name?: string, bytes: Uint8Array|number[],
 *           preset?: string, addedAt?: Date|string|number }} input
 */
export function buildLibraryEntry({ name, bytes, preset = 'modern', addedAt = new Date() }) {
  if (!bytes || typeof bytes.length !== 'number') {
    throw new Error('ROM bytes are required.');
  }
  if (bytes.length === 0) throw new Error('Cannot save an empty ROM.');
  if (bytes.length > MAX_ROM_SIZE) {
    throw new Error(`ROM is ${bytes.length} bytes; the maximum is ${MAX_ROM_SIZE}.`);
  }

  const copy = Uint8Array.from(bytes);
  const hash = hashRom(copy);
  const date = new Date(addedAt);
  if (Number.isNaN(date.getTime())) throw new Error('addedAt must be a valid date.');

  return {
    id: hash,
    name: cleanName(name),
    size: copy.length,
    hash,
    preset: preset === 'vip' ? 'vip' : 'modern',
    addedAt: date.toISOString(),
    bytes: Array.from(copy),
  };
}

/** Sum of ROM sizes currently stored. */
export function totalBytes(library) {
  return (library?.entries ?? []).reduce((sum, entry) => sum + (entry.size || 0), 0);
}

/** Find an entry by its content hash. */
export function findEntry(library, id) {
  return (library?.entries ?? []).find((entry) => entry.id === id) ?? null;
}

/**
 * Add an entry to the front of the library. Duplicates are rejected by hash,
 * the list is capped, and the total byte budget is enforced.
 *
 * @returns {{ library: object, entry: object|null, added: boolean,
 *             reason?: 'duplicate'|'quota', evicted?: number }}
 */
export function addEntry(library, entry, {
  limit = LIBRARY_LIMIT,
  totalByteLimit = LIBRARY_TOTAL_BYTES,
} = {}) {
  const base = library ?? createLibrary();
  const existing = findEntry(base, entry.id);
  if (existing) {
    return { library: base, entry: existing, added: false, reason: 'duplicate' };
  }

  if (totalBytes(base) + entry.size > totalByteLimit) {
    return { library: base, entry: null, added: false, reason: 'quota' };
  }

  const max = Math.max(1, Math.floor(limit));
  const entries = [entry, ...(base.entries ?? [])];
  const evicted = Math.max(0, entries.length - max);

  return {
    library: { ...base, entries: entries.slice(0, max) },
    entry,
    added: true,
    evicted,
  };
}

/** Remove one entry by id. */
export function removeEntry(library, id) {
  const base = library ?? createLibrary();
  return {
    ...base,
    entries: (base.entries ?? []).filter((entry) => entry.id !== id),
  };
}

function checkEntry(entry, index) {
  const errors = [];
  const where = `entries[${index}]`;

  if (!entry || typeof entry !== 'object') {
    return [`${where} must be an object.`];
  }
  if (typeof entry.id !== 'string' || !HEX_HASH.test(entry.id)) {
    errors.push(`${where}.id must be an 8-character hex hash.`);
  }
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    errors.push(`${where}.name must be a non-empty string.`);
  } else if (entry.name.length > 120) {
    errors.push(`${where}.name must be at most 120 characters.`);
  }
  if (!Number.isInteger(entry.size) || entry.size < 1 || entry.size > MAX_ROM_SIZE) {
    errors.push(`${where}.size must be an integer from 1 to ${MAX_ROM_SIZE}.`);
  }
  if (typeof entry.hash !== 'string' || !HEX_HASH.test(entry.hash)) {
    errors.push(`${where}.hash must be an 8-character hex hash.`);
  }
  if (entry.preset !== 'modern' && entry.preset !== 'vip') {
    errors.push(`${where}.preset must be "modern" or "vip".`);
  }
  if (typeof entry.addedAt !== 'string' || Number.isNaN(Date.parse(entry.addedAt))) {
    errors.push(`${where}.addedAt must be a valid date string.`);
  }
  if (!Array.isArray(entry.bytes)) {
    errors.push(`${where}.bytes must be an array.`);
  } else {
    if (entry.bytes.length !== entry.size) {
      errors.push(`${where}.bytes length must equal size.`);
    }
    if (!entry.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      errors.push(`${where}.bytes values must be integers from 0 to 255.`);
    }
  }
  if (typeof entry.hash === 'string' && Array.isArray(entry.bytes)) {
    const expected = hashRom(entry.bytes);
    if (entry.hash !== expected) {
      errors.push(`${where}.hash does not match its bytes.`);
    }
    if (entry.id !== entry.hash) {
      errors.push(`${where}.id must equal its hash.`);
    }
  }

  return errors;
}

/**
 * Validate and normalize parsed library JSON. Invalid entries are dropped
 * individually so one corrupt row does not discard the whole library.
 *
 * @returns {{ library: object, errors: string[], dropped: number }}
 */
export function parseLibrary(data) {
  const empty = createLibrary();

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { library: empty, errors: ['Library must be a JSON object.'], dropped: 0 };
  }

  const errors = [];
  if (data.format !== LIBRARY_FORMAT) {
    errors.push(`Unknown library format (expected "${LIBRARY_FORMAT}").`);
  }
  if (data.version !== LIBRARY_VERSION) {
    errors.push(`Unsupported library version (expected ${LIBRARY_VERSION}).`);
  }
  if (errors.length) return { library: empty, errors, dropped: 0 };

  if (!Array.isArray(data.entries)) {
    return { library: empty, errors: ['Library entries must be an array.'], dropped: 0 };
  }

  const entries = [];
  const seen = new Set();
  let dropped = 0;

  data.entries.forEach((entry, index) => {
    const problems = checkEntry(entry, index);
    if (problems.length) {
      dropped += 1;
      errors.push(...problems);
      return;
    }
    if (seen.has(entry.id)) {
      dropped += 1;
      errors.push(`entries[${index}] duplicates hash ${entry.id}.`);
      return;
    }
    if (entries.length >= LIBRARY_LIMIT) {
      dropped += 1;
      errors.push(`entries[${index}] exceeds the ${LIBRARY_LIMIT}-ROM limit.`);
      return;
    }
    seen.add(entry.id);
    entries.push({
      ...entry,
      name: cleanName(entry.name),
      bytes: entry.bytes.slice(),
    });
  });

  return {
    library: { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, entries },
    errors,
    dropped,
  };
}

/** Serialize for localStorage or a file. */
export function serializeLibrary(library) {
  return JSON.stringify(library ?? createLibrary());
}

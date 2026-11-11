/**
 * library.test.js — ROM library entries, validation and persistence shape.
 */

import { test, assertEqual, assertThrows } from './harness.js';
import {
  addEntry,
  buildLibraryEntry,
  createLibrary,
  findEntry,
  hashRom,
  LIBRARY_FORMAT,
  LIBRARY_LIMIT,
  LIBRARY_VERSION,
  parseLibrary,
  removeEntry,
  serializeLibrary,
  totalBytes,
} from '../src/library.js';

const FIXED = '2026-11-10T18:30:00.000Z';
const bytesFor = (seed, size = 4) => Uint8Array.from({ length: size }, (_, index) => (seed + index) & 0xFF);

function entry(seed, name = `rom-${seed}.ch8`) {
  return buildLibraryEntry({
    name,
    bytes: bytesFor(seed),
    preset: seed % 2 ? 'vip' : 'modern',
    addedAt: FIXED,
  });
}

const clone = (value) => JSON.parse(JSON.stringify(value));

test('hashRom is stable, 8 hex characters and content-sensitive', () => {
  const first = hashRom(new Uint8Array([0x60, 0x05]));
  const second = hashRom(new Uint8Array([0x60, 0x05]));
  const different = hashRom(new Uint8Array([0x60, 0x06]));

  assertEqual(first, second);
  assertEqual(first.length, 8);
  assertEqual(/^[0-9A-F]{8}$/.test(first), true);
  assertEqual(first === different, false);
});

test('buildLibraryEntry records metadata and a byte copy', () => {
  const source = bytesFor(0x10);
  const built = buildLibraryEntry({
    name: 'demo.ch8',
    bytes: source,
    preset: 'vip',
    addedAt: FIXED,
  });

  assertEqual(built.id, hashRom(source));
  assertEqual(built.hash, hashRom(source));
  assertEqual(built.name, 'demo.ch8');
  assertEqual(built.size, 4);
  assertEqual(built.preset, 'vip');
  assertEqual(built.addedAt, FIXED);
  assertEqual(built.bytes.join(','), Array.from(source).join(','));

  source[0] = 0xFF;
  assertEqual(built.bytes[0], 0x10, 'entry must not alias the source bytes');
});

test('buildLibraryEntry sanitizes names and defaults the preset', () => {
  assertEqual(
    buildLibraryEntry({ name: '../../evil.ch8', bytes: bytesFor(1), addedAt: FIXED }).name,
    '..-..-evil.ch8',
  );
  assertEqual(
    buildLibraryEntry({ name: '   ', bytes: bytesFor(1), addedAt: FIXED }).name,
    'untitled.ch8',
  );
  assertEqual(
    buildLibraryEntry({ name: 'x'.repeat(200), bytes: bytesFor(1), addedAt: FIXED }).name.length,
    120,
  );
  assertEqual(
    buildLibraryEntry({ name: 'a.ch8', bytes: bytesFor(1), preset: 'weird', addedAt: FIXED }).preset,
    'modern',
  );
});

test('buildLibraryEntry rejects empty, oversized and badly dated input', () => {
  assertThrows(() => buildLibraryEntry({ name: 'empty.ch8', bytes: new Uint8Array() }));
  assertThrows(() => buildLibraryEntry({ name: 'big.ch8', bytes: new Uint8Array(4096) }));
  assertThrows(() => buildLibraryEntry({ name: 'bad.ch8', bytes: bytesFor(1), addedAt: 'not-a-date' }));
  assertThrows(() => buildLibraryEntry({ name: 'none.ch8', bytes: null }));
});

test('addEntry puts the newest ROM first and rejects duplicates', () => {
  const first = entry(1);
  const second = entry(2);
  const empty = createLibrary();

  const added = addEntry(empty, first);
  assertEqual(added.added, true);
  assertEqual(added.library.entries.length, 1);
  assertEqual(added.library.entries[0].id, first.id);

  const again = addEntry(added.library, first);
  assertEqual(again.added, false);
  assertEqual(again.reason, 'duplicate');
  assertEqual(again.entry.id, first.id);
  assertEqual(again.library.entries.length, 1);

  const next = addEntry(added.library, second);
  assertEqual(next.library.entries[0].id, second.id);
  assertEqual(next.library.entries[1].id, first.id);
});

test('addEntry enforces the entry limit and the byte budget', () => {
  let library = createLibrary();
  const entries = [entry(1), entry(2), entry(3)];
  for (const item of entries) library = addEntry(library, item, { limit: 2 }).library;

  assertEqual(library.entries.length, 2);
  assertEqual(library.entries[0].id, entries[2].id);
  assertEqual(library.entries[1].id, entries[1].id);

  const quota = addEntry(createLibrary(), entry(4), { totalByteLimit: 3 });
  assertEqual(quota.added, false);
  assertEqual(quota.reason, 'quota');
  assertEqual(quota.library.entries.length, 0);
});

test('findEntry, removeEntry and totalBytes work by content hash', () => {
  const first = entry(1);
  const second = entry(2);
  let library = addEntry(createLibrary(), first).library;
  library = addEntry(library, second).library;

  assertEqual(findEntry(library, first.id).name, first.name);
  assertEqual(findEntry(library, 'NOPE0000'), null);
  assertEqual(totalBytes(library), 8);

  const removed = removeEntry(library, first.id);
  assertEqual(removed.entries.length, 1);
  assertEqual(findEntry(removed, first.id), null);
  assertEqual(totalBytes(removed), 4);
  assertEqual(library.entries.length, 2, 'removeEntry must not mutate the input');
});

test('a valid library round-trips through JSON', () => {
  const first = entry(1);
  const library = addEntry(createLibrary(), first).library;
  const parsed = parseLibrary(JSON.parse(serializeLibrary(library)));

  assertEqual(parsed.errors.length, 0);
  assertEqual(parsed.dropped, 0);
  assertEqual(parsed.library.format, LIBRARY_FORMAT);
  assertEqual(parsed.library.version, LIBRARY_VERSION);
  assertEqual(parsed.library.entries.length, 1);
  assertEqual(parsed.library.entries[0].id, first.id);
  assertEqual(parsed.library.entries[0].bytes.join(','), first.bytes.join(','));
});

test('parseLibrary rejects bad envelopes', () => {
  assertEqual(parseLibrary(null).errors.length > 0, true);
  assertEqual(parseLibrary([]).errors.length > 0, true);
  assertEqual(parseLibrary('text').errors.length > 0, true);

  const wrongFormat = clone(createLibrary());
  wrongFormat.format = 'something-else';
  assertEqual(parseLibrary(wrongFormat).library.entries.length, 0);

  const wrongVersion = clone(createLibrary());
  wrongVersion.version = 99;
  assertEqual(parseLibrary(wrongVersion).errors.length > 0, true);
});

test('parseLibrary drops corrupt entries but keeps good ones', () => {
  const good = entry(1);
  const badByte = clone(entry(2));
  badByte.bytes[0] = 999;
  const badSize = clone(entry(3));
  badSize.size = 99;
  const badHash = clone(entry(4));
  badHash.hash = '00000000';
  badHash.id = '00000000';

  const data = {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    entries: [good, badByte, badSize, badHash],
  };
  const parsed = parseLibrary(data);

  assertEqual(parsed.library.entries.length, 1);
  assertEqual(parsed.library.entries[0].id, good.id);
  assertEqual(parsed.dropped, 3);
  assertEqual(parsed.errors.length >= 3, true);
});

test('parseLibrary drops duplicate hashes and entries past the limit', () => {
  const first = entry(1);
  const duplicate = clone(first);
  const parsed = parseLibrary({
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    entries: [first, duplicate],
  });
  assertEqual(parsed.library.entries.length, 1);
  assertEqual(parsed.dropped, 1);

  const many = Array.from({ length: LIBRARY_LIMIT + 2 }, (_, index) => entry(index + 10));
  const capped = parseLibrary({
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    entries: many,
  });
  assertEqual(capped.library.entries.length, LIBRARY_LIMIT);
  assertEqual(capped.dropped, 2);
});

test('parseLibrary rejects entries with invalid presets or dates', () => {
  const badPreset = clone(entry(1));
  badPreset.preset = 'turbo';
  const badDate = clone(entry(2));
  badDate.addedAt = 'yesterday';

  const parsed = parseLibrary({
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    entries: [badPreset, badDate],
  });

  assertEqual(parsed.library.entries.length, 0);
  assertEqual(parsed.dropped, 2);
});

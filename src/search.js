/**
 * search.js — filter recorded trace events without changing the log.
 *
 * Matching is deliberately literal and case-insensitive: every whitespace
 * separated token must appear somewhere in the event's address, opcode, bytes,
 * mnemonic, arguments, formatted changes or sequence number. That makes
 * "jp 208", "v0" and "pc 206" all useful queries in a workbench.
 */

import { describeChanges } from './trace.js';

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');

/** All searchable text for one event, lowercased. */
export function eventHaystack(event) {
  return [
    String(event.seq),
    event.address?.toString(16),
    `0x${hex(event.address, 3)}`,
    event.opcode?.toString(16),
    `0x${hex(event.opcode, 4)}`,
    event.bytes,
    event.mnemonic,
    event.args,
    event.text,
    describeChanges(event),
  ].filter((part) => part !== undefined && part !== null && part !== '').join(' ').toLowerCase();
}

/** Split a query into lowercase tokens; an empty query has no tokens. */
export function parseQuery(query) {
  return String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Keep events matching every token in the query, in their original order.
 * An empty query returns a shallow copy of the whole log.
 *
 * @param {Array<object>} entries
 * @param {string} query
 */
export function filterTrace(entries, query) {
  const tokens = parseQuery(query);
  if (!tokens.length) return entries.slice();

  return entries.filter((event) => {
    const haystack = eventHaystack(event);
    return tokens.every((token) => haystack.includes(token));
  });
}

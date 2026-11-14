/**
 * watch.js — pause when a register, the index register or a memory byte changes.
 *
 * A watch is a plain object, so it can live in a ref, in React state and in a
 * JSON report without extra work:
 *
 *   { id: 'V0', kind: 'reg', target: 0 }
 *   { id: 'I', kind: 'ireg' }
 *   { id: 'M2F4', kind: 'mem', target: 0x2F4 }
 */

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');

const INVALID = 'Use V0 to VF, I, or a memory address like 0x300.';

/**
 * Parse one text expression. Returns `{ watch }` or `{ error }`.
 * Registers are case-insensitive; memory accepts `0x300`, `300` or `0x50`.
 */
export function parseWatchInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return { error: INVALID };

  const register = /^v([0-9a-f])$/i.exec(text);
  if (register) {
    const index = parseInt(register[1], 16);
    return {
      watch: {
        id: `V${register[1].toUpperCase()}`,
        kind: 'reg',
        target: index,
      },
    };
  }

  if (/^i$/i.test(text)) {
    return { watch: { id: 'I', kind: 'ireg' } };
  }

  const address = /^(?:0x)?([0-9a-f]{1,3})$/i.exec(text);
  if (address) {
    const value = parseInt(address[1], 16);
    return {
      watch: {
        id: `M${hex(value, 3)}`,
        kind: 'mem',
        target: value,
      },
    };
  }

  return { error: INVALID };
}

/** The value a watch points at. Accepts a CPU or any object with V, I, memory. */
export function readWatchValue(state, watch) {
  if (watch.kind === 'reg') return state.V[watch.target];
  if (watch.kind === 'ireg') return state.I;
  return state.memory[watch.target];
}

/** Read every watch up front so one instruction can be compared after it runs. */
export function snapshotWatchValues(state, watches) {
  return watches.map((watch) => readWatchValue(state, watch));
}

/** Every watch whose value changed, in the order the watches were added. */
export function findWatchChanges(state, watches, before) {
  const changes = [];
  watches.forEach((watch, index) => {
    const from = before[index];
    const to = readWatchValue(state, watch);
    if (from !== to) changes.push({ watch, from, to });
  });
  return changes;
}

/** A short label: `V0`, `I` or `0x2F4`. */
export function describeWatch(watch) {
  if (watch.kind === 'reg') return watch.id;
  if (watch.kind === 'ireg') return 'I';
  return `0x${hex(watch.target, 3)}`;
}

/** Values are hex and padded to the width of the register they live in. */
export function formatWatchValue(watch, value) {
  return `0x${hex(value, watch.kind === 'ireg' ? 3 : 2)}`;
}

/**
 * The status line shown when a watch fires. A single change names the value;
 * several changes are listed together because they happened on one instruction.
 */
export function formatWatchHit(changes, address) {
  const at = `0x${hex(address, 3)}`;
  if (changes.length === 1) {
    const [{ watch, from, to }] = changes;
    return `Watchpoint: ${describeWatch(watch)} changed ${formatWatchValue(watch, from)} to ${formatWatchValue(watch, to)} at ${at}.`;
  }

  const parts = changes.map(({ watch, from, to }) => (
    `${describeWatch(watch)} ${formatWatchValue(watch, from)} to ${formatWatchValue(watch, to)}`
  ));
  return `Watchpoints at ${at}: ${parts.join(', ')}.`;
}

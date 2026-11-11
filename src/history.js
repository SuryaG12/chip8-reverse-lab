/**
 * history.js — a bounded undo stack for the emulator.
 *
 * Each entry is a complete copy of the machine taken *before* an instruction
 * ran, so stepping back is exact even when the instruction changed memory,
 * the display, timers or held keys. Entries also carry the trace length and
 * the address that was about to execute, so the UI can rewind the evidence
 * log at the same time.
 */

/** Default number of instructions that can be stepped back. */
export const HISTORY_LIMIT = 500;

/**
 * Copy everything needed to restore the CPU exactly.
 *
 * @param {import('./cpu.js').Chip8} cpu
 */
export function captureHistoryState(cpu) {
  return {
    pc: cpu.pc,
    I: cpu.I,
    sp: cpu.sp,
    delayTimer: cpu.delayTimer,
    soundTimer: cpu.soundTimer,
    waitingKey: cpu.waitingKey,
    vblankReady: Boolean(cpu.vblankReady),
    drawFlag: Boolean(cpu.drawFlag),
    V: Uint8Array.from(cpu.V),
    stack: Uint16Array.from(cpu.stack),
    memory: Uint8Array.from(cpu.memory),
    display: Uint8Array.from(cpu.display),
    keys: Uint8Array.from(cpu.keys),
  };
}

/**
 * Put a captured state back into a CPU in place.
 *
 * @param {import('./cpu.js').Chip8} cpu
 * @param {ReturnType<typeof captureHistoryState>} state
 */
export function restoreHistoryState(cpu, state) {
  cpu.pc = state.pc;
  cpu.I = state.I;
  cpu.sp = state.sp;
  cpu.delayTimer = state.delayTimer;
  cpu.soundTimer = state.soundTimer;
  cpu.waitingKey = state.waitingKey;
  cpu.vblankReady = state.vblankReady;
  cpu.drawFlag = state.drawFlag;
  cpu.V.set(state.V);
  cpu.stack.set(state.stack);
  cpu.memory.set(state.memory);
  cpu.display.set(state.display);
  cpu.keys.set(state.keys);
  return cpu;
}

/**
 * A last-in, first-out stack of pre-step states.
 *
 * @param {number} [limit]
 */
export function createHistory(limit = HISTORY_LIMIT) {
  const max = Math.max(1, Math.floor(limit));
  const stack = [];

  return {
    /**
     * Remember the machine before the next instruction executes.
     *
     * @param {import('./cpu.js').Chip8} cpu
     * @param {{ address?: number, opcode?: number, traceLength?: number }} [meta]
     */
    record(cpu, meta = {}) {
      stack.push({
        state: captureHistoryState(cpu),
        meta: { ...meta },
      });
      if (stack.length > max) stack.splice(0, stack.length - max);
      return stack.length;
    },

    /**
     * Restore the most recent pre-step state.
     *
     * @param {import('./cpu.js').Chip8} cpu
     * @returns {{ state: object, meta: object } | null}
     */
    undo(cpu) {
      const entry = stack.pop();
      if (!entry) return null;
      restoreHistoryState(cpu, entry.state);
      return entry;
    },

    /** The metadata of the next undo without restoring anything. */
    peek() {
      const entry = stack[stack.length - 1];
      return entry ? { ...entry.meta } : null;
    },

    clear() {
      stack.length = 0;
    },

    get size() {
      return stack.length;
    },

    get limit() {
      return max;
    },
  };
}

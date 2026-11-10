/**
 * explain.js — turn a trace event into an explanation, and check that every
 * claim in an explanation is actually supported by that event.
 *
 * This is deliberately deterministic, not a language model: the text is
 * generated from the decoded opcode and the recorded state changes. The same
 * verifier can gate a future model's output, rejecting any sentence that cites
 * a change the trace did not record.
 */

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');
const reg = (index) => `V${index.toString(16).toUpperCase()}`;

function instructionEvidence(event) {
  return { type: 'instruction', address: event.address, opcode: event.opcode };
}

/** Explain what the opcode itself does, in one sentence. */
function describeOperation(event) {
  const op = event.opcode;
  const n = op & 0xF;
  const nn = op & 0xFF;
  const nnn = op & 0xFFF;
  const x = (op >> 8) & 0xF;
  const y = (op >> 4) & 0xF;
  const vx = reg(x);
  const vy = reg(y);
  const immediate = `0x${hex(nn, 2)}`;
  const address = `0x${hex(nnn, 3)}`;

  switch (op >> 12) {
    case 0x0:
      if (op === 0x00E0) return 'CLS clears the display buffer.';
      if (op === 0x00EE) return 'RET pops a return address from the stack into PC.';
      return 'SYS is a machine-code call; this emulator treats it as a no-op.';

    case 0x1:
      return `JP sets PC to ${address}.`;

    case 0x2: {
      const returnAddress = (event.address + 2) & 0xFFF;
      return `CALL pushes the return address 0x${hex(returnAddress, 3)} and jumps to ${address}.`;
    }

    case 0x3:
      return `SE skips the next instruction when ${vx} equals ${immediate}.`;

    case 0x4:
      return `SNE skips the next instruction when ${vx} does not equal ${immediate}.`;

    case 0x5:
      return `SE skips the next instruction when ${vx} equals ${vy}.`;

    case 0x6:
      return `LD copies the immediate byte ${immediate} into ${vx}.`;

    case 0x7:
      return `ADD adds ${immediate} to ${vx}; VF is left alone.`;

    case 0x8:
      switch (n) {
        case 0x0: return `LD copies ${vy} into ${vx}.`;
        case 0x1: return `OR sets ${vx} to ${vx} OR ${vy}.`;
        case 0x2: return `AND sets ${vx} to ${vx} AND ${vy}.`;
        case 0x3: return `XOR sets ${vx} to ${vx} XOR ${vy}.`;
        case 0x4: return `ADD sets ${vx} to ${vx} + ${vy} and stores the carry in VF.`;
        case 0x5: return `SUB sets ${vx} to ${vx} - ${vy}; VF is 1 when no borrow was needed.`;
        case 0x6: return 'SHR shifts a register right by one bit and stores the shifted-out bit in VF.';
        case 0x7: return `SUBN sets ${vx} to ${vy} - ${vx}; VF is 1 when no borrow was needed.`;
        case 0xE: return 'SHL shifts a register left by one bit and stores the shifted-out bit in VF.';
        default: return `Executed ${event.text}.`;
      }

    case 0x9:
      return `SNE skips the next instruction when ${vx} does not equal ${vy}.`;

    case 0xA:
      return `LD points the index register I at ${address}.`;

    case 0xB:
      return `JP sets PC to ${address} plus a register offset (V0 by default).`;

    case 0xC:
      return `RND sets ${vx} to a random byte ANDed with ${immediate}.`;

    case 0xD:
      return `DRW XORs a ${n}-row sprite from memory[I] onto the display at (${vx}, ${vy}); VF records a collision.`;

    case 0xE:
      if (nn === 0x9E) return `SKP skips the next instruction when key ${vx} is pressed.`;
      if (nn === 0xA1) return `SKNP skips the next instruction when key ${vx} is not pressed.`;
      return `Executed ${event.text}.`;

    case 0xF:
      switch (nn) {
        case 0x07: return `LD copies the delay timer into ${vx}.`;
        case 0x0A: return `LD waits for a key press and release, then stores the key number in ${vx}.`;
        case 0x15: return `LD sets the delay timer to ${vx}.`;
        case 0x18: return `LD sets the sound timer to ${vx}.`;
        case 0x1E: return `ADD adds ${vx} to the index register I.`;
        case 0x29: return `LD points I at the font sprite for the digit in ${vx}.`;
        case 0x33: return `LD stores ${vx} as three decimal digits at I, I+1 and I+2.`;
        case 0x55: return `LD stores ${vx} and the registers below it into memory starting at I.`;
        case 0x65: return `LD loads ${vx} and the registers below it from memory starting at I.`;
        default: return `Executed ${event.text}.`;
      }

    default:
      return `Executed ${event.text}.`;
  }
}

/** Explain one recorded change, using only values present in the event. */
function describeChange(change, event) {
  switch (change.kind) {
    case 'pc': {
      const family = event.opcode >> 12;
      const advanced = (change.to - change.from + 0x1000) & 0xFFF;
      const from = `0x${hex(change.from, 3)}`;
      const to = `0x${hex(change.to, 3)}`;

      if (advanced === 4) return `PC skipped from ${from} to ${to} over the next instruction.`;
      if (family === 0x1 || family === 0x2 || family === 0xB || event.opcode === 0x00EE) {
        return `PC jumped from ${from} to ${to}.`;
      }
      if (advanced === 2) return `PC advanced from ${from} to ${to}.`;
      return `PC changed from ${from} to ${to}.`;
    }

    case 'reg':
      return `${change.target} changed from 0x${hex(change.from, 2)} to 0x${hex(change.to, 2)}.`;

    case 'I':
      return `The index register I changed from 0x${hex(change.from, 3)} to 0x${hex(change.to, 3)}.`;

    case 'sp':
      return `The stack pointer SP changed from ${change.from} to ${change.to}.`;

    case 'dt':
      return `The delay timer changed from ${change.from} to ${change.to}.`;

    case 'st':
      return `The sound timer changed from ${change.from} to ${change.to}.`;

    case 'mem':
      return `Memory at ${change.target} changed from 0x${hex(change.from, 2)} to 0x${hex(change.to, 2)}.`;

    default:
      return `${change.target} changed from ${change.from} to ${change.to}.`;
  }
}

/** Explain a no-change event without inventing anything. */
function describeUnchanged(event) {
  const op = event.opcode;
  if ((op >> 12) === 0x1 && (op & 0xFFF) === event.address) {
    return `JP targets its own address (0x${hex(event.address, 3)}), so PC stays there.`;
  }
  if ((op & 0xF0FF) === 0xF00A) {
    return `LD ${reg((op >> 8) & 0xF)} is waiting for a key press and release, so no state changes yet.`;
  }
  return 'This instruction produced no traced state change.';
}

/**
 * Build an evidence-checked explanation for one trace event.
 *
 * @param {object} event  an entry from trace.js
 */
export function explainEvent(event) {
  const statements = [
    { text: describeOperation(event), evidence: [instructionEvidence(event)] },
  ];

  for (const change of event.changes) {
    statements.push({
      text: describeChange(change, event),
      evidence: [{ type: 'change', claim: change }],
    });
  }

  if (event.display) {
    statements.push({ text: 'The display buffer was updated.', evidence: [{ type: 'display' }] });
  }

  if (event.changes.length === 0 && !event.display) {
    statements.push({ text: describeUnchanged(event), evidence: [{ type: 'unchanged' }] });
  }

  return {
    seq: event.seq,
    address: event.address,
    opcode: event.opcode,
    summary: `At 0x${hex(event.address, 3)}, ${event.text} executed.`,
    statements,
  };
}

/** Does one piece of cited evidence actually appear in the event? */
function supports(evidence, event) {
  switch (evidence.type) {
    case 'instruction':
      return evidence.address === event.address && evidence.opcode === event.opcode;

    case 'change': {
      const claim = evidence.claim;
      if (!claim) return false;
      return event.changes.some((change) => change.kind === claim.kind
        && change.target === claim.target
        && change.from === claim.from
        && change.to === claim.to);
    }

    case 'display':
      return event.display === true;

    case 'unchanged':
      return event.changes.length === 0 && !event.display;

    default:
      return false;
  }
}

/**
 * Check an explanation against the event it claims to describe.
 *
 * @returns {{ ok: boolean, unsupported: string[] }}
 */
export function verifyExplanation(explanation, event) {
  if (!explanation || !event) {
    return { ok: false, unsupported: ['Missing explanation or event.'] };
  }

  const unsupported = [];
  if (explanation.address !== event.address || explanation.opcode !== event.opcode) {
    unsupported.push('The explanation is about a different instruction.');
  }

  for (const statement of explanation.statements) {
    const evidence = statement.evidence || [];
    if (!evidence.length || !evidence.every((item) => supports(item, event))) {
      unsupported.push(statement.text);
    }
  }

  return { ok: unsupported.length === 0, unsupported };
}

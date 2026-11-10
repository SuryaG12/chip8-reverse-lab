/**
 * disassembler.js — decode CHIP-8 opcodes into readable instructions.
 *
 * Pure module: no DOM and no CPU state. The listing panel uses it now; the
 * debugger and the evidence trace can reuse it later.
 */

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');

const regX = (op) => `V${((op >> 8) & 0xF).toString(16).toUpperCase()}`;
const regY = (op) => `V${((op >> 4) & 0xF).toString(16).toUpperCase()}`;

function unknown(op) {
  const raw = `0x${hex(op, 4)}`;
  return { mnemonic: '???', args: raw, text: `??? ${raw}` };
}

/**
 * Decode one 16-bit opcode.
 *
 * @param {number} opcode
 * @returns {{ opcode: number, mnemonic: string, args: string, text: string }}
 */
export function disassembleOpcode(opcode) {
  const op = opcode & 0xFFFF;
  const n = op & 0xF;
  const nn = op & 0xFF;
  const nnn = op & 0xFFF;
  const x = regX(op);
  const y = regY(op);
  const imm = `0x${hex(nn, 2)}`;
  const addr = `0x${hex(nnn, 3)}`;

  let mnemonic = '';
  let args = '';

  switch (op >> 12) {
    case 0x0:
      if (op === 0x00E0) mnemonic = 'CLS';
      else if (op === 0x00EE) mnemonic = 'RET';
      else {
        mnemonic = 'SYS';
        args = addr;
      }
      break;

    case 0x1:
      mnemonic = 'JP';
      args = addr;
      break;

    case 0x2:
      mnemonic = 'CALL';
      args = addr;
      break;

    case 0x3:
      mnemonic = 'SE';
      args = `${x}, ${imm}`;
      break;

    case 0x4:
      mnemonic = 'SNE';
      args = `${x}, ${imm}`;
      break;

    case 0x5:
      if (n !== 0) break;
      mnemonic = 'SE';
      args = `${x}, ${y}`;
      break;

    case 0x6:
      mnemonic = 'LD';
      args = `${x}, ${imm}`;
      break;

    case 0x7:
      mnemonic = 'ADD';
      args = `${x}, ${imm}`;
      break;

    case 0x8:
      switch (n) {
        case 0x0: mnemonic = 'LD'; args = `${x}, ${y}`; break;
        case 0x1: mnemonic = 'OR'; args = `${x}, ${y}`; break;
        case 0x2: mnemonic = 'AND'; args = `${x}, ${y}`; break;
        case 0x3: mnemonic = 'XOR'; args = `${x}, ${y}`; break;
        case 0x4: mnemonic = 'ADD'; args = `${x}, ${y}`; break;
        case 0x5: mnemonic = 'SUB'; args = `${x}, ${y}`; break;
        case 0x6: mnemonic = 'SHR'; args = x; break;
        case 0x7: mnemonic = 'SUBN'; args = `${x}, ${y}`; break;
        case 0xE: mnemonic = 'SHL'; args = x; break;
        default: break;
      }
      break;

    case 0x9:
      if (n !== 0) break;
      mnemonic = 'SNE';
      args = `${x}, ${y}`;
      break;

    case 0xA:
      mnemonic = 'LD';
      args = `I, ${addr}`;
      break;

    case 0xB:
      mnemonic = 'JP';
      args = `V0, ${addr}`;
      break;

    case 0xC:
      mnemonic = 'RND';
      args = `${x}, ${imm}`;
      break;

    case 0xD:
      mnemonic = 'DRW';
      args = `${x}, ${y}, ${n}`;
      break;

    case 0xE:
      if (nn === 0x9E) {
        mnemonic = 'SKP';
        args = x;
      } else if (nn === 0xA1) {
        mnemonic = 'SKNP';
        args = x;
      }
      break;

    case 0xF:
      switch (nn) {
        case 0x07: mnemonic = 'LD'; args = `${x}, DT`; break;
        case 0x0A: mnemonic = 'LD'; args = `${x}, K`; break;
        case 0x15: mnemonic = 'LD'; args = `DT, ${x}`; break;
        case 0x18: mnemonic = 'LD'; args = `ST, ${x}`; break;
        case 0x1E: mnemonic = 'ADD'; args = `I, ${x}`; break;
        case 0x29: mnemonic = 'LD'; args = `F, ${x}`; break;
        case 0x33: mnemonic = 'LD'; args = `B, ${x}`; break;
        case 0x55: mnemonic = 'LD'; args = `[I], ${x}`; break;
        case 0x65: mnemonic = 'LD'; args = `${x}, [I]`; break;
        default: break;
      }
      break;
  }

  if (!mnemonic) return unknown(op);
  return { opcode: op, mnemonic, args, text: args ? `${mnemonic} ${args}` : mnemonic };
}

/**
 * Decode every instruction in [start, end). Stops before an incomplete pair at
 * the end of the range. Addresses are clamped to the 4KB memory space.
 *
 * @param {Uint8Array} memory
 * @param {number} [start]
 * @param {number} [end]
 * @returns {Array<{ address: number, bytes: string, opcode: number, mnemonic: string, args: string, text: string }>}
 */
export function disassemble(memory, start = 0x200, end = memory.length) {
  const from = Math.max(0, Math.min(start, 0xFFF));
  const to = Math.max(from, Math.min(end, memory.length, 0x1000));
  const out = [];

  for (let address = from; address + 1 < to; address += 2) {
    const opcode = (memory[address] << 8) | memory[address + 1];
    out.push({ address, bytes: hex(opcode, 4), ...disassembleOpcode(opcode) });
  }

  return out;
}

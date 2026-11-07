/**
 * cpu.js — the CHIP-8 CPU core.
 *
 * IMPORTANT DESIGN RULE: this file never touches the DOM (no document, window,
 * canvas, or audio). It only holds state and executes instructions. That makes
 * it easy to unit test, and the debugger can reuse it later.
 *
 * The browser talks to the CPU through a small interface:
 *   cpu.loadRom(bytes)       copy a program into memory at 0x200
 *   cpu.step()               execute exactly ONE instruction
 *   cpu.tick60()             call 60 times per second: timers count down
 *   cpu.setKey(k, pressed)   tell the CPU a keypad key changed
 *   cpu.display              64x32 array of 0/1 pixels (read it to draw)
 *   cpu.getState()           snapshot of registers etc. (for the debugger)
 */

import { FONT, FONT_START, FONT_CHAR_SIZE } from './fontset.js';
import { MODERN } from './quirks.js';

export const MEMORY_SIZE = 4096;
export const PROGRAM_START = 0x200;
export const MAX_ROM_SIZE = MEMORY_SIZE - PROGRAM_START;
export const DISPLAY_WIDTH = 64;
export const DISPLAY_HEIGHT = 32;
export const STACK_SIZE = 16;

export class Chip8 {
  /**
   * @param {object} quirks  see quirks.js. Missing flags fall back to MODERN.
   */
  constructor(quirks = MODERN) {
    this.quirks = { ...MODERN, ...quirks };

    // Source of randomness for CXNN. A function so tests can replace it
    // with something predictable.
    this.random = () => Math.floor(Math.random() * 256);

    this.reset();
  }

  /** Put the machine back in its power-on state. ROM must be loaded again. */
  reset() {
    // Typed arrays automatically wrap values: storing 256 in a Uint8Array
    // stores 0. That is exactly how CHIP-8's 8-bit registers behave.
    this.memory = new Uint8Array(MEMORY_SIZE); // 4KB RAM
    this.V = new Uint8Array(16);               // V0..VF general registers
    this.I = 0;                                // index register (12 bits used)
    this.pc = PROGRAM_START;                   // program counter
    this.stack = new Uint16Array(STACK_SIZE);  // return addresses
    this.sp = 0;                               // stack pointer (next free slot)
    this.delayTimer = 0;
    this.soundTimer = 0;

    // 64x32 pixels, one byte per pixel: 0 = off, 1 = on. Row-major, so the
    // pixel at (x, y) is display[y * 64 + x].
    this.display = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
    this.drawFlag = false; // set true whenever the display changes

    this.keys = new Uint8Array(16); // 1 while a key is held down

    this.waitingKey = -1;     // used by FX0A, see below
    this.vblankReady = false; // used by the displayWait quirk

    this.memory.set(FONT, FONT_START);
  }

  /** Copy a ROM (Uint8Array) into memory starting at 0x200. */
  loadRom(bytes) {
    if (bytes.length > MAX_ROM_SIZE) {
      throw new Error(`ROM is ${bytes.length} bytes; the maximum is ${MAX_ROM_SIZE}.`);
    }
    this.memory.set(bytes, PROGRAM_START);
  }

  /** Press or release a keypad key (0x0 - 0xF). */
  setKey(key, pressed) {
    this.keys[key & 0xF] = pressed ? 1 : 0;
  }

  /** Called 60 times per second, independent of how fast instructions run. */
  tick60() {
    if (this.delayTimer > 0) this.delayTimer--;
    if (this.soundTimer > 0) this.soundTimer--;
    this.vblankReady = true; // a "vertical blank" has happened
  }

  /** Read the 2-byte opcode stored at an address, without executing it. */
  getOpcodeAt(addr) {
    // Opcodes are big-endian: high byte first.
    return (this.memory[addr & 0xFFF] << 8) | this.memory[(addr + 1) & 0xFFF];
  }

  /**
   * A snapshot of the CPU for the debugger. Arrays are copies, so changing
   * them does not change the CPU. Memory is only copied if asked for,
   * because it is 4KB (read cpu.memory directly if you only need to look).
   */
  getState(includeMemory = false) {
    const state = {
      pc: this.pc,
      I: this.I,
      sp: this.sp,
      V: Array.from(this.V),
      stack: Array.from(this.stack),
      delayTimer: this.delayTimer,
      soundTimer: this.soundTimer,
      nextOpcode: this.getOpcodeAt(this.pc),
    };
    if (includeMemory) state.memory = new Uint8Array(this.memory);
    return state;
  }

  /**
   * Execute exactly one instruction. Returns the opcode that was executed
   * (handy for the debugger and tests).
   *
   * Every instruction is 16 bits. We split it into pieces:
   *   op  = 0xD123      full opcode
   *   x   = 0x1         second nibble  -> register index VX
   *   y   = 0x2         third nibble   -> register index VY
   *   n   = 0x3         fourth nibble
   *   nn  = 0x23        low byte
   *   nnn = 0x123       low 12 bits    -> an address
   */
  step() {
    const startPc = this.pc;
    const op = this.getOpcodeAt(startPc);

    // Advance PC *before* executing, like the real hardware. Instructions that
    // jump simply overwrite it; skips add another 2; "wait" instructions
    // subtract 2 to run again next step.
    this.pc = (startPc + 2) & 0xFFF;

    const x = (op >> 8) & 0xF;
    const y = (op >> 4) & 0xF;
    const n = op & 0xF;
    const nn = op & 0xFF;
    const nnn = op & 0xFFF;
    const V = this.V;

    // The first nibble tells us the instruction family.
    switch (op >> 12) {
      case 0x0:
        if (op === 0x00E0) {
          // 00E0: clear the screen
          this.display.fill(0);
          this.drawFlag = true;
        } else if (op === 0x00EE) {
          // 00EE: return from subroutine
          if (this.sp === 0) this._fault('Stack underflow (00EE with empty stack)', op, startPc);
          this.sp--;
          this.pc = this.stack[this.sp];
        }
        // else 0NNN: "call machine code routine". Not meaningful on an
        // emulator, so it is ignored (a no-op).
        break;

      case 0x1:
        // 1NNN: jump to NNN
        this.pc = nnn;
        break;

      case 0x2:
        // 2NNN: call subroutine at NNN (push return address, then jump)
        if (this.sp >= STACK_SIZE) this._fault('Stack overflow (more than 16 nested calls)', op, startPc);
        this.stack[this.sp] = this.pc; // pc already points at the NEXT instruction
        this.sp++;
        this.pc = nnn;
        break;

      case 0x3:
        // 3XNN: skip next instruction if VX == NN
        if (V[x] === nn) this._skip();
        break;

      case 0x4:
        // 4XNN: skip next instruction if VX != NN
        if (V[x] !== nn) this._skip();
        break;

      case 0x5:
        // 5XY0: skip next instruction if VX == VY
        if (n !== 0) this._fault('Unknown opcode', op, startPc);
        if (V[x] === V[y]) this._skip();
        break;

      case 0x6:
        // 6XNN: VX = NN
        V[x] = nn;
        break;

      case 0x7:
        // 7XNN: VX += NN (wraps at 256; does NOT touch VF)
        V[x] = V[x] + nn;
        break;

      case 0x8:
        this._execArithmetic(op, x, y, n, startPc);
        break;

      case 0x9:
        // 9XY0: skip next instruction if VX != VY
        if (n !== 0) this._fault('Unknown opcode', op, startPc);
        if (V[x] !== V[y]) this._skip();
        break;

      case 0xA:
        // ANNN: I = NNN
        this.I = nnn;
        break;

      case 0xB:
        // BNNN: jump to NNN + V0      (quirk jumpUsesVX: jump to NNN + VX,
        //       where X is the top nibble of NNN, i.e. the BXNN form)
        this.pc = (nnn + (this.quirks.jumpUsesVX ? V[x] : V[0])) & 0xFFF;
        break;

      case 0xC:
        // CXNN: VX = random byte AND NN
        V[x] = this.random() & nn;
        break;

      case 0xD:
        // DXYN: draw an 8-pixel-wide, N-row-tall sprite from memory[I]
        //       at (VX, VY). VF = 1 if any lit pixel was turned off.
        if (this.quirks.displayWait && !this.vblankReady) {
          // Original hardware waits for the next frame before drawing.
          // We "stall" by rewinding PC so this same instruction runs again.
          this.pc = startPc;
          break;
        }
        this.vblankReady = false;
        this._drawSprite(V[x], V[y], n);
        break;

      case 0xE:
        // Keypad skips. VX holds the key number; only the low nibble matters.
        if (nn === 0x9E) {
          // EX9E: skip if key VX is pressed
          if (this.keys[V[x] & 0xF]) this._skip();
        } else if (nn === 0xA1) {
          // EXA1: skip if key VX is NOT pressed
          if (!this.keys[V[x] & 0xF]) this._skip();
        } else {
          this._fault('Unknown opcode', op, startPc);
        }
        break;

      case 0xF:
        this._execMisc(op, x, nn, startPc);
        break;
    }

    return op;
  }

  // ---------------------------------------------------------------------
  // Helpers below. The leading underscore means "internal, don't call me
  // from outside this class".
  // ---------------------------------------------------------------------

  /** Skip the next instruction (each instruction is 2 bytes). */
  _skip() {
    this.pc = (this.pc + 2) & 0xFFF;
  }

  /**
   * Stop with an error. PC is put back on the faulting instruction so the
   * debugger shows where it went wrong.
   */
  _fault(message, op, addr) {
    this.pc = addr;
    const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');
    throw new Error(`${message}: opcode ${hex(op, 4)} at address ${hex(addr, 3)}`);
  }

  /** The 8XY? family: register-to-register maths and logic. */
  _execArithmetic(op, x, y, n, startPc) {
    const V = this.V;
    // IMPORTANT: for instructions that set VF as a flag, we write the
    // RESULT first and the FLAG last. If X is 0xF, the flag must win.
    switch (n) {
      case 0x0: // 8XY0: VX = VY
        V[x] = V[y];
        break;

      case 0x1: // 8XY1: VX |= VY
        V[x] = V[x] | V[y];
        if (this.quirks.logicResetsVF) V[0xF] = 0;
        break;

      case 0x2: // 8XY2: VX &= VY
        V[x] = V[x] & V[y];
        if (this.quirks.logicResetsVF) V[0xF] = 0;
        break;

      case 0x3: // 8XY3: VX ^= VY
        V[x] = V[x] ^ V[y];
        if (this.quirks.logicResetsVF) V[0xF] = 0;
        break;

      case 0x4: { // 8XY4: VX += VY; VF = 1 if the sum overflowed past 255
        const sum = V[x] + V[y];
        V[x] = sum;
        V[0xF] = sum > 0xFF ? 1 : 0;
        break;
      }

      case 0x5: { // 8XY5: VX -= VY; VF = 1 if NO borrow (VX >= VY)
        const noBorrow = V[x] >= V[y] ? 1 : 0;
        V[x] = V[x] - V[y];
        V[0xF] = noBorrow;
        break;
      }

      case 0x6: { // 8XY6: shift right by 1; VF = the bit shifted out
        const src = this.quirks.shiftUsesVY ? V[y] : V[x];
        V[x] = src >> 1;
        V[0xF] = src & 1;
        break;
      }

      case 0x7: { // 8XY7: VX = VY - VX; VF = 1 if NO borrow (VY >= VX)
        const noBorrow = V[y] >= V[x] ? 1 : 0;
        V[x] = V[y] - V[x];
        V[0xF] = noBorrow;
        break;
      }

      case 0xE: { // 8XYE: shift left by 1; VF = the bit shifted out
        const src = this.quirks.shiftUsesVY ? V[y] : V[x];
        V[x] = src << 1; // the Uint8Array drops the top bit for us
        V[0xF] = (src >> 7) & 1;
        break;
      }

      default:
        this._fault('Unknown opcode', op, startPc);
    }
  }

  /** The FX?? family: timers, I register, memory transfers, key wait. */
  _execMisc(op, x, nn, startPc) {
    const V = this.V;
    switch (nn) {
      case 0x07: // FX07: VX = delay timer
        V[x] = this.delayTimer;
        break;

      case 0x0A: // FX0A: wait for a key press AND release, store key in VX
        // The CPU "blocks" by rewinding PC so this instruction repeats.
        // Timers keep running because tick60() is separate from step().
        if (this.waitingKey === -1) {
          // Phase 1: wait for any key to go down.
          const pressed = this.keys.findIndex((k) => k === 1);
          if (pressed !== -1) this.waitingKey = pressed;
          this.pc = startPc;
        } else if (this.keys[this.waitingKey]) {
          // Phase 2: key is still held, keep waiting for the release.
          this.pc = startPc;
        } else {
          // Released: finish the instruction.
          V[x] = this.waitingKey;
          this.waitingKey = -1;
        }
        break;

      case 0x15: // FX15: delay timer = VX
        this.delayTimer = V[x];
        break;

      case 0x18: // FX18: sound timer = VX
        this.soundTimer = V[x];
        break;

      case 0x1E: // FX1E: I += VX
        this.I = (this.I + V[x]) & 0xFFF;
        break;

      case 0x29: // FX29: I = address of the font sprite for digit VX
        this.I = FONT_START + (V[x] & 0xF) * FONT_CHAR_SIZE;
        break;

      case 0x33: { // FX33: store VX as 3 decimal digits at I, I+1, I+2
        const value = V[x];
        this.memory[this.I & 0xFFF] = Math.floor(value / 100);
        this.memory[(this.I + 1) & 0xFFF] = Math.floor(value / 10) % 10;
        this.memory[(this.I + 2) & 0xFFF] = value % 10;
        break;
      }

      case 0x55: // FX55: store V0..VX into memory starting at I
        for (let i = 0; i <= x; i++) this.memory[(this.I + i) & 0xFFF] = V[i];
        if (this.quirks.loadStoreIncrementsI) this.I = (this.I + x + 1) & 0xFFF;
        break;

      case 0x65: // FX65: load V0..VX from memory starting at I
        for (let i = 0; i <= x; i++) V[i] = this.memory[(this.I + i) & 0xFFF];
        if (this.quirks.loadStoreIncrementsI) this.I = (this.I + x + 1) & 0xFFF;
        break;

      default:
        this._fault('Unknown opcode', op, startPc);
    }
  }

  /**
   * Draw a sprite. Sprites are XOR-ed onto the screen: a lit sprite pixel
   * flips the screen pixel. If that turns a lit pixel OFF, that is a
   * "collision", reported in VF (games use this to detect hits).
   *
   * vx, vy are the VALUES of VX and VY, passed in so that writing VF at the
   * end cannot disturb them.
   */
  _drawSprite(vx, vy, height) {
    // The starting position always wraps around the screen.
    const startX = vx % DISPLAY_WIDTH;
    const startY = vy % DISPLAY_HEIGHT;
    let collision = 0;

    for (let row = 0; row < height; row++) {
      let py = startY + row;
      if (py >= DISPLAY_HEIGHT) {
        if (this.quirks.spriteClipping) break; // cut off at the bottom edge
        py %= DISPLAY_HEIGHT;                  // or wrap to the top
      }

      const spriteByte = this.memory[(this.I + row) & 0xFFF];

      for (let col = 0; col < 8; col++) {
        // Bit 7 is the leftmost pixel, bit 0 the rightmost.
        if (((spriteByte >> (7 - col)) & 1) === 0) continue;

        let px = startX + col;
        if (px >= DISPLAY_WIDTH) {
          if (this.quirks.spriteClipping) break; // cut off at the right edge
          px %= DISPLAY_WIDTH;                   // or wrap to the left
        }

        const index = py * DISPLAY_WIDTH + px;
        if (this.display[index] === 1) collision = 1;
        this.display[index] ^= 1; // XOR: flip the pixel
      }
    }

    this.V[0xF] = collision;
    this.drawFlag = true;
  }
}

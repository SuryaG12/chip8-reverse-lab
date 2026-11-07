/**
 * quirks.js — behaviours that differ between CHIP-8 interpreters.
 *
 * The original 1970s COSMAC VIP interpreter did some things one way, and later
 * interpreters (CHIP-48, SUPER-CHIP, modern emulators) changed them. ROMs were
 * written for a specific interpreter, so a ROM may only work with the matching
 * quirk settings. Every difference is a named boolean flag here.
 *
 * Usage:
 *   new Chip8(MODERN)                      // default
 *   new Chip8(ORIGINAL_VIP)                // original behaviour
 *   new Chip8({ ...MODERN, displayWait: true })   // tweak one flag
 */

/**
 * Flag reference:
 *
 * shiftUsesVY          8XY6 / 8XYE (shift right / left)
 *                      true : copy VY into VX first, then shift (original VIP)
 *                      false: shift VX in place, ignore VY (CHIP-48 / SCHIP)
 *
 * loadStoreIncrementsI FX55 / FX65 (store / load registers V0..VX)
 *                      true : I ends up as I + X + 1 (original VIP)
 *                      false: I is left unchanged (CHIP-48 / SCHIP)
 *
 * jumpUsesVX           BNNN (jump with offset)
 *                      true : treated as BXNN, jump to XNN + VX (SCHIP)
 *                      false: jump to NNN + V0 (original VIP)
 *
 * logicResetsVF        8XY1 / 8XY2 / 8XY3 (OR / AND / XOR)
 *                      true : VF is set to 0 afterwards (original VIP)
 *                      false: VF is left alone
 *
 * spriteClipping       DXYN (draw sprite) at the screen edge
 *                      true : parts of a sprite beyond the edge are cut off
 *                      false: they wrap around to the other side
 *                      (a sprite's *starting* position always wraps)
 *
 * displayWait          DXYN waits for the next 60Hz vertical blank
 *                      true : at most one sprite is drawn per frame (original VIP)
 *                      false: draw immediately
 *                      NOTE: when true, you must call cpu.tick60() regularly or
 *                      the CPU will stall on its first DXYN.
 */

/** Sensible defaults: works with most ROMs you will download. */
export const MODERN = Object.freeze({
  shiftUsesVY: false,
  loadStoreIncrementsI: false,
  jumpUsesVX: false,
  logicResetsVF: false,
  spriteClipping: true,
  displayWait: false,
});

/** Behaviour of the original COSMAC VIP interpreter. */
export const ORIGINAL_VIP = Object.freeze({
  shiftUsesVY: true,
  loadStoreIncrementsI: true,
  jumpUsesVX: false,
  logicResetsVF: true,
  spriteClipping: true,
  displayWait: true,
});

/** Handy for building a dropdown in the UI later. */
export const PRESETS = Object.freeze({ MODERN, ORIGINAL_VIP });

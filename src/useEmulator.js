/**
 * useEmulator.js — React glue for the CHIP-8 core.
 *
 * All timing, rendering and input live here. The core in cpu.js stays pure:
 * this hook only drives it and mirrors what the UI needs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip8, DISPLAY_WIDTH, DISPLAY_HEIGHT, MAX_ROM_SIZE, PROGRAM_START } from './cpu.js';
import { disassemble } from './disassembler.js';
import { createHistory } from './history.js';
import {
  addEntry,
  buildLibraryEntry,
  createLibrary,
  findEntry,
  hashRom,
  parseLibrary,
  removeEntry,
  serializeLibrary,
} from './library.js';
import { MODERN, ORIGINAL_VIP } from './quirks.js';
import { applySnapshot, buildSnapshot, validateSnapshot } from './snapshot.js';
import { createTrace, recordStep } from './trace.js';
import {
  describeWatch,
  findWatchChanges,
  formatWatchHit,
  parseWatchInput,
  snapshotWatchValues,
} from './watch.js';

/** Default instructions per second while running. */
const DEFAULT_SPEED = 700;

/** Timers tick 60 times per second. */
const TIMER_HZ = 60;

const LIBRARY_STORAGE_KEY = 'chip8-reverse-lab.library.v1';

/** Physical key (KeyboardEvent.code) -> CHIP-8 keypad value. */
const KEY_MAP = {
  Digit1: 0x1, Digit2: 0x2, Digit3: 0x3, Digit4: 0xC,
  KeyQ: 0x4, KeyW: 0x5, KeyE: 0x6, KeyR: 0xD,
  KeyA: 0x7, KeyS: 0x8, KeyD: 0x9, KeyF: 0xE,
  KeyZ: 0xA, KeyX: 0x0, KeyC: 0xB, KeyV: 0xF,
};

const PIXEL_ON = [125, 255, 178];
const PIXEL_OFF = [8, 11, 14];

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');

function quirksFor(name) {
  return name === 'vip' ? ORIGINAL_VIP : MODERN;
}

/** Read the saved ROM library, falling back to an empty one on any problem. */
function readStoredLibrary() {
  try {
    if (typeof localStorage === 'undefined') return createLibrary();
    const text = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!text) return createLibrary();
    return parseLibrary(JSON.parse(text)).library;
  } catch {
    return createLibrary();
  }
}

/** Persist the library; returns false when storage is unavailable or full. */
function persistLibrary(library) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(LIBRARY_STORAGE_KEY, serializeLibrary(library));
    return true;
  } catch {
    return false;
  }
}

/** How many memory bytes the debugger shows at once (8 rows of 16). */
const MEMORY_WINDOW = 128;

/** A plain-object snapshot the React panels can render. */
function readDebugState(cpu) {
  const maxBase = Math.max(0, 4096 - MEMORY_WINDOW);
  const candidate = Math.max(0, cpu.I - 32);
  const memoryBase = Math.min(candidate & ~0xF, maxBase);

  return {
    pc: cpu.pc,
    I: cpu.I,
    sp: cpu.sp,
    delayTimer: cpu.delayTimer,
    soundTimer: cpu.soundTimer,
    V: Array.from(cpu.V),
    stack: Array.from(cpu.stack.slice(0, cpu.sp)),
    memoryBase,
    memoryWindow: Array.from(cpu.memory.slice(memoryBase, memoryBase + MEMORY_WINDOW)),
    allMemory: Array.from(cpu.memory),
  };
}

export function useEmulator() {
  const cpuRef = useRef(new Chip8(MODERN));
  const canvasRef = useRef(null);
  const debugRef = useRef(null);
  const imageRef = useRef(null);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const lastTimeRef = useRef(0);
  const instructionDebtRef = useRef(0);
  const timerDebtRef = useRef(0);
  const romBytesRef = useRef(null);
  const audioRef = useRef({ ctx: null, gain: null });
  const breakpointsRef = useRef(new Set());
  const watchpointsRef = useRef([]);
  const resumeAddressRef = useRef(-1);
  const lastPublishRef = useRef(0);
  const traceRef = useRef(createTrace());
  const historyRef = useRef(createHistory());
  const speedRef = useRef(DEFAULT_SPEED);

  const [running, setRunning] = useState(false);
  const [rom, setRom] = useState(null);
  const [preset, setPreset] = useState('modern');
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [heldKeys, setHeldKeys] = useState(() => new Set());
  const [listing, setListing] = useState([]);
  const [debug, setDebug] = useState(() => readDebugState(cpuRef.current));
  const [trace, setTrace] = useState([]);
  const [traceStats, setTraceStats] = useState(() => traceRef.current.stats());
  const [breakpoints, setBreakpoints] = useState(() => new Set());
  const [watchpoints, setWatchpoints] = useState([]);
  const [historyDepth, setHistoryDepth] = useState(0);
  const [library, setLibrary] = useState(readStoredLibrary);
  const [status, setStatus] = useState({ text: 'Load a ROM to begin.', kind: 'idle' });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!imageRef.current) {
      imageRef.current = ctx.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    }

    const data = imageRef.current.data;
    const display = cpuRef.current.display;
    for (let i = 0; i < display.length; i++) {
      const color = display[i] ? PIXEL_ON : PIXEL_OFF;
      const offset = i * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }

    ctx.putImageData(imageRef.current, 0, 0);
    cpuRef.current.drawFlag = false;
  }, []);

  const updateDebug = useCallback(() => {
    const cpu = cpuRef.current;
    const el = debugRef.current;
    if (el) {
      el.textContent =
        `PC ${hex(cpu.pc, 3)}  I ${hex(cpu.I, 3)}  ` +
        `op ${hex(cpu.getOpcodeAt(cpu.pc), 4)}  ` +
        `DT ${cpu.delayTimer}  ST ${cpu.soundTimer}`;
    }

    // Publish a snapshot to React at a human-readable rate; the debug text
    // above still updates every frame. Paused/stepping publishes immediately.
    const now = performance.now();
    if (!runningRef.current || now - lastPublishRef.current >= 150) {
      lastPublishRef.current = now;
      setDebug(readDebugState(cpu));
      setTrace(traceRef.current.snapshot());
      setTraceStats(traceRef.current.stats());
      setHistoryDepth(historyRef.current.size);
    }
  }, []);

  const setSound = useCallback((on) => {
    const { ctx, gain } = audioRef.current;
    if (!ctx || !gain) return;
    gain.gain.setTargetAtTime(on ? 0.04 : 0, ctx.currentTime, 0.01);
  }, []);

  const ensureAudio = useCallback(() => {
    const current = audioRef.current;
    if (current.ctx) {
      if (current.ctx.state === 'suspended') current.ctx.resume();
      return;
    }

    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;

    const ctx = new AudioCtor();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'square';
    oscillator.frequency.value = 440;
    gain.gain.value = 0;

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    audioRef.current = { ctx, gain };
  }, []);

  /** Press or release a keypad key from the keyboard or the on-screen pad. */
  const pressKey = useCallback((key, pressed) => {
    cpuRef.current.setKey(key, pressed);
    setHeldKeys((current) => {
      if (current.has(key) === pressed) return current;
      const next = new Set(current);
      if (pressed) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const changeSpeed = useCallback((value) => {
    const next = Number(value);
    speedRef.current = next;
    setSpeed(next);
  }, []);

  const pause = useCallback((text = 'Paused.', kind = 'ok') => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setSound(false);
    setRunning(false);
    setStatus({ text, kind });
    updateDebug();
  }, [setSound, updateDebug]);

  const fail = useCallback((error) => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setSound(false);
    setRunning(false);
    setStatus({ text: error.message, kind: 'error' });
    updateDebug();
  }, [setSound, updateDebug]);

  const start = useCallback(() => {
    if (!romBytesRef.current) {
      setStatus({ text: 'Load a ROM first.', kind: 'warn' });
      return;
    }
    if (runningRef.current) return;

    ensureAudio();
    runningRef.current = true;
    setRunning(true);
    setStatus({ text: 'Running.', kind: 'ok' });
    lastTimeRef.current = 0;
    instructionDebtRef.current = 0;
    timerDebtRef.current = 0;
    // If we are parked on a breakpoint, let Run execute that one instruction
    // instead of pausing again immediately.
    resumeAddressRef.current = breakpointsRef.current.has(cpuRef.current.pc)
      ? cpuRef.current.pc
      : -1;

    const frame = (now) => {
      if (!runningRef.current) return;
      const cpu = cpuRef.current;

      if (!lastTimeRef.current) lastTimeRef.current = now;
      // Clamp the delta so a backgrounded tab cannot flood the CPU on return.
      const delta = Math.min(now - lastTimeRef.current, 250);
      lastTimeRef.current = now;

      instructionDebtRef.current += (delta / 1000) * speedRef.current;
      const steps = Math.floor(instructionDebtRef.current);
      instructionDebtRef.current -= steps;

      try {
        const watches = watchpointsRef.current;
        for (let i = 0; i < steps; i++) {
          const address = cpu.pc;
          if (address === resumeAddressRef.current) {
            resumeAddressRef.current = -1;
          } else if (breakpointsRef.current.has(address)) {
            pause(`Breakpoint at 0x${hex(address, 3)}.`, 'warn');
            return;
          }
          // Watches compare the value before and after one instruction, so a
          // multi-write instruction still reports a single, exact change.
          const before = watches.length ? snapshotWatchValues(cpu, watches) : null;
          historyRef.current.record(cpu, {
            address,
            traceLength: traceRef.current.size,
            traceTotal: traceRef.current.total,
          });
          recordStep(cpu, traceRef.current);

          if (watches.length) {
            const changes = findWatchChanges(cpu, watches, before);
            if (changes.length) {
              if (cpu.drawFlag) draw();
              pause(formatWatchHit(changes, address), 'warn');
              return;
            }
          }
        }
      } catch (error) {
        fail(error);
        return;
      }

      timerDebtRef.current += delta;
      while (timerDebtRef.current >= 1000 / TIMER_HZ) {
        timerDebtRef.current -= 1000 / TIMER_HZ;
        cpu.tick60();
      }

      if (cpu.drawFlag) draw();
      setSound(cpu.soundTimer > 0);
      updateDebug();

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
  }, [draw, ensureAudio, fail, pause, setSound, updateDebug]);

  const step = useCallback(() => {
    if (!romBytesRef.current || runningRef.current) return;

    try {
      const watches = watchpointsRef.current;
      const address = cpuRef.current.pc;
      const before = watches.length ? snapshotWatchValues(cpuRef.current, watches) : null;
      historyRef.current.record(cpuRef.current, {
        address,
        traceLength: traceRef.current.size,
        traceTotal: traceRef.current.total,
      });
      recordStep(cpuRef.current, traceRef.current);
      draw();
      updateDebug();

      const changes = watches.length
        ? findWatchChanges(cpuRef.current, watches, before)
        : [];
      setStatus(changes.length
        ? { text: formatWatchHit(changes, address), kind: 'warn' }
        : { text: 'Stepped one instruction.', kind: 'ok' });
    } catch (error) {
      fail(error);
    }
  }, [draw, fail, updateDebug]);

  const resetWith = useCallback((name) => {
    const cpu = new Chip8(quirksFor(name));
    if (romBytesRef.current) cpu.loadRom(romBytesRef.current);
    cpuRef.current = cpu;
    traceRef.current.clear();
    historyRef.current.clear();
    setTrace([]);
    setHeldKeys(new Set());
    draw();
    updateDebug();
  }, [draw, updateDebug]);

  const loadRomBytes = useCallback((bytes, name, { nextPreset = preset } = {}) => {
    if (!bytes || bytes.length === 0) throw new Error('That file is empty.');
    if (bytes.length > MAX_ROM_SIZE) {
      throw new Error(`ROM is ${bytes.length} bytes; the maximum is ${MAX_ROM_SIZE}.`);
    }

    pause();
    breakpointsRef.current = new Set();
    setBreakpoints(new Set());
    romBytesRef.current = bytes;
    setPreset(nextPreset);
    resetWith(nextPreset);
    setListing(disassemble(cpuRef.current.memory, PROGRAM_START, PROGRAM_START + bytes.length));
    setRom({ name, size: bytes.length, hash: hashRom(bytes) });
    setStatus({ text: `Loaded ${name} (${bytes.length} bytes). Press Run.`, kind: 'ok' });
  }, [pause, preset, resetWith]);

  const loadRom = useCallback(async (file) => {
    if (!file) return;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      loadRomBytes(bytes, file.name);
    } catch (error) {
      fail(error);
    }
  }, [fail, loadRomBytes]);

  const changePreset = useCallback((name) => {
    if (runningRef.current) return;

    setPreset(name);
    if (!romBytesRef.current) {
      setStatus({ text: `Quirk preset: ${name}. Load a ROM.`, kind: 'ok' });
      return;
    }

    pause('Preset changed. ROM reset.');
    resetWith(name);
  }, [pause, resetWith]);

  /** Step the machine back to the state before the last instruction. */
  const stepBack = useCallback(() => {
    if (runningRef.current) return;

    const entry = historyRef.current.undo(cpuRef.current);
    if (!entry) {
      setStatus({ text: 'No earlier state is available.', kind: 'warn' });
      return;
    }

    traceRef.current.rewindTo(
      entry.meta.traceLength ?? traceRef.current.size,
      entry.meta.traceTotal ?? traceRef.current.total,
    );
    draw();
    updateDebug();
    setStatus({ text: `Stepped back to 0x${hex(cpuRef.current.pc, 3)}.`, kind: 'ok' });
  }, [draw, updateDebug]);

  /** Restart the loaded ROM from 0x200, keeping breakpoints in place. */
  const reset = useCallback(() => {
    if (!romBytesRef.current) {
      setStatus({ text: 'Load a ROM first.', kind: 'warn' });
      return;
    }

    pause();
    resumeAddressRef.current = -1;
    resetWith(preset);
    setStatus({
      text: `Reset ${rom?.name ?? 'the ROM'} to 0x200. Breakpoints kept.`,
      kind: 'ok',
    });
  }, [pause, preset, resetWith, rom]);

  /** Save the current 64x32 frame as a scaled-up PNG. */
  const saveScreenshot = useCallback(() => {
    const source = canvasRef.current;
    if (!source) return;

    const scale = 8;
    const frame = document.createElement('canvas');
    frame.width = DISPLAY_WIDTH * scale;
    frame.height = DISPLAY_HEIGHT * scale;
    const context = frame.getContext('2d');
    if (!context) return;

    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0, frame.width, frame.height);

    frame.toBlob((blob) => {
      if (!blob) {
        setStatus({ text: 'Could not create the PNG.', kind: 'error' });
        return;
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(rom?.name ?? 'chip8').replace(/\.[^.]+$/, '')}-frame.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus({ text: 'Saved the current display as a PNG.', kind: 'ok' });
    }, 'image/png');
  }, [rom]);

  /** Save the loaded ROM's bytes and metadata to the browser library. */
  const saveToLibrary = useCallback(() => {
    if (!rom || !romBytesRef.current) {
      setStatus({ text: 'Load a ROM before saving it.', kind: 'warn' });
      return false;
    }

    try {
      const entry = buildLibraryEntry({
        name: rom.name,
        bytes: romBytesRef.current,
        preset,
      });
      const result = addEntry(library, entry);

      if (!result.added) {
        setStatus({
          text: result.reason === 'duplicate'
            ? `${rom.name} is already in the library.`
            : 'The ROM library is full.',
          kind: 'warn',
        });
        return false;
      }

      const persisted = persistLibrary(result.library);
      setLibrary(result.library);
      setStatus({
        text: persisted
          ? `Saved ${rom.name} to the library.`
          : `Saved ${rom.name} for this session only; browser storage is unavailable.`,
        kind: persisted ? 'ok' : 'warn',
      });
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }, [fail, library, preset, rom]);

  /** Load a saved ROM, restoring the quirk preset it was saved with. */
  const loadLibraryEntry = useCallback((id) => {
    const entry = findEntry(library, id);
    if (!entry) {
      setStatus({ text: 'That ROM is no longer in the library.', kind: 'warn' });
      return false;
    }

    try {
      loadRomBytes(Uint8Array.from(entry.bytes), entry.name, { nextPreset: entry.preset });
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }, [fail, library, loadRomBytes]);

  const removeLibraryEntry = useCallback((id) => {
    const entry = findEntry(library, id);
    const next = removeEntry(library, id);
    setLibrary(next);
    persistLibrary(next);
    setStatus({
      text: entry ? `Removed ${entry.name} from the library.` : 'ROM removed from the library.',
      kind: 'ok',
    });
  }, [library]);

  /** Build a portable snapshot of the current CPU state. */
  const saveSnapshot = useCallback((createdAt = new Date()) => buildSnapshot(cpuRef.current, {
    rom: rom && romBytesRef.current
      ? { name: rom.name, size: rom.size, bytes: Array.from(romBytesRef.current) }
      : null,
    preset,
    createdAt,
  }), [preset, rom]);

  /** Restore a validated snapshot, pausing first. Returns false on bad data. */
  const loadSnapshot = useCallback((data) => {
    const check = validateSnapshot(data);
    if (!check.ok) {
      fail(new Error(`Invalid snapshot: ${check.errors[0]}`));
      return false;
    }

    pause();
    const nextPreset = data.preset === 'vip' ? 'vip' : 'modern';
    const cpu = new Chip8(quirksFor(nextPreset));
    applySnapshot(cpu, data);
    cpuRef.current = cpu;

    traceRef.current.clear();
    historyRef.current.clear();
    setTrace([]);
    setTraceStats(traceRef.current.stats());
    breakpointsRef.current = new Set();
    setBreakpoints(new Set());

    const held = new Set();
    Array.from(cpu.keys).forEach((pressed, key) => {
      if (pressed) held.add(key);
    });
    setHeldKeys(held);

    if (data.rom) {
      const bytes = Uint8Array.from(data.rom.bytes);
      romBytesRef.current = bytes;
      setListing(disassemble(cpu.memory, PROGRAM_START, PROGRAM_START + bytes.length));
      setRom({ name: data.rom.name, size: data.rom.size, hash: hashRom(bytes) });
    } else {
      romBytesRef.current = null;
      setListing([]);
      setRom(null);
    }

    setPreset(nextPreset);
    draw();
    updateDebug();
    setStatus({
      text: data.rom
        ? `Restored ${data.rom.name} at 0x${hex(cpu.pc, 3)}.`
        : `Restored CPU state at 0x${hex(cpu.pc, 3)}.`,
      kind: 'ok',
    });
    return true;
  }, [draw, fail, pause, updateDebug]);

  /** Read and restore a snapshot file, reporting parse errors in the status line. */
  const loadSnapshotFile = useCallback(async (file) => {
    if (!file) return false;

    try {
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('That snapshot is not valid JSON.');
      }
      return loadSnapshot(data);
    } catch (error) {
      fail(error);
      return false;
    }
  }, [fail, loadSnapshot]);

  const toggleBreakpoint = useCallback((address) => {
    const next = new Set(breakpointsRef.current);
    if (next.has(address)) next.delete(address);
    else next.add(address);
    breakpointsRef.current = next;
    setBreakpoints(next);
  }, []);

  const clearBreakpoints = useCallback(() => {
    if (!breakpointsRef.current.size) return;
    breakpointsRef.current = new Set();
    setBreakpoints(new Set());
    setStatus({ text: 'All breakpoints cleared.', kind: 'ok' });
  }, []);

  /** Add a watch from a text expression. Returns `{ ok }` or `{ ok: false, error }`. */
  const addWatchpoint = useCallback((input) => {
    const parsed = parseWatchInput(input);
    if (parsed.error) return { ok: false, error: parsed.error };

    const { watch } = parsed;
    if (watchpointsRef.current.some((item) => item.id === watch.id)) {
      return { ok: false, error: `${describeWatch(watch)} is already watched.` };
    }

    const next = [...watchpointsRef.current, watch];
    watchpointsRef.current = next;
    setWatchpoints(next);
    return { ok: true };
  }, []);

  const removeWatchpoint = useCallback((id) => {
    const next = watchpointsRef.current.filter((watch) => watch.id !== id);
    watchpointsRef.current = next;
    setWatchpoints(next);
  }, []);

  const clearWatchpoints = useCallback(() => {
    if (!watchpointsRef.current.length) return;
    watchpointsRef.current = [];
    setWatchpoints([]);
    setStatus({ text: 'All watchpoints cleared.', kind: 'ok' });
  }, []);

  const clearTrace = useCallback(() => {
    traceRef.current.clear();
    historyRef.current.clear();
    setTrace([]);
    setTraceStats(traceRef.current.stats());
    setHistoryDepth(0);
    setStatus({ text: 'Trace and step-back history cleared.', kind: 'ok' });
  }, []);

  // First paint and keyboard wiring.
  useEffect(() => {
    draw();
    updateDebug();
  }, [draw, updateDebug]);

  useEffect(() => {
    const isTypingTarget = (target) => target instanceof HTMLInputElement
      || target instanceof HTMLSelectElement
      || target instanceof HTMLTextAreaElement;

    const onKeyDown = (event) => {
      if (isTypingTarget(event.target)) return;

      // Transport shortcuts. Space also stops a focused button from being
      // activated twice, because preventDefault runs first.
      if (event.code === 'Space' || event.code === 'F7' || event.code === 'F8' || event.code === 'F9') {
        if (event.repeat) return;
        event.preventDefault();
        if (event.code === 'Space') {
          if (runningRef.current) pause();
          else start();
        } else if (event.code === 'F7') step();
        else if (event.code === 'F8') stepBack();
        else reset();
        return;
      }

      const key = KEY_MAP[event.code];
      if (key === undefined) return;
      event.preventDefault();
      pressKey(key, true);
    };

    const onKeyUp = (event) => {
      const key = KEY_MAP[event.code];
      if (key === undefined) return;
      event.preventDefault();
      pressKey(key, false);
    };

    // Releasing focus would otherwise leave keys stuck down.
    const onBlur = () => {
      for (let key = 0; key < 16; key++) pressKey(key, false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [pause, pressKey, reset, start, step, stepBack]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return {
    canvasRef,
    debugRef,
    running,
    rom,
    preset,
    speed,
    heldKeys,
    listing,
    debug,
    trace,
    traceStats,
    breakpoints,
    historyDepth,
    library,
    status,
    start,
    pause,
    step,
    stepBack,
    reset,
    loadRom,
    changePreset,
    changeSpeed,
    pressKey,
    saveSnapshot,
    loadSnapshotFile,
    saveScreenshot,
    saveToLibrary,
    loadLibraryEntry,
    removeLibraryEntry,
    toggleBreakpoint,
    clearBreakpoints,
    watchpoints,
    addWatchpoint,
    removeWatchpoint,
    clearWatchpoints,
    clearTrace,
  };
}

/**
 * useEmulator.js — React glue for the CHIP-8 core.
 *
 * All timing, rendering and input live here. The core in cpu.js stays pure:
 * this hook only drives it and mirrors what the UI needs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip8, DISPLAY_WIDTH, DISPLAY_HEIGHT, MAX_ROM_SIZE, PROGRAM_START } from './cpu.js';
import { disassemble } from './disassembler.js';
import { MODERN, ORIGINAL_VIP } from './quirks.js';

/** How many instructions to execute per second while running. */
const INSTRUCTIONS_PER_SECOND = 700;

/** Timers tick 60 times per second. */
const TIMER_HZ = 60;

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
  const pcRef = useRef(PROGRAM_START);
  const lastPcPublishRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [rom, setRom] = useState(null);
  const [preset, setPreset] = useState('modern');
  const [listing, setListing] = useState([]);
  const [pc, setPc] = useState(PROGRAM_START);
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

    // Publish the PC to React at a human-readable rate; the debug text above
    // still updates every frame. Paused/stepping publishes immediately.
    const now = performance.now();
    if (cpu.pc !== pcRef.current
      && (now - lastPcPublishRef.current >= 200 || !runningRef.current)) {
      pcRef.current = cpu.pc;
      lastPcPublishRef.current = now;
      setPc(cpu.pc);
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

  const pause = useCallback((text = 'Paused.') => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    setSound(false);
    setRunning(false);
    setStatus({ text, kind: 'ok' });
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

    const frame = (now) => {
      if (!runningRef.current) return;
      const cpu = cpuRef.current;

      if (!lastTimeRef.current) lastTimeRef.current = now;
      // Clamp the delta so a backgrounded tab cannot flood the CPU on return.
      const delta = Math.min(now - lastTimeRef.current, 250);
      lastTimeRef.current = now;

      instructionDebtRef.current += (delta / 1000) * INSTRUCTIONS_PER_SECOND;
      const steps = Math.floor(instructionDebtRef.current);
      instructionDebtRef.current -= steps;

      try {
        for (let i = 0; i < steps; i++) cpu.step();
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
  }, [draw, ensureAudio, fail, setSound, updateDebug]);

  const step = useCallback(() => {
    if (!romBytesRef.current || runningRef.current) return;

    try {
      cpuRef.current.step();
      draw();
      updateDebug();
      setStatus({ text: 'Stepped one instruction.', kind: 'ok' });
    } catch (error) {
      fail(error);
    }
  }, [draw, fail, updateDebug]);

  const resetWith = useCallback((name) => {
    const cpu = new Chip8(quirksFor(name));
    if (romBytesRef.current) cpu.loadRom(romBytesRef.current);
    cpuRef.current = cpu;
    draw();
    updateDebug();
  }, [draw, updateDebug]);

  const loadRom = useCallback(async (file) => {
    if (!file) return;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length === 0) throw new Error('That file is empty.');
      if (bytes.length > MAX_ROM_SIZE) {
        throw new Error(`ROM is ${bytes.length} bytes; the maximum is ${MAX_ROM_SIZE}.`);
      }

      pause();
      romBytesRef.current = bytes;
      resetWith(preset);
      setListing(disassemble(cpuRef.current.memory, PROGRAM_START, PROGRAM_START + bytes.length));
      setRom({ name: file.name, size: bytes.length });
      setStatus({ text: `Loaded ${file.name} (${bytes.length} bytes). Press Run.`, kind: 'ok' });
    } catch (error) {
      fail(error);
    }
  }, [fail, pause, preset, resetWith]);

  const changePreset = useCallback((name) => {
    if (runningRef.current) return;

    setPreset(name);
    if (!romBytesRef.current) {
      setStatus({ text: `Quirk preset: ${name}. Load a ROM.`, kind: 'ok' });
      return;
    }

    pause('Preset changed — ROM reset.');
    resetWith(name);
  }, [pause, resetWith]);

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
      const key = KEY_MAP[event.code];
      if (key === undefined) return;
      event.preventDefault();
      cpuRef.current.setKey(key, true);
    };

    const onKeyUp = (event) => {
      const key = KEY_MAP[event.code];
      if (key === undefined) return;
      event.preventDefault();
      cpuRef.current.setKey(key, false);
    };

    // Releasing focus would otherwise leave keys stuck down.
    const onBlur = () => {
      for (let key = 0; key < 16; key++) cpuRef.current.setKey(key, false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return {
    canvasRef,
    debugRef,
    running,
    rom,
    preset,
    listing,
    pc,
    status,
    start,
    pause,
    step,
    loadRom,
    changePreset,
  };
}

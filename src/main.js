/**
 * main.js — browser glue for the CHIP-8 core.
 *
 * This is the only file that touches the DOM. It loads a ROM, runs the CPU at
 * a fixed instruction rate, ticks the 60Hz timers, draws the display, maps the
 * keyboard and plays the sound timer.
 *
 * The core in cpu.js stays pure: everything here is presentation and timing.
 */

import { Chip8, DISPLAY_WIDTH, DISPLAY_HEIGHT, MAX_ROM_SIZE } from './cpu.js';
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

// ---------------------------------------------------------------- elements

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const pixels = ctx.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);

const romInput = document.getElementById('rom');
const presetSelect = document.getElementById('preset');
const runButton = document.getElementById('run');
const pauseButton = document.getElementById('pause');
const stepButton = document.getElementById('step');
const statusEl = document.getElementById('status');
const debugEl = document.getElementById('debug');

// ---------------------------------------------------------------- state

let cpu = new Chip8();
let romBytes = null;
let running = false;
let rafId = 0;
let lastTime = 0;
let instructionDebt = 0;
let timerDebt = 0;

let audioCtx = null;
let soundGain = null;

// ---------------------------------------------------------------- helpers

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ' ' + kind : ''}`;
}

function currentQuirks() {
  return presetSelect.value === 'vip' ? ORIGINAL_VIP : MODERN;
}

function updateDebug() {
  debugEl.textContent =
    `PC ${hex(cpu.pc, 3)}  I ${hex(cpu.I, 3)}  ` +
    `op ${hex(cpu.getOpcodeAt(cpu.pc), 4)}  ` +
    `DT ${cpu.delayTimer}  ST ${cpu.soundTimer}`;
}

function render() {
  const data = pixels.data;
  for (let i = 0; i < cpu.display.length; i++) {
    const color = cpu.display[i] ? PIXEL_ON : PIXEL_OFF;
    const o = i * 4;
    data[o] = color[0];
    data[o + 1] = color[1];
    data[o + 2] = color[2];
    data[o + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  cpu.drawFlag = false;
}

function updateButtons() {
  const hasRom = romBytes !== null;
  runButton.disabled = !hasRom || running;
  pauseButton.disabled = !running;
  stepButton.disabled = !hasRom || running;
  romInput.disabled = running;
  presetSelect.disabled = running;
}

// ---------------------------------------------------------------- audio

function ensureAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;

  audioCtx = new AudioCtor();
  const oscillator = audioCtx.createOscillator();
  soundGain = audioCtx.createGain();

  oscillator.type = 'square';
  oscillator.frequency.value = 440;
  soundGain.gain.value = 0;

  oscillator.connect(soundGain).connect(audioCtx.destination);
  oscillator.start();
}

function setSound(on) {
  if (!soundGain) return;
  soundGain.gain.setTargetAtTime(on ? 0.04 : 0, audioCtx.currentTime, 0.01);
}

// ---------------------------------------------------------------- machine

function resetMachine() {
  cpu = new Chip8(currentQuirks());
  if (romBytes) cpu.loadRom(romBytes);
  render();
  updateDebug();
}

function pause(statusText = 'Paused.') {
  running = false;
  cancelAnimationFrame(rafId);
  setSound(false);
  setStatus(statusText, 'ok');
  updateButtons();
  updateDebug();
}

function fail(err) {
  pause();
  setStatus(err.message, 'error');
}

function start() {
  if (!romBytes) {
    setStatus('Load a ROM first.', 'warn');
    return;
  }
  if (running) return;

  ensureAudio();
  running = true;
  lastTime = 0;
  instructionDebt = 0;
  timerDebt = 0;
  setStatus('Running.', 'ok');
  updateButtons();
  rafId = requestAnimationFrame(loop);
}

function loop(now) {
  if (!running) return;

  if (!lastTime) lastTime = now;
  // Clamp the delta so a backgrounded tab cannot flood the CPU on return.
  const delta = Math.min(now - lastTime, 250);
  lastTime = now;

  instructionDebt += (delta / 1000) * INSTRUCTIONS_PER_SECOND;
  const steps = Math.floor(instructionDebt);
  instructionDebt -= steps;

  try {
    for (let i = 0; i < steps; i++) cpu.step();
  } catch (err) {
    fail(err);
    return;
  }

  timerDebt += delta;
  while (timerDebt >= 1000 / TIMER_HZ) {
    timerDebt -= 1000 / TIMER_HZ;
    cpu.tick60();
  }

  if (cpu.drawFlag) render();
  setSound(cpu.soundTimer > 0);
  updateDebug();

  rafId = requestAnimationFrame(loop);
}

function stepOnce() {
  if (!romBytes || running) return;

  try {
    cpu.step();
    render();
    updateDebug();
    setStatus('Stepped one instruction.', 'ok');
  } catch (err) {
    fail(err);
  }
}

async function loadRomFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) throw new Error('That file is empty.');
    if (bytes.length > MAX_ROM_SIZE) {
      throw new Error(`ROM is ${bytes.length} bytes; the maximum is ${MAX_ROM_SIZE}.`);
    }

    romBytes = bytes;
    pause();
    resetMachine();
    updateButtons();
    setStatus(`Loaded ${file.name} (${bytes.length} bytes). Press Run.`, 'ok');
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------- events

romInput.addEventListener('change', () => {
  const file = romInput.files && romInput.files[0];
  if (file) loadRomFile(file);
});

presetSelect.addEventListener('change', () => {
  if (running) return;
  if (!romBytes) {
    setStatus(`Quirk preset: ${presetSelect.value}. Load a ROM.`, 'ok');
    return;
  }
  pause('Preset changed — ROM reset.');
  resetMachine();
  updateButtons();
});

runButton.addEventListener('click', start);
pauseButton.addEventListener('click', () => pause());
stepButton.addEventListener('click', stepOnce);

function isTypingTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (event) => {
  if (isTypingTarget(event.target)) return;
  const key = KEY_MAP[event.code];
  if (key === undefined) return;
  event.preventDefault();
  cpu.setKey(key, true);
});

window.addEventListener('keyup', (event) => {
  const key = KEY_MAP[event.code];
  if (key === undefined) return;
  event.preventDefault();
  cpu.setKey(key, false);
});

// Releasing focus would otherwise leave keys stuck down.
window.addEventListener('blur', () => {
  for (let key = 0; key < 16; key++) cpu.setKey(key, false);
});

// ---------------------------------------------------------------- boot

render();
updateDebug();
updateButtons();
setStatus('Load a ROM to begin.');

# chip8-reverse-lab

A CHIP-8 emulator for the browser with a reverse-engineering workbench: a disassembler, a debugger with breakpoints, an evidence trace of every executed instruction, and explanations whose claims are checked against that trace.

## How to run

Install dependencies once:

```
npm install
```

Start the Vite dev server:

```
npm run dev
```

Then open http://localhost:5173 in your browser.

For a production build, run `npm run build`; the static site is written to `dist/`.

The CPU test page is served at http://localhost:5173/test/ while the dev server is running.

## Stack

React + Vite + Tailwind CSS v4, with UI components from [shadcn/ui](https://github.com/shadcn-ui/ui). The CHIP-8 core in `src/cpu.js` is plain JavaScript and has no framework dependencies.

## Controls

- Load a `.ch8` ROM with the file picker.
- **Run** starts the emulator at ~700 instructions/second, **Pause** stops it, and **Step** executes a single instruction.
- The **Quirks** dropdown switches between `MODERN` and `ORIGINAL_VIP` behaviour; changing it resets the current ROM.

| CHIP-8 keypad | Your keyboard |
| --- | --- |
| `1 2 3 C` | `1 2 3 4` |
| `4 5 6 D` | `Q W E R` |
| `7 8 9 E` | `A S D F` |
| `A 0 B F` | `Z X C V` |

## Disassembly

After a ROM is loaded, the listing panel decodes its instructions from `0x200` and highlights the row at the current program counter as you run or step. Unknown or invalid opcodes are shown as `???` rather than being silently skipped.

## Debugger

The debugger panel shows `PC`, `I`, `SP`, the delay and sound timers, all sixteen `V0`–`VF` registers, the active call stack, and a 128-byte window of memory that follows the index register. Click any disassembly row to toggle a breakpoint (red dot); **Run** pauses when execution reaches it, and pressing **Run** again resumes past that breakpoint. Loading a new ROM clears all breakpoints.

## Trace

Every instruction executed while stepping or running is recorded as evidence: its address and opcode, plus exactly what changed — `PC`, registers, `I`, `SP`, the timers, written memory bytes, and whether the display was updated. The trace keeps the most recent 200 events, newest first; **Clear** empties it, and loading a ROM or changing quirks starts a fresh trace. The explanation panel builds on this log.

## Explanations

Select a trace entry (the newest is shown by default) to get a plain-language explanation of what the instruction did and why. Each sentence cites the exact instruction or recorded change behind it, and the explanation is rejected if any claim is not present in the trace. The current explainer is deterministic — generated from the decoded opcode and trace rather than a hosted model, so no API key is needed. The same `verifyExplanation()` gate is intended to check a future model's output.

## Session analysis

The session card aggregates every instruction executed since the last ROM load or trace clear, not just the 200 retained events: total instructions, distinct addresses, the hottest address, detected loops (including multi-address cycles), `CALL` and display counts, and the last retained instruction. Each finding cites the statistic behind it, and `verifySessionAnalysis()` rejects findings whose citations do not match the aggregated stats.

## Quirks

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

Run the test suite headlessly with:

```
npm test
```

The same tests are served at http://localhost:5173/test/ while the dev server is running. CI runs `npm test` and `npm run build` on every push and pull request.

## Stack

React + Vite + Tailwind CSS v4, with UI components from [shadcn/ui](https://github.com/shadcn-ui/ui). The CHIP-8 core in `src/cpu.js` is plain JavaScript and has no framework dependencies.

## Controls

- Load a `.ch8` ROM with the file picker, or drag and drop it onto the **ROM** card.
- **Run** starts the emulator, **Pause** stops it, and **Step** executes a single instruction.
- The **Speed** dropdown sets the run rate (200, 700, 1,500 or 3,000 instructions/second) and can be changed while running.
- The **Quirks** dropdown switches between `MODERN` and `ORIGINAL_VIP` behaviour; changing it resets the current ROM.
- Press CHIP-8 keys on the on-screen keypad or with your keyboard. Held keys are highlighted, and pointer or focus loss releases them.

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

## Trace search and evidence export

The trace panel has a filter box: every whitespace-separated token must appear in an event's address, opcode, bytes, mnemonic, arguments, formatted changes or sequence number, so `jp 208`, `v0` and `pc 202` all narrow the log. **Export** downloads a JSON evidence report for the current session: ROM name and size, quirk preset, speed, cumulative stats, verified findings, and every retained event with its formatted change summary. The report contains no credentials.

## Save and load state

**Save state** downloads a JSON snapshot of the machine: registers, stack, timers, full 4 KB memory, the display buffer, held keys and the loaded ROM bytes. **Load state** validates the file strictly, pauses the emulator, restores the exact CPU state (including a pending `FX0A` key wait), and rebuilds the disassembly from the restored ROM. The snapshot format is versioned; malformed or impossible values are rejected with a status-line error instead of being applied. Snapshots contain no credentials.

## Explanations

Select a trace entry (the newest is shown by default) to get a plain-language explanation of what the instruction did and why. Each sentence cites the exact instruction or recorded change behind it, and the explanation is rejected if any claim is not present in the trace. The current explainer is deterministic — generated from the decoded opcode and trace rather than a hosted model, so no API key is needed. The same `verifyExplanation()` gate is intended to check a future model's output.

## Session analysis

The session card aggregates every instruction executed since the last ROM load or trace clear, not just the 200 retained events: total instructions, distinct addresses, the hottest address, detected loops (including multi-address cycles), `CALL` and display counts, and the last retained instruction. Each finding cites the statistic behind it, and `verifySessionAnalysis()` rejects findings whose citations do not match the aggregated stats.

## Model explanations (optional)

Open **Explain with a model** under an explanation, then enter an OpenAI-compatible endpoint (default `https://api.openai.com/v1`), model name, and API key. The app asks for JSON statements that cite trace evidence, then runs the same `verifyExplanation()` check used for the deterministic explanations: supported statements are shown normally, unsupported claims are marked **not in trace** and rejected. The key is held in component memory only — never written to storage or the repository — and requests go directly from your browser to the endpoint. No model is required for the deterministic explanation, session analysis, or verification.

## Quirks

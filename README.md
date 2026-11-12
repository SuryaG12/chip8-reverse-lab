# chip8-reverse-lab

A CHIP-8 emulator for the browser with a reverse-engineering workbench: a disassembler, a debugger with breakpoints and step-back history, a paged memory viewer, an evidence trace of every executed instruction, and explanations whose claims are checked against that trace. A small ROM library can keep saved programs in the browser.

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

To get one file you can double-click, run:

```
npm run build:standalone
```

It writes `dist/chip8-reverse-lab.html` with the CSS, JavaScript and fonts inlined. It needs no server, no network and no `node_modules`.

Run the test suite headlessly with:

```
npm test
```

The same tests are served at http://localhost:5173/test/ while the dev server is running. CI runs `npm run lint`, `npm test` and `npm run build` on every push and pull request.

To run the tests from one file without a server, run:

```
npm run test:page
```

It writes `dist/chip8-tests.html`, which you can open by double-clicking. It uses the same tests and prints the same pass or fail lines.

## Testing with real ROMs

ROMs are not committed. Download a few `.ch8` files into `roms/` and inspect what the core does with one:

```
npm run rom:inspect -- roms/2-ibm-logo.ch8 --ascii
```

It prints the final `PC`, registers, timers, stack, lit-pixel count and frame hash. With `--ascii` it also draws the 64x32 frame as text, which is a quick way to check a sprite or a test screen. Use `--steps`, `--preset modern|vip` and `--hold 5` to change the run.

To smoke-test every ROM in the folder:

```
npm run rom:check
```

Pass `-- --steps 20000` for a longer run, or `-- --preset vip` to repeat every ROM under the original VIP quirks. Both commands run the same core as the browser and exit non-zero if an opcode faults. The checked-in tests also cover the runner itself.

## Stack

React + Vite + Tailwind CSS v4, with UI components from [shadcn/ui](https://github.com/shadcn-ui/ui). The CHIP-8 core in `src/cpu.js` is plain JavaScript and has no framework dependencies.

## Controls

- Load a `.ch8` ROM with the file picker, or drag and drop it onto the **ROM** card.
- **Run** starts the emulator, **Pause** stops it, **Step** executes a single instruction, **Back** restores the state from before the last instruction, and **Reset** restarts the loaded ROM from `0x200` while keeping breakpoints.
- **Space** runs or pauses, **F7** steps, **F8** steps back and **F9** resets. The shortcuts are ignored while a form field has focus, so CHIP-8 keys still work normally.
- The camera button on the display saves the current frame as an 8x PNG named after the ROM.
- The **Speed** dropdown sets the run rate (200, 700, 1,500 or 3,000 instructions/second) and can be changed while running.
- The **Quirks** dropdown switches between `MODERN` and `ORIGINAL_VIP` behaviour; changing it resets the current ROM.
- Press CHIP-8 keys on the on-screen keypad or with your keyboard. Held keys are highlighted, and pointer or focus loss releases them.
- **Save current ROM** in the ROM library keeps the loaded bytes in this browser; **Load** restores a saved ROM and its quirk preset.

On wider screens the display and keypad sit in a sticky left column, with the **ROM** and **Workbench** cards stacked on the right. The workbench keeps one tool open at a time: **Code**, **Debugger**, **Memory**, **Trace**, **Explain**, **Session**, **Flow** and **Library** tabs. Panels stay mounted while hidden, so selections and the model endpoint survive tab switches.

| CHIP-8 keypad | Your keyboard |
| --- | --- |
| `1 2 3 C` | `1 2 3 4` |
| `4 5 6 D` | `Q W E R` |
| `7 8 9 E` | `A S D F` |
| `A 0 B F` | `Z X C V` |

## Disassembly

After a ROM is loaded, the listing panel decodes its instructions from `0x200` and highlights the row at the current program counter as you run or step. Unknown or invalid opcodes are shown as `???` rather than being silently skipped.

## Debugger

The debugger panel shows `PC`, `I`, `SP`, the delay and sound timers, all sixteen registers from `V0` through `VF`, the active call stack, and a 128-byte window of memory that follows the index register. Click any disassembly row to toggle a breakpoint (red dot); **Run** pauses when execution reaches it, and pressing **Run** again resumes past that breakpoint. The **Debugger** tab lists every breakpoint as a removable chip and has a **Clear all** button. Loading a new ROM clears all breakpoints; **Reset** keeps them.

The **Memory** tab is a paged hex dump of the whole 4 KB address space. **PC** and **I** are highlighted, the base address can be typed in hex, and the arrows move one 256-byte page at a time. **Copy page** puts the visible rows, including the ASCII column, on the clipboard.

## Step back

Every instruction executed while stepping or running records a complete pre-step snapshot: registers, memory, display, timers, stack and held keys. **Back** restores that snapshot and rewinds the trace to the matching length, so the debugger, session analysis and control-flow view all agree with the restored state. The history keeps the last 500 instructions, and loading a ROM, changing quirks, loading a state snapshot or clearing the trace clears it.

## ROM library

**Save current ROM** stores the loaded bytes, name, size, content hash, quirk preset and save date in `localStorage`. Saved ROMs appear in the library with their hash and preset; **Load** restores the bytes and preset, and the trash button removes the library copy. The library is capped at 20 ROMs and 1 MB, validates every entry on read, and never leaves the browser. Loading a ROM from the library does not modify the file on disk.

## Trace

Every instruction executed while stepping or running is recorded as evidence: its address and opcode, plus exactly what changed: `PC`, registers, `I`, `SP`, the timers, written memory bytes, and whether the display was updated. The trace keeps the most recent 200 events, newest first; **Clear** empties it, and loading a ROM or changing quirks starts a fresh trace. The explanation panel builds on this log.

## Trace search and evidence export

The trace panel has a filter box: every whitespace-separated token must appear in an event's address, opcode, bytes, mnemonic, arguments, formatted changes or sequence number, so `jp 208`, `v0` and `pc 202` all narrow the log. **Export** downloads a JSON evidence report for the current session: ROM name and size, quirk preset, speed, cumulative stats, verified findings, and every retained event with its formatted change summary. The report contains no credentials.

## Save and load state

**Save state** downloads a JSON snapshot of the machine: registers, stack, timers, full 4 KB memory, the display buffer, held keys and the loaded ROM bytes. **Load state** validates the file strictly, pauses the emulator, restores the exact CPU state (including a pending `FX0A` key wait), and rebuilds the disassembly from the restored ROM. The snapshot format is versioned; malformed or impossible values are rejected with a status-line error instead of being applied. Snapshots contain no credentials.

## Explanations

Select a trace entry (the newest is shown by default) to get a plain-language explanation of what the instruction did and why. Each sentence cites the exact instruction or recorded change behind it, and the explanation is rejected if any claim is not present in the trace. The current explainer is deterministic: generated from the decoded opcode and trace rather than a hosted model, so no API key is needed. The same `verifyExplanation()` gate is intended to check a future model's output.

## Session analysis

The session card aggregates every instruction executed since the last ROM load or trace clear, not just the 200 retained events: total instructions, distinct addresses, the hottest address, detected loops (including multi-address cycles), `CALL` and display counts, and the last retained instruction. Each finding cites the statistic behind it, and `verifySessionAnalysis()` rejects findings whose citations do not match the aggregated stats.

## Control flow

The control-flow card maps the addresses executed in the current session into a grid: node brightness and edge thickness grow with execution count, and arrows show jumps, calls, returns and fall-through. Hover a node or edge for exact counts; click a node to toggle a breakpoint at that address. The view shows the 40 most active addresses, always keeping the entry point, and notes when it is truncated.

## Model explanations (optional)

Open **Explain with a model** under an explanation, then enter an OpenAI-compatible endpoint (default `https://api.openai.com/v1`), model name, and API key. The app asks for JSON statements that cite trace evidence, then runs the same `verifyExplanation()` check used for the deterministic explanations: supported statements are shown normally, unsupported claims are marked **not in trace** and rejected. The key is held in component memory only, never written to storage or the repository, and requests go directly from your browser to the endpoint. No model is required for the deterministic explanation, session analysis, or verification.

## Quirks

The **Quirks** dropdown selects a preset for behaviours that differ between interpreters:

| Flag | `MODERN` | `ORIGINAL_VIP` |
| --- | --- | --- |
| `8XY6` / `8XYE` shifts | shifts `VX` in place | copies `VY` into `VX` first |
| `FX55` / `FX65` | leaves `I` unchanged | adds `X + 1` to `I` |
| `8XY1` / `8XY2` / `8XY3` | leaves `VF` alone | resets `VF` to 0 |
| `DXYN` timing | draws immediately | waits for the next vertical blank |

Both presets clip sprites at the screen edge and treat `BNNN` as a jump to `NNN + V0`.

The flags live in `src/quirks.js`; `src/cpu.js` reads them for every affected opcode. Changing the preset resets the current ROM so the run starts under the new rules.

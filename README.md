# chip8-reverse-lab

A CHIP-8 emulator that runs in the browser, with a planned "reverse mode" that will bundle a disassembler, an interactive debugger, and AI-generated explanations of ROM behaviour where every claim is checked against evidence gathered from the emulator rather than guessed.

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

## Quirks

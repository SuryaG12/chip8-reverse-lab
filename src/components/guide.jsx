/**
 * guide.jsx — short task recipes shown in the Guide tab.
 *
 * The guide is written for someone who has the app open: every step names a
 * button, tab or key they can see, so it doubles as the in-app manual.
 */

import {
  Activity,
  Bug,
  Database,
  FileDiff,
  History,
  Keyboard,
  Library,
  ListTree,
  Play,
  ShieldCheck,
  Sparkles,
  Undo2,
} from 'lucide-react';

import { Kbd } from '@/components/ui/kbd';

const RECIPES = [
  {
    icon: Play,
    title: 'Load and run',
    steps: [
      'Pick a `.ch8`, `.c8` or `.rom` file in the **ROM** card, or drop the file on the card.',
      'Press **Run**, or press Space. **Reset** restarts from `0x200` and **Speed** sets instructions per second.',
      'Play with the on-screen keypad or the matching physical keys `1-4 / Q-R / A-F / Z-V`.',
      'The camera button over the display saves the current frame as a PNG.',
    ],
  },
  {
    icon: ListTree,
    title: 'Find code and break',
    steps: [
      '**Code** lists every decoded instruction from `0x200` and marks the current PC.',
      'Click a row to add or remove a breakpoint. **Run** stops before that address executes.',
      '**Flow** nodes toggle the same breakpoints. **Clear all** in **Debugger** removes them.',
    ],
  },
  {
    icon: Bug,
    title: 'Watch a value',
    steps: [
      'In **Debugger**, find **Watchpoints** below the register view.',
      'Type `V0` to `VF`, `I`, or a memory address like `0x300`, then press **Watch**.',
      'Run or step. The emulator pauses after the instruction that changes the value and reports both sides.',
      'Each chip shows the live value. Click a chip to remove that watch.',
    ],
  },
  {
    icon: Undo2,
    title: 'Step and rewind',
    steps: [
      'Pause first, then press **Step** or F7 to run one instruction.',
      'Press **Back** or F8 to restore the state from before the last instruction.',
      'The line under the display shows `PC`, `I`, the next opcode and both timers.',
    ],
  },
  {
    icon: Database,
    title: 'Read registers and memory',
    steps: [
      '**Debugger** shows the register file, the active stack and memory near the index register.',
      '**Memory** is the full 4 KB dump with **PC** and **I** highlighted.',
      'Type a base address or use the arrows to change page, then **Copy page** to copy the visible rows.',
    ],
  },
  {
    icon: History,
    title: 'Trace and export',
    steps: [
      '**Trace** records each executed instruction and the state it changed, newest first.',
      'Filter by address, opcode, mnemonic or change, then click an entry to inspect it.',
      '**Export** downloads a Markdown evidence report. **Clear** empties the trace.',
    ],
  },
  {
    icon: Sparkles,
    title: 'Explain an instruction',
    steps: [
      'Select an entry in **Trace**, then open **Explain**.',
      'The explanation describes what the instruction did and why.',
      'The green **Evidence verified** badge means every claim matches the recorded trace.',
    ],
  },
  {
    icon: Activity,
    title: 'Session and flow',
    steps: [
      '**Session** summarizes the run: instruction count, unique addresses, loops and hot spots.',
      '**Flow** draws executed addresses and the transitions between them.',
      'Click a node in **Flow** to toggle a breakpoint there.',
    ],
  },
  {
    icon: FileDiff,
    title: 'Save, restore and diff',
    steps: [
      '**Save state** downloads a JSON snapshot of the CPU, memory and display. **Load state** restores it.',
      '**Diff** compares two snapshots: load one as A and one as B.',
      'Changed registers, timers, memory ranges, pixels, keys and stack are listed from A to B.',
    ],
  },
  {
    icon: Library,
    title: 'Keep ROMs in the library',
    steps: [
      '**Library** stores up to 20 ROMs of 1 MB each in this browser.',
      '**Save** stores the loaded ROM. **Load** restores it and the remove button deletes it.',
      'The library survives reloads, but it belongs to this browser and this origin.',
    ],
  },
];

const TOKENS = /(`[^`]+`|\*\*[^*]+\*\*)/g;

/** Render a step, turning `code` and **button** markers into styled text. */
function RichText({ text }) {
  return text.split(TOKENS).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-secondary/70 px-1 py-px font-mono text-[11px] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function Recipe({ icon: Icon, title, steps }) {
  return (
    <section className="rounded-md border border-border/60 bg-[#070a0d] p-2.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5 text-emerald-400" aria-hidden="true" />
        {title}
      </h3>
      <ol className="mt-1.5 space-y-1">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2 text-xs leading-relaxed text-foreground/80">
            <span className="mt-px shrink-0 font-mono text-[10px] text-emerald-400/80" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <RichText text={step} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Guide() {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {RECIPES.map((recipe) => (
          <Recipe key={recipe.title} {...recipe} />
        ))}
      </div>

      <div className="rounded-md border border-border/60 p-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Keyboard className="size-3.5 text-emerald-400" aria-hidden="true" />
          Shortcuts
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
          <Kbd>Space</Kbd>
          <span>run or pause</span>
          <Kbd>F7</Kbd>
          <span>step</span>
          <Kbd>F8</Kbd>
          <span>back</span>
          <Kbd>F9</Kbd>
          <span>reset</span>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Shortcuts pause while a form field has focus, so CHIP-8 keys still reach the game.
        </p>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3" aria-hidden="true" />
        ROMs, snapshots and the library stay in this browser. Nothing is uploaded.
      </p>
    </div>
  );
}

import { memo, useEffect, useRef } from 'react';
import { Bug, Cpu, History, Keyboard, ListTree, Pause, Play, StepForward, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { describeChanges } from '@/trace';
import { useEmulator } from '@/useEmulator';

const CHIP8_ROWS = [
  ['1', '2', '3', 'C'],
  ['4', '5', '6', 'D'],
  ['7', '8', '9', 'E'],
  ['A', '0', 'B', 'F'],
];

const HOST_ROWS = [
  ['1', '2', '3', '4'],
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
];

function statusTone(kind) {
  if (kind === 'error') return 'text-destructive';
  if (kind === 'warn') return 'text-amber-400';
  if (kind === 'ok') return 'text-emerald-400';
  return 'text-muted-foreground';
}

function KeyPad({ title, rows }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {rows.flatMap((row, rowIndex) => row.map((key, colIndex) => (
          <Kbd
            key={`${rowIndex}-${colIndex}`}
            className="h-8 justify-center border border-border/60 bg-secondary/60 text-sm text-foreground"
          >
            {key}
          </Kbd>
        )))}
      </div>
    </div>
  );
}

const hexAddress = (value) => value.toString(16).toUpperCase().padStart(3, '0');
const hexByte = (value) => value.toString(16).toUpperCase().padStart(2, '0');

const InstructionRow = memo(function InstructionRow({
  instruction,
  active,
  hasBreakpoint,
  activeRef,
  onToggleBreakpoint,
}) {
  return (
    <button
      type="button"
      ref={active ? activeRef : null}
      onClick={() => onToggleBreakpoint(instruction.address)}
      aria-pressed={hasBreakpoint}
      title={hasBreakpoint ? 'Remove breakpoint' : 'Set breakpoint'}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-[3px] text-left',
        active ? 'bg-emerald-400/10 text-emerald-300' : 'text-muted-foreground hover:bg-white/5',
      )}
    >
      <span className="flex w-3 shrink-0 justify-center">
        {hasBreakpoint ? (
          <span className="size-2 rounded-full bg-red-500" aria-hidden="true" />
        ) : null}
      </span>
      <span className={cn('w-10 shrink-0 text-right tabular-nums', active ? 'opacity-80' : 'opacity-60')}>
        {hexAddress(instruction.address)}
      </span>
      <span className={cn('w-9 shrink-0', active ? 'opacity-70' : 'opacity-50')}>
        {instruction.bytes}
      </span>
      <span className={cn('whitespace-pre', active ? 'text-emerald-300' : 'text-foreground/80')}>
        {instruction.text}
      </span>
    </button>
  );
});

function Disassembly({ listing, pc, breakpoints, onToggleBreakpoint }) {
  const activeRef = useRef(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    firstRenderRef.current = true;
  }, [listing]);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pc]);

  if (!listing.length) {
    return (
      <p className="text-sm text-muted-foreground">Load a ROM to see its decoded instructions.</p>
    );
  }

  return (
    <div
      className="max-h-72 overflow-auto rounded-md border border-border/60 bg-[#070a0d] py-1 font-mono text-xs"
      aria-label="Disassembly listing"
    >
      {listing.map((instruction) => (
        <InstructionRow
          key={instruction.address}
          instruction={instruction}
          active={instruction.address === pc}
          hasBreakpoint={breakpoints.has(instruction.address)}
          activeRef={activeRef}
          onToggleBreakpoint={onToggleBreakpoint}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, tone = 'text-foreground' }) {
  return (
    <div className="rounded-md border border-border/60 bg-[#070a0d] px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('font-mono text-sm tabular-nums', tone)}>{value}</p>
    </div>
  );
}

function Debugger({ debug }) {
  const memoryRows = [];
  for (let offset = 0; offset < debug.memory.length; offset += 16) {
    memoryRows.push({
      address: debug.memoryBase + offset,
      bytes: debug.memory.slice(offset, offset + 16),
    });
  }
  const memoryEnd = debug.memoryBase + Math.max(0, debug.memory.length - 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        <Stat label="PC" value={`0x${hexAddress(debug.pc)}`} tone="text-emerald-400" />
        <Stat label="I" value={`0x${hexAddress(debug.I)}`} />
        <Stat label="SP" value={String(debug.sp)} />
        <Stat label="DT" value={String(debug.delayTimer)} />
        <Stat label="ST" value={String(debug.soundTimer)} />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Registers</p>
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
          {debug.V.map((value, index) => (
            <div
              key={index}
              className="flex items-baseline justify-between rounded border border-border/50 bg-[#070a0d] px-1.5 py-1 font-mono text-[11px]"
            >
              <span className="text-muted-foreground">{`V${index.toString(16).toUpperCase()}`}</span>
              <span className="tabular-nums text-foreground">{hexByte(value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Stack{debug.stack.length ? ` · ${debug.stack.length} deep` : ''}
        </p>
        {debug.stack.length ? (
          <div className="flex flex-wrap gap-1.5">
            {debug.stack.map((address, index) => (
              <Badge key={index} variant="outline" className="font-mono tabular-nums">
                {`0x${hexAddress(address)}`}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Stack empty.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {`Memory · 0x${hexAddress(debug.memoryBase)}–0x${hexAddress(memoryEnd)}`}
        </p>
        <div className="overflow-x-auto rounded-md border border-border/60 bg-[#070a0d] p-2 font-mono text-[11px] leading-5">
          {memoryRows.map((row) => (
            <div key={row.address} className="flex gap-3 whitespace-pre">
              <span className="text-muted-foreground/70">{hexAddress(row.address)}</span>
              <span className="text-foreground/80">{row.bytes.map(hexByte).join(' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TraceList = memo(function TraceList({ trace }) {
  if (!trace.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Step or run a ROM to record each instruction and the state it changed.
      </p>
    );
  }

  const entries = trace.slice().reverse();

  return (
    <div
      className="max-h-72 overflow-auto rounded-md border border-border/60 bg-[#070a0d] py-1 font-mono text-xs"
      aria-label="Execution trace"
    >
      {entries.map((event) => {
        const hasEvidence = event.changes.length > 0 || event.display;
        return (
          <div key={event.seq} className="border-b border-border/30 px-3 py-1.5 last:border-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground/50">
                {event.seq}
              </span>
              <span className="text-muted-foreground">{hexAddress(event.address)}</span>
              <span className="text-muted-foreground/50">{event.bytes}</span>
              <span className="text-foreground/80">{event.text}</span>
            </div>
            <p
              className={cn(
                'mt-0.5 pl-[4.25rem] text-[11px]',
                hasEvidence ? 'text-emerald-300/80' : 'text-muted-foreground/50',
              )}
            >
              {describeChanges(event)}
            </p>
          </div>
        );
      })}
    </div>
  );
});

export default function App() {
  const {
    canvasRef,
    debugRef,
    running,
    rom,
    preset,
    listing,
    debug,
    trace,
    breakpoints,
    status,
    start,
    pause,
    step,
    loadRom,
    changePreset,
    toggleBreakpoint,
    clearTrace,
  } = useEmulator();

  const fileRef = useRef(null);

  const onFile = (event) => {
    const file = event.target.files?.[0];
    if (file) loadRom(file);
    event.target.value = '';
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(125,255,178,0.10),transparent_55%)]" />

      <main className="relative mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-5 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">chip8-reverse-lab</h1>
            <p className="text-sm text-muted-foreground">CHIP-8 emulator — Phase 5 · evidence trace</p>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <Cpu className="size-3" />
            React + shadcn/ui
          </Badge>
        </div>

        <Card size="sm">
          <CardContent>
            <div className="rounded-lg border border-border/80 bg-[#05070a] p-2 shadow-[0_0_60px_-25px_rgba(125,255,178,0.45)]">
              <canvas
                ref={canvasRef}
                id="screen"
                width={64}
                height={32}
                role="img"
                aria-label="CHIP-8 display"
                className="block aspect-[2/1] w-full rounded bg-[#05070a] [image-rendering:pixelated]"
              />
            </div>
            <p
              ref={debugRef}
              className="mt-3 overflow-x-auto font-mono text-[11px] tracking-wide whitespace-pre text-muted-foreground"
            >
              PC 200  I 000  op 0000  DT 0  ST 0
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>ROM</CardTitle>
            <CardDescription>
              {rom ? `${rom.name} · ${rom.size} bytes` : 'Load a .ch8 file to begin.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rom">Program</Label>
              <Input
                id="rom"
                ref={fileRef}
                type="file"
                accept=".ch8,.c8,.rom"
                onChange={onFile}
                disabled={running}
                className="file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-xs file:text-secondary-foreground"
              />
            </div>

            <Separator />

            <div className="flex flex-wrap items-end gap-2">
              <Button onClick={start} disabled={!rom || running}>
                <Play className="size-4" />
                Run
              </Button>
              <Button variant="secondary" onClick={() => pause()} disabled={!running}>
                <Pause className="size-4" />
                Pause
              </Button>
              <Button variant="outline" onClick={step} disabled={!rom || running}>
                <StepForward className="size-4" />
                Step
              </Button>

              <div className="ml-auto flex items-center gap-2">
                <Label htmlFor="preset" className="text-xs text-muted-foreground">
                  Quirks
                </Label>
                <Select value={preset} onValueChange={changePreset} disabled={running}>
                  <SelectTrigger id="preset" className="w-[9.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="vip">Original VIP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p aria-live="polite" className={cn('min-h-5 text-sm', statusTone(status.kind))}>
              {status.text}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bug className="size-4" />
              Debugger
            </CardTitle>
            <CardDescription>
              {breakpoints.size
                ? `${breakpoints.size} breakpoint${breakpoints.size === 1 ? '' : 's'} set · click a listing row to toggle`
                : 'Registers, stack and memory at the current PC.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Debugger debug={debug} />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListTree className="size-4" />
              Disassembly
            </CardTitle>
            <CardDescription>
              {listing.length
                ? `${listing.length} instructions · PC 0x${hexAddress(debug.pc)} · click a row to toggle a breakpoint`
                : 'Decoded from 0x200 after a ROM is loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Disassembly
              listing={listing}
              pc={debug.pc}
              breakpoints={breakpoints}
              onToggleBreakpoint={toggleBreakpoint}
            />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4" />
              Trace
            </CardTitle>
            <CardDescription>
              {trace.length
                ? `${trace.length} executed instruction${trace.length === 1 ? '' : 's'} · newest first`
                : 'Executed instructions and the state they changed.'}
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={clearTrace} disabled={!trace.length}>
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <TraceList trace={trace} />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Keyboard className="size-4" />
              Keyboard
            </CardTitle>
            <CardDescription>CHIP-8 keypad first, your keyboard second.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 sm:grid-cols-2">
              <KeyPad title="CHIP-8 keypad" rows={CHIP8_ROWS} />
              <KeyPad title="Your keyboard" rows={HOST_ROWS} />
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Test ROMs are not committed — see <code className="text-foreground">roms/README.md</code>.
        </p>
      </main>
    </div>
  );
}

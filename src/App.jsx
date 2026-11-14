import { memo, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Bug,
  Camera,
  Database,
  Download,
  FileDiff,
  GitBranch,
  History,
  Library,
  ListTree,
  Pause,
  Play,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  StepForward,
  Trash2,
  Undo2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ControlFlow } from '@/components/control-flow';
import { Guide } from '@/components/guide';
import { MemoryViewer } from '@/components/memory-viewer';
import { ModelPanel } from '@/components/model-panel';
import { RomLibrary } from '@/components/rom-library';
import { StateDiff } from '@/components/state-diff';
import {
  Card,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { analyzeSession, verifySessionAnalysis } from '@/analyze';
import { buildEvidenceReport, evidenceFilename } from '@/evidence';
import { explainEvent, verifyExplanation } from '@/explain';
import { buildControlFlowGraph } from '@/graph';
import { filterTrace } from '@/search';
import { snapshotFilename } from '@/snapshot';
import { describeChanges } from '@/trace';
import { useEmulator } from '@/useEmulator';
import { describeWatch, formatWatchValue, readWatchValue } from '@/watch';

const CHIP8_ROWS = [
  ['1', '2', '3', 'C'],
  ['4', '5', '6', 'D'],
  ['7', '8', '9', 'E'],
  ['A', '0', 'B', 'F'],
];

function statusTone(kind) {
  if (kind === 'error') return 'text-destructive';
  if (kind === 'warn') return 'text-amber-400';
  if (kind === 'ok') return 'text-emerald-400';
  return 'text-muted-foreground';
}

function KeyPad({ title, rows, interactive = false, heldKeys, onKey }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {rows.flatMap((row, rowIndex) => row.map((key, colIndex) => {
          if (!interactive) {
            return (
              <Kbd
                key={`${rowIndex}-${colIndex}`}
                className="h-8 justify-center border border-border/60 bg-secondary/60 text-sm text-foreground"
              >
                {key}
              </Kbd>
            );
          }

          const value = parseInt(key, 16);
          const held = heldKeys.has(value);
          return (
            <button
              key={`${rowIndex}-${colIndex}`}
              type="button"
              aria-label={`CHIP-8 key ${key}`}
              aria-pressed={held}
              onPointerDown={(event) => {
                event.preventDefault();
                try {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                } catch {
                  // Synthetic or non-capturable pointers still work.
                }
                onKey(value, true);
              }}
              onPointerUp={() => onKey(value, false)}
              onPointerLeave={() => onKey(value, false)}
              onPointerCancel={() => onKey(value, false)}
              className={cn(
                'h-8 touch-none rounded-sm border text-sm font-medium select-none',
                held
                  ? 'border-emerald-400/50 bg-emerald-400/20 text-emerald-300'
                  : 'border-border/60 bg-secondary/60 text-foreground hover:bg-secondary',
              )}
            >
              {key}
            </button>
          );
        }))}
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
  for (let offset = 0; offset < debug.memoryWindow.length; offset += 16) {
    memoryRows.push({
      address: debug.memoryBase + offset,
      bytes: debug.memoryWindow.slice(offset, offset + 16),
    });
  }
  const memoryEnd = debug.memoryBase + Math.max(0, debug.memoryWindow.length - 1);

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
          {`Memory · 0x${hexAddress(debug.memoryBase)}-0x${hexAddress(memoryEnd)}`}
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

const TraceList = memo(function TraceList({ trace, selectedSeq, onSelect, query = '' }) {
  if (!trace.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {query
          ? `No trace entries match “${query}”.`
          : 'Step or run a ROM to record each instruction and the state it changed.'}
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
          <button
            key={event.seq}
            type="button"
            onClick={() => onSelect(event.seq)}
            aria-pressed={event.seq === selectedSeq}
            title="Explain this instruction"
            className={cn(
              'block w-full border-b border-border/30 px-3 py-1.5 text-left last:border-0 hover:bg-white/5',
              event.seq === selectedSeq && 'bg-emerald-400/10',
            )}
          >
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
          </button>
        );
      })}
    </div>
  );
});

function Explanation({ event, explanation, verification }) {
  if (!event) {
    return (
      <p className="text-sm text-muted-foreground">
        Step or run a ROM, then select a trace entry to see what it did and why.
      </p>
    );
  }

  if (!verification.ok) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">Explanation rejected: it cites evidence this trace does not contain.</p>
        <ul className="list-disc pl-5 text-muted-foreground">
          {verification.unsupported.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-muted-foreground">
        {`#${event.seq} · 0x${hexAddress(event.address)} · ${event.bytes} · ${event.text}`}
      </p>
      <ul className="space-y-1.5">
        {explanation.statements.map((statement) => (
          <li key={statement.text} className="flex gap-2 text-sm">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
            <span>{statement.text}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {`${explanation.statements.length} statement${explanation.statements.length === 1 ? '' : 's'} checked against trace #${event.seq}.`}
      </p>
    </div>
  );
}

export default function App() {
  const {
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
  } = useEmulator();

  const fileRef = useRef(null);
  const snapshotRef = useRef(null);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [traceQuery, setTraceQuery] = useState('');
  const [watchInput, setWatchInput] = useState('');
  const [watchError, setWatchError] = useState('');
  const [activeTab, setActiveTab] = useState('disassembly');

  const selectedEvent = trace.find((entry) => entry.seq === selectedSeq)
    ?? trace[trace.length - 1]
    ?? null;
  const visibleTrace = filterTrace(trace, traceQuery);
  const explanation = selectedEvent ? explainEvent(selectedEvent) : null;
  const verification = selectedEvent ? verifyExplanation(explanation, selectedEvent) : null;
  const session = analyzeSession(traceStats);
  const sessionCheck = verifySessionAnalysis(session, traceStats);
  const controlFlow = buildControlFlowGraph(traceStats);

  // forceMount keeps each panel mounted so local UI state survives tab changes;
  // this class hides the inactive ones.
  const panelClass = (value) => cn('pt-3', activeTab !== value && 'hidden');

  // A new ROM starts a fresh trace, so drop any selection from the old one.
  useEffect(() => {
    setSelectedSeq(null);
    setTraceQuery('');
  }, [rom]);

  // A reset or a cleared trace also invalidates the selected sequence number.
  useEffect(() => {
    if (!trace.length) setSelectedSeq(null);
  }, [trace.length]);

  const clearAllTrace = () => {
    setSelectedSeq(null);
    clearTrace();
  };

  const exportEvidence = () => {
    const generatedAt = new Date();
    const report = buildEvidenceReport({
      rom,
      preset,
      speed,
      stats: traceStats,
      analysis: session,
      trace,
      generatedAt,
    });
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = evidenceFilename(rom, generatedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    if (file) loadRom(file);
    event.target.value = '';
  };

  const downloadSnapshot = () => {
    if (!rom) return;
    const createdAt = new Date();
    const snapshot = saveSnapshot(createdAt);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = snapshotFilename(rom, createdAt);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onSnapshotFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await loadSnapshotFile(file);
  };

  const submitWatch = (event) => {
    event.preventDefault();
    const result = addWatchpoint(watchInput);
    if (result.ok) {
      setWatchInput('');
      setWatchError('');
    } else {
      setWatchError(result.error);
    }
  };

  const openGuide = () => {
    setActiveTab('guide');
    requestAnimationFrame(() => {
      document.getElementById('workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const watchState = { V: debug.V, I: debug.I, memory: debug.allMemory };

  return (
    <div className="relative min-h-svh bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(125,255,178,0.10),transparent_55%)]" />

      <main className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col justify-center gap-4 px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="display-title pb-0.5 text-[clamp(1rem,5.2vw,1.875rem)] leading-tight tracking-tight">chip8-reverse-lab</h1>
            <p className="text-sm text-muted-foreground">CHIP-8 emulator and reverse-engineering workbench</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openGuide}
            title="Open the workbench guide"
            className="ml-auto border-emerald-400/30 text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-400/10 hover:text-emerald-200 dark:border-emerald-400/30 dark:hover:border-emerald-400/60"
          >
            <BookOpen className="size-3.5" />
            Guide
          </Button>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Card size="sm" className="sm:sticky sm:top-4 sm:row-span-2 sm:self-start">
            <CardContent className="flex flex-col gap-3">
              <div>
                <div className="relative rounded-lg border border-border/80 bg-[#05070a] p-2 shadow-[0_0_60px_-25px_rgba(125,255,178,0.45)]">
                  <canvas
                    ref={canvasRef}
                    id="screen"
                    width={64}
                    height={32}
                    role="img"
                    aria-label="CHIP-8 display"
                    className="block aspect-[2/1] w-full rounded bg-[#05070a] [image-rendering:pixelated]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={saveScreenshot}
                    disabled={!rom}
                    title="Save the current frame as a PNG"
                    aria-label="Save display as PNG"
                    className="absolute top-3 right-3 bg-black/50 text-muted-foreground hover:bg-black/80 hover:text-foreground"
                  >
                    <Camera className="size-3.5" />
                  </Button>
                </div>
                <p
                  ref={debugRef}
                  className="mt-3 overflow-x-auto font-mono text-[11px] tracking-wide whitespace-pre text-muted-foreground"
                >
                  PC 200  I 000  op 0000  DT 0  ST 0
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <KeyPad
                  title="Keypad"
                  rows={CHIP8_ROWS}
                  interactive
                  heldKeys={heldKeys}
                  onKey={pressKey}
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Physical keys map <span className="text-foreground/80">1-4 / Q-R / A-F / Z-V</span> to the same grid.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card
            size="sm"
            onDragOver={(event) => {
              event.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) loadRom(file);
            }}
            className={cn('sm:col-start-2 sm:row-start-1', dragging && 'ring-2 ring-emerald-400/60')}
          >
            <CardHeader>
              <CardTitle>ROM</CardTitle>
              <CardDescription>
                {rom
                  ? `${rom.name} · ${rom.size} bytes · drop another file to replace it`
                  : 'Drop a .ch8 file here or use the picker.'}
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
                <Button
                  variant="outline"
                  onClick={stepBack}
                  disabled={!rom || running || historyDepth === 0}
                  title={`Step back (${historyDepth} state${historyDepth === 1 ? '' : 's'} available)`}
                >
                  <Undo2 className="size-4" />
                  Back
                </Button>
                <Button
                  variant="outline"
                  onClick={reset}
                  disabled={!rom}
                  title="Restart the ROM from 0x200 (F9)"
                >
                  <RotateCcw className="size-4" />
                  Reset
                </Button>

                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="speed" className="text-xs text-muted-foreground">
                      Speed
                    </Label>
                    <Select value={String(speed)} onValueChange={changeSpeed}>
                      <SelectTrigger id="speed" className="w-[7.5rem]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="200">200 IPS</SelectItem>
                        <SelectItem value="700">700 IPS</SelectItem>
                        <SelectItem value="1500">1,500 IPS</SelectItem>
                        <SelectItem value="3000">3,000 IPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
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
              </div>

              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                <span className="mr-0.5">Shortcuts</span>
                <Kbd>Space</Kbd>
                <span>run or pause</span>
                <Kbd>F7</Kbd>
                <span>step</span>
                <Kbd>F8</Kbd>
                <span>back</span>
                <Kbd>F9</Kbd>
                <span>reset</span>
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={downloadSnapshot} disabled={!rom}>
                  <Save className="size-3.5" />
                  Save state
                </Button>
                <Button variant="outline" size="sm" onClick={() => snapshotRef.current?.click()}>
                  <Upload className="size-3.5" />
                  Load state
                </Button>
                <input
                  ref={snapshotRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={onSnapshotFile}
                  aria-label="Load emulator state"
                />
                <span className="text-xs text-muted-foreground">
                  JSON snapshot of CPU, memory and display.
                </span>
              </div>

              <p aria-live="polite" className={cn('min-h-5 text-sm', statusTone(status.kind))}>
                {status.text}
              </p>
            </CardContent>
          </Card>

          <Card id="workbench" size="sm" className="scroll-mt-4 sm:col-start-2 sm:row-start-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="size-4" />
                Workbench
              </CardTitle>
              <CardDescription>Debugger, code, memory, diff, trace and analysis tools.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
                  <TabsTrigger value="disassembly" className="h-8 text-xs">
                    <ListTree className="size-3.5" />
                    Code
                  </TabsTrigger>
                  <TabsTrigger value="debugger" className="h-8 text-xs">
                    <Bug className="size-3.5" />
                    Debugger
                  </TabsTrigger>
                  <TabsTrigger value="diff" className="h-8 text-xs">
                    <FileDiff className="size-3.5" />
                    Diff
                  </TabsTrigger>
                  <TabsTrigger value="memory" className="h-8 text-xs">
                    <Database className="size-3.5" />
                    Memory
                  </TabsTrigger>
                  <TabsTrigger value="trace" className="h-8 text-xs">
                    <History className="size-3.5" />
                    Trace
                  </TabsTrigger>
                  <TabsTrigger value="explanation" className="h-8 text-xs">
                    <Sparkles className="size-3.5" />
                    Explain
                  </TabsTrigger>
                  <TabsTrigger value="session" className="h-8 text-xs">
                    <Activity className="size-3.5" />
                    Session
                  </TabsTrigger>
                  <TabsTrigger value="flow" className="h-8 text-xs">
                    <GitBranch className="size-3.5" />
                    Flow
                  </TabsTrigger>
                  <TabsTrigger value="library" className="h-8 text-xs">
                    <Library className="size-3.5" />
                    Library
                  </TabsTrigger>
                  <TabsTrigger value="guide" className="h-8 text-xs">
                    <BookOpen className="size-3.5" />
                    Guide
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="library" forceMount className={panelClass('library')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {library.entries.length
                      ? `${library.entries.length} saved ROM${library.entries.length === 1 ? '' : 's'} · click Load to restore one`
                      : 'Save ROMs in this browser for quick reloading.'}
                  </p>
                  <RomLibrary
                    library={library}
                    currentRom={rom}
                    running={running}
                    onSave={saveToLibrary}
                    onLoad={loadLibraryEntry}
                    onRemove={removeLibraryEntry}
                  />
                </TabsContent>

                <TabsContent value="debugger" forceMount className={panelClass('debugger')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {breakpoints.size
                      ? `${breakpoints.size} breakpoint${breakpoints.size === 1 ? '' : 's'} set · click a listing row to toggle`
                      : 'Registers, stack and memory at the current PC.'}
                  </p>
                  <Debugger debug={debug} />

                  <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Breakpoints
                      </p>
                      {breakpoints.size ? (
                        <Button variant="ghost" size="sm" onClick={clearBreakpoints}>
                          <Trash2 className="size-3.5" />
                          Clear all
                        </Button>
                      ) : null}
                    </div>
                    {breakpoints.size ? (
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(breakpoints).sort((a, b) => a - b).map((address) => (
                          <button
                            key={address}
                            type="button"
                            onClick={() => toggleBreakpoint(address)}
                            title={`Remove breakpoint at 0x${hexAddress(address)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-destructive/50 hover:text-destructive"
                          >
                            0x{hexAddress(address)}
                            <X className="size-3" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Click a row in Code or Flow to add one.
                      </p>
                    )}
                  </div>

                  <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Watchpoints
                      </p>
                      {watchpoints.length ? (
                        <Button variant="ghost" size="sm" onClick={clearWatchpoints}>
                          <Trash2 className="size-3.5" />
                          Clear all
                        </Button>
                      ) : null}
                    </div>

                    <form onSubmit={submitWatch} className="flex flex-wrap items-start gap-2">
                      <Input
                        value={watchInput}
                        onChange={(event) => {
                          setWatchInput(event.target.value);
                          if (watchError) setWatchError('');
                        }}
                        placeholder="V0, I or 0x300"
                        aria-label="Watch expression"
                        spellCheck={false}
                        autoComplete="off"
                        className="h-8 w-40 font-mono text-xs"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        Watch
                      </Button>
                    </form>

                    {watchError ? (
                      <p role="alert" className="text-xs text-destructive">{watchError}</p>
                    ) : null}

                    {watchpoints.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {watchpoints.map((watch) => (
                          <button
                            key={watch.id}
                            type="button"
                            onClick={() => removeWatchpoint(watch.id)}
                            title={`Remove watch on ${describeWatch(watch)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-destructive/50 hover:text-destructive"
                          >
                            {describeWatch(watch)}
                            <span className="text-emerald-400">
                              {formatWatchValue(watch, readWatchValue(watchState, watch))}
                            </span>
                            <X className="size-3" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Pause after an instruction changes a register, I or a memory byte.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="diff" forceMount className={panelClass('diff')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Compare two saved states · registers, memory and display.
                  </p>
                  <StateDiff />
                </TabsContent>

                <TabsContent value="memory" forceMount className={panelClass('memory')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Full 4 KB hex dump · PC and I are highlighted · copy any 256-byte page.
                  </p>
                  <MemoryViewer
                    memory={debug.allMemory}
                    pc={debug.pc}
                    I={debug.I}
                    romName={rom?.name ?? null}
                  />
                </TabsContent>

                <TabsContent value="disassembly" forceMount className={panelClass('disassembly')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {listing.length
                      ? `${listing.length} instructions · PC 0x${hexAddress(debug.pc)} · click a row to toggle a breakpoint`
                      : 'Decoded from 0x200 after a ROM is loaded.'}
                  </p>
                  <Disassembly
                    listing={listing}
                    pc={debug.pc}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                  />
                </TabsContent>

                <TabsContent value="trace" forceMount className={panelClass('trace')}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-40 flex-1">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={traceQuery}
                        onChange={(event) => setTraceQuery(event.target.value)}
                        placeholder="Filter: address, opcode, mnemonic or change"
                        aria-label="Filter trace"
                        spellCheck={false}
                        autoComplete="off"
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <Button variant="ghost" size="sm" onClick={exportEvidence} disabled={!trace.length}>
                      <Download className="size-3.5" />
                      Export
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearAllTrace} disabled={!trace.length}>
                      <Trash2 className="size-3.5" />
                      Clear
                    </Button>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {trace.length
                      ? traceQuery
                        ? `${visibleTrace.length} of ${trace.length} executed instructions match`
                        : `${trace.length} executed instruction${trace.length === 1 ? '' : 's'} · newest first`
                      : 'Executed instructions and the state they changed.'}
                  </p>
                  <TraceList
                    trace={visibleTrace}
                    selectedSeq={selectedEvent?.seq ?? null}
                    onSelect={setSelectedSeq}
                    query={traceQuery.trim()}
                  />
                </TabsContent>

                <TabsContent value="explanation" forceMount className={panelClass('explanation')}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {selectedEvent
                        ? `Selected trace #${selectedEvent.seq}. Every statement must cite recorded evidence.`
                        : 'Select a trace entry to explain what it did and why.'}
                    </p>
                    {verification?.ok ? (
                      <Badge variant="outline" className="gap-1 text-emerald-400">
                        <ShieldCheck className="size-3" />
                        Evidence verified
                      </Badge>
                    ) : null}
                  </div>
                  <Explanation event={selectedEvent} explanation={explanation} verification={verification} />
                  <ModelPanel event={selectedEvent} />
                </TabsContent>

                <TabsContent value="session" forceMount className={panelClass('session')}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {session.empty
                        ? 'Run or step a ROM to build a session summary.'
                        : `${traceStats.total} instructions · ${traceStats.uniqueAddresses} addresses · ${traceStats.retained} retained events`}
                    </p>
                    {sessionCheck.ok && !session.empty ? (
                      <Badge variant="outline" className="gap-1 text-emerald-400">
                        <ShieldCheck className="size-3" />
                        Evidence verified
                      </Badge>
                    ) : null}
                  </div>
                  {session.empty ? (
                    <p className="text-sm text-muted-foreground">
                      Session findings appear here after the first executed instruction.
                    </p>
                  ) : sessionCheck.ok ? (
                    <ul className="space-y-1.5">
                      {session.findings.map((finding) => (
                        <li key={finding.text} className="flex gap-2 text-sm">
                          <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                          <span>{finding.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <p className="text-destructive">Session analysis rejected: it cites evidence the stats do not contain.</p>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {sessionCheck.unsupported.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="flow" forceMount className={panelClass('flow')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {controlFlow.nodes.length
                      ? `${controlFlow.nodes.length} addresses · ${controlFlow.edges.length} transitions · click a node to toggle a breakpoint`
                      : 'Run or step a ROM to map executed addresses and jumps.'}
                  </p>
                  <ControlFlow
                    graph={controlFlow}
                    breakpoints={breakpoints}
                    onToggleBreakpoint={toggleBreakpoint}
                  />
                </TabsContent>

                <TabsContent value="guide" forceMount className={panelClass('guide')}>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Task recipes for the workbench · load, break, watch, trace and export.
                  </p>
                  <Guide />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Test ROMs are not committed. See <code className="text-foreground">roms/README.md</code>.
        </p>
      </main>
    </div>
  );
}

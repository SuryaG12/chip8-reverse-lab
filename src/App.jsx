import { memo, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bug,
  Cpu,
  Download,
  History,
  Keyboard,
  ListTree,
  Pause,
  Play,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  StepForward,
  Trash2,
  Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModelPanel } from '@/components/model-panel';
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
import { analyzeSession, verifySessionAnalysis } from '@/analyze';
import { buildEvidenceReport, evidenceFilename } from '@/evidence';
import { explainEvent, verifyExplanation } from '@/explain';
import { filterTrace } from '@/search';
import { snapshotFilename } from '@/snapshot';
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
    status,
    start,
    pause,
    step,
    loadRom,
    changePreset,
    changeSpeed,
    pressKey,
    saveSnapshot,
    loadSnapshotFile,
    toggleBreakpoint,
    clearTrace,
  } = useEmulator();

  const fileRef = useRef(null);
  const snapshotRef = useRef(null);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [traceQuery, setTraceQuery] = useState('');

  const selectedEvent = trace.find((entry) => entry.seq === selectedSeq)
    ?? trace[trace.length - 1]
    ?? null;
  const visibleTrace = filterTrace(trace, traceQuery);
  const explanation = selectedEvent ? explainEvent(selectedEvent) : null;
  const verification = selectedEvent ? verifyExplanation(explanation, selectedEvent) : null;
  const session = analyzeSession(traceStats);
  const sessionCheck = verifySessionAnalysis(session, traceStats);

  // A new ROM starts a fresh trace, so drop any selection from the old one.
  useEffect(() => {
    setSelectedSeq(null);
    setTraceQuery('');
  }, [rom]);

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

  return (
    <div className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(125,255,178,0.10),transparent_55%)]" />

      <main className="relative mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-5 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">chip8-reverse-lab</h1>
            <p className="text-sm text-muted-foreground">CHIP-8 emulator — Phase 12 · save & load state</p>
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
          className={cn(dragging && 'ring-2 ring-emerald-400/60')}
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
                ? traceQuery
                  ? `${visibleTrace.length} of ${trace.length} executed instructions match`
                  : `${trace.length} executed instruction${trace.length === 1 ? '' : 's'} · newest first`
                : 'Executed instructions and the state they changed.'}
            </CardDescription>
            <CardAction className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={exportEvidence} disabled={!trace.length}>
                <Download className="size-3.5" />
                Export
              </Button>
              <Button variant="ghost" size="sm" onClick={clearAllTrace} disabled={!trace.length}>
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="relative mb-2">
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
            <TraceList
              trace={visibleTrace}
              selectedSeq={selectedEvent?.seq ?? null}
              onSelect={setSelectedSeq}
              query={traceQuery.trim()}
            />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Explanation
            </CardTitle>
            <CardDescription>
              {selectedEvent
                ? `Selected trace #${selectedEvent.seq}. Every statement must cite recorded evidence.`
                : 'Select a trace entry to explain what it did and why.'}
            </CardDescription>
            <CardAction>
              {verification?.ok ? (
                <Badge variant="outline" className="gap-1 text-emerald-400">
                  <ShieldCheck className="size-3" />
                  Evidence verified
                </Badge>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent>
            <Explanation event={selectedEvent} explanation={explanation} verification={verification} />
            <ModelPanel event={selectedEvent} />
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Session analysis
            </CardTitle>
            <CardDescription>
              {session.empty
                ? 'Run or step a ROM to build a session summary.'
                : `${traceStats.total} instructions · ${traceStats.uniqueAddresses} addresses · ${traceStats.retained} retained events`}
            </CardDescription>
            <CardAction>
              {sessionCheck.ok && !session.empty ? (
                <Badge variant="outline" className="gap-1 text-emerald-400">
                  <ShieldCheck className="size-3" />
                  Evidence verified
                </Badge>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Keyboard className="size-4" />
              Keyboard
            </CardTitle>
            <CardDescription>Click the CHIP-8 keypad or use your keyboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-5 sm:grid-cols-2">
              <KeyPad
                title="CHIP-8 keypad · clickable"
                rows={CHIP8_ROWS}
                interactive
                heldKeys={heldKeys}
                onKey={pressKey}
              />
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

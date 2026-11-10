import { memo, useEffect, useRef } from 'react';
import { Cpu, Keyboard, ListTree, Pause, Play, StepForward } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
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

const InstructionRow = memo(function InstructionRow({ instruction, active, activeRef }) {
  return (
    <div
      ref={active ? activeRef : null}
      className={cn(
        'flex gap-3 px-3 py-[3px]',
        active ? 'bg-emerald-400/10 text-emerald-300' : 'text-muted-foreground',
      )}
    >
      <span className="w-10 shrink-0 text-right tabular-nums opacity-60">
        {hexAddress(instruction.address)}
      </span>
      <span className="w-9 shrink-0 opacity-50">{instruction.bytes}</span>
      <span className={cn('whitespace-pre', active ? 'text-emerald-300' : 'text-foreground/80')}>
        {instruction.text}
      </span>
    </div>
  );
});

function Disassembly({ listing, pc }) {
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
          activeRef={activeRef}
        />
      ))}
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
    listing,
    pc,
    status,
    start,
    pause,
    step,
    loadRom,
    changePreset,
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
            <p className="text-sm text-muted-foreground">CHIP-8 emulator — Phase 3 · disassembly</p>
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
              <ListTree className="size-4" />
              Disassembly
            </CardTitle>
            <CardDescription>
              {listing.length
                ? `${listing.length} instructions · PC 0x${hexAddress(pc)}`
                : 'Decoded from 0x200 after a ROM is loaded.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Disassembly listing={listing} pc={pc} />
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

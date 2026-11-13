import { useRef, useState } from 'react';
import { ArrowRight, FileDiff, Trash2, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { diffSnapshots, validateSnapshot } from '@/snapshot';

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');
const hexAddress = (value) => hex(value, 3);
const hexByte = (value) => hex(value, 2);
const keyLabel = (index) => hex(index, 1);

const formatDate = (iso) => {
  if (!iso) return 'no timestamp';
  return String(iso).slice(0, 16).replace('T', ' ');
};

const count = (value, noun) => `${value} ${noun}${value === 1 ? '' : 's'}`;

/** Format one side of a scalar row: addresses are hex, timers are decimal. */
function scalarValue(row, value) {
  if (row.name === 'Wait') return value < 0 ? 'none' : `key ${keyLabel(value)}`;
  return row.hex ? `0x${hexAddress(value)}` : String(value);
}

function Slot({ label, file, meta, onFile, inputRef }) {
  return (
    <div className="rounded-md border border-border/60 bg-[#070a0d] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          State {label}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3" />
          {file ? 'Replace' : 'Choose file'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={onFile}
          aria-label={`State ${label} snapshot file`}
        />
      </div>
      {file ? (
        <>
          <p className="truncate font-mono text-xs text-foreground" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{meta}</p>
        </>
      ) : (
        <p className="mt-0.5 text-xs text-muted-foreground">No snapshot loaded.</p>
      )}
    </div>
  );
}

/**
 * Compare two saved snapshots side by side. Everything is local: the files are
 * read with the File API and never leave the page.
 */
export function StateDiff() {
  const [slots, setSlots] = useState({ a: null, b: null });
  const [error, setError] = useState('');
  const refA = useRef(null);
  const refB = useRef(null);

  const onFile = (slot) => async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());
      const check = validateSnapshot(data);
      if (!check.ok) throw new Error(check.errors[0]);
      setSlots((prev) => ({ ...prev, [slot]: { name: file.name, data } }));
      setError('');
    } catch (err) {
      setError(`State ${slot.toUpperCase()}: ${err.message}`);
    }
  };

  const clear = () => {
    setSlots({ a: null, b: null });
    setError('');
  };

  const diff = slots.a && slots.b
    ? diffSnapshots(slots.a.data, slots.b.data)
    : null;

  const changedScalars = diff?.scalars.filter((row) => row.changed) ?? [];
  const changedRegisters = diff?.registers.filter((row) => row.changed) ?? [];
  const rows = [
    ...changedScalars.map((row) => ({
      name: row.name,
      from: scalarValue(row, row.from),
      to: scalarValue(row, row.to),
    })),
    ...changedRegisters.map((row) => ({
      name: row.name,
      from: `0x${hexByte(row.from)}`,
      to: `0x${hexByte(row.to)}`,
    })),
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Slot
          label="A"
          file={slots.a}
          meta={slots.a ? `PC 0x${hexAddress(slots.a.data.cpu.pc)} · ${formatDate(slots.a.data.createdAt)}` : null}
          onFile={onFile('a')}
          inputRef={refA}
        />
        <Slot
          label="B"
          file={slots.b}
          meta={slots.b ? `PC 0x${hexAddress(slots.b.data.cpu.pc)} · ${formatDate(slots.b.data.createdAt)}` : null}
          onFile={onFile('b')}
          inputRef={refB}
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {!diff ? (
        <p className="text-xs text-muted-foreground">
          Load two JSON snapshots from Save state to see what changed between them.
        </p>
      ) : (
        <div className="space-y-3 rounded-md border border-border/60 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <FileDiff className={cn('size-3.5', diff.equal ? 'text-emerald-400' : 'text-foreground')} />
            <p className={cn('text-sm', diff.equal ? 'text-emerald-400' : 'text-foreground')}>
              {diff.equal ? 'The two states are identical.' : 'Differences from A to B'}
            </p>
          </div>

          {!diff.equal ? (
            <div className="flex flex-wrap gap-1.5">
              {diff.counts.registers ? (
                <Badge variant="outline">{count(diff.counts.registers, 'register')}</Badge>
              ) : null}
              {diff.counts.scalars ? (
                <Badge variant="outline">{count(diff.counts.scalars, 'field')}</Badge>
              ) : null}
              {diff.counts.memory ? (
                <Badge variant="outline">{count(diff.counts.memory, 'byte')}</Badge>
              ) : null}
              {diff.counts.pixels ? (
                <Badge variant="outline">{count(diff.counts.pixels, 'pixel')}</Badge>
              ) : null}
              {diff.keys.changed ? <Badge variant="outline">keypad</Badge> : null}
              {diff.stack.changed ? <Badge variant="outline">stack</Badge> : null}
              {!diff.rom.sameBytes ? (
                <Badge variant="outline" className="border-amber-400/40 text-amber-400">
                  different ROM
                </Badge>
              ) : null}
              {!diff.preset.same ? (
                <Badge variant="outline" className="border-amber-400/40 text-amber-400">
                  different quirks
                </Badge>
              ) : null}
            </div>
          ) : null}

          {rows.length ? (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Registers and timers
              </p>
              <ul className="grid gap-x-4 sm:grid-cols-2">
                {rows.map((row) => (
                  <li
                    key={row.name}
                    className="flex items-center justify-between gap-2 border-b border-border/40 py-1 font-mono text-[11px] last:border-b-0"
                  >
                    <span className="text-muted-foreground">{row.name}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-foreground/70">{row.from}</span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="text-emerald-400">{row.to}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {diff.memory.ranges.length ? (
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Memory
              </p>
              <ul className="space-y-1 font-mono text-[11px]">
                {diff.memory.ranges.slice(0, 8).map((range) => (
                  <li key={range.start} className="flex items-center justify-between gap-2">
                    <span className="text-foreground/80">
                      0x{hexAddress(range.start)}
                      {range.count > 1 ? `-0x${hexAddress(range.end)}` : ''}
                    </span>
                    <span className="text-muted-foreground">{count(range.count, 'byte')}</span>
                  </li>
                ))}
              </ul>
              {diff.memory.ranges.length > 8 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  and {diff.memory.ranges.length - 8} more range{diff.memory.ranges.length - 8 === 1 ? '' : 's'}
                </p>
              ) : null}
            </div>
          ) : null}

          {diff.keys.changed ? (
            <p className="font-mono text-[11px]">
              <span className="text-muted-foreground">Keys pressed </span>
              {diff.keys.added.length ? (
                <span className="text-emerald-400">{diff.keys.added.map(keyLabel).join(', ')}</span>
              ) : (
                <span className="text-foreground/60">none</span>
              )}
              <span className="text-muted-foreground"> · released </span>
              {diff.keys.removed.length ? (
                <span className="text-amber-400">{diff.keys.removed.map(keyLabel).join(', ')}</span>
              ) : (
                <span className="text-foreground/60">none</span>
              )}
            </p>
          ) : null}

          {diff.display.changed ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Display {diff.display.turnedOn} on, {diff.display.turnedOff} off
              {diff.display.bounds
                ? ` · x ${diff.display.bounds.minX}-${diff.display.bounds.maxX}, y ${diff.display.bounds.minY}-${diff.display.bounds.maxY}`
                : ''}
            </p>
          ) : null}

          {diff.stack.changed ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Stack {diff.stack.a.length ? diff.stack.a.map((value) => `0x${hexAddress(value)}`).join(' → ') : 'empty'}
              {'  →  '}
              {diff.stack.b.length ? diff.stack.b.map((value) => `0x${hexAddress(value)}`).join(' → ') : 'empty'}
            </p>
          ) : null}

          {!diff.rom.sameBytes ? (
            <p className="text-[11px] text-amber-400">
              Different ROM: {diff.rom.a ?? 'none'} vs {diff.rom.b ?? 'none'}
            </p>
          ) : null}

          {!diff.preset.same ? (
            <p className="text-[11px] text-amber-400">
              Quirks: {diff.preset.a ?? 'none'} vs {diff.preset.b ?? 'none'}
            </p>
          ) : null}
        </div>
      )}

      {slots.a || slots.b ? (
        <Button variant="ghost" size="sm" onClick={clear}>
          <Trash2 className="size-3.5" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  buildMemoryRows,
  clampBase,
  formatHexDump,
  PAGE_ROWS,
  pageCount,
  pageForAddress,
  pageStart,
  parseAddressInput,
  regionLabel,
} from '@/memory';

const hex = (value, width) => value.toString(16).toUpperCase().padStart(width, '0');
const hexAddress = (value) => hex(value, 3);
const hexByte = (value) => hex(value, 2);
const PAGE_SIZE = PAGE_ROWS * 16;

/**
 * A paged hex dump of the full 4 KB address space, with PC and I highlighted.
 * Navigation is by 256-byte page; typing a base address jumps to its page.
 */
export function MemoryViewer({ memory, pc, I, romName }) {
  const [base, setBase] = useState(0x200);
  const [input, setInput] = useState('200');
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);

  useEffect(() => {
    if (romName) setBase(0x200);
  }, [romName]);

  useEffect(() => {
    setInput(hexAddress(clampBase(base)));
    setInvalid(false);
  }, [base]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const rows = buildMemoryRows(memory ?? [], base);
  const page = pageForAddress(base);
  const pages = pageCount();
  const regions = new Set(rows.map((row) => row.region));
  const regionText = regions.size === 1 ? regionLabel(base) : 'Mixed regions';

  const goTo = (next) => setBase(pageStart(pageForAddress(next)));

  const applyInput = () => {
    const parsed = parseAddressInput(input);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    goTo(parsed);
  };

  const copyPage = async () => {
    try {
      await navigator.clipboard.writeText(formatHexDump(memory ?? [], { base, rows: PAGE_ROWS }));
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goTo(pageStart(page - 1))}
          disabled={page === 0}
          aria-label="Previous memory page"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goTo(pageStart(page + 1))}
          disabled={page >= pages - 1}
          aria-label="Next memory page"
        >
          <ChevronRight className="size-3.5" />
        </Button>

        <div className="flex items-center gap-1.5">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onBlur={applyInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyInput();
              }
            }}
            aria-label="Memory base address"
            aria-invalid={invalid}
            spellCheck={false}
            autoComplete="off"
            className={cn('h-7 w-16 font-mono text-xs', invalid && 'border-destructive')}
          />
          <span className="text-xs text-muted-foreground">base</span>
        </div>

        <Button variant="ghost" size="sm" onClick={() => goTo(pc)} title="Jump to PC">
          PC
        </Button>
        <Button variant="ghost" size="sm" onClick={() => goTo(I)} title="Jump to I">
          I
        </Button>

        <Button variant="ghost" size="sm" className="ml-auto" onClick={copyPage}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy page'}
        </Button>
      </div>

      <div
        className="overflow-x-auto rounded-md border border-border/60 bg-[#070a0d] p-2 font-mono text-[11px] leading-5"
        aria-label="Memory hex dump"
      >
        {rows.map((row) => {
          const rowHasPc = pc >= row.address && pc < row.address + 16;
          return (
            <div
              key={row.address}
              className={cn(
                'flex gap-3 whitespace-pre rounded px-1',
                rowHasPc && 'bg-emerald-400/[0.06]',
              )}
            >
              <span className="text-muted-foreground/70">{hexAddress(row.address)}</span>
              <span className="flex gap-[3px]">
                {row.bytes.map((byte, index) => {
                  const address = row.address + index;
                  const isPc = address === pc || address === pc + 1;
                  const isI = address === I;
                  return (
                    <span
                      key={address}
                      title={`0x${hexAddress(address)} = 0x${hexByte(byte)}`}
                      className={cn(
                        'rounded-[2px] px-[1px]',
                        isPc
                          ? 'bg-emerald-400/25 text-emerald-300'
                          : isI
                            ? 'bg-sky-400/20 text-sky-300'
                            : 'text-foreground/80',
                      )}
                    >
                      {hexByte(byte)}
                    </span>
                  );
                })}
              </span>
              <span className="text-muted-foreground/40">{row.ascii}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {`0x${hexAddress(base)}-0x${hexAddress(base + PAGE_SIZE - 1)} · ${regionText} · page ${page + 1} of ${pages}`}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-[2px] bg-emerald-400/60" aria-hidden="true" />
            PC
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-[2px] bg-sky-400/60" aria-hidden="true" />
            I
          </span>
        </span>
      </div>
    </div>
  );
}

import { FolderOpen, Save, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { totalBytes } from '@/library';

const formatSize = (size) => (size >= 1024
  ? `${(size / 1024).toFixed(1)} KB`
  : `${size} B`);

const formatDate = (iso) => String(iso ?? '').slice(0, 10);

/**
 * ROMs the user has explicitly saved in this browser. Loading restores the
 * saved bytes and quirk preset; deleting only removes the library copy.
 */
export function RomLibrary({ library, currentRom, running, onSave, onLoad, onRemove }) {
  const entries = library?.entries ?? [];
  const isSaved = Boolean(currentRom?.hash)
    && entries.some((entry) => entry.id === currentRom.hash);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={!currentRom || isSaved}
          title={isSaved ? 'This ROM is already saved' : 'Save the loaded ROM in this browser'}
        >
          <Save className="size-3.5" />
          {isSaved ? 'Already saved' : 'Save current ROM'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {entries.length
            ? `${entries.length} saved · ${formatSize(totalBytes(library))} · this browser only`
            : 'Saved ROMs stay in this browser only.'}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Load a ROM, then save it here to reload it without the file picker.
        </p>
      ) : (
        <ul className="max-h-60 space-y-1.5 overflow-auto pr-1" aria-label="Saved ROMs">
          {entries.map((entry) => {
            const current = currentRom?.hash === entry.id;
            return (
              <li
                key={entry.id}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-[#070a0d] px-2 py-1.5',
                  current && 'border-emerald-400/40 bg-emerald-400/[0.06]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{entry.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {`${entry.hash} · ${formatSize(entry.size)} · ${formatDate(entry.addedAt)}`}
                  </p>
                </div>

                <Badge variant="outline" className="text-[10px]">
                  {entry.preset === 'vip' ? 'VIP' : 'Modern'}
                </Badge>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onLoad(entry.id)}
                  disabled={running}
                  aria-label={`Load ${entry.name}`}
                >
                  <FolderOpen className="size-3.5" />
                  Load
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 px-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(entry.id)}
                  aria-label={`Delete ${entry.name}`}
                  title="Delete from library"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { verifyExplanation } from '@/explain';
import { cn } from '@/lib/utils';
import { DEFAULT_ENDPOINT, requestModelExplanation } from '@/model';

/**
 * Optional language-model explanation for the selected trace event.
 * The key lives only in component state; it is never persisted.
 */
export function ModelPanel({ event }) {
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  // A different trace entry invalidates an old answer, including in-flight ones.
  useEffect(() => {
    requestRef.current += 1;
    setResult(null);
    setError('');
    setLoading(false);
  }, [event?.seq]);

  if (!event) return null;

  const onSubmit = async (submitEvent) => {
    submitEvent.preventDefault();
    const id = requestRef.current + 1;
    requestRef.current = id;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const response = await requestModelExplanation({ endpoint, apiKey, model, event });
      if (requestRef.current !== id) return;
      setResult({
        ...response,
        verification: verifyExplanation(response.explanation, event),
      });
    } catch (requestError) {
      if (requestRef.current !== id) return;
      setError(requestError.message || String(requestError));
    } finally {
      if (requestRef.current === id) setLoading(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Sparkles className="size-3.5" />
        {open ? 'Hide model options' : 'Explain with a model'}
      </Button>

      {open ? (
        <form className="mt-3 space-y-3" onSubmit={onSubmit}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="model-endpoint" className="text-xs">Endpoint</Label>
              <Input
                id="model-endpoint"
                value={endpoint}
                onChange={(changeEvent) => setEndpoint(changeEvent.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model-name" className="text-xs">Model</Label>
              <Input
                id="model-name"
                value={model}
                onChange={(changeEvent) => setModel(changeEvent.target.value)}
                placeholder="gpt-4o-mini"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="model-key" className="flex items-center gap-1.5 text-xs">
              <KeyRound className="size-3" />
              API key
            </Label>
            <Input
              id="model-key"
              type="password"
              value={apiKey}
              onChange={(changeEvent) => setApiKey(changeEvent.target.value)}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            The key stays in memory for this tab. Requests go straight from your browser to the endpoint.
            {` Answers are tied to trace #${event.seq}; executing a new instruction clears them.`}
          </p>

          <Button type="submit" size="sm" disabled={loading}>
            {loading
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Sparkles className="size-3.5" />}
            {loading ? 'Asking…' : 'Ask the model'}
          </Button>
        </form>
      ) : null}

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {result ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Model response</p>
            {result.verification.ok ? (
              <Badge variant="outline" className="gap-1 text-emerald-400">
                <ShieldCheck className="size-3" />
                Evidence verified
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-destructive">
                <ShieldAlert className="size-3" />
                {`${result.verification.unsupported.length} rejected`}
              </Badge>
            )}
          </div>

          <ul className="space-y-1.5">
            {result.explanation.statements.map((statement, index) => {
              const rejected = result.verification.unsupported.includes(statement.text);
              return (
                <li key={index} className="flex gap-2 text-sm">
                  <span
                    className={cn(
                      'mt-[7px] size-1.5 shrink-0 rounded-full',
                      rejected ? 'bg-destructive' : 'bg-emerald-400',
                    )}
                    aria-hidden="true"
                  />
                  <span className={rejected ? 'text-destructive' : undefined}>
                    {statement.text}
                    {rejected ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wider">not in trace</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>

          {result.usage?.total_tokens ? (
            <p className="text-xs text-muted-foreground">{`${result.usage.total_tokens} tokens`}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, Icon, Button, Textarea, Select, Toggle, Alert, Spinner, EmptyState, usePoll } from '../components/ui.jsx';
import { AI, Market } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { renderMarkdown } from '../lib/format.js';

const SUGGESTIONS = [
  { mode: 'tutor', prompt: 'Explain position sizing with a worked example on a ₹1,00,000 paper account.' },
  { mode: 'tutor', prompt: 'Why does a trend-pullback strategy lose money in a sideways market?' },
  { mode: 'analyse', prompt: 'Read the current technical picture and tell me what would invalidate each reading.' },
  { mode: 'summarize', prompt: 'Explain the difference between profit factor and expectancy, and which one to trust.' },
  { mode: 'botreview', prompt: 'Review my bot\'s per-setup statistics and tell me which setups to stop trading.' },
  { mode: 'roadmap', prompt: 'Given my progress, what should I do next and why does the order matter?' },
  { mode: 'news', prompt: 'Brief me on today\'s headlines and the risks each one implies.' },
];

export default function Coach() {
  const toast = useToast();
  const { data: status } = usePoll(() => AI.status(), 600000, []);
  const { data: modes } = usePoll(() => AI.modes(), 600000, []);
  const { data: instruments } = usePoll(() => Market.instruments('all'), 600000, []);

  const [mode, setMode] = useState('tutor');
  const [prompt, setPrompt] = useState('');
  const [symbol, setSymbol] = useState('RELIANCE');
  const [refs, setRefs] = useState({ includeNews: false, includePortfolio: true, includeBotStats: false, includeRoadmap: false });
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread, busy]);

  const ask = async (text = prompt, m = mode) => {
    const q = String(text || '').trim();
    if (!q) return;
    if (!status?.configured) return toast.error('AI is not configured', 'Add GEMINI_API_KEY to server/.env and restart the API.');

    setThread((t) => [...t, { role: 'user', mode: m, text: q, refs: { symbol, ...refs } }]);
    setPrompt('');
    setBusy(true);
    try {
      const r = await AI.generate({
        mode: m,
        prompt: q,
        refs: {
          symbol: m === 'analyse' || refs.useSymbol ? symbol : undefined,
          includeNews: refs.includeNews || m === 'news',
          market: 'all',
          includePortfolio: refs.includePortfolio,
          includeBotStats: refs.includeBotStats || m === 'botreview',
          includeRoadmap: refs.includeRoadmap || m === 'roadmap',
        },
      });
      setThread((t) => [...t, { role: 'ai', mode: r.mode, model: r.model, text: r.text }]);
    } catch (e) {
      setThread((t) => [...t, { role: 'error', text: e.message }]);
      toast.error('The coach could not answer', e.message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      ask();
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">AI coach</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500">
          Gemini runs entirely on the backend — your browser never talks to Google and the API key never reaches the
          client. It teaches, summarises and critiques. It will not tell you what to buy.
        </p>
      </div>

      {!status?.configured && (
        <Alert tone="warn" title="Gemini is not connected yet">
          Add <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">GEMINI_API_KEY</code> to
          <code className="mx-1 rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">server/.env</code> and restart
          the API. Everything else in the app works without it.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        {/* conversation */}
        <Card pad={false} className="flex min-h-[26rem] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {thread.length === 0 && !busy && (
              <div className="py-6">
                <EmptyState
                  icon="spark"
                  title="Ask anything about trading"
                  message="Pick a suggestion below, or type your own question. The coach sees your simulator data only if you let it."
                />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      disabled={!status?.configured}
                      onClick={() => { setMode(s.mode); ask(s.prompt, s.mode); }}
                      className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-[12.5px] leading-snug text-slate-600 transition hover:border-brand-300 hover:bg-brand-50/40 hover:text-slate-900 disabled:opacity-50"
                    >
                      <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-brand-600">{s.mode}</span>
                      {s.prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {thread.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
                {m.role !== 'user' && (
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white ${m.role === 'error' ? 'bg-rose-500' : 'bg-gradient-to-br from-brand-500 to-brand-700'}`}>
                    <Icon name={m.role === 'error' ? 'alert' : 'spark'} className="h-4 w-4" />
                  </span>
                )}
                <div className={`min-w-0 max-w-[92%] sm:max-w-[85%] ${m.role === 'user' ? 'order-first' : ''}`}>
                  {m.role === 'user' ? (
                    <div className="rounded-2xl rounded-tr-md bg-brand-600 px-4 py-3 text-[13.5px] leading-relaxed text-white shadow-sm">
                      {m.text}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="chip bg-white/20 text-white">{m.mode}</span>
                        {m.refs?.includePortfolio && <span className="chip bg-white/20 text-white">+ portfolio</span>}
                        {m.refs?.includeBotStats && <span className="chip bg-white/20 text-white">+ bot stats</span>}
                        {m.refs?.includeNews && <span className="chip bg-white/20 text-white">+ news</span>}
                      </div>
                    </div>
                  ) : m.role === 'error' ? (
                    <div className="rounded-2xl rounded-tl-md border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-medium text-rose-900">
                      {m.text}
                    </div>
                  ) : (
                    <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone="brand">{m.mode}</Badge>
                        {m.model && <Badge tone="neutral">{m.model}</Badge>}
                      </div>
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                    </div>
                  )}
                </div>
                {m.role === 'user' && (
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-600">
                    <Icon name="settings" className="h-4 w-4" />
                  </span>
                )}
              </div>
            ))}

            {busy && (
              <div className="flex gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                  <Icon name="spark" className="h-4 w-4" />
                </span>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-card">
                  <Spinner className="h-4 w-4 text-brand-500" />
                  <span className="text-[12.5px] font-semibold text-slate-500">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* composer */}
          <div className="border-t border-slate-100 bg-slate-50/60 p-3.5 sm:p-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-2 [&>*]:min-w-0">
              <Select value={mode} onChange={(e) => setMode(e.target.value)} className="h-9 w-auto min-w-[10rem] py-1.5 text-[12.5px]">
                {(modes?.modes || [{ id: 'tutor', label: 'Learn a concept' }]).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
              <Select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-9 w-auto min-w-[9rem] py-1.5 text-[12.5px]">
                {(instruments?.instruments || []).map((i) => (
                  <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
                ))}
              </Select>
              <span className="text-[11px] text-slate-400">⌘/Ctrl + Enter to send</span>
            </div>
            <div className="flex items-end gap-2 [&>*]:min-w-0">
              <Textarea
                rows={2} value={prompt} maxLength={4000}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about a concept, a chart, your journal, or the bot's statistics…"
                className="flex-1"
                disabled={!status?.configured}
              />
              <Button icon="send" size="lg" loading={busy} disabled={!status?.configured || !prompt.trim()} onClick={() => ask()} className="shrink-0">
                <span className="hidden sm:inline">Ask</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* context controls */}
        <div className="space-y-4">
          <Card>
            <p className="mb-2.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">What the coach may see</p>
            <p className="mb-3 text-[11.5px] leading-relaxed text-slate-500">
              Context is assembled on the server from your own rows. Nothing is sent unless you switch it on.
            </p>
            <div className="space-y-1">
              <Toggle checked={refs.includePortfolio} onChange={(v) => setRefs({ ...refs, includePortfolio: v })} label="Portfolio" description="Cash, open positions, realised P&L" />
              <Toggle checked={refs.includeBotStats} onChange={(v) => setRefs({ ...refs, includeBotStats: v })} label="Bot statistics" description="Per-setup expectancy and weights" />
              <Toggle checked={refs.includeNews} onChange={(v) => setRefs({ ...refs, includeNews: v })} label="Current headlines" description="Up to 12 live stories" />
              <Toggle checked={refs.includeRoadmap} onChange={(v) => setRefs({ ...refs, includeRoadmap: v })} label="Learning progress" description="Which modules you have finished" />
            </div>
          </Card>

          <Card className="bg-slate-50">
            <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-slate-600">
              <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" stroke={2.2} />
              <span>
                The system prompt forbids the model from giving personalised trade recommendations, promising returns, or
                discussing real-money deposits. It cannot place an order — the AI route returns text and nothing else.
              </span>
            </p>
          </Card>

          <Card>
            <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">Try these</p>
            <div className="space-y-1.5">
              {SUGGESTIONS.slice(0, 5).map((s, i) => (
                <button
                  key={i}
                  disabled={!status?.configured || busy}
                  onClick={() => { setMode(s.mode); ask(s.prompt, s.mode); }}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] leading-snug text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {s.prompt}
                </button>
              ))}
            </div>
          </Card>

          {thread.length > 0 && (
            <Button variant="secondary" size="sm" icon="refresh" className="w-full" onClick={() => setThread([])}>
              Clear conversation
            </Button>
          )}

          <Link to="/app/learn">
            <Card className="transition hover:border-brand-200 hover:shadow-lift">
              <p className="flex items-center gap-2 text-[12.5px] font-bold text-slate-800">
                <Icon name="book" className="h-4 w-4 text-brand-600" /> Prefer the structured path?
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-slate-500">
                The 14 modules cover this ground in order, with quizzes that prove you understood it.
              </p>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}

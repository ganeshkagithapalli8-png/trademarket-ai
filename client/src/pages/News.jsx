import { useState } from 'react';
import { Card, Badge, Icon, Button, Alert, Tabs, EmptyState, Skeleton, Spinner, usePoll } from '../components/ui.jsx';
import { Market, AI } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { timeAgo, renderMarkdown } from '../lib/format.js';

const TABS = [
  { id: 'stocks', label: 'Stocks', icon: 'chart' },
  { id: 'crypto', label: 'Crypto', icon: 'target' },
  { id: 'fno', label: 'F&O', icon: 'zap' },
  { id: 'ipo', label: 'IPO', icon: 'star' },
  { id: 'forex', label: 'Forex', icon: 'wallet' },
];

export default function News() {
  const [tab, setTab] = useState('stocks');
  const [query, setQuery] = useState('');
  const toast = useToast();

  const { data, loading, refresh, error } = usePoll(() => Market.news(tab), 300000, [tab]);
  const [briefing, setBriefing] = useState(null);
  const [briefBusy, setBriefBusy] = useState(false);

  const items = (data?.items || []).filter((i) => {
    const t = query.trim().toLowerCase();
    if (!t) return true;
    return i.title.toLowerCase().includes(t) || (i.summary || '').toLowerCase().includes(t) || i.source.toLowerCase().includes(t);
  });

  const makeBriefing = async () => {
    setBriefBusy(true);
    setBriefing(null);
    try {
      const r = await AI.briefing(tab);
      setBriefing(r);
    } catch (e) {
      toast.error('Could not generate a briefing', e.message);
    } finally {
      setBriefBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Market news</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {data?.live ? `Live headlines · refreshed ${timeAgo(data.fetchedAt)}` : 'Feeds are unreachable right now'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon="refresh" onClick={() => refresh()}>Refresh</Button>
          <Button size="sm" icon="spark" loading={briefBusy} onClick={makeBriefing}>AI briefing</Button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={(t) => { setTab(t); setBriefing(null); }} />

      {error && <Alert tone="danger" title="Could not load news">{error}</Alert>}

      {!data?.live && data && (
        <Alert tone="warn" title="News feeds unreachable">
          The simulator, your positions and the AI tutor are unaffected — only the headline feed is offline. It retries
          automatically.
        </Alert>
      )}

      {briefBusy && (
        <Card className="flex items-center justify-center gap-3 py-10">
          <Spinner className="h-5 w-5 text-brand-500" />
          <span className="text-[13px] font-semibold text-slate-500">Reading the headlines…</span>
        </Card>
      )}

      {briefing && !briefBusy && (
        <Card className="border-brand-200 bg-gradient-to-br from-brand-50/70 to-white">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white">
              <Icon name="spark" className="h-4 w-4" />
            </span>
            <p className="text-[14px] font-bold text-slate-900">AI briefing · {tab}</p>
            <Badge tone="neutral">{briefing.model}</Badge>
            {!briefing.newsLive && <Badge tone="warn">headlines unavailable</Badge>}
          </div>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(briefing.text) }} />
        </Card>
      )}

      <Card>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter headlines…"
            className="field pl-10"
          />
        </div>
        <p className="mt-2 text-[11.5px] text-slate-500">
          {loading && !items.length ? 'Loading…' : `${items.length} headline${items.length === 1 ? '' : 's'}`}
          {data?.sources ? ` from ${data.sources} feed${data.sources === 1 ? '' : 's'}` : ''}
        </p>
      </Card>

      {loading && !items.length ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i} className="h-[84px]"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="mt-2.5 h-3 w-1/2" /></Card>)}
        </div>
      ) : items.length === 0 ? (
        <Card pad={false}>
          <EmptyState icon="news" title="No headlines match" message="Try a different filter, or switch market." />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {items.map((it, i) => (
            <a
              key={i}
              href={it.link || undefined}
              target={it.link ? '_blank' : undefined}
              rel="noopener noreferrer"
              className="card group block p-4 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-brand-50 group-hover:text-brand-600">
                  <Icon name="news" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-bold leading-snug text-slate-900 group-hover:text-brand-700">{it.title}</h3>
                  {it.summary && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-slate-600">{it.summary}</p>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Badge tone="neutral">{it.source}</Badge>
                    <Badge tone="brand">{it.market}</Badge>
                    <span className="text-[11px] text-slate-400">{timeAgo(it.publishedAt)}</span>
                    {it.link && (
                      <span className="ml-auto flex items-center gap-1 text-[11px] font-bold text-brand-600 opacity-0 transition group-hover:opacity-100">
                        Read <Icon name="arrowRight" className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      <p className="px-1 text-center text-[11px] leading-relaxed text-slate-400">
        Headlines are republished from public RSS feeds for educational context. They are not investment advice, and the
        prices in this simulator are not affected by them.
      </p>
    </div>
  );
}

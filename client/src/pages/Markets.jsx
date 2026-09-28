import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Badge, Icon, Input, Tabs, Skeleton, EmptyState, usePoll, Alert, SectionTitle, Flash } from '../components/ui.jsx';
import { Sparkline } from '../components/Chart.jsx';
import { Market, Profile } from '../lib/api.js';
import { money, pct, compact, n } from '../lib/format.js';

const TABS = [
  { id: 'all', label: 'All', icon: 'layers' },
  { id: 'stocks', label: 'Stocks', icon: 'chart' },
  { id: 'fno', label: 'F&O', icon: 'zap' },
  { id: 'ipo', label: 'IPO', icon: 'star' },
  { id: 'crypto', label: 'Crypto', icon: 'target' },
  { id: 'forex', label: 'Forex', icon: 'wallet' },
];

export default function Markets() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('all');

  const { data: ticks, loading, refresh, error } = usePoll(() => Market.tickers(tab), 6000, [tab]);
  const { data: access } = usePoll(() => Profile.marketAccess(), 120000, []);

  const rows = ticks?.tickers || [];
  const sectors = useMemo(() => ['all', ...new Set(rows.map((r) => r.sector))], [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (sector !== 'all' && r.sector !== sector) return false;
      if (!term) return true;
      return r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term) || (r.sector || '').toLowerCase().includes(term);
    });
  }, [rows, q, sector]);

  const gainers = [...rows].sort((a, b) => b.changePct - a.changePct).slice(0, 3);
  const losers = [...rows].sort((a, b) => a.changePct - b.changePct).slice(0, 3);
  const accessFor = (m) => access?.access?.find((a) => a.id === m);

  const lockedNotice = tab !== 'all' ? accessFor(tab) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-slate-900 sm:text-[27px]">Markets</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Simulated prices with realistic volatility. Optional live crypto reference from CoinGecko.
          </p>
        </div>
        <button onClick={refresh} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-600 transition hover:bg-slate-50 active:scale-95">
          <Icon name="refresh" className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {lockedNotice && !lockedNotice.unlocked && (
        <Alert tone="warn" title={`${lockedNotice.label} is locked`}>
          {lockedNotice.reason}{' '}
          {lockedNotice.missingModules?.length > 0 && (
            <Link to="/app/learn/risk-management" className="font-bold underline underline-offset-2">Open the Risk Management module →</Link>
          )}
        </Alert>
      )}

      {error && <Alert tone="danger" title="Could not load market data">{error}</Alert>}

      {/* movers */}
      {rows.length > 0 && tab !== 'all' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[{ t: 'Top gainers', list: gainers, tone: 'up' }, { t: 'Top losers', list: losers, tone: 'down' }].map((g) => (
            <Card key={g.t}>
              <p className="mb-2.5 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
                <Icon name={g.tone === 'up' ? 'arrowUp' : 'arrowDown'} className={`h-3.5 w-3.5 ${g.tone === 'up' ? 'text-up-deep' : 'text-down-deep'}`} stroke={2.6} />
                {g.t}
              </p>
              <div className="space-y-1.5">
                {g.list.map((r) => (
                  <Link key={r.symbol} to={`/app/trade/${r.symbol}`} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-800">{r.symbol}</span>
                    <span className="tnum text-[12px] text-slate-500">{compact(r.price)}</span>
                    <span className={`tnum w-16 text-right text-[12px] font-bold ${g.tone === 'up' ? 'text-up-deep' : 'text-down-deep'}`}>{pct(r.changePct)}</span>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* filters */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input icon="search" placeholder="Search symbol, company or sector…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar sm:max-w-[50%]">
            {sectors.map((s) => (
              <button
                key={s}
                onClick={() => setSector(s)}
                className={`shrink-0 rounded-lg px-3 py-2 text-[12px] font-semibold transition ${
                  sector === s ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s === 'all' ? 'All sectors' : s}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2.5 text-[11.5px] text-slate-500">
          {loading && !rows.length ? 'Loading…' : `${filtered.length} instrument${filtered.length === 1 ? '' : 's'}`}
          {q && ` matching “${q}”`}
        </p>
      </Card>

      {/* list */}
      {loading && !rows.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => <Card key={i} className="h-[86px]"><Skeleton className="h-3.5 w-24" /><Skeleton className="mt-3 h-5 w-20" /></Card>)}
        </div>
      ) : filtered.length === 0 ? (
        <Card pad={false}>
          <EmptyState
            icon="search"
            title="Nothing matches that search"
            message="Try a different symbol, or clear the sector filter."
          />
        </Card>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const locked = r.market === 'fno' || r.market === 'forex' ? accessFor(r.market) : null;
            const isLocked = locked && !locked.unlocked;
            return (
              <Link
                key={r.symbol}
                to={`/app/trade/${r.symbol}`}
                className="card group relative flex items-center gap-3 p-3.5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lift"
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[11px] font-extrabold ${
                  r.changePct >= 0 ? 'bg-up-soft text-up-deep' : 'bg-down-soft text-down-deep'
                }`}>
                  {r.symbol.replace(/[^A-Z]/g, '').slice(0, 3) || '—'}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[13.5px] font-bold text-slate-900">{r.symbol}</p>
                    {r.source === 'live' && <span className="h-1.5 w-1.5 shrink-0 animate-pulse-soft rounded-full bg-emerald-500" title="Live reference price" />}
                    {isLocked && <Icon name="lock" className="h-3 w-3 shrink-0 text-amber-500" />}
                  </div>
                  <p className="truncate text-[11.5px] text-slate-500">{r.name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="chip bg-slate-100 text-slate-500">{r.sector}</span>
                    {r.lot > 1 && <span className="chip bg-slate-100 text-slate-500">lot {r.lot}</span>}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tnum text-[14px] font-bold text-slate-900">
                    <Flash value={r.price}>{money(r.price, r.price < 10 ? 4 : r.decimals ?? 2)}</Flash>
                  </p>
                  <p className={`tnum mt-0.5 text-[11.5px] font-bold ${r.changePct >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>
                    <Flash value={r.changePct}>{r.changePct >= 0 ? '▲' : '▼'} {pct(r.changePct)}</Flash>
                  </p>
                  <Sparkline
                    points={[r.low, r.open, (r.low + r.high) / 2, r.high, r.price]}
                    tone={r.changePct >= 0 ? '#10B981' : '#F43F5E'}
                    width={54}
                    height={20}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="px-1 text-center text-[11px] leading-relaxed text-slate-400">
        Prices are synthetic simulator output (crypto may use a delayed public reference). Nothing here is a tradable
        quote and nothing here is investment advice.
      </p>
    </div>
  );
}

/**
 * Watchlist — left rail of the trading terminal.
 * Membership lives on the server (per-account, seeded at signup); row order
 * is a local preference. Prices update live from the market socket — no
 * polling, no page refresh. Add / remove / reorder / click-to-chart.
 */
import { useEffect, useMemo, useState } from 'react';
import { Content } from '../lib/api.js';
import { Icon } from './ui.jsx';
import { useLiveQuotes } from '../lib/marketSocket.js';

const LS_KEY = 'tm_watchlist_order_v1';

function savedOrder() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveOrder(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export default function Watchlist({ instruments = [], active, onSelect, dark = false }) {
  const [items, setItems] = useState([]); // [{ id, symbol }]
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    Content.watchlist()
      .then((r) => {
        if (!alive) return;
        const list = (r.watchlist || []).map((x) => ({ id: x.id, symbol: x.symbol }));
        const order = savedOrder();
        list.sort((a, b) => {
          const ia = order.indexOf(a.symbol); const ib = order.indexOf(b.symbol);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        });
        setItems(list);
        setLoaded(true);
      })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const list = items.map((i) => i.symbol);
  const { quotes, status } = useLiveQuotes(list);

  const commit = (next) => { setItems(next); saveOrder(next.map((i) => i.symbol)); };

  const add = async (symbol) => {
    setAdding(false); setQ('');
    if (list.includes(symbol)) return;
    try {
      const r = await Content.addWatch({ symbol });
      commit([...items, { id: r.item?.id ?? null, symbol }]);
    } catch { /* rejected unknown symbol — server is source of truth */ }
  };
  const remove = async (symbol) => {
    const item = items.find((i) => i.symbol === symbol);
    const next = items.filter((i) => i.symbol !== symbol);
    commit(next);
    if (item?.id) { try { await Content.removeWatch(item.id); } catch { /* already gone */ } }
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const matches = useMemo(() => {
    const needle = q.trim().toUpperCase();
    if (!needle) return instruments.slice(0, 8);
    const bare = needle.includes(':') ? needle.split(':').pop() : needle;
    return instruments
      .filter((i) => i.symbol.includes(bare) || i.name.toUpperCase().includes(needle) || `${i.exchange || ''}:${i.symbol}`.includes(needle))
      .slice(0, 12);
  }, [q, instruments]);

  const cardCls = dark ? 'text-slate-200' : 'text-slate-800';

  return (
    <aside data-testid="watchlist" className={`flex flex-col rounded-2xl border overflow-hidden h-full ${dark ? 'border-white/10 bg-[#0b1020]' : 'border-slate-200 bg-white'}`}>
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${dark ? 'border-white/10' : 'border-slate-100'}`}>
        <h3 className={`text-sm font-bold ${cardCls}`}>Watchlist</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${status === 'live' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'}`} data-testid="watchlist-status">
          {status === 'live' ? 'LIVE' : 'SYNC…'}
        </span>
        <div className="flex-1" />
        <button type="button" data-testid="watchlist-add" onClick={() => setAdding((a) => !a)}
          className={`p-1 rounded-lg transition ${dark ? 'hover:bg-white/10 text-slate-300' : 'hover:bg-slate-100 text-slate-500'}`}
          title="Add symbol"><Icon name="plus" className="h-4 w-4" /></button>
      </div>

      {adding ? (
        <div className={`px-3 py-2 border-b ${dark ? 'border-white/10' : 'border-slate-100'}`}>
          <input data-testid="watchlist-search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search AAPL, NSE:RELIANCE, BTC…" autoFocus
            className={`w-full text-xs px-2.5 py-1.5 rounded-lg border outline-none ${dark ? 'bg-white/5 border-white/10 text-white placeholder-slate-500' : 'border-slate-200 bg-white'} focus:border-blue-500`} />
          <div className="mt-1.5 max-h-40 overflow-y-auto">
            {matches.map((i) => (
              <button key={i.symbol} type="button" data-testid={`watchlist-add-${i.symbol}`} onClick={() => add(i.symbol)}
                className={`w-full flex items-center justify-between text-left px-2 py-1.5 rounded-lg text-xs transition ${dark ? 'hover:bg-white/10' : 'hover:bg-slate-50'} ${list.includes(i.symbol) ? 'opacity-40' : ''}`}>
                <span className={`font-semibold ${cardCls}`}>{i.symbol}</span>
                <span className={dark ? 'text-slate-400' : 'text-slate-500'}>{i.name}</span>
              </button>
            ))}
            {!matches.length ? <p className="text-[11px] text-slate-400 px-2 py-1">No match. Try NSE:…, NASDAQ:… or a plain symbol.</p> : null}
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <p className="text-xs text-slate-400 px-3 py-6 text-center">Loading watchlist…</p>
        ) : list.length === 0 ? (
          <p className="text-xs text-slate-400 px-3 py-6 text-center">Empty. Hit + to track symbols.</p>
        ) : items.map((it, i) => {
          const sym = it.symbol;
          const quote = quotes[sym];
          const meta = instruments.find((x) => x.symbol === sym);
          const up = (quote?.changePct ?? 0) >= 0;
          const isActive = active === sym;
          return (
            <div key={sym} data-testid={`wl-row-${sym}`}
              className={`group flex items-center gap-1 px-2 py-1.5 border-b cursor-pointer transition ${dark ? 'border-white/5' : 'border-slate-50'} ${isActive ? (dark ? 'bg-white/10' : 'bg-blue-50/70') : (dark ? 'hover:bg-white/5' : 'hover:bg-slate-50')}`}
              onClick={() => onSelect?.(sym)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(sym); }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-bold ${cardCls}`}>{sym}</span>
                  {quote?.feed ? (
                    <span className={`text-[8.5px] px-1 rounded font-bold leading-tight ${quote.feed.latency === 'live' ? 'bg-emerald-500/15 text-emerald-500' : quote.feed.latency === 'delayed' ? 'bg-amber-500/15 text-amber-500' : 'bg-slate-500/10 text-slate-400'}`}
                      title={quote.feed.marketOpen ? quote.feed.label : `${quote.feed.label} · market closed`}>
                      {quote.feed.latency === 'live' ? 'LIVE' : quote.feed.latency === 'delayed' ? 'DLY' : 'SIM'}
                      {quote.feed.marketOpen ? '' : '·C'}
                    </span>
                  ) : null}
                </div>
                <p className={`text-[10px] truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{quote?.name || meta?.name || sym}</p>
              </div>
              <div className="text-right min-w-[64px]">
                <p className={`text-xs font-bold tabular-nums ${cardCls}`} data-testid={`wl-price-${sym}`}>
                  {quote ? quote.price.toFixed(2) : '…'}
                </p>
                <p className={`text-[10px] font-semibold tabular-nums ${up ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {quote ? `${up ? '+' : ''}${quote.changePct.toFixed(2)}%` : ''}
                </p>
              </div>
              <div className="flex flex-col opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
                <button type="button" aria-label={`Move ${sym} up`} data-testid={`wl-up-${sym}`} onClick={() => move(i, -1)}
                  className={`p-0.5 rounded ${dark ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}><Icon name="arrowUp" className="h-3 w-3" /></button>
                <button type="button" aria-label={`Move ${sym} down`} data-testid={`wl-down-${sym}`} onClick={() => move(i, 1)}
                  className={`p-0.5 rounded ${dark ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}><Icon name="arrowDown" className="h-3 w-3" /></button>
              </div>
              <button type="button" aria-label={`Remove ${sym}`} data-testid={`wl-remove-${sym}`} onClick={(e) => { e.stopPropagation(); remove(sym); }}
                className={`opacity-0 group-hover:opacity-100 p-1 rounded transition ${dark ? 'text-slate-400 hover:text-rose-400' : 'text-slate-300 hover:text-rose-500'}`}>
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

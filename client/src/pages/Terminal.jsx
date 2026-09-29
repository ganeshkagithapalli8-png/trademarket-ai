/**
 * Trading Terminal — the professional workspace.
 *
 *   ┌ header: symbol search · feed + session chips · TradingView links ┐
 *   │ watchlist │            chart (ChartPro)            │ order panel │
 *   ├───────────┴────────────────────────────────────────┴─────────────┤
 *   │ tabs: Positions · Orders · Trade history · Portfolio · P&L       │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Paper trading only: virtual cash, virtual fills. No real broker call is
 * ever made from this page, and every surface says so.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Market, Trade } from '../lib/api.js';
import { useLiveQuotes, useSocketStatus, useProviderStatus } from '../lib/marketSocket.js';
import { mountTradingViewChart } from '../lib/tvDatafeed.js';
import ChartPro from '../components/ChartPro.jsx';
import Watchlist from '../components/Watchlist.jsx';
import { tvSymbol } from '../components/TradingView.jsx';
import { Icon, usePoll } from '../components/ui.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** NSE:/NASDAQ:/FX:/COIN: qualification for search + TradingView links. */
const exchangeOf = (i) => (i.market === 'crypto' ? 'COIN' : i.market === 'forex' ? 'FX' : i.sector === 'US' ? 'NASDAQ' : i.market === 'stocks' || i.market === 'fno' || i.market === 'ipo' ? 'NSE' : 'SIM');

export default function Terminal() {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [query, setQuery] = useState('');
  const [focusSearch, setFocusSearch] = useState(false);
  const [tab, setTab] = useState('positions');
  const [notice, setNotice] = useState(null);
  const [tvMounted, setTvMounted] = useState(false);
  const tvHostRef = useRef(null);

  const { data: inst } = usePoll(() => Market.instruments('all'), 120_000, []);
  const instruments = useMemo(() => (inst?.instruments || []).map((i) => ({ ...i, exchange: exchangeOf(i) })), [inst]);
  const current = instruments.find((i) => i.symbol === symbol) || null;

  const { quotes } = useLiveQuotes(symbol ? [symbol] : []);
  const q = quotes[symbol];
  const status = useSocketStatus();
  const provider = useProviderStatus();

  /* ── suggestions for the header search ── */
  const suggestions = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (!needle) return [];
    const bare = needle.includes(':') ? needle.split(':').pop() : needle;
    return instruments
      .filter((i) => i.symbol.includes(bare) || i.name.toUpperCase().includes(needle) || `${i.exchange}:${i.symbol}`.includes(needle))
      .slice(0, 8);
  }, [query, instruments]);

  const pick = (sym) => {
    const bare = sym.includes(':') ? sym.split(':').pop() : sym;
    setSymbol(bare);
    setQuery('');
    setFocusSearch(false);
    setBump((b) => b + 1);
  };

  /* ── bottom-panel data (light polling; never a page refresh) ── */
  const [bump, setBump] = useState(0);
  const positions = usePoll(() => Trade.positions('open'), 8000, [bump]);
  const orders = usePoll(() => Trade.orders(), 8000, [bump]);
  const closed = usePoll(() => Trade.positions('closed'), 15000, [bump]);
  const portfolio = usePoll(() => Trade.portfolio(), 10000, [bump]);

  // Official TradingView Charting Library mounts here when licensed in;
  // otherwise the host stays hidden and ChartPro renders the same datafeed.
  useEffect(() => {
    const w = mountTradingViewChart(tvHostRef.current, { symbol, interval: '5m' });
    setTvMounted(Boolean(w));
    return () => { try { w?.remove(); } catch { /* not mounted */ } };
  }, [symbol]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const tvChartHref = current
    ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol(current))}`
    : 'https://www.tradingview.com/chart/';


  return (
    <div className="space-y-3">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" className="h-4 w-4" /></div>
          <input data-testid="terminal-search" value={query}
            onChange={(e) => { setQuery(e.target.value); setFocusSearch(true); }}
            onFocus={() => setFocusSearch(true)}
            onBlur={() => setTimeout(() => setFocusSearch(false), 150)}
            placeholder="Search symbols — AAPL, NSE:RELIANCE, NASDAQ:TSLA, BTCINR, USDINR…"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          {focusSearch && suggestions.length > 0 ? (
            <div data-testid="terminal-suggestions" className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
              {suggestions.map((i) => (
                <button key={i.symbol} type="button" data-testid={`suggest-${i.symbol}`} onMouseDown={() => pick(`${i.exchange}:${i.symbol}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="font-bold">{i.symbol}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold">{i.exchange}</span>
                  <span className="text-xs text-slate-500 truncate">{i.name}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <span className={`text-[10px] px-2 py-1 rounded-lg font-bold ${status === 'live' ? 'bg-emerald-500/15 text-emerald-600' : status === 'closed' ? 'bg-slate-500/10 text-slate-500' : 'bg-amber-500/15 text-amber-600'}`} data-testid="terminal-stream">
          {status === 'live' ? '● WS CONNECTED' : status === 'closed' ? 'WS OFFLINE' : 'WS RECONNECTING…'}
        </span>
        <span className={`text-[10px] px-2 py-1 rounded-lg font-bold ${STATE_STYLE[stateOf(q, provider)]}`} data-testid="terminal-state">
          {STATE_TEXT[stateOf(q, provider)]}
        </span>
        {q?.feed ? (
          <span className={`text-[10px] px-2 py-1 rounded-lg font-bold ${q.feed.latency === 'live' ? 'bg-emerald-500/15 text-emerald-600' : q.feed.latency === 'delayed' ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-500/10 text-slate-500'}`} data-testid="terminal-feed" title={q.feed.reason || provider?.reason || ''}>
            {q.feed.label}
          </span>
        ) : null}

        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer noopener" data-testid="tv-open"
          className="text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-700 transition">
          Open TradingView ↗
        </a>
        <a href={tvChartHref} target="_blank" rel="noreferrer noopener" data-testid="tv-chart"
          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition"
          title={current ? `Full TradingView chart for ${tvSymbol(current)}` : 'TradingView chart'}>
          Full {symbol} chart ↗
        </a>
      </div>

      {/* full quote strip — every field the provider gives us */}
      {q ? (
        <div data-testid="quote-strip" className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-11 gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
          <QF label="LTP" value={q.price?.toFixed(2)} strong tone={q.changePct} />
          <QF label="Change" value={`${q.change >= 0 ? '+' : ''}${q.change?.toFixed(2)}`} tone={q.change} />
          <QF label="Change %" value={`${q.changePct >= 0 ? '+' : ''}${q.changePct?.toFixed(2)}%`} tone={q.changePct} />
          <QF label="Open" value={q.open?.toFixed(2)} />
          <QF label="High" value={q.high?.toFixed(2)} />
          <QF label="Low" value={q.low?.toFixed(2)} />
          <QF label="Prev close" value={q.prevClose?.toFixed(2)} />
          <QF label="Volume" value={q.volume != null ? Math.round(q.volume).toLocaleString('en-IN') : '—'} />
          <QF label="Bid" value={q.bid != null ? q.bid.toFixed(2) : '—'} />
          <QF label="Ask" value={q.ask != null ? q.ask.toFixed(2) : '—'} />
          <QF label="Market" value={q.feed?.marketOpen ? 'OPEN' : 'CLOSED'} tone={q.feed?.marketOpen ? 1 : -1} />
        </div>
      ) : null}

      {notice ? (
        <div data-testid="terminal-notice" className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border ${notice.kind === 'error' ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
          <Icon name={notice.kind === 'error' ? 'alert' : 'check'} className="h-4 w-4" />
          {notice.text}
        </div>
      ) : null}

      {/* ── workspace grid ─────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_290px]">
        <div className="lg:h-[560px] h-[320px]">
          <Watchlist instruments={instruments} active={symbol} onSelect={(s) => { setSymbol(s); setBump((b) => b + 1); }} />
        </div>
        <div className="min-w-0">
          <div ref={tvHostRef} data-testid="tv-chart-host" className={tvMounted ? 'rounded-2xl overflow-hidden border border-slate-200' : 'hidden'} style={tvMounted ? { height: 420 } : undefined} />
          {!tvMounted ? <ChartPro symbol={symbol} name={current?.name} feed={q?.feed} inst={current} height={420} /> : null}
          <p className="mt-1.5 text-[10.5px] text-slate-400">
            Prices and candles stream from the same provider facade.{' '}
            {q?.feed?.latency === 'live' ? 'Live provider feed.' : q?.feed?.latency === 'delayed' ? 'Delayed provider reference.' : 'Simulated paper-venue prices — not real quotes.'}{' '}
            <a className="underline hover:text-slate-600" href={tvChartHref} target="_blank" rel="noreferrer noopener">Open the full TradingView chart</a> for the real exchange listing.{' '}
            <span data-testid="tv-lib-note">{typeof window !== 'undefined' && window.TradingView?.widget
              ? 'Official Charting Library detected — mounted on the same backend datafeed.'
              : 'TradingView Charting Library not bundled here; this built-in chart renders the same backend datafeed (UDF + WS) and is drop-in ready for the licensed library.'}</span>
          </p>
        </div>
        <OrderPanel symbol={symbol} inst={current} price={q?.price} onDone={(msg, kind) => { setNotice({ text: msg, kind: kind || 'ok' }); setBump((b) => b + 1); }} />
      </div>

      {/* ── bottom tabs ────────────────────────────────────────── */}
      <BottomPanel tab={tab} setTab={setTab} positions={positions} orders={orders} closed={closed} portfolio={portfolio} bump={() => setBump((b) => b + 1)} />
    </div>
  );
}

/* Four-state honesty indicator (spec): LIVE only while the backend is
 * actually receiving provider ticks. */
function stateOf(q, provider) {
  const lat = q?.feed?.latency;
  if (lat === 'live') return 'live';
  if (lat === 'delayed') return 'delayed';
  if (lat === 'closed') return 'closed';
  if (lat === 'error') return 'error';
  return provider?.state === 'live' ? 'live' : provider?.state === 'market_closed' ? 'closed' : provider?.state === 'error' ? 'error' : provider?.state === 'unconfigured' ? 'paper' : 'paper';
}
const STATE_STYLE = {
  live: 'bg-emerald-500/15 text-emerald-600',
  delayed: 'bg-amber-500/15 text-amber-600',
  closed: 'bg-slate-500/10 text-slate-500',
  error: 'bg-rose-500/15 text-rose-600',
  paper: 'bg-slate-500/10 text-slate-500',
};
const STATE_TEXT = {
  live: '● LIVE',
  delayed: '● DELAYED',
  closed: '● MARKET CLOSED',
  error: '● CONNECTION ERROR',
  paper: 'PAPER VENUE · PROVIDER OFF',
};

const QF = ({ label, value, tone, strong }) => (
  <div className="min-w-0">
    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 truncate">{label}</p>
    <p className={`text-[12px] font-bold tabular-nums truncate ${strong ? '' : tone != null ? (Number(tone) >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-700'}`}>{value ?? '—'}</p>
  </div>
);

/* ── order panel ───────────────────────────────────────────────── */
function OrderPanel({ symbol, inst, price, onDone }) {
  const [side, setSide] = useState('buy');
  const [type, setType] = useState('market');
  const [qty, setQty] = useState('1');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (price) {
      setType((t) => t); // keep user's choice
      setLimitPrice((v) => v || price.toFixed(2));
      setStopPrice((v) => v || price.toFixed(2));
    }
  }, [price, symbol]);

  const notional = (Number(qty) || 0) * (type === 'market' ? (price || 0) : Number(type === 'limit' ? limitPrice : stopPrice) || 0);

  const submit = async () => {
    if (!symbol) { onDone('Pick a symbol first.', 'error'); return; }
    const qn = Number(qty);
    if (!Number.isFinite(qn) || qn <= 0) { onDone('Quantity must be a positive number.', 'error'); return; }
    if (inst?.lot && qn % inst.lot !== 0) { onDone(`${symbol} trades in lots of ${inst.lot}.`, 'error'); return; }
    const body = { symbol, side, qty: qn, orderType: type };
    if (type === 'limit') body.limitPrice = Number(limitPrice);
    if (type === 'stop') body.stopPrice = Number(stopPrice);
    if (stopLoss) body.stopLoss = Number(stopLoss);
    if (target) body.target = Number(target);
    setBusy(true);
    try {
      const r = await Trade.order(body);
      onDone(r.pending ? `Resting ${type} order placed — fills when price crosses ${type === 'limit' ? limitPrice : stopPrice}.` : `${side.toUpperCase()} ${qn} ${symbol} filled @ ${r.currency === 'USD' ? '$' : '₹'}${Number(r.fillPrice).toFixed(2)} (paper${r.priceSource === 'live' ? ' · real price' : ''}).`);
    } catch (e) {
      onDone(e?.message || 'Order rejected.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const inp = 'w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-blue-500 tabular-nums';

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden h-full">
      <div className="px-3 py-2 bg-slate-900 text-white">
        <p className="text-xs font-bold">Order ticket</p>
        <p className="text-[9.5px] text-amber-300 font-semibold tracking-wide" data-testid="paper-banner">PAPER TRADING — NO REAL MONEY</p>
      </div>
      <div className="p-3 space-y-2.5 flex-1">
        <div className="grid grid-cols-2 gap-1.5" data-testid="side-toggle">
          <button type="button" data-testid="side-buy" onClick={() => setSide('buy')}
            className={`py-2 rounded-lg text-sm font-bold transition ${side === 'buy' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>BUY</button>
          <button type="button" data-testid="side-sell" onClick={() => setSide('sell')}
            className={`py-2 rounded-lg text-sm font-bold transition ${side === 'sell' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>SELL</button>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Order type</label>
          <select data-testid="order-type" value={type} onChange={(e) => setType(e.target.value)} className={inp}>
            <option value="market">Market — fills at current paper price</option>
            <option value="limit">Limit — rests until your price</option>
            <option value="stop">Stop — triggers at your price</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Quantity</label>
            <input data-testid="order-qty" type="number" min="1" step={inst?.lot || 1} value={qty} onChange={(e) => setQty(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Last price</label>
            <input disabled value={price ? price.toFixed(2) : '…'} className={`${inp} bg-slate-50 text-slate-500`} />
          </div>
        </div>

        {type === 'limit' ? (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Limit price</label>
            <input data-testid="order-limit" type="number" min="0" step="0.05" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} className={inp} />
          </div>
        ) : null}
        {type === 'stop' ? (
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Trigger price</label>
            <input data-testid="order-stop" type="number" min="0" step="0.05" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} className={inp} />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Stop loss</label>
            <input data-testid="order-sl" type="number" min="0" step="0.05" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className={inp} placeholder="optional" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Target</label>
            <input data-testid="order-target" type="number" min="0" step="0.05" value={target} onChange={(e) => setTarget(e.target.value)} className={inp} placeholder="optional" />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
          <span>Est. notional</span>
          <span className="font-bold tabular-nums text-slate-700">{inr(notional)}</span>
        </div>

        <button type="button" data-testid="place-order" onClick={submit} disabled={busy}
          className={`w-full py-2.5 rounded-xl text-sm font-bold text-white transition disabled:opacity-50 ${side === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}>
          {busy ? 'Placing…' : `${side === 'buy' ? 'BUY' : 'SELL'} ${symbol || ''} · paper`}
        </button>
        <p className="text-[9.5px] text-slate-400 leading-snug">
          Virtual cash only. Orders never leave this app — no broker, no exchange, no real money. Margin and fills follow the paper venue rules.
        </p>
      </div>
    </div>
  );
}

/* ── bottom tabs ───────────────────────────────────────────────── */
const TABS = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Orders' },
  { id: 'history', label: 'Trade history' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'pnl', label: 'P&L' },
];

function BottomPanel({ tab, setTab, positions, orders, closed, portfolio, bump }) {
  const pos = positions.data?.positions || [];
  const ord = orders.data?.orders || [];
  const cls = closed.data?.positions || [];
  const pf = portfolio.data;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-slate-100 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} type="button" data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-bold rounded-t-lg transition whitespace-nowrap ${tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            {t.label}
            {t.id === 'positions' && pos.length ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 text-[9px]">{pos.length}</span> : null}
            {t.id === 'orders' && ord.filter((o) => o.status === 'pending').length ? <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 text-[9px]">{ord.filter((o) => o.status === 'pending').length} resting</span> : null}
          </button>
        ))}
      </div>

      <div className="p-3 max-h-72 overflow-y-auto">
        {tab === 'positions' ? (
          pos.length === 0 ? <Empty text="No open positions. Place a paper order to see one here." /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-400 text-[10px] uppercase tracking-wide">
                <th className="py-1.5">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">LTP</th><th className="text-right">P&L</th><th className="text-right">P&L %</th><th />
              </tr></thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-t border-slate-50" data-testid={`pos-row-${p.symbol}`}>
                    <td className="py-2 font-bold">{p.symbol}</td>
                    <td><span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${p.side === 'long' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>{p.side.toUpperCase()}</span></td>
                    <td className="text-right tabular-nums">{p.qty}</td>
                    <td className="text-right tabular-nums">{Number(p.entryPrice).toFixed(2)}</td>
                    <td className="text-right tabular-nums">{Number(p.currentPrice).toFixed(2)}</td>
                    <td className={`text-right font-bold tabular-nums ${Number(p.unrealizedPnl) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{inr(p.unrealizedPnl)}</td>
                    <td className={`text-right tabular-nums ${Number(p.unrealizedPct ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{Number(p.unrealizedPct ?? 0).toFixed(2)}%</td>
                    <td className="text-right">
                      <button type="button" data-testid={`close-${p.symbol}`}
                        onClick={async () => { try { await Trade.close(p.id); bump(); } catch { /* surfaced by polling */ } }}
                        className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-700">Close</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}

        {tab === 'orders' ? (
          ord.length === 0 ? <Empty text="No orders yet." /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-400 text-[10px] uppercase tracking-wide">
                <th className="py-1.5">Time</th><th>Symbol</th><th>Type</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Price</th><th>Status</th><th />
              </tr></thead>
              <tbody>
                {ord.slice(0, 40).map((o) => (
                  <tr key={o.id} className="border-t border-slate-50" data-testid={`order-row`}>
                    <td className="py-2 text-slate-500">{new Date(o.createdAt || o.created_at).toLocaleString('en-IN', { hour12: false })}</td>
                    <td className="font-bold">{o.symbol}</td>
                    <td className="uppercase">{o.orderType || o.order_type}</td>
                    <td className={o.side === 'buy' ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{o.side.toUpperCase()}</td>
                    <td className="text-right tabular-nums">{o.qty}</td>
                    <td className="text-right tabular-nums">{Number(o.filledPrice || o.filled_price || o.limitPrice || o.limit_price || o.stopPrice || o.stop_price || 0).toFixed(2)}</td>
                    <td><StatusChip status={o.status} /></td>
                    <td className="text-right">
                      {o.status === 'pending' ? (
                        <button type="button" data-testid={`cancel-${o.id}`}
                          onClick={async () => { try { await Trade.cancelOrder(o.id); bump(); } catch { /* surfaced by polling */ } }}
                          className="px-2 py-1 rounded-lg border border-slate-300 text-[10px] font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}

        {tab === 'history' ? (
          cls.length === 0 && !ord.some((o) => o.status === 'filled') ? <Empty text="No completed trades yet — history builds as paper orders fill and close." /> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-400 text-[10px] uppercase tracking-wide">
                <th className="py-1.5">Closed</th><th>Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Entry</th><th className="text-right">Exit</th><th className="text-right">Realized P&L</th><th>Reason</th>
              </tr></thead>
              <tbody>
                {cls.slice(0, 40).map((p) => (
                  <tr key={p.id} className="border-t border-slate-50">
                    <td className="py-2 text-slate-500">{p.closedAt ? new Date(p.closedAt).toLocaleString('en-IN', { hour12: false }) : '—'}</td>
                    <td className="font-bold">{p.symbol}</td>
                    <td className={p.side === 'long' ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{p.side.toUpperCase()}</td>
                    <td className="text-right tabular-nums">{p.qty}</td>
                    <td className="text-right tabular-nums">{Number(p.entryPrice).toFixed(2)}</td>
                    <td className="text-right tabular-nums">{Number(p.exitPrice ?? p.currentPrice).toFixed(2)}</td>
                    <td className={`text-right font-bold tabular-nums ${Number(p.pnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{inr(p.pnl)}</td>
                    <td className="text-slate-500">{p.exitReason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : null}

        {tab === 'portfolio' ? !pf ? <Empty text="Loading portfolio…" /> : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            <Stat label="Simulated cash" value={inr(pf.cash)} />
            <Stat label="Invested (margin)" value={inr(pf.invested)} />
            <Stat label="Portfolio value" value={inr(pf.equity)} />
            <Stat label="Today's realized" value={inr(pf.dayPnl)} tone={Number(pf.dayPnl)} />
            <Stat label="Total P&L" value={`${Number(pf.realizedPnl ?? 0) >= 0 ? '+' : ''}${inr(pf.realizedPnl)} realized`} sub={`${Number(pf.unrealizedPnl ?? 0) >= 0 ? '+' : ''}${inr(pf.unrealizedPnl)} unrealized`} tone={Number(pf.realizedPnl ?? 0) + Number(pf.unrealizedPnl ?? 0)} />
          </div>
        ) : null}

        {tab === 'pnl' ? !pf ? <Empty text="Loading P&L…" /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Stat label="Realized P&L" value={inr(pf.realizedPnl)} tone={Number(pf.realizedPnl)} />
            <Stat label="Unrealized P&L" value={inr(pf.unrealizedPnl)} tone={Number(pf.unrealizedPnl)} />
            <Stat label="Win rate" value={`${Number(pf.winRate ?? 0)}%`} sub={`${pf.closedTrades ?? 0} closed trades`} />
            <Stat label="Closed trades" value={String(pf.closedTrades ?? cls.length ?? 0)} />
            {(pf.equityCurve || []).length > 1 ? (
              <div className="col-span-2 md:col-span-4">
                <EquityStrip curve={pf.equityCurve} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const Stat = ({ label, value, sub, tone }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-sm font-bold tabular-nums ${tone != null ? (Number(tone) >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-800'}`}>{value}</p>
    {sub ? <p className="text-[10px] text-slate-500 tabular-nums">{sub}</p> : null}
  </div>
);

const Empty = ({ text }) => <p className="text-xs text-slate-400 py-6 text-center">{text}</p>;

const StatusChip = ({ status }) => {
  const map = {
    filled: 'bg-emerald-500/10 text-emerald-600',
    pending: 'bg-amber-500/15 text-amber-600',
    rejected: 'bg-rose-500/10 text-rose-600',
    cancelled: 'bg-slate-500/10 text-slate-500',
  };
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${map[status] || 'bg-slate-500/10 text-slate-500'}`}>{status}</span>;
};

function EquityStrip({ curve }) {
  const pts = curve.slice(-60);
  const min = Math.min(...pts.map((p) => Number(p.equity)));
  const max = Math.max(...pts.map((p) => Number(p.equity)));
  const w = 600; const h = 54;
  const path = pts.map((p, i) => `${(i / Math.max(1, pts.length - 1)) * w},${h - ((Number(p.equity) - min) / Math.max(1, max - min)) * (h - 6) - 3}`).join(' ');
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Equity curve (daily realized)</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        <polyline points={path} fill="none" stroke="#2563eb" strokeWidth="2" />
      </svg>
    </div>
  );
}

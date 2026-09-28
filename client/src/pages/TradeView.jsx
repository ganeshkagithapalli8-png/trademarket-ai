import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useFunds } from '../context/FundsContext.jsx';
import {
  Card, Badge, Icon, Button, Tabs, Input, Select, Alert, Modal, Spinner,
  SectionTitle, Skeleton, Confirm, usePoll, Flash,
} from '../components/ui.jsx';
import { CandleChart } from '../components/Chart.jsx';
import { TVChart, tvSymbol, tvNote } from '../components/TradingView.jsx';
import { Market, Trade, Bot, Content, AI, Wallet } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { money, pct, n, compact, signed, renderMarkdown, timeAgo, qtyStr } from '../lib/format.js';

const INTERVALS = [
  { id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '1h', label: '1H' }, { id: '1D', label: '1D' },
];

const MARGIN_FACTOR = { stocks: 1, ipo: 1, crypto: 1, fno: 0.2, forex: 0.1 };

export default function TradeView() {
  const { symbol } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user, refreshWallet } = useAuth();

  const [interval, setInterval] = useState('15m');
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState('');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [target, setTarget] = useState('');
  const [autoRisk, setAutoRisk] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [closing, setClosing] = useState(null);
  const { openAddFunds } = useFunds();
  const [showReal, setShowReal] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [watched, setWatched] = useState(false);

  const { data: quote, refresh: refreshQuote } = usePoll(() => Market.quote(symbol), 4000, [symbol]);
  const { data: candleData, loading: cLoading } = usePoll(() => Market.candles(symbol, interval, 140), 30000, [symbol, interval]);
  const { data: analysis } = usePoll(() => Bot.analyse(symbol, interval).catch(() => null), 30000, [symbol, interval]);
  const { data: positions, refresh: refreshPositions } = usePoll(() => Trade.positions('open'), 20000, [symbol]);
  const { data: wl, refresh: refreshWl } = usePoll(() => Content.watchlist(), 120000, [symbol]);
  const { data: wallet } = usePoll(() => Wallet.get(), 60000, []);

  const q = quote?.quote;
  const candles = candleData?.candles || [];
  const ind = analysis?.indicators;
  const lot = q?.lot || 1;
  const price = q?.price || 0;

  useEffect(() => {
    setWatched(Boolean(wl?.watchlist?.some((w) => w.symbol === symbol)));
  }, [wl, symbol]);

  // Sensible defaults when the instrument changes.
  const qtyEdited = useRef(false);
  useEffect(() => {
    if (!q) return;
    qtyEdited.current = false;
    setQty(String(lot));
    setLimitPrice(String(q.price));
    setSide('buy');
    setOrderType('market');
  }, [symbol, q?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill stop/target from ATR so a beginner always has a defined exit.
  useEffect(() => {
    if (!autoRisk || !ind?.atr || !price) return;
    const d = ind.atr * 1.5;
    setStopLoss((price - (side === 'buy' ? d : -d)).toFixed(q?.decimals ?? 2));
    setTarget((price + (side === 'buy' ? d * 2 : -d * 2)).toFixed(q?.decimals ?? 2));
  }, [autoRisk, ind?.atr, price, side, q?.decimals]); // eslint-disable-line react-hooks/exhaustive-deps

  const held = (positions?.positions || []).find((p) => p.symbol === symbol);
  const qtyNum = Math.max(0, Math.floor(Number(qty || 0) / lot) * lot);
  const notional = qtyNum * price;
  const factor = MARGIN_FACTOR[q?.market] ?? 1;
  const margin = notional * factor;
  const riskPct = user?.riskPerTrade ?? 1;
  const stopNum = Number(stopLoss) || 0;
  const riskPerUnit = stopNum > 0 ? Math.abs(price - stopNum) : 0;
  const riskAmount = riskPerUnit * qtyNum;
  const reward = Number(target) > 0 ? Math.abs(Number(target) - price) * qtyNum : 0;
  const rr = riskAmount > 0 ? reward / riskAmount : 0;

  const suggestedQty = useMemo(() => {
    if (!ind?.atr || !price) return 0;
    const dist = ind.atr * 1.5;
    const eq = (wallet?.wallet?.simBalance ?? 0);
    return Math.max(0, Math.floor(((eq * riskPct) / 100) / dist / lot) * lot);
  }, [ind?.atr, price, wallet, riskPct, lot]);

  // Then upgrade to the risk-based size once ATR and the wallet are known.
  // One lot of RELIANCE is a 0.3% position on a ₹5L account — too small to
  // teach anything. The whole point of this app is sizing from risk, so the
  // sensible quantity should already be in the box. Overwritten the moment the
  // trader types or taps a multiplier.
  useEffect(() => {
    if (qtyEdited.current || suggestedQty <= 0) return;
    setQty(String(suggestedQty));
  }, [suggestedQty]);

  const levels = useMemo(() => {
    if (!ind) return [];
    const out = [
      { label: 'RESISTANCE', value: ind.resistance, color: '#F43F5E' },
      { label: 'SUPPORT', value: ind.support, color: '#10B981' },
      { label: 'SMA 50', value: ind.sma50, color: '#94A3B8' },
    ];
    if (held) {
      out.push({ label: `ENTRY ${held.side.toUpperCase()}`, value: held.entryPrice, color: '#3B6DF6' });
      if (held.stopLoss) out.push({ label: 'STOP', value: held.stopLoss, color: '#F59E0B' });
      if (held.target) out.push({ label: 'TARGET', value: held.target, color: '#8B5CF6' });
    }
    return out;
  }, [ind, held]);

  const toggleWatch = async () => {
    try {
      if (watched) {
        const item = wl.watchlist.find((w) => w.symbol === symbol);
        await Content.removeWatch(item.id);
        toast.info('Removed from watchlist', symbol);
      } else {
        await Content.addWatch({ symbol });
        toast.success('Added to watchlist', symbol);
      }
      setWatched((v) => !v);
      refreshWl();
    } catch (e) {
      toast.error('Could not update watchlist', e.message);
    }
  };

  const place = async () => {
    if (qtyNum <= 0) return toast.error('Enter a quantity', `The lot size for ${symbol} is ${lot}.`);
    const cash = wallet?.wallet?.simBalance ?? 0;
    if (margin > cash) {
      return toast.error('Not enough simulated cash', `Needs ${money(margin)}; you have ${money(cash)}. Add funds in Wallet.`);
    }
    setPlacing(true);
    try {
      const r = await Trade.order({
        symbol, side, qty: qtyNum, orderType,
        limitPrice: orderType === 'limit' ? Number(limitPrice) : undefined,
        stopLoss: stopNum > 0 ? stopNum : undefined,
        target: Number(target) > 0 ? Number(target) : undefined,
      });
      toast.success(
        `${side === 'buy' ? 'Bought' : 'Sold'} ${qtyStr(qtyNum)} ${symbol}`,
        `Paper fill at ${money(r.fillPrice)} · margin ${money(r.margin)} held.`
      );
      qtyEdited.current = false;
      setQty(String(suggestedQty || lot));
      refreshPositions();
      refreshQuote();
      refreshWallet();
    } catch (e) {
      toast.error('Order rejected', e.message);
    } finally {
      setPlacing(false);
    }
  };

  const doClose = async () => {
    if (!closing) return;
    try {
      const r = await Trade.close(closing.id);
      toast.success('Position closed', `Realised ${signed(r.pnl)} at ${money(r.exitPrice)}.`);
      setClosing(null);
      refreshPositions();
      refreshWallet();
    } catch (e) {
      toast.error('Could not close', e.message);
      setClosing(null);
    }
  };

  const askAI = async () => {
    setAiOpen(true);
    setAiBusy(true);
    setAiText('');
    try {
      const r = await AI.generate({
        mode: 'analyse',
        prompt: `Read the current technical picture for ${symbol} on the ${interval} timeframe. Describe trend, momentum, volatility and the distance to support and resistance. Say what would invalidate each reading. Do not tell me what to buy or sell.`,
        refs: { symbol },
      });
      setAiText(r.text);
    } catch (e) {
      setAiText('');
      toast.error('AI unavailable', e.message);
      setAiOpen(false);
    } finally {
      setAiBusy(false);
    }
  };

  if (!q && !quote) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Card className="h-[300px]"><Skeleton className="h-full w-full" /></Card>
      </div>
    );
  }

  if (!q) {
    return (
      <Card pad={false}>
        <Alert tone="danger" title="Unknown instrument">
          “{symbol}” is not in the simulator universe.{' '}
          <Link to="/app/markets" className="font-bold underline underline-offset-2">Browse markets →</Link>
        </Alert>
      </Card>
    );
  }

  const up = (q.changePct ?? 0) >= 0;

  return (
    <div className="space-y-5">
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 transition hover:text-slate-800">
        <Icon name="arrowRight" className="h-3.5 w-3.5 rotate-180" /> Back
      </button>

      {/* ── header ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900 sm:text-[26px]">{q.symbol}</h1>
              {q.source === 'live' && <Badge tone="up" icon="zap">Live ref</Badge>}
              {q.source === 'simulated' && <Badge tone="neutral">Simulated</Badge>}
              <button
                onClick={toggleWatch}
                className={`grid h-8 w-8 place-items-center rounded-lg border transition active:scale-95 ${
                  watched ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-slate-200 text-slate-400 hover:text-slate-600'
                }`}
                aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                <Icon name="star" className="h-4 w-4" stroke={watched ? 0 : 1.9} fill={watched ? 'currentColor' : 'none'} />
              </button>
            </div>
            <p className="mt-0.5 text-[13px] text-slate-500">{q.name} · {q.sector}</p>
            <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
              <p className="tnum text-[28px] font-extrabold leading-none text-slate-900 sm:text-[34px]">
                <Flash value={q.price}>{money(q.price, q.price < 10 ? 4 : q.decimals ?? 2)}</Flash>
              </p>
              <p className={`tnum flex items-center gap-1 text-[14px] font-bold ${up ? 'text-up-deep' : 'text-down-deep'}`}>
                <Icon name={up ? 'arrowUp' : 'arrowDown'} className="h-4 w-4" stroke={2.6} />
                {signed(q.change, q.price < 10 ? 4 : 2)} ({pct(q.changePct)})
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-right sm:grid-cols-4 lg:text-right">
            {[
              { l: 'Open', v: money(q.open, q.price < 10 ? 4 : 2) },
              { l: 'Prev close', v: money(q.prevClose, q.price < 10 ? 4 : 2) },
              { l: 'Day high', v: money(q.high, q.price < 10 ? 4 : 2), tone: 'up' },
              { l: 'Day low', v: money(q.low, q.price < 10 ? 4 : 2), tone: 'down' },
            ].map((s) => (
              <div key={s.l}>
                <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                <p className={`tnum mt-0.5 text-[13px] font-bold ${s.tone === 'up' ? 'text-up-deep' : s.tone === 'down' ? 'text-down-deep' : 'text-slate-800'}`}>{s.v}</p>
              </div>
            ))}
          </div>
        </div>

        {lot > 1 && (
          <p className="mt-3.5 rounded-xl bg-slate-50 px-3 py-2 text-[11.5px] leading-snug text-slate-600">
            <span className="font-bold">Lot size {lot}.</span> Quantity is rounded down to a multiple of {lot}.
            {q.market === 'fno' && ' Margin is 20% of notional (5× leverage) — losses scale the same way.'}
            {q.market === 'forex' && ' Margin is 10% of notional (10× leverage).'}
          </p>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* ── chart ────────────────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" /> Real market chart
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  TradingView · {tvSymbol(q)} · 15m · read-only. {tvNote(q)}
                </p>
              </div>
              <Button size="xs" variant="ghost" icon={showReal ? 'x' : 'zap'} onClick={() => setShowReal((v) => !v)}>
                {showReal ? 'Hide' : 'Show'}
              </Button>
            </div>
            {showReal ? <TVChart inst={q} /> : null}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Tabs tabs={INTERVALS} value={interval} onChange={setInterval} scrollable={false} className="w-auto" />
              <span className="flex items-center gap-2">
                <Badge tone="neutral">Paper candles</Badge>
                <Button size="xs" variant="soft" icon="spark" onClick={askAI}>Explain this chart</Button>
              </span>
            </div>
            {cLoading && !candles.length ? (
              <div className="grid h-[300px] place-items-center"><Spinner className="h-6 w-6 text-brand-500" /></div>
            ) : (
              <CandleChart candles={candles} height={320} levels={levels} />
            )}
            {analysis?.patterns?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {analysis.patterns.map((p) => <Badge key={p} tone="brand">{p}</Badge>)}
              </div>
            )}
          </Card>

          {ind && (
            <Card>
              <SectionTitle icon="target" title="Indicators" subtitle={`${interval} timeframe · computed server-side`} />
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  { l: 'RSI (14)', v: n(ind.rsi, 1), tone: ind.rsi > 70 ? 'down' : ind.rsi < 30 ? 'up' : 'flat', note: ind.rsi > 70 ? 'Overbought' : ind.rsi < 30 ? 'Oversold' : 'Neutral' },
                  { l: 'EMA 9 / 21', v: `${compact(ind.ema9)} / ${compact(ind.ema21)}`, tone: ind.trend === 'up' ? 'up' : 'down', note: ind.trend === 'up' ? 'Bullish cross' : 'Bearish cross' },
                  { l: 'ATR (14)', v: compact(ind.atr), note: `${n(ind.atrPct, 2)}% of price` },
                  { l: 'SMA 50', v: compact(ind.sma50), tone: ind.price > ind.sma50 ? 'up' : 'down', note: ind.price > ind.sma50 ? 'Price above' : 'Price below' },
                  { l: 'Support', v: compact(ind.support), tone: 'up' },
                  { l: 'Resistance', v: compact(ind.resistance), tone: 'down' },
                  { l: '5-bar return', v: pct(ind.ret5), tone: ind.ret5 >= 0 ? 'up' : 'down' },
                  { l: '20-bar return', v: ind.ret20 == null ? '—' : pct(ind.ret20), tone: (ind.ret20 ?? 0) >= 0 ? 'up' : 'down' },
                ].map((s) => (
                  <div key={s.l} className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                    <p className={`tnum mt-1 text-[14px] font-bold ${s.tone === 'up' ? 'text-up-deep' : s.tone === 'down' ? 'text-down-deep' : 'text-slate-900'}`}>{s.v}</p>
                    {s.note && <p className="mt-0.5 text-[10.5px] font-medium text-slate-500">{s.note}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── order ticket ─────────────────────────────────── */}
        <div className="space-y-5">
          {held && (
            <Card className="border-brand-200 bg-gradient-to-br from-brand-50/70 to-white">
              <SectionTitle icon="layers" title="Your open position" subtitle={`Opened by ${held.openedBy} · ${timeAgo(held.openedAt)}`} />
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { l: 'Side', v: held.side.toUpperCase(), tone: held.side === 'long' ? 'up' : 'down' },
                  { l: 'Qty', v: qtyStr(held.qty) },
                  { l: 'Entry', v: money(held.entryPrice) },
                  { l: 'Mark', v: money(held.currentPrice) },
                  { l: 'Stop', v: held.stopLoss ? money(held.stopLoss) : 'None set' },
                  { l: 'Target', v: held.target ? money(held.target) : 'None set' },
                ].map((s) => (
                  <div key={s.l}>
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{s.l}</p>
                    <p className={`tnum mt-0.5 text-[13.5px] font-bold ${s.tone === 'up' ? 'text-up-deep' : s.tone === 'down' ? 'text-down-deep' : 'text-slate-900'}`}>{s.v}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-slate-200">
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">Unrealised</p>
                  <p className={`tnum text-[16px] font-extrabold ${held.unrealizedPnl >= 0 ? 'text-up-deep' : 'text-down-deep'}`}>
                    {signed(held.unrealizedPnl)} <span className="text-[12px] font-bold">({pct(held.unrealizedPct)})</span>
                  </p>
                </div>
                <Button data-testid="close-position" variant="danger" size="sm" icon="x" onClick={() => setClosing(held)}>Close</Button>
              </div>
            </Card>
          )}

          <Card>
            <SectionTitle icon="zap" title="Paper order" subtitle="Simulated fill with 3 bps of adverse slippage" />

            <div className="mb-3.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/90 p-1">
              {[{ id: 'buy', l: 'Buy / Long', i: 'arrowUp' }, { id: 'sell', l: 'Sell / Short', i: 'arrowDown' }].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSide(s.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13.5px] font-bold transition-all ${
                    side === s.id
                      ? s.id === 'buy' ? 'bg-up text-white shadow-sm' : 'bg-down text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon name={s.i} className="h-3.5 w-3.5" stroke={2.6} /> {s.l}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label mb-0">Quantity {lot > 1 && <span className="font-normal text-slate-400">(lot {lot})</span>}</span>
                  {suggestedQty > 0 && (
                    <button onClick={() => { qtyEdited.current = true; setQty(String(suggestedQty)); }} className="text-[11px] font-bold text-brand-600 hover:text-brand-700">
                      Risk-based: {qtyStr(suggestedQty)}
                    </button>
                  )}
                </div>
                <Input
                  type="number" min={lot} step={lot} value={qty}
                  onChange={(e) => { qtyEdited.current = true; setQty(e.target.value); }}
                  inputMode="decimal"
                  hint={qtyNum !== Number(qty || 0) ? `Rounded to ${qtyStr(qtyNum)} to match the lot size.` : undefined}
                />
                <div className="mt-2 flex gap-1.5">
                  {[1, 5, 25, 100].map((m) => (
                    <button
                      key={m}
                      onClick={() => { qtyEdited.current = true; setQty(String(lot * m)); }}
                      className="flex-1 rounded-lg bg-slate-100 py-1.5 text-[11.5px] font-bold text-slate-600 transition hover:bg-slate-200 active:scale-95"
                    >
                      {lot * m >= 1000 ? compact(lot * m) : lot * m}
                    </button>
                  ))}
                </div>
              </div>

              <Select
                label="Order type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
                options={[{ value: 'market', label: 'Market — fill now at the simulated price' }, { value: 'limit', label: 'Limit — only if marketable' }]}
              />

              {orderType === 'limit' && (
                <Input label="Limit price" type="number" step="any" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal"
                  hint="A limit that would not fill immediately is rejected rather than left resting — this simulator has no order book." />
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <Input label="Stop loss" type="number" step="any" value={stopLoss} onChange={(e) => { setStopLoss(e.target.value); setAutoRisk(false); }} inputMode="decimal"
                  error={stopNum > 0 && ((side === 'buy' && stopNum >= price) || (side === 'sell' && stopNum <= price)) ? 'Must be on the correct side of entry' : undefined} />
                <Input label="Target" type="number" step="any" value={target} onChange={(e) => { setTarget(e.target.value); setAutoRisk(false); }} inputMode="decimal" />
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                <input type="checkbox" checked={autoRisk} onChange={(e) => setAutoRisk(e.target.checked)} className="h-4 w-4 accent-brand-600" />
                <span className="text-[12px] font-semibold text-slate-600">Auto-set stop at 1.5 × ATR and target at 2 × that</span>
              </label>

              {/* ticket maths */}
              <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                {[
                  { l: 'Notional', v: money(notional) },
                  { l: q.market === 'stocks' || q.market === 'ipo' || q.market === 'crypto' ? 'Cash required' : `Margin (${Math.round(factor * 100)}%)`, v: money(margin) },
                  { l: 'Available', v: money(wallet?.wallet?.simBalance ?? 0), tone: margin > (wallet?.wallet?.simBalance ?? 0) ? 'down' : 'flat' },
                  { l: 'At risk if stopped', v: riskAmount > 0 ? money(riskAmount) : '—', tone: 'down' },
                  { l: 'Reward : risk', v: rr > 0 ? `${rr.toFixed(2)} : 1` : '—', tone: rr >= 2 ? 'up' : rr > 0 ? 'flat' : 'flat' },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-slate-500">{r.l}</span>
                    <span className={`tnum font-bold ${r.tone === 'down' ? 'text-down-deep' : r.tone === 'up' ? 'text-up-deep' : 'text-slate-900'}`}>{r.v}</span>
                  </div>
                ))}
              </div>

              {riskAmount > 0 && riskAmount > ((wallet?.wallet?.simBalance ?? 0) * riskPct) / 100 * 1.05 && (
                <Alert tone="warn">
                  This risks {money(riskAmount)} — more than your {riskPct}% per-trade budget of{' '}
                  {money(((wallet?.wallet?.simBalance ?? 0) * riskPct) / 100)}. Use the risk-based quantity instead.
                </Alert>
              )}

              {qtyNum > 0 && margin > (wallet?.wallet?.simBalance ?? 0) && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                  <p className="min-w-0 text-[11.5px] font-semibold leading-snug text-amber-800">
                    This size needs {money(margin - (wallet?.wallet?.simBalance ?? 0), 0)} more simulated cash.
                  </p>
                  <Button
                    size="xs" variant="soft" icon="plus" className="shrink-0"
                    onClick={() => openAddFunds(refreshWallet, Math.max(50, Math.ceil((margin - (wallet?.wallet?.simBalance ?? 0)) / 100) * 100))}
                  >
                    Add funds
                  </Button>
                </div>
              )}

              <Button
                data-testid="place-order"
                className="w-full" size="lg" variant={side === 'buy' ? 'success' : 'danger'}
                icon={side === 'buy' ? 'arrowUp' : 'arrowDown'} loading={placing}
                disabled={qtyNum <= 0 || margin > (wallet?.wallet?.simBalance ?? 0) || Boolean(held)}
                onClick={place}
              >
                {held ? 'Close your position first' : margin > (wallet?.wallet?.simBalance ?? 0) ? 'Insufficient simulated cash' : `${side === 'buy' ? 'Buy' : 'Sell'} ${qtyStr(qtyNum)} ${q.symbol}`}
              </Button>

              <p className="text-center text-[10.5px] leading-snug text-slate-400">
                Paper order against simulated liquidity. No real order is sent anywhere, ever.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Confirm
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        onConfirm={doClose}
        title="Close this position?"
        message={`You will realise ${signed(closing?.unrealizedPnl ?? 0)} at roughly ${money(closing?.currentPrice ?? 0)}. The trade is written to the bot's learning memory either way.`}
        confirmLabel="Close position"
        confirmTestId="confirm-close"
        tone="danger"
      />

      <Modal open={aiOpen} onClose={() => setAiOpen(false)} title={`AI reading · ${q.symbol}`} subtitle="Gemini, called from the backend. Education only — never an instruction to trade." size="lg">
        {aiBusy ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <Spinner className="h-6 w-6 text-brand-500" />
            <p className="text-[12.5px] font-semibold text-slate-500">Reading the chart…</p>
          </div>
        ) : (
          <div className="prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiText) }} />
        )}
      </Modal>
    </div>
  );
}

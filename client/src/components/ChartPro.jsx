/**
 * ChartPro — TradingView frontend for the terminal.
 *
 * Two honest modes:
 *  1. ENGINE (default): TradingView Lightweight Charts™ — the open-source
 *     chart engine that powers tradingview.com charts — rendering OUR data
 *     from the provider facade (real Upstox/Finnhub bars, or clearly labelled
 *     paper bars). Candles/line/area/OHLC-bars · volume pane · crosshair with
 *     OHLC legend · zoom/pan native · themes. Live updates arrive from the
 *     same socket ticks as the price display; no reloads, ever.
 *  2. TV WIDGET: the official TradingView Advanced Chart embed for the same
 *     symbol — TradingView's own licensed data and branding in an iframe.
 *     Clearly captioned as a separate feed from this app's paper trading.
 *     (We never pretend the widget grants us API access — it is their chart.)
 *
 * Source-honesty chips (REAL BARS · UPSTOX / REAL BARS · FINNHUB /
 * PAPER BARS · feed limited) stay on the toolbar in both modes.
 */
import { useEffect, useRef, useState } from 'react';
import {
  createChart, ColorType, CrosshairMode,
  CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
} from 'lightweight-charts';
import { Market } from '../lib/api';
import { marketSocket, useSocketStatus } from '../lib/marketSocket';
import { Icon } from './ui.jsx';
import { TVChart, tvSymbol, tvNote } from './TradingView.jsx';

const TYPES = [
  { id: 'candle', label: 'Candles' },
  { id: 'ohlc', label: 'OHLC' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];
const TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'];
const SERIES_FOR = { candle: CandlestickSeries, ohlc: BarSeries, line: LineSeries, area: AreaSeries };
const PAL = {
  light: { bg: '#ffffff', grid: '#eef2f7', axis: '#64748b', up: '#16a34a', down: '#dc2626', line: '#2563eb', volUp: 'rgba(22,163,74,0.45)', volDn: 'rgba(220,38,38,0.45)' },
  dark: { bg: '#0b1020', grid: '#1c2333', axis: '#8fa0b8', up: '#22c55e', down: '#ef4444', line: '#60a5fa', volUp: 'rgba(34,197,94,0.45)', volDn: 'rgba(239,68,68,0.45)' },
};

const US = new Set(['AAPL', 'TSLA', 'NVDA', 'MSFT']);
const TV_INTERVAL = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1D': 'D', '1W': 'W', '1M': 'M' };

export default function ChartPro({ symbol, name, feed, inst, height = 360 }) {
  const [tf, setTf] = useState('5m');
  const [type, setType] = useState('candle');
  const [view, setView] = useState('engine'); // 'engine' | 'tv'
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);
  const [dark, setDark] = useState(false);
  const [showVol, setShowVol] = useState(true);
  const [legend, setLegend] = useState(null);
  const status = useSocketStatus();

  const wrapRef = useRef(null);
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volRef = useRef(null);
  const syncedRef = useRef({ key: null, len: 0, lastT: 0 });
  const candlesRef = useRef([]);
  candlesRef.current = candles;

  const h = height;
  const pal = dark ? PAL.dark : PAL.light;

  /* history load (one fetch per symbol+timeframe change — never per tick).
     Generation-guarded: a slow response for the PREVIOUS symbol (e.g. an
     Upstox 429-cooldown fallback that takes seconds server-side) must never
     land after the switch and overwrite the new symbol's real bars. */
  const genRef = useRef(0);
  const load = () => {
    if (!symbol) return;
    const gen = ++genRef.current;
    setLoading(true); setError(null);
    Market.candlesTf(symbol, tf, 300)
      .then((r) => {
        if (gen !== genRef.current) return; // stale — superseded by a newer load
        setCandles(r.candles || []); setSrc(r.provider || r.candles?.[0]?.provider || null);
      })
      .catch((e) => { if (gen === genRef.current) setError(e?.message || 'Chart data failed to load.'); })
      .finally(() => { if (gen === genRef.current) setLoading(false); });
  };
  useEffect(load, [symbol, tf]); // eslint-disable-line react-hooks/exhaustive-deps

  // REST fallback only while the socket is down; streaming otherwise.
  useEffect(() => {
    if (status === 'live') return undefined;
    const iv = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, symbol, tf]);

  /* live candle merge: same tick source as the price display */
  useEffect(() => {
    if (!symbol) return undefined;
    return marketSocket.subscribeCandle(symbol, tf, (msg) => {
      const c = msg.candle;
      setCandles((prev) => {
        if (!prev.length) return [c];
        const last = prev[prev.length - 1];
        if (c.t === last.t) return [...prev.slice(0, -1), c];
        if (c.t > last.t) {
          const next = [...prev, c];
          return next.length > 600 ? next.slice(next.length - 600) : next;
        }
        return prev;
      });
    });
  }, [symbol, tf]);

  /* ── TradingView Lightweight Charts™ engine ─────────────────────────── */
  useEffect(() => {
    if (view !== 'engine' || !boxRef.current) return undefined;
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: pal.bg },
        textColor: pal.axis,
        fontSize: '11px',
        attributionLogo: true, // TradingView's own logo stays visible — it is their engine
      },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: pal.grid, rightOffset: 4 },
      rightPriceScale: { borderColor: pal.grid },
      localization: { priceFormatter: (p) => p.toFixed(p >= 1000 ? 2 : p >= 1 ? 2 : 4) },
    });
    chartRef.current = chart;
    chart.subscribeCrosshairMove((param) => {
      const s = seriesRef.current;
      const d = param?.seriesData?.get(s);
      if (!param?.point || !d) { setLegend(null); return; }
      setLegend(d.open != null
        ? { o: d.open, h: d.high, l: d.low, c: d.close }
        : { c: d.value ?? d.close, line: true });
    });
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; volRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dark]);

  /* series (re)creation per chart type */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) { try { chart.removeSeries(seriesRef.current); } catch { /* noop */ } }
    if (volRef.current) { try { chart.removeSeries(volRef.current); } catch { /* noop */ } }
    const opts = {
      candle: { upColor: pal.up, downColor: pal.down, wickUpColor: pal.up, wickDownColor: pal.down, borderVisible: false },
      ohlc: { upColor: pal.up, downColor: pal.down, thinBars: false },
      line: { color: pal.line, lineWidth: 2 },
      area: { lineColor: pal.line, lineWidth: 2, topColor: 'rgba(37,99,235,0.35)', bottomColor: 'rgba(37,99,235,0.02)' },
    }[type];
    seriesRef.current = chart.addSeries(SERIES_FOR[type], opts);
    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: 'vol', visible: showVol,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    syncedRef.current = { key: null, len: 0, lastT: 0 }; // force full setData below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, view, dark]);

  /* volume visibility toggle */
  useEffect(() => { volRef.current?.applyOptions({ visible: showVol }); }, [showVol]);

  /* data sync: full set on symbol/tf/shape change, incremental update per tick */
  useEffect(() => {
    const series = seriesRef.current; const vol = volRef.current; const chart = chartRef.current;
    if (!series || !chart) return;
    const key = `${symbol}|${tf}`;
    const bars = candles.map((c) => ({ time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }));
    const vbars = candles.map((c) => ({ time: Math.floor(c.t / 1000), value: c.v || 0, color: c.c >= c.o ? pal.volUp : pal.volDn }));
    const s = syncedRef.current;
    const last = candles[candles.length - 1];
    if (s.key === key && s.len === candles.length && s.lastT === last?.t && bars.length) {
      series.update(bars[bars.length - 1]);
      vol?.update(vbars[vbars.length - 1]);
    } else if (s.key === key && s.len === candles.length - 1 && bars.length && last?.t > s.lastT) {
      series.update(bars[bars.length - 1]);
      vol?.update(vbars[vbars.length - 1]);
      s.len = candles.length; s.lastT = last.t;
    } else {
      series.setData(bars);
      vol?.setData(vbars);
      s.key = key; s.len = candles.length; s.lastT = last?.t || 0;
      chart.timeScale().fitContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, view, type, dark]);

  /* legend falls back to the latest bar when not hovering */
  useEffect(() => {
    const last = candles[candles.length - 1];
    setLegend((cur) => (cur ? cur : last ? { o: last.o, h: last.h, l: last.l, c: last.c } : null));
    if (!last) setLegend(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  /* the official widget view is rendered by <TVChart> below — it owns its
     embed lifecycle, loading/fallback states and honest captions. */

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const btn = (active) => `px-1.5 py-1 rounded font-semibold transition ${active ? (dark ? 'bg-white/15 text-white' : 'bg-slate-900 text-white') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100')}`;
  const last = candles[candles.length - 1];

  return (
    <div ref={wrapRef} data-testid="chartpro" data-engine={view === 'tv' ? 'tradingview-widget' : 'tv-lightweight-charts'}
      data-bars={candles.length} data-type={type} data-volume={showVol ? 'on' : 'off'} data-theme={dark ? 'dark' : 'light'}
      className={`flex flex-col rounded-2xl border overflow-hidden ${dark ? 'border-white/10 bg-[#0b1020] text-slate-200' : 'border-slate-200 bg-white'}`}>
      {/* toolbar */}
      <div className={`flex flex-wrap items-center gap-1.5 px-3 py-2 border-b text-xs ${dark ? 'border-white/10' : 'border-slate-200'}`}>
        <div className="font-semibold mr-1">{symbol || '—'}{name ? <span className={dark ? 'text-slate-400' : 'text-slate-500'}> · {name}</span> : null}</div>
        {feed?.label ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${feed.latency === 'live' ? 'bg-emerald-500/15 text-emerald-600' : feed.latency === 'delayed' ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-500/15 text-slate-500'}`}>{feed.label}</span> : null}
        {src === 'upstox' ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600" data-testid="chart-bars-src" title="Every bar on this chart is real exchange data">REAL BARS · UPSTOX</span>
        ) : src === 'finnhub' ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-600" data-testid="chart-bars-src" title="Every bar was aggregated from real exchange quotes via Finnhub — history builds up live from this server's first real tick">REAL BARS · FINNHUB</span>
        ) : src === 'paper' && (feed?.source === 'upstox' || feed?.source === 'finnhub') ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600" data-testid="chart-bars-src" title="The exchange feed rate-limited this request — simulated bars shown instead, never dressed up as real">PAPER BARS · feed limited</span>
        ) : null}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${status === 'live' ? 'bg-emerald-500/15 text-emerald-600' : status === 'reconnecting' || status === 'connecting' ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-500/15 text-slate-500'}`} data-testid="chart-ws-status">
          {status === 'live' ? 'STREAMING' : status === 'reconnecting' || status === 'connecting' ? 'RECONNECTING…' : 'OFFLINE'}
        </span>
        <div className="flex-1" />
        {TFS.map((t) => (
          <button key={t} type="button" data-testid={`chart-tf-${t}`} onClick={() => setTf(t)}
            className={`px-1.5 py-1 rounded font-semibold transition ${tf === t ? (dark ? 'bg-white/15 text-white' : 'bg-slate-900 text-white') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100')}`}>{t}</button>
        ))}
        <span className={`mx-1 h-4 w-px ${dark ? 'bg-white/10' : 'border-slate-200'}`} />
        {TYPES.map((t) => (
          <button key={t.id} type="button" data-testid={`chart-type-${t.id}`} onClick={() => setType(t.id)}
            className={`px-1.5 py-1 rounded font-semibold transition ${type === t.id ? (dark ? 'bg-white/15 text-white' : 'bg-blue-50 text-blue-700') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100')}`}>{t.label}</button>
        ))}
        <button type="button" data-testid="chart-volume" onClick={() => setShowVol((v) => !v)} title="Volume"
          className={`px-1.5 py-1 rounded transition ${showVol ? (dark ? 'text-white bg-white/10' : 'text-slate-700 bg-slate-100') : (dark ? 'text-slate-500' : 'text-slate-400')}`}><Icon name="layers" className="h-3.5 w-3.5" /></button>
        <button type="button" data-testid="chart-theme" onClick={() => setDark((d) => !d)} title="Theme"
          className={`px-1.5 py-1 rounded transition ${dark ? 'text-amber-300 bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}><Icon name={dark ? 'spark' : 'moon'} className="h-3.5 w-3.5" /></button>
        <button type="button" data-testid="chart-tv-widget" onClick={() => setView((v) => (v === 'engine' ? 'tv' : 'engine'))} title="Official TradingView Advanced Chart (their data, their branding)"
          className={`px-1.5 py-1 rounded font-bold transition ${view === 'tv' ? 'bg-[#2962ff] text-white' : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100')}`}>TV</button>
        <button type="button" data-testid="chart-fullscreen" onClick={fullscreen} title="Fullscreen"
          className={`px-1.5 py-1 rounded transition ${dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}><Icon name="expand" className="h-3.5 w-3.5" /></button>
      </div>

      {/* plot */}
      <div className="relative" style={{ height: h }}>
        {view === 'tv' ? (
          <div data-testid="chart-tv-box" className="absolute inset-0 overflow-hidden">
            <TVChart inst={inst || { symbol, name, market: 'stocks', sector: US.has(symbol) ? 'US' : undefined }}
              height={h} interval={TV_INTERVAL[tf] || '5'} theme={dark ? 'dark' : 'light'} allowSymbolChange={false} />
          </div>
        ) : (
          <>
            <div ref={boxRef} data-testid="chart-tv-engine" className="absolute inset-0" />
            {legend ? (
              <div data-testid="chart-legend" className={`absolute left-2 top-1.5 z-10 pointer-events-none text-[10.5px] font-semibold tabular-nums ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                {legend.line
                  ? `C ${Number(legend.c).toFixed(2)}`
                  : `O ${Number(legend.o).toFixed(2)}  H ${Number(legend.h).toFixed(2)}  L ${Number(legend.l).toFixed(2)}  C ${Number(legend.c).toFixed(2)}  ${legend.o ? `${legend.c >= legend.o ? '+' : ''}${(((legend.c - legend.o) / legend.o) * 100).toFixed(2)}%` : ''}`}
              </div>
            ) : null}
            {loading && !candles.length ? (
              <div className="absolute inset-0 flex items-center justify-center"><Spinner dark={dark} /></div>
            ) : error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
                <p className={dark ? 'text-rose-400' : 'text-rose-600'}>{error}</p>
                <button type="button" onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">Retry</button>
              </div>
            ) : !candles.length ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">No candles for {symbol || 'this symbol'} yet.</div>
            ) : null}
          </>
        )}
      </div>
      <div className={`flex items-center justify-between px-3 py-1.5 text-[10.5px] border-t ${dark ? 'border-white/10 text-slate-400' : 'border-slate-100 text-slate-400'}`}>
        <span data-testid="chart-engine-note">
          {view === 'tv'
            ? `Official TradingView widget — chart & data © TradingView · ${tvNote(inst || { symbol, market: 'stocks', sector: US.has(symbol) ? 'US' : undefined })}`
            : 'TradingView Lightweight Charts™ · scroll zoom · drag pan · crosshair OHLC'}
        </span>
        <span>{view === 'tv' ? `TV · ${tvSymbol(inst || { symbol, market: 'stocks', sector: US.has(symbol) ? 'US' : undefined })} · ${tf}` : `${candles.length} candles · ${tf} · ${type}`}</span>
      </div>
    </div>
  );
}

const Spinner = ({ dark }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="animate-spin">
    <circle cx="12" cy="12" r="9" stroke={dark ? '#334155' : '#e2e8f0'} strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke={dark ? '#60a5fa' : '#2563eb'} strokeWidth="3" strokeLinecap="round" />
  </svg>
);

/**
 * ChartPro — TradingView-style charting surface built on our own provider
 * facade (single source: the same tick hub feeds prices AND candles).
 *
 * Candle/line/area/OHLC · timeframes 1m→1M · zoom (wheel) · pan (drag) ·
 * crosshair with OHLC readout · volume pane · fullscreen · light/dark theme.
 * The current candle updates in place from the socket; when the timeframe
 * bucket rolls over the closed candle is pushed and a new one starts —
 * the chart is never reloaded.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Market } from '../lib/api';
import { marketSocket, useSocketStatus } from '../lib/marketSocket';
import { useSize } from './Chart.jsx';
import { Icon } from './ui.jsx';

const TYPES = [
  { id: 'candle', label: 'Candles' },
  { id: 'ohlc', label: 'OHLC' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];
const TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'];
const PAL = {
  light: { bg: '#ffffff', grid: '#eef2f7', axis: '#64748b', up: '#16a34a', down: '#dc2626', line: '#2563eb', vol: '#cbd5e1' },
  dark: { bg: '#0b1020', grid: '#1c2333', axis: '#8fa0b8', up: '#22c55e', down: '#ef4444', line: '#60a5fa', vol: '#334155' },
};

const fmtT = (t, tf) => {
  const d = new Date(t);
  if (tf === '1D' || tf === '1W' || tf === '1M') return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function ChartPro({ symbol, name, feed, height = 360 }) {
  const [tf, setTf] = useState('5m');
  const [type, setType] = useState('candle');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [span, setSpan] = useState(90);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState(null);
  const [dark, setDark] = useState(false);
  const [showVol, setShowVol] = useState(true);
  const status = useSocketStatus();

  const wrapRef = useRef(null);
  const plotRef = useRef(null);
  const size = useSize(wrapRef);
  const w = Math.max(240, (size.w || 640) - 16);
  const h = height;

  /* history load (one fetch per symbol+timeframe change — never per tick) */
  const load = () => {
    if (!symbol) return;
    setLoading(true); setError(null); setOffset(0);
    Market.candlesTf(symbol, tf, 300)
      .then((r) => setCandles(r.candles || []))
      .catch((e) => setError(e?.message || 'Chart data failed to load.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [symbol, tf]);

  // Fallback: only while the stream is unavailable, refresh candles slowly
  // via REST. When streaming works, ticks/candle events drive everything and
  // no refetch ever happens.
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

  /* wheel zoom — non-passive listener so preventDefault works */
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setSpan((s) => Math.max(20, Math.min(400, Math.round(s * (e.deltaY > 0 ? 1.12 : 0.89)))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const visible = useMemo(() => {
    if (!candles.length) return [];
    const end = Math.max(1, candles.length - offset);
    return candles.slice(Math.max(0, end - span), end);
  }, [candles, span, offset]);

  const geo = useMemo(() => {
    const padR = 56; const padB = showVol ? 46 : 24;
    const pw = w - padR; const ph = h - padB;
    const vols = showVol ? ph * 0.22 : 0;
    const priceH = ph - vols;
    let lo = Infinity; let hi = -Infinity; let maxV = 0;
    for (const c of visible) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); maxV = Math.max(maxV, c.v || 0); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) { lo = (lo || 1) * 0.99; hi = (hi || 1) * 1.01; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const step = pw / Math.max(1, visible.length);
    const y = (p) => priceH - ((p - lo) / (hi - lo)) * priceH;
    const x = (i) => i * step + step / 2;
    return { pw, priceH, vols, step, x, y, lo, hi, maxV, padR };
  }, [visible, w, h, showVol]);

  const pal = dark ? PAL.dark : PAL.light;
  const dec = (n) => (n >= 1000 ? 2 : n >= 10 ? 2 : 4);

  const dragRef = useRef(null);
  const onMouseDown = (e) => { dragRef.current = { x: e.clientX, offset }; };
  const onMouseMove = (e) => {
    const rect = plotRef.current.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left) / geo.step);
    setHover({ i: Math.max(0, Math.min(visible.length - 1, i)), x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const shift = Math.round(dx / geo.step);
      setOffset(Math.max(0, Math.min(candles.length - 10, dragRef.current.offset + shift)));
    }
  };
  const endDrag = () => { dragRef.current = null; };

  const fullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const hoverC = hover ? visible[hover.i] : null;
  const last = candles[candles.length - 1];

  return (
    <div ref={wrapRef} data-testid="chartpro" className={`flex flex-col rounded-2xl border overflow-hidden ${dark ? 'border-white/10 bg-[#0b1020] text-slate-200' : 'border-slate-200 bg-white'}`}>
      {/* toolbar */}
      <div className={`flex flex-wrap items-center gap-1.5 px-3 py-2 border-b text-xs ${dark ? 'border-white/10' : 'border-slate-200'}`}>
        <div className="font-semibold mr-1">{symbol || '—'}{name ? <span className={dark ? 'text-slate-400' : 'text-slate-500'}> · {name}</span> : null}</div>
        {feed?.label ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${feed.latency === 'live' ? 'bg-emerald-500/15 text-emerald-600' : feed.latency === 'delayed' ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-500/15 text-slate-500'}`}>{feed.label}</span> : null}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${status === 'live' ? 'bg-emerald-500/15 text-emerald-600' : status === 'reconnecting' || status === 'connecting' ? 'bg-amber-500/15 text-amber-600' : 'bg-slate-500/15 text-slate-500'}`} data-testid="chart-ws-status">
          {status === 'live' ? 'STREAMING' : status === 'reconnecting' || status === 'connecting' ? 'RECONNECTING…' : 'OFFLINE'}
        </span>
        <div className="flex-1" />
        {TFS.map((t) => (
          <button key={t} type="button" data-testid={`chart-tf-${t}`} onClick={() => setTf(t)}
            className={`px-1.5 py-1 rounded font-semibold transition ${tf === t ? (dark ? 'bg-white/15 text-white' : 'bg-slate-900 text-white') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100')}`}>{t}</button>
        ))}
        <span className={`mx-1 h-4 w-px ${dark ? 'bg-white/10' : 'bg-slate-200'}`} />
        {TYPES.map((t) => (
          <button key={t.id} type="button" data-testid={`chart-type-${t.id}`} onClick={() => setType(t.id)}
            className={`px-1.5 py-1 rounded font-semibold transition ${type === t.id ? (dark ? 'bg-white/15 text-white' : 'bg-blue-50 text-blue-700') : (dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100')}`}>{t.label}</button>
        ))}
        <button type="button" data-testid="chart-volume" onClick={() => setShowVol((v) => !v)} title="Volume"
          className={`px-1.5 py-1 rounded transition ${showVol ? (dark ? 'text-white bg-white/10' : 'text-slate-700 bg-slate-100') : (dark ? 'text-slate-500' : 'text-slate-400')}`}><Icon name="layers" className="h-3.5 w-3.5" /></button>
        <button type="button" data-testid="chart-theme" onClick={() => setDark((d) => !d)} title="Theme"
          className={`px-1.5 py-1 rounded transition ${dark ? 'text-amber-300 bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}><Icon name={dark ? 'spark' : 'moon'} className="h-3.5 w-3.5" /></button>
        <button type="button" data-testid="chart-fullscreen" onClick={fullscreen} title="Fullscreen"
          className={`px-1.5 py-1 rounded transition ${dark ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-slate-100'}`}><Icon name="expand" className="h-3.5 w-3.5" /></button>
      </div>

      {/* plot */}
      <div className="relative" style={{ height: h }}>
        {loading && !candles.length ? (
          <div className="absolute inset-0 flex items-center justify-center"><Spinner dark={dark} /></div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
            <p className={dark ? 'text-rose-400' : 'text-rose-600'}>{error}</p>
            <button type="button" onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold">Retry</button>
          </div>
        ) : !visible.length ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">No candles for {symbol || 'this symbol'} yet.</div>
        ) : (
          <svg ref={plotRef} width={w} height={h} className="block touch-none select-none"
            style={{ cursor: dragRef.current ? 'grabbing' : 'crosshair' }}
            onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={endDrag} onMouseLeave={() => { endDrag(); setHover(null); }}>
            {/* grid + y labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const yv = geo.priceH * f;
              const pv = geo.hi - (geo.hi - geo.lo) * f;
              return (
                <g key={f}>
                  <line x1={0} x2={geo.pw} y1={yv} y2={yv} stroke={pal.grid} strokeWidth={1} />
                  <text x={geo.pw + 6} y={yv + 3} fontSize={10} fill={pal.axis}>{pv.toFixed(dec(pv))}</text>
                </g>
              );
            })}
            {/* volume pane */}
            {showVol && geo.vols > 0 && visible.map((c, i) => {
              const vh = geo.maxV ? ((c.v || 0) / geo.maxV) * (geo.vols - 6) : 0;
              return <rect key={`v${i}`} x={geo.x(i) - geo.step * 0.32} y={geo.priceH + geo.vols - vh} width={Math.max(1, geo.step * 0.64)} height={Math.max(0.5, vh)} fill={c.c >= c.o ? pal.up : pal.down} opacity={0.35} />;
            })}
            {/* series */}
            {type === 'line' && (
              <polyline fill="none" stroke={pal.line} strokeWidth={1.6}
                points={visible.map((c, i) => `${geo.x(i)},${geo.y(c.c)}`).join(' ')} />
            )}
            {type === 'area' && (
              <>
                <defs><linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={pal.line} stopOpacity="0.35" /><stop offset="100%" stopColor={pal.line} stopOpacity="0.02" />
                </linearGradient></defs>
                <polygon fill="url(#areaG)"
                  points={`0,${geo.priceH} ${visible.map((c, i) => `${geo.x(i)},${geo.y(c.c)}`).join(' ')} ${geo.x(visible.length - 1)},${geo.priceH}`} />
                <polyline fill="none" stroke={pal.line} strokeWidth={1.6}
                  points={visible.map((c, i) => `${geo.x(i)},${geo.y(c.c)}`).join(' ')} />
              </>
            )}
            {(type === 'candle' || type === 'ohlc') && visible.map((c, i) => {
              const up = c.c >= c.o;
              const col = up ? pal.up : pal.down;
              const x = geo.x(i);
              if (type === 'ohlc') return (
                <g key={i} stroke={col} strokeWidth={1.2}>
                  <line x1={x} x2={x} y1={geo.y(c.h)} y2={geo.y(c.l)} />
                  <line x1={x - geo.step * 0.3} x2={x} y1={geo.y(c.o)} y2={geo.y(c.o)} />
                  <line x1={x} x2={x + geo.step * 0.3} y1={geo.y(c.c)} y2={geo.y(c.c)} />
                </g>
              );
              const bodyTop = geo.y(Math.max(c.o, c.c));
              const bodyH = Math.max(1, Math.abs(geo.y(c.o) - geo.y(c.c)));
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={geo.y(c.h)} y2={geo.y(c.l)} stroke={col} strokeWidth={1} />
                  <rect x={x - geo.step * 0.32} y={bodyTop} width={Math.max(1.5, geo.step * 0.64)} height={bodyH} fill={col} />
                </g>
              );
            })}
            {/* x labels */}
            {visible.map((c, i) => (i % Math.ceil(visible.length / 6) === 0 ? (
              <text key={`x${i}`} x={geo.x(i)} y={h - (showVol ? 30 : 8)} fontSize={10} fill={pal.axis} textAnchor="middle">{fmtT(c.t, tf)}</text>
            ) : null))}
            {/* last price marker */}
            {last ? (
              <g>
                <line x1={0} x2={geo.pw} y1={geo.y(last.c)} y2={geo.y(last.c)} stroke={last.c >= (visible[visible.length - 1]?.o ?? last.c) ? pal.up : pal.down} strokeDasharray="4 3" strokeWidth={1} />
                <rect x={geo.pw + 2} y={geo.y(last.c) - 8} width={geo.padR - 4} height={16} rx={4} fill={last.c >= last.o ? pal.up : pal.down} />
                <text x={geo.pw + 6} y={geo.y(last.c) + 4} fontSize={10} fill="#fff" fontWeight={700}>{last.c.toFixed(dec(last.c))}</text>
              </g>
            ) : null}
            {/* crosshair */}
            {hoverC && hover ? (
              <g pointerEvents="none">
                <line x1={geo.x(hover.i)} x2={geo.x(hover.i)} y1={0} y2={geo.priceH + (showVol ? geo.vols : 0)} stroke={pal.axis} strokeDasharray="3 3" strokeWidth={0.8} />
                <line x1={0} x2={geo.pw} y1={hover.y} y2={hover.y} stroke={pal.axis} strokeDasharray="3 3" strokeWidth={0.8} />
                <text x={6} y={14} fontSize={10.5} fill={pal.axis}>
                  O {hoverC.o.toFixed(dec(hoverC.o))}  H {hoverC.h.toFixed(dec(hoverC.h))}  L {hoverC.l.toFixed(dec(hoverC.l))}  C {hoverC.c.toFixed(dec(hoverC.c))}  {hoverC.c >= hoverC.o ? '+' : ''}{(((hoverC.c - hoverC.o) / hoverC.o) * 100).toFixed(2)}%  V {Math.round(hoverC.v || 0).toLocaleString()}
                </text>
              </g>
            ) : null}
          </svg>
        )}
      </div>
      <div className={`flex items-center justify-between px-3 py-1.5 text-[10.5px] border-t ${dark ? 'border-white/10 text-slate-400' : 'border-slate-100 text-slate-400'}`}>
        <span>Scroll to zoom · drag to pan · hover for OHLC readout</span>
        <span>{visible.length} candles · {tf} · {type}</span>
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

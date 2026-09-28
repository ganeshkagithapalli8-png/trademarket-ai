/** Hand-rolled SVG charts. No chart library — smaller bundle, full control. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { compact, n } from '../lib/format.js';

export function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const UP = '#10B981';
const DOWN = '#F43F5E';

/**
 * Candlestick chart with a volume strip, price axis and crosshair readout.
 * `levels` draws horizontal support / resistance / entry / stop / target lines.
 */
export function CandleChart({ candles = [], height = 300, levels = [], showVolume = true, emptyLabel = 'No data yet' }) {
  const wrap = useRef(null);
  const { w } = useSize(wrap);
  const [hover, setHover] = useState(null);

  const padL = 0;
  const padR = 58;
  const padT = 10;
  const volH = showVolume ? 34 : 0;
  const padB = 20 + volH;

  const width = Math.max(w, 280);
  const plotW = width - padL - padR;
  const plotH = Math.max(60, height - padT - padB);

  if (!candles.length) {
    return (
      <div ref={wrap} className="grid place-items-center rounded-xl bg-slate-50 text-[13px] text-slate-400" style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const levelVals = levels.map((l) => l.value).filter((v) => Number.isFinite(v) && v > 0);
  const hi = Math.max(...highs, ...levelVals);
  const lo = Math.min(...lows, ...levelVals);
  const span = hi - lo || 1;
  const top = hi + span * 0.06;
  const bot = lo - span * 0.06;
  const range = top - bot;

  const x = (i) => padL + (i + 0.5) * (plotW / candles.length);
  const y = (p) => padT + ((top - p) / range) * plotH;
  const cw = Math.max(1.5, Math.min(14, (plotW / candles.length) * 0.62));
  const maxVol = Math.max(...candles.map((c) => c.v || 0)) || 1;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => bot + (range * i) / ticks);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const i = Math.round((px - padL) / (plotW / candles.length) - 0.5);
    setHover(i >= 0 && i < candles.length ? i : null);
  };

  const hc = hover != null ? candles[hover] : null;

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height }}>
      <svg
        data-testid="candle-chart"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchMove={onMove}
        onTouchEnd={() => setHover(null)}
        className="touch-pan-y"
      >
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} stroke="#E2E8F0" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '3 4'} />
            <text x={width - padR + 7} y={y(v) + 3.5} fontSize="10" fill="#94A3B8" className="tnum" fontFamily="ui-monospace, monospace">
              {compact(v)}
            </text>
          </g>
        ))}

        {levels.map((l, i) =>
          Number.isFinite(l.value) && l.value > 0 && l.value < top && l.value > bot ? (
            <g key={`lv-${i}`}>
              <line x1={padL} x2={padL + plotW} y1={y(l.value)} y2={y(l.value)} stroke={l.color || '#3B6DF6'} strokeWidth="1.2" strokeDasharray="5 4" opacity="0.85" />
              <text x={padL + 4} y={y(l.value) - 4} fontSize="9.5" fill={l.color || '#3B6DF6'} fontWeight="700">
                {l.label}
              </text>
            </g>
          ) : null
        )}

        {showVolume &&
          candles.map((c, i) => {
            const h = ((c.v || 0) / maxVol) * volH;
            return (
              <rect
                key={`v${i}`}
                x={x(i) - cw / 2}
                y={height - padB + (volH - h)}
                width={cw}
                height={Math.max(0.6, h)}
                fill={c.c >= c.o ? UP : DOWN}
                opacity="0.22"
                rx="0.5"
              />
            );
          })}

        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const col = up ? UP : DOWN;
          const bodyTop = y(Math.max(c.o, c.c));
          const bodyBot = y(Math.min(c.o, c.c));
          return (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth="1.1" />
              <rect
                x={x(i) - cw / 2}
                y={bodyTop}
                width={cw}
                height={Math.max(1, bodyBot - bodyTop)}
                fill={col}
                rx={cw > 4 ? 1 : 0}
              />
            </g>
          );
        })}

        {hc && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="#64748B" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <rect x={padL + plotW + 1} y={y(hc.c) - 8} width={padR - 4} height={16} rx={4} fill="#1E293B" />
            <text x={width - padR + 7} y={y(hc.c) + 3.5} fontSize="10" fill="#fff" fontWeight="700" className="tnum" fontFamily="ui-monospace, monospace">
              {n(hc.c, hc.c < 10 ? 4 : 2)}
            </text>
          </g>
        )}
      </svg>

      {hc && (
        <div className="pointer-events-none absolute left-2 top-1 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-semibold shadow-sm ring-1 ring-slate-200 backdrop-blur">
          <span className="tnum text-slate-500">O</span> <span className="tnum text-slate-800">{n(hc.o)}</span>
          <span className="tnum ml-2 text-slate-500">H</span> <span className="tnum text-up-deep">{n(hc.h)}</span>
          <span className="tnum ml-2 text-slate-500">L</span> <span className="tnum text-down-deep">{n(hc.l)}</span>
          <span className="tnum ml-2 text-slate-500">C</span>{' '}
          <span className={`tnum ${hc.c >= hc.o ? 'text-up-deep' : 'text-down-deep'}`}>{n(hc.c)}</span>
        </div>
      )}
    </div>
  );
}

/** Tiny inline trend line for list rows. */
export function Sparkline({ points = [], width = 84, height = 28, tone }) {
  if (points.length < 2) return <div style={{ width, height }} />;
  const vals = points.map((p) => (typeof p === 'number' ? p : p.p ?? p.c ?? 0));
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const range = hi - lo || 1;
  const step = width / (vals.length - 1);
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(height - 2 - ((v - lo) / range) * (height - 4)).toFixed(2)}`).join(' ');
  const rising = vals[vals.length - 1] >= vals[0];
  const col = tone || (rising ? UP : DOWN);
  const gid = `sg-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.22" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="draw-line" />
    </svg>
  );
}

/** Filled area chart for the equity curve. */
export function AreaChart({ series = [], height = 180, valueKey = 'equity', labelKey = 'day', color = '#3B6DF6', formatValue = compact }) {
  const wrap = useRef(null);
  const { w } = useSize(wrap);
  const [hover, setHover] = useState(null);

  const padL = 6;
  const padR = 52;
  const padT = 12;
  const padB = 22;
  const width = Math.max(w, 280);
  const plotW = width - padL - padR;
  const plotH = Math.max(50, height - padT - padB);

  if (series.length < 2) {
    return (
      <div ref={wrap} className="grid place-items-center rounded-xl bg-slate-50 text-[13px] text-slate-400" style={{ height }}>
        Close a few trades to see your equity curve
      </div>
    );
  }

  const vals = series.map((s) => Number(s[valueKey]) || 0);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.02 || 1;
  const top = hi + pad;
  const bot = lo - pad;
  const range = top - bot || 1;

  const x = (i) => padL + (i / (series.length - 1)) * plotW;
  const y = (v) => padT + ((top - v) / range) * plotH;

  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(2)},${(padT + plotH).toFixed(2)} L${padL},${(padT + plotH).toFixed(2)} Z`;
  const rising = vals[vals.length - 1] >= vals[0];
  const col = rising ? '#10B981' : DOWN;
  const gid = `eq-grad`;

  const ticks = 3;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => bot + (range * i) / ticks);

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) * (width / r.width) - padL) / (plotW / (series.length - 1)));
          setHover(i >= 0 && i < series.length ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.24" />
            <stop offset="100%" stopColor={col} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3 4" />
            <text x={width - padR + 7} y={y(v) + 3.5} fontSize="10" fill="#94A3B8" className="tnum" fontFamily="ui-monospace, monospace">
              {formatValue(v)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={col} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className="draw-line" />

        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#64748B" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(vals[hover])} r="4" fill="#fff" stroke={col} strokeWidth="2.4" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute left-2 top-0 rounded-lg bg-white/95 px-2.5 py-1 text-[11px] font-semibold shadow-sm ring-1 ring-slate-200 backdrop-blur">
          <span className="tnum text-slate-500">{new Date(series[hover][labelKey]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
          <span className="tnum ml-2 text-slate-900">{formatValue(vals[hover])}</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal bar for allocation breakdowns. */
export function AllocationBar({ segments = [] }) {
  const COLORS = ['#3B6DF6', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6', '#06B6D4'];
  const total = segments.reduce((s, x) => s + (x.pct || 0), 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map((s, i) => (
          <div key={s.label} style={{ width: `${(s.pct / total) * 100}%`, background: COLORS[i % COLORS.length] }} className="h-full transition-all duration-500" />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-600">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            {s.label} <span className="tnum text-slate-400">{s.pct.toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Donut used for roadmap completion. */
export function Donut({ value, max = 100, size = 76, stroke = 8, label }) {
  const p = Math.min(1, Math.max(0, value / (max || 1)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#dn)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
        <defs>
          <linearGradient id="dn" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6090FA" />
            <stop offset="100%" stopColor="#2551EB" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute grid place-items-center text-center">
        <span className="tnum text-[15px] font-bold leading-none text-slate-900">{label ?? `${Math.round(p * 100)}%`}</span>
      </div>
    </div>
  );
}

export function useAnimatedNumber(value, ms = 500) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = Number(from.current) || 0;
    const b = Number(value) || 0;
    if (a === b) return undefined;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(a + (b - a) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return display;
}

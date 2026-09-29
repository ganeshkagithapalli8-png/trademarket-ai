/**
 * live_candles — the real intraday history built from live quote ticks
 * (Finnhub for US equities). Finnhub's free tier has no candle endpoint, so the
 * server aggregates every real tick into 1-minute buckets here and derives the
 * larger timeframes on read. Grows forever; honest — every bar came from a real
 * exchange print.
 */
import { admin, dbEnabled } from './index.js';

/** Upsert one 1-minute bucket. o is set at insert only; h/l expand, c follows. */
export async function persistLiveCandle(q) {
  if (!dbEnabled || q?.price == null) return;
  const t = Math.floor((q.at || Date.now()) / 60_000) * 60_000;
  try {
    await admin((cl) => cl.query(
      `insert into live_candles (symbol, t, o, h, l, c, provider)
       values ($1, $2, $3, $3, $3, $3, $4)
       on conflict (symbol, t) do update set
         h = greatest(live_candles.h, excluded.h),
         l = least(live_candles.l, excluded.l),
         c = excluded.c,
         updated_at = now()`,
      [q.symbol, t, Number(q.price), q.provider || 'finnhub'],
    ));
  } catch (e) { /* persistence is best-effort; the live stream keeps flowing */ }
}

/** Read `limit` candles for timeframe tf (ms), aggregating stored 1m buckets. */
export async function fetchLiveCandles(symbol, tfMs, limit) {
  if (!dbEnabled) return [];
  const buckets = Math.max(2, Math.ceil(tfMs / 60_000));
  const rowsRes = await admin((cl) => cl.query(
    'select t, o, h, l, c, provider from live_candles where symbol = $1 order by t desc limit $2',
    [symbol, Math.min(30_000, limit * buckets + buckets * 2)],
  ));
  const rows = rowsRes.rows || [];
  const agg = new Map();
  for (const r of rows) {
    const t = Number(r.t); const b = Math.floor(t / tfMs) * tfMs;
    const cur = agg.get(b);
    if (!cur || t < cur.t) {
      agg.set(b, cur ? { ...cur, t: b, o: Number(r.o), h: Math.max(cur.h, Number(r.h)), l: Math.min(cur.l, Number(r.l)), c: cur.t > t ? cur.c : Number(r.c) } : { t: b, o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), tRaw: t });
    } else {
      cur.h = Math.max(cur.h, Number(r.h)); cur.l = Math.min(cur.l, Number(r.l));
      if (t > (cur.tRaw ?? 0)) { cur.c = Number(r.c); cur.tRaw = t; }
    }
  }
  return [...agg.values()].sort((a, b) => a.t - b.t).slice(-limit)
    .map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: 0, provider: 'finnhub' }));
}

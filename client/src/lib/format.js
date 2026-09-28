/** Display helpers. Indian numbering, rupee formatting, relative time. */

/* Formatters are cached — Intl.NumberFormat construction is expensive and
   these run once per table row on every poll. */
const nfCache = new Map();
const nf = (min, max = min) => {
  const key = `${min}:${max}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(key, f);
  }
  return f;
};
const dOf = (d) => Math.max(0, Math.min(8, Math.round(Number(d) || 0)));

/** Plain number, Indian digit grouping, exactly `d` decimal places. */
export const n = (v, d = 2) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  const dd = dOf(d);
  return nf(dd, dd).format(x);
};

/**
 * Trade quantity. Equities and derivatives move in whole lots; crypto does not.
 * Up to 6 decimals with no zero padding: 1 -> "1", 0.0025 -> "0.0025".
 */
export const qtyStr = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  return nf(0, 6).format(x);
};

export const money = (v, d = 2) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  const dd = dOf(d);
  return `₹${nf(dd, dd).format(Math.abs(x))}`;
};

export const signed = (v, d = 2) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  const dd = dOf(d);
  return `${x >= 0 ? '+' : '−'}₹${nf(dd, dd).format(Math.abs(x))}`;
};

export const pct = (v, d = 2) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`;
};

/** Compact for chart axes and stat tiles: 1.2L, 3.4Cr, 8.1K. */
export const compact = (v) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  const sign = x < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(a < 10 ? 2 : 0)}`;
};

export const timeAgo = (iso) => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
};

export const dateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : '—';

export const dayLabel = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : '—';

/** Indian market session, in IST, for the "market open/closed" pill. */
export function marketSessionState(now = new Date()) {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const weekday = day >= 1 && day <= 5;
  const open = mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
  return {
    isWeekday: weekday,
    isOpen: weekday && open,
    label: weekday && open ? 'Market open' : weekday ? 'Market closed' : 'Weekend',
    ist: ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

export const toneOf = (v) => (Number(v) > 0 ? 'up' : Number(v) < 0 ? 'down' : 'flat');

export const titleCase = (s) =>
  String(s || '')
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Very small, deliberately safe markdown renderer for AI responses. */
export function renderMarkdown(text) {
  if (!text) return '';
  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = esc(String(text)).split('\n');
  const out = [];
  let inList = false;
  let inTable = false;

  const inline = (s) =>
    s
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-100 text-[0.86em] font-mono text-brand-700">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-brand-600 underline underline-offset-2">$1</a>');

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeTable = () => { if (inTable) { out.push('</tbody></table></div>'); inTable = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      closeList();
      if (!inTable) {
        out.push('<div class="overflow-x-auto my-2"><table class="w-full text-[13px] border-collapse">');
        out.push('<thead><tr>' + cells.map((c) => `<th class="text-left font-semibold text-slate-600 px-2 py-1.5 border-b border-slate-200">${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
        inTable = true;
        continue;
      }
      out.push('<tr>' + cells.map((c) => `<td class="px-2 py-1.5 border-b border-slate-100 text-slate-700">${inline(c)}</td>`).join('') + '</tr>');
      continue;
    }
    closeTable();

    if (!line.trim()) { closeList(); continue; }

    if (/^#{1,4}\s+/.test(line)) {
      closeList();
      const lvl = line.match(/^#+/)[0].length;
      const size = lvl <= 1 ? 'text-lg' : lvl === 2 ? 'text-base' : 'text-[15px]';
      out.push(`<p class="${size} font-bold text-slate-900 mt-3 mb-1">${inline(line.replace(/^#+\s+/, ''))}</p>`);
      continue;
    }
    if (/^---+$/.test(line)) { closeList(); out.push('<hr class="my-3 border-slate-200"/>'); continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      if (!inList) { out.push('<ul class="my-1.5 space-y-1.5 pl-1">'); inList = true; }
      out.push(`<li class="flex gap-2 text-[14.5px] leading-relaxed text-slate-700"><span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"></span><span>${inline(line.replace(/^\s*[-*•]\s+/, ''))}</span></li>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      closeList();
      out.push(`<p class="my-1 text-[14.5px] leading-relaxed text-slate-700">${inline(line)}</p>`);
      continue;
    }
    if (/^_\S.*\_$/.test(line.trim()) && line.trim().length < 400) {
      closeList();
      out.push(`<p class="my-2 text-[12.5px] italic text-slate-500">${inline(line.trim().replace(/^_|_$/g, ''))}</p>`);
      continue;
    }
    closeList();
    out.push(`<p class="my-1.5 text-[14.5px] leading-relaxed text-slate-700">${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  return out.join('');
}

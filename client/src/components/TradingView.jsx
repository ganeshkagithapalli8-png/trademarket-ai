import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

/**
 * TradingView's free embeddable widgets — REAL market charts and a live
 * ticker tape, rendered in the user's browser by TradingView's own script.
 *
 * Why this and not a server scraper: it is read-only, officially embeddable,
 * needs no API key, and never routes an order. Our paper engine stays the
 * source of truth for fills; these widgets are the "what is the real market
 * doing right now" reference pane.
 *
 * If the network is unavailable (offline preview, blocked CDN) the widget
 * area degrades to an explanatory panel instead of breaking the page.
 */

const CHART_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const TAPE_SRC = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';

/* Indian exchange data is licensed: TradingView's free embed rejects NSE/BSE
   symbols, and NSE/Moneycontrol block unauthenticated servers. So the live
   board streams what IS freely redistributable — FX, crypto, gold, and Indian
   exposure via US-listed ADRs / the India-50 ETF — each labelled as a proxy.
   Direct NSE ticks remain available through the user's own broker key
   (read-only Kite adapter, server-side). */
const ADR = {
  INFY: 'NASDAQ:INFY',
  HDFCBANK: 'NYSE:HDB',
  ICICIBANK: 'NYSE:IBN',
  WIPRO: 'NYSE:WIT',
  DRREDDY: 'NYSE:RDY',
};
const INDIA_PROXY = 'NASDAQ:INDY'; // iShares India 50 ETF

/** Map an instrument to a TradingView symbol the free embed actually serves. */
export function tvSymbol(inst) {
  if (!inst) return INDIA_PROXY;
  const s = inst.symbol;
  if (inst.sector === 'US') return `NASDAQ:${s}`; // free embed serves US listings natively
  if (inst.market === 'forex') {
    if (s === 'XAUUSD') return 'TVC:GOLD';
    if (/^[A-Z]{6}$/.test(s)) return `FX:${s}`;
  }
  if (inst.market === 'crypto') return `BITSTAMP:${s.replace(/INR$/, 'USD')}`;
  if (ADR[s]) return ADR[s];
  return INDIA_PROXY;
}

/** Honest caption for whatever the embed is showing. */
export function tvNote(inst) {
  if (!inst) return '';
  const s = inst.symbol;
  if (inst.market === 'forex') return s === 'XAUUSD' ? 'Gold spot, real' : 'Real interbank reference rate';
  if (inst.market === 'crypto') return 'Real exchange price (USD)';
  if (ADR[s]) return `${inst.name} — real US-listed ADR (USD), tracks the Indian parent`;
  return 'Proxy: iShares India 50 ETF (USD). Direct NSE/BSE ticks need your own broker key.';
}

/* TradingView's loader calls script.parentNode.querySelector (…) asynchronously
   (_replaceScript). Hard-removing our nodes on unmount leaves parentNode null and
   throws a pageerror, so retired nodes are moved to a detached graveyard that
   stays alive briefly, then freed. */
const graveyard = typeof document !== 'undefined' ? document.createElement('div') : null;
function bury(node) {
  if (!graveyard) return;
  graveyard.appendChild(node);
  if (graveyard.childElementCount > 12) graveyard.firstChild?.remove();
  setTimeout(() => node.remove(), 30000);
}

function useEmbed(src, config, height) {
  const ref = useRef(null);
  const [state, setState] = useState('loading'); // loading | live | failed
  const key = JSON.stringify(config);

  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    setState('loading');

    const slot = host.querySelector('.tradingview-widget-container__widget');
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = src;
    script.async = true;
    script.textContent = key; // the widget reads its config from the tag body
    script.onerror = () => setState('failed');
    host.appendChild(script);

    const probe = setInterval(() => {
      if (host.querySelector('iframe')) {
        setState('live');
        clearInterval(probe);
      }
    }, 700);
    const giveUp = setTimeout(() => {
      clearInterval(probe);
      setState((s) => (s === 'live' ? s : 'failed'));
    }, 9000);

    return () => {
      clearInterval(probe);
      clearTimeout(giveUp);
      host.querySelectorAll('script, iframe').forEach(bury);
      if (slot) slot.innerHTML = '';
    };
  }, [src, key, height]);

  return { ref, state };
}

function Fallback({ height, label }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center"
      style={{ height }}
    >
      <Icon name="zap" className="h-5 w-5 text-slate-300" />
      <p className="text-[12.5px] font-bold text-slate-500">Live {label} needs network access</p>
      <p className="max-w-xs text-[11px] leading-snug text-slate-400">
        The real-market widget streams from TradingView's CDN in your browser. Open the app in a
        connected browser to see it — your simulated candles below always work.
      </p>
    </div>
  );
}

/** Full interactive candlestick chart of the REAL instrument. */
export function TVChart({ inst, height = 430, interval = '15', theme = 'light', allowSymbolChange = true }) {
  const symbol = tvSymbol(inst);
  const { ref, state } = useEmbed(
    CHART_SRC,
    {
      autosize: false,
      width: '100%',
      height: String(height),
      symbol,
      interval,
      timezone: 'Asia/Kolkata',
      theme,
      style: '1',
      locale: 'en',
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: allowSymbolChange,
      save_image: false,
      support_host: 'https://www.tradingview.com',
    },
    height
  );

  if (state === 'failed') return <Fallback height={height} label="chart" />;
  return (
    <div className="relative">
      <div ref={ref} className="tradingview-widget-container overflow-hidden rounded-xl" style={{ height }}>
        <div className="tradingview-widget-container__widget" style={{ height, width: '100%' }} />
      </div>
      {state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center rounded-xl bg-slate-50/80">
          <p className="text-[12px] font-semibold text-slate-400">Loading real chart for {symbol}…</p>
        </div>
      )}
    </div>
  );
}

/** Scrolling tape of REAL prices across markets. */
export function TickerTape() {
  const { ref, state } = useEmbed(
    TAPE_SRC,
    {
      symbols: [
        { proName: 'FX:USDINR', title: 'USD/INR' },
        { proName: 'FX:EURUSD', title: 'EUR/USD' },
        { proName: 'BITSTAMP:BTCUSD', title: 'Bitcoin' },
        { proName: 'BITSTAMP:ETHUSD', title: 'Ether' },
        { proName: 'TVC:GOLD', title: 'Gold' },
        { proName: 'NASDAQ:INDY', title: 'India 50 ETF' },
        { proName: 'NASDAQ:INFY', title: 'Infosys ADR' },
        { proName: 'NYSE:HDB', title: 'HDFC Bank ADR' },
        { proName: 'NYSE:IBN', title: 'ICICI Bank ADR' },
      ],
      showSymbolLogo: true,
      colorTheme: 'light',
      isTransparent: true,
      displayMode: 'adaptive',
      locale: 'en',
    },
    46
  );

  if (state === 'failed') {
    return (
      <p className="px-4 py-3 text-[11.5px] text-slate-400 sm:px-5">
        Live tape unavailable offline — real prices stream from TradingView when a network is present.
      </p>
    );
  }
  return (
    <div ref={ref} className="tradingview-widget-container">
      <div className="tradingview-widget-container__widget" />
    </div>
  );
}

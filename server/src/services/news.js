/**
 * Live news via public RSS feeds, fetched server-side and cached.
 *
 * No API key, no dependency: a tiny tolerant XML reader. If every feed fails
 * (offline sandbox, upstream outage) we degrade to a clearly-labelled
 * placeholder list so the UI never shows a broken panel.
 */

const FEEDS = {
  stocks: [
    { name: 'Moneycontrol — Business', url: 'https://www.moneycontrol.com/rss/business.xml', market: 'stocks' },
    { name: 'ET Markets — Stocks', url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms', market: 'stocks' },
    { name: 'ET Markets — Latest', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', market: 'stocks' },
  ],
  fno: [
    { name: 'ET Markets — Stocks', url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms', market: 'fno' },
    { name: 'Moneycontrol — Business', url: 'https://www.moneycontrol.com/rss/business.xml', market: 'fno' },
  ],
  ipo: [
    { name: 'ET Markets — IPO', url: 'https://economictimes.indiatimes.com/markets/ipos/rssfeeds/2146842.cms', market: 'ipo' },
    { name: 'Moneycontrol — Business', url: 'https://www.moneycontrol.com/rss/business.xml', market: 'ipo' },
  ],
  crypto: [
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', market: 'crypto' },
    { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', market: 'crypto' },
  ],
  forex: [
    { name: 'Moneycontrol — Business', url: 'https://www.moneycontrol.com/rss/business.xml', market: 'forex' },
    { name: 'ET Markets — Forex', url: 'https://economictimes.indiatimes.com/markets/forex/rssfeeds/2146842.cms', market: 'forex' },
  ],
  all: [
    { name: 'Moneycontrol — Business', url: 'https://www.moneycontrol.com/rss/business.xml', market: 'stocks' },
    { name: 'ET Markets — Stocks', url: 'https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms', market: 'stocks' },
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', market: 'crypto' },
  ],
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

const FALLBACK = {
  live: false,
  items: [
    {
      title: 'News feeds are unreachable from this server right now',
      summary:
        'The simulator still works — prices, trades and the AI tutor are unaffected. News will repopulate automatically on the next successful fetch.',
      link: null,
      source: 'TradeMarket AI',
      publishedAt: new Date().toISOString(),
      market: 'all',
    },
  ],
};

// ── tiny tolerant RSS reader ────────────────────────────────────────────────

const decodeEntities = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
};

function parseFeed(xml, feed) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, 15)) {
    const title = tag(block, 'title');
    if (!title) continue;
    const linkRaw = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const pubDate = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const desc = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded');
    const parsed = pubDate ? Date.parse(pubDate) : NaN;

    items.push({
      title: title.slice(0, 220),
      summary: desc.slice(0, 400),
      link: linkRaw ? decodeEntities(linkRaw[1]).slice(0, 500) : null,
      source: feed.name,
      publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(),
      market: feed.market,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradeMarketAI/1.0; educational-news-reader)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  const xml = await res.text();
  return parseFeed(xml, feed);
}

export async function getNews(market = 'all', { force = false } = {}) {
  const key = FEEDS[market] ? market : 'all';
  const now = Date.now();
  const hit = cache.get(key);
  if (!force && hit && now - hit.at < CACHE_MS) return hit.payload;

  const feeds = FEEDS[key] || FEEDS.all;
  const settled = await Promise.allSettled(feeds.map(fetchFeed));
  const ok = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value);

  if (ok.length === 0) {
    // Keep serving stale data if we have it — better than a blank panel.
    if (hit) return { ...hit.payload, stale: true };
    return FALLBACK;
  }

  const seen = new Set();
  const items = ok
    .filter((i) => {
      const k = i.title.toLowerCase().slice(0, 70);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 40);

  const payload = { live: true, fetchedAt: new Date(now).toISOString(), items };
  cache.set(key, { at: now, payload });
  return payload;
}

export const newsSources = () =>
  Object.entries(FEEDS).flatMap(([m, fs]) => fs.map((f) => ({ market: m, ...f })));

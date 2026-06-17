import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Quote = { price: number; change: number };

async function fetchYahooQuote(ticker: string): Promise<Quote | null> {
  const yahooTicker = ticker.includes(".") ? ticker : `${ticker}.SA`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; chartPreviousClose?: number } }> };
  };
  const meta = json.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice) || 0;
  const previous = Number(meta?.chartPreviousClose) || 0;
  if (!price) return null;
  return { price, change: previous > 0 ? ((price / previous) - 1) * 100 : 0 };
}

export const fetchQuotes = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ tickers: z.array(z.string().min(1)).min(1) }).parse(data))
  .handler(async ({ data }) => {
    const token = process.env.BRAPI_TOKEN;
    const out: Record<string, Quote> = {};
    const tickers = Array.from(new Set(data.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)));
    const params = new URLSearchParams({ range: "1d", interval: "1d" });
    if (token) params.set("token", token);
    const url = `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?${params.toString()}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const json = (await res.json()) as { results?: Array<{ symbol?: string; regularMarketPrice?: number; regularMarketChangePercent?: number }> };
        for (const r of json.results ?? []) {
          if (r?.symbol) {
            out[r.symbol.trim().toUpperCase()] = {
              price: Number(r.regularMarketPrice) || 0,
              change: Number(r.regularMarketChangePercent) || 0,
            };
          }
        }
      }
      const missing = tickers.filter((ticker) => !out[ticker]);
      await Promise.all(missing.map(async (ticker) => {
        const quote = await fetchYahooQuote(ticker);
        if (quote) out[ticker] = quote;
      }));
      const stillMissing = tickers.filter((ticker) => !out[ticker]);
      if (stillMissing.length > 0) return { quotes: out, error: `Sem cotação para: ${stillMissing.join(", ")}` };
      return { quotes: out, error: null as string | null };
    } catch (e) {
      await Promise.all(tickers.map(async (ticker) => {
        const quote = await fetchYahooQuote(ticker);
        if (quote) out[ticker] = quote;
      }));
      const stillMissing = tickers.filter((ticker) => !out[ticker]);
      return { quotes: out, error: stillMissing.length > 0 ? `Sem cotação para: ${stillMissing.join(", ")}` : null };
    }
  });

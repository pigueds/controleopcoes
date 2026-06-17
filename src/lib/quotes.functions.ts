import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const fetchQuotes = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ tickers: z.array(z.string().min(1)).min(1) }).parse(data))
  .handler(async ({ data }) => {
    const token = process.env.BRAPI_TOKEN;
    const out: Record<string, { price: number; change: number }> = {};
    const tickers = Array.from(new Set(data.tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)));
    const params = new URLSearchParams({ range: "1d", interval: "1d" });
    if (token) params.set("token", token);
    const url = `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?${params.toString()}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { quotes: out, error: `HTTP ${res.status}` };
      const json = (await res.json()) as { results?: Array<{ symbol?: string; regularMarketPrice?: number; regularMarketChangePercent?: number }> };
      for (const r of json.results ?? []) {
        if (r?.symbol) {
          out[r.symbol.trim().toUpperCase()] = {
            price: Number(r.regularMarketPrice) || 0,
            change: Number(r.regularMarketChangePercent) || 0,
          };
        }
      }
      return { quotes: out, error: null as string | null };
    } catch (e) {
      return { quotes: out, error: (e as Error).message };
    }
  });

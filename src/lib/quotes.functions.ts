import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const fetchQuotes = createServerFn({ method: "POST" })
  .inputValidator(z.object({ tickers: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }) => {
    const token = process.env.BRAPI_TOKEN;
    const out: Record<string, { price: number; change: number }> = {};
    const url = `https://brapi.dev/api/quote/${data.tickers.join(",")}?range=1d&interval=1d${token ? `&token=${token}` : ""}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return { quotes: out, error: `HTTP ${res.status}` };
      const json = (await res.json()) as { results?: Array<{ symbol?: string; regularMarketPrice?: number; regularMarketChangePercent?: number }> };
      for (const r of json.results ?? []) {
        if (r?.symbol) {
          out[r.symbol] = {
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

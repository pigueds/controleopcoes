import { fetchQuotes as fetchQuotesServer } from "@/lib/quotes.functions";

type Quote = { price: number; change: number };

type QuotesResponse = {
  quotes: Record<string, Quote>;
  error: string | null;
};

export async function fetchQuotes(tickers: string[]): Promise<QuotesResponse> {
  const clean = Array.from(new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean)));
  if (clean.length === 0) return { quotes: {}, error: "Informe ao menos um ticker." };
  try {
    const data = await fetchQuotesServer({ data: { tickers: clean } });
    return data ?? { quotes: {}, error: "Sem retorno do servidor de cotações." };
  } catch (e) {
    console.error("[fetchQuotes] server fn failed:", e);
    return {
      quotes: {},
      error: e instanceof Error ? e.message : "Falha ao contatar servidor de cotações.",
    };
  }
}

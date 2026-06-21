import { supabase } from "@/integrations/supabase/client";

type Quote = { price: number; change: number };

type QuotesResponse = {
  quotes: Record<string, Quote>;
  error: string | null;
};

export async function fetchQuotes(tickers: string[]): Promise<QuotesResponse> {
  const { data, error } = await supabase.functions.invoke<QuotesResponse>("quotes", {
    body: { tickers },
  });

  if (error) {
    return { quotes: {}, error: error.message };
  }

  return data ?? { quotes: {}, error: "A busca de cotacoes nao retornou dados." };
}
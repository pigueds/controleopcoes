const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Quote = { price: number; change: number };

async function fetchYahooQuote(ticker: string): Promise<Quote | null> {
  const yahooTicker = ticker.includes(".") ? ticker : `${ticker}.SA`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?range=1d&interval=1d`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) return null;

  const json = await response.json();
  const meta = json.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice) || 0;
  const previous = Number(meta?.chartPreviousClose) || 0;
  if (!price) return null;

  return { price, change: previous > 0 ? (price / previous - 1) * 100 : 0 };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const tickers = Array.from(
      new Set(
        (Array.isArray(body?.tickers) ? body.tickers : [])
          .map((ticker: unknown) => String(ticker).trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    if (tickers.length === 0) {
      return Response.json(
        { quotes: {}, error: "Informe ao menos um ticker." },
        { status: 400, headers: corsHeaders },
      );
    }

    const quotes: Record<string, Quote> = {};
    const params = new URLSearchParams({ range: "1d", interval: "1d" });
    const token = Deno.env.get("BRAPI_TOKEN");
    if (token) params.set("token", token);

    const brapiUrl = `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?${params}`;
    const brapiResponse = await fetch(brapiUrl, { headers: { Accept: "application/json" } });
    if (brapiResponse.ok) {
      const brapi = await brapiResponse.json();
      for (const result of brapi.results ?? []) {
        if (!result?.symbol) continue;
        quotes[String(result.symbol).trim().toUpperCase()] = {
          price: Number(result.regularMarketPrice) || 0,
          change: Number(result.regularMarketChangePercent) || 0,
        };
      }
    }

    const missing = tickers.filter((ticker) => !quotes[ticker]);
    await Promise.all(
      missing.map(async (ticker) => {
        const quote = await fetchYahooQuote(ticker);
        if (quote) quotes[ticker] = quote;
      }),
    );

    const stillMissing = tickers.filter((ticker) => !quotes[ticker]);
    return Response.json(
      {
        quotes,
        error: stillMissing.length > 0 ? `Sem cotacao para: ${stillMissing.join(", ")}` : null,
      },
      { headers: corsHeaders },
    );
  } catch (error) {
    return Response.json(
      { quotes: {}, error: error instanceof Error ? error.message : "Erro ao buscar cotacoes." },
      { status: 500, headers: corsHeaders },
    );
  }
});
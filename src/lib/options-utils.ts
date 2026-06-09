// Client-safe helpers for options + portfolio calculations.

export const MONTH_LETTERS: Record<string, { type: "CALL" | "PUT"; month: number }> = {
  A: { type: "CALL", month: 1 }, B: { type: "CALL", month: 2 }, C: { type: "CALL", month: 3 },
  D: { type: "CALL", month: 4 }, E: { type: "CALL", month: 5 }, F: { type: "CALL", month: 6 },
  G: { type: "CALL", month: 7 }, H: { type: "CALL", month: 8 }, I: { type: "CALL", month: 9 },
  J: { type: "CALL", month: 10 }, K: { type: "CALL", month: 11 }, L: { type: "CALL", month: 12 },
  M: { type: "PUT", month: 1 }, N: { type: "PUT", month: 2 }, O: { type: "PUT", month: 3 },
  P: { type: "PUT", month: 4 }, Q: { type: "PUT", month: 5 }, R: { type: "PUT", month: 6 },
  S: { type: "PUT", month: 7 }, T: { type: "PUT", month: 8 }, U: { type: "PUT", month: 9 },
  V: { type: "PUT", month: 10 }, W: { type: "PUT", month: 11 }, X: { type: "PUT", month: 12 },
};

export interface ParsedTicker {
  prefix: string;
  letter: string;
  type: "CALL" | "PUT" | null;
  month: number | null;
}

export function parseOptionTicker(ticker: string): ParsedTicker {
  const t = (ticker || "").trim().toUpperCase();
  const prefix = t.slice(0, 4);
  const letter = t.charAt(4);
  const info = MONTH_LETTERS[letter];
  return {
    prefix,
    letter,
    type: info?.type ?? null,
    month: info?.month ?? null,
  };
}

export function resolveStockTicker(
  optionTicker: string,
  refStocks: { prefix: string; stock_ticker: string }[],
): string | null {
  const { prefix } = parseOptionTicker(optionTicker);
  if (!prefix) return null;
  const match = refStocks.find((r) => r.prefix.toUpperCase() === prefix);
  return match?.stock_ticker ?? null;
}

export function resolveExpirationDate(
  entryDate: string,
  optionTicker: string,
  refExpirations: { year_month_key: number; expiration_date: string }[],
): string | null {
  const { month } = parseOptionTicker(optionTicker);
  if (!month) return null;
  const year = new Date(entryDate + "T00:00:00").getFullYear();
  const key = year * 100 + month;
  let match = refExpirations.find((r) => r.year_month_key === key);
  // If entry is after that month's expiration, roll to next year
  if (match && new Date(match.expiration_date) < new Date(entryDate)) {
    match = refExpirations.find((r) => r.year_month_key === (year + 1) * 100 + month);
  }
  return match?.expiration_date ?? null;
}

export function daysUntil(date: string | null | undefined): number {
  if (!date) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date + "T00:00:00");
  return Math.max(0, Math.round((d.getTime() - today.getTime()) / 86400000));
}

export function premiumTotal(quantity: number, entryPrice: number): number {
  return quantity * entryPrice;
}

export function strikeDiff(stockPrice: number, strike: number): number {
  if (!strike) return 0;
  return 1 - stockPrice / strike;
}

export function capitalCommitted(strike: number, quantity: number): number {
  return strike * quantity;
}

export function currentResult(
  premium: number,
  exitPrice: number | null | undefined,
  quantity: number,
): number | null {
  if (exitPrice == null) return null;
  return premium - exitPrice * quantity;
}

// Portfolio aggregation from movements
export interface MovementRow {
  stock_ticker: string;
  event_type: "SALDO_INICIAL" | "COMPRA" | "VENDA" | "EXERCICIO_PUT" | "EXERCICIO_CALL" | "AJUSTE";
  quantity: number;
  price: number;
  total_value: number;
}

export interface PositionAggregate {
  quantity: number;
  avgPrice: number;
}

const POSITIVE_EVENTS: MovementRow["event_type"][] = ["SALDO_INICIAL", "COMPRA", "EXERCICIO_PUT"];

export function aggregatePosition(rows: MovementRow[]): PositionAggregate {
  let qty = 0;
  let posValue = 0;
  let posQty = 0;
  for (const r of rows) {
    const signedQty = POSITIVE_EVENTS.includes(r.event_type)
      ? Math.abs(r.quantity)
      : r.event_type === "VENDA" || r.event_type === "EXERCICIO_CALL"
        ? -Math.abs(r.quantity)
        : r.quantity;
    qty += signedQty;
    if (POSITIVE_EVENTS.includes(r.event_type)) {
      posQty += Math.abs(r.quantity);
      posValue += Math.abs(r.quantity) * r.price;
    }
  }
  return { quantity: qty, avgPrice: posQty > 0 ? posValue / posQty : 0 };
}

export type CallCoverageStatus = "OK" | "VENDER_CALL" | "DESCOBERTA" | "NA";

export function callCoverage(stockQty: number, openCallsQty: number): CallCoverageStatus {
  if (stockQty <= 0) return "NA";
  if (openCallsQty <= 0) return "VENDER_CALL";
  if (openCallsQty <= stockQty) return "OK";
  return "DESCOBERTA";
}

export function recommendation(
  stockQty: number,
  openCallsQty: number,
  currentPrice: number,
  avgPrice: number,
): string {
  if (stockQty <= 0) return "AVALIAR PUT";
  if (openCallsQty > stockQty) return "CALL DESCOBERTA";
  if (openCallsQty <= 0) {
    return currentPrice >= avgPrice ? "VENDER CALL COBERTA" : "VENDER CALL";
  }
  return currentPrice < avgPrice ? "AVALIAR PUT P/ REDUZIR PM" : "AGUARDAR";
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

export const fmtPct = (n: number | null | undefined, digits = 2) =>
  n == null ? "—" : `${(n * 100).toFixed(digits)}%`;

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

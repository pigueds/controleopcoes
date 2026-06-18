// Helpers for option results and monthly P&L aggregation.

export type OptionRow = {
  id: string;
  option_ticker: string;
  option_type: "CALL" | "PUT";
  stock_ticker: string;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  entry_date: string;
  exit_date: string | null;
  expiration_date: string;
  status: "ABERTA" | "ENCERRADA" | "EXERCIDA";
};

/** Closing date used for tax/result purposes (BR mercado de opções). */
export function closingDate(o: OptionRow): string | null {
  if (o.status === "ABERTA") return null;
  return o.exit_date ?? o.expiration_date ?? null;
}

/**
 * Net premium result for the seller of the option.
 * - Premium received = entry_price * quantity
 * - Cost to close (recompra) = exit_price * quantity (0 if expired worthless)
 * - On exercise, the option lapses without a buyback cost; result = premium received.
 */
export function optionResult(o: OptionRow): number {
  const premium = Number(o.entry_price) * Number(o.quantity);
  if (o.status === "EXERCIDA") return premium;
  const exit = o.exit_price == null ? 0 : Number(o.exit_price) * Number(o.quantity);
  return premium - exit;
}

export type MonthBucket = {
  key: string; // YYYY-MM
  label: string; // ex "Jun/2025"
  result: number;
  premiumReceived: number;
  buybackCost: number;
  count: number;
};

const MONTH_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthKey(d: string): string {
  return d.slice(0, 7);
}
function labelFromKey(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_PT[Number(m) - 1]}/${y}`;
}

export function aggregateByMonth(options: OptionRow[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  for (const o of options) {
    const d = closingDate(o);
    if (!d) continue;
    const key = monthKey(d);
    const cur = map.get(key) ?? {
      key,
      label: labelFromKey(key),
      result: 0,
      premiumReceived: 0,
      buybackCost: 0,
      count: 0,
    };
    cur.premiumReceived += Number(o.entry_price) * Number(o.quantity);
    cur.buybackCost +=
      o.status === "EXERCIDA" || o.exit_price == null ? 0 : Number(o.exit_price) * Number(o.quantity);
    cur.result += optionResult(o);
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Returns last `count` months ending at `endKey` (YYYY-MM), filled with zeros when missing. */
export function fillLastMonths(buckets: MonthBucket[], endKey: string, count: number): MonthBucket[] {
  const [ey, em] = endKey.split("-").map(Number);
  const result: MonthBucket[] = [];
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(ey, em - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    result.push(
      byKey.get(key) ?? {
        key,
        label: labelFromKey(key),
        result: 0,
        premiumReceived: 0,
        buybackCost: 0,
        count: 0,
      },
    );
  }
  return result;
}

/** Accumulated loss from previous months (negative results), compensable per BR rules. */
export function accumulatedLossUpTo(buckets: MonthBucket[], monthKey: string): number {
  let acc = 0;
  for (const b of buckets) {
    if (b.key >= monthKey) break;
    // Apply month result against accumulated loss
    if (b.result < 0) acc += -b.result; // grows the loss pool
    else if (acc > 0) acc = Math.max(0, acc - b.result);
  }
  return acc;
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Parser for B3 "Extrato de Movimentação" .xlsx files.
// Classifies rows into option/stock operations and computes a stable hash for dedup.

import * as XLSX from "xlsx";
import { parseOptionTicker, resolveExpirationDate } from "@/lib/options-utils";

export type B3RawRow = {
  entrada_saida: string; // "Credito" | "Debito"
  date: string; // YYYY-MM-DD
  movimentacao: string; // "Compra" | "Venda" | ...
  produto: string;
  instituicao: string;
  quantity: number;
  price: number | null;
  total: number | null;
  raw: unknown[];
};

export type ParsedItem =
  | {
      kind: "OPTION_SELL"; // Venda de opção — abre posição
      hash: string;
      row: B3RawRow;
      option_ticker: string;
      option_type: "CALL" | "PUT";
      stock_ticker: string | null;
      quantity: number;
      entry_price: number;
      entry_date: string;
    }
  | {
      kind: "OPTION_BUY"; // Compra de opção — recompra/encerra
      hash: string;
      row: B3RawRow;
      option_ticker: string;
      option_type: "CALL" | "PUT";
      stock_ticker: string | null;
      quantity: number;
      exit_price: number;
      exit_date: string;
    }
  | {
      kind: "STOCK_BUY";
      hash: string;
      row: B3RawRow;
      stock_ticker: string;
      quantity: number;
      price: number;
      total: number;
      date: string;
    }
  | {
      kind: "STOCK_SELL";
      hash: string;
      row: B3RawRow;
      stock_ticker: string;
      quantity: number;
      price: number;
      total: number;
      date: string;
    }
  | {
      kind: "IGNORED";
      hash: string;
      row: B3RawRow;
      reason: string;
    };

function normalizeDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function toNumber(v: unknown): number | null {
  if (v == null || v === "-" || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function hashRow(row: B3RawRow, user_id: string): Promise<string> {
  const parts = [
    user_id,
    row.date,
    row.movimentacao,
    row.produto,
    row.entrada_saida,
    row.quantity,
    row.price ?? "",
    row.total ?? "",
  ].join("|");
  const buf = new TextEncoder().encode(parts);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isFixedIncomeOrFuture(produto: string): boolean {
  const p = produto.toUpperCase();
  return (
    p.startsWith("CDB") ||
    p.startsWith("TESOURO") ||
    p.startsWith("FUTURO") ||
    p.includes("LCA") ||
    p.includes("LCI") ||
    p.startsWith("LFT ")
  );
}

function parseOptionProduct(produto: string): {
  option_ticker: string;
  option_type: "CALL" | "PUT";
} | null {
  // "Opção de Venda - BBSES384 - BBSE" | "Opção de Compra - ITSAG137 - ITSA"
  const m = produto.match(/^Op[çc][ãa]o de (Venda|Compra)\s*-\s*([A-Z0-9]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  return {
    option_ticker: m[2].toUpperCase(),
    option_type: kind === "compra" ? "CALL" : "PUT", // "Opção de Compra" = CALL, "Opção de Venda" = PUT
  };
}

function parseStockProduct(produto: string): string | null {
  // "BBSE3 - NAME", "LFTB11 - INVESTO ETF ..."
  const m = produto.match(/^([A-Z]{3,5}\d{1,2}[A-Z]?)\s*-/);
  return m ? m[1].toUpperCase() : null;
}

export function parseSheet(file: ArrayBuffer): B3RawRow[] {
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const out: B3RawRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 6) continue;
    const date = normalizeDate(r[1]);
    if (!date) continue;
    const entrada_saida = String(r[0] ?? "").trim();
    const movimentacao = String(r[2] ?? "").trim();
    const produto = String(r[3] ?? "").trim();
    const instituicao = String(r[4] ?? "").trim();
    const quantity = toNumber(r[5]) ?? 0;
    const price = toNumber(r[6]);
    const total = toNumber(r[7]);
    if (!movimentacao || !produto) continue;
    out.push({ entrada_saida, date, movimentacao, produto, instituicao, quantity, price, total, raw: r });
  }
  return out;
}

export async function classifyRows(
  rows: B3RawRow[],
  user_id: string,
  refExpirations: { year_month_key: number; expiration_date: string }[],
): Promise<ParsedItem[]> {
  const items: ParsedItem[] = [];
  for (const row of rows) {
    const hash = await hashRow(row, user_id);
    const mov = row.movimentacao.toLowerCase();
    const produto = row.produto;

    if (isFixedIncomeOrFuture(produto)) {
      items.push({ kind: "IGNORED", hash, row, reason: "Renda fixa/futuro" });
      continue;
    }

    // Options
    if (/^op[çc][ãa]o/i.test(produto)) {
      const opt = parseOptionProduct(produto);
      if (!opt) {
        items.push({ kind: "IGNORED", hash, row, reason: "Opção não reconhecida" });
        continue;
      }
      const { option_ticker, option_type } = opt;
      const stock_ticker = null;
      if (row.price == null || row.quantity <= 0) {
        items.push({ kind: "IGNORED", hash, row, reason: "Opção sem preço/quantidade" });
        continue;
      }
      if (mov === "venda") {
        // vendemos a opção (abre posição short)
        items.push({
          kind: "OPTION_SELL",
          hash,
          row,
          option_ticker,
          option_type,
          stock_ticker,
          quantity: row.quantity,
          entry_price: row.price,
          entry_date: row.date,
        });
      } else if (mov === "compra") {
        // compramos (recompra para encerrar)
        items.push({
          kind: "OPTION_BUY",
          hash,
          row,
          option_ticker,
          option_type,
          stock_ticker,
          quantity: row.quantity,
          exit_price: row.price,
          exit_date: row.date,
        });
      } else {
        items.push({ kind: "IGNORED", hash, row, reason: `Opção: mov "${row.movimentacao}"` });
      }
      // We may still want to compute expiration_date later (needs prefix lookup)
      // handled at insert time
      void refExpirations;
      continue;
    }

    // Stocks/ETFs/FIIs
    const stock_ticker = parseStockProduct(produto);
    if (!stock_ticker) {
      items.push({ kind: "IGNORED", hash, row, reason: `Produto não reconhecido: ${produto.slice(0, 40)}` });
      continue;
    }
    if (row.price == null || row.quantity <= 0 || row.total == null) {
      items.push({ kind: "IGNORED", hash, row, reason: `${stock_ticker}: sem preço/quantidade` });
      continue;
    }

    if (mov === "compra" || mov === "transferência - liquidação" || mov === "transferencia - liquidação" || mov === "transferência - liquidacao") {
      items.push({
        kind: "STOCK_BUY",
        hash,
        row,
        stock_ticker,
        quantity: row.quantity,
        price: row.price,
        total: row.total,
        date: row.date,
      });
    } else if (mov === "venda") {
      items.push({
        kind: "STOCK_SELL",
        hash,
        row,
        stock_ticker,
        quantity: row.quantity,
        price: row.price,
        total: row.total,
        date: row.date,
      });
    } else {
      items.push({ kind: "IGNORED", hash, row, reason: `${stock_ticker}: ${row.movimentacao}` });
    }
  }
  return items;
}

// Compute expiration_date for an option using its ticker + entry date + reference_expirations
export function optionExpiration(
  option_ticker: string,
  date: string,
  refExpirations: { year_month_key: number; expiration_date: string }[],
): string | null {
  const parsed = parseOptionTicker(option_ticker);
  if (!parsed.month) return null;
  return resolveExpirationDate(date, option_ticker, refExpirations);
}

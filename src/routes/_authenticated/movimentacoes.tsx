import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { closingDate, optionResult, type OptionRow } from "@/lib/results-utils";
import { fmtMoney } from "@/lib/options-utils";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/movimentacoes")({
  component: MovimentacoesPage,
});

type Movement = {
  id: string;
  date: string;
  stock_ticker: string;
  event_type: string;
  quantity: number;
  price: number;
  total_value: number;
  origin: string | null;
};

type Row = {
  id: string;
  date: string;
  ticker: string;
  type: string;
  quantity: number;
  price: number;
  total: number;
  origin: string;
  sign: number; // for color
};

function MovimentacoesPage() {
  const [ticker, setTicker] = useState("");
  const [type, setType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const movsQ = useQuery({
    queryKey: ["movements_full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Movement[];
    },
  });

  const optsQ = useQuery({
    queryKey: ["options_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("options").select("*");
      if (error) throw error;
      return (data ?? []) as OptionRow[];
    },
  });

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (const m of movsQ.data ?? []) {
      list.push({
        id: m.id,
        date: m.date,
        ticker: m.stock_ticker,
        type: m.event_type,
        quantity: Number(m.quantity),
        price: Number(m.price),
        total: Number(m.total_value),
        origin: m.origin ?? "",
        sign: m.event_type === "VENDA" ? 1 : m.event_type === "COMPRA" ? -1 : 0,
      });
    }
    for (const o of optsQ.data ?? []) {
      const d = closingDate(o);
      if (!d) continue;
      const res = optionResult(o);
      list.push({
        id: `opt-${o.id}`,
        date: d,
        ticker: o.option_ticker,
        type: o.option_type === "CALL" ? "PRÊMIO CALL" : "PRÊMIO PUT",
        quantity: Number(o.quantity),
        price: Number(o.entry_price),
        total: res,
        origin: o.status === "EXERCIDA" ? "Exercida" : o.exit_price == null ? "Virou pó" : "Recomprada",
        sign: res >= 0 ? 1 : -1,
      });
    }
    return list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [movsQ.data, optsQ.data]);

  const types = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.type));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (ticker && !r.ticker.toLowerCase().includes(ticker.toLowerCase())) return false;
        if (type !== "ALL" && r.type !== type) return false;
        if (from && r.date < from) return false;
        if (to && r.date > to) return false;
        return true;
      }),
    [rows, ticker, type, from, to],
  );

  const exportCsv = () => {
    const header = ["Data", "Ticker", "Tipo", "Quantidade", "Preço", "Valor", "Origem"];
    const lines = [
      header.join(";"),
      ...filtered.map((r) =>
        [r.date, r.ticker, r.type, r.quantity, r.price.toFixed(2), r.total.toFixed(2), r.origin]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(";"),
      ),
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimentacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Histórico de movimentações</h1>
          <p className="text-sm text-muted-foreground">
            Operações de ações e prêmios de opções encerradas
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Exportar CSV</Button>
      </div>

      <Card className="bg-surface border-border p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Ticker</label>
            <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="PETR4" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tipo</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Origem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhuma movimentação
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.date.split("-").reverse().join("/")}</TableCell>
                  <TableCell className="font-mono">{r.ticker}</TableCell>
                  <TableCell className="text-xs">{r.type}</TableCell>
                  <TableCell className="text-right tabular">{r.quantity}</TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(r.price)}</TableCell>
                  <TableCell
                    className={`text-right tabular font-medium ${
                      r.sign > 0 ? "text-profit" : r.sign < 0 ? "text-loss" : ""
                    }`}
                  >
                    {fmtMoney(r.total)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.origin}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

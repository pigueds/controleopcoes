import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRefExpirations, useRefStocks } from "@/hooks/use-references";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import {
  capitalCommitted, currentResult, daysUntil, fmtDate, fmtMoney, fmtPct,
  parseOptionTicker, premiumTotal, resolveExpirationDate, resolveStockTicker, strikeDiff,
} from "@/lib/options-utils";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type OptionRow = {
  id: string; option_type: "CALL" | "PUT"; entry_date: string; quantity: number;
  option_ticker: string; entry_price: number; strike: number; stock_ticker: string;
  expiration_date: string; status: "ABERTA" | "ENCERRADA" | "EXERCIDA";
  exit_price: number | null; exit_date: string | null;
};

export function OptionsPage({ kind }: { kind: "CALL" | "PUT" }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "ABERTA" | "ENCERRADA" | "EXERCIDA">("ALL");

  const optionsQ = useQuery({
    queryKey: ["options", kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("options").select("*")
        .eq("option_type", kind).order("expiration_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OptionRow[];
    },
  });
  const stocksQ = useQuery({
    queryKey: ["stocks-prices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stocks").select("ticker, current_price");
      if (error) throw error;
      return data ?? [];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("options").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["options", kind] }); toast.success("Removido"); },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, exit_price, exit_date }: { id: string; status: OptionRow["status"]; exit_price?: number | null; exit_date?: string | null }) => {
      const { error } = await supabase.from("options").update({ status, exit_price: exit_price ?? null, exit_date: exit_date ?? null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["options", kind] }); toast.success("Atualizado"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const stockPrice = (ticker: string) =>
    Number(stocksQ.data?.find((s) => s.ticker === ticker)?.current_price ?? 0);

  const list = useMemo(() => {
    const data = optionsQ.data ?? [];
    return filter === "ALL" ? data : data.filter((o) => o.status === filter);
  }, [optionsQ.data, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{kind === "CALL" ? "Calls" : "Puts"}</h1>
          <p className="text-sm text-muted-foreground">
            {kind === "CALL" ? "Venda de calls cobertas" : "Venda de puts"}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={filter} onValueChange={(v) => setFilter(v as never)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos status</SelectItem>
              <SelectItem value="ABERTA">Aberta</SelectItem>
              <SelectItem value="ENCERRADA">Encerrada</SelectItem>
              <SelectItem value="EXERCIDA">Exercida</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> Nova {kind === "CALL" ? "call" : "put"}</Button></DialogTrigger>
            <OptionDialog kind={kind} onClose={() => setOpen(false)} />
          </Dialog>
        </div>
      </div>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entrada</TableHead>
                <TableHead>Ticker opção</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço entrada</TableHead>
                <TableHead className="text-right">Strike</TableHead>
                <TableHead className="text-right">Strike dif %</TableHead>
                {kind === "PUT" && <TableHead className="text-right">Cap. comprometido</TableHead>}
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead className="text-right">Prêmio</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">L/P</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 && (
                <TableRow><TableCell colSpan={kind === "PUT" ? 14 : 13} className="text-center text-muted-foreground py-10">
                  Nenhuma operação registrada.
                </TableCell></TableRow>
              )}
              {list.map((o) => {
                const sPrice = stockPrice(o.stock_ticker);
                const premio = premiumTotal(Number(o.quantity), Number(o.entry_price));
                const diff = strikeDiff(sPrice, Number(o.strike));
                const dias = daysUntil(o.expiration_date);
                const result = o.status === "ENCERRADA"
                  ? currentResult(premio, Number(o.exit_price), Number(o.quantity))
                  : null;
                return (
                  <TableRow key={o.id}>
                    <TableCell>{fmtDate(o.entry_date)}</TableCell>
                    <TableCell className="font-mono">{o.option_ticker}</TableCell>
                    <TableCell className="font-mono text-xs">{o.stock_ticker}</TableCell>
                    <TableCell className="text-right tabular">{o.quantity}</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(Number(o.entry_price))}</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(Number(o.strike))}</TableCell>
                    <TableCell className={`text-right tabular ${diff >= 0 ? "text-profit" : "text-loss"}`}>{fmtPct(diff)}</TableCell>
                    {kind === "PUT" && <TableCell className="text-right tabular">{fmtMoney(capitalCommitted(Number(o.strike), Number(o.quantity)))}</TableCell>}
                    <TableCell>{fmtDate(o.expiration_date)}</TableCell>
                    <TableCell className="text-right tabular">
                      <StatusBadge variant={dias <= 7 ? "warn" : "neutral"}>{dias}d</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(premio)}</TableCell>
                    <TableCell>
                      <Select value={o.status} onValueChange={(v) => {
                        if (v === "ENCERRADA") {
                          const ep = prompt("Preço de saída?");
                          if (ep == null) return;
                          updateStatus.mutate({ id: o.id, status: "ENCERRADA", exit_price: Number(ep), exit_date: new Date().toISOString().slice(0, 10) });
                        } else if (v === "EXERCIDA") {
                          updateStatus.mutate({ id: o.id, status: "EXERCIDA", exit_date: new Date().toISOString().slice(0, 10), exit_price: Number(o.strike) });
                        } else {
                          updateStatus.mutate({ id: o.id, status: "ABERTA", exit_price: null, exit_date: null });
                        }
                      }}>
                        <SelectTrigger className="h-7 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ABERTA">ABERTA</SelectItem>
                          <SelectItem value="ENCERRADA">ENCERRADA</SelectItem>
                          <SelectItem value="EXERCIDA">EXERCIDA</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className={`text-right tabular ${(result ?? 0) >= 0 ? "text-profit" : "text-loss"}`}>
                      {result == null ? "—" : fmtMoney(result)}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => remove.mutate(o.id)}>
                        <Trash2 className="h-4 w-4 text-loss" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function OptionDialog({ kind, onClose }: { kind: "CALL" | "PUT"; onClose: () => void }) {
  const qc = useQueryClient();
  const refStocks = useRefStocks();
  const refExp = useRefExpirations();

  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [ticker, setTicker] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [strike, setStrike] = useState("");
  const [stockTicker, setStockTicker] = useState("");
  const [expDate, setExpDate] = useState("");

  // Auto-fill from ticker
  useEffect(() => {
    if (!ticker || !refStocks.data || !refExp.data) return;
    const parsed = parseOptionTicker(ticker);
    if (parsed.type && parsed.type !== kind) {
      // mismatch is just visual, but warn
    }
    const stk = resolveStockTicker(ticker, refStocks.data);
    if (stk && !stockTicker) setStockTicker(stk);
    const exp = resolveExpirationDate(entryDate, ticker, refExp.data);
    if (exp && !expDate) setExpDate(exp);
  }, [ticker, entryDate, refStocks.data, refExp.data]);

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      if (!expDate) throw new Error("Vencimento não identificado — verifique o ticker ou cadastre a referência");
      if (!stockTicker) throw new Error("Ação relacionada não identificada");
      const { error } = await supabase.from("options").insert({
        user_id: u.user.id,
        option_type: kind,
        entry_date: entryDate,
        quantity: Number(quantity),
        option_ticker: ticker.toUpperCase(),
        entry_price: Number(entryPrice),
        strike: Number(strike),
        stock_ticker: stockTicker,
        expiration_date: expDate,
        status: "ABERTA",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["options", kind] }); toast.success("Operação registrada"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const parsed = ticker ? parseOptionTicker(ticker) : null;

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nova {kind === "CALL" ? "call" : "put"}</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Data de entrada</Label><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
          <div><Label>Quantidade</Label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
        </div>
        <div><Label>Ticker da opção</Label>
          <Input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="ITSAE146" />
          {parsed && (
            <p className="text-xs text-muted-foreground mt-1">
              Detectado: {parsed.type ?? "?"} • mês {parsed.month ?? "?"} • ativo {stockTicker || "?"} • venc. {expDate ? fmtDate(expDate) : "?"}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Preço de entrada</Label><Input type="number" step="0.01" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} /></div>
          <div><Label>Strike</Label><Input type="number" step="0.01" value={strike} onChange={(e) => setStrike(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Ação relacionada</Label><Input value={stockTicker} onChange={(e) => setStockTicker(e.target.value.toUpperCase())} /></div>
          <div><Label>Vencimento</Label><Input type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => create.mutate()} disabled={!ticker || !quantity || !entryPrice || !strike}>Salvar</Button>
      </DialogFooter>
    </DialogContent>
  );
}

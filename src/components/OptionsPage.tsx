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
  parseOptionTicker, premiumTotal, resolveExpirationDate, resolveStockTicker,
} from "@/lib/options-utils";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
  const [editing, setEditing] = useState<OptionRow | null>(null);
  const [filter, setFilter] = useState<"ALL" | "ABERTA" | "ENCERRADA" | "EXERCIDA">("ALL");

  const optionsQ = useQuery({
    queryKey: ["options", kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("options").select("*")
        .eq("option_type", kind);
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
    mutationFn: async ({ opt, status, exit_price, exit_date }: { opt: OptionRow; status: OptionRow["status"]; exit_price?: number | null; exit_date?: string | null }) => {
      const { error } = await supabase.from("options")
        .update({ status, exit_price: exit_price ?? null, exit_date: exit_date ?? null })
        .eq("id", opt.id);
      if (error) throw error;

      // PUT exercida → incorporar ações na carteira (movimento EXERCICIO_PUT usa strike como preço).
      if (status === "EXERCIDA" && opt.option_type === "PUT") {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const qty = Number(opt.quantity);
        const strike = Number(opt.strike);
        const date = exit_date ?? new Date().toISOString().slice(0, 10);

        // Garante que ativo exista na carteira; se não, cria.
        const { data: existing } = await supabase
          .from("stocks").select("id").eq("ticker", opt.stock_ticker).maybeSingle();
        if (!existing) {
          await supabase.from("stocks").insert({
            user_id: u.user.id,
            ticker: opt.stock_ticker,
            asset_type: "ACAO" as never,
            current_price: strike,
            daily_change: 0,
            manual_avg_price: null,
          });
        }
        const { error: mErr } = await supabase.from("stock_movements").insert({
          user_id: u.user.id,
          stock_ticker: opt.stock_ticker,
          event_type: "EXERCICIO_PUT" as never,
          date,
          quantity: qty,
          price: strike,
          total_value: qty * strike,
          origin: `PUT exercida ${opt.option_ticker}`,
        });
        if (mErr) throw mErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["options", kind] });
      qc.invalidateQueries({ queryKey: ["stocks"] });
      qc.invalidateQueries({ queryKey: ["movements"] });
      qc.invalidateQueries({ queryKey: ["stocks-prices"] });
      qc.invalidateQueries({ queryKey: ["lftb-position"] });
      toast.success("Atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const stockPrice = (ticker: string) =>
    Number(stocksQ.data?.find((s) => s.ticker === ticker)?.current_price ?? 0);

  const list = useMemo(() => {
    const data = optionsQ.data ?? [];
    const filtered = filter === "ALL" ? data : data.filter((o) => o.status === filter);
    // Ordenação: ABERTAs primeiro (mais próximas do vencimento antes), depois demais (mais recentes antes)
    return [...filtered].sort((a, b) => {
      const aOpen = a.status === "ABERTA" ? 0 : 1;
      const bOpen = b.status === "ABERTA" ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      if (aOpen === 0) return a.expiration_date.localeCompare(b.expiration_date);
      return b.expiration_date.localeCompare(a.expiration_date);
    });
  }, [optionsQ.data, filter]);

  const totalCapitalPuts = useMemo(() => {
    if (kind !== "PUT") return 0;
    return list
      .filter((o) => o.status === "ABERTA")
      .reduce((acc, o) => acc + capitalCommitted(Number(o.strike), Number(o.quantity)), 0);
  }, [list, kind]);

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
                <TableHead className="text-right">Preço ação</TableHead>
                <TableHead className="text-right">Strike dif %</TableHead>
                <TableHead className="text-right">% Prêmio</TableHead>
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
                <TableRow><TableCell colSpan={kind === "PUT" ? 16 : 15} className="text-center text-muted-foreground py-10">
                  Nenhuma operação registrada.
                </TableCell></TableRow>
              )}
              {list.map((o) => {
                const sPrice = stockPrice(o.stock_ticker);
                const premio = premiumTotal(Number(o.quantity), Number(o.entry_price));
                // Diff: (preço ação - strike) / strike — positivo = ação acima do strike
                const diff = Number(o.strike) > 0 ? (sPrice - Number(o.strike)) / Number(o.strike) : 0;
                const pctPremio = Number(o.strike) > 0 ? Number(o.entry_price) / Number(o.strike) : 0;
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
                    <TableCell className="text-right tabular">{sPrice > 0 ? fmtMoney(sPrice) : "—"}</TableCell>
                    <TableCell className={`text-right tabular ${diff >= 0 ? "text-profit" : "text-loss"}`}>{sPrice > 0 ? fmtPct(diff) : "—"}</TableCell>
                    <TableCell className="text-right tabular">{fmtPct(pctPremio)}</TableCell>
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
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(o)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove.mutate(o.id)}>
                          <Trash2 className="h-4 w-4 text-loss" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {kind === "PUT" && (
        <Card className="bg-surface border-border p-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Capital comprometido com puts abertas (notional)</span>
          <span className="text-lg font-semibold tabular">{fmtMoney(totalCapitalPuts)}</span>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        {editing && <OptionDialog kind={kind} option={editing} onClose={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function OptionDialog({ kind, onClose, option }: { kind: "CALL" | "PUT"; onClose: () => void; option?: OptionRow }) {
  const qc = useQueryClient();
  const refStocks = useRefStocks();
  const refExp = useRefExpirations();
  const isEdit = !!option;

  const [entryDate, setEntryDate] = useState(option?.entry_date ?? new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState(option ? String(option.quantity) : "");
  const [ticker, setTicker] = useState(option?.option_ticker ?? "");
  const [entryPrice, setEntryPrice] = useState(option ? String(option.entry_price) : "");
  const [strike, setStrike] = useState(option ? String(option.strike) : "");
  const [stockTicker, setStockTicker] = useState(option?.stock_ticker ?? "");
  const [expDate, setExpDate] = useState(option?.expiration_date ?? "");

  // Auto-fill from ticker (apenas em criação)
  useEffect(() => {
    if (isEdit) return;
    if (!ticker || !refStocks.data || !refExp.data) return;
    const stk = resolveStockTicker(ticker, refStocks.data);
    if (stk && !stockTicker) setStockTicker(stk);
    const exp = resolveExpirationDate(entryDate, ticker, refExp.data);
    if (exp && !expDate) setExpDate(exp);
  }, [ticker, entryDate, refStocks.data, refExp.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!expDate) throw new Error("Vencimento não identificado");
      if (!stockTicker) throw new Error("Ação relacionada não identificada");
      const payload = {
        option_type: kind,
        entry_date: entryDate,
        quantity: Number(quantity),
        option_ticker: ticker.toUpperCase(),
        entry_price: Number(entryPrice),
        strike: Number(strike),
        stock_ticker: stockTicker.toUpperCase(),
        expiration_date: expDate,
      };
      if (isEdit && option) {
        const { error } = await supabase.from("options").update(payload).eq("id", option.id);
        if (error) throw error;
      } else {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Não autenticado");
        const { error } = await supabase.from("options").insert({ ...payload, user_id: u.user.id, status: "ABERTA" });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["options", kind] }); toast.success(isEdit ? "Atualizada" : "Operação registrada"); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const parsed = ticker ? parseOptionTicker(ticker) : null;

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isEdit ? "Editar" : "Nova"} {kind === "CALL" ? "call" : "put"}</DialogTitle></DialogHeader>
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
        <Button onClick={() => save.mutate()} disabled={!ticker || !quantity || !entryPrice || !strike}>Salvar</Button>
      </DialogFooter>
    </DialogContent>
  );
}

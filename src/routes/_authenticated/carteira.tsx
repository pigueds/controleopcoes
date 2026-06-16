import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { aggregatePosition, callCoverage, fmtMoney, fmtPct, recommendation } from "@/lib/options-utils";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

async function fetchQuote(ticker: string): Promise<{ price: number; change: number } | null> {
  try {
    const res = await fetch(`https://brapi.dev/api/quote/${ticker}?range=1d&interval=1d`);
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.results?.[0];
    if (!r) return null;
    return { price: Number(r.regularMarketPrice) || 0, change: Number(r.regularMarketChangePercent) || 0 };
  } catch { return null; }
}

async function fetchQuotesBatch(tickers: string[]): Promise<Record<string, { price: number; change: number }>> {
  const out: Record<string, { price: number; change: number }> = {};
  if (!tickers.length) return out;
  try {
    const res = await fetch(`https://brapi.dev/api/quote/${tickers.join(",")}?range=1d&interval=1d`);
    if (!res.ok) return out;
    const json = await res.json();
    for (const r of json?.results ?? []) {
      if (r?.symbol) out[r.symbol] = {
        price: Number(r.regularMarketPrice) || 0,
        change: Number(r.regularMarketChangePercent) || 0,
      };
    }
  } catch {/* ignore */}
  return out;
}

export const Route = createFileRoute("/_authenticated/carteira")({
  component: CarteiraPage,
});

type Stock = {
  id: string; ticker: string; asset_type: string;
  current_price: number; daily_change: number; manual_avg_price: number | null;
};

function CarteiraPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const stocksQ = useQuery({
    queryKey: ["stocks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stocks").select("*").order("ticker");
      if (error) throw error;
      return (data ?? []) as Stock[];
    },
  });

  const movementsQ = useQuery({
    queryKey: ["movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("stock_ticker, event_type, quantity, price, total_value");
      if (error) throw error;
      return data ?? [];
    },
  });

  const openCallsQ = useQuery({
    queryKey: ["open_calls"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("options")
        .select("stock_ticker, quantity")
        .eq("option_type", "CALL")
        .eq("status", "ABERTA");
      if (error) throw error;
      return data ?? [];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stocks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stocks"] }); toast.success("Removido"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => {
    if (!stocksQ.data) return [];
    return stocksQ.data.map((s) => {
      const moves = (movementsQ.data ?? []).filter((m) => m.stock_ticker === s.ticker);
      const agg = aggregatePosition(moves as never);
      const avg = s.manual_avg_price ?? agg.avgPrice;
      const openCalls = (openCallsQ.data ?? [])
        .filter((c) => c.stock_ticker === s.ticker)
        .reduce((a, c) => a + Number(c.quantity), 0);
      const montante = agg.quantity * s.current_price;
      const pnlPct = avg > 0 ? s.current_price / avg - 1 : 0;
      const cover = callCoverage(agg.quantity, openCalls);
      const rec = recommendation(agg.quantity, openCalls, s.current_price, avg);
      return { s, qty: agg.quantity, avg, openCalls, montante, pnlPct, cover, rec };
    });
  }, [stocksQ.data, movementsQ.data, openCallsQ.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Carteira</h1>
          <p className="text-sm text-muted-foreground">Ações, FIIs e ETFs do portfólio</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={async () => {
            const list = stocksQ.data ?? [];
            if (!list.length) return;
            toast.info("Atualizando cotações...");
            let ok = 0;
            for (const s of list) {
              const q = await fetchQuote(s.ticker);
              if (q) {
                const { error } = await supabase.from("stocks")
                  .update({ current_price: q.price, daily_change: q.change })
                  .eq("id", s.id);
                if (!error) ok++;
              }
              await new Promise((r) => setTimeout(r, 350));
            }
            qc.invalidateQueries({ queryKey: ["stocks"] });
            toast.success(`${ok}/${list.length} cotações atualizadas`);
          }}>
            <RefreshCw className="h-4 w-4" /> Atualizar preços
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4" /> Novo ativo</Button>
            </DialogTrigger>
            <StockDialog onClose={() => setOpen(false)} />
          </Dialog>
        </div>
      </div>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Preço atual</TableHead>
                <TableHead className="text-right">Var. dia</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">PM</TableHead>
                <TableHead className="text-right">Montante</TableHead>
                <TableHead className="text-right">L/P %</TableHead>
                <TableHead className="text-right">Calls abertas</TableHead>
                <TableHead>Cobertura</TableHead>
                <TableHead>Recomendação</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-10">
                  Nenhum ativo cadastrado. Adicione seu primeiro ativo.
                </TableCell></TableRow>
              )}
              {rows.map(({ s, qty, avg, openCalls, montante, pnlPct, cover, rec }) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium font-mono">{s.ticker}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.asset_type}</TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(s.current_price)}</TableCell>
                  <TableCell className={`text-right tabular ${s.daily_change >= 0 ? "text-profit" : "text-loss"}`}>{fmtPct(s.daily_change / 100)}</TableCell>
                  <TableCell className="text-right tabular">{qty}</TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(avg)}</TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(montante)}</TableCell>
                  <TableCell className={`text-right tabular ${pnlPct >= 0 ? "text-profit" : "text-loss"}`}>{fmtPct(pnlPct)}</TableCell>
                  <TableCell className="text-right tabular">{openCalls}</TableCell>
                  <TableCell>
                    <StatusBadge variant={cover === "OK" ? "profit" : cover === "DESCOBERTA" ? "loss" : cover === "VENDER_CALL" ? "warn" : "neutral"}>
                      {cover === "VENDER_CALL" ? "VENDER CALL" : cover === "NA" ? "N/A" : cover}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs">{rec}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(s.id)}>
                      <Trash2 className="h-4 w-4 text-loss" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function StockDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [ticker, setTicker] = useState("");
  const [assetType, setAssetType] = useState("ACAO");
  const [price, setPrice] = useState("");
  const [change, setChange] = useState("0");
  const [avg, setAvg] = useState("");
  const [qty, setQty] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const tk = ticker.toUpperCase().trim();
      const quantity = Number(qty) || 0;
      const avgNum = avg ? Number(avg) : null;
      const { error } = await supabase.from("stocks").insert({
        user_id: u.user.id,
        ticker: tk,
        asset_type: assetType as never,
        current_price: Number(price) || 0,
        daily_change: Number(change) || 0,
        manual_avg_price: avgNum,
      });
      if (error) throw error;
      if (quantity > 0) {
        const unit = avgNum ?? Number(price) ?? 0;
        const { error: mErr } = await supabase.from("stock_movements").insert({
          user_id: u.user.id,
          stock_ticker: tk,
          event_type: "SALDO_INICIAL" as never,
          date: new Date().toISOString().slice(0, 10),
          quantity,
          price: unit,
          total_value: quantity * unit,
          origin: "Cadastro inicial",
        });
        if (mErr) throw mErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stocks"] });
      qc.invalidateQueries({ queryKey: ["movements"] });
      toast.success("Ativo cadastrado");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Novo ativo</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div><Label>Ticker</Label><Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="PETR4" /></div>
        <div>
          <Label>Tipo</Label>
          <Select value={assetType} onValueChange={setAssetType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ACAO">Ação</SelectItem>
              <SelectItem value="FII">FII</SelectItem>
              <SelectItem value="ETF">ETF</SelectItem>
              <SelectItem value="RENDA_FIXA">Renda Fixa</SelectItem>
              <SelectItem value="OUTRO">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Preço atual</Label><Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><Label>Var. dia (%)</Label><Input type="number" step="0.01" value={change} onChange={(e) => setChange(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Quantidade</Label><Input type="number" step="1" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="100" /></div>
          <div><Label>Preço médio (opcional)</Label><Input type="number" step="0.01" value={avg} onChange={(e) => setAvg(e.target.value)} /></div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={async () => {
          if (!ticker) return toast.error("Informe o ticker");
          const q = await fetchQuote(ticker.toUpperCase().trim());
          if (!q) return toast.error("Não foi possível buscar cotação");
          setPrice(String(q.price));
          setChange(String(q.change));
          toast.success("Cotação atualizada");
        }}>
          <RefreshCw className="h-3 w-3" /> Buscar cotação
        </Button>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={() => create.mutate()} disabled={!ticker || !price}>Salvar</Button>
      </DialogFooter>
    </DialogContent>
  );
}

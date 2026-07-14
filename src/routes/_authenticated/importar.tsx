import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { classifyRows, parseSheet, optionExpiration, type ParsedItem } from "@/lib/b3-import";
import { useRefExpirations, useRefStocks } from "@/hooks/use-references";
import { resolveStockTicker } from "@/lib/options-utils";

export const Route = createFileRoute("/_authenticated/importar")({
  component: ImportarPage,
});

type ClassifiedState = {
  fileName: string;
  items: ParsedItem[];
  existingHashes: Set<string>;
};

function ImportarPage() {
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const refStocksQ = useRefStocks();
  const refExpQ = useRefExpirations();
  const [state, setState] = useState<ClassifiedState | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const rows = parseSheet(buf);
      const items = await classifyRows(rows, user.id, refExpQ.data ?? []);
      const hashes = items.map((i) => i.hash);
      // Chunk lookup to avoid URL length issues on very large imports
      const existingSet = new Set<string>();
      const CHUNK = 200;
      for (let i = 0; i < hashes.length; i += CHUNK) {
        const slice = hashes.slice(i, i + CHUNK);
        const { data: existing, error } = await supabase
          .from("imported_movements")
          .select("source_hash")
          .in("source_hash", slice);
        if (error) throw error;
        for (const r of existing ?? []) existingSet.add(r.source_hash);
      }
      setState({ fileName: file.name, items, existingHashes: existingSet });
      toast.success(`${rows.length} linhas lidas`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    if (!state) return null;
    const news = state.items.filter((i) => !state.existingHashes.has(i.hash) && i.kind !== "IGNORED");
    const dup = state.items.filter((i) => state.existingHashes.has(i.hash));
    const ignored = state.items.filter((i) => i.kind === "IGNORED" && !state.existingHashes.has(i.hash));
    return {
      news,
      dup,
      ignored,
      optionSells: news.filter((i) => i.kind === "OPTION_SELL"),
      optionBuys: news.filter((i) => i.kind === "OPTION_BUY"),
      stockBuys: news.filter((i) => i.kind === "STOCK_BUY"),
      stockSells: news.filter((i) => i.kind === "STOCK_SELL"),
    };
  }, [state]);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!state || !groups) return;
      const refStocks = refStocksQ.data ?? [];
      const refExp = refExpQ.data ?? [];
      const fileName = state.fileName;
      const toMarkImported: { source_hash: string; movement_date: string; raw: unknown }[] = [];
      let ok = 0;
      let fail = 0;
      const failures: string[] = [];

      // 1) Stock movements + ensure stocks row
      const stockOps = [...groups.stockBuys, ...groups.stockSells];
      for (const it of stockOps) {
        if (it.kind !== "STOCK_BUY" && it.kind !== "STOCK_SELL") continue;
        try {
          // ensure stock row exists
          const { data: existing } = await supabase
            .from("stocks")
            .select("id")
            .eq("ticker", it.stock_ticker)
            .maybeSingle();
          if (!existing) {
            const { error: sErr } = await supabase.from("stocks").insert({
              user_id: user.id,
              ticker: it.stock_ticker,
              asset_type: "ACAO",
              current_price: 0,
            });
            if (sErr) throw sErr;
          }
          const { error: mErr } = await supabase.from("stock_movements").insert({
            user_id: user.id,
            date: it.date,
            stock_ticker: it.stock_ticker,
            event_type: it.kind === "STOCK_BUY" ? "COMPRA" : "VENDA",
            quantity: it.quantity,
            price: it.price,
            total_value: it.total,
            origin: `B3 import: ${fileName}`,
          });
          if (mErr) throw mErr;
          toMarkImported.push({ source_hash: it.hash, movement_date: it.date, raw: it.row.raw });
          ok++;
        } catch (e) {
          fail++;
          failures.push(`${it.stock_ticker} ${it.date}: ${(e as Error).message}`);
        }
      }

      // 2) Option sells (open positions)
      for (const it of groups.optionSells) {
        if (it.kind !== "OPTION_SELL") continue;
        try {
          const stock_ticker = resolveStockTicker(it.option_ticker, refStocks) ?? "";
          const expiration = optionExpiration(it.option_ticker, it.entry_date, refExp);
          const { error } = await supabase.from("options").insert({
            user_id: user.id,
            option_ticker: it.option_ticker,
            option_type: it.option_type,
            stock_ticker,
            strike: 0,
            entry_price: it.entry_price,
            quantity: it.quantity,
            entry_date: it.entry_date,
            expiration_date: expiration ?? it.entry_date,
            status: "ABERTA",
            needs_review: true,
            notes: `Importado do extrato B3 (${fileName})`,
          });
          if (error) throw error;
          toMarkImported.push({ source_hash: it.hash, movement_date: it.entry_date, raw: it.row.raw });
          ok++;
        } catch (e) {
          fail++;
          failures.push(`${it.option_ticker} venda: ${(e as Error).message}`);
        }
      }

      // 3) Option buys (close matching open positions)
      for (const it of groups.optionBuys) {
        if (it.kind !== "OPTION_BUY") continue;
        try {
          const { data: matches } = await supabase
            .from("options")
            .select("id, quantity, entry_price, entry_date")
            .eq("option_ticker", it.option_ticker)
            .eq("status", "ABERTA")
            .order("entry_date", { ascending: true });
          const match = (matches ?? [])[0];
          if (match) {
            const { error } = await supabase
              .from("options")
              .update({
                exit_price: it.exit_price,
                exit_date: it.exit_date,
                status: "ENCERRADA",
              })
              .eq("id", match.id);
            if (error) throw error;
          } else {
            const stock_ticker = resolveStockTicker(it.option_ticker, refStocks) ?? "";
            const expiration = optionExpiration(it.option_ticker, it.exit_date, refExp);
            const { error } = await supabase.from("options").insert({
              user_id: user.id,
              option_ticker: it.option_ticker,
              option_type: it.option_type,
              stock_ticker,
              strike: 0,
              entry_price: 0,
              quantity: it.quantity,
              entry_date: it.exit_date,
              expiration_date: expiration ?? it.exit_date,
              exit_price: it.exit_price,
              exit_date: it.exit_date,
              status: "ENCERRADA",
              needs_review: true,
              notes: `Recompra órfã importada do extrato B3 (${fileName})`,
            });
            if (error) throw error;
          }
          toMarkImported.push({ source_hash: it.hash, movement_date: it.exit_date, raw: it.row.raw });
          ok++;
        } catch (e) {
          fail++;
          failures.push(`${it.option_ticker} recompra: ${(e as Error).message}`);
        }
      }

      // 4) Mark imported hashes (also record ignored so they don't reappear)
      const ignoredMarks = groups.ignored.map((i) => ({
        source_hash: i.hash,
        movement_date: i.row.date,
        raw: i.row.raw,
      }));
      const allMarks = [...toMarkImported, ...ignoredMarks];
      if (allMarks.length > 0) {
        const payload = allMarks.map((m) => ({
          user_id: user.id,
          source_hash: m.source_hash,
          source_file: fileName,
          movement_date: m.movement_date,
          raw: m.raw as never,
        }));
        const CHUNK = 200;
        for (let i = 0; i < payload.length; i += CHUNK) {
          const { error } = await supabase.from("imported_movements").insert(payload.slice(i, i + CHUNK));
          if (error) throw error;
        }
      }

      return { ok, fail, failures };
    },
    onSuccess: (res) => {
      qc.invalidateQueries();
      setState(null);
      if (!res) return;
      if (res.fail > 0) {
        toast.warning(`${res.ok} importados, ${res.fail} falharam`, { description: res.failures.slice(0, 3).join("\n") });
      } else {
        toast.success(`${res.ok} operações importadas`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Importar extrato B3</h1>
          <p className="text-sm text-muted-foreground">
            Envie a planilha "Extrato de Movimentação" (.xlsx). Operações já importadas anteriormente são
            detectadas por hash e ignoradas automaticamente.
          </p>
        </div>
        <Button
          variant="outline"
          className="text-loss border-loss/40 hover:bg-loss/10"
          onClick={async () => {
            if (!confirm("Isso vai APAGAR todas as opções, ações, movimentos e histórico de importações. Deseja continuar?")) return;
            if (!confirm("Confirma? Esta ação não pode ser desfeita.")) return;
            try {
              const uid = user.id;
              await Promise.all([
                supabase.from("options").delete().eq("user_id", uid),
                supabase.from("stock_movements").delete().eq("user_id", uid),
                supabase.from("stocks").delete().eq("user_id", uid),
                supabase.from("imported_movements").delete().eq("user_id", uid),
              ]);
              qc.invalidateQueries();
              toast.success("Base zerada");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          <Trash2 className="h-4 w-4" /> Zerar base de dados
        </Button>
      </div>


      <Card className="bg-surface border-border p-4">
        <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-md p-8 cursor-pointer hover:bg-accent/30 transition">
          <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            {busy ? "Processando..." : "Clique para escolher o arquivo .xlsx"}
          </div>
          <Input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </Card>

      {state && groups && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Vendas de opções" value={groups.optionSells.length} tone="profit" />
            <StatCard label="Recompras de opções" value={groups.optionBuys.length} tone="loss" />
            <StatCard label="Compras de ações" value={groups.stockBuys.length} />
            <StatCard label="Vendas de ações" value={groups.stockSells.length} />
            <StatCard label="Já importadas (puladas)" value={groups.dup.length} tone="muted" />
            <StatCard label="Ignoradas (renda fixa/etc)" value={groups.ignored.length} tone="muted" />
          </div>

          <Card className="bg-surface border-border p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm">
                Arquivo: <span className="font-mono">{state.fileName}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setState(null)}>Cancelar</Button>
                <Button
                  onClick={() => importMut.mutate()}
                  disabled={importMut.isPending || groups.news.length === 0}
                >
                  <Upload className="h-4 w-4" />
                  {importMut.isPending ? "Importando..." : `Confirmar (${groups.news.length})`}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.items.map((it) => {
                    const isDup = state.existingHashes.has(it.hash);
                    return (
                      <TableRow key={it.hash} className={isDup ? "opacity-50" : ""}>
                        <TableCell>
                          {isDup ? (
                            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                          ) : it.kind === "IGNORED" ? (
                            <AlertCircle className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-profit" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{it.row.date.split("-").reverse().join("/")}</TableCell>
                        <TableCell className="text-xs">{labelFor(it)}</TableCell>
                        <TableCell className="font-mono text-xs">{tickerFor(it)}</TableCell>
                        <TableCell className="text-right tabular text-xs">{it.row.quantity}</TableCell>
                        <TableCell className="text-right tabular text-xs">{it.row.price ?? "—"}</TableCell>
                        <TableCell className="text-right tabular text-xs">{it.row.total ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {isDup ? "Já importada" : it.kind === "IGNORED" ? it.reason : "Nova"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function labelFor(it: ParsedItem): string {
  switch (it.kind) {
    case "OPTION_SELL": return `Venda ${it.option_type}`;
    case "OPTION_BUY": return `Recompra ${it.option_type}`;
    case "STOCK_BUY": return "Compra ação";
    case "STOCK_SELL": return "Venda ação";
    case "IGNORED": return it.row.movimentacao;
  }
}
function tickerFor(it: ParsedItem): string {
  switch (it.kind) {
    case "OPTION_SELL":
    case "OPTION_BUY":
      return it.option_ticker;
    case "STOCK_BUY":
    case "STOCK_SELL":
      return it.stock_ticker;
    case "IGNORED":
      return it.row.produto.slice(0, 24);
  }
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "profit" | "loss" | "muted" }) {
  const color = tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <Card className="bg-surface border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular ${color}`}>{value}</div>
    </Card>
  );
}

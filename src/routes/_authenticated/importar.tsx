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

  const [progress, setProgress] = useState<string | null>(null);

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
      const CHUNK = 400;

      const chunked = async <T,>(arr: T[], fn: (slice: T[]) => Promise<void>) => {
        for (let i = 0; i < arr.length; i += CHUNK) {
          await fn(arr.slice(i, i + CHUNK));
        }
      };

      // 1) Ensure stocks rows (bulk) for unique tickers
      const stockOps = [...groups.stockBuys, ...groups.stockSells] as Array<
        Extract<ParsedItem, { kind: "STOCK_BUY" | "STOCK_SELL" }>
      >;
      const uniqueTickers = Array.from(new Set(stockOps.map((s) => s.stock_ticker)));
      if (uniqueTickers.length > 0) {
        setProgress(`Preparando ${uniqueTickers.length} ativos...`);
        const { data: existingStocks, error: exErr } = await supabase
          .from("stocks")
          .select("ticker")
          .eq("user_id", user.id)
          .in("ticker", uniqueTickers);
        if (exErr) throw exErr;
        const have = new Set((existingStocks ?? []).map((s) => s.ticker));
        const toInsertStocks = uniqueTickers
          .filter((t) => !have.has(t))
          .map((t) => ({ user_id: user.id, ticker: t, asset_type: "ACAO" as const, current_price: 0 }));
        if (toInsertStocks.length > 0) {
          await chunked(toInsertStocks, async (slice) => {
            const { error } = await supabase.from("stocks").insert(slice);
            if (error) throw error;
          });
        }
      }

      // 2) Bulk insert stock_movements
      if (stockOps.length > 0) {
        setProgress(`Inserindo ${stockOps.length} movimentos de ações...`);
        const rows = stockOps.map((it) => ({
          user_id: user.id,
          date: it.date,
          stock_ticker: it.stock_ticker,
          event_type: it.kind === "STOCK_BUY" ? ("COMPRA" as const) : ("VENDA" as const),
          quantity: it.quantity,
          price: it.price,
          total_value: it.total,
          origin: `B3 import: ${fileName}`,
        }));
        try {
          await chunked(rows, async (slice) => {
            const { error } = await supabase.from("stock_movements").insert(slice);
            if (error) throw error;
          });
          for (const it of stockOps) toMarkImported.push({ source_hash: it.hash, movement_date: it.date, raw: it.row.raw });
          ok += stockOps.length;
        } catch (e) {
          fail += stockOps.length;
          failures.push(`Movimentos de ações: ${(e as Error).message}`);
        }
      }

      // 3) Bulk insert option sells (open positions)
      const sells = groups.optionSells as Array<Extract<ParsedItem, { kind: "OPTION_SELL" }>>;
      if (sells.length > 0) {
        setProgress(`Inserindo ${sells.length} vendas de opções...`);
        const rows = sells.map((it) => {
          const stock_ticker = resolveStockTicker(it.option_ticker, refStocks) ?? "";
          const expiration = optionExpiration(it.option_ticker, it.entry_date, refExp);
          return {
            user_id: user.id,
            option_ticker: it.option_ticker,
            option_type: it.option_type,
            stock_ticker,
            strike: 0,
            entry_price: it.entry_price,
            quantity: it.quantity,
            entry_date: it.entry_date,
            expiration_date: expiration ?? it.entry_date,
            status: "ABERTA" as const,
            needs_review: true,
            notes: `Importado do extrato B3 (${fileName})`,
          };
        });
        try {
          await chunked(rows, async (slice) => {
            const { error } = await supabase.from("options").insert(slice);
            if (error) throw error;
          });
          for (const it of sells) toMarkImported.push({ source_hash: it.hash, movement_date: it.entry_date, raw: it.row.raw });
          ok += sells.length;
        } catch (e) {
          fail += sells.length;
          failures.push(`Vendas de opções: ${(e as Error).message}`);
        }
      }

      // 4) Option buys — bulk-fetch open positions by ticker, then update per id
      const buys = groups.optionBuys as Array<Extract<ParsedItem, { kind: "OPTION_BUY" }>>;
      if (buys.length > 0) {
        setProgress(`Encerrando ${buys.length} recompras de opções...`);
        const tickers = Array.from(new Set(buys.map((b) => b.option_ticker)));
        const openByTicker = new Map<string, { id: string; entry_date: string }[]>();
        for (let i = 0; i < tickers.length; i += 100) {
          const slice = tickers.slice(i, i + 100);
          const { data, error } = await supabase
            .from("options")
            .select("id, option_ticker, entry_date")
            .eq("user_id", user.id)
            .eq("status", "ABERTA")
            .in("option_ticker", slice)
            .order("entry_date", { ascending: true });
          if (error) throw error;
          for (const r of data ?? []) {
            const arr = openByTicker.get(r.option_ticker) ?? [];
            arr.push({ id: r.id, entry_date: r.entry_date });
            openByTicker.set(r.option_ticker, arr);
          }
        }
        const updates: { id: string; exit_price: number; exit_date: string }[] = [];
        const orphans: typeof buys = [];
        for (const it of buys) {
          const arr = openByTicker.get(it.option_ticker);
          const match = arr?.shift();
          if (match) {
            updates.push({ id: match.id, exit_price: it.exit_price, exit_date: it.exit_date });
            toMarkImported.push({ source_hash: it.hash, movement_date: it.exit_date, raw: it.row.raw });
          } else {
            orphans.push(it);
          }
        }
        for (const u of updates) {
          const { error } = await supabase
            .from("options")
            .update({ exit_price: u.exit_price, exit_date: u.exit_date, status: "ENCERRADA" })
            .eq("id", u.id);
          if (error) {
            fail++;
            failures.push(`Update opção: ${error.message}`);
          } else {
            ok++;
          }
        }
        if (orphans.length > 0) {
          const rows = orphans.map((it) => {
            const stock_ticker = resolveStockTicker(it.option_ticker, refStocks) ?? "";
            const expiration = optionExpiration(it.option_ticker, it.exit_date, refExp);
            return {
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
              status: "ENCERRADA" as const,
              needs_review: true,
              notes: `Recompra órfã importada do extrato B3 (${fileName})`,
            };
          });
          try {
            await chunked(rows, async (slice) => {
              const { error } = await supabase.from("options").insert(slice);
              if (error) throw error;
            });
            for (const it of orphans) toMarkImported.push({ source_hash: it.hash, movement_date: it.exit_date, raw: it.row.raw });
            ok += orphans.length;
          } catch (e) {
            fail += orphans.length;
            failures.push(`Recompras órfãs: ${(e as Error).message}`);
          }
        }
      }

      // 5) Mark imported hashes (also record ignored so they don't reappear)
      const ignoredMarks = groups.ignored.map((i) => ({
        source_hash: i.hash,
        movement_date: i.row.date,
        raw: i.row.raw,
      }));
      const allMarks = [...toMarkImported, ...ignoredMarks];
      if (allMarks.length > 0) {
        setProgress(`Marcando ${allMarks.length} linhas...`);
        const payload = allMarks.map((m) => ({
          user_id: user.id,
          source_hash: m.source_hash,
          source_file: fileName,
          movement_date: m.movement_date,
          raw: m.raw as never,
        }));
        await chunked(payload, async (slice) => {
          const { error } = await supabase.from("imported_movements").insert(slice);
          if (error) throw error;
        });
      }

      setProgress(null);
      return { ok, fail, failures };
    },
    onSuccess: (res) => {
      qc.invalidateQueries();
      setState(null);
      setProgress(null);
      if (!res) return;
      if (res.fail > 0) {
        toast.warning(`${res.ok} importados, ${res.fail} falharam`, {
          description: res.failures.slice(0, 3).join("\n"),
        });
      } else {
        toast.success(`${res.ok} operações importadas`);
      }
    },
    onError: (e: Error) => {
      setProgress(null);
      toast.error(e.message);
    },
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

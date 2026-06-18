import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import {
  aggregateByMonth,
  accumulatedLossUpTo,
  closingDate,
  currentMonthKey,
  optionResult,
  type OptionRow,
} from "@/lib/results-utils";
import { fmtMoney } from "@/lib/options-utils";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/darf")({
  component: DarfPage,
});

const ALIQUOTA = 0.15;
const MIN_DARF = 10;

function DarfPage() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());

  const optionsQ = useQuery({
    queryKey: ["options_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("options").select("*");
      if (error) throw error;
      return (data ?? []) as OptionRow[];
    },
  });

  const opts = optionsQ.data ?? [];
  const buckets = useMemo(() => aggregateByMonth(opts), [opts]);

  const monthOptions = useMemo(() => {
    const keys = new Set<string>([monthKey, currentMonthKey()]);
    buckets.forEach((b) => keys.add(b.key));
    // last 24 months
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return Array.from(keys).sort((a, b) => (a < b ? 1 : -1));
  }, [buckets, monthKey]);

  const rowsMes = useMemo(
    () =>
      opts
        .filter((o) => closingDate(o)?.slice(0, 7) === monthKey)
        .sort((a, b) => ((closingDate(a) ?? "") < (closingDate(b) ?? "") ? -1 : 1)),
    [opts, monthKey],
  );

  const mes = buckets.find((b) => b.key === monthKey);
  const premioRec = mes?.premiumReceived ?? 0;
  const recompra = mes?.buybackCost ?? 0;
  const resultado = mes?.result ?? 0;
  const prejAcum = accumulatedLossUpTo(buckets, monthKey);
  const base = Math.max(0, resultado - prejAcum);
  const imposto = base * ALIQUOTA;
  const darfPagar = imposto >= MIN_DARF ? imposto : 0;

  const labelMes = monthKey
    ? new Date(Number(monthKey.split("-")[0]), Number(monthKey.split("-")[1]) - 1, 1)
        .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : "";

  const copyResumo = async () => {
    const txt = [
      `Resumo DARF — ${labelMes}`,
      `Prêmios recebidos: ${fmtMoney(premioRec)}`,
      `Custos de recompra: ${fmtMoney(recompra)}`,
      `Resultado do mês: ${fmtMoney(resultado)}`,
      `Prejuízo acumulado: ${fmtMoney(prejAcum)}`,
      `Base de cálculo: ${fmtMoney(base)}`,
      `Imposto (15%): ${fmtMoney(imposto)}`,
      `DARF a pagar: ${fmtMoney(darfPagar)}`,
    ].join("\n");
    await navigator.clipboard.writeText(txt);
    toast.success("Resumo copiado");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">DARF / Resultado mensal</h1>
          <p className="text-sm text-muted-foreground">Apuração de IR sobre opções (15% sobre lucro líquido)</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={monthKey} onValueChange={setMonthKey}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((k) => {
                const [y, m] = k.split("-");
                const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", {
                  month: "long",
                  year: "numeric",
                });
                return <SelectItem key={k} value={k}>{label}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={copyResumo}><Copy className="h-4 w-4" /> Copiar resumo</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Prêmios recebidos" value={fmtMoney(premioRec)} />
        <KPI label="Custos de recompra" value={fmtMoney(recompra)} />
        <KPI label="Resultado do mês" value={fmtMoney(resultado)} tone={resultado >= 0 ? "profit" : "loss"} />
        <KPI label="Prejuízo acumulado" value={fmtMoney(prejAcum)} tone={prejAcum > 0 ? "loss" : undefined} />
      </div>

      <Card className="bg-surface border-border p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Base de cálculo</div>
            <div className="text-lg font-semibold tabular">{fmtMoney(base)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Imposto (15%)</div>
            <div className="text-lg font-semibold tabular">{fmtMoney(imposto)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">DARF a pagar</div>
            <div className={`text-2xl font-bold tabular ${darfPagar > 0 ? "text-loss" : "text-profit"}`}>
              {fmtMoney(darfPagar)}
            </div>
            {imposto > 0 && imposto < MIN_DARF && (
              <div className="text-xs text-warn mt-1">
                Imposto abaixo de R$ 10,00 — acumula para o próximo mês com tributo a pagar.
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium">Operações encerradas no mês</h2>
          <span className="text-xs text-muted-foreground">{rowsMes.length} operações</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fechamento</TableHead>
                <TableHead>Opção</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Prêmio</TableHead>
                <TableHead className="text-right">Recompra</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsMes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nenhuma operação encerrada neste mês
                  </TableCell>
                </TableRow>
              )}
              {rowsMes.map((o) => {
                const res = optionResult(o);
                const premio = Number(o.entry_price) * Number(o.quantity);
                const buyback =
                  o.status === "EXERCIDA" || o.exit_price == null
                    ? 0
                    : Number(o.exit_price) * Number(o.quantity);
                return (
                  <TableRow key={o.id}>
                    <TableCell className="text-xs">
                      {closingDate(o)?.split("-").reverse().join("/")}
                    </TableCell>
                    <TableCell className="font-mono">{o.option_ticker}</TableCell>
                    <TableCell>
                      <StatusBadge variant={o.option_type === "CALL" ? "info" : "warn"}>
                        {o.option_type}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs">{o.status}</TableCell>
                    <TableCell className="text-right tabular">{o.quantity}</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(premio)}</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(buyback)}</TableCell>
                    <TableCell className={`text-right tabular font-medium ${res >= 0 ? "text-profit" : "text-loss"}`}>
                      {fmtMoney(res)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Alíquota considerada: 15% sobre o resultado líquido do mês em opções (operações comuns). Prejuízos
        de meses anteriores são compensados automaticamente. Day trade não é tratado separadamente neste MVP.
      </p>
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <Card className="bg-surface border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
    </Card>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  aggregateByMonth,
  currentMonthKey,
  fillLastMonths,
  type OptionRow,
} from "@/lib/results-utils";
import { aggregatePosition, fmtMoney, fmtPct } from "@/lib/options-utils";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Briefcase, PhoneCall, TrendingDown, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

type Stock = {
  id: string; ticker: string; current_price: number; daily_change: number; manual_avg_price: number | null;
};

function DashboardPage() {
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

  const optionsQ = useQuery({
    queryKey: ["options_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("options").select("*");
      if (error) throw error;
      return (data ?? []) as OptionRow[];
    },
  });

  const rows = useMemo(() => {
    if (!stocksQ.data) return [];
    return stocksQ.data.map((s) => {
      const moves = (movementsQ.data ?? []).filter((m) => m.stock_ticker === s.ticker);
      const agg = aggregatePosition(moves as never);
      const avg = s.manual_avg_price ?? agg.avgPrice;
      const montante = agg.quantity * s.current_price;
      const pnlPct = avg > 0 ? s.current_price / avg - 1 : 0;
      return { s, qty: agg.quantity, avg, montante, pnlPct };
    });
  }, [stocksQ.data, movementsQ.data]);

  const patrimonio = rows.reduce((a, r) => a + r.montante, 0);
  const varDia = rows.reduce((a, r) => a + r.montante * (r.s.daily_change / 100), 0);

  const opts = optionsQ.data ?? [];
  const abertas = opts.filter((o) => o.status === "ABERTA");
  const premioAberto = abertas.reduce((a, o) => a + Number(o.entry_price) * Number(o.quantity), 0);

  const buckets = useMemo(() => aggregateByMonth(opts), [opts]);
  const chartData = useMemo(() => fillLastMonths(buckets, currentMonthKey(), 12), [buckets]);
  const curKey = currentMonthKey();
  const resultadoMes = buckets.find((b) => b.key === curKey)?.result ?? 0;

  const top = [...rows].sort((a, b) => b.montante - a.montante).slice(0, 5);

  const today = new Date();
  const in30 = new Date(today.getTime() + 30 * 86400000);
  const vencendo = abertas
    .filter((o) => {
      const d = new Date(o.expiration_date + "T00:00:00");
      return d >= today && d <= in30;
    })
    .sort((a, b) => (a.expiration_date < b.expiration_date ? -1 : 1));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada da carteira e das opções</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI label="Patrimônio" value={fmtMoney(patrimonio)} icon={<Briefcase className="h-4 w-4" />} />
        <KPI
          label="Variação do dia"
          value={fmtMoney(varDia)}
          tone={varDia >= 0 ? "profit" : "loss"}
          icon={varDia >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        />
        <KPI label="Opções abertas" value={String(abertas.length)} icon={<PhoneCall className="h-4 w-4" />} />
        <KPI label="Prêmio em aberto" value={fmtMoney(premioAberto)} />
        <KPI
          label="Resultado do mês"
          value={fmtMoney(resultadoMes)}
          tone={resultadoMes >= 0 ? "profit" : "loss"}
        />
      </div>

      <Card className="bg-surface border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Resultado mensal (últimos 12 meses)</h2>
          <Link to="/darf" className="text-xs text-primary hover:underline">
            Ver DARF →
          </Link>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} stroke="var(--color-border)" />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} stroke="var(--color-border)" tickFormatter={(v) => `R$${v}`} />
              <Tooltip
                formatter={(v: number) => fmtMoney(v)}
                cursor={{ fill: "var(--color-surface-2)", opacity: 0.4 }}
                contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-foreground)" }}
                labelStyle={{ color: "var(--color-foreground)" }}
                itemStyle={{ color: "var(--color-foreground)" }}
              />
              <Bar dataKey="result" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.result >= 0 ? "var(--color-profit)" : "var(--color-loss)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-surface border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Top posições</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Montante</TableHead>
                <TableHead className="text-right">L/P</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    Nenhum ativo
                  </TableCell>
                </TableRow>
              )}
              {top.map((r) => (
                <TableRow key={r.s.id}>
                  <TableCell className="font-mono">{r.s.ticker}</TableCell>
                  <TableCell className="text-right tabular">{r.qty}</TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(r.montante)}</TableCell>
                  <TableCell className={`text-right tabular ${r.pnlPct >= 0 ? "text-profit" : "text-loss"}`}>
                    {fmtPct(r.pnlPct)}
                  </TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">
                    {patrimonio > 0 ? fmtPct(r.montante / patrimonio) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="bg-surface border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Vencendo em 30 dias</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opção</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Venc.</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Prêmio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vencendo.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    Nada vencendo
                  </TableCell>
                </TableRow>
              )}
              {vencendo.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono">{o.option_ticker}</TableCell>
                  <TableCell>
                    <StatusBadge variant={o.option_type === "CALL" ? "info" : "warn"}>{o.option_type}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs">{o.expiration_date.split("-").reverse().join("/")}</TableCell>
                  <TableCell className="text-right tabular">{o.quantity}</TableCell>
                  <TableCell className="text-right tabular">
                    {fmtMoney(Number(o.entry_price) * Number(o.quantity))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
  icon?: React.ReactNode;
}) {
  return (
    <Card className="bg-surface border-border p-4">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{label}</span>
        {icon}
      </div>
      <div
        className={`mt-2 text-xl font-semibold tabular ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </div>
    </Card>
  );
}

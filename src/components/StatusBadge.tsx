import { cn } from "@/lib/utils";

type Variant = "profit" | "loss" | "warn" | "neutral" | "info";

const styles: Record<Variant, string> = {
  profit: "bg-profit/15 text-profit border-profit/30",
  loss: "bg-loss/15 text-loss border-loss/30",
  warn: "bg-warn/15 text-warn border-warn/30",
  neutral: "bg-neutral/15 text-muted-foreground border-neutral/30",
  info: "bg-primary/15 text-primary border-primary/30",
};

export function StatusBadge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

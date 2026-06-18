import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Briefcase, PhoneCall, ShieldAlert, LogOut, TrendingUp, Menu, X, Receipt, History } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/carteira", label: "Carteira", icon: Briefcase },
  { to: "/calls", label: "Calls", icon: PhoneCall },
  { to: "/puts", label: "Puts", icon: ShieldAlert },
  { to: "/darf", label: "DARF", icon: Receipt },
  { to: "/movimentacoes", label: "Movimentações", icon: History },
];

function AuthedLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const { user } = Route.useRouteContext();

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 w-64 bg-surface border-r border-border flex flex-col transition-transform",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 h-16 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 text-primary">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Opções</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Wheel Strategy</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <div className="px-2 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Operações</div>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-foreground/80 hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 space-y-2">
          <div className="px-2 text-xs text-muted-foreground truncate">{user.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-surface/60 backdrop-blur flex items-center px-4 lg:px-6 gap-3 sticky top-0 z-20">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium capitalize">
            {pathname.replace("/", "") || "Início"}
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

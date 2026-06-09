import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useRefStocks() {
  return useQuery({
    queryKey: ["ref_stocks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reference_stocks")
        .select("prefix, stock_ticker")
        .order("prefix");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export function useRefExpirations() {
  return useQuery({
    queryKey: ["ref_expirations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reference_expirations")
        .select("year_month_key, month_number, expiration_date")
        .order("year_month_key");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      imported_movements: {
        Row: {
          created_at: string
          id: string
          movement_date: string | null
          raw: Json | null
          source_file: string | null
          source_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          movement_date?: string | null
          raw?: Json | null
          source_file?: string | null
          source_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          movement_date?: string | null
          raw?: Json | null
          source_file?: string | null
          source_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      options: {
        Row: {
          created_at: string
          entry_date: string
          entry_price: number
          exit_date: string | null
          exit_price: number | null
          expiration_date: string
          id: string
          needs_review: boolean
          notes: string | null
          option_ticker: string
          option_type: Database["public"]["Enums"]["option_type"]
          quantity: number
          status: Database["public"]["Enums"]["option_status"]
          stock_ticker: string
          strike: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_date: string
          entry_price: number
          exit_date?: string | null
          exit_price?: number | null
          expiration_date: string
          id?: string
          needs_review?: boolean
          notes?: string | null
          option_ticker: string
          option_type: Database["public"]["Enums"]["option_type"]
          quantity: number
          status?: Database["public"]["Enums"]["option_status"]
          stock_ticker: string
          strike: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_date?: string
          entry_price?: number
          exit_date?: string | null
          exit_price?: number | null
          expiration_date?: string
          id?: string
          needs_review?: boolean
          notes?: string | null
          option_ticker?: string
          option_type?: Database["public"]["Enums"]["option_type"]
          quantity?: number
          status?: Database["public"]["Enums"]["option_status"]
          stock_ticker?: string
          strike?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      reference_expirations: {
        Row: {
          expiration_date: string
          id: string
          month_number: number
          year_month_key: number
        }
        Insert: {
          expiration_date: string
          id?: string
          month_number: number
          year_month_key: number
        }
        Update: {
          expiration_date?: string
          id?: string
          month_number?: number
          year_month_key?: number
        }
        Relationships: []
      }
      reference_letters: {
        Row: {
          letter: string
          month_name: string
          month_number: number
          option_type: Database["public"]["Enums"]["option_type"]
        }
        Insert: {
          letter: string
          month_name: string
          month_number: number
          option_type: Database["public"]["Enums"]["option_type"]
        }
        Update: {
          letter?: string
          month_name?: string
          month_number?: number
          option_type?: Database["public"]["Enums"]["option_type"]
        }
        Relationships: []
      }
      reference_stocks: {
        Row: {
          id: string
          prefix: string
          stock_ticker: string
        }
        Insert: {
          id?: string
          prefix: string
          stock_ticker: string
        }
        Update: {
          id?: string
          prefix?: string
          stock_ticker?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          created_at: string
          date: string
          event_type: Database["public"]["Enums"]["movement_event"]
          id: string
          origin: string | null
          price: number
          quantity: number
          stock_ticker: string
          total_value: number
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          event_type: Database["public"]["Enums"]["movement_event"]
          id?: string
          origin?: string | null
          price: number
          quantity: number
          stock_ticker: string
          total_value: number
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          event_type?: Database["public"]["Enums"]["movement_event"]
          id?: string
          origin?: string | null
          price?: number
          quantity?: number
          stock_ticker?: string
          total_value?: number
          user_id?: string
        }
        Relationships: []
      }
      stocks: {
        Row: {
          asset_type: Database["public"]["Enums"]["asset_type"]
          created_at: string
          current_price: number
          daily_change: number
          id: string
          manual_avg_price: number | null
          ticker: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          current_price?: number
          daily_change?: number
          id?: string
          manual_avg_price?: number | null
          ticker: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          current_price?: number
          daily_change?: number
          id?: string
          manual_avg_price?: number | null
          ticker?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      asset_type: "ACAO" | "FII" | "ETF" | "RENDA_FIXA" | "OUTRO"
      movement_event:
        | "SALDO_INICIAL"
        | "COMPRA"
        | "VENDA"
        | "EXERCICIO_PUT"
        | "EXERCICIO_CALL"
        | "AJUSTE"
      option_status: "ABERTA" | "ENCERRADA" | "EXERCIDA"
      option_type: "CALL" | "PUT"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      asset_type: ["ACAO", "FII", "ETF", "RENDA_FIXA", "OUTRO"],
      movement_event: [
        "SALDO_INICIAL",
        "COMPRA",
        "VENDA",
        "EXERCICIO_PUT",
        "EXERCICIO_CALL",
        "AJUSTE",
      ],
      option_status: ["ABERTA", "ENCERRADA", "EXERCIDA"],
      option_type: ["CALL", "PUT"],
    },
  },
} as const

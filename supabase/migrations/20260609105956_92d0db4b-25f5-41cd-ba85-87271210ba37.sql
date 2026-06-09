
-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.option_type AS ENUM ('CALL', 'PUT');
CREATE TYPE public.option_status AS ENUM ('ABERTA', 'ENCERRADA', 'EXERCIDA');
CREATE TYPE public.movement_event AS ENUM ('SALDO_INICIAL', 'COMPRA', 'VENDA', 'EXERCICIO_PUT', 'EXERCICIO_CALL', 'AJUSTE');
CREATE TYPE public.asset_type AS ENUM ('ACAO', 'FII', 'ETF', 'RENDA_FIXA', 'OUTRO');

-- =========================
-- PROFILES
-- =========================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile" ON public.profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Utility trigger function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========================
-- STOCKS (carteira - cadastro do ativo)
-- =========================
CREATE TABLE public.stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  asset_type public.asset_type NOT NULL DEFAULT 'ACAO',
  current_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  daily_change NUMERIC(8,4) NOT NULL DEFAULT 0,
  manual_avg_price NUMERIC(14,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ticker)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stocks TO authenticated;
GRANT ALL ON public.stocks TO service_role;
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own stocks" ON public.stocks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER stocks_updated_at BEFORE UPDATE ON public.stocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- STOCK MOVEMENTS
-- =========================
CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  stock_ticker TEXT NOT NULL,
  event_type public.movement_event NOT NULL,
  quantity NUMERIC(14,4) NOT NULL,
  price NUMERIC(14,4) NOT NULL,
  total_value NUMERIC(18,4) NOT NULL,
  origin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own movements" ON public.stock_movements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX stock_movements_user_ticker_idx ON public.stock_movements (user_id, stock_ticker);

-- =========================
-- OPTIONS (calls + puts)
-- =========================
CREATE TABLE public.options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_type public.option_type NOT NULL,
  entry_date DATE NOT NULL,
  quantity NUMERIC(14,4) NOT NULL,
  option_ticker TEXT NOT NULL,
  entry_price NUMERIC(14,4) NOT NULL,
  strike NUMERIC(14,4) NOT NULL,
  stock_ticker TEXT NOT NULL,
  expiration_date DATE NOT NULL,
  status public.option_status NOT NULL DEFAULT 'ABERTA',
  exit_price NUMERIC(14,4),
  exit_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.options TO authenticated;
GRANT ALL ON public.options TO service_role;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own options" ON public.options
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX options_user_status_idx ON public.options (user_id, status);
CREATE INDEX options_user_expiration_idx ON public.options (user_id, expiration_date);
CREATE TRIGGER options_updated_at BEFORE UPDATE ON public.options
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- REFERENCE: letras → mês + tipo
-- =========================
CREATE TABLE public.reference_letters (
  letter CHAR(1) PRIMARY KEY,
  option_type public.option_type NOT NULL,
  month_number SMALLINT NOT NULL,
  month_name TEXT NOT NULL
);
GRANT SELECT ON public.reference_letters TO authenticated, anon;
GRANT ALL ON public.reference_letters TO service_role;
ALTER TABLE public.reference_letters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read letters" ON public.reference_letters FOR SELECT USING (true);

INSERT INTO public.reference_letters (letter, option_type, month_number, month_name) VALUES
('A','CALL',1,'Janeiro'),('B','CALL',2,'Fevereiro'),('C','CALL',3,'Março'),
('D','CALL',4,'Abril'),('E','CALL',5,'Maio'),('F','CALL',6,'Junho'),
('G','CALL',7,'Julho'),('H','CALL',8,'Agosto'),('I','CALL',9,'Setembro'),
('J','CALL',10,'Outubro'),('K','CALL',11,'Novembro'),('L','CALL',12,'Dezembro'),
('M','PUT',1,'Janeiro'),('N','PUT',2,'Fevereiro'),('O','PUT',3,'Março'),
('P','PUT',4,'Abril'),('Q','PUT',5,'Maio'),('R','PUT',6,'Junho'),
('S','PUT',7,'Julho'),('T','PUT',8,'Agosto'),('U','PUT',9,'Setembro'),
('V','PUT',10,'Outubro'),('W','PUT',11,'Novembro'),('X','PUT',12,'Dezembro');

-- =========================
-- REFERENCE: vencimentos
-- =========================
CREATE TABLE public.reference_expirations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month_key INTEGER NOT NULL UNIQUE,
  month_number SMALLINT NOT NULL,
  expiration_date DATE NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_expirations TO authenticated;
GRANT ALL ON public.reference_expirations TO service_role;
ALTER TABLE public.reference_expirations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated reads expirations" ON public.reference_expirations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone authenticated writes expirations" ON public.reference_expirations FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.reference_expirations (year_month_key, month_number, expiration_date) VALUES
(202601,1,'2026-01-16'),(202602,2,'2026-02-20'),(202603,3,'2026-03-20'),
(202604,4,'2026-04-17'),(202605,5,'2026-05-15'),(202606,6,'2026-06-19'),
(202607,7,'2026-07-17'),(202608,8,'2026-08-21'),(202609,9,'2026-09-18'),
(202610,10,'2026-10-16'),(202611,11,'2026-11-19'),(202612,12,'2026-12-18');

-- =========================
-- REFERENCE: prefixos → ticker
-- =========================
CREATE TABLE public.reference_stocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix TEXT NOT NULL UNIQUE,
  stock_ticker TEXT NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_stocks TO authenticated;
GRANT ALL ON public.reference_stocks TO service_role;
ALTER TABLE public.reference_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated reads ref stocks" ON public.reference_stocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone authenticated writes ref stocks" ON public.reference_stocks FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.reference_stocks (prefix, stock_ticker) VALUES
('PETR','PETR4'),('VALE','VALE3'),('ITUB','ITUB4'),('BBDC','BBDC4'),
('BBAS','BBAS3'),('BBSE','BBSE3'),('WEGE','WEGE3'),('ITSA','ITSA4'),
('ISAE','ISAE4'),('SANB','SANB11'),('PRIO','PRIO3'),('ABEV','ABEV3'),
('SUZB','SUZB3'),('RENT','RENT3'),('LREN','LREN3'),('CMIG','CMIG4'),
('GGBR','GGBR4'),('GOAU','GOAU4'),('USIM','USIM5'),('KLBN','KLBN11'),
('ELET','ELET3'),('CPLE','CPLE6');

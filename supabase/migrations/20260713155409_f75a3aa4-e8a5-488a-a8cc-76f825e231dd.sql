
CREATE TABLE public.imported_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_hash text NOT NULL,
  source_file text,
  movement_date date,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported_movements TO authenticated;
GRANT ALL ON public.imported_movements TO service_role;

ALTER TABLE public.imported_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own imported_movements"
  ON public.imported_movements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX imported_movements_user_hash_idx ON public.imported_movements (user_id, source_hash);

ALTER TABLE public.options ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

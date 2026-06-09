
-- Tighten reference tables: read-only for authenticated, writes via service role
DROP POLICY IF EXISTS "Anyone authenticated writes expirations" ON public.reference_expirations;
DROP POLICY IF EXISTS "Anyone authenticated writes ref stocks" ON public.reference_stocks;

-- Revoke write grants from authenticated; keep SELECT
REVOKE INSERT, UPDATE, DELETE ON public.reference_expirations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.reference_stocks FROM authenticated;

-- Revoke execute on internal trigger functions from public/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

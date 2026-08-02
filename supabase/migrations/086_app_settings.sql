-- =====================================================
-- AJUSTES GLOBALES (valores sueltos que los admins tocan)
-- =====================================================
-- De momento solo el cambio dólar → euro: los comerciales cobran en
-- dólares y la facturación entra en euros, así que para saber si el
-- equipo sale rentable hay que poder comparar las dos cifras.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value NUMERIC NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE OR REPLACE FUNCTION public.update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_app_settings_updated_at();

INSERT INTO public.app_settings (key, value)
VALUES ('usd_eur_rate', 0.92)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team can read settings" ON public.app_settings;
CREATE POLICY "Team can read settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage settings" ON public.app_settings;
CREATE POLICY "Admins manage settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;

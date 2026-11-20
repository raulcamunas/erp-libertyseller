-- 328 · SUBENCARGOS: TRABAJOS APARTE QUE SE COBRAN EN SU PROPIA FACTURA
--
-- Creatividades, packagings, estudios… Se apuntan en Tesorería bajo el cliente y el mes, suman en lo que ese cliente nos
-- paga, y cada uno se factura SOLO desde Facturación (su propia factura en Zoho, no dentro de la del fee).
-- `zoho_invoice_id` ata el subencargo a su factura: así la del mes no la confunde con la del fee, y enviarla o cobrarla
-- marca el subencargo y no el mes.

CREATE TABLE IF NOT EXISTS public.treasury_extras (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       UUID NOT NULL REFERENCES public.treasury_clients(id) ON DELETE CASCADE,
  -- Siempre el día 1 del mes, como treasury_client_months
  period          DATE NOT NULL CHECK (extract(day FROM period) = 1),
  concept         TEXT NOT NULL CHECK (length(trim(concept)) > 0),
  -- Lo que el cliente nos paga por él, en euros, sin IVA
  amount          NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  zoho_invoice_id TEXT,
  invoice_sent    BOOLEAN NOT NULL DEFAULT false,
  paid            BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_treasury_extras_period ON public.treasury_extras(period, client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_extras_factura ON public.treasury_extras(zoho_invoice_id) WHERE zoho_invoice_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_treasury_extras_updated ON public.treasury_extras;
CREATE TRIGGER trg_treasury_extras_updated
  BEFORE UPDATE ON public.treasury_extras
  FOR EACH ROW EXECUTE FUNCTION public.update_treasury_updated_at();

-- Lo mismo que el resto de Tesorería: solo dirección
ALTER TABLE public.treasury_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage treasury extras" ON public.treasury_extras;
CREATE POLICY "Admins manage treasury extras"
  ON public.treasury_extras FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'treasury_extras') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.treasury_extras;
  END IF;
END $$;

SELECT to_regclass('public.treasury_extras') IS NOT NULL AS creada;

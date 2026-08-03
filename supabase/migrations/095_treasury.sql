-- =====================================================
-- TESORERÍA
-- =====================================================
-- Sustituye el Excel «Tesoreria», pestañas «Clientes» e «Ingresos y
-- Gastos». El modelo es el mismo que tenían allí, pero normalizado:
-- en vez de una columna por mes que hay que ir añadiendo a mano, una
-- fila por cliente y mes.

-- ---------- Clientes que facturan ----------
CREATE TABLE IF NOT EXISTS public.treasury_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  tax_address TEXT,
  email TEXT,
  email_alt TEXT,
  /** Día del mes en que pagan (1-31) */
  payment_day SMALLINT,
  /** Fee mensual de referencia: el que se propone al abrir un mes nuevo */
  default_fee NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_treasury_clients_active
  ON public.treasury_clients(is_active, position);

-- ---------- Lo facturado a cada cliente, mes a mes ----------
CREATE TABLE IF NOT EXISTS public.treasury_client_months (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.treasury_clients(id) ON DELETE CASCADE,
  /** Siempre el día 1 del mes al que corresponde */
  period DATE NOT NULL,
  fee NUMERIC,
  commission NUMERIC,
  paid BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (client_id, period)
);

CREATE INDEX IF NOT EXISTS idx_treasury_client_months_period
  ON public.treasury_client_months(period);

-- ---------- Gastos ----------
-- Los sueldos del equipo se pagan en dólares; el resto suele ir en euros.
-- Se guarda el importe en su divisa y se convierte al vuelo con el tipo
-- de cambio de app_settings, que ya usa el CRM.
CREATE TABLE IF NOT EXISTS public.treasury_expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period DATE NOT NULL,
  category TEXT NOT NULL DEFAULT 'otros'
    CHECK (category IN ('equipo', 'marketing', 'software', 'mentoria', 'otros')),
  concept TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD')),
  /** Se propone solo al abrir el mes siguiente (suscripciones, sueldos...) */
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_treasury_expenses_period
  ON public.treasury_expenses(period, category);

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.update_treasury_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_treasury_clients_updated ON public.treasury_clients;
CREATE TRIGGER trg_treasury_clients_updated
  BEFORE UPDATE ON public.treasury_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_treasury_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_client_months_updated ON public.treasury_client_months;
CREATE TRIGGER trg_treasury_client_months_updated
  BEFORE UPDATE ON public.treasury_client_months
  FOR EACH ROW EXECUTE FUNCTION public.update_treasury_updated_at();

DROP TRIGGER IF EXISTS trg_treasury_expenses_updated ON public.treasury_expenses;
CREATE TRIGGER trg_treasury_expenses_updated
  BEFORE UPDATE ON public.treasury_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_treasury_updated_at();

-- ---------- RLS: solo dirección ----------
-- Aquí están los sueldos de todo el equipo y el reparto entre socios.
ALTER TABLE public.treasury_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_client_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage treasury clients" ON public.treasury_clients;
CREATE POLICY "Admins manage treasury clients"
  ON public.treasury_clients FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage treasury months" ON public.treasury_client_months;
CREATE POLICY "Admins manage treasury months"
  ON public.treasury_client_months FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage treasury expenses" ON public.treasury_expenses;
CREATE POLICY "Admins manage treasury expenses"
  ON public.treasury_expenses FOR ALL TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

ALTER PUBLICATION supabase_realtime ADD TABLE public.treasury_client_months;
ALTER PUBLICATION supabase_realtime ADD TABLE public.treasury_expenses;

-- El reparto entre socios: por defecto a partes iguales, editable.
INSERT INTO public.app_settings (key, value)
VALUES ('treasury_partners', 2)
ON CONFLICT (key) DO NOTHING;

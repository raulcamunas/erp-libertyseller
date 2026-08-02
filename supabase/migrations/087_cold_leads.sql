-- =====================================================
-- COLD CALLING: base de datos de prospección
-- =====================================================
-- Sustituye el Excel «Base de Datos Cold Caller». Los estados son los
-- que ya usaban con colores en la hoja, uno por color:
--   sin color  -> pendiente          (todavía sin llamar)
--   amarillo   -> no_contesta        (no coge / buzón / rellamar)
--   cian       -> programado         (rellamar en fecha concreta)
--   magenta    -> email_enviado      (le mandamos la info por correo)
--   naranja    -> seguimiento        (interesado, hay que insistir)
--   verde      -> cita_cualificada
--   rojo       -> no_interesa        (descartado)

CREATE TABLE IF NOT EXISTS public.cold_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Datos del seller (vienen del Excel, se pueden corregir)
  store_name TEXT NOT NULL,
  company TEXT,
  revenue_monthly NUMERIC,
  amazon_start TEXT,
  phone TEXT,
  directors TEXT,
  email TEXT,
  province TEXT,
  category TEXT,
  subcategory TEXT,
  seller_url TEXT,
  mercantile_registry TEXT,
  business_address TEXT,

  -- Trabajo comercial
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN (
      'pendiente',
      'no_contesta',
      'programado',
      'email_enviado',
      'seguimiento',
      'cita_cualificada',
      'no_interesa'
    )),
  follow_up TEXT,             -- el texto libre de SEGUIMIENTO del Excel
  action_label TEXT,          -- la etiqueta original, por si hace falta consultarla
  next_call_date DATE,
  last_contacted_at TIMESTAMPTZ,
  call_attempts INTEGER NOT NULL DEFAULT 0,

  -- Solo para la importación del CSV: se traduce a assigned_to y ya no
  -- se vuelve a usar.
  import_email TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cold_leads_assigned ON public.cold_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cold_leads_status ON public.cold_leads(status);
CREATE INDEX IF NOT EXISTS idx_cold_leads_next_call ON public.cold_leads(next_call_date);

CREATE OR REPLACE FUNCTION public.update_cold_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cold_leads_updated_at ON public.cold_leads;
CREATE TRIGGER trg_cold_leads_updated_at
  BEFORE UPDATE ON public.cold_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_cold_leads_updated_at();

-- ---------- Interacciones con el lead ----------
CREATE TABLE IF NOT EXISTS public.cold_lead_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.cold_leads(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'llamada'
    CHECK (kind IN ('llamada', 'email', 'whatsapp', 'linkedin', 'nota')),
  body TEXT NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cold_lead_notes_lead
  ON public.cold_lead_notes(lead_id, occurred_at DESC);

-- ---------- RLS ----------
-- Cada comercial trabaja su cartera; los admins lo ven y lo tocan todo.
ALTER TABLE public.cold_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_lead_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own leads or admin can view" ON public.cold_leads;
CREATE POLICY "Own leads or admin can view"
  ON public.cold_leads FOR SELECT
  TO authenticated
  USING (assigned_to = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Own leads or admin can update" ON public.cold_leads;
CREATE POLICY "Own leads or admin can update"
  ON public.cold_leads FOR UPDATE
  TO authenticated
  USING (assigned_to = auth.uid() OR public.is_admin_or_partner(auth.uid()))
  WITH CHECK (assigned_to = auth.uid() OR public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage leads" ON public.cold_leads;
CREATE POLICY "Admins manage leads"
  ON public.cold_leads FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins delete leads" ON public.cold_leads;
CREATE POLICY "Admins delete leads"
  ON public.cold_leads FOR DELETE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Notes visible with the lead" ON public.cold_lead_notes;
CREATE POLICY "Notes visible with the lead"
  ON public.cold_lead_notes FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_partner(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.cold_leads l
      WHERE l.id = lead_id AND l.assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Team can add notes" ON public.cold_lead_notes;
CREATE POLICY "Team can add notes"
  ON public.cold_lead_notes FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Author or admin can delete notes" ON public.cold_lead_notes;
CREATE POLICY "Author or admin can delete notes"
  ON public.cold_lead_notes FOR DELETE
  TO authenticated
  USING (author_id = auth.uid() OR public.is_admin_or_partner(auth.uid()));

-- Realtime: si un admin reasigna un lead o cambia un estado, el comercial
-- lo ve sin recargar.
ALTER PUBLICATION supabase_realtime ADD TABLE public.cold_leads;

-- ---------- Acceso a la app ----------
INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
SELECT p.id, 'cold-calling', true
FROM public.profiles p
WHERE p.email IN (
  'yamila@libertyseller.com',
  'maoli@libertyseller.com',
  'alejandro@libertyseller.com',
  'jose@libertyseller.com'
)
ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

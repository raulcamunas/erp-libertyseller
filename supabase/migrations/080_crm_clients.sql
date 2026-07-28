-- =====================================================
-- CRM DE CLIENTES (leads con "Cita Cualificada")
-- =====================================================
-- Cuando una cita pasa a estado "Cita Cualificada" (qualified), ese lead
-- entra automáticamente en el CRM. A partir de ahí se le hace seguimiento:
-- estado del pipeline, tomas de contacto, propuesta y contrato en PDF, y
-- el presupuesto de set up + mantenimiento que se le ha lanzado.

-- ---------- Ficha del cliente ----------
CREATE TABLE IF NOT EXISTS public.crm_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Una ficha por cita cualificada. Si se borra la cita, se borra la ficha.
  appointment_id UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,

  -- Estado en el pipeline comercial
  stage TEXT NOT NULL DEFAULT 'nuevo'
    CHECK (stage IN (
      'nuevo',
      'seguimiento',
      'propuesta_enviada',
      'revision_propuesta',
      'negociacion',
      'ganado',
      'perdido'
    )),

  -- Responsable del seguimiento (puede no ser quien agendó la cita)
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Datos ampliados que no viven en la cita
  contact_role TEXT,          -- cargo del contacto (CEO, responsable ecommerce...)
  website TEXT,
  country TEXT,
  marketplaces TEXT,          -- ES, IT, DE, US... texto libre

  -- Presupuesto lanzado
  setup_budget NUMERIC,       -- fee de set up (pago único)
  maintenance_budget NUMERIC, -- fee mensual de mantenimiento

  -- Seguimiento
  next_action TEXT,
  next_action_date DATE,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_clients_stage ON public.crm_clients(stage);
CREATE INDEX IF NOT EXISTS idx_crm_clients_appointment ON public.crm_clients(appointment_id);

CREATE OR REPLACE FUNCTION public.update_crm_clients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crm_clients_updated_at ON public.crm_clients;
CREATE TRIGGER trg_crm_clients_updated_at
  BEFORE UPDATE ON public.crm_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_crm_clients_updated_at();

-- ---------- Tomas de contacto (timeline) ----------
CREATE TABLE IF NOT EXISTS public.crm_interactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'nota'
    CHECK (kind IN ('llamada', 'email', 'whatsapp', 'reunion', 'propuesta', 'nota')),
  body TEXT NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_client
  ON public.crm_interactions(client_id, occurred_at DESC);

-- ---------- Documentos (propuesta / contrato en PDF) ----------
CREATE TABLE IF NOT EXISTS public.crm_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.crm_clients(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'otro'
    CHECK (kind IN ('propuesta', 'contrato', 'otro')),
  file_url TEXT NOT NULL,
  file_path TEXT,             -- ruta dentro del bucket, para poder borrarlo
  filename TEXT NOT NULL,
  file_size BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crm_documents_client
  ON public.crm_documents(client_id, created_at DESC);

-- ---------- Alta automática al cualificar una cita ----------
-- En cuanto una cita del ERP pasa a "qualified", el lead aparece solo en
-- el CRM. No se borra la ficha si luego cambia de estado: los datos de
-- seguimiento (propuesta, presupuesto...) no deben perderse.
CREATE OR REPLACE FUNCTION public.sync_crm_client_from_appointment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'qualified' AND NEW.is_external = false THEN
    INSERT INTO public.crm_clients (appointment_id, owner_id)
    VALUES (NEW.id, COALESCE(NEW.assigned_closer_id, NEW.comercial_id))
    ON CONFLICT (appointment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_appointment_to_crm ON public.appointments;
CREATE TRIGGER trg_appointment_to_crm
  AFTER INSERT OR UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.sync_crm_client_from_appointment();

-- Backfill: las citas ya cualificadas antes de existir el CRM
INSERT INTO public.crm_clients (appointment_id, owner_id)
SELECT a.id, COALESCE(a.assigned_closer_id, a.comercial_id)
FROM public.appointments a
WHERE a.status = 'qualified' AND a.is_external = false
ON CONFLICT (appointment_id) DO NOTHING;

-- ---------- RLS: solo admin/partner ----------
-- El CRM es una vista de dirección: los comerciales siguen viendo sus
-- leads en el desglose de citas, pero el pipeline completo con
-- presupuestos y contratos es solo para admins.
ALTER TABLE public.crm_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage crm clients" ON public.crm_clients;
CREATE POLICY "Admins manage crm clients"
  ON public.crm_clients FOR ALL
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage crm interactions" ON public.crm_interactions;
CREATE POLICY "Admins manage crm interactions"
  ON public.crm_interactions FOR ALL
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins manage crm documents" ON public.crm_documents;
CREATE POLICY "Admins manage crm documents"
  ON public.crm_documents FOR ALL
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

-- ---------- Storage: propuestas y contratos en PDF ----------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-documents',
  'crm-documents',
  true,
  52428800, -- 50MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins can upload crm documents" ON storage.objects;
CREATE POLICY "Admins can upload crm documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'crm-documents' AND public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins can read crm documents" ON storage.objects;
CREATE POLICY "Admins can read crm documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'crm-documents' AND public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete crm documents" ON storage.objects;
CREATE POLICY "Admins can delete crm documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'crm-documents' AND public.is_admin_or_partner(auth.uid()));

-- Realtime: los dos admins pueden estar trabajando el pipeline a la vez
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_clients;

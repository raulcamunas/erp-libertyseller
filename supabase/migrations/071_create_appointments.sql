-- =====================================================
-- MÓDULO AGENDA COMERCIAL — Citas + sync Google Calendar
-- =====================================================
-- Los comerciales agendan citas para el equipo desde el ERP.
-- Vista compartida (todos ven todas) pero cada comercial solo
-- puede editar/borrar las suyas; los admins pueden con todas.
-- Sync bidireccional con Google Calendar (service account con
-- delegación de dominio sobre Google Workspace libertyseller.com).

-- ---------- Color de calendario por comercial ----------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS calendar_color TEXT;

-- La agenda es una herramienta de equipo: cualquier usuario autenticado
-- necesita poder ver a los demás miembros (nombre + color) para la leyenda,
-- el selector de closer y el join "quién agendó" en las citas ajenas.
DROP POLICY IF EXISTS "Authenticated can view team profiles" ON public.profiles;
CREATE POLICY "Authenticated can view team profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- ---------- Estado de la cita ----------
DO $$ BEGIN
  CREATE TYPE appointment_status AS ENUM (
    'scheduled',   -- agendada
    'confirmed',   -- confirmada por el lead
    'completed',   -- realizada
    'cancelled',   -- cancelada
    'no_show'      -- el lead no se presentó
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Tabla principal de citas ----------
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Quién agenda (dueño en el ERP: solo él o un admin pueden editar)
  comercial_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- A quién se le asigna la cita (el closer que la atiende), opcional
  assigned_closer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- Datos del lead (denormalizados para no depender de una única fuente)
  lead_name TEXT NOT NULL,
  lead_email TEXT,
  lead_phone TEXT,
  lead_company TEXT,
  -- Vínculo opcional al lead de origen (web_leads, linkedin, etc.)
  lead_source TEXT,          -- 'web' | 'linkedin' | 'manual' | ...
  lead_ref_id UUID,          -- id en la tabla de origen si aplica

  -- Cuándo
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,

  status appointment_status NOT NULL DEFAULT 'scheduled',

  -- Contenido de "la cajita" (campos a definir contigo)
  title TEXT,
  notes TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,  -- campos flexibles hasta cerrar el diseño

  -- Sync con Google Calendar
  google_event_id TEXT,
  google_calendar_id TEXT,
  google_html_link TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'synced' | 'error' | 'local'
  sync_error TEXT,
  last_synced_at TIMESTAMPTZ,
  -- Para saber quién ganó el último cambio en conflictos ERP<->Google
  updated_source TEXT NOT NULL DEFAULT 'erp',  -- 'erp' | 'google'

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_comercial ON public.appointments(comercial_id);
CREATE INDEX IF NOT EXISTS idx_appointments_closer ON public.appointments(assigned_closer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON public.appointments(start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_google_event ON public.appointments(google_event_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);

-- ---------- Estado de sincronización por calendario ----------
-- Guarda el syncToken incremental y el canal de push de Google.
CREATE TABLE IF NOT EXISTS public.google_calendar_sync (
  calendar_id TEXT PRIMARY KEY,
  sync_token TEXT,
  channel_id TEXT,
  resource_id TEXT,
  channel_expiration TIMESTAMPTZ,
  last_full_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ---------- Trigger updated_at ----------
CREATE OR REPLACE FUNCTION update_appointments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION update_appointments_updated_at();

-- ---------- RLS ----------
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Helper: ¿es el usuario admin o partner?
CREATE OR REPLACE FUNCTION public.is_admin_or_partner(uid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND role IN ('admin', 'partner')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- SELECT: cualquier usuario autenticado ve todas las citas (vista de equipo)
DROP POLICY IF EXISTS "Team can view all appointments" ON public.appointments;
CREATE POLICY "Team can view all appointments"
  ON public.appointments FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: un comercial crea citas a su nombre; un admin puede crear para cualquiera
DROP POLICY IF EXISTS "Create own appointments" ON public.appointments;
CREATE POLICY "Create own appointments"
  ON public.appointments FOR INSERT
  TO authenticated
  WITH CHECK (
    comercial_id = auth.uid() OR public.is_admin_or_partner(auth.uid())
  );

-- UPDATE: solo las propias, o admins/partners cualquiera
DROP POLICY IF EXISTS "Update own appointments" ON public.appointments;
CREATE POLICY "Update own appointments"
  ON public.appointments FOR UPDATE
  TO authenticated
  USING (
    comercial_id = auth.uid() OR public.is_admin_or_partner(auth.uid())
  )
  WITH CHECK (
    comercial_id = auth.uid() OR public.is_admin_or_partner(auth.uid())
  );

-- DELETE: solo las propias, o admins/partners cualquiera
DROP POLICY IF EXISTS "Delete own appointments" ON public.appointments;
CREATE POLICY "Delete own appointments"
  ON public.appointments FOR DELETE
  TO authenticated
  USING (
    comercial_id = auth.uid() OR public.is_admin_or_partner(auth.uid())
  );

-- google_calendar_sync: solo el service role (backend) la toca.
ALTER TABLE public.google_calendar_sync ENABLE ROW LEVEL SECURITY;
-- (sin políticas para authenticated => solo service_role puede leer/escribir)

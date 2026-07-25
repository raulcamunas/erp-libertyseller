-- =====================================================
-- AGENDA: eventos externos importados de Google Calendar
-- =====================================================
-- El calendario business@libertyseller.com ya tenía eventos antes de
-- existir este módulo (Sesión de Consultoría, reuniones, etc.). Hay que
-- verlos en el ERP para no agendar citas encima de huecos ya ocupados,
-- aunque esos eventos no los gestione el ERP (son de solo lectura).

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT false;

-- Enlace de Google Meet generado automáticamente al crear la cita
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS google_meet_link TEXT;

-- Los eventos externos no tienen un comercial "dueño" en el ERP
ALTER TABLE public.appointments
  ALTER COLUMN comercial_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_is_external
  ON public.appointments(is_external);

-- ---------- RLS ----------
-- Las políticas de INSERT/UPDATE/DELETE ya exigen comercial_id = auth.uid()
-- o admin/partner. Los eventos externos los inserta/actualiza el backend
-- con service_role (bypassa RLS), así que ningún usuario normal puede
-- editarlos ni borrarlos por error: solo un admin podría (comercial_id
-- NULL no calza con auth.uid() de nadie).

-- El SELECT ya es abierto a todo el equipo (política existente), así que
-- los eventos externos se ven igual que las citas del ERP.

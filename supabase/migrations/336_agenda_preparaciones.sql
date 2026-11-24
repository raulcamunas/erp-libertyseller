-- ============================================================================
-- 336 · AGENDA: EL PREPARADOR DE REUNIONES
-- ============================================================================
--
-- Lo que el comercial prepara para una cita antes de la llamada (24 nov 2026, Raúl): el objetivo, los puntos a tratar, las preguntas y sus notas.
-- Se ve en «Preparador de reuniones» (Agenda) y sale en un PDF de una hoja con la marca para tenerlo delante en la llamada. La ficha del cliente
-- (datos del lead, llamadas, análisis de Amazon) NO se guarda aquí: se lee en el momento de donde ya está.
--
-- Una fila por cita. RLS sin políticas: solo lee y escribe el servidor, que comprueba que la cita es tuya (o que ves al equipo). IDEMPOTENTE.

CREATE TABLE IF NOT EXISTS public.agenda_preparaciones (
  appointment_id UUID PRIMARY KEY REFERENCES public.appointments(id) ON DELETE CASCADE,
  objetivo TEXT CHECK (objetivo IS NULL OR length(objetivo) <= 600),
  puntos JSONB NOT NULL DEFAULT '[]'::jsonb,
  preguntas JSONB NOT NULL DEFAULT '[]'::jsonb,
  notas TEXT CHECK (notas IS NULL OR length(notas) <= 4000),
  ia_at TIMESTAMPTZ,
  actualizado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agenda_preparaciones ENABLE ROW LEVEL SECURITY;

-- Comprobación: tiene que salir UNA fila con las dos cosas en `true`
SELECT
  to_regclass('public.agenda_preparaciones') IS NOT NULL AS tabla_creada,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'agenda_preparaciones') AS con_rls;

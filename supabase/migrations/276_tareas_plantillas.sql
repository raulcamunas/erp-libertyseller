-- =============================================================================
-- 276 · Tareas de clientes: PLANTILLAS Y TAREAS QUE SE REPITEN
-- =============================================================================
-- Una plantilla es una tarea «de molde»: título (con {fecha}, {mes}, {año}, {semana}), columna, departamento, responsables, días hasta el vencimiento y un cuerpo con su
-- checklist. Se usa a mano («Nueva tarea → Desde plantilla») o se repite sola (cada día laborable, cada semana, cada dos semanas, cada mes).
--
-- La repetición la dispara el ERP sin cron: lo pide cada sesión abierta (al abrir y cada media hora) y, además, la pasada de /api/tareas-clientes/notion/cron. Para que dos
-- sesiones a la vez no creen la misma tarea dos veces: (1) la plantilla se «reserva» moviendo `proxima_en` con una condición, y (2) esta restricción única lo impide aunque algo falle.
-- Idempotente: se puede lanzar más de una vez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tc_plantillas (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Vacío = general (se puede usar en cualquier cliente, pero no se repite sola: la repetición necesita un cliente)
  cliente_id       UUID REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  nombre           TEXT NOT NULL,
  icono            TEXT,
  titulo           TEXT NOT NULL DEFAULT '',
  estado           TEXT,
  departamento     TEXT,
  responsables     UUID[] NOT NULL DEFAULT '{}',
  dias_para_vencer INTEGER CHECK (dias_para_vencer IS NULL OR dias_para_vencer BETWEEN 0 AND 365),
  contenido        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- {tipo: 'ninguna'} | {tipo: 'laborable'} | {tipo: 'semanal', diaSemana: 1-7} | {tipo: 'quincenal', diaSemana: 1-7} | {tipo: 'mensual', diaMes: 1-31}
  recurrencia      JSONB NOT NULL DEFAULT '{"tipo":"ninguna"}'::jsonb,
  activa           BOOLEAN NOT NULL DEFAULT TRUE,
  -- El día de la próxima tarea que le toca crear; vacío = no se repite
  proxima_en       DATE,
  ultima_en        TIMESTAMPTZ,
  creado_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_plantillas_cliente ON public.tc_plantillas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_tc_plantillas_proxima ON public.tc_plantillas (proxima_en) WHERE activa AND proxima_en IS NOT NULL;

-- De qué plantilla y de qué día salió una tarea
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS plantilla_id    UUID REFERENCES public.tc_plantillas(id) ON DELETE SET NULL;
ALTER TABLE public.tc_tareas ADD COLUMN IF NOT EXISTS plantilla_fecha DATE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tc_tareas_plantilla_dia ON public.tc_tareas (plantilla_id, plantilla_fecha) WHERE plantilla_id IS NOT NULL AND plantilla_fecha IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tc_plantillas_actualizado ON public.tc_plantillas;
CREATE TRIGGER trg_tc_plantillas_actualizado BEFORE UPDATE ON public.tc_plantillas FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();

-- Leer, con permiso; escribir, solo el servidor
ALTER TABLE public.tc_plantillas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tc_plantillas_leer ON public.tc_plantillas;
CREATE POLICY tc_plantillas_leer ON public.tc_plantillas FOR SELECT TO authenticated USING (public.puede_ver_tareas_clientes());

-- Comprobación: debe devolver una fila con todo en true
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tc_plantillas')                       AS tabla_de_plantillas,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tc_tareas' AND column_name = 'plantilla_id') AS tareas_saben_su_plantilla,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_tc_tareas_plantilla_dia')                              AS sin_duplicados_por_dia,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tc_plantillas'::regclass)                                                      AS con_seguridad;

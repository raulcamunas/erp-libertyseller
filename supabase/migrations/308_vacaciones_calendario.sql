-- ============================================================================
-- 308 · VACACIONES: CALENDARIO DE TODA LA EMPRESA, CHOQUES Y AVISOS EN LA CAMPANA
-- ============================================================================
-- 14 nov 2026. Raúl decide que la regla «no pueden irse dos a la vez» vale para TODA LA EMPRESA:
--
--   · Al pedir días que ya tiene otra persona (pendientes o aprobados) sale un aviso, pero se puede pedir.
--   · Al aprobar, el admin ve el choque y puede autorizarlo como EXCEPCIÓN con un motivo obligatorio
--     (vacation_requests.solape_autorizado + solape_motivo).
--   · Los compañeros ven quién está fuera cada día (aprobadas y pendientes), sin motivos ni saldos: eso lo
--     sirve /api/vacations/equipo con el cliente de servicio. La RLS de la 116 NO se toca.
--
-- Qué añade:
--   · public.vacation_settings   una sola fila con el máximo de personas fuera a la vez (por defecto 1). Cerrada al
--                                navegador (RLS sin políticas): la leen y la cambian las rutas de /api/vacations.
--   · employees.vacation_color   el color de cada persona en el calendario ('#rrggbb'; NULL = uno estable por su id).
--   · employees.festivos_lugar   dónde vive, para que sus festivos no le gasten vacaciones: {"ccaa":"MD","ine":"28079"}
--                                (códigos de lib/ubicacion/zonas.ts). NULL = solo cuentan los fines de semana, que es
--                                lo de siempre: así nadie de Latinoamérica pierde un día por un festivo de España.
--   · vacation_requests.solape_autorizado / solape_motivo   la excepción al choque, con su motivo (CHECK).
--   · vacation_requests.cancel_reason                       el motivo de una anulación, que hasta hoy se perdía.
--   · Un índice por rango (end_date, start_date) de las peticiones vivas, para «quién está fuera entre estas fechas».
--   · La campana admite 'vacaciones_pedida' (al admin) y 'vacaciones_resuelta' (al empleado: aprobada, denegada o anulada).
--
-- Las reglas de saldo (días por mes, arrastre hasta el 31 de marzo, 30 días de preaviso) NO cambian.
-- Se puede lanzar dos veces.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.vacation_requests') IS NULL THEN
    RAISE EXCEPTION 'Falta public.vacation_requests (migración 116).';
  END IF;
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Falta public.notifications (migración 040).';
  END IF;
END $$;

-- ---------- Ajustes del módulo: una sola fila ----------
CREATE TABLE IF NOT EXISTS public.vacation_settings (
  -- Siempre true: la clave primaria garantiza que solo hay una fila
  id           BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- Cuántas personas pueden estar fuera el mismo día sin que salte el choque
  max_a_la_vez INT NOT NULL DEFAULT 1 CHECK (max_a_la_vez BETWEEN 1 AND 50),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.vacation_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.vacation_settings (id, max_a_la_vez) VALUES (true, 1) ON CONFLICT (id) DO NOTHING;

-- ---------- La ficha: color y lugar de los festivos ----------
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS vacation_color TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS festivos_lugar JSONB;

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_vacation_color_ok;
ALTER TABLE public.employees ADD CONSTRAINT employees_vacation_color_ok
  CHECK (vacation_color IS NULL OR vacation_color ~ '^#[0-9a-fA-F]{6}$');

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_festivos_lugar_ok;
ALTER TABLE public.employees ADD CONSTRAINT employees_festivos_lugar_ok
  CHECK (festivos_lugar IS NULL OR (jsonb_typeof(festivos_lugar) = 'object' AND festivos_lugar ? 'ccaa'));

-- ---------- La petición: excepción al choque y motivo de anulación ----------
ALTER TABLE public.vacation_requests ADD COLUMN IF NOT EXISTS solape_autorizado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.vacation_requests ADD COLUMN IF NOT EXISTS solape_motivo TEXT;
ALTER TABLE public.vacation_requests ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Una excepción sin motivo no se puede autorizar
ALTER TABLE public.vacation_requests DROP CONSTRAINT IF EXISTS vacation_requests_solape_motivado;
ALTER TABLE public.vacation_requests ADD CONSTRAINT vacation_requests_solape_motivado
  CHECK (NOT solape_autorizado OR btrim(COALESCE(solape_motivo, '')) <> '');

-- «Quién está fuera entre estas dos fechas»: end_date >= desde AND start_date <= hasta, solo las vivas
CREATE INDEX IF NOT EXISTS idx_vacation_requests_vivas_por_fin
  ON public.vacation_requests (end_date, start_date)
  WHERE status IN ('pendiente', 'aprobada');

-- ---------- La campana: el mismo listado que la 307, más los dos de vacaciones ----------
DO $$
DECLARE desconocidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT type, ', ') INTO desconocidos FROM public.notifications WHERE type NOT IN (
    'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
    'freno_stock', 'fallo_stock',
    'fallo_amazon', 'job_amazon',
    'alarma_correo',
    'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
    'fba_alerta', 'fba_resumen',
    'factura_impagada',
    'analisis_abierto',
    'cuenta_aviso',
    'vacaciones_pedida', 'vacaciones_resuelta'
  );
  IF desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay avisos en la campana de un tipo que esta migracion no conoce (%). Anadelo a la lista antes de lanzarla.', desconocidos;
  END IF;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
      'freno_stock', 'fallo_stock',
      'fallo_amazon', 'job_amazon',
      'alarma_correo',
      'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
      'fba_alerta', 'fba_resumen',
      'factura_impagada',
      'analisis_abierto',
      'cuenta_aviso',
      'vacaciones_pedida', 'vacaciones_resuelta'
    ));
END $$;

-- ============================================================================
-- COMPROBACIÓN · las cinco columnas tienen que decir «true»; la sexta, el máximo a la vez (1)
-- ============================================================================
SELECT
  to_regclass('public.vacation_settings') IS NOT NULL AS ajustes_creados,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'vacation_settings') AS ajustes_cerrados_al_navegador,
  (SELECT count(*) = 2 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'employees' AND column_name IN ('vacation_color', 'festivos_lugar')) AS ficha_con_color_y_festivos,
  (SELECT count(*) = 3 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vacation_requests' AND column_name IN ('solape_autorizado', 'solape_motivo', 'cancel_reason')) AS peticion_con_excepcion_y_anulacion,
  (SELECT pg_get_constraintdef(oid) LIKE '%vacaciones_pedida%' AND pg_get_constraintdef(oid) LIKE '%vacaciones_resuelta%' FROM pg_constraint
     WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass) AS la_campana_admite_los_avisos,
  (SELECT max_a_la_vez FROM public.vacation_settings WHERE id) AS max_a_la_vez;

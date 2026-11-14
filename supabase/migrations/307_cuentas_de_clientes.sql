-- ============================================================================
-- 307 · CUENTAS DE CLIENTES: quién lleva cada cliente, en qué semana del ciclo está y qué se ha hecho
-- ============================================================================
-- 14 nov 2026. Raúl quita a la persona de marketing: las cuentas de los clientes (SEO, PPC, cumplimiento, informes) las llevan los
-- administrativos de principio a fin, con libertad total en Amazon.
--
--   · cuentas_gestion       una fila por cliente (amazon_clients): su responsable y el lunes en que empezó su ciclo de 4 semanas (S1–S4).
--   · cuentas_ciclo_hechos  lo que se ha marcado como hecho de cada semana del ciclo (revisar propuestas, informe semanal…).
--   · cuentas_informes      los informes al cliente (borrador → enviado), y a quién se mandan (cuentas_gestion.correo_informes).
--   · La campana admite el aviso 'cuenta_aviso' (lo que le pasa a una cuenta, al responsable).
--   · NO da acceso a nadie: está en pruebas (Raúl, 14 nov 2026). Las cuatro apps (Cuentas de clientes, PPC, SEO y Cumplimiento) las sigue abriendo
--     solo un administrador; a un empleado habría que marcarle la casilla a mano en Gestión de Usuarios.
--
-- Las tablas están cerradas al navegador (RLS sin políticas): todo pasa por /api/cuentas con el cliente de servicio, que comprueba el acceso
-- (lib/cuentas/acceso.ts). Se puede lanzar dos veces.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.amazon_clients') IS NULL THEN
    RAISE EXCEPTION 'Falta public.amazon_clients (migración 118).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cuentas_gestion (
  amazon_client_id UUID PRIMARY KEY REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  responsable_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- El lunes en que empezó la S1 del ciclo. La semana de hoy sale de aquí: ((hoy - ciclo_inicio) / 7) mod 4 + 1
  ciclo_inicio     DATE,
  notas            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cuentas_gestion_responsable ON public.cuentas_gestion (responsable_id);
ALTER TABLE public.cuentas_gestion ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cuentas_ciclo_hechos (
  amazon_client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  -- El lunes de la semana a la que pertenece lo hecho
  semana           DATE NOT NULL,
  -- El id del paso (lib/cuentas/ciclo.ts): 'propuestas', 'informe-semanal', 'auditoria'…
  paso             TEXT NOT NULL,
  hecho_por        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  hecho_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nota             TEXT,
  PRIMARY KEY (amazon_client_id, semana, paso)
);
ALTER TABLE public.cuentas_ciclo_hechos ENABLE ROW LEVEL SECURITY;

-- A quién se le manda el informe (una o varias direcciones separadas por comas)
ALTER TABLE public.cuentas_gestion ADD COLUMN IF NOT EXISTS correo_informes TEXT;

-- Los informes al cliente (semanal, quincenal y mensual): nacen en borrador con las cifras congeladas y la lectura de la IA, y se envían desde el
-- buzón de quien los manda con un enlace a /informe/<token> (sin sesión: el token es la credencial y solo abre ESE informe)
CREATE TABLE IF NOT EXISTS public.cuentas_informes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amazon_client_id UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL CHECK (tipo IN ('semanal', 'quincenal', 'mensual')),
  desde            DATE NOT NULL,
  hasta            DATE NOT NULL,
  datos            JSONB NOT NULL,
  lectura          TEXT NOT NULL DEFAULT '',
  lectura_ia       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Lo hecho fuera del ERP que añade el administrativo: [{accion, cantidad, criterio}]
  extra            JSONB NOT NULL DEFAULT '[]'::jsonb,
  token            TEXT NOT NULL UNIQUE,
  estado           TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviado')),
  creado_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enviado_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  enviado_at       TIMESTAMPTZ,
  enviado_a        TEXT
);
CREATE INDEX IF NOT EXISTS idx_cuentas_informes_cliente ON public.cuentas_informes (amazon_client_id, creado_at DESC);
ALTER TABLE public.cuentas_informes ENABLE ROW LEVEL SECURITY;

-- La campana: el mismo listado que la 303, más 'cuenta_aviso'
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
    'cuenta_aviso'
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
      'cuenta_aviso'
    ));
END $$;

-- ============================================================================
-- COMPROBACIÓN · las tres primeras columnas tienen que decir «true»; la cuarta, quién tiene la casilla de Cuentas (tiene que salir vacía)
-- ============================================================================
SELECT
  to_regclass('public.cuentas_gestion') IS NOT NULL AND to_regclass('public.cuentas_ciclo_hechos') IS NOT NULL AND to_regclass('public.cuentas_informes') IS NOT NULL AS tablas_creadas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('cuentas_gestion', 'cuentas_ciclo_hechos', 'cuentas_informes')) AS cerradas_al_navegador,
  (SELECT pg_get_constraintdef(oid) LIKE '%cuenta_aviso%' FROM pg_constraint
     WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass) AS la_campana_admite_el_aviso,
  (SELECT string_agg(DISTINCT p.full_name, ', ') FROM public.user_app_permissions u JOIN public.profiles p ON p.id = u.user_id
     WHERE u.app_id = 'cuentas' AND u.can_access) AS con_acceso_a_cuentas;

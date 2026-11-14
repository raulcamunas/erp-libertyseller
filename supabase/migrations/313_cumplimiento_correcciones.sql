-- ============================================================================
-- 313 · CUMPLIMIENTO: LAS CORRECCIONES HECHAS DESDE EL ERP (validar y enviar a Amazon), con su registro
-- ============================================================================
-- 14 nov 2026. Hasta hoy la app Cumplimiento solo leía: todo se arreglaba a mano en Seller Central. Desde ahora una incidencia que
-- se arregla rellenando un dato de la ficha (un atributo) se corrige desde el panel «Corregir» de la propia incidencia.
--
-- Decisión de Raúl: corrigen los administradores y quien tenga la casilla de Cumplimiento, SIEMPRE con validación previa y con registro.
--
--   · cumplimiento_correcciones  una fila por cada «Validar» y cada «Enviar»: qué listing (conexión, país, SKU), por qué incidencia,
--                                con qué tipo de producto, qué se mandó (patches), qué había antes, qué contestó Amazon y quién lo hizo.
--   · El servidor NO deja enviar sin una validación correcta de LOS MISMOS cambios (misma huella) del mismo usuario en los últimos
--     30 minutos (lib/cumplimiento/correccion-servidor.ts). Sin esta tabla se puede validar, pero no enviar.
--   · Nada de envíos en lote por Feeds API: un listing cada vez (queda para otra fase).
--
-- La tabla está cerrada al navegador (RLS sin políticas): todo pasa por /api/cumplimiento con el cliente de servicio, que comprueba el
-- acceso (requireAppDeCuentas('cumplimiento')). Se puede lanzar dos veces. No toca la campana ni ninguna otra tabla.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.amazon_connections') IS NULL THEN
    RAISE EXCEPTION 'Falta public.amazon_connections (migración 118).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cumplimiento_correcciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id    TEXT NOT NULL,
  sku               TEXT NOT NULL,
  -- El código de Amazon de la incidencia que se corrige ('90220'…). NULL = se corrigió sin partir de una incidencia concreta
  codigo_incidencia TEXT,
  product_type      TEXT NOT NULL,
  -- Lo que se manda a patchListingsItem, tal cual: [{ op, path, value }]
  patches           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Los valores que tenía cada atributo tocado antes del cambio: { atributo: [...] }. Para poder deshacerlo a mano
  valor_anterior    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Huella de los patches: une un envío con la validación que lo precede
  huella            TEXT NOT NULL,
  modo              TEXT NOT NULL CHECK (modo IN ('validar', 'enviar')),
  -- validar: 'valido' | 'invalido' | 'error'.  enviar: 'aceptado' | 'invalido' | 'error'
  estado            TEXT NOT NULL CHECK (estado IN ('valido', 'aceptado', 'invalido', 'error')),
  submission_id     TEXT,
  -- Los issues que devolvió Amazon (errores y avisos), tal cual
  issues            JSONB NOT NULL DEFAULT '[]'::jsonb,
  mensaje           TEXT,
  creado_por        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cumplimiento_correcciones_listing
  ON public.cumplimiento_correcciones (connection_id, marketplace_id, sku, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_cumplimiento_correcciones_fecha
  ON public.cumplimiento_correcciones (connection_id, creado_at DESC);

ALTER TABLE public.cumplimiento_correcciones ENABLE ROW LEVEL SECURITY;
-- Sin políticas: nadie la lee ni la escribe desde el navegador. Por si alguna vez se abrió a mano:
DROP POLICY IF EXISTS cumplimiento_correcciones_lectura ON public.cumplimiento_correcciones;

COMMENT ON TABLE public.cumplimiento_correcciones IS
  'Cumplimiento (313): cada validación y cada envío de una corrección de atributos a Amazon desde el ERP. Solo servidor.';

-- ============================================================================
-- COMPROBACIÓN · las dos columnas tienen que decir «true»
-- ============================================================================
SELECT
  to_regclass('public.cumplimiento_correcciones') IS NOT NULL AS tabla_creada,
  (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'cumplimiento_correcciones') AS cerrada_al_navegador;

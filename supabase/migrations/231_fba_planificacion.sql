-- ============================================================================
-- 231 · LA ANTIGÜEDAD DEL STOCK, TAL Y COMO LA CUENTA AMAZON
-- ============================================================================
--
-- El panel del cliente (Remesas a FBA) enseñaba la antigüedad del stock ESTIMADA a partir del
-- libro mayor: cada entrada es un lote y las ventas se llevan el más antiguo. Es una estimación,
-- y se queda corta justo donde más importa: lo que entró antes de que empiece el libro que
-- tenemos sale sin edad, y las devoluciones que vuelven al stock —Amazon las cuenta como
-- recientes— salen con una edad que no es la suya.
--
-- Amazon da la edad REAL, la que usa para cobrar, en su informe de planificación de inventario
-- (GET_FBA_INVENTORY_PLANNING_DATA): una fila por SKU con las unidades de cada tramo de
-- antigüedad —los mismos que enseña Seller Central: 0-60, 61-90, 91-180, 181-330, 331-365,
-- 366-455 y más de 455 días—, lo que calcula que costará guardarlo el mes que viene y el recargo
-- por inventario antiguo. Esta tabla guarda la ÚLTIMA foto de cada cuenta y mercado.
--
--   · `edad`     unidades por tramo: {"a0": 2, "a61": 0, "a91": 1, "a181": 0, "a331": 0, "a366": 0, "a456": 0}
--   · `recargo`  lo que Amazon calcula de recargo por antigüedad en cada tramo (mismas claves)
--
-- La pasada nocturna del libro mayor (/api/fba/cron-remesas) y el botón «Leer de Amazon» del
-- panel la rellenan. Una fila por (conexión, mercado, SKU): cada lectura pone la última foto y
-- quita las filas que ya no salen en el informe.
--
-- También añade tres columnas a `fba_lecturas` para dejar dicho cómo fue la última lectura de
-- este informe (cuándo, y por qué falló si falló), como ya hace con la del libro mayor.
--
-- Se lanza en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- El código funciona sin esta migración (el panel sigue enseñando la antigüedad estimada del
-- libro) y avisa de que falta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fba_planificacion (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  sku TEXT NOT NULL,

  /** El día de la foto de antigüedad que trae el informe (puede ir unos días por detrás de hoy) */
  fecha_foto DATE,

  disponible INTEGER NOT NULL DEFAULT 0,
  no_vendible INTEGER NOT NULL DEFAULT 0,
  edad JSONB NOT NULL DEFAULT '{}'::jsonb,
  recargo JSONB NOT NULL DEFAULT '{}'::jsonb,

  /** Lo que Amazon calcula que costará guardar este SKU el mes que viene (recargos incluidos) */
  coste_mes NUMERIC,
  moneda TEXT,
  dias_suministro NUMERIC,
  /** La acción que recomienda Amazon, tal cual */
  accion TEXT,
  informe TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, sku)
);

COMMENT ON TABLE public.fba_planificacion IS
  'La última foto del informe de planificación de inventario de Amazon (GET_FBA_INVENTORY_PLANNING_DATA) por SKU: antigüedad del stock por tramos, coste de almacenaje estimado y recargo por antigüedad. La rellena la pasada nocturna del libro mayor. Ver lib/fba/planificacion.ts.';

-- Tienen que ser objetos: un número o una lista suelta no es un reparto por tramos
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fba_planificacion_edad_es_objeto') THEN
    ALTER TABLE public.fba_planificacion
      ADD CONSTRAINT fba_planificacion_edad_es_objeto
      CHECK (jsonb_typeof(edad) = 'object' AND jsonb_typeof(recargo) = 'object');
  END IF;
END $$;

ALTER TABLE public.fba_lecturas
  ADD COLUMN IF NOT EXISTS planificacion_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planificacion_error TEXT,
  ADD COLUMN IF NOT EXISTS planificacion_informe TEXT;

-- ---------- RLS · el mismo listón que el resto de las tablas FBA (190) ----------
--
-- Solo LECTURA para admin y las escrituras REVOCADAS para todo el mundo: todo lo que escribe aquí
-- es servidor, con la clave de servicio, que se salta RLS.

ALTER TABLE public.fba_planificacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins leen planificacion" ON public.fba_planificacion;
CREATE POLICY "Admins leen planificacion"
  ON public.fba_planificacion FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fba_planificacion FROM authenticated, anon;

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fba_planificacion'
  ) THEN
    RAISE EXCEPTION 'No se ha creado la tabla fba_planificacion.';
  END IF;
  IF (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fba_lecturas'
      AND column_name IN ('planificacion_at', 'planificacion_error', 'planificacion_informe')
  ) <> 3 THEN
    RAISE EXCEPTION 'Faltan las columnas de planificación en fba_lecturas.';
  END IF;
  RAISE NOTICE 'Listo. fba_planificacion existe: el panel podrá enseñar la antigüedad real de Amazon.';
END $$;

-- ============================================================================
-- 220 · AUDITOR DE STOCK
-- ============================================================================
--
-- Cada 15 minutos (se cambia desde Sistema) un auditor lee EN DIRECTO el stock de
-- todos los listings de una cuenta y apunta aquí cuántos tienen stock y cuántos
-- no, con la lista de los que sí (SKU, ASIN y cantidad). Hoy solo corre para
-- ShoesF.
--
-- POR QUÉ UNA TABLA PROPIA Y NO EL ESPEJO DEL CATÁLOGO
-- ----------------------------------------------------
-- El espejo (`amazon_listings`) guarda SOLO el último valor de cada SKU, y se
-- refresca a razón de ~1.000 referencias cada cuarto de hora: un SKU concreto
-- puede tardar horas en actualizarse. Un auditor necesita lo contrario: la foto
-- de AHORA y la de hace una hora, para ver QUÉ SE MOVIÓ y cuándo.
--
-- Y TAMPOCO `amazon_snapshots` (la serie de inventario): escribe una fila por SKU
-- y observación. A 15 minutos y ~14.000 SKU son 1,3 millones de filas AL DÍA.
-- Aquí es UNA fila por auditoría (96 al día) y el detalle va dentro, en JSONB.
--
-- LO QUE GUARDA EL DETALLE
-- ------------------------
-- `detalle` lleva SOLO los SKU con stock, como tuplas [sku, asin, cantidad,
-- canal] ('M' = el vendedor, 'A' = Amazon). Los que no tienen stock son ~12.000
-- y no se listan: se cuentan. `cambios` lleva lo que se movió respecto a la
-- auditoría completa anterior: {entran: [[sku, cantidad]], salen: [[sku, antes]]}.
--
-- `con_stock`, `sin_stock` y `sin_dato` son TRES cosas, y `sin_dato` NO es un
-- cero: es un SKU del que Amazon no ha dicho cuánto hay. Mezclarlo con «sin
-- stock» haría parecer agotado lo que simplemente no se ha podido leer.
--
-- Una auditoría `parcial` es la que se quedó sin tiempo antes de terminar: sus
-- cifras son ciertas para lo leído y NO son comparables con las de una completa,
-- así que no calcula `entran` ni `salen`.
--
-- RETENCIÓN: el código borra lo que tenga más de 21 días en cada pasada. Con
-- ~25 KB de detalle comprimido por auditoría son unos 50 MB en régimen.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_auditorias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES public.amazon_clients(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id  TEXT NOT NULL,
  creada_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duracion_ms     INTEGER CHECK (duracion_ms IS NULL OR duracion_ms >= 0),

  estado          TEXT NOT NULL CHECK (estado IN ('completa', 'parcial', 'error')),
  error           TEXT,

  -- Lo que se pidió y lo que Amazon contestó
  skus_pedidos    INTEGER NOT NULL DEFAULT 0 CHECK (skus_pedidos >= 0),
  leidas          INTEGER NOT NULL DEFAULT 0 CHECK (leidas >= 0),
  no_vinieron     INTEGER NOT NULL DEFAULT 0 CHECK (no_vinieron >= 0),

  -- El recuento
  con_stock       INTEGER NOT NULL DEFAULT 0 CHECK (con_stock >= 0),
  sin_stock       INTEGER NOT NULL DEFAULT 0 CHECK (sin_stock >= 0),
  sin_dato        INTEGER NOT NULL DEFAULT 0 CHECK (sin_dato >= 0),
  unidades        BIGINT  NOT NULL DEFAULT 0 CHECK (unidades >= 0),
  con_stock_fbm   INTEGER NOT NULL DEFAULT 0 CHECK (con_stock_fbm >= 0),
  con_stock_fba   INTEGER NOT NULL DEFAULT 0 CHECK (con_stock_fba >= 0),

  -- Qué se movió respecto a la auditoría completa anterior. NULL = no se pudo
  -- comparar (primera auditoría, o esta o la anterior no es completa)
  entran          INTEGER CHECK (entran IS NULL OR entran >= 0),
  salen           INTEGER CHECK (salen IS NULL OR salen >= 0),
  cambios         JSONB,
  detalle         JSONB,

  -- Una auditoría fallida SIEMPRE dice por qué
  CONSTRAINT stock_auditorias_error_ok CHECK (estado <> 'error' OR error IS NOT NULL)
);

COMMENT ON TABLE public.stock_auditorias IS
  'Auditor de stock: una fila por pasada, con el recuento y el detalle de los SKU con stock.';

CREATE INDEX IF NOT EXISTS idx_stock_auditorias_reciente
  ON public.stock_auditorias (connection_id, marketplace_id, creada_at DESC);

-- ---------- Seguridad: solo lo ve un admin, y solo escribe el servidor ----------
ALTER TABLE public.stock_auditorias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_auditorias_admin_lee ON public.stock_auditorias;
CREATE POLICY stock_auditorias_admin_lee
  ON public.stock_auditorias
  FOR SELECT TO authenticated
  USING (public.is_erp_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stock_auditorias FROM authenticated, anon;

-- ---------- El horario: cada 15 minutos, se cambia desde Sistema ----------
INSERT INTO public.cron_config (tarea, cada_minutos, activo)
VALUES ('auditor-stock', 15, true)
ON CONFLICT (tarea) DO UPDATE
  SET cada_minutos = EXCLUDED.cada_minutos,
      activo = EXCLUDED.activo,
      actualizado_at = NOW();

-- ============================================================================
-- 222 · EL AUDITOR DE STOCK TAMBIÉN LEE LA TIENDA PRESTASHOP EN CADA PASADA
-- ============================================================================
--
-- Cada auditoría (cada 10 minutos) lee el stock de Amazon y, si el cliente tiene
-- su tienda PrestaShop conectada (migración 221), lee también el de la tienda y
-- cruza los dos por EAN y por referencia. Aquí se guarda qué salió, para poder ver
-- cómo evoluciona hora a hora y no solo la última foto.
--
-- TODAS LAS COLUMNAS SON NULLABLE. Las auditorías anteriores a esta migración no
-- tienen dato de tienda, y las de un cliente sin tienda conectada tampoco: NULL
-- quiere decir «no se miró», que no es lo mismo que cero. Un cero aquí sería una
-- tienda sin una sola talla con stock.
--
-- QUÉ SIGNIFICA CADA GRUPO
-- ------------------------
--   ps_*       LA TIENDA ENTERA: cuántas tallas tiene y cuántas con stock. Incluye
--              tallas que no están en Amazon, así que NO es comparable con
--              `con_stock` de Amazon: son universos distintos.
--   cruce_*    CÓMO SE EMPAREJÓ: cuántos listings FBM de Amazon encontraron su talla
--              (por EAN o por referencia), cuántos no, y cuántos son dudosos.
--   cruce_amz_con_stock / cruce_ps_con_stock
--              LO COMPARABLE: entre los listings emparejados con certeza, cuántos
--              tienen stock en Amazon y cuántos en la tienda. Es la pareja de
--              números que se puede mirar de frente.
--   div_*      LAS DIVERGENCIAS entre los emparejados: Amazon vende y la tienda no
--              tiene (sobreventa), la tienda tiene y Amazon no (venta perdida), y
--              cantidad distinta.
--   contraste  las listas de SKU de esas divergencias (tuplas compactas, con tope).
--
-- Una auditoría `parcial` o con error NO cruza: sus cifras de Amazon no son
-- completas y compararlas con la tienda enseñaría divergencias que no existen.
-- ============================================================================

ALTER TABLE public.stock_auditorias
  ADD COLUMN IF NOT EXISTS ps_estado            TEXT
    CHECK (ps_estado IS NULL OR ps_estado IN ('ok', 'error', 'omitida')),
  ADD COLUMN IF NOT EXISTS ps_error             TEXT,
  ADD COLUMN IF NOT EXISTS ps_ms                INTEGER CHECK (ps_ms IS NULL OR ps_ms >= 0),

  ADD COLUMN IF NOT EXISTS ps_tallas            INTEGER CHECK (ps_tallas IS NULL OR ps_tallas >= 0),
  ADD COLUMN IF NOT EXISTS ps_con_stock         INTEGER CHECK (ps_con_stock IS NULL OR ps_con_stock >= 0),
  ADD COLUMN IF NOT EXISTS ps_sin_stock         INTEGER CHECK (ps_sin_stock IS NULL OR ps_sin_stock >= 0),
  ADD COLUMN IF NOT EXISTS ps_sin_dato          INTEGER CHECK (ps_sin_dato IS NULL OR ps_sin_dato >= 0),
  ADD COLUMN IF NOT EXISTS ps_unidades          BIGINT  CHECK (ps_unidades IS NULL OR ps_unidades >= 0),

  ADD COLUMN IF NOT EXISTS cruce_cruzados       INTEGER CHECK (cruce_cruzados IS NULL OR cruce_cruzados >= 0),
  ADD COLUMN IF NOT EXISTS cruce_por_ean        INTEGER CHECK (cruce_por_ean IS NULL OR cruce_por_ean >= 0),
  ADD COLUMN IF NOT EXISTS cruce_por_ref        INTEGER CHECK (cruce_por_ref IS NULL OR cruce_por_ref >= 0),
  ADD COLUMN IF NOT EXISTS cruce_sin_pareja     INTEGER CHECK (cruce_sin_pareja IS NULL OR cruce_sin_pareja >= 0),
  ADD COLUMN IF NOT EXISTS cruce_ambiguos       INTEGER CHECK (cruce_ambiguos IS NULL OR cruce_ambiguos >= 0),
  ADD COLUMN IF NOT EXISTS cruce_amz_con_stock  INTEGER CHECK (cruce_amz_con_stock IS NULL OR cruce_amz_con_stock >= 0),
  ADD COLUMN IF NOT EXISTS cruce_ps_con_stock   INTEGER CHECK (cruce_ps_con_stock IS NULL OR cruce_ps_con_stock >= 0),

  ADD COLUMN IF NOT EXISTS div_sobreventa       INTEGER CHECK (div_sobreventa IS NULL OR div_sobreventa >= 0),
  ADD COLUMN IF NOT EXISTS div_venta_perdida    INTEGER CHECK (div_venta_perdida IS NULL OR div_venta_perdida >= 0),
  ADD COLUMN IF NOT EXISTS div_distinta         INTEGER CHECK (div_distinta IS NULL OR div_distinta >= 0),
  ADD COLUMN IF NOT EXISTS div_iguales          INTEGER CHECK (div_iguales IS NULL OR div_iguales >= 0),

  ADD COLUMN IF NOT EXISTS contraste            JSONB;

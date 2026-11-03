-- ============================================================================
-- 269 · ENTRAIS AMAZON: EL EAN DE CADA REFERENCIA EN LA TABLA DE PRECIOS
-- ============================================================================
--
-- La tabla de precios enseña el SKU de Entrais (el código del proveedor), pero para subir un producto a otro mercado —PcComponentes, por ejemplo— hace
-- falta el EAN. Viene en el catálogo del proveedor; el motor lo guarda ahora junto al precio y la pantalla lo enseña (y el Excel lo lleva).
--
-- UNA COLUMNA NUEVA, SIN TOCAR NINGÚN DATO. El código funciona SIN esta migración: el motor reintenta sin el EAN y la pantalla simplemente no lo enseña.
-- El EAN aparece tras la siguiente pasada de recálculo de precios (o al darle a «Recalcular»).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- ============================================================================

ALTER TABLE public.entrais_precios ADD COLUMN IF NOT EXISTS ean TEXT;

COMMENT ON COLUMN public.entrais_precios.ean IS
  'EAN del producto según el catálogo del proveedor (limpio y válido); NULL si no lo trae. Lo escribe el motor de precios en cada pasada.';

-- COMPROBACIÓN: tiene que decir «true».
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'entrais_precios' AND column_name = 'ean'
) AS tiene_la_columna_ean;

-- ============================================================================
-- 230 · PROPUESTAS CON IA: QUÉ DIJO LA IA Y POR QUÉ
-- ============================================================================
--
-- Una propuesta de envío puede nacer de la IA (Remesas a FBA -> botón «Propuesta con IA»): el
-- motor mira el inventario del cliente, calcula qué hace falta mandar y le pide a una IA que lo
-- revise con criterio. Lo que se guarda como remesa son las referencias y las cantidades de
-- siempre; esta columna guarda el PORQUÉ:
--
--   · el resumen y el criterio con el que se montó,
--   · los riesgos y lo que habría que confirmar con el cliente,
--   · el motivo de cada línea, y qué cantidad propuso el cálculo y cuál la IA,
--   · lo que se dejó fuera y por qué,
--   · y los parámetros con los que se generó (plazo, cobertura, tope de unidades, notas).
--
-- Meses después, cuando alguien pregunte «¿por qué mandamos 120 de esto?», la respuesta está en
-- la propuesta y no depende de que alguien se acuerde.
--
-- UNA COLUMNA JSONB EN LA REMESA y no una por línea, a propósito: el editor del boceto reescribe
-- cada línea entera al guardar, y un campo nuevo en la línea se habría perdido en el primer
-- cambio de cantidad. Una columna aparte no se toca.
--
-- NULL = la propuesta no viene de la IA (todas las de antes, y las que se montan a mano).
--
-- Se lanza en el editor SQL de Supabase, después de la 229. IDEMPOTENTE: se puede volver a
-- pegar sin romper nada. El código funciona sin esta migración (la propuesta se crea igual; lo
-- único que no se guarda es el análisis) y la pantalla lo avisa.
-- ============================================================================

ALTER TABLE public.fba_remesas
  ADD COLUMN IF NOT EXISTS analisis_ia JSONB;

COMMENT ON COLUMN public.fba_remesas.analisis_ia IS
  'El análisis de la IA que montó esta propuesta: resumen, criterio, riesgos, dudas, motivo de cada línea y parámetros. NULL = no viene de la IA. Lo reconstruye y acota lib/fba/analisis-ia.ts antes de guardar.';

-- Tiene que ser un objeto: un número o una lista suelta no es un análisis
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fba_remesas_analisis_ia_es_objeto'
  ) THEN
    ALTER TABLE public.fba_remesas
      ADD CONSTRAINT fba_remesas_analisis_ia_es_objeto
      CHECK (analisis_ia IS NULL OR jsonb_typeof(analisis_ia) = 'object');
  END IF;
END $$;

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fba_remesas' AND column_name = 'analisis_ia'
  ) THEN
    RAISE EXCEPTION 'No se ha creado la columna fba_remesas.analisis_ia.';
  END IF;
  RAISE NOTICE 'Listo. fba_remesas.analisis_ia existe: las propuestas con IA guardarán su análisis.';
END $$;

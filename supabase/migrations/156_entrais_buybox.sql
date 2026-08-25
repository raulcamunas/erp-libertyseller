-- ==================================================================
-- 156 · QUE SE VEA LA DECISION DE LA BUY BOX, NO SOLO EL RESULTADO
-- ==================================================================
--
-- La fila de un precio decia a que precio publicar, pero no si se habia
-- considerado bajar al de la oferta destacada ni por que no. Y eso es la mitad
-- de la decision: un producto que no baja porque la Buy Box YA ES NUESTRA y uno
-- que no baja porque el margen NO DA se ven exactamente igual en pantalla, y
-- son cosas opuestas — la primera esta bien, la segunda es una venta perdida
-- que a lo mejor se recupera tocando el suelo.
--
-- Dos columnas:
--
--   margen_en_foep   que margen quedaria publicando al precio de la Buy Box.
--                    Se calcula SIEMPRE que haya FOEP, se acabe bajando o no:
--                    es lo que permite elegir el suelo mirando numeros en vez
--                    de poner uno a ojo y ver que pasa.
--
--   motivo_buybox    por que se bajo o por que no. Siete valores y no un
--                    booleano, porque «no se baja» son cosas muy distintas.

ALTER TABLE public.entrais_precios
  ADD COLUMN IF NOT EXISTS margen_en_foep NUMERIC,
  ADD COLUMN IF NOT EXISTS motivo_buybox TEXT;

COMMENT ON COLUMN public.entrais_precios.margen_en_foep IS
  'Margen que quedaria publicando al FOEP. Se calcula haya o no decision de bajar: es lo que deja elegir el suelo con datos.';
COMMENT ON COLUMN public.entrais_precios.motivo_buybox IS
  'sin_foep | sin_suelo | ya_es_nuestra | sin_competencia | sin_dato | foep_mas_alto | no_llega_al_suelo | se_baja';

DO $$
DECLARE faltan INTEGER;
BEGIN
  SELECT count(*) INTO faltan
    FROM unnest(ARRAY['margen_en_foep','motivo_buybox']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='entrais_precios' AND column_name=c
   );
  IF faltan > 0 THEN
    RAISE EXCEPTION 'Faltan % columnas en entrais_precios.', faltan;
  END IF;
  RAISE NOTICE 'La decision de la Buy Box queda guardada con su porque.';
END $$;

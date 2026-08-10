-- ==================================================================
-- 141 · LOS HORARIOS QUE SE HAN PEDIDO
-- ==================================================================
--
-- Cada dato al ritmo al que cambia:
--
--   ¿Gano la Buy Box?          -> cada 15 min · se mueve por minutos
--   Referencias nuevas         -> cada  1 h   · Amazon cachea el informe 1-6 h
--   Marca, categoria y medidas -> cada 20 h   · una vez al dia
--   Ranking de ventas (BSR)    -> cada 20 h   · un punto al dia de la serie
--   Historico de existencias   -> cada 20 h   · un punto al dia de la serie
--   Que SKU estan en seguimiento -> cada 20 h
--
-- El precio y el stock que se ven en pantalla NO estan aqui: los trae el ciclo
-- de catalogo cada 15 minutos, y ese horario vive en cron_config (migracion
-- 138), que es el otro reloj.
--
--
-- POR QUE 20 HORAS Y NO 24 EN LOS DIARIOS
-- ---------------------------------------
-- Para que dos pasadas seguidas no se descarten por minutos. Con 24 clavadas, un
-- barrido que ayer empezo a las 02:00 y hoy arranca a la 01:58 no llega por dos
-- minutos, se salta, y ese dia se pierde del historico sin que falle nada. Con
-- 20 h siempre le toca, y como ya no hay ventana nocturna (migracion 140) no se
-- desplaza a una hora mala.
--
--
-- POR QUE EL BUY BOX A 15 MINUTOS SI CABE
-- ---------------------------------------
-- La fase que contesta «¿gano la oferta destacada?» usa getListingOffersBatch:
-- 20 SKU por llamada, una llamada cada dos segundos. Son 4 min 22 s para las
-- 2.620 referencias de Shoplamp y 22 min para las 13.700 de ShoesF.
--
-- Lo caro de ese trabajo es el FOEP —«que precio necesito», una peticion cada
-- TREINTA segundos— y ese no barre el catalogo: va por cola y rotacion con su
-- propio tope. Por eso se puede subir la frecuencia de lo barato sin tocar lo
-- caro.

DO $$
BEGIN
  IF to_regclass('public.refresco_config') IS NULL THEN
    RAISE EXCEPTION
      'Falta public.refresco_config: lanza antes 139_refresco_config.sql.';
  END IF;
END $$;

-- UPDATE y no INSERT ... ON CONFLICT DO NOTHING: aqui SI se quiere pisar lo que
-- haya. Es el objeto del fichero — la 139 y la 140 ya crearon las filas.
UPDATE public.refresco_config SET cada_minutos =   15, solo_de_noche = false, actualizado_at = NOW() WHERE tipo = 'snapshot_precios';
UPDATE public.refresco_config SET cada_minutos =   60, solo_de_noche = false, actualizado_at = NOW() WHERE tipo = 'censo_catalogo';
UPDATE public.refresco_config SET cada_minutos = 1200, solo_de_noche = false, actualizado_at = NOW() WHERE tipo = 'enriquecer_catalogo';
UPDATE public.refresco_config SET cada_minutos = 1200, solo_de_noche = false, actualizado_at = NOW() WHERE tipo = 'snapshot_bsr';
UPDATE public.refresco_config SET cada_minutos = 1200, solo_de_noche = false, actualizado_at = NOW() WHERE tipo = 'inventario_fba';
UPDATE public.refresco_config SET cada_minutos = 1200, solo_de_noche = false, actualizado_at = NOW() WHERE tipo = 'recalcular_activos';

-- ---------- Comprobación ----------
DO $$
DECLARE mal INTEGER;
BEGIN
  SELECT count(*) INTO mal
    FROM public.refresco_config
   WHERE (tipo = 'snapshot_precios' AND cada_minutos <> 15)
      OR (tipo = 'censo_catalogo'   AND cada_minutos <> 60)
      OR (tipo IN ('enriquecer_catalogo','snapshot_bsr','inventario_fba','recalcular_activos')
          AND cada_minutos <> 1200)
      OR solo_de_noche IS TRUE;
  IF mal > 0 THEN
    RAISE EXCEPTION 'Han quedado % refrescos sin el horario pedido.', mal;
  END IF;
END $$;

-- ==================================================================
-- 140 · FUERA LA VENTANA NOCTURNA
-- ==================================================================
--
-- Que sea de dia o de noche deja de importar: los refrescos pueden arrancar a
-- cualquier hora.
--
--
-- Por que existia y por que se quita
-- ----------------------------------
-- La ventana (23:00 a 06:00, hora de Madrid) venia de la idea de que un barrido
-- de 13.700 SKU no debe competir de dia con las operaciones que si importan.
--
-- Pero el cupo de la Selling Partner API es POR OPERACION: searchCatalogItems
-- tiene su cubo, searchListingsItems el suyo y patchListingsItem el suyo. Un
-- barrido de atributos NO le quita fichas al refresco del catalogo ni al envio
-- de precios. La competencia que la ventana evitaba era mucho menor de lo que
-- parecia, y a cambio tenia un coste concreto: nada podia ponerse al dia
-- durante el dia.
--
-- Se quita como valor de partida, no como posibilidad: sigue siendo una columna
-- y se vuelve a encender por refresco desde Ingesta cuando haga falta.
--
--
-- Efecto secundario que conviene saber
-- ------------------------------------
-- Sin ventana, una cadencia de 24 h ya NO se salta noches. Con ventana, un
-- barrido que ayer empezo a las 02:00 y hoy arranca a la 01:58 no llegaba a las
-- 24 h por dos minutos, se descartaba, y ese cliente perdia una noche entera sin
-- que fallara nada. Por eso los valores de partida eran de 20 h y no de 24; sin
-- ventana, 24 h es perfectamente valido.

DO $$
BEGIN
  IF to_regclass('public.refresco_config') IS NULL THEN
    RAISE EXCEPTION
      'Falta public.refresco_config: lanza antes 139_refresco_config.sql.';
  END IF;
END $$;

UPDATE public.refresco_config
   SET solo_de_noche = false,
       actualizado_at = NOW()
 WHERE solo_de_noche IS TRUE;

-- ---------- Comprobación ----------
DO $$
DECLARE quedan INTEGER;
BEGIN
  SELECT count(*) INTO quedan FROM public.refresco_config WHERE solo_de_noche IS TRUE;
  IF quedan > 0 THEN
    RAISE EXCEPTION 'Han quedado % refrescos con ventana nocturna.', quedan;
  END IF;
END $$;

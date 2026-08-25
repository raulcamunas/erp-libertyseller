-- ==================================================================
-- 159 · EL FOEP SE PUEDE APAGAR POR CLIENTE
-- ==================================================================
--
-- Pedirle a Amazon el precio al que se ganaria la oferta destacada es lo caro de
-- «Precios y Buy Box»: UNA llamada cada treinta segundos, cuarenta SKU cada una.
-- Con 2.800 referencias son 35 minutos; con 6.900, casi tres horas. Las otras
-- dos fases del trabajo van a 0,5 llamadas por segundo y se despachan en nada.
--
-- Ya habia forma de saltarselo, pero POR EJECUCION: el parametro `foep: false`
-- del trabajo. Eso obliga a acordarse cada vez, y un trabajo programado no se
-- acuerda de nada. Esta columna lo hace permanente y por cliente, que es como
-- se decide de verdad.
--
--
-- POR QUE SE APAGA EN ENTRAIS
-- ---------------------------
-- Porque los numeros dicen que no sirve, y conviene dejarlos escritos. De 1.446
-- referencias donde la Buy Box la tiene otro Y tenemos su FOEP:
--
--     margen si bajasemos al FOEP     cuantas
--     ---------------------------     -------
--     NEGATIVO (vender perdiendo)       1.351      93 %
--     entre 0 % y 5 %                      70
--     entre 5 % y 9 %                      15
--     mas del 9 %                          10
--
-- Y de esos 25 ultimos, en TRECE ya estamos por debajo del FOEP: no hay nada que
-- bajar. Quedan DOCE productos en los que bajar tendria sentido, con recortes de
-- entre 0,31 € y 3,38 €.
--
-- Doce de 6.913, a cambio de tres horas de API cada pasada. El cliente compra a
-- un distribuidor y revende: su coste es el precio de mayorista de todo el
-- mundo, asi que quien tiene la Buy Box casi siempre puede bajar mas.
--
-- LO QUE NO SE APAGA es la fase 1, «quien tiene la Buy Box». Es barata y es la
-- que dice donde se estan perdiendo ventas: hoy, 1.842 referencias.

ALTER TABLE public.amazon_buybox_config
  ADD COLUMN IF NOT EXISTS foep_activo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.amazon_buybox_config.foep_activo IS
  'false = no se le pide a Amazon el precio al que se ganaria la oferta destacada. Se salta la fase mas cara del trabajo; la de «quien tiene la Buy Box» sigue corriendo.';

-- ---------- Apagado para Entrais ----------
UPDATE public.amazon_buybox_config c
SET foep_activo = false
FROM public.amazon_clients cl
WHERE c.client_id = cl.id AND cl.name = 'Entrais';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  apagados INTEGER;
  encendidos INTEGER;
BEGIN
  SELECT count(*) INTO apagados   FROM public.amazon_buybox_config WHERE NOT foep_activo;
  SELECT count(*) INTO encendidos FROM public.amazon_buybox_config WHERE foep_activo;

  -- Si no ha apagado ninguno, el cliente no se llama «Entrais» en la tabla y el
  -- UPDATE de arriba no ha hecho nada. Callarselo dejaria el trabajo pidiendo
  -- FOEP tres horas cada pasada con todo el mundo convencido de que esta
  -- apagado, que es peor que no haberlo intentado.
  IF apagados = 0 THEN
    RAISE EXCEPTION 'No se ha apagado el FOEP de ningun cliente. Comprueba como se llama Entrais en amazon_clients.';
  END IF;

  RAISE NOTICE 'FOEP: apagado en % cliente(s), encendido en %.', apagados, encendidos;
END $$;

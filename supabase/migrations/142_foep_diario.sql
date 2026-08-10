-- ==================================================================
-- 142 · EL FOEP, TODOS LOS DIAS Y SOLO DE LO QUE TIENE STOCK
-- ==================================================================
--
-- `foep_rotacion_dias` pasa de 7 a 1.
--
-- Los 7 dias venian de cuando el FOEP barria el catalogo ENTERO. Las 13.700
-- referencias de ShoesF son 343 llamadas a una cada treinta segundos: 2 h 53
-- min por pais. Repartirlas en siete noches las dejaba en 25 minutos, que era
-- lo unico que cabia.
--
-- Desde que el ambito del trabajo es solo lo que tiene existencias, ese mismo
-- cliente baja a unas 2.500 referencias: 63 llamadas, 31 minutos. Cabe en un
-- dia. Y tiene sentido que quepa, porque un techo de precio de hace seis dias
-- no sirve para decidir hoy.
--
-- El numero sigue siendo por cliente. El dia que entre un catalogo con 30.000
-- referencias CON STOCK habra que repartirlo otra vez: son 12,5 horas al dia.
--
--
-- OJO, ESTO SOLO ES SEGURO CON EL GUARDA DE «YA SE LE PIDIO HOY»
-- --------------------------------------------------------------
-- La rotacion decide de quien es el turno con el DIA, no con cuando se le
-- pregunto por ultima vez. Mientras «Precios y Buy Box» corria una vez por
-- noche daba igual; desde que corre cada quince minutos, la misma tanda salia
-- elegida 96 veces al dia. Con rotacion 1 eso seria pedirle el FOEP a TODO el
-- catalogo 96 veces.
--
-- El guarda esta en el codigo (skusConFoepDesde, en buybox/datos.ts): la
-- rotacion salta los SKU que ya tienen FOEP de hoy. Sin ese guarda, este
-- fichero es una mala idea.

DO $$
BEGIN
  IF to_regclass('public.amazon_buybox_config') IS NULL THEN
    RAISE EXCEPTION
      'Falta public.amazon_buybox_config: lanza antes 130_plataforma_a2_buybox.sql.';
  END IF;
END $$;

ALTER TABLE public.amazon_buybox_config
  ALTER COLUMN foep_rotacion_dias SET DEFAULT 1;

-- Los que siguen con el 7 de fabrica. NO se tocan los que alguien haya puesto a
-- otro numero a mano: esa es una decision tomada y este fichero no la conoce.
UPDATE public.amazon_buybox_config
   SET foep_rotacion_dias = 1
 WHERE foep_rotacion_dias = 7;

COMMENT ON COLUMN public.amazon_buybox_config.foep_rotacion_dias IS
  'Cada cuantos dias le toca el FOEP a cada SKU. 1 = todos los dias, que es lo '
  'normal desde que el ambito es solo lo que tiene stock. Subirlo solo hace '
  'falta con catalogos enormes: la cuenta es 40 SKU por llamada y una llamada '
  'cada 30 s.';

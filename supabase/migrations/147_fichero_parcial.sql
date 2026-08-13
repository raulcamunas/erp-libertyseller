-- 147 · FICHEROS QUE SOLO TRAEN LO QUE HA CAMBIADO
-- ================================================
--
-- «Su archivo es un archivo filtrado que solo envia stock de las referencias
-- que tiene y con el stock nuevo. Es un archivo variable: algun dia tendra 300,
-- otro dia 100, otro dia 500.»
--
-- Un DELTA, no un volcado. Y eso rompe tres de los cinco frenos, no porque
-- esten mal escritos sino porque miden algo que en un delta no existe.
--
--
-- LOS TRES QUE SE APAGAN Y POR QUE
-- --------------------------------
--   caida_lineas    -> compara con «lo habitual». En un delta lo habitual no
--                      existe: 100 lineas donde ayer hubo 500 es un martes.
--   pct_a_cero      -> el denominador son los SKU que el fichero resuelve. Con
--                      un delta de 3, dos a cero es el 67 %.
--   caida_unidades  -> se mide sobre lo que toca el lote. Tres articulos no
--                      dicen nada del catalogo.
--
-- Los tres saltarian casi todos los dias sin que pase nada malo. Un freno que
-- salta cuando todo va bien no protege: enseña a ignorarlo, y el dia que salte
-- de verdad nadie lo mira. Eso es PEOR que no tenerlo.
--
--
-- LOS DOS QUE SE QUEDAN
-- ---------------------
--   variacion_precio -> un precio que se mueve un 90 % esta mal venga en un
--                       fichero de 3 lineas o de 3.000.
--   max_cambios      -> es un numero ABSOLUTO. Si el delta normal mueve 30 SKU
--                       y un dia mueve 600, eso si es una anomalia.
--
-- Ninguno de los dos depende del tamaño del fichero, asi que ninguno de los dos
-- estorba. Siguen siendo opcionales: la exigencia de abajo NO los obliga.
--
--
-- POR QUE EL CHECK SE PUEDE AFLOJAR AQUI Y NO EN GENERAL
-- -----------------------------------------------------
-- La 122 exige los cinco frenos para encender el envio automatico, y la razon
-- sigue siendo buena: un volcado completo mal exportado VACIA el catalogo de un
-- cliente sin que nadie lo vea. Un delta no puede: solo toca las referencias que
-- trae. El daño maximo esta acotado por el propio fichero, y por eso aqui la
-- exigencia sobra. Marcar el perfil como parcial es AFIRMAR que su fichero es de
-- ese tipo, y esa afirmacion es la que releva de los tres frenos de volumen.

DO $$
BEGIN
  IF to_regclass('public.stock_read_profiles') IS NULL THEN
    RAISE EXCEPTION
      'Falta public.stock_read_profiles: lanza antes 120_stock_profiles.sql.';
  END IF;
END $$;

ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS fichero_parcial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stock_read_profiles.fichero_parcial IS
  'true = el fichero trae SOLO las referencias que han cambiado, no el catalogo '
  'entero. Apaga los tres frenos de volumen (caida_lineas, pct_a_cero, '
  'caida_unidades), que en un delta saltarian casi a diario sin que pase nada. '
  'Ver lib/stock-sync/frenos.ts.';

-- El CHECK de la 122, con la excepcion de los ficheros parciales.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_read_profiles_frenos_ok'
  ) THEN
    ALTER TABLE public.stock_read_profiles
      DROP CONSTRAINT stock_read_profiles_frenos_ok;
  END IF;

  ALTER TABLE public.stock_read_profiles
    ADD CONSTRAINT stock_read_profiles_frenos_ok
    CHECK (
      envio_automatico = false
      -- Un delta no puede vaciar un catalogo: solo toca lo que trae. Los frenos
      -- que le aplican son opcionales, como en cualquier otro ajuste.
      OR fichero_parcial = true
      OR (
        freno_pct_a_cero IS NOT NULL
        AND freno_variacion_precio_pct IS NOT NULL
        AND freno_caida_lineas_pct IS NOT NULL
        AND freno_caida_unidades_pct IS NOT NULL
        AND freno_max_cambios IS NOT NULL
        AND lineas_referencia IS NOT NULL
      )
    );
END $$;

-- Comprobacion: que la excepcion exista de verdad. Sin esto, un CHECK que se
-- quedara como estaba dejaria la pantalla pidiendo los cinco frenos igual y
-- nadie sabria por que.
DO $$
DECLARE definicion TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definicion
    FROM pg_constraint WHERE conname = 'stock_read_profiles_frenos_ok';

  IF definicion IS NULL THEN
    RAISE EXCEPTION 'No se ha creado stock_read_profiles_frenos_ok.';
  END IF;
  IF definicion NOT ILIKE '%fichero_parcial%' THEN
    RAISE EXCEPTION
      'stock_read_profiles_frenos_ok sigue sin la excepcion de fichero_parcial: %', definicion;
  END IF;
END $$;

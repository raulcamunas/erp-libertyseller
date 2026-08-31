-- ==================================================================
-- 166 · LOS PRECIOS AL MISMO RITMO QUE EL STOCK
-- ==================================================================
--
-- Reemplaza el plan de la 164. Se puede lanzar esté aplicada aquella o no: todo
-- va con IF NOT EXISTS y las columnas que la 164 dejaba se ajustan.
--
--
-- QUE LOS PRECIOS VAYAN EN CADA PASADA
-- ------------------------------------
-- La 164 les puso reloj propio, una vez al dia, con este argumento: recalcular
-- son 6.931 escrituras y a 48 pasadas diarias son 332.688, «el patron que lleno
-- la base al 177 %».
--
-- El argumento estaba mal y conviene dejarlo escrito para que nadie lo repita.
-- `entrais_precios` se escribe con UPSERT por SKU: la tabla tiene 6.931 filas y
-- sigue teniendo 6.931 se recalcule una vez al dia o cuarenta y ocho. No crece.
-- Lo que lleno la base en agosto fueron las tablas de medicion
-- —amazon_snapshots_precio, _bsr, _inventario—, que SI son append-only y por eso
-- se purgan ahora a uno y dos dias.
--
-- Lo unico que deja recalcular a menudo son tuplas muertas, que es trabajo para
-- el autovacuum, no cuota. Asi que el reloj separado no compraba nada.
--
--
-- EL RITMO NO SE ESCRIBE DOS VECES
-- --------------------------------
-- `publicar_cada_minutos = 0` no significa «sin parar»: significa AL RITMO DEL
-- SINCRONISMO DE STOCK. Los precios se publican cuando ha entrado una pasada de
-- stock desde la ultima publicacion.
--
-- Se hace asi para que la cadencia viva en un solo sitio. Si manana el stock
-- pasa de 30 a 15 minutos, los precios le siguen sin que nadie se acuerde de
-- venir a cambiar este numero — y una cadencia escrita en dos sitios acaba
-- siempre con los dos numeros distintos y nadie sabiendo cual manda.
--
-- Un valor mayor que cero es un freno fijo en minutos, para el dia que se quiera
-- desacoplar.

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_automatico BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_max_salto_pct NUMERIC;

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicado_at TIMESTAMPTZ;

-- El ritmo, en minutos. 0 = el del sincronismo de stock.
ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_cada_minutos INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.entrais_config
  DROP CONSTRAINT IF EXISTS entrais_config_publicar_cada_minutos_check;
ALTER TABLE public.entrais_config
  ADD CONSTRAINT entrais_config_publicar_cada_minutos_check
  CHECK (publicar_cada_minutos >= 0 AND publicar_cada_minutos <= 10080);

-- El tope por pasada tiene que caber el catalogo entero: son 6.931 referencias y
-- la peticion es que se trabajen TODAS en cada pasada. La 164 lo dejaba en 500,
-- que habria ido soltandolas a plazos sin que se notara.
ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_max_por_pasada INTEGER NOT NULL DEFAULT 20000;

ALTER TABLE public.entrais_config
  DROP CONSTRAINT IF EXISTS entrais_config_publicar_max_por_pasada_check;
ALTER TABLE public.entrais_config
  ADD CONSTRAINT entrais_config_publicar_max_por_pasada_check
  CHECK (publicar_max_por_pasada >= 1 AND publicar_max_por_pasada <= 100000);

UPDATE public.entrais_config
SET publicar_max_por_pasada = 20000
WHERE unica AND publicar_max_por_pasada < 20000;

-- El freno de salto sigue existiendo y sigue naciendo puesto, pero se quita
-- desde la pantalla vaciando el campo. Ver el comentario de la columna.
UPDATE public.entrais_config
SET publicar_max_salto_pct = 0.30
WHERE unica AND publicar_max_salto_pct IS NULL;

ALTER TABLE public.entrais_config
  DROP CONSTRAINT IF EXISTS entrais_config_publicar_max_salto_pct_check;
ALTER TABLE public.entrais_config
  ADD CONSTRAINT entrais_config_publicar_max_salto_pct_check
  CHECK (publicar_max_salto_pct IS NULL OR (publicar_max_salto_pct > 0 AND publicar_max_salto_pct <= 5));

-- La 164 dejaba esta si llego a aplicarse. Ya no la lee nadie: la sustituye
-- publicar_cada_minutos. No se borra porque borrar una columna con datos para
-- ahorrar cuatro bytes es como se pierde algo que hacia falta.
COMMENT ON COLUMN public.entrais_config.publicar_automatico IS
  'true = cada pasada del sincronismo recalcula los 6.931 precios y manda a Amazon los que hayan cambiado. Nace en false: publicar en la tienda de un cliente se enciende a proposito.';
COMMENT ON COLUMN public.entrais_config.publicar_cada_minutos IS
  '0 = al ritmo del sincronismo de stock, que es donde vive la cadencia. Mayor que cero = freno fijo en minutos.';
COMMENT ON COLUMN public.entrais_config.publicar_max_salto_pct IS
  'Un precio que cambie mas de esto no se manda y sale listado aparte. NULL = sin tope. Existe porque en automatico no hay nadie mirando el simulacro.';
COMMENT ON COLUMN public.entrais_config.publicar_max_por_pasada IS
  'Tope de seguridad, no una cuota: 20.000 para que quepan las 6.931 referencias del catalogo y sobre sitio.';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  fila RECORD;
BEGIN
  SELECT publicar_automatico, publicar_cada_minutos, publicar_max_por_pasada
    INTO fila FROM public.entrais_config WHERE unica;

  IF fila IS NULL THEN
    RAISE EXCEPTION 'No hay fila de configuracion de Entrais. Aplica antes la 154.';
  END IF;
  IF fila.publicar_automatico THEN
    RAISE EXCEPTION 'La publicacion automatica ha quedado ENCENDIDA y tiene que nacer apagada.';
  END IF;
  IF fila.publicar_max_por_pasada < 6931 THEN
    RAISE EXCEPTION 'El tope por pasada (%) no deja sitio para el catalogo entero.', fila.publicar_max_por_pasada;
  END IF;

  RAISE NOTICE 'Listo. Los precios se publicaran al ritmo del sincronismo, catalogo entero, y estan APAGADOS hasta que se enciendan en la pantalla de Entrais.';
END $$;

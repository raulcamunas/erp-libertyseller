-- ==================================================================
-- 164 · PUBLICAR LOS PRECIOS DE ENTRAIS SIN QUE NADIE PULSE NADA
-- ==================================================================
--
-- Hasta ahora el motor calculaba y guardaba una propuesta, y publicarla era un
-- boton con simulacro delante. Esto añade la otra opcion: que lo haga solo.
--
--
-- POR QUE NO CADA 30 MINUTOS, COMO EL STOCK
-- -----------------------------------------
-- Porque no es el mismo dato. El stock del proveedor se mueve todo el dia y por
-- eso el ciclo entra cada media hora. El precio de compra cambia cuando el
-- proveedor manda tarifa nueva, o sea una vez al dia como mucho.
--
-- Y publicar cada media hora costaria dos cosas que no valen para nada:
--
--   · RECALCULAR son 6.931 filas escritas en entrais_precios cada vez. A 48
--     pasadas al dia son 332.688 escrituras — el mismo patron que lleno la base
--     hasta el 177 % de la cuota el 27 de agosto.
--   · Y no cambiaria ningun precio, porque entre una pasada y la siguiente el
--     coste del proveedor es el mismo.
--
-- Por eso va con su propio reloj y por defecto UNA VEZ AL DIA.
--
--
-- EL FRENO, Y POR QUE ESTA PUESTO
-- -------------------------------
-- Al montar el boton manual se decidio no poner frenos: el freno era que hay una
-- persona mirando el simulacro antes de pulsar. Automatico no hay nadie, y eso
-- cambia el calculo.
--
-- Lo que se ha visto en los datos reales justifica tenerlo: la tarifa de Amazon
-- se deducia dividiendo la comision entre el precio, y con la comision minima de
-- 0,30 € eso daba un 52,6 % en los articulos baratos. El motor proponia 23,82 €
-- por un cable de 8,81 €. Ese bug esta arreglado, pero es la clase de cosa que
-- vuelve por otro camino, y a las tres de la mañana no hay nadie que lo vea.
--
-- El tope se puede subir o quitar —a null— desde la pantalla. Lo que no se puede
-- es que no exista la opcion.

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_automatico BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_cada_horas INTEGER NOT NULL DEFAULT 24
    CHECK (publicar_cada_horas >= 1 AND publicar_cada_horas <= 720);

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_max_salto_pct NUMERIC
    CHECK (publicar_max_salto_pct IS NULL OR (publicar_max_salto_pct > 0 AND publicar_max_salto_pct <= 5));

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_max_por_pasada INTEGER NOT NULL DEFAULT 500
    CHECK (publicar_max_por_pasada >= 1 AND publicar_max_por_pasada <= 5000);

ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicado_at TIMESTAMPTZ;

-- El tope por defecto: 30 %. Ver la nota de arriba.
UPDATE public.entrais_config
SET publicar_max_salto_pct = 0.30
WHERE publicar_max_salto_pct IS NULL AND unica;

COMMENT ON COLUMN public.entrais_config.publicar_automatico IS
  'true = el ciclo recalcula y publica los precios sin que nadie pulse. Por defecto false: publicar en la tienda de un cliente se enciende a proposito.';
COMMENT ON COLUMN public.entrais_config.publicar_max_salto_pct IS
  'Un precio que cambie mas de esto no se manda y sale listado aparte. NULL = sin tope. Existe porque en automatico no hay nadie mirando el simulacro.';
COMMENT ON COLUMN public.entrais_config.publicar_max_por_pasada IS
  'Cuantos precios se mandan como mucho en una pasada. La primera vez hay miles y a 5 envios por segundo eso son veinte minutos de HTTP abierto.';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  automatico BOOLEAN;
BEGIN
  SELECT publicar_automatico INTO automatico FROM public.entrais_config WHERE unica;
  IF automatico IS NULL THEN
    RAISE EXCEPTION 'No hay fila de configuracion de Entrais. Aplica antes la 154.';
  END IF;
  IF automatico THEN
    RAISE EXCEPTION 'La publicacion automatica ha quedado ENCENDIDA y tiene que nacer apagada.';
  END IF;
  RAISE NOTICE 'Publicacion automatica de precios: disponible y APAGADA. Se enciende en la pantalla de Entrais.';
END $$;

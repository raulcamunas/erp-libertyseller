-- ==================================================================
-- 143 · CADA CUANTO SE PIDE EL FOEP, EN MINUTOS
-- ==================================================================
--
-- Hasta ahora el FOEP se espaciaba por DIAS (`foep_rotacion_dias`) y el guarda
-- del codigo era «¿se le ha pedido ya HOY?». Eso solo permite una vez al dia o
-- menos. Para poder pedirlo cada hora hace falta medirlo en minutos.
--
--
-- Cuanto cabe, que es lo que decide el numero
-- -------------------------------------------
-- getFeaturedOfferExpectedPriceBatch: 40 SKU por llamada, UNA CADA 30 SEGUNDOS.
-- Son 120 llamadas por hora = 4.800 SKU/hora, y el cupo es POR CUENTA DE
-- VENDEDOR: todos los paises de un mismo cliente comparten esa cubeta.
--
--   Cliente con  500 SKU con stock ->  13 llamadas ->  7 min por barrido
--   Cliente con 2.500 SKU con stock ->  63 llamadas -> 31 min por barrido
--   Cliente con 2.500 x 4 paises    -> 250 llamadas -> 2 h 05 min
--
-- O sea: cada hora es perfectamente viable en catalogos cortos, justo en uno de
-- 2.500 en un solo pais, e imposible en multipais grande. Por eso es POR CLIENTE
-- y no un numero global.
--
--
-- Por que 1 dia sigue siendo el valor de partida
-- ----------------------------------------------
-- Porque es el unico que cabe con cualquier catalogo. Bajarlo es una decision
-- que hay que tomar mirando el tamano del cliente, y la pantalla enseña los
-- minutos que cuesta antes de guardarlo.
--
-- El caso que justifica bajarlo es el DEFENSIVO, y no es obvio: el barrido de
-- ofertas de cada 15 minutos avisa cuando PIERDES la Buy Box, pero no cuando
-- podrias estar cobrando mas por ella. Si un competidor se queda sin stock, tu
-- techo sube y sigues vendiendo al precio de antes — eso solo lo dice el FOEP.

DO $$
BEGIN
  IF to_regclass('public.amazon_buybox_config') IS NULL THEN
    RAISE EXCEPTION
      'Falta public.amazon_buybox_config: lanza antes 130_plataforma_a2_buybox.sql.';
  END IF;
END $$;

ALTER TABLE public.amazon_buybox_config
  ADD COLUMN IF NOT EXISTS foep_cada_minutos INTEGER NOT NULL DEFAULT 1440;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amazon_buybox_config_foep_minutos_ok'
  ) THEN
    -- El suelo son 15 minutos: por debajo se estaria pidiendo otra vez algo que
    -- la pasada anterior todavia esta trayendo (un barrido corto ya son 7).
    ALTER TABLE public.amazon_buybox_config
      ADD CONSTRAINT amazon_buybox_config_foep_minutos_ok
      CHECK (foep_cada_minutos BETWEEN 15 AND 43200);
  END IF;
END $$;

COMMENT ON COLUMN public.amazon_buybox_config.foep_cada_minutos IS
  'Cada cuantos minutos se le vuelve a pedir el FOEP a un mismo SKU. 1440 = una '
  'vez al dia. El coste es 40 SKU por llamada y una llamada cada 30 s, con el '
  'cupo compartido entre todos los paises del mismo vendedor.';

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_buybox_config'
      AND column_name = 'foep_cada_minutos'
  ) THEN
    RAISE EXCEPTION 'La columna foep_cada_minutos no se ha creado.';
  END IF;
END $$;

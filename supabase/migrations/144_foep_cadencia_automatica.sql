-- ==================================================================
-- 144 · EL RELOJ DEL FOEP, CALCULADO SOLO
-- ==================================================================
--
-- `foep_cada_minutos` pasa a admitir NULL, y NULL significa AUTOMATICO: el ERP
-- cuenta cuantas referencias con stock tiene ese cliente y saca la cadencia.
--
--
-- Por que automatico y no un numero a mano
-- ----------------------------------------
-- Porque el numero bueno depende de algo que se mueve solo. La cuenta es:
--
--   40 SKU por llamada, una llamada cada 30 s
--   -> minutos de barrido = ceil(referencias / 40) * 30,3 / 60
--   -> cadencia = el doble de eso, redondeado al escalon de arriba
--
-- El DOBLE y no el barrido justo: si la cadencia fuera igual al barrido, la
-- pasada siguiente arrancaria antes de terminar la anterior y el trabajo no
-- alcanzaria nunca — sin dar ningun error, solo acumulando retraso. La otra
-- mitad la necesita la cola de los SKU que acaban de perder la Buy Box, que se
-- saltan la rotacion y piden FOEP inmediatamente.
--
-- Y lo que se mueve es el stock. Un cliente con 2.500 referencias con
-- existencias hoy puede tener 900 el mes que viene: con el numero a mano se
-- queda pidiendo cada dos horas algo que ya cabe en veinte minutos, y nadie lo
-- revisa jamas. Con NULL se ajusta solo.
--
-- Se puede seguir fijando a mano poniendo un numero: NULL no es «sin valor», es
-- «calculalo tu».
--
--
-- Los existentes vuelven a automatico
-- -----------------------------------
-- Los que esten en 1440 son el valor de fabrica de la 143, no una decision de
-- nadie. Se ponen a NULL. Un numero distinto SI es una decision tomada y no se
-- toca.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_buybox_config'
      AND column_name = 'foep_cada_minutos'
  ) THEN
    RAISE EXCEPTION
      'Falta amazon_buybox_config.foep_cada_minutos: lanza antes 143_foep_cada_minutos.sql.';
  END IF;
END $$;

ALTER TABLE public.amazon_buybox_config
  ALTER COLUMN foep_cada_minutos DROP NOT NULL,
  ALTER COLUMN foep_cada_minutos DROP DEFAULT;

UPDATE public.amazon_buybox_config
   SET foep_cada_minutos = NULL
 WHERE foep_cada_minutos = 1440;

COMMENT ON COLUMN public.amazon_buybox_config.foep_cada_minutos IS
  'Cada cuantos minutos se le vuelve a pedir el FOEP a un mismo SKU. NULL = '
  'automatico: se calcula con las referencias CON STOCK del cliente, al doble '
  'de lo que tarda un barrido para que quepa tambien la cola. Un numero fija '
  'el reloj a mano.';

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_buybox_config'
      AND column_name = 'foep_cada_minutos' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'foep_cada_minutos sigue siendo NOT NULL: el automatico no se puede guardar.';
  END IF;
END $$;

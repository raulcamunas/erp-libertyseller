-- 146 · TOPE DE UNIDADES POR PRODUCTO
-- ===================================
--
-- «Manda como maximo 15 unidades de cada producto, aunque en mi almacen haya
-- 115». Lo pidio un cliente por escrito. Es una politica suya, no un calculo: no
-- quiere exponer todo su stock en Amazon.
--
--
-- ES UN TECHO, NO UNA CANTIDAD FIJA
-- ---------------------------------
-- Un articulo con 8 unidades publica 8, no 15. Solo actua cuando hay de sobra.
--
--
-- Y NO ES LA RESERVA, QUE YA EXISTE. Son dos cosas distintas:
--
--   reserva_unidades -> APARTA unidades. Con reserva 2 y 8 en el fichero se
--                       publican 6. Baja el numero SIEMPRE.
--   max_unidades     -> TOPE. Con tope 15 y 8 en el fichero se publican 8.
--                       Solo baja el numero cuando se pasa.
--
-- El orden en que se aplican importa y esta escrito en lib/stock-sync/reglas.ts:
-- reserva, umbral y tope, en ese orden. Con reserva 2, tope 15 y 115 unidades,
-- el tope al final da 15 y el tope al principio daria 13 —cobraria la reserva
-- dos veces— sin que nada lo delate: los dos numeros son plausibles.
--
--
-- NULL = SIN TOPE, Y NO 0
-- -----------------------
-- Un 0 significaria «publica cero unidades de todo», o sea retirar el catalogo
-- entero de la venta. Que la ausencia de una regla y la regla mas destructiva
-- posible se escriban igual es como se tira la facturacion de un cliente con un
-- campo mal rellenado. Por eso la columna admite NULL y el CHECK exige que, si
-- hay numero, sea 1 o mas.

DO $$
BEGIN
  IF to_regclass('public.stock_read_profiles') IS NULL THEN
    RAISE EXCEPTION
      'Falta public.stock_read_profiles: lanza antes 120_stock_profiles.sql. '
      'OJO: el fichero se llama stock_profiles y la tabla stock_read_profiles.';
  END IF;
END $$;

ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS max_unidades INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.stock_read_profiles'::regclass
       AND conname  = 'stock_read_profiles_max_unidades_ok'
  ) THEN
    ALTER TABLE public.stock_read_profiles
      ADD CONSTRAINT stock_read_profiles_max_unidades_ok
      CHECK (max_unidades IS NULL OR max_unidades >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.stock_read_profiles.max_unidades IS
  'Tope de unidades por producto que se publican en Amazon. NULL = sin tope. '
  'Es un techo: con 8 unidades se publican 8. Se aplica DESPUES de la reserva y '
  'del umbral (ver lib/stock-sync/reglas.ts).';

-- Comprobacion final: que la columna este y admita NULL.
DO $$
DECLARE nulos TEXT;
BEGIN
  SELECT is_nullable INTO nulos
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'stock_read_profiles'
     AND column_name  = 'max_unidades';

  IF nulos IS NULL THEN
    RAISE EXCEPTION 'No se ha creado stock_read_profiles.max_unidades.';
  END IF;
  IF nulos <> 'YES' THEN
    RAISE EXCEPTION
      'stock_read_profiles.max_unidades no admite NULL, y NULL es «sin tope». '
      'Con NOT NULL, todos los perfiles existentes tendrian un tope que nadie ha puesto.';
  END IF;
END $$;

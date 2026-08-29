-- ==================================================================
-- 165 · QUE CADA PASADA CUENTE POR DÓNDE HA IDO
-- ==================================================================
--
-- La fila de una ejecucion ya guarda el resultado: lineas leidas, SKU casados,
-- cambios enviados, cuanto tardo EN TOTAL. Lo que no guarda es el CAMINO: en
-- cual de los cinco pasos se fue ese tiempo, y cual de ellos fallo.
--
-- Con 2,6 s de media da igual. Con los 30,3 s del error de anoche no: sin esto,
-- «Entrais ha contestado 500» y «Amazon ha tardado media hora en contestar» se
-- ven igual de opacos desde la pantalla, y son dos problemas de dos personas
-- distintas.
--
--
-- POR QUE UNA COLUMNA Y NO UNA TABLA DE FASES
-- -------------------------------------------
-- Porque serian cinco filas por pasada, por cliente. A 48 pasadas al dia y
-- cuatro clientes son 960 filas diarias de puro andamiaje, en la misma base que
-- llego al 177 % de la cuota el 27 de agosto. El JSONB viaja DENTRO del INSERT
-- que ya se hacia: cero escrituras nuevas.
--
-- Y no se consulta por fases sueltas: se leen todas juntas, de una pasada
-- concreta, para pintarla. Es exactamente para lo que sirve un JSONB y no una
-- tabla.
--
--
-- LA PANTALLA NO DEPENDE DE ESTO PARA FUNCIONAR
-- ---------------------------------------------
-- Las pasadas de antes de esta migracion tienen `fases` a NULL, y son casi todo
-- el historial. La linea de vida las reconstruye con las columnas que si
-- existen —lineas_leidas, sku_casados, enviados_ok— y solo pierde los tiempos
-- por paso. Asi el historial entero se ve desde el primer momento en vez de
-- quedarse en blanco hasta que pase media hora.

ALTER TABLE public.stock_profile_runs
  ADD COLUMN IF NOT EXISTS fases JSONB;

COMMENT ON COLUMN public.stock_profile_runs.fases IS
  'Los pasos de la pasada en orden, cada uno con su duracion en ms, su estado y su cifra: [{paso, estado, ms, cifra, nota}]. Va en la misma insercion que el resto de la fila, asi que no cuesta ni una escritura mas. NULL en las pasadas anteriores a la migracion 165: la pantalla las reconstruye con las columnas de siempre.';

-- ---------- Comprobacion ----------
DO $$
DECLARE
  hay BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stock_profile_runs'
      AND column_name = 'fases'
  ) INTO hay;

  IF NOT hay THEN
    RAISE EXCEPTION 'La columna fases no se ha creado.';
  END IF;

  RAISE NOTICE 'Listo. Las pasadas nuevas guardaran el tiempo de cada paso; las viejas se reconstruyen en pantalla.';
END $$;

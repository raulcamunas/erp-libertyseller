-- ==================================================================
-- 138 · CADA CUÁNTO CORRE CADA PROCESO AUTOMÁTICO
-- ==================================================================
--
-- Por qué hace falta
-- ------------------
-- Los intervalos estaban escritos en el crontab del Dockerfile: 3 minutos la
-- agenda, 5 el motor de trabajos, 15 el refresco del catálogo. Para cambiar un
-- número había que editar el Dockerfile, hacer commit y esperar un despliegue
-- entero, y desde el ERP no se veía NI SIQUIERA cuáles eran.
--
-- Con esta tabla el intervalo es un dato. El crontab pasa a llamar a las tres
-- rutas CADA MINUTO y es cada ruta la que mira aquí si le toca; si no le toca,
-- contesta y no hace nada. Sale más barato de lo que parece —una consulta por
-- minuto y proceso— y a cambio el horario se cambia desde una pantalla.
--
--
-- Por qué la decisión la toma la ruta y no un script repartidor
-- ------------------------------------------------------------
-- Un repartidor único tendría que lanzar las tres cosas, y la del catálogo puede
-- tardar trece minutos. O las encadena —y entonces la agenda, que va cada tres,
-- se queda esperando— o las lanza en segundo plano y hay que gestionar procesos
-- sueltos dentro del contenedor. Con una línea de cron por proceso, cada uno
-- sigue con su propio tiempo máximo y su propio registro, exactamente como
-- estaba, y lo único que cambia es quién decide si toca.
--
--
-- Qué NO se guarda aquí
-- ---------------------
-- La cadencia de los REFRESCOS (censo semanal, BSR diario…) no: esa es una
-- propiedad del trabajo y vive en el planificador, medida en horas y por tipo de
-- refresco. Esto es solo cada cuánto se despierta el motor. Son dos relojes
-- distintos y mezclarlos en una tabla haría que cambiar uno pareciera cambiar el
-- otro.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_erp_admin'
  ) THEN
    RAISE EXCEPTION
      'Falta public.is_erp_admin(uuid), que la crea 111_employees.sql. Sin ella la politica de abajo dejaria esta tabla abierta.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cron_config (
  /** El id del proceso, el mismo que TAREAS_CRON en lib/sistema/cron.ts */
  tarea TEXT PRIMARY KEY,

  /**
   * Cada cuántos minutos.
   *
   * El tope de abajo son 30 dias. El suelo es 1 y no 0 por un motivo concreto:
   * con 0, la comprobacion «¿ha pasado el intervalo?» seria siempre cierta y el
   * proceso se relanzaria en cuanto terminara, en bucle, gastando el cupo de
   * Amazon de todos los clientes. Para no ejecutarlo estan `activo` y el
   * interruptor de la pantalla, que ademas dice lo que quiere decir.
   */
  cada_minutos INTEGER NOT NULL CHECK (cada_minutos BETWEEN 1 AND 43200),

  /**
   * Apagado = la ruta contesta y no hace nada.
   *
   * NO apaga el cron del contenedor: la linea del crontab sigue llamando cada
   * minuto y recibe un «no toca». Es a proposito — asi un proceso apagado sigue
   * demostrando que el camino funciona, y volver a encenderlo es un clic y no un
   * despliegue.
   */
  activo BOOLEAN NOT NULL DEFAULT true,

  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.cron_config IS
  'Cada cuanto se despierta cada proceso automatico. Lo lee la propia ruta en '
  'cada llamada del cron, que ahora entra cada minuto y decide si le toca.';

-- ---------- Los valores de hoy, para que pegar esto no cambie nada ----------
-- Son exactamente los que habia en el crontab del Dockerfile. ON CONFLICT DO
-- NOTHING para que relanzar el fichero no pise una eleccion ya hecha desde la
-- pantalla, que es justo lo que este fichero existe para permitir.
INSERT INTO public.cron_config (tarea, cada_minutos) VALUES
  ('amazon-sync', 15),
  ('amazon-jobs', 5),
  ('calendario', 3)
ON CONFLICT (tarea) DO NOTHING;

-- ---------- Permisos ----------
ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cron_config' AND policyname = 'cron_config_admin'
  ) THEN
    -- is_erp_admin SIEMPRE con auth.uid(): la funcion no tiene valor por
    -- defecto y llamarla sin argumentos no compila, lo que en el editor de
    -- Supabase —que corre el fichero en UNA transaccion— se llevaria por
    -- delante la tabla de arriba sin dejar rastro.
    CREATE POLICY cron_config_admin ON public.cron_config
      FOR ALL USING (public.is_erp_admin(auth.uid()))
      WITH CHECK (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

-- ---------- Comprobación ----------
DO $$
DECLARE filas INTEGER;
BEGIN
  IF to_regclass('public.cron_config') IS NULL THEN
    RAISE EXCEPTION 'La tabla cron_config no se ha creado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cron_config' AND policyname = 'cron_config_admin'
  ) THEN
    RAISE EXCEPTION 'La politica cron_config_admin no se ha creado.';
  END IF;
  SELECT count(*) INTO filas FROM public.cron_config;
  IF filas < 3 THEN
    RAISE EXCEPTION 'Faltan procesos en cron_config: hay % y tienen que estar los 3.', filas;
  END IF;
END $$;

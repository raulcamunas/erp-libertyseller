-- ==================================================================
-- 137 · EL REGISTRO DE LOS PROCESOS AUTOMÁTICOS
-- ==================================================================
--
-- Por qué hace falta
-- ------------------
-- Hoy no se guarda en NINGÚN sitio cuándo corrió cada cron ni qué contestó. Va
-- todo a la salida del contenedor, que se pierde al reiniciar y que nadie mira.
--
-- Y eso costó caro: los tres crones llevaban desde el primer día pidiendo a
-- `localhost:3000` cuando el servidor escucha en el 80. Contestaban HTTP 000 en
-- cada pasada. El catálogo se quedó «refrescado hace 17 horas», los trabajos de
-- plataforma acumularon 0 pasadas y la agenda solo se sincronizaba cuando
-- alguien pulsaba el botón a mano.
--
-- Nada de eso dio un error. Se descubrió mirando los registros del contenedor
-- por casualidad. Con esta tabla, «no ha corrido desde el martes» es una fila
-- que falta, y eso se ve en una pantalla.
--
--
-- Qué se guarda y qué no
-- ----------------------
-- Una fila por PASADA, no por cosa hecha. Lo que hizo la pasada por dentro ya lo
-- cuentan amazon_jobs y stock_profile_runs; aquí solo interesa «arrancó, tardó
-- esto y acabó así», que es lo que contesta «¿está vivo el automatismo?».
--
-- La escribe LA RUTA, no el script de shell. Si la ruta no llega a ejecutarse
-- —que es exactamente lo que pasaba— no hay fila, y la AUSENCIA es la señal: la
-- pantalla enseña cuánto hace de la última y con eso basta para verlo.

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

CREATE TABLE IF NOT EXISTS public.cron_ejecuciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  /**
   * Cuál de los automatismos. Texto y no un CHECK cerrado a propósito: añadir un
   * proceso nuevo no debería obligar a lanzar una migración, y un valor
   * desconocido aquí no rompe nada — sale en la pantalla con su nombre en crudo,
   * que ya dice lo que hay.
   */
  tarea TEXT NOT NULL,

  iniciado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminado_at TIMESTAMPTZ,

  /**
   * NULL mientras corre. Es lo que permite distinguir «está trabajando ahora
   * mismo» de «reventó a medias y no llegó a escribir el final»: si lleva NULL y
   * `iniciado_at` es de hace media hora, se murió por el camino.
   */
  ok BOOLEAN,

  /** Lo que hizo, en una línea. Se enseña tal cual */
  resumen TEXT,
  /** Solo si fue mal. El texto entero, sin recortar */
  error TEXT,

  duracion_ms INTEGER,

  /**
   * Quién la lanzó. NULL = el cron.
   *
   * Existe por el botón de «lanzar ahora» de la pantalla: una pasada disparada a
   * mano para depurar no debe contarse como prueba de que el automatismo
   * funciona, que es justo el error que nos tuvo semanas creyendo que la agenda
   * se sincronizaba sola.
   */
  lanzado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT cron_ejecuciones_tarea_ok CHECK (length(trim(tarea)) > 0)
);

-- La consulta de la pantalla es siempre «la última de cada tarea» y «las N
-- últimas de esta tarea». Las dos van por aquí.
CREATE INDEX IF NOT EXISTS cron_ejecuciones_tarea_idx
  ON public.cron_ejecuciones (tarea, iniciado_at DESC);

-- Para la limpieza de abajo.
CREATE INDEX IF NOT EXISTS cron_ejecuciones_antiguedad_idx
  ON public.cron_ejecuciones (iniciado_at);

COMMENT ON TABLE public.cron_ejecuciones IS
  'Una fila por pasada de cada proceso automatico. La escribe la ruta, no el '
  'script: si la ruta no llega a ejecutarse no hay fila, y esa ausencia es la '
  'senal de que el automatismo esta muerto.';

-- ---------- Permisos ----------
ALTER TABLE public.cron_ejecuciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cron_ejecuciones' AND policyname = 'cron_ejecuciones_admin'
  ) THEN
    -- is_erp_admin SIEMPRE con auth.uid(): la funcion no tiene valor por
    -- defecto y llamarla sin argumentos no compila, lo que en el editor de
    -- Supabase —que corre el fichero en UNA transaccion— se llevaria por delante
    -- la tabla de arriba sin dejar rastro.
    CREATE POLICY cron_ejecuciones_admin ON public.cron_ejecuciones
      FOR ALL USING (public.is_erp_admin(auth.uid()))
      WITH CHECK (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

-- ---------- Que no crezca para siempre ----------
-- El de calendario corre cada 3 minutos: son 480 filas al dia, 175.000 al ano.
-- No es grave, pero tampoco sirve de nada guardar la pasada de hace ocho meses.
-- La limpieza la dispara la propia ruta de vez en cuando; esta funcion es lo que
-- llama.
CREATE OR REPLACE FUNCTION public.limpiar_cron_ejecuciones(p_dias INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE borradas INTEGER;
BEGIN
  DELETE FROM public.cron_ejecuciones
  WHERE iniciado_at < NOW() - (p_dias || ' days')::INTERVAL;
  GET DIAGNOSTICS borradas = ROW_COUNT;
  RETURN borradas;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Sin esto `anon` la hereda: Postgres concede EXECUTE a PUBLIC por defecto, y un
-- GRANT a `authenticated` sin REVOKE previo es decorativo. Es el mismo fallo que
-- tenian las funciones del tracker y que cerro la 133.
REVOKE ALL ON FUNCTION public.limpiar_cron_ejecuciones(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limpiar_cron_ejecuciones(INTEGER) TO service_role;

-- ---------- Comprobación ----------
DO $$
BEGIN
  IF to_regclass('public.cron_ejecuciones') IS NULL THEN
    RAISE EXCEPTION 'La tabla cron_ejecuciones no se ha creado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cron_ejecuciones' AND policyname = 'cron_ejecuciones_admin'
  ) THEN
    RAISE EXCEPTION 'La politica cron_ejecuciones_admin no se ha creado.';
  END IF;
END $$;

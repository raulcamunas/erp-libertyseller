-- ==================================================================
-- 139 · CADA CUÁNTO SE REFRESCA CADA COSA
-- ==================================================================
--
-- Qué reloj es este, porque hay dos y se confunden
-- ------------------------------------------------
--   · cron_config (migración 138) = cada cuánto se DESPIERTA el motor. Son
--     minutos: 5, 15. El motor mira la cola y avanza un tramo.
--   · esto                        = cada cuánto le TOCA a cada refresco. Son
--     horas o días: el BSR cada 20 h, el censo cada 4 h.
--
-- Que el motor entre cada 5 minutos NO significa que se relea el catálogo cada
-- 5 minutos: significa que cada 5 minutos se comprueba si a alguien le toca. La
-- pantalla decía «diario» y «semanal» sin más, y esas dos palabras es justo lo
-- que hacía imposible saber cuál de los dos relojes se estaba mirando.
--
--
-- Por qué la ventana nocturna es una columna y no una constante
-- ------------------------------------------------------------
-- Porque si no, «cada 4 horas» sería mentira. Los refrescos solo podían ARRANCAR
-- entre las 23:00 y las 06:00, así que un trabajo con cadencia de 4 h se
-- ejecutaría dos veces por noche y ni una en todo el día: el número guardado
-- diría una cosa y el comportamiento sería otro, sin ningún error por medio.
--
-- La ventana existe como columna, pero YA NO SE USA POR DEFECTO: la quita la
-- 140. El cupo de la SP-API es por operación, así que un barrido de atributos no
-- le quita fichas al refresco del catálogo, y la competencia que la ventana
-- evitaba era mucho menor de lo que parecía. Se puede volver a encender por
-- refresco desde Ingesta.

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

CREATE TABLE IF NOT EXISTS public.refresco_config (
  /** El tipo de trabajo, el mismo que el CHECK de amazon_jobs */
  tipo TEXT PRIMARY KEY,

  /**
   * Cada cuantos minutos le toca.
   *
   * El suelo son 15 minutos y no 1: el censo pide un informe asincrono que
   * Amazon tarda entre uno y veinte minutos en generar, y ademas lo CACHEA entre
   * una y seis horas. Por debajo de un cuarto de hora se estaria pidiendo otra
   * vez algo que todavia se esta generando, para recibir la misma foto.
   *
   * El techo son 180 dias.
   */
  cada_minutos INTEGER NOT NULL CHECK (cada_minutos BETWEEN 15 AND 259200),

  /**
   * Solo puede ARRANCAR entre las 23:00 y las 06:00 (hora de Madrid).
   *
   * Arrancar, no terminar: un trabajo que empieza a las 05:50 y tarda dos horas
   * NO se corta a las 06:00. Cortarlo dejaria el catalogo a medias, que es peor
   * que acabar tarde.
   *
   * Con una cadencia por debajo de las 24 h esto hay que apagarlo o el numero de
   * arriba no se cumple. La pantalla lo avisa; aqui no se puede poner un CHECK
   * porque «cada 12 h de noche» es perfectamente valido (una vez por noche).
   */
  solo_de_noche BOOLEAN NOT NULL DEFAULT true,

  /** Apagado = el planificador no lo encola. Se puede seguir lanzando a mano */
  activo BOOLEAN NOT NULL DEFAULT true,

  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.refresco_config IS
  'Cada cuanto le toca a cada refresco, en minutos. Distinto de cron_config, '
  'que es cada cuanto se despierta el motor.';

-- ---------- Los valores ----------
-- Todos son los que ya estaban en el codigo (20 h lo diario, 144 h lo semanal)
-- MENOS el censo, que baja de 144 h a 1 h.
--
-- POR QUE EL CENSO CADA HORA. No es solo por descubrir referencias nuevas: el
-- ciclo de quince minutos NO VE EL CATALOGO ENTERO de los clientes grandes. Usa
-- searchListingsItems, que no puede paginar mas alla de 1.000 SKU, y no da error
-- al quedarse corto. Con las 2.620 referencias de Shoplamp, cada cuarto de hora
-- se refrescan las primeras 1.000 por orden de SKU y las otras 1.620 no las toca
-- nadie. El censo va por informe y si enumera el catalogo completo: es lo UNICO
-- que refresca esas 1.620.
--
-- El cupo aguanta: createReport se repone una vez por minuto (1.440 al dia) y
-- aqui son unos catorce informes por pasada, unos 336 al dia.
--
-- OJO con bajarlo mas: Amazon cachea este informe entre 1 y 6 horas, asi que por
-- debajo de la hora se estaria pidiendo otra vez algo que ni ha cambiado.
--
-- El inventario se queda en diario A PROPOSITO: esa tarea no es el stock actual
-- —ese ya lo refresca el ciclo de quince minutos— sino una serie de solo
-- insercion, o sea historico. Cada quince minutos serian 96 observaciones al dia
-- por SKU y pais para dibujar la misma linea.
-- Ninguno con ventana nocturna: ver 140_refrescos_sin_ventana.sql. El cupo de
-- la SP-API es por operacion, asi que un barrido de atributos no le quita
-- fichas al refresco del catalogo — la competencia que la ventana evitaba era
-- mucho menor de lo que parecia, y a cambio nada podia ponerse al dia de dia.
INSERT INTO public.refresco_config (tipo, cada_minutos, solo_de_noche) VALUES
  ('recalcular_activos',   1200, false),  -- 20 h
  ('inventario_fba',       1200, false),  -- 20 h · historico, no el stock vivo
  ('snapshot_bsr',         1200, false),  -- 20 h · un punto al dia de la serie
  ('snapshot_precios',     1200, false),  -- 20 h
  ('censo_catalogo',         60, false),  -- 1 h
  ('enriquecer_catalogo',  8640, false)   -- 144 h = 6 dias
ON CONFLICT (tipo) DO NOTHING;

-- ---------- Permisos ----------
ALTER TABLE public.refresco_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'refresco_config' AND policyname = 'refresco_config_admin'
  ) THEN
    -- is_erp_admin SIEMPRE con auth.uid(): no tiene valor por defecto y llamarla
    -- sin argumentos no compila, lo que en el editor de Supabase —que corre el
    -- fichero en UNA transaccion— se llevaria por delante la tabla de arriba.
    CREATE POLICY refresco_config_admin ON public.refresco_config
      FOR ALL USING (public.is_erp_admin(auth.uid()))
      WITH CHECK (public.is_erp_admin(auth.uid()));
  END IF;
END $$;

-- ---------- Comprobación ----------
DO $$
DECLARE filas INTEGER;
BEGIN
  IF to_regclass('public.refresco_config') IS NULL THEN
    RAISE EXCEPTION 'La tabla refresco_config no se ha creado.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'refresco_config' AND policyname = 'refresco_config_admin'
  ) THEN
    RAISE EXCEPTION 'La politica refresco_config_admin no se ha creado.';
  END IF;
  SELECT count(*) INTO filas FROM public.refresco_config;
  IF filas < 6 THEN
    RAISE EXCEPTION 'Faltan refrescos en refresco_config: hay % y tienen que estar los 6.', filas;
  END IF;
END $$;

-- =====================================================
-- EL CICLO AUTOMÁTICO DE CADA QUINCE MINUTOS
-- =====================================================
-- La 120 dejó construido el perfil de lectura y la fila de la ejecución, pero
-- todo se disparaba a mano desde la pantalla. Esta migración añade las tres
-- cosas que hacen falta para que el ciclo corra SOLO, sin nadie delante:
--
--   1. UN CERROJO POR PERFIL, para que dos ejecuciones no se pisen.
--      El cron dispara cada 15 minutos y un cliente de 40.000 referencias puede
--      tardar más que eso. Sin cerrojo, la segunda lectura empieza con la
--      primera a medio enviar: se leen dos veces las mismas líneas, se mandan
--      dos veces los mismos cambios y el registro queda contando el doble. Peor
--      todavía con dos contenedores detrás de un balanceador, donde ni siquiera
--      comparten memoria.
--
--   2. DEJAR CONSTANCIA DE LO QUE NO LLEGÓ A PROCESARSE. Cuando el fichero es
--      idéntico al de la vez anterior NO se escribe fila de ejecución —si no, el
--      historial serían 96 filas idénticas al día y la única señal útil («hoy el
--      fichero ha cambiado») se perdería entre el ruido—, pero sí hay que poder
--      contestar «se miró hace cuatro minutos y el fichero era el mismo». Para
--      eso están last_skipped_at y last_skip_reason.
--
--   3. CÓMO FUE EL ENVÍO, en la propia fila de la ejecución. Saber que se mandó
--      no basta: hace falta saber cuántos entraron y cuántos rebotó Amazon, que
--      es lo que se mira cuando un cliente pregunta por qué su stock sigue mal
--      después de un envío que consta como hecho.
--
-- Y AFINA EL AVISO DE LA CAMPANA para que sirva de verdad: avisa también de los
-- fallos, y solo cuando la situación CAMBIA. Ver el bloque del final.
--
-- IDEMPOTENTE: se puede lanzar las veces que haga falta.

-- ---------- Guardia previa ----------
-- El editor SQL de Supabase corre el script entero en UNA transacción: reventar
-- aquí deja la base intacta en vez de a medias.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stock_read_profiles'
  ) THEN
    RAISE EXCEPTION
      'No existe public.stock_read_profiles. Lanza antes 120_stock_profiles.sql: esto solo le añade el cerrojo y el rastro del envío.';
  END IF;
END $$;

-- =====================================================
-- 1) EL CERROJO
-- =====================================================
-- POR QUÉ EN LA TABLA Y NO EN LA MEMORIA DEL PROCESO.
--
-- Una bandera en Node solo protege de sí misma. El ERP corre en un contenedor
-- hoy y puede correr en dos mañana, y el cron entra por HTTP: nada garantiza
-- que las dos peticiones caigan en el mismo proceso. El cerrojo tiene que estar
-- donde los dos miran, y eso es la base de datos.
--
-- CÓMO SE TOMA, que es lo único que lo hace correcto:
--
--   UPDATE stock_read_profiles
--      SET running_since = NOW(), running_token = <token nuevo>
--    WHERE id = <perfil>
--      AND (running_since IS NULL OR running_since < <caducado>)
--   RETURNING id;
--
-- Un UPDATE es atómico y en READ COMMITTED el segundo que llega se queda
-- esperando el bloqueo de fila y RE-EVALÚA el WHERE contra la versión ya
-- escrita: encuentra running_since puesto y actualiza CERO filas. Devuelva o no
-- devuelva fila es la respuesta a «¿me lo he quedado yo?», sin carreras y sin
-- bloqueos consultivos que no sobreviven al pool de conexiones de Supabase.
ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS running_since TIMESTAMPTZ;

-- El testigo de quién lo tiene. Sirve para que SOLO SU DUEÑO lo suelte: si una
-- ejecución se quedó colgada, otra le roba el cerrojo caducado, y sin el
-- testigo la colgada —que sigue viva en algún sitio— soltaría al terminar un
-- cerrojo que ya no es suyo y dejaría a dos procesando el mismo perfil.
ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS running_token UUID;

COMMENT ON COLUMN public.stock_read_profiles.running_since IS
  'Cerrojo: cuándo empezó la ejecución que lo tiene tomado. NULL = libre. Se toma con un UPDATE condicional, que es atómico. Un cerrojo más viejo que el plazo de caducidad se puede robar: si no, un contenedor que se reinicia a mitad de proceso congelaría ese perfil para siempre.';

-- =====================================================
-- 2) LO QUE SE MIRÓ Y NO HUBO QUE HACER
-- =====================================================
-- El caso normal del ciclo: se mira el origen, el fichero es el mismo de hace
-- quince minutos y no hay nada que hacer. Eso NO escribe fila de ejecución a
-- propósito, pero tiene que verse en algún sitio; si no, un perfil sano y un
-- perfil que el cron ni siquiera está mirando se ven exactamente igual.
ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS last_skipped_at TIMESTAMPTZ;

ALTER TABLE public.stock_read_profiles
  ADD COLUMN IF NOT EXISTS last_skip_reason TEXT;

COMMENT ON COLUMN public.stock_read_profiles.last_skip_reason IS
  'Por qué la última pasada del ciclo no hizo nada, en español: «el fichero no ha cambiado desde la última vez». Sin esto, un perfil al día y un perfil olvidado por el cron son indistinguibles en la pantalla.';

COMMENT ON COLUMN public.stock_read_profiles.last_file_fingerprint IS
  'Huella DEL CONTENIDO del último fichero que el ciclo automático procesó (SHA-256 de los bytes que se leyeron de verdad). La escribe solo el ciclo: un simulacro lanzado a mano no la toca, porque si no, probar un fichero desde la pantalla haría que el ciclo se lo saltara y ese fichero no llegaría nunca a Amazon.';

-- =====================================================
-- 3) CÓMO FUE EL ENVÍO
-- =====================================================
-- Sin DEFAULT: NULL es «no se envió nada» y 0 es «se intentó y no entró ni
-- uno», que son dos cosas muy distintas y las dos pasan.
ALTER TABLE public.stock_profile_runs
  ADD COLUMN IF NOT EXISTS enviados_ok INTEGER;

ALTER TABLE public.stock_profile_runs
  ADD COLUMN IF NOT EXISTS enviados_error INTEGER;

-- Amazon puede cortar un lote entero a la mitad: si contesta que la
-- autorización ya no vale, seguir mandando los 400 restantes solo consigue 400
-- errores idénticos. sendChanges() lo corta y explica por qué; aquí se guarda
-- esa frase, porque «se mandaron 12 de 400» sin motivo no se puede interpretar.
ALTER TABLE public.stock_profile_runs
  ADD COLUMN IF NOT EXISTS envio_abortado TEXT;

COMMENT ON COLUMN public.stock_profile_runs.enviados_ok IS
  'Cambios que Amazon aceptó. NULL = no se llegó a enviar (simulacro, frenado o sin cambios); 0 = se intentó y no entró ninguno.';

-- =====================================================
-- 4) EL ORDEN EN QUE EL CICLO ELIGE PERFILES
-- =====================================================
-- El ciclo coge los perfiles de stock con origen automático y los recorre por
-- last_run_at ascendente (los NULL primero): así el que lleva más tiempo sin
-- mirarse va delante y ninguno se queda atrás cuando la tanda no cabe entera en
-- el presupuesto de tiempo de una pasada.
--
-- El índice de la 120 ya cubre (last_run_at) WHERE is_active AND origen <>
-- 'manual'; este añade el tipo, que es el otro filtro de la consulta. Con
-- veinte perfiles da igual, pero cuesta nada y documenta la consulta.
CREATE INDEX IF NOT EXISTS idx_stock_read_profiles_ciclo
  ON public.stock_read_profiles(last_run_at NULLS FIRST)
  WHERE is_active AND tipo = 'stock' AND origen <> 'manual';

-- =====================================================
-- 5) EL AVISO DE LA CAMPANA, AFINADO
-- =====================================================
-- La 120 avisaba de los frenos. Faltaban dos cosas para que el aviso sirva de
-- verdad cuando no hay nadie mirando la pantalla:
--
-- A) AVISAR TAMBIÉN DE LOS FALLOS. Un perfil que revienta cada quince minutos
--    —la carpeta de Drive que el cliente movió de sitio, la columna que
--    renombró— deja el stock congelado exactamente igual que un freno, y hasta
--    ahora solo se veía entrando a mirar.
--
-- B) AVISAR CUANDO LA SITUACIÓN CAMBIA, NO EN CADA PASADA. Sin esta regla, un
--    cliente cuyo sistema reescribe el fichero cada cuarto de hora con datos
--    malos genera 96 avisos idénticos al día, y 96 avisos idénticos son cero
--    avisos: la campana se convierte en ruido y se deja de mirar.
--
--    La regla es: se avisa si el estado de esta ejecución NO ES EL MISMO que el
--    de la ejecución anterior de ese perfil (o si es el mismo estado pero con
--    OTRO freno). Mientras la situación se mantenga igual, silencio; en cuanto
--    cambie algo —se arregla, se rompe de otra manera, salta otro freno— vuelve
--    a sonar. Y lo que se mantiene igual sigue estando en el historial y en la
--    ficha del perfil, que es donde se mira lo que dura.
--
-- El grueso del ruido lo quita antes el propio ciclo: si el fichero no ha
-- cambiado no se procesa, así que ni siquiera hay ejecución de la que avisar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN
    -- Primero el CHECK: sin ampliarlo, el INSERT del aviso falla y, al ser un
    -- trigger AFTER INSERT, se lleva por delante la escritura de la ejecución.
    -- Se perdería justo la fila que explica el fallo.
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
      CHECK (type IN (
        'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
        'freno_stock', 'fallo_stock'
      ));
  ELSE
    RAISE NOTICE 'No existe public.notifications; el ciclo dejará constancia en stock_profile_runs pero no avisará por la campana.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_stock_freno_notification()
RETURNS TRIGGER AS $$
DECLARE
  admin_user RECORD;
  nombre_cliente TEXT;
  anterior RECORD;
  tipo_aviso TEXT;
  titulo TEXT;
  cuerpo TEXT;
BEGIN
  IF NEW.estado NOT IN ('frenado', 'error') THEN
    RETURN NEW;
  END IF;

  -- La ejecución ANTERIOR de este mismo perfil. Es todo lo que hace falta para
  -- distinguir «acaba de pasar algo» de «sigue pasando lo mismo».
  SELECT r.estado, r.freno INTO anterior
  FROM public.stock_profile_runs r
  WHERE r.profile_id = NEW.profile_id
    AND r.id <> NEW.id
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1;

  IF anterior.estado IS NOT NULL
     AND anterior.estado = NEW.estado
     AND anterior.freno IS NOT DISTINCT FROM NEW.freno
  THEN
    RETURN NEW;
  END IF;

  SELECT name INTO nombre_cliente FROM public.stock_clients WHERE id = NEW.client_id;

  IF NEW.estado = 'frenado' THEN
    tipo_aviso := 'freno_stock';
    titulo := 'Envío detenido: ' || COALESCE(nombre_cliente, 'cliente sin nombre');
    cuerpo := COALESCE(NEW.freno_detalle, 'Ha saltado un freno y no se ha mandado nada a Amazon.');
  ELSE
    tipo_aviso := 'fallo_stock';
    titulo := 'No se ha podido procesar: ' || COALESCE(nombre_cliente, 'cliente sin nombre');
    -- Recortado: el cuerpo de la campana son dos líneas, y un error de Drive con
    -- su traza entera dentro no lo lee nadie. El texto completo está en la fila.
    cuerpo := LEFT(COALESCE(NEW.error_message, 'La lectura del fichero ha fallado.'), 300);
  END IF;

  FOR admin_user IN SELECT id FROM public.profiles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, type, title, message, read, created_at)
    VALUES (admin_user.id, tipo_aviso, titulo, cuerpo, false, NOW());
  END LOOP;

  RETURN NEW;
EXCEPTION
  -- Que no se pueda avisar NO puede costar la fila de la ejecución: sin ella se
  -- pierde el único sitio donde consta que el sistema paró y por qué.
  WHEN OTHERS THEN
    RAISE NOTICE 'No se ha podido crear el aviso de la ejecución (%). La ejecución sí queda registrada.', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- El trigger de la 120 ya apunta a esta función y CREATE OR REPLACE le cambia
-- el cuerpo debajo, pero se vuelve a crear por si esta migración se lanza sobre
-- una base donde alguien lo hubiera quitado a mano.
DROP TRIGGER IF EXISTS trg_stock_profile_runs_freno ON public.stock_profile_runs;
CREATE TRIGGER trg_stock_profile_runs_freno
  AFTER INSERT ON public.stock_profile_runs
  FOR EACH ROW EXECUTE FUNCTION public.create_stock_freno_notification();

-- ============================================================================
-- 244 · LLAMADAS DE RINKEL: TRANSCRIPCIÓN, RESUMEN Y LÍNEA DE LA CONVERSACIÓN
-- ============================================================================
--
-- Cuando una llamada contestada de Rinkel tiene grabación y está enlazada con un lead de Cold Calling, un proceso
-- automático (`rinkel-transcribir`, cada dos minutos, se apaga desde Sistema) la pasa a texto y deja en la ficha del lead:
--
--   · un RESUMEN de lo hablado (una a tres frases),
--   · la LÍNEA DE LA CONVERSACIÓN (los momentos de la llamada en orden y quién dijo cada cosa),
--   · el SIGUIENTE PASO acordado (volver a llamar el jueves, enviar información…) y el INTERÉS que mostró el cliente,
--   · y la transcripción entera, por si se quiere leer palabra por palabra.
--
-- Cada llamada se transcribe UNA sola vez: la fila de aquí es la prueba de que ya se hizo (y de lo que costó).
--
--   · `rinkel_transcripcion_ajustes`  Una sola fila: DESDE CUÁNDO se transcribe (nada anterior), los segundos mínimos que
--                                     tiene que durar una llamada para que valga la pena, y el tope de minutos de audio
--                                     por día (la red de seguridad del gasto). Cerrada al navegador.
--   · `rinkel_transcripciones`        Una fila por llamada: en qué estado va, lo que se oyó, lo que se entendió y lo que
--                                     costó. La ve quien ve la llamada (su dueño y quien supervisa al equipo comercial);
--                                     solo el servidor escribe.
--   · `rinkel_transcripciones_pendientes(...)`  Qué llamadas faltan por transcribir, las más antiguas primero.
--   · `rinkel_transcripcion_reclamar(...)`      Reserva UNA llamada para trabajar en ella sin que otra pasada la coja a la
--                                               vez (dos pasadas pueden solaparse) y cuenta el intento.
--
-- DESDE CUÁNDO. La fila de ajustes nace con `desde = ahora`: solo se transcribe lo que llegue a partir de lanzar esto. Para
-- transcribir también las llamadas que Rinkel todavía guarda (90 días; unos 8 $ en total, una sola vez):
--
--     UPDATE public.rinkel_transcripcion_ajustes SET desde = NOW() - INTERVAL '90 days', actualizado_at = NOW();
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho.
-- El código funciona SIN esta migración: el proceso avisa en Sistema de que falta lanzarla y la ficha sigue como antes.
-- Hace falta haber lanzado antes la 234 (llamadas de Rinkel) y la 237 (llamadas enlazadas con su lead).
-- ============================================================================


-- ---------- Los ajustes del proceso (una sola fila) ----------
CREATE TABLE IF NOT EXISTS public.rinkel_transcripcion_ajustes (
  -- La clave es siempre `true`: el CHECK impide que haya dos filas
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),

  -- No se transcribe ninguna llamada anterior a este instante
  desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una llamada «contestada» más corta es casi siempre un buzón de voz, un cuelgue o un «no está». Coincide con lo que
  -- cuenta como conversación en el correo con IA (lib/correo/ia-contexto.ts)
  minimo_segundos INTEGER NOT NULL DEFAULT 20 CHECK (minimo_segundos BETWEEN 10 AND 600),
  -- Minutos de audio que se pueden transcribir en 24 horas. Con 400 el techo de gasto son unos 1,8 $ al día; lo normal son
  -- 45 minutos. Si algo se desmadra (un bucle, una avalancha de llamadas), el proceso se para solo. 0 = parado
  tope_diario_minutos INTEGER NOT NULL DEFAULT 400 CHECK (tope_diario_minutos BETWEEN 0 AND 100000),

  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.rinkel_transcripcion_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.rinkel_transcripcion_ajustes IS
  'Ajustes del proceso que transcribe las llamadas de Rinkel (una sola fila): desde cuando, segundos minimos y tope diario de minutos. Cerrada al navegador: la lee el servidor.';

ALTER TABLE public.rinkel_transcripcion_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rinkel_transcripcion_ajustes FROM anon, authenticated;


-- ---------- Lo transcrito de cada llamada ----------
CREATE TABLE IF NOT EXISTS public.rinkel_transcripciones (
  -- Una fila por llamada. Si se borra la llamada, se borra esto
  llamada_id UUID PRIMARY KEY REFERENCES public.rinkel_llamadas(id) ON DELETE CASCADE,
  -- Copia del dueño de la llamada, para que la política de lectura no tenga que consultar otra tabla. Una llamada no cambia de dueño
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- procesando: alguien está trabajando en ella · hecha: lista · fallida: no ha salido, se reintenta (hasta 3 veces)
  -- · omitida: no se puede ni se va a hacer (la grabación ya no está, es demasiado larga…)
  estado TEXT NOT NULL DEFAULT 'procesando' CHECK (estado IN ('procesando', 'hecha', 'fallida', 'omitida')),
  -- Por qué ha fallado o se ha omitido: una frase nuestra, nunca el cuerpo de la respuesta de un proveedor
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 300),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  -- Desde cuándo está «procesando»: una reserva de más de diez minutos se da por muerta (el contenedor se reinició a medias)
  bloqueada_at TIMESTAMPTZ,
  -- Cuándo se puede volver a intentar una fallida. NULL = ya no se reintenta
  siguiente_intento_at TIMESTAMPTZ,

  -- Lo que se oyó
  transcripcion TEXT,
  idioma TEXT,
  segundos_audio INTEGER CHECK (segundos_audio IS NULL OR segundos_audio >= 0),
  transcrita_at TIMESTAMPTZ,

  -- Lo que se entendió
  tipo TEXT CHECK (tipo IS NULL OR tipo IN ('conversacion', 'buzon_de_voz', 'sin_contenido')),
  resumen TEXT,
  -- [{"quien": "comercial" | "cliente" | "los_dos", "texto": "…"}] en el orden en que ocurrió
  linea JSONB NOT NULL DEFAULT '[]'::jsonb,
  siguiente_paso TEXT,
  interes TEXT CHECK (interes IS NULL OR interes IN ('alto', 'medio', 'bajo', 'ninguno', 'no_claro')),

  -- Qué se ha usado y cuánto ha costado (dólares), para el tope diario y para saber a dónde va el dinero
  modelo_voz TEXT,
  modelo_texto TEXT,
  coste_voz_usd NUMERIC(10, 5),
  coste_texto_usd NUMERIC(10, 5),

  hecha_at TIMESTAMPTZ,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- «Qué fallidas toca reintentar» y «qué reservas han muerto»: pocas filas, y solo las que no están terminadas
CREATE INDEX IF NOT EXISTS rinkel_transcripciones_reintento_idx
  ON public.rinkel_transcripciones (estado, siguiente_intento_at)
  WHERE estado IN ('fallida', 'procesando');

-- El tope diario suma los segundos de audio de las últimas 24 horas
CREATE INDEX IF NOT EXISTS rinkel_transcripciones_transcrita_idx
  ON public.rinkel_transcripciones (transcrita_at)
  WHERE transcrita_at IS NOT NULL;

COMMENT ON TABLE public.rinkel_transcripciones IS
  'Una fila por llamada de Rinkel transcrita: estado, transcripcion, resumen, linea de la conversacion, siguiente paso, interes y coste. La lee quien ve la llamada (su dueno y quien supervisa el equipo comercial); solo escribe el servidor.';

ALTER TABLE public.rinkel_transcripciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cada uno ve lo de sus llamadas y quien supervisa lo de todos" ON public.rinkel_transcripciones;
CREATE POLICY "Cada uno ve lo de sus llamadas y quien supervisa lo de todos"
  ON public.rinkel_transcripciones FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.puede_ver_equipo_comercial(auth.uid()));

REVOKE ALL ON public.rinkel_transcripciones FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rinkel_transcripciones FROM authenticated;


-- ---------- Qué llamadas faltan por transcribir ----------
--
-- Una llamada es candidata si: se contestó y duró lo suficiente, tiene grabación que todavía existe, está enlazada con un lead
-- (si no, no hay ficha donde dejar el resumen: cuando se enlace más tarde, entra sola), es posterior a `p_desde` y ya ha
-- colgado hace un minuto y medio (el audio tarda en estar completo). Y además:
--   · no tiene fila todavía, o
--   · tiene una FALLIDA con intentos por gastar y cuyo turno ya ha llegado, o
--   · tiene una reserva «procesando» muerta (más de `p_bloqueo_min` minutos).
-- Las más antiguas primero. Devuelve como mucho `p_limite` (pocas, para no pasar de la lista de filas que admite la API).
CREATE OR REPLACE FUNCTION public.rinkel_transcripciones_pendientes(
  p_desde TIMESTAMPTZ,
  p_minimo INTEGER DEFAULT 20,
  p_limite INTEGER DEFAULT 12,
  p_bloqueo_min INTEGER DEFAULT 10,
  p_max_intentos INTEGER DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  lead_id UUID,
  fecha TIMESTAMPTZ,
  direccion TEXT,
  duracion_s INTEGER,
  grabacion_id TEXT,
  intentos INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.user_id, c.lead_id, c.fecha, c.direccion, c.duracion_s, c.grabacion_id, COALESCE(t.intentos, 0) AS intentos
    FROM public.rinkel_llamadas c
    LEFT JOIN public.rinkel_transcripciones t ON t.llamada_id = c.id
   WHERE c.fecha >= p_desde
     AND c.estado = 'ANSWERED'
     AND c.duracion_s >= p_minimo
     AND c.grabacion_id IS NOT NULL
     AND c.lead_id IS NOT NULL
     AND (c.grabacion_hasta IS NULL OR c.grabacion_hasta > NOW())
     AND c.fecha + make_interval(secs => c.duracion_s) + INTERVAL '90 seconds' < NOW()
     AND (
           t.llamada_id IS NULL
        OR (t.estado = 'fallida' AND t.intentos < p_max_intentos AND (t.siguiente_intento_at IS NULL OR t.siguiente_intento_at <= NOW()))
        OR (t.estado = 'procesando' AND t.intentos < p_max_intentos AND t.bloqueada_at < NOW() - make_interval(mins => p_bloqueo_min))
         )
   ORDER BY c.fecha ASC
   LIMIT GREATEST(p_limite, 0)
$$;

COMMENT ON FUNCTION public.rinkel_transcripciones_pendientes(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) IS
  'Llamadas de Rinkel contestadas, con grabacion y lead, que aun no tienen su transcripcion (o cuya fallida toca reintentar). Las mas antiguas primero. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.rinkel_transcripciones_pendientes(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rinkel_transcripciones_pendientes(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;


-- ---------- Reservar una llamada para trabajar en ella ----------
--
-- Dos pasadas del proceso pueden coincidir (una tarda más que el intervalo). Reservar es un solo INSERT … ON CONFLICT: el que
-- llega primero crea la fila en «procesando» y se la lleva; el segundo choca, y la rama DO UPDATE solo se cumple si la fila es
-- una fallida a la que le toca otro intento o una reserva muerta. Si no se cumple, no devuelve nada: la llamada es de otro.
-- Devuelve la fila entera, y con ella lo que una pasada anterior ya dejó hecho (la transcripción, para no pagarla dos veces).
CREATE OR REPLACE FUNCTION public.rinkel_transcripcion_reclamar(
  p_llamada UUID,
  p_user UUID,
  p_bloqueo_min INTEGER DEFAULT 10,
  p_max_intentos INTEGER DEFAULT 3
)
RETURNS SETOF public.rinkel_transcripciones
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.rinkel_transcripciones AS t (llamada_id, user_id, estado, intentos, bloqueada_at)
  VALUES (p_llamada, p_user, 'procesando', 1, NOW())
  ON CONFLICT (llamada_id) DO UPDATE
     SET estado = 'procesando',
         intentos = t.intentos + 1,
         bloqueada_at = NOW(),
         siguiente_intento_at = NULL,
         actualizada_at = NOW()
   WHERE t.intentos < p_max_intentos
     AND (
           (t.estado = 'fallida' AND (t.siguiente_intento_at IS NULL OR t.siguiente_intento_at <= NOW()))
        OR (t.estado = 'procesando' AND t.bloqueada_at < NOW() - make_interval(mins => p_bloqueo_min))
         )
  RETURNING t.*
$$;

COMMENT ON FUNCTION public.rinkel_transcripcion_reclamar(UUID, UUID, INTEGER, INTEGER) IS
  'Reserva una llamada para transcribirla: crea su fila en «procesando» (o retoma una fallida o una reserva muerta) y devuelve la fila. No devuelve nada si ya es de otra pasada. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.rinkel_transcripcion_reclamar(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rinkel_transcripcion_reclamar(UUID, UUID, INTEGER, INTEGER) TO service_role;


-- La lista de pendientes recorre las llamadas posteriores a `desde` que se contestaron y tienen grabación y lead
CREATE INDEX IF NOT EXISTS rinkel_llamadas_por_transcribir_idx
  ON public.rinkel_llamadas (fecha)
  WHERE estado = 'ANSWERED' AND grabacion_id IS NOT NULL AND lead_id IS NOT NULL;


-- ---------- Comprobación ----------
DO $$
DECLARE
  abierta_al_navegador BOOLEAN;
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('rinkel_transcripciones', 'rinkel_transcripcion_ajustes')) <> 2 THEN
    RAISE EXCEPTION 'Faltan las tablas de la transcripcion de llamadas.';
  END IF;

  IF (SELECT count(*) FROM public.rinkel_transcripcion_ajustes) <> 1 THEN
    RAISE EXCEPTION 'Los ajustes de la transcripcion tienen que ser una sola fila.';
  END IF;

  -- Lo que no puede pasar: que los ajustes o las funciones se puedan usar desde el navegador, o que alguien escriba las transcripciones
  SELECT has_table_privilege('authenticated', 'public.rinkel_transcripcion_ajustes', 'SELECT')
      OR has_table_privilege('anon', 'public.rinkel_transcripciones', 'SELECT')
      OR has_table_privilege('authenticated', 'public.rinkel_transcripciones', 'INSERT')
      OR has_table_privilege('authenticated', 'public.rinkel_transcripciones', 'UPDATE')
      OR has_function_privilege('authenticated', 'public.rinkel_transcripciones_pendientes(timestamptz, integer, integer, integer, integer)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.rinkel_transcripcion_reclamar(uuid, uuid, integer, integer)', 'EXECUTE')
    INTO abierta_al_navegador;
  IF abierta_al_navegador THEN
    RAISE EXCEPTION 'La transcripcion de llamadas queda abierta al navegador: NO se deja asi.';
  END IF;

  RAISE NOTICE 'Transcripcion de llamadas lista. Se transcribe desde % (minimo % s, tope % min al dia). Apagar o cambiar el ritmo: pantalla de Sistema.',
    (SELECT desde FROM public.rinkel_transcripcion_ajustes),
    (SELECT minimo_segundos FROM public.rinkel_transcripcion_ajustes),
    (SELECT tope_diario_minutos FROM public.rinkel_transcripcion_ajustes);
END $$;

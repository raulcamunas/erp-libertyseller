-- 259: LA TRANSCRIPCIÓN DE UNA LLAMADA EMPIEZA A LOS 45 s DE COLGAR (ANTES, 90 s FIJOS)
-- =====================================================================================
-- La función rinkel_transcripciones_pendientes (migración 244) no ofrecía una llamada hasta 90 s después de colgar («el audio tarda en estar completo»), y ese número
-- estaba escrito a fuego dentro del SQL. Medido el 28 oct 2026 sobre las 104 llamadas reales transcritas, llamada -> resumen tardaba 158 s de mediana: 90 s eran esa
-- espera, ~53 s el turno del proceso (pasaba cada dos minutos; ahora cada 30 s) y 8 s el procesado. El audio estaba ENTERO en las 17 llamadas que se bajaron entre 90 y
-- 110 s tras colgar (audio/duración 1,016); por debajo de 90 s nadie lo había medido, por eso el código de la transcripción ahora trata una grabación que aún no está
-- (o que está a medias) como un «todavía no» y no como un fallo (lib/transcripcion/motor.ts).
--
-- Esta migración convierte la espera en un AJUSTE (una columna de la fila de ajustes, 45 por defecto) y hace que la función la lea. Así se cambia con un UPDATE, sin tocar
-- código ni volver a desplegar:
--
--   volver a como estaba:   UPDATE public.rinkel_transcripcion_ajustes SET espera_tras_colgar_s = 90 WHERE id;
--   probar con otro valor:  UPDATE public.rinkel_transcripcion_ajustes SET espera_tras_colgar_s = 60 WHERE id;
--
-- QUÉ NO CAMBIA: la firma de la función (el código de antes y el de ahora la llaman igual), sus permisos, qué llamadas son candidatas (contestadas, de más de
-- `minimo_segundos`, con grabación, lead y fecha posterior a `desde`) ni los reintentos. Sin la columna o sin la fila de ajustes, la función usa 90 s como siempre.
-- Es idempotente: se puede lanzar más de una vez.

ALTER TABLE public.rinkel_transcripcion_ajustes
  ADD COLUMN IF NOT EXISTS espera_tras_colgar_s INTEGER NOT NULL DEFAULT 45
    CHECK (espera_tras_colgar_s BETWEEN 20 AND 600);

COMMENT ON COLUMN public.rinkel_transcripcion_ajustes.espera_tras_colgar_s IS
  'Segundos que tienen que pasar desde que se cuelga una llamada para que se empiece a transcribir (la grabacion tarda en estar entera). 45 por defecto; antes 90 fijos en el SQL. Entre 20 y 600.';


-- ---------- Qué llamadas faltan por transcribir (la misma función, con la espera como ajuste) ----------
--
-- Una llamada es candidata si: se contestó y duró lo suficiente, tiene grabación que todavía existe, está enlazada con un lead
-- (si no, no hay ficha donde dejar el resumen: cuando se enlace más tarde, entra sola), es posterior a `p_desde` y ya ha
-- colgado hace `espera_tras_colgar_s` segundos (90 si no hay ajuste). Y además:
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
     AND c.fecha + make_interval(secs => c.duracion_s)
           + make_interval(secs => COALESCE((SELECT a.espera_tras_colgar_s FROM public.rinkel_transcripcion_ajustes a WHERE a.id), 90)) < NOW()
     AND (
           t.llamada_id IS NULL
        OR (t.estado = 'fallida' AND t.intentos < p_max_intentos AND (t.siguiente_intento_at IS NULL OR t.siguiente_intento_at <= NOW()))
        OR (t.estado = 'procesando' AND t.intentos < p_max_intentos AND t.bloqueada_at < NOW() - make_interval(mins => p_bloqueo_min))
         )
   ORDER BY c.fecha ASC
   LIMIT GREATEST(p_limite, 0)
$$;

COMMENT ON FUNCTION public.rinkel_transcripciones_pendientes(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) IS
  'Llamadas de Rinkel contestadas, con grabacion y lead, que aun no tienen su transcripcion (o cuya fallida toca reintentar) y que colgaron hace al menos espera_tras_colgar_s segundos (ajuste, 90 si falta). Las mas antiguas primero. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.rinkel_transcripciones_pendientes(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rinkel_transcripciones_pendientes(TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;

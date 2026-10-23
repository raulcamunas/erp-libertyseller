-- ============================================================================
-- 245 · CORREO: SECUENCIAS DE SEGUIMIENTO AUTOMÁTICO
-- ============================================================================
--
-- Cuando un comercial envía un correo a un lead desde Correo con «Redactar con IA», la IA escribe a la vez dos
-- seguimientos (a los 3 y a los 7 días hábiles). Al enviar el primero quedan PROGRAMADOS: un motor (`correo-secuencias`,
-- cada minuto, se apaga desde Sistema) los manda desde el propio buzón del comercial, en el mismo hilo, entre las 9:00 y
-- las 18:00 (hora de Madrid), repartidos al azar entre TODOS los buzones para que no salgan a la vez. Antes de cada envío
-- mira el buzón (¿ha contestado? ¿ha rebotado?), las llamadas y lo escrito en la ficha del lead; si el lead contesta o pasa
-- a «No interesa», se para solo. Si nadie contesta al último, el ERP lo pasa a «No interesa» pasados unos días.
--
--   · `correo_secuencia_ajustes`       Una sola fila: el interruptor general, el modo ensayo, el horario, los huecos entre
--                                      envíos, la rampa de volumen, los frenos y los festivos.
--   · `correo_secuencia_buzones`       Una fila por buzón: si participa, si está en pausa (freno), desde cuándo cuenta su rampa
--                                      y en qué horas llama su dueño (para repartir los envíos automáticos sin apilarlos).
--   · `correo_secuencias`              La definición: cuántos días hábiles después del primer correo sale cada seguimiento.
--   · `correo_secuencia_inscripciones` Un lead dentro de una secuencia: de qué buzón sale, a quién, en qué hilo y en qué estado va.
--   · `correo_secuencia_pasos`         Cada correo de la secuencia (el primero, ya enviado por la persona, y los seguimientos): su
--                                      texto, la hora exacta programada y lo que pasó.
--   · `correo_secuencia_eventos`       El rastro: qué se decidió y por qué (se salta, se pausa, se envía, contesta, rebota…).
--   · `correo_direcciones_malas`       La memoria de direcciones que han rebotado: el ERP aprende de cada rebote y no vuelve a escribirles ni a
--                                      programarles seguimientos, ni desde la secuencia ni a mano (el cuadro de Correo avisa antes de enviar).
--   · `correo_secuencia_reclamar_pasos(...)`  Reserva los pasos que ya tocan sin que dos pasadas del motor cojan el mismo.
--   · `correo_secuencia_purgar(...)`   Borra las secuencias terminadas hace mucho.
--
-- TODO ESTÁ CERRADO AL NAVEGADOR (RLS sin políticas y permisos quitados), como las tablas `correo_*`: lo lee y lo escribe
-- el servidor, que es quien decide qué ve cada comercial (el suyo) y quién supervisa (todo).
--
-- NACE APAGADO Y EN ENSAYO: `activa = false` y `modo_ensayo = true`. El motor no hace nada hasta que se enciende desde la
-- pantalla de Secuencias (o desde Sistema), y en ensayo decide y apunta lo que enviaría pero NO envía.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho.
-- El código funciona SIN esta migración: Correo sigue como siempre y la pantalla de Secuencias dice que falta lanzarla.
-- Hace falta haber lanzado antes la 236 (correo), la 087 (leads de Cold Calling) y la 244 (transcripciones, para leer la
-- conversación de las llamadas).
-- ============================================================================


-- ---------- Los ajustes (una sola fila) ----------
CREATE TABLE IF NOT EXISTS public.correo_secuencia_ajustes (
  -- La clave es siempre `true`: el CHECK impide que haya dos filas
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),

  -- El interruptor general. Apagado, el motor no hace NADA (ni siquiera mira los buzones)
  activa BOOLEAN NOT NULL DEFAULT false,
  -- Ensayo: el motor decide qué enviaría a cada lead y lo apunta, pero no envía nada. Sirve para un primer día de comprobación
  modo_ensayo BOOLEAN NOT NULL DEFAULT true,

  -- Cuándo se envía, en minutos desde la medianoche y en HORA DE MADRID: de 9:00 (540) a 18:00 (1080)
  ventana_desde_min INTEGER NOT NULL DEFAULT 540 CHECK (ventana_desde_min BETWEEN 0 AND 1439),
  ventana_hasta_min INTEGER NOT NULL DEFAULT 1080 CHECK (ventana_hasta_min BETWEEN 1 AND 1440),
  -- Entre dos envíos cualesquiera de todo el sistema, y entre dos del mismo buzón, como mínimo esto (se reparte con azar por encima)
  hueco_global_s INTEGER NOT NULL DEFAULT 45 CHECK (hueco_global_s BETWEEN 5 AND 3600),
  hueco_buzon_s INTEGER NOT NULL DEFAULT 180 CHECK (hueco_buzon_s BETWEEN 10 AND 7200),
  -- Qué parte de los envíos automáticos de un día cae antes de las 14:00 (el resto, después)
  peso_manana_pct INTEGER NOT NULL DEFAULT 60 CHECK (peso_manana_pct BETWEEN 0 AND 100),

  -- La rampa de volumen: tope DIARIO de correos de un buzón (los que escribe la persona a mano y los automáticos) según los
  -- días hábiles que lleva funcionando. [{"desde": día hábil, "tope": correos}]
  rampa JSONB NOT NULL DEFAULT '[{"desde":1,"tope":40},{"desde":4,"tope":70},{"desde":8,"tope":100},{"desde":15,"tope":150}]'::jsonb
    CHECK (jsonb_typeof(rampa) = 'array' AND jsonb_array_length(rampa) BETWEEN 1 AND 12),
  -- Y como mucho esto en una hora, también contando lo que escribe la persona
  tope_hora INTEGER NOT NULL DEFAULT 25 CHECK (tope_hora BETWEEN 1 AND 500),

  -- Si nadie contesta al último correo, a los cuántos días hábiles el ERP pasa el lead a «No interesa»
  dias_hasta_no_interesa INTEGER NOT NULL DEFAULT 7 CHECK (dias_hasta_no_interesa BETWEEN 1 AND 60),

  -- El freno: si en las últimas 24 horas rebota más de este porcentaje de los correos de un buzón (con al menos `freno_minimo_envios`
  -- enviados), ese buzón se pausa solo hasta el día siguiente
  freno_rebotes_pct INTEGER NOT NULL DEFAULT 4 CHECK (freno_rebotes_pct BETWEEN 1 AND 100),
  freno_minimo_envios INTEGER NOT NULL DEFAULT 20 CHECK (freno_minimo_envios BETWEEN 5 AND 1000),

  -- Días en que no se envía además de sábados y domingos (festivos nacionales de España que caen en día laborable)
  festivos DATE[] NOT NULL DEFAULT ARRAY['2026-12-08', '2026-12-25', '2027-01-01', '2027-01-06', '2027-03-26', '2027-10-12', '2027-11-01', '2027-12-06', '2027-12-08']::date[],

  CONSTRAINT correo_secuencia_ajustes_ventana CHECK (ventana_hasta_min > ventana_desde_min),
  -- Lo que el motor se apunta a sí mismo: hasta cuándo ha mirado los correos que entraban (para parar una secuencia en cuanto el lead contesta,
  -- sin esperar a que le toque el siguiente envío) y cuándo hizo la última limpieza
  vigilancia_at TIMESTAMPTZ,
  purgado_at TIMESTAMPTZ,

  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.correo_secuencia_ajustes (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.correo_secuencia_ajustes IS
  'Ajustes del motor de secuencias de correo (una sola fila): interruptor, ensayo, horario en hora de Madrid, huecos, rampa de volumen, frenos y festivos. Cerrada al navegador.';

ALTER TABLE public.correo_secuencia_ajustes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_secuencia_ajustes FROM anon, authenticated;


-- ---------- El estado de cada buzón en el motor ----------
CREATE TABLE IF NOT EXISTS public.correo_secuencia_buzones (
  buzon_id UUID PRIMARY KEY REFERENCES public.correo_buzones(id) ON DELETE CASCADE,

  -- false = este buzón no recibe ni envía secuencias
  participa BOOLEAN NOT NULL DEFAULT true,
  -- En pausa hasta esta hora (la pone el freno por rebotes o por bloqueo del servidor, o una persona). NULL = en marcha
  pausado_hasta TIMESTAMPTZ,
  motivo_pausa TEXT CHECK (motivo_pausa IS NULL OR length(motivo_pausa) <= 300),
  -- El día en que empezó a contar su rampa (se apunta solo la primera vez que el motor lo usa)
  rampa_inicio DATE,
  -- Si se pone, sustituye a la rampa: tope diario fijo para este buzón
  tope_diario INTEGER CHECK (tope_diario IS NULL OR tope_diario BETWEEN 1 AND 1000),

  -- En qué horas llama su dueño (y por tanto manda sus correos a mano), en minutos desde la medianoche, hora de Madrid.
  -- El reparto de los envíos automáticos lo tiene en cuenta para que el buzón salga parejo durante el día
  llamadas_desde_min INTEGER NOT NULL DEFAULT 600 CHECK (llamadas_desde_min BETWEEN 0 AND 1439),
  llamadas_hasta_min INTEGER NOT NULL DEFAULT 840 CHECK (llamadas_hasta_min BETWEEN 1 AND 1440),

  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT correo_secuencia_buzones_llamadas CHECK (llamadas_hasta_min > llamadas_desde_min)
);

COMMENT ON TABLE public.correo_secuencia_buzones IS
  'Estado de cada buzon en el motor de secuencias: si participa, si esta en pausa (freno), desde cuando cuenta su rampa de volumen y en que horas llama su dueno. Cerrada al navegador.';

ALTER TABLE public.correo_secuencia_buzones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_secuencia_buzones FROM anon, authenticated;

-- Los buzones que ya están conectados: de 10:00 a 14:00 llaman todos, y Alejandro hasta las 16:00
INSERT INTO public.correo_secuencia_buzones (buzon_id, llamadas_desde_min, llamadas_hasta_min)
SELECT b.id, 600, CASE WHEN lower(b.direccion) = 'alejandro@libertyseller.es' THEN 960 ELSE 840 END
  FROM public.correo_buzones b
ON CONFLICT (buzon_id) DO NOTHING;


-- ---------- La definición de la secuencia ----------
CREATE TABLE IF NOT EXISTS public.correo_secuencias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  activa BOOLEAN NOT NULL DEFAULT true,
  -- La secuencia que se usa cuando no se elige otra. Solo puede haber una
  es_base BOOLEAN NOT NULL DEFAULT false,
  -- Los seguimientos: cuántos días HÁBILES después del primer correo sale cada uno. [{"orden": 1, "dias": 3}, {"orden": 2, "dias": 7}]
  pasos JSONB NOT NULL DEFAULT '[{"orden":1,"dias":3},{"orden":2,"dias":7}]'::jsonb
    CHECK (jsonb_typeof(pasos) = 'array' AND jsonb_array_length(pasos) BETWEEN 1 AND 4),
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS correo_secuencias_una_base_idx ON public.correo_secuencias ((true)) WHERE es_base;

INSERT INTO public.correo_secuencias (nombre, es_base)
SELECT 'Prospección: primer correo y 2 seguimientos', true
 WHERE NOT EXISTS (SELECT 1 FROM public.correo_secuencias WHERE es_base);

COMMENT ON TABLE public.correo_secuencias IS
  'Definicion de una secuencia de seguimiento: cuantos dias habiles despues del primer correo sale cada seguimiento. Cerrada al navegador.';

ALTER TABLE public.correo_secuencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_secuencias FROM anon, authenticated;


-- ---------- Un lead dentro de una secuencia ----------
CREATE TABLE IF NOT EXISTS public.correo_secuencia_inscripciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  secuencia_id UUID NOT NULL REFERENCES public.correo_secuencias(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL REFERENCES public.cold_leads(id) ON DELETE CASCADE,
  -- De qué buzón sale todo, y el comercial dueño de ese buzón
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- El hilo del primer correo y su Message-ID (sin < >): los seguimientos contestan a ese correo y quedan en su hilo
  hilo_id UUID REFERENCES public.correo_hilos(id) ON DELETE SET NULL,
  message_id_inicial TEXT,
  destinatario TEXT NOT NULL CHECK (length(destinatario) BETWEEN 3 AND 320),
  asunto_base TEXT NOT NULL DEFAULT '' CHECK (length(asunto_base) <= 500),

  -- activa: sigue en marcha · pausada: detenida a la espera de una persona · respondida: el lead contestó · parada: se cortó por otra
  -- razón (ver `motivo`) · completada: salieron todos y se espera la fecha límite · sin_respuesta: pasó la fecha límite sin respuesta y el
  -- lead se marcó «No interesa» · cancelada: la cortó una persona
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'pausada', 'respondida', 'parada', 'completada', 'sin_respuesta', 'cancelada')),
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 400),
  -- El mismo motivo como código corto (respuesta, rebote, lead_no_interesa, cancelada_por_persona…): sirve para contar por qué se cortan
  codigo TEXT CHECK (codigo IS NULL OR length(codigo) <= 40),

  primer_envio_at TIMESTAMPTZ NOT NULL,
  -- Cuándo, si nadie contesta, se pasa el lead a «No interesa»
  no_interesa_en TIMESTAMPTZ,
  -- Cuándo se cortó (si el lead contestó, la fecha de su respuesta)
  parada_at TIMESTAMPTZ,
  -- Con qué modelo se escribieron los seguimientos
  ia_modelo TEXT CHECK (ia_modelo IS NULL OR length(ia_modelo) <= 60),
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un lead no puede estar en dos secuencias vivas a la vez
CREATE UNIQUE INDEX IF NOT EXISTS correo_secuencia_inscripciones_una_viva_idx
  ON public.correo_secuencia_inscripciones (lead_id)
  WHERE estado IN ('activa', 'pausada');

CREATE INDEX IF NOT EXISTS correo_secuencia_inscripciones_usuario_idx ON public.correo_secuencia_inscripciones (user_id, creada_at DESC);
CREATE INDEX IF NOT EXISTS correo_secuencia_inscripciones_buzon_idx ON public.correo_secuencia_inscripciones (buzon_id, estado);
CREATE INDEX IF NOT EXISTS correo_secuencia_inscripciones_lead_idx ON public.correo_secuencia_inscripciones (lead_id, creada_at DESC);
-- «A quién le toca pasar a No interesa»
CREATE INDEX IF NOT EXISTS correo_secuencia_inscripciones_cierre_idx
  ON public.correo_secuencia_inscripciones (no_interesa_en)
  WHERE estado = 'completada' AND no_interesa_en IS NOT NULL;

COMMENT ON TABLE public.correo_secuencia_inscripciones IS
  'Un lead dentro de una secuencia de seguimiento: buzon, destinatario, hilo del primer correo y estado. Solo una viva por lead. Cerrada al navegador.';

ALTER TABLE public.correo_secuencia_inscripciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_secuencia_inscripciones FROM anon, authenticated;


-- ---------- Cada correo de la secuencia ----------
CREATE TABLE IF NOT EXISTS public.correo_secuencia_pasos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  inscripcion_id UUID NOT NULL REFERENCES public.correo_secuencia_inscripciones(id) ON DELETE CASCADE,
  -- De qué buzón sale y a qué empresa (su dominio, en minúsculas; vacío si es un proveedor libre como gmail). Son copias de lo de la
  -- secuencia: el planificador cuenta correos por buzón y por empresa sin tener que juntar tablas
  buzon_id UUID NOT NULL REFERENCES public.correo_buzones(id) ON DELETE CASCADE,
  dominio TEXT NOT NULL DEFAULT '',
  -- 0 = el primer correo (lo envió la persona, aquí solo queda anotado); 1, 2… = los seguimientos
  orden SMALLINT NOT NULL CHECK (orden BETWEEN 0 AND 5),

  -- pendiente: programado, espera su hora · enviando: el motor lo ha cogido · enviado · pausado: detenido a la espera de una persona ·
  -- saltado: el control de salida decidió no mandarlo (ver `motivo`) · cancelado: la secuencia se cortó · fallido: no se pudo enviar
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviando', 'enviado', 'pausado', 'saltado', 'cancelado', 'fallido')),
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 400),

  asunto TEXT NOT NULL DEFAULT '' CHECK (length(asunto) <= 500),
  -- El texto SIN firma (la firma del buzón se añade al enviar)
  texto TEXT NOT NULL DEFAULT '' CHECK (length(texto) <= 20000),
  -- Lo que salió de verdad si el control de salida lo adaptó a lo escrito en la ficha
  texto_enviado TEXT CHECK (texto_enviado IS NULL OR length(texto_enviado) <= 20000),

  -- Cuántos días hábiles después del primer correo toca, el día elegido y la hora exacta programada
  dias_habiles INTEGER NOT NULL DEFAULT 0 CHECK (dias_habiles BETWEEN 0 AND 60),
  objetivo_dia DATE,
  programado_at TIMESTAMPTZ,

  enviado_at TIMESTAMPTZ,
  -- El Message-ID (sin < >) con el que sale: se apunta ANTES de enviar, para poder comprobar después si un envío que se cortó a medias salió
  message_id TEXT,

  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  siguiente_intento_at TIMESTAMPTZ,
  reclamado_at TIMESTAMPTZ,
  -- Qué miró el control de salida y qué decidió (JSON pequeño, para la pantalla del lead)
  decision JSONB,

  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT correo_secuencia_pasos_uno_por_orden UNIQUE (inscripcion_id, orden)
);

-- La cola: lo que ya toca, por hora
CREATE INDEX IF NOT EXISTS correo_secuencia_pasos_cola_idx
  ON public.correo_secuencia_pasos (programado_at)
  WHERE estado = 'pendiente';
-- Las reservas muertas (el contenedor se reinició a medias)
CREATE INDEX IF NOT EXISTS correo_secuencia_pasos_reservas_idx
  ON public.correo_secuencia_pasos (reclamado_at)
  WHERE estado = 'enviando';
-- Lo que sale cada día (pantalla de Hoy y calendario)
CREATE INDEX IF NOT EXISTS correo_secuencia_pasos_dia_idx
  ON public.correo_secuencia_pasos (programado_at, estado)
  WHERE programado_at IS NOT NULL;
-- Lo de cada buzón
CREATE INDEX IF NOT EXISTS correo_secuencia_pasos_buzon_idx
  ON public.correo_secuencia_pasos (buzon_id, programado_at)
  WHERE programado_at IS NOT NULL;

COMMENT ON TABLE public.correo_secuencia_pasos IS
  'Cada correo de una secuencia: el primero (ya enviado por la persona) y los seguimientos, con su texto, la hora exacta programada y lo que paso. Cerrada al navegador.';

ALTER TABLE public.correo_secuencia_pasos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_secuencia_pasos FROM anon, authenticated;


-- ---------- El rastro de lo que se decide ----------
CREATE TABLE IF NOT EXISTS public.correo_secuencia_eventos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Falta en los avisos de un buzón entero (freno por rebotes, pausa por límite del proveedor…): entonces va `buzon_id`
  inscripcion_id UUID REFERENCES public.correo_secuencia_inscripciones(id) ON DELETE CASCADE,
  paso_id UUID REFERENCES public.correo_secuencia_pasos(id) ON DELETE SET NULL,
  buzon_id UUID REFERENCES public.correo_buzones(id) ON DELETE SET NULL,
  -- inscrita, programado, enviado, saltado, pausado, reanudado, respuesta, rebote, fuera_de_oficina, parada, cancelada, no_interesa,
  -- freno, error, ensayo…
  tipo TEXT NOT NULL CHECK (length(tipo) BETWEEN 1 AND 40),
  detalle TEXT CHECK (detalle IS NULL OR length(detalle) <= 600),
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT correo_secuencia_eventos_de_alguien CHECK (inscripcion_id IS NOT NULL OR buzon_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS correo_secuencia_eventos_inscripcion_idx ON public.correo_secuencia_eventos (inscripcion_id, creado_at);
CREATE INDEX IF NOT EXISTS correo_secuencia_eventos_buzon_idx ON public.correo_secuencia_eventos (buzon_id, creado_at DESC);

COMMENT ON TABLE public.correo_secuencia_eventos IS
  'El rastro de cada secuencia: que se decidio y por que (se salta, se pausa, se envia, contesta, rebota...). Cerrada al navegador.';

ALTER TABLE public.correo_secuencia_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_secuencia_eventos FROM anon, authenticated;


-- ---------- La memoria de direcciones que han rebotado ----------
--
-- Cada vez que un servidor de correo dice «esa dirección no existe» (un aviso de rebote, o un rechazo al enviar) la dirección queda aquí. Sirve para
-- tres cosas: el cuadro de Correo avisa ANTES de enviar a una dirección que ya rebotó, las secuencias no se programan a ella, y un seguimiento
-- pendiente se cancela si su dirección rebota por otro lado. `liberada` es cuando una persona dice que en realidad funciona (la dirección se arregló).
CREATE TABLE IF NOT EXISTS public.correo_direcciones_malas (
  direccion TEXT PRIMARY KEY CHECK (direccion = lower(direccion) AND length(direccion) BETWEEN 3 AND 320),
  estado TEXT NOT NULL DEFAULT 'mala' CHECK (estado IN ('mala', 'liberada')),
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 300),
  origen TEXT NOT NULL DEFAULT 'rebote' CHECK (origen IN ('rebote', 'rechazo_smtp', 'manual')),
  veces INTEGER NOT NULL DEFAULT 1 CHECK (veces >= 1),
  primera_vez TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.correo_direcciones_malas IS
  'Direcciones de correo que han rebotado (el servidor dijo que no existen) o que una persona ha marcado. El cuadro de Correo y las secuencias las consultan antes de enviar. Cerrada al navegador.';

ALTER TABLE public.correo_direcciones_malas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_direcciones_malas FROM anon, authenticated;


-- ---------- Los rebotes duros recientes, de TODOS los buzones ----------
--
-- Para aprender de cada rebote aunque el correo no fuera de una secuencia (un primer correo a mano que rebotó). Devuelve los avisos de un servidor de
-- correo ('mailer-daemon', 'postmaster'…) con un código 5.x.x o diciendo que la dirección no existe, que han entrado en el ERP desde una hora, con el
-- texto recortado: de él la aplicación saca la dirección que falló.
CREATE OR REPLACE FUNCTION public.correo_secuencia_rebotes(p_desde TIMESTAMPTZ, p_limite INTEGER DEFAULT 500)
RETURNS TABLE (id UUID, buzon_id UUID, de_direccion TEXT, asunto TEXT, texto TEXT, fecha TIMESTAMPTZ, creado_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.buzon_id, m.de_direccion, m.asunto, left(m.texto, 8000), m.fecha, m.creado_at
    FROM public.correo_mensajes m
   WHERE m.direccion = 'entrante'
     AND m.automatico
     AND m.creado_at >= p_desde
     AND m.de_direccion ~* '^(mailer-daemon|postmaster|mail-daemon|maildelivery)'
     AND (m.texto ~ '\m5\.[0-9]{1,3}\.[0-9]{1,3}\M'
          OR m.texto ~* '(user unknown|no such user|does not exist|no existe|address rejected|recipient rejected|usuario desconocido)')
   ORDER BY m.creado_at ASC
   LIMIT GREATEST(LEAST(p_limite, 1000), 1)
$$;

COMMENT ON FUNCTION public.correo_secuencia_rebotes(TIMESTAMPTZ, INTEGER) IS
  'Avisos de rebote duro (servidor de correo + codigo 5.x.x o direccion inexistente) entrados desde p_desde, de todos los buzones. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_rebotes(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_rebotes(TIMESTAMPTZ, INTEGER) TO service_role;


-- ---------- Reservar los pasos que ya tocan ----------
--
-- Dos pasadas del motor pueden coincidir (una tarda más que el minuto). Esto elige los pasos de secuencias ACTIVAS cuya hora ya llegó
-- (o cuya reserva anterior murió hace más de `p_bloqueo_min` minutos), los marca «enviando» y cuenta el intento, todo en una sola
-- sentencia: `FOR UPDATE SKIP LOCKED` hace que la segunda pasada se salte lo que la primera tiene cogido en vez de esperarlo, así
-- que ningún paso lo coge nadie dos veces. Los más antiguos primero. Devuelve las filas ya reservadas.
CREATE OR REPLACE FUNCTION public.correo_secuencia_reclamar_pasos(
  p_ahora TIMESTAMPTZ,
  p_limite INTEGER DEFAULT 5,
  p_bloqueo_min INTEGER DEFAULT 10
)
RETURNS SETOF public.correo_secuencia_pasos
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH candidatos AS (
    SELECT p.id
      FROM public.correo_secuencia_pasos p
      JOIN public.correo_secuencia_inscripciones i ON i.id = p.inscripcion_id
     WHERE i.estado = 'activa'
       AND p.orden > 0
       AND (
             (p.estado = 'pendiente'
               AND p.programado_at IS NOT NULL
               AND p.programado_at <= p_ahora
               AND (p.siguiente_intento_at IS NULL OR p.siguiente_intento_at <= p_ahora))
          OR (p.estado = 'enviando' AND p.reclamado_at < p_ahora - make_interval(mins => p_bloqueo_min))
           )
     ORDER BY p.programado_at ASC NULLS LAST, p.orden ASC
     LIMIT GREATEST(p_limite, 0)
       FOR UPDATE OF p SKIP LOCKED
  )
  UPDATE public.correo_secuencia_pasos p
     SET estado = 'enviando',
         reclamado_at = p_ahora,
         intentos = p.intentos + 1,
         actualizado_at = p_ahora
    FROM candidatos c
   WHERE p.id = c.id
  RETURNING p.*
$$;

COMMENT ON FUNCTION public.correo_secuencia_reclamar_pasos(TIMESTAMPTZ, INTEGER, INTEGER) IS
  'Reserva (estado enviando, +1 intento) los pasos de secuencias activas cuya hora ya llego o cuya reserva murio. SKIP LOCKED: dos pasadas del motor nunca cogen el mismo. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_reclamar_pasos(TIMESTAMPTZ, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_reclamar_pasos(TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;


-- ---------- Limpiar lo terminado hace mucho ----------
--
-- Borra las secuencias que acabaron (respondidas, paradas, completadas, sin respuesta o canceladas) hace más de `p_dias` días, con
-- sus pasos y su rastro. Las vivas no se tocan nunca. Devuelve cuántas borró. La llama el propio motor como mucho una vez al día.
CREATE OR REPLACE FUNCTION public.correo_secuencia_purgar(p_dias INTEGER DEFAULT 180)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  borradas INTEGER;
BEGIN
  IF p_dias < 30 THEN
    RAISE EXCEPTION 'No se purga lo de menos de 30 dias.';
  END IF;
  DELETE FROM public.correo_secuencia_inscripciones
   WHERE estado NOT IN ('activa', 'pausada')
     AND actualizada_at < NOW() - make_interval(days => p_dias);
  GET DIAGNOSTICS borradas = ROW_COUNT;
  RETURN borradas;
END;
$$;

COMMENT ON FUNCTION public.correo_secuencia_purgar(INTEGER) IS
  'Borra las secuencias terminadas hace mas de p_dias dias (minimo 30), con sus pasos y su rastro. Las vivas no se tocan. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_purgar(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_purgar(INTEGER) TO service_role;


-- ---------- Índices que necesita el motor ----------
--
-- «Qué ha entrado en los últimos minutos» (para parar una secuencia en cuanto el lead contesta) y «de qué paso es este Message-ID» (para saber
-- si un envío que se cortó a medias llegó a salir). Los demás índices que usa el motor ya existen (migraciones 236 y 243).
CREATE INDEX IF NOT EXISTS correo_mensajes_entrantes_creado_idx
  ON public.correo_mensajes (creado_at DESC)
  WHERE direccion = 'entrante';

CREATE INDEX IF NOT EXISTS correo_secuencia_pasos_message_idx
  ON public.correo_secuencia_pasos (message_id)
  WHERE message_id IS NOT NULL;


-- ---------- Lo que ha entrado, para saber quién ha contestado ----------
--
-- Los dos leen correos ENTRANTES y devuelven el texto recortado a 8.000 caracteres: un boletín de 2 MB no tiene que viajar entero a la
-- aplicación para saber si es una respuesta o un rebote. Se filtra por la fecha en que el correo ENTRÓ en el ERP (`creado_at`), no por la
-- fecha que dice su cabecera: una respuesta con el reloj del que escribe mal puesto sigue entrando después de nuestro envío.
--
--   · `correo_secuencia_vigilar`       la vigilancia. Cruza lo que ha entrado desde una hora con las secuencias vivas de ese mismo buzón y
--                                      devuelve SOLO las parejas «mensaje ↔ secuencia» que pueden tener que ver: cuelga del hilo del primer correo,
--                                      lo escribe el destinatario o su empresa (los proveedores libres de `p_libres`, como gmail, no cuentan como
--                                      empresa), o es un aviso automático que nombra su dirección (un rebote). La aplicación remata la clasificación;
--                                      esto es el filtro grueso, para no traerse todas las secuencias cada minuto.
--   · `correo_secuencia_entrantes_de`  lo mismo para UN destinatario de UN buzón: es lo último que se mira antes de cada envío.
CREATE OR REPLACE FUNCTION public.correo_secuencia_vigilar(p_desde TIMESTAMPTZ, p_libres TEXT[] DEFAULT '{}')
RETURNS TABLE (
  inscripcion_id UUID, buzon_id UUID, destinatario TEXT, hilo_id UUID, primer_envio_at TIMESTAMPTZ,
  mensaje_id UUID, mensaje_hilo_id UUID, de_direccion TEXT, asunto TEXT, texto TEXT, fecha TIMESTAMPTZ, automatico BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.buzon_id, i.destinatario, i.hilo_id, i.primer_envio_at,
         m.id, m.hilo_id, m.de_direccion, m.asunto, left(m.texto, 8000), m.fecha, m.automatico
    FROM public.correo_mensajes m
    JOIN public.correo_secuencia_inscripciones i
      ON i.buzon_id = m.buzon_id
     AND i.estado IN ('activa', 'pausada')
     AND m.creado_at >= i.primer_envio_at
   WHERE m.direccion = 'entrante'
     AND m.creado_at >= p_desde
     AND (
           (i.hilo_id IS NOT NULL AND m.hilo_id = i.hilo_id)
        OR lower(m.de_direccion) = lower(i.destinatario)
        OR (    lower(split_part(i.destinatario, '@', 2)) <> ''
            AND NOT (lower(split_part(i.destinatario, '@', 2)) = ANY (COALESCE(p_libres, '{}')))
            AND lower(split_part(m.de_direccion, '@', 2)) = lower(split_part(i.destinatario, '@', 2)))
        OR (m.automatico AND (position(lower(i.destinatario) IN lower(left(m.texto, 20000))) > 0 OR position(lower(i.destinatario) IN lower(m.asunto)) > 0))
         )
   ORDER BY m.creado_at ASC, i.id ASC
   LIMIT 2000
$$;

CREATE OR REPLACE FUNCTION public.correo_secuencia_entrantes_de(p_buzon UUID, p_desde TIMESTAMPTZ, p_hilo UUID, p_direccion TEXT, p_dominio TEXT)
RETURNS TABLE (id UUID, hilo_id UUID, de_direccion TEXT, asunto TEXT, texto TEXT, fecha TIMESTAMPTZ, automatico BOOLEAN)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m.hilo_id, m.de_direccion, m.asunto, left(m.texto, 8000), m.fecha, m.automatico
    FROM public.correo_mensajes m
   WHERE m.buzon_id = p_buzon
     AND m.direccion = 'entrante'
     AND m.creado_at >= p_desde
     AND (
           (p_hilo IS NOT NULL AND m.hilo_id = p_hilo)
        OR lower(m.de_direccion) = lower(p_direccion)
        OR (coalesce(p_dominio, '') <> '' AND lower(split_part(m.de_direccion, '@', 2)) = lower(p_dominio))
        OR (m.automatico AND (position(lower(p_direccion) IN lower(left(m.texto, 20000))) > 0 OR position(lower(p_direccion) IN lower(m.asunto)) > 0))
         )
   ORDER BY m.fecha ASC
   LIMIT 200
$$;

COMMENT ON FUNCTION public.correo_secuencia_vigilar(TIMESTAMPTZ, TEXT[]) IS
  'Parejas mensaje entrante nuevo / secuencia viva del mismo buzon que pueden tener que ver (su hilo, el destinatario o su empresa, avisos automaticos que lo nombran). La usa la vigilancia del motor de secuencias. Solo la usa el servidor.';
COMMENT ON FUNCTION public.correo_secuencia_entrantes_de(UUID, TIMESTAMPTZ, UUID, TEXT, TEXT) IS
  'Correos entrantes de un buzon que pueden tener que ver con un destinatario (su hilo, el o su empresa, y los avisos automaticos que nombran su direccion). Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_vigilar(TIMESTAMPTZ, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_vigilar(TIMESTAMPTZ, TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION public.correo_secuencia_entrantes_de(UUID, TIMESTAMPTZ, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_entrantes_de(UUID, TIMESTAMPTZ, UUID, TEXT, TEXT) TO service_role;


-- ---------- Lo que ha salido de cada buzón, por día y por hora ----------
--
-- Alimenta tres cosas: cuánto cabe todavía en un día según la rampa (los que escribe la persona a mano y los automáticos cuentan igual),
-- cuántos correos a mano suele mandar cada buzón (para dejarles sitio en los días que vienen) y la franja de «a mano» de la pantalla de Hoy.
-- `automaticos` son los que salieron de una secuencia (su Message-ID está en un paso enviado). Día y hora, en hora de Madrid.
CREATE OR REPLACE FUNCTION public.correo_secuencia_salientes_por_hora(p_desde TIMESTAMPTZ, p_buzones UUID[] DEFAULT NULL)
RETURNS TABLE (buzon_id UUID, dia DATE, hora INTEGER, total INTEGER, automaticos INTEGER)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.buzon_id,
         (m.fecha AT TIME ZONE 'Europe/Madrid')::date AS dia,
         EXTRACT(HOUR FROM (m.fecha AT TIME ZONE 'Europe/Madrid'))::integer AS hora,
         count(*)::integer AS total,
         count(p.id)::integer AS automaticos
    FROM public.correo_mensajes m
    LEFT JOIN public.correo_secuencia_pasos p
           ON p.message_id = m.message_id AND p.estado = 'enviado' AND p.orden > 0
   WHERE m.direccion = 'saliente'
     AND m.fecha >= p_desde
     AND (p_buzones IS NULL OR m.buzon_id = ANY (p_buzones))
   GROUP BY m.buzon_id, 2, 3
$$;

COMMENT ON FUNCTION public.correo_secuencia_salientes_por_hora(TIMESTAMPTZ, UUID[]) IS
  'Correos salientes por buzon, dia y hora (hora de Madrid) desde p_desde, y cuantos de ellos salieron de una secuencia. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_salientes_por_hora(TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_salientes_por_hora(TIMESTAMPTZ, UUID[]) TO service_role;


-- ---------- La salud de cada buzón: cuánto envía y cuánto le rebota ----------
--
-- Es lo que mira el FRENO: si en las últimas horas rebota más de lo normal, el buzón se pausa solo. Un rebote es el aviso de un servidor de
-- correo ('mailer-daemon', 'postmaster'…) con un código 5.x.x o diciendo que la dirección no existe; un fallo pasajero (buzón lleno) no cuenta.
CREATE OR REPLACE FUNCTION public.correo_secuencia_salud_buzones(p_desde TIMESTAMPTZ)
RETURNS TABLE (buzon_id UUID, enviados INTEGER, rebotes INTEGER)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT b.id AS buzon_id,
         (SELECT count(*) FROM public.correo_mensajes m
           WHERE m.buzon_id = b.id AND m.direccion = 'saliente' AND m.fecha >= p_desde)::integer AS enviados,
         (SELECT count(*) FROM public.correo_mensajes m
           WHERE m.buzon_id = b.id AND m.direccion = 'entrante' AND m.automatico AND m.creado_at >= p_desde
             AND m.de_direccion ~* '^(mailer-daemon|postmaster|mail-daemon|maildelivery)'
             AND (m.texto ~ '\m5\.[0-9]{1,3}\.[0-9]{1,3}\M'
                  OR m.texto ~* '(user unknown|no such user|does not exist|no existe|address rejected|recipient rejected|usuario desconocido)'))::integer AS rebotes
    FROM public.correo_buzones b
$$;

COMMENT ON FUNCTION public.correo_secuencia_salud_buzones(TIMESTAMPTZ) IS
  'Por buzon: correos enviados y rebotes duros recibidos desde p_desde. La mira el freno del motor de secuencias. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_salud_buzones(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_salud_buzones(TIMESTAMPTZ) TO service_role;


-- ---------- El resumen del flujo (para la pantalla de Secuencias) ----------
--
-- UN valor JSON y no una tabla: una tabla con miles de filas toparía con el máximo de filas por petición de la API. Cuenta las secuencias
-- que EMPEZARON desde p_desde: cuántas, en qué estado están, por qué se cortaron, cuántos correos salieron en cada paso y tras qué correo
-- contestó cada lead que contestó (0 = ya con el primero).
CREATE OR REPLACE FUNCTION public.correo_secuencia_resumen(p_desde TIMESTAMPTZ, p_buzones UUID[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH ins AS (
    SELECT i.id, i.estado, i.codigo, i.parada_at
      FROM public.correo_secuencia_inscripciones i
     WHERE i.creada_at >= p_desde
       AND (p_buzones IS NULL OR i.buzon_id = ANY (p_buzones))
  ),
  por_estado AS (
    SELECT estado, count(*)::integer AS n FROM ins GROUP BY estado
  ),
  por_codigo AS (
    SELECT codigo, count(*)::integer AS n FROM ins WHERE codigo IS NOT NULL AND estado NOT IN ('activa', 'pausada') GROUP BY codigo
  ),
  enviados AS (
    SELECT p.orden, count(*)::integer AS n
      FROM public.correo_secuencia_pasos p
      JOIN ins ON ins.id = p.inscripcion_id
     WHERE p.estado = 'enviado'
     GROUP BY p.orden
  ),
  respuestas AS (
    SELECT t.orden, count(*)::integer AS n
      FROM (
        SELECT COALESCE((SELECT max(p.orden)
                           FROM public.correo_secuencia_pasos p
                          WHERE p.inscripcion_id = ins.id AND p.estado = 'enviado' AND p.enviado_at <= COALESCE(ins.parada_at, NOW())), 0) AS orden
          FROM ins
         WHERE ins.estado = 'respondida'
      ) t
     GROUP BY t.orden
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM ins),
    'por_estado', COALESCE((SELECT jsonb_object_agg(estado, n) FROM por_estado), '{}'::jsonb),
    'por_codigo', COALESCE((SELECT jsonb_object_agg(codigo, n) FROM por_codigo), '{}'::jsonb),
    'enviados', COALESCE((SELECT jsonb_object_agg(orden::text, n) FROM enviados), '{}'::jsonb),
    'respuestas', COALESCE((SELECT jsonb_object_agg(orden::text, n) FROM respuestas), '{}'::jsonb)
  )
$$;

COMMENT ON FUNCTION public.correo_secuencia_resumen(TIMESTAMPTZ, UUID[]) IS
  'Resumen del flujo de secuencias iniciadas desde p_desde: total, por estado, por motivo de corte, correos enviados por paso y respuestas por paso. Solo la usa el servidor.';

REVOKE ALL ON FUNCTION public.correo_secuencia_resumen(TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_secuencia_resumen(TIMESTAMPTZ, UUID[]) TO service_role;


-- ---------- Comprobación ----------
DO $$
DECLARE
  abierta_al_navegador BOOLEAN;
BEGIN
  IF (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('correo_secuencia_ajustes', 'correo_secuencia_buzones', 'correo_secuencias', 'correo_secuencia_inscripciones', 'correo_secuencia_pasos', 'correo_secuencia_eventos', 'correo_direcciones_malas')) <> 7 THEN
    RAISE EXCEPTION 'Faltan tablas de las secuencias de correo.';
  END IF;

  IF (SELECT count(*) FROM public.correo_secuencia_ajustes) <> 1 THEN
    RAISE EXCEPTION 'Los ajustes de las secuencias tienen que ser una sola fila.';
  END IF;
  IF (SELECT count(*) FROM public.correo_secuencias WHERE es_base) <> 1 THEN
    RAISE EXCEPTION 'Tiene que haber exactamente una secuencia base.';
  END IF;

  -- Lo que no puede pasar: que algo de aquí se pueda leer o escribir desde el navegador
  SELECT bool_or(has_table_privilege(r, 'public.' || t, 'SELECT') OR has_table_privilege(r, 'public.' || t, 'INSERT') OR has_table_privilege(r, 'public.' || t, 'UPDATE') OR has_table_privilege(r, 'public.' || t, 'DELETE'))
         OR has_function_privilege('authenticated', 'public.correo_secuencia_reclamar_pasos(timestamptz, integer, integer)', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_purgar(integer)', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_salientes_por_hora(timestamptz, uuid[])', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_salud_buzones(timestamptz)', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_resumen(timestamptz, uuid[])', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_vigilar(timestamptz, text[])', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_rebotes(timestamptz, integer)', 'EXECUTE')
         OR has_function_privilege('authenticated', 'public.correo_secuencia_entrantes_de(uuid, timestamptz, uuid, text, text)', 'EXECUTE')
    INTO abierta_al_navegador
    FROM unnest(ARRAY['anon', 'authenticated']) AS r,
         unnest(ARRAY['correo_secuencia_ajustes', 'correo_secuencia_buzones', 'correo_secuencias', 'correo_secuencia_inscripciones', 'correo_secuencia_pasos', 'correo_secuencia_eventos', 'correo_direcciones_malas']) AS t;
  IF abierta_al_navegador THEN
    RAISE EXCEPTION 'Las secuencias de correo quedan abiertas al navegador: NO se deja asi.';
  END IF;

  RAISE NOTICE 'Secuencias de correo listas, APAGADAS y en ensayo. Enciendelas desde Correo > Secuencias > Ajustes: primero un dia de ensayo (decide pero no envia) y luego el envio real. Buzones registrados: %.',
    (SELECT count(*) FROM public.correo_secuencia_buzones);
END $$;

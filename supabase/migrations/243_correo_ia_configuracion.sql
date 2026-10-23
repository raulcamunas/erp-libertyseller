-- ============================================================================
-- 243 · CONFIGURACIÓN DE CORREOS: VERSIONES DE LA IA, EJEMPLOS PROPIOS Y MEDICIÓN
-- ============================================================================
--
-- Mi rendimiento → «Configuración de correos». Ahí quien supervisa al equipo comercial (Jhanna) afina el correo que escribe la IA y mide
-- cuál convierte más:
--
--   · `correo_ia_versiones`  Una VERSIÓN es un juego completo: las instrucciones de la IA (partidas en secciones), los ejemplos que se le
--                            enseñan, si además aprende de los correos del equipo que obtuvieron respuesta y, si se quiere, el modelo. Cada
--                            versión lleva un PESO: cada vez que un comercial pide un borrador se sortea una versión en proporción al
--                            peso, y el borrador queda apuntado con ella. Así se envían versiones distintas a leads parecidos y se mide
--                            cuál recibe más respuestas. La versión «original» (es_base) es la de siempre y no se edita: es el punto de
--                            comparación. Una versión que ya se ha usado tampoco se edita (se duplica): si se cambiara el texto a mitad,
--                            las respuestas de antes y de después se mezclarían bajo el mismo nombre.
--   · `correo_ia_ejemplos`   Los correos de ejemplo que escribe la supervisora: los «textos ganadores» candidatos. Una versión elige cuáles
--                            se le enseñan a la IA.
--   · `correo_ia_borradores.version_id`  La versión que escribió cada borrador (la tabla es de la migración 242).
--   · `correo_frios_resumen` Cuántos correos fríos se han enviado desde los buzones sin pasar por la IA y a cuántos contestó alguien: el
--                            punto de comparación «a mano» de la pantalla de resultados.
--
-- CERRADAS al navegador, como todas las de correo: sin políticas y con los permisos quitados. Las lee y las escribe solo el servidor
-- (app/api/correo/laboratorio/*), que comprueba el permiso «Configuración de correos».
--
-- Hace falta haber lanzado antes la 236 (correo) y la 242 (borradores). Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE.
-- El código funciona SIN esta migración: la IA redacta con las instrucciones de siempre y la pantalla avisa de que falta lanzarla.
-- ============================================================================

-- ---------- Los correos de ejemplo de la supervisora ----------
CREATE TABLE IF NOT EXISTS public.correo_ia_ejemplos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  titulo TEXT NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 80),
  asunto TEXT NOT NULL CHECK (length(btrim(asunto)) BETWEEN 1 AND 150),
  texto TEXT NOT NULL CHECK (length(btrim(texto)) BETWEEN 120 AND 4000),
  -- Para qué clase de lead sirve: una empresa que todavía no vende en Amazon (entrar), una que ya vende (optimizar) o las dos
  tipo TEXT NOT NULL DEFAULT 'ambos' CHECK (tipo IN ('entrar', 'optimizar', 'ambos')),
  nota TEXT CHECK (nota IS NULL OR length(nota) <= 500),
  activo BOOLEAN NOT NULL DEFAULT true,

  creado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.correo_ia_ejemplos IS
  'Correos de ejemplo escritos por quien supervisa al equipo comercial, para ensenar a la IA. Cerrada al navegador: la lee y la escribe solo el servidor.';

ALTER TABLE public.correo_ia_ejemplos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_ia_ejemplos FROM anon, authenticated;


-- ---------- Las versiones de la IA ----------
CREATE TABLE IF NOT EXISTS public.correo_ia_versiones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  nombre TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  notas TEXT CHECK (notas IS NULL OR length(notas) <= 1000),

  -- Las instrucciones editables: {queHacemos, comoEscribes, comoPersuades, segunElCaso, extra}. Las REGLAS FIJAS («nada de facturación»…) no
  -- están aquí: viven en el código y se añaden siempre
  secciones JSONB NOT NULL,
  -- Los ejemplos propios (correo_ia_ejemplos) que se le enseñan. No es una clave foránea (una columna de listas no puede serlo): un ejemplo
  -- borrado simplemente deja de salir
  ejemplos_ids UUID[] NOT NULL DEFAULT '{}',
  -- Además de los propios, aprende de los correos del equipo que consiguieron respuesta
  usar_ganadores BOOLEAN NOT NULL DEFAULT true,
  -- NULL = el modelo de siempre
  modelo TEXT CHECK (modelo IS NULL OR modelo ~ '^[a-z0-9][a-z0-9._-]{1,39}$'),

  -- El reparto: entre las versiones en marcha (activa, no archivada, peso > 0) se sortea en proporción al peso
  peso INTEGER NOT NULL DEFAULT 0 CHECK (peso BETWEEN 0 AND 100),
  activa BOOLEAN NOT NULL DEFAULT false,
  es_base BOOLEAN NOT NULL DEFAULT false,
  archivada BOOLEAN NOT NULL DEFAULT false,

  creada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo puede haber UNA versión original
CREATE UNIQUE INDEX IF NOT EXISTS correo_ia_versiones_una_base
  ON public.correo_ia_versiones (es_base)
  WHERE es_base;

COMMENT ON TABLE public.correo_ia_versiones IS
  'Versiones de la IA que redacta correos a leads: instrucciones por secciones, ejemplos, modelo y peso del reparto. Cada borrador queda apuntado con la version que lo escribio. Cerrada al navegador: la lee y la escribe solo el servidor.';

ALTER TABLE public.correo_ia_versiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.correo_ia_versiones FROM anon, authenticated;


-- ---------- Cada borrador, con la versión que lo escribió ----------
ALTER TABLE public.correo_ia_borradores
  ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES public.correo_ia_versiones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS correo_ia_borradores_version_idx
  ON public.correo_ia_borradores (version_id)
  WHERE version_id IS NOT NULL;


-- ---------- Correos fríos enviados sin pasar por la IA (el punto de comparación) ----------
--
-- Un correo FRÍO es una conversación que EMPIEZA con un correo escrito por una persona del equipo (de un dominio de los buzones). Esta función
-- cuenta los de los últimos días y a cuáles ha entrado después algún correo no automático (el servidor decide luego cuáles eran de una
-- persona de fuera y cuáles un «no»: aquí solo se afina lo grueso para no traer miles de correos). `p_excluir` son las conversaciones que
-- vienen de un borrador de la IA, para que no cuenten dos veces.
--
-- Devuelve UN valor JSON: {"total": N, "con_entrantes": [{"hilo_id", "enviado_at", "entrantes"}]}. Un solo valor y no una tabla: una tabla con
-- miles de filas toparía con el máximo de filas por petición de la API.
CREATE INDEX IF NOT EXISTS correo_mensajes_salientes_fecha_idx
  ON public.correo_mensajes (fecha)
  WHERE direccion = 'saliente';

CREATE OR REPLACE FUNCTION public.correo_frios_resumen(p_desde TIMESTAMPTZ, p_excluir UUID[] DEFAULT '{}')
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH propios AS (
    SELECT DISTINCT lower(split_part(direccion, '@', 2)) AS dominio FROM public.correo_buzones
  ),
  candidatos AS (
    SELECT DISTINCT hilo_id FROM public.correo_mensajes WHERE direccion = 'saliente' AND fecha >= p_desde
  ),
  primeros AS (
    SELECT DISTINCT ON (m.hilo_id) m.hilo_id, m.direccion, m.fecha, m.automatico, m.de_direccion
      FROM public.correo_mensajes m
      JOIN candidatos c ON c.hilo_id = m.hilo_id
     ORDER BY m.hilo_id, m.fecha ASC, m.creado_at ASC
  ),
  frios AS (
    SELECT p.hilo_id, p.fecha AS enviado_at
      FROM primeros p
     WHERE p.direccion = 'saliente'
       AND NOT p.automatico
       AND p.fecha >= p_desde
       AND lower(split_part(p.de_direccion, '@', 2)) IN (SELECT dominio FROM propios)
       AND p.hilo_id <> ALL (p_excluir)
  ),
  con_entrantes AS (
    SELECT f.hilo_id, f.enviado_at, count(r.id) AS entrantes
      FROM frios f
      JOIN public.correo_mensajes r
        ON r.hilo_id = f.hilo_id
       AND r.direccion = 'entrante'
       AND NOT r.automatico
       AND r.fecha > f.enviado_at
     GROUP BY f.hilo_id, f.enviado_at
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM frios),
    'con_entrantes', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('hilo_id', hilo_id, 'enviado_at', enviado_at, 'entrantes', entrantes)) FROM con_entrantes),
      '[]'::jsonb
    )
  )
$$;

REVOKE ALL ON FUNCTION public.correo_frios_resumen(TIMESTAMPTZ, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correo_frios_resumen(TIMESTAMPTZ, UUID[]) TO service_role;

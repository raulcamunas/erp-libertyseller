-- ============================================================================
-- 284 · CHAT DEL EQUIPO (canales, chats privados y mensajes directos)
-- ============================================================================
--
-- Una aplicación aparte («Chat», en Herramientas Agencia) para hablar dentro del ERP: canales abiertos (cualquiera con acceso al chat puede entrar), canales privados (solo los
-- miembros) y mensajes directos entre dos personas. Lo ve un administrador y quien tenga la casilla «Chat» en Gestión de Usuarios (`puede_ver_chat()`).
--
-- PRIVACIDAD: nadie lee desde el navegador las tablas de aquí (RLS activado y SIN políticas: solo el servidor, con la clave de servicio, que comprueba quién es miembro de qué).
-- Ni los administradores ven los mensajes directos ni los canales privados de otros.
--
-- TIEMPO REAL SIN CARGAR LA BASE: el servidor guarda el mensaje (una escritura pequeña) y lo reparte por Realtime Broadcast, que viaja por memoria y no toca el disco. Cada persona
-- escucha UN solo canal privado propio, `chat:<su id>`, donde le llega todo lo suyo, y un canal de presencia compartido (`chat-presencia`: quién está conectado y quién escribe).
-- Las dos políticas de `realtime.messages` de abajo lo permiten; sin ellas la aplicación funciona igual pero sin avisos en directo.
--
-- Hace falta la 275 solo para el enlace opcional canal ↔ cliente (`tc_clientes`). IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada.
-- Se lanza A MANO en el editor SQL de Supabase.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE EXCEPTION 'No existe realtime.messages: este proyecto de Supabase no tiene los canales privados de Realtime. Avísame y lo miramos.';
  END IF;
  IF to_regclass('public.tc_clientes') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla tc_clientes: lanza antes la migración 275_tareas_de_clientes.sql.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. Quién puede entrar al chat
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.puede_ver_chat()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR EXISTS (SELECT 1 FROM public.user_app_permissions u WHERE u.user_id = auth.uid() AND u.app_id = 'chat' AND u.can_access);
$$;


-- ---------------------------------------------------------------------------
-- 2. Los canales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_canales (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- canal: abierto a todo el que tenga el chat · privado: solo sus miembros · directo: dos personas
  tipo              TEXT NOT NULL CHECK (tipo IN ('canal', 'privado', 'directo')),
  nombre            TEXT,
  descripcion       TEXT NOT NULL DEFAULT '',
  -- Solo en los directos: los dos ids ordenados («a:b»), para no crear dos conversaciones entre las mismas personas
  dm_clave          TEXT UNIQUE,
  -- Un canal puede colgar de un cliente de Tareas de clientes
  cliente_id        UUID REFERENCES public.tc_clientes(id) ON DELETE SET NULL,
  -- Todas las personas con chat entran solas la primera vez que lo abren (el canal #general)
  auto_unirse       BOOLEAN NOT NULL DEFAULT false,
  creado_por        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  archivado         BOOLEAN NOT NULL DEFAULT false,
  ultimo_mensaje_en TIMESTAMPTZ,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_canales_nombre CHECK ((tipo = 'directo' AND nombre IS NULL) OR (tipo <> 'directo' AND length(btrim(coalesce(nombre, ''))) > 0)),
  CONSTRAINT chat_canales_directo CHECK ((tipo = 'directo') = (dm_clave IS NOT NULL))
);

-- Dos canales no se pueden llamar igual (sin mirar mayúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS chat_canales_nombre_uq ON public.chat_canales (lower(nombre)) WHERE tipo <> 'directo';
CREATE INDEX IF NOT EXISTS chat_canales_cliente_idx ON public.chat_canales (cliente_id) WHERE cliente_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. Quién está en cada canal y hasta dónde ha leído
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_miembros (
  canal_id        UUID NOT NULL REFERENCES public.chat_canales(id) ON DELETE CASCADE,
  usuario_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rol             TEXT NOT NULL DEFAULT 'miembro' CHECK (rol IN ('admin', 'miembro')),
  ultimo_leido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  silenciado      BOOLEAN NOT NULL DEFAULT false,
  unido_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (canal_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS chat_miembros_usuario_idx ON public.chat_miembros (usuario_id);


-- ---------------------------------------------------------------------------
-- 4. Los mensajes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_mensajes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canal_id    UUID NOT NULL REFERENCES public.chat_canales(id) ON DELETE CASCADE,
  autor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cuerpo      TEXT NOT NULL DEFAULT '' CHECK (length(cuerpo) <= 8000),
  -- Si es la respuesta de un hilo, el mensaje al que responde
  hilo_de     BIGINT REFERENCES public.chat_mensajes(id) ON DELETE CASCADE,
  -- A quién menciona con @ (ids de perfil)
  menciones   UUID[] NOT NULL DEFAULT '{}',
  -- Archivos e imágenes: [{nombre, url, tipo, tamano}]
  adjuntos    JSONB NOT NULL DEFAULT '[]'::jsonb,
  editado_en  TIMESTAMPTZ,
  -- Borrar no quita la fila: queda «mensaje eliminado» para que el hilo no se rompa
  borrado_en  TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_mensajes_canal_idx  ON public.chat_mensajes (canal_id, id DESC);
CREATE INDEX IF NOT EXISTS chat_mensajes_fecha_idx  ON public.chat_mensajes (canal_id, creado_en);
CREATE INDEX IF NOT EXISTS chat_mensajes_hilo_idx   ON public.chat_mensajes (hilo_de, id) WHERE hilo_de IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 5. Las reacciones con emoji
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_reacciones (
  mensaje_id  BIGINT NOT NULL REFERENCES public.chat_mensajes(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mensaje_id, usuario_id, emoji)
);


-- ---------------------------------------------------------------------------
-- 6. Cerradas al navegador: solo el servidor las lee y las escribe
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_canales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_miembros    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_mensajes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reacciones  ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- 7. Lo que no has leído en cada canal (hasta 100 por canal: no hace falta contar más)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_resumen(p_usuario UUID)
RETURNS TABLE (canal_id UUID, no_leidos INTEGER, menciones INTEGER)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.canal_id,
    (SELECT count(*)::INTEGER FROM (
       SELECT 1 FROM public.chat_mensajes x
       WHERE x.canal_id = m.canal_id AND x.creado_en > m.ultimo_leido_en AND x.borrado_en IS NULL AND x.autor_id IS DISTINCT FROM p_usuario
       LIMIT 100) q),
    (SELECT count(*)::INTEGER FROM (
       SELECT 1 FROM public.chat_mensajes x
       WHERE x.canal_id = m.canal_id AND x.creado_en > m.ultimo_leido_en AND x.borrado_en IS NULL AND p_usuario = ANY (x.menciones)
       LIMIT 100) q)
  FROM public.chat_miembros m
  WHERE m.usuario_id = p_usuario;
$$;

-- La función pregunta por quien le digas: que no la pueda llamar nadie desde el navegador
REVOKE ALL ON FUNCTION public.chat_resumen(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_resumen(UUID) TO service_role;


-- ---------------------------------------------------------------------------
-- 8. Tiempo real: el canal propio de cada persona y el de presencia
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS chat_propio_leer ON realtime.messages;
CREATE POLICY chat_propio_leer ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'chat:' || auth.uid()::text AND public.puede_ver_chat());

DROP POLICY IF EXISTS chat_presencia_leer ON realtime.messages;
CREATE POLICY chat_presencia_leer ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'chat-presencia' AND public.puede_ver_chat());

DROP POLICY IF EXISTS chat_presencia_escribir ON realtime.messages;
CREATE POLICY chat_presencia_escribir ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (realtime.topic() = 'chat-presencia' AND public.puede_ver_chat());


-- ---------------------------------------------------------------------------
-- 9. El canal #general, al que entran todos
-- ---------------------------------------------------------------------------
INSERT INTO public.chat_canales (tipo, nombre, descripcion, auto_unirse)
SELECT 'canal', 'general', 'Todo el equipo. Avisos y charla del día a día.', true
WHERE NOT EXISTS (SELECT 1 FROM public.chat_canales WHERE tipo <> 'directo' AND lower(nombre) = 'general');


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las cuatro columnas tienen que decir «true».
SELECT
  (SELECT count(*) = 4 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('chat_canales', 'chat_miembros', 'chat_mensajes', 'chat_reacciones'))
    AS tiene_las_cuatro_tablas,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('chat_canales', 'chat_miembros', 'chat_mensajes', 'chat_reacciones'))
    AS cerradas_al_navegador,
  (SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
    AND policyname IN ('chat_propio_leer', 'chat_presencia_leer', 'chat_presencia_escribir'))
    AS con_tiempo_real,
  (SELECT count(*) >= 1 FROM public.chat_canales WHERE lower(nombre) = 'general')
    AS con_el_canal_general;

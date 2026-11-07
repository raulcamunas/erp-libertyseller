-- ============================================================================
-- 275 · TAREAS DE CLIENTES (la réplica mejorada del Notion «Tareas Clientes», conectada con él)
-- ============================================================================
--
-- Un cliente tiene tareas; cada tarea tiene estado, departamento, responsables, fechas, una checklist y un cuerpo con bloques; y se comenta. Todo vive aquí y se
-- sincroniza con las bases de Notion (una por cliente) en los dos sentidos.
--
-- TODAS LAS TABLAS LLEVAN EL PREFIJO `tc_`. NO toca las tablas viejas `client_canvas`, `client_tasks` y `task_comments` (migraciones 035 y 036, sin ninguna tarea).
--
-- QUIÉN VE QUÉ. Las tablas se pueden LEER desde el navegador solo con `puede_ver_tareas_clientes()`: administradores (rol `admin`, NO `partner`: un partner puede ser un
-- cliente) y quien tenga la casilla «Tareas de clientes» en Gestión de Usuarios. NADIE escribe desde el navegador: cada cambio pasa por el servidor, que lo apunta en
-- el historial, avisa a la campana y lo manda a Notion. Las tablas de la sincronización (`tc_notion_*`, `tc_personas`) están cerradas al navegador.
--
-- SIN REALTIME A PROPÓSITO (la 265 lo quitó de casi todo por el disco): la pantalla se relee sola al volver a la pestaña y cada pocos segundos.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Quién puede ver las tareas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.puede_ver_tareas_clientes()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR EXISTS (SELECT 1 FROM public.user_app_permissions u WHERE u.user_id = auth.uid() AND u.app_id = 'tareas-clientes' AND u.can_access);
$$;

CREATE OR REPLACE FUNCTION public.tc_toca_actualizado()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Los clientes (una base de Notion cada uno)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_clientes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre          TEXT NOT NULL,
  icono           TEXT,
  color           TEXT NOT NULL DEFAULT 'naranja',
  grupo           TEXT NOT NULL DEFAULT 'agencia' CHECK (grupo IN ('agencia', 'marcas_eeuu', 'otros')),
  orden           INTEGER NOT NULL DEFAULT 0,
  descripcion     TEXT,
  -- Portada y fondo: {tipo: 'color' | 'degradado' | 'imagen', valor: '...', y: 0-100}
  portada         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fondo           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Estados y departamentos con su color, tal como los tiene esa base de Notion: {estados: [{nombre, color, grupo}], departamentos: [{nombre, color}]}
  opciones        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Qué columna de Notion es cada cosa en ESA base (cada una se llama distinto): {titulo: {nombre, tipo}, estado: {...}, ...}
  notion_esquema  JSONB NOT NULL DEFAULT '{}'::jsonb,
  notion_db_id    TEXT UNIQUE,
  notion_ds_id    TEXT,
  notion_url      TEXT,
  -- Con qué cliente del ERP se corresponde (clients, treasury_clients, crm_clients…): se rellena al confirmarlo
  vinculos        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Para el panel del cliente de más adelante: nada se enseña a un cliente que no esté marcado
  visible_cliente BOOLEAN NOT NULL DEFAULT false,
  activo          BOOLEAN NOT NULL DEFAULT true,
  sync_ultima     TIMESTAMPTZ,
  sync_error      TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- 3. Las tareas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_tareas (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id         UUID NOT NULL REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  titulo             TEXT NOT NULL DEFAULT '',
  icono              TEXT,
  -- El color de su tarjeta en el tablero (un nombre de la paleta); vacío = el de su columna
  color              TEXT,
  portada            JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado             TEXT NOT NULL DEFAULT 'Backlog',
  departamento       TEXT,
  etiquetas          TEXT[] NOT NULL DEFAULT '{}',
  fecha_inicio       TIMESTAMPTZ,
  fecha_fin          TIMESTAMPTZ,
  -- true si la fecha lleva hora (en Notion una fecha puede ser solo día)
  fecha_con_hora     BOOLEAN NOT NULL DEFAULT false,
  progreso           INTEGER NOT NULL DEFAULT 0 CHECK (progreso BETWEEN 0 AND 100),
  url                TEXT,
  -- Las personas del ERP asignadas, y lo que Notion dice de las que aún no están enlazadas: [{id, nombre}]
  responsables       UUID[] NOT NULL DEFAULT '{}',
  responsables_notion JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- El sitio dentro de su columna: un número que admite meter uno entre otros dos sin reescribir los demás
  orden              DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- El cuerpo: una lista de bloques [{id, tipo, texto, ...}] (lib/tareas-clientes/bloques.ts). Lo que el editor no sabe pintar viaja en bloques `notion` intactos
  contenido          JSONB NOT NULL DEFAULT '[]'::jsonb,
  contenido_texto    TEXT NOT NULL DEFAULT '',
  checklist_total    INTEGER NOT NULL DEFAULT 0,
  checklist_hecho    INTEGER NOT NULL DEFAULT 0,
  -- Cuántos comentarios lleva (lo cuenta el servidor al escribir uno), para pintarlo en la tarjeta sin pedirlos todos
  comentarios        INTEGER NOT NULL DEFAULT 0,
  visible_cliente    BOOLEAN NOT NULL DEFAULT false,
  archivada          BOOLEAN NOT NULL DEFAULT false,
  origen             TEXT NOT NULL DEFAULT 'erp' CHECK (origen IN ('erp', 'notion')),
  -- La sincronización
  notion_page_id     TEXT UNIQUE,
  notion_url         TEXT,
  notion_editado     TIMESTAMPTZ,
  notion_contenido_hash TEXT,
  -- Cuándo se miró por última vez el cuerpo y los comentarios de esta página en Notion (vacío = todavía no): la sincronización los va trayendo por tandas
  notion_contenido_revisado   TIMESTAMPTZ,
  notion_comentarios_revisados TIMESTAMPTZ,
  sync_estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (sync_estado IN ('ok', 'pendiente', 'error', 'solo_erp')),
  sync_error         TEXT,
  creado_por         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actualizado_por    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_tareas_cliente_estado ON public.tc_tareas (cliente_id, estado, orden);
CREATE INDEX IF NOT EXISTS idx_tc_tareas_fecha          ON public.tc_tareas (fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_tc_tareas_responsables   ON public.tc_tareas USING GIN (responsables);
CREATE INDEX IF NOT EXISTS idx_tc_tareas_pendientes     ON public.tc_tareas (sync_estado) WHERE sync_estado <> 'ok';


-- ---------------------------------------------------------------------------
-- 4. Los comentarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_comentarios (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tarea_id             UUID NOT NULL REFERENCES public.tc_tareas(id) ON DELETE CASCADE,
  -- Quien lo escribe en el ERP; vacío si viene de Notion (entonces `autor_nombre` dice quién)
  autor_id             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  autor_nombre         TEXT NOT NULL DEFAULT '',
  cuerpo               TEXT NOT NULL,
  menciones            UUID[] NOT NULL DEFAULT '{}',
  origen               TEXT NOT NULL DEFAULT 'erp' CHECK (origen IN ('erp', 'notion')),
  visible_cliente      BOOLEAN NOT NULL DEFAULT false,
  notion_comment_id    TEXT UNIQUE,
  notion_discussion_id TEXT,
  editado_en           TIMESTAMPTZ,
  borrado              BOOLEAN NOT NULL DEFAULT false,
  creado_en            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_comentarios_tarea ON public.tc_comentarios (tarea_id, creado_en);


-- ---------------------------------------------------------------------------
-- 5. El historial de cada tarea, que es también la cola de avisos
--    (la campana lo lee hoy; Slack y el panel del cliente lo leerán mañana sin tocar nada de lo anterior)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_actividad (
  id            BIGSERIAL PRIMARY KEY,
  tarea_id      UUID REFERENCES public.tc_tareas(id) ON DELETE CASCADE,
  cliente_id    UUID REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_nombre  TEXT NOT NULL DEFAULT '',
  tipo          TEXT NOT NULL,
  datos         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- A dónde ha llegado ya el aviso: {campana: true, slack: true}
  avisado       JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tc_actividad_tarea   ON public.tc_actividad (tarea_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_tc_actividad_cliente ON public.tc_actividad (cliente_id, creado_en DESC);


-- ---------------------------------------------------------------------------
-- 6. Vistas guardadas y preferencias de cada persona
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tc_vistas (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Vacío = la vista «Todas», que mezcla a todos los clientes
  cliente_id     UUID REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  -- Vacío = vista compartida con todo el equipo
  usuario_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'tablero' CHECK (tipo IN ('tablero', 'tabla', 'cronograma', 'calendario')),
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  orden          INTEGER NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tc_preferencias (
  usuario_id     UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Su fondo y su portada de la pantalla de inicio
  fondo          JSONB NOT NULL DEFAULT '{}'::jsonb,
  portada        JSONB NOT NULL DEFAULT '{}'::jsonb,
  favoritos      UUID[] NOT NULL DEFAULT '{}',
  barra          JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- 7. La sincronización con Notion (cerrada al navegador)
-- ---------------------------------------------------------------------------
-- Lo que hay que mandar a Notion y todavía no ha salido, o ha fallado: se reintenta solo con espera creciente
CREATE TABLE IF NOT EXISTS public.tc_notion_cola (
  id               BIGSERIAL PRIMARY KEY,
  tarea_id         UUID REFERENCES public.tc_tareas(id) ON DELETE CASCADE,
  cliente_id       UUID REFERENCES public.tc_clientes(id) ON DELETE CASCADE,
  operacion        TEXT NOT NULL CHECK (operacion IN ('crear', 'propiedades', 'contenido', 'archivar', 'comentar')),
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  intentos         INTEGER NOT NULL DEFAULT 0,
  proximo_intento  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error            TEXT,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hecho_en         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tc_notion_cola_pendiente ON public.tc_notion_cola (proximo_intento) WHERE hecho_en IS NULL;

-- Los avisos de Notion ya vistos: Notion puede mandar el mismo dos veces
CREATE TABLE IF NOT EXISTS public.tc_notion_eventos (
  id             TEXT PRIMARY KEY,
  tipo           TEXT,
  recibido_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_en   TIMESTAMPTZ
);

-- Qué persona de Notion es cada persona del ERP
CREATE TABLE IF NOT EXISTS public.tc_personas (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id        UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  notion_user_id   TEXT UNIQUE,
  notion_nombre    TEXT,
  confirmada       BOOLEAN NOT NULL DEFAULT false,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- 8. updated_at automático
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_tc_clientes_actualizado ON public.tc_clientes;
CREATE TRIGGER trg_tc_clientes_actualizado BEFORE UPDATE ON public.tc_clientes FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();

DROP TRIGGER IF EXISTS trg_tc_tareas_actualizado ON public.tc_tareas;
CREATE TRIGGER trg_tc_tareas_actualizado BEFORE UPDATE ON public.tc_tareas FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();

DROP TRIGGER IF EXISTS trg_tc_comentarios_actualizado ON public.tc_comentarios;
CREATE TRIGGER trg_tc_comentarios_actualizado BEFORE UPDATE ON public.tc_comentarios FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();

DROP TRIGGER IF EXISTS trg_tc_vistas_actualizado ON public.tc_vistas;
CREATE TRIGGER trg_tc_vistas_actualizado BEFORE UPDATE ON public.tc_vistas FOR EACH ROW EXECUTE FUNCTION public.tc_toca_actualizado();


-- ---------------------------------------------------------------------------
-- 9. Seguridad: leer solo con permiso; escribir, solo el servidor
-- ---------------------------------------------------------------------------
ALTER TABLE public.tc_clientes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_tareas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_comentarios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_actividad      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_vistas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_preferencias   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_notion_cola    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_notion_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tc_personas       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tc_clientes_leer ON public.tc_clientes;
CREATE POLICY tc_clientes_leer ON public.tc_clientes FOR SELECT TO authenticated USING (public.puede_ver_tareas_clientes());

DROP POLICY IF EXISTS tc_tareas_leer ON public.tc_tareas;
CREATE POLICY tc_tareas_leer ON public.tc_tareas FOR SELECT TO authenticated USING (public.puede_ver_tareas_clientes());

DROP POLICY IF EXISTS tc_comentarios_leer ON public.tc_comentarios;
CREATE POLICY tc_comentarios_leer ON public.tc_comentarios FOR SELECT TO authenticated USING (public.puede_ver_tareas_clientes());

DROP POLICY IF EXISTS tc_actividad_leer ON public.tc_actividad;
CREATE POLICY tc_actividad_leer ON public.tc_actividad FOR SELECT TO authenticated USING (public.puede_ver_tareas_clientes());

DROP POLICY IF EXISTS tc_vistas_leer ON public.tc_vistas;
CREATE POLICY tc_vistas_leer ON public.tc_vistas FOR SELECT TO authenticated
  USING (public.puede_ver_tareas_clientes() AND (usuario_id IS NULL OR usuario_id = auth.uid()));

-- Cada persona lee y toca SOLO sus preferencias (su fondo, sus favoritos)
DROP POLICY IF EXISTS tc_preferencias_propias ON public.tc_preferencias;
CREATE POLICY tc_preferencias_propias ON public.tc_preferencias FOR ALL TO authenticated
  USING (usuario_id = auth.uid() AND public.puede_ver_tareas_clientes())
  WITH CHECK (usuario_id = auth.uid() AND public.puede_ver_tareas_clientes());

-- tc_notion_cola, tc_notion_eventos y tc_personas: sin ninguna política = cerradas al navegador (el servidor entra con la clave de servicio)


-- ---------------------------------------------------------------------------
-- 10. Dónde se guardan las portadas y los archivos
--     (se sube SIEMPRE a través del servidor, así que no hace falta ninguna política de escritura)
-- ---------------------------------------------------------------------------
-- Portadas y fondos: públicas, porque no llevan nada sensible y así se pintan sin pedir permiso a cada imagen
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tareas-portadas', 'tareas-portadas', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Archivos de las tareas: PRIVADOS, se piden con un enlace que caduca
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('tareas-archivos', 'tareas-archivos', false, 26214400)
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 11. La casilla «Tareas de clientes» para quien lo va a llevar ya
--     (DO NOTHING: si alguna vez se le quita a alguien, volver a pegar esto no se la devuelve)
-- ---------------------------------------------------------------------------
INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
SELECT p.id, 'tareas-clientes', true
FROM public.profiles p
WHERE lower(p.email) IN ('daniella@libertyseller.com', 'patricia@libertyseller.es', 'carla@libertyseller.com')
ON CONFLICT (user_id, app_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Los 15 clientes de «Tareas Clientes» en Notion, con su base de datos (7 nov 2026)
--     Solo se añaden los que no estén ya (por su base de Notion): volver a pegar esto no cambia nada de lo que se haya tocado después.
--     Sus estados, departamentos y columnas se leen de Notion en la primera sincronización.
-- ---------------------------------------------------------------------------
INSERT INTO public.tc_clientes (nombre, icono, color, grupo, orden, notion_db_id, notion_ds_id, notion_url)
VALUES
  ('Lenobotics', '🤖', 'purple', 'agencia', 1, '3cd4eb84-0d9d-8001-bc78-efdc42a416b7', '9c54eb84-0d9d-8238-a882-076b82f3e39b', 'https://app.notion.com/p/3cd4eb840d9d8001bc78efdc42a416b7'),
  ('ShoesF', '👞', 'blue', 'agencia', 2, '3c74eb84-0d9d-8083-bdc3-fa098a20be03', '3c74eb84-0d9d-80ef-9be2-000b8178eb65', 'https://app.notion.com/p/3c74eb840d9d8083bdc3fa098a20be03'),
  ('Shoplamp', '💡', 'yellow', 'agencia', 3, '3cd4eb84-0d9d-80ed-92d9-f90a77d00bb0', '36c4eb84-0d9d-8214-a7b8-077520d79e66', 'https://app.notion.com/p/3cd4eb840d9d80ed92d9f90a77d00bb0'),
  ('Farmacia Garrachon', '🩺', 'gray', 'agencia', 4, '3cd4eb84-0d9d-80ef-8cd2-c10b0581d901', '5424eb84-0d9d-8320-9cb8-873758582d9f', 'https://app.notion.com/p/3cd4eb840d9d80ef8cd2c10b0581d901'),
  ('Entrais', '💻', 'purple', 'agencia', 5, '3cd4eb84-0d9d-80fb-92c2-e598b69c2df7', '2db4eb84-0d9d-8357-ad20-8725a3afc40a', 'https://app.notion.com/p/3cd4eb840d9d80fb92c2e598b69c2df7'),
  ('MDEP Marketplace', '🧽', 'orange', 'agencia', 6, '3fb4eb84-0d9d-805f-984e-f7047033bb27', '32f4eb84-0d9d-8324-95df-87a1619f8b88', 'https://app.notion.com/p/3fb4eb840d9d805f984ef7047033bb27'),
  ('Creative Toys', '🎯', 'red', 'agencia', 7, '3cd4eb84-0d9d-807c-8f9f-d150ef1a85e1', '8884eb84-0d9d-83c8-9528-875301b7d7ad', 'https://app.notion.com/p/3cd4eb840d9d807c8f9fd150ef1a85e1'),
  ('Jamones Tapas Party', '🐖', 'pink', 'agencia', 8, '3cd4eb84-0d9d-809c-9700-f991d9590e23', '8694eb84-0d9d-82f2-bd50-078e6d9d5ec1', 'https://app.notion.com/p/3cd4eb840d9d809c9700f991d9590e23'),
  ('Solter', '🪖', 'green', 'agencia', 9, '3db4eb84-0d9d-80a8-82f4-ed4fb55593ce', '22b4eb84-0d9d-83e8-b99a-87352ebe3440', 'https://app.notion.com/p/3db4eb840d9d80a882f4ed4fb55593ce'),
  ('Cobofamily', '㊙️', 'red', 'agencia', 10, '3cd4eb84-0d9d-809c-819a-cb037ba69009', 'da84eb84-0d9d-82e4-bc0b-871e88d92a01', 'https://app.notion.com/p/3cd4eb840d9d809c819acb037ba69009'),
  ('Opinas', '⭐', 'yellow', 'agencia', 11, '3cd4eb84-0d9d-8082-b9a7-eaf401164ac1', 'f934eb84-0d9d-83d5-8416-87045acdc2d3', 'https://app.notion.com/p/3cd4eb840d9d8082b9a7eaf401164ac1'),
  ('Yo by Yolanda', '💇🏻‍♀️', 'green', 'agencia', 12, '3cd4eb84-0d9d-80ee-81f0-db763dff2f7e', '93c4eb84-0d9d-830f-a300-8737c9d1ce88', 'https://app.notion.com/p/3cd4eb840d9d80ee81f0db763dff2f7e'),
  ('ALP Global', '🚽', 'orange', 'marcas_eeuu', 1, '3cd4eb84-0d9d-80d5-ae83-f60f00e5fb05', '9684eb84-0d9d-8239-843d-87028adbd458', 'https://app.notion.com/p/3cd4eb840d9d80d5ae83f60f00e5fb05'),
  ('Naelpa LLC', '🤠', 'yellow', 'marcas_eeuu', 2, '3cd4eb84-0d9d-80b0-b460-e2c27d0a2a95', 'e704eb84-0d9d-82b7-ad4f-07fbdd7af458', 'https://app.notion.com/p/3cd4eb840d9d80b0b460e2c27d0a2a95'),
  ('Portico', '🇺🇸', 'brown', 'marcas_eeuu', 3, '3cd4eb84-0d9d-80c8-8687-e7cc58dbecae', 'bd54eb84-0d9d-837c-9ecf-870d23b4f766', 'https://app.notion.com/p/3cd4eb840d9d80c88687e7cc58dbecae')
ON CONFLICT (notion_db_id) DO NOTHING;

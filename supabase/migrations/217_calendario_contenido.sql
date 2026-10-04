-- ============================================================================
-- 217 · CALENDARIO DE CONTENIDO: quién publica qué, y qué día
-- ============================================================================
--
-- El plan es tres piezas de vídeo y seis carruseles por semana, repartidos entre
-- las cuentas de LinkedIn de Alejandro, Mario y Raúl. Hoy eso vive en una
-- conversación: el fichero va por WhatsApp, el texto del post va en otro mensaje,
-- y el martes nadie se acuerda de a quién le tocaba.
--
--
-- ============ POR QUÉ DOS TABLAS Y NO UNA ============
--
-- Lo primero que sale es una sola tabla: fecha, persona, fichero, texto. Y se
-- rompe en cuanto se usa de verdad, porque la MISMA pieza la publican dos cuentas
-- en días distintos — es justo el plan, no una excepción. Con una tabla hay que
-- duplicar la fila entera, y entonces el texto del post existe dos veces: se
-- corrige una errata en el de Mario y el de Alejandro sigue con ella.
--
--   contenido_piezas     — el material. Existe una vez, aunque se publique tres.
--   contenido_calendario — un encargo: esta pieza, esta persona, este día.
--
-- Corregir el copy es tocar una fila y que cambie en los tres sitios donde está
-- programado.
--
--
-- ============ POR QUÉ `estado` Y NO UN BOOLEANO `publicado` ============
--
-- Porque «saltado» es un desenlace de verdad, no la ausencia de otro. Un día pasa
-- y no se publica: o se decidió no publicarlo, o se olvidó. Un booleano deja las
-- dos cosas con el mismo valor, y a fin de mes no se puede responder a la única
-- pregunta que importa para ajustar el plan: ¿fallamos al ejecutar, o es que seis
-- carruseles por semana no caben?
--
--
-- ============ POR QUÉ `responsable_id` APUNTA A profiles ============
--
-- Y no es un texto con el nombre. Los tres son usuarios del ERP, y el día que
-- alguien entre a ver «lo mío» la pantalla tiene que poder filtrar por auth.uid()
-- sin adivinar si en la fila pone «Raúl», «Raul» o «Raúl Camuñas».
-- ============================================================================

-- ---------- Las piezas ----------

CREATE TABLE IF NOT EXISTS public.contenido_piezas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('video', 'carrusel')),
  titulo TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  texto_post TEXT NOT NULL DEFAULT '',
  angulo TEXT,
  origen TEXT,
  fichero_path TEXT,
  fichero_nombre TEXT,
  fichero_bytes BIGINT,
  fichero_mime TEXT,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.contenido_piezas IS
  'El material publicable: un vídeo de Remotion o un carrusel en PDF, con el texto '
  'del post que lo acompaña. Existe una vez aunque lo publiquen varias cuentas.';

COMMENT ON COLUMN public.contenido_piezas.slug IS
  'El nombre con el que la pieza se genera fuera del ERP (el JSON del guion o del '
  'carrusel). Es UNIQUE para que volver a subir la misma pieza actualice la que hay '
  'en vez de crear una segunda: el script que la sube hace upsert por este campo.';

COMMENT ON COLUMN public.contenido_piezas.angulo IS
  'La tesis de la pieza en una línea. De un mismo guion salen dos carruseles con '
  'ángulos distintos a propósito, y sin esto en la pantalla no se distinguen: los '
  'dos se llaman «Abrir Europa».';

COMMENT ON COLUMN public.contenido_piezas.fichero_path IS
  'Ruta dentro del bucket `contenido`. Se guarda la ruta y no solo la URL pública '
  'porque borrar un objeto de Storage necesita la ruta, no la URL.';

CREATE INDEX IF NOT EXISTS contenido_piezas_tipo_idx ON public.contenido_piezas (tipo, creado_at DESC);

-- ---------- El calendario ----------

CREATE TABLE IF NOT EXISTS public.contenido_calendario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha DATE NOT NULL,
  pieza_id UUID NOT NULL REFERENCES public.contenido_piezas(id) ON DELETE CASCADE,
  responsable_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'programado' CHECK (estado IN ('programado', 'publicado', 'saltado')),
  publicado_at TIMESTAMPTZ,
  nota TEXT,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- La misma pieza, a la misma persona, el mismo día, dos veces, siempre es un
  -- error de dedo al arrastrar en el calendario. Que lo pare la base.
  UNIQUE (fecha, pieza_id, responsable_id)
);

COMMENT ON TABLE public.contenido_calendario IS
  'Un encargo: esta pieza la publica esta persona este día. La misma pieza puede '
  'tener varias filas, que es como se reparte entre cuentas.';

COMMENT ON COLUMN public.contenido_calendario.estado IS
  'programado · publicado · saltado. «saltado» se marca a mano cuando el día pasa y '
  'se decide no publicar: distinguirlo de «se olvidó» es lo que permite saber a fin '
  'de mes si el plan se cumple o si no cabe.';

CREATE INDEX IF NOT EXISTS contenido_calendario_fecha_idx
  ON public.contenido_calendario (fecha);
CREATE INDEX IF NOT EXISTS contenido_calendario_responsable_idx
  ON public.contenido_calendario (responsable_id, fecha);

-- ---------- Quién ve y quién toca ----------
--
-- Leer, todo el mundo que entra: el calendario de contenido de la agencia no tiene
-- nada reservado, y que Carla vea lo que publica Mario el jueves es justamente lo
-- que hace que esto sirva de algo.
--
-- Escribir el calendario, también todos los autenticados: marcar «publicado» lo
-- hace el que publica, y ese puede ser cualquiera del equipo.
--
-- Crear y borrar PIEZAS, solo admin o partner. Una pieza se borra con todo su
-- calendario detrás (ON DELETE CASCADE), y eso no debería estar a un clic de
-- cualquiera.

ALTER TABLE public.contenido_piezas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contenido_calendario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leen piezas" ON public.contenido_piezas;
CREATE POLICY "Autenticados leen piezas"
  ON public.contenido_piezas FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin y partner crean piezas" ON public.contenido_piezas;
CREATE POLICY "Admin y partner crean piezas"
  ON public.contenido_piezas FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admin y partner editan piezas" ON public.contenido_piezas;
CREATE POLICY "Admin y partner editan piezas"
  ON public.contenido_piezas FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()))
  WITH CHECK (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Admin y partner borran piezas" ON public.contenido_piezas;
CREATE POLICY "Admin y partner borran piezas"
  ON public.contenido_piezas FOR DELETE
  TO authenticated
  USING (public.is_admin_or_partner(auth.uid()));

DROP POLICY IF EXISTS "Autenticados leen el calendario" ON public.contenido_calendario;
CREATE POLICY "Autenticados leen el calendario"
  ON public.contenido_calendario FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Autenticados programan" ON public.contenido_calendario;
CREATE POLICY "Autenticados programan"
  ON public.contenido_calendario FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Autenticados actualizan el calendario" ON public.contenido_calendario;
CREATE POLICY "Autenticados actualizan el calendario"
  ON public.contenido_calendario FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Autenticados desprograman" ON public.contenido_calendario;
CREATE POLICY "Autenticados desprograman"
  ON public.contenido_calendario FOR DELETE
  TO authenticated
  USING (true);

-- ---------- El bucket ----------
--
-- 200 MB porque un reel de dos minutos a 1080p60 pesa 73 MB y los vídeos largos
-- van a crecer. Los MIME van cerrados a lo que de verdad se publica: mp4 y PDF,
-- más PNG y JPEG por si una pieza se sube como imágenes sueltas en vez de como
-- documento.
--
-- OJO, ESTOS 200 MB NO SE CUMPLEN HOY. Supabase tiene un tope global de proyecto
-- que manda sobre el del bucket, y está en 50 MB: medido subiendo ficheros de
-- tamaño creciente —50 MB pasa, 55 devuelve 413 EntityTooLarge—. Hasta que se
-- suba ese tope en Ajustes del proyecto, los vídeos hay que recomprimirlos por
-- debajo de 50 MB antes de subirlos. Se deja el bucket en 200 para que el día
-- que se suba el tope global esto funcione sin tocar nada.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contenido',
  'contenido',
  true,
  209715200, -- 200 MB
  ARRAY['video/mp4', 'video/quicktime', 'application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Autenticados suben contenido" ON storage.objects;
CREATE POLICY "Autenticados suben contenido"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'contenido');

DROP POLICY IF EXISTS "Autenticados leen contenido" ON storage.objects;
CREATE POLICY "Autenticados leen contenido"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'contenido');

DROP POLICY IF EXISTS "Autenticados borran contenido" ON storage.objects;
CREATE POLICY "Autenticados borran contenido"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'contenido');

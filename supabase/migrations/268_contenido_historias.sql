-- ============================================================================
-- 268 · CALENDARIO DE CONTENIDO: HISTORIAS, SIN LÍMITE POR DÍA Y PARA TODO EL EQUIPO
-- ============================================================================
--
-- Hasta ahora el calendario solo conocía dos tipos de pieza: vídeo y carrusel. Las historias (Instagram, Facebook…) son otra cosa: se hacen
-- muchas, a diario, de un momento a otro, y no necesitan el trabajo de producción de un vídeo. Esto las añade como un tercer tipo.
--
--   · `tipo = 'historia'` en `contenido_piezas`. Cada historia es una pieza propia (con su título, su idea o texto en pantalla y, si la hay,
--     su foto o vídeo) y se programa como cualquier otra: una fila en `contenido_calendario`. La UNIQUE (fecha, pieza, responsable) de siempre
--     no limita nada, porque cada historia es una pieza distinta: puede haber las que se quiera el mismo día.
--   · CUALQUIERA del equipo puede crear sus historias y quitar las suyas. Las piezas de verdad (vídeos y carruseles) siguen siendo solo de
--     admin y partner: esta migración NO toca esas políticas, añade dos nuevas que solo valen para historias.
--   · El bucket `contenido` admite también imágenes WEBP (lo que sueltan muchos móviles). Conserva todo lo que ya admitía.
--
-- NO BORRA NI CAMBIA NINGÚN DATO. El código funciona SIN esta migración, salvo crear historias, que la base rechazaría (la pantalla lo dice).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada.
-- Hace falta `contenido_piezas` (migración 217).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- El tipo nuevo
-- ---------------------------------------------------------------------------
-- La restricción de la 217 no tiene nombre propio: Postgres la llamó contenido_piezas_tipo_check. Se busca por lo que dice, por si se llamara
-- de otra forma, y se vuelve a crear con el tipo nuevo.
DO $$
DECLARE
  nombre TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'contenido_piezas') THEN
    RAISE EXCEPTION 'No existe public.contenido_piezas (la crea la migración 217): lanza antes esa.';
  END IF;

  FOR nombre IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.contenido_piezas'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%tipo%'
      AND pg_get_constraintdef(oid) LIKE '%carrusel%'
  LOOP
    EXECUTE format('ALTER TABLE public.contenido_piezas DROP CONSTRAINT %I', nombre);
  END LOOP;

  ALTER TABLE public.contenido_piezas
    ADD CONSTRAINT contenido_piezas_tipo_check CHECK (tipo IN ('video', 'carrusel', 'historia'));
END $$;


-- ---------------------------------------------------------------------------
-- Quién puede crear, cambiar y quitar historias
-- ---------------------------------------------------------------------------
-- Las políticas se SUMAN a las de admin y partner de la 217 (basta con que se cumpla una). Aquí cada uno solo toca lo suyo y solo si es historia.
DROP POLICY IF EXISTS "Cualquiera crea sus historias" ON public.contenido_piezas;
CREATE POLICY "Cualquiera crea sus historias"
  ON public.contenido_piezas FOR INSERT
  TO authenticated
  WITH CHECK (tipo = 'historia' AND creado_por = auth.uid());

DROP POLICY IF EXISTS "Cualquiera edita sus historias" ON public.contenido_piezas;
CREATE POLICY "Cualquiera edita sus historias"
  ON public.contenido_piezas FOR UPDATE
  TO authenticated
  USING (tipo = 'historia' AND creado_por = auth.uid())
  WITH CHECK (tipo = 'historia' AND creado_por = auth.uid());

DROP POLICY IF EXISTS "Cualquiera quita sus historias" ON public.contenido_piezas;
CREATE POLICY "Cualquiera quita sus historias"
  ON public.contenido_piezas FOR DELETE
  TO authenticated
  USING (tipo = 'historia' AND creado_por = auth.uid());


-- ---------------------------------------------------------------------------
-- El bucket: también WEBP
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'application/zip',
  'image/png',
  'image/jpeg',
  'image/webp'
]
WHERE id = 'contenido';


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
-- El editor de Supabase NO ENSEÑA los NOTICE. Las cuatro columnas tienen que decir «true».
SELECT
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contenido_piezas'::regclass AND conname = 'contenido_piezas_tipo_check'
      AND pg_get_constraintdef(oid) LIKE '%historia%'
  ) AS admite_historias,
  (SELECT count(*) = 3 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contenido_piezas'
      AND policyname IN ('Cualquiera crea sus historias', 'Cualquiera edita sus historias', 'Cualquiera quita sus historias'))
    AS tiene_las_tres_politicas,
  (SELECT count(*) = 4 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contenido_piezas'
      AND policyname IN ('Admin y partner crean piezas', 'Admin y partner editan piezas', 'Admin y partner borran piezas', 'Autenticados leen piezas'))
    AS y_conserva_las_de_admin,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'contenido' AND 'image/webp' = ANY (allowed_mime_types) AND 'application/zip' = ANY (allowed_mime_types))
    AS el_bucket_admite_webp_y_conserva_zip;

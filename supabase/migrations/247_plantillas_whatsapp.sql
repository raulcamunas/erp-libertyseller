-- ============================================================================
-- 247 · COLD CALLING: LOS MENSAJES DE WHATSAPP YA ESCRITOS
-- ============================================================================
--
-- En la ficha de un lead, el botón «WhatsApp» abre el chat con su móvil y el mensaje ya puesto, y apunta en su historial que se le ha escrito.
-- Esta tabla guarda los mensajes que se ofrecen, uno o varios por SITUACIÓN:
--
--   · primer_contacto  Un lead al que todavía no se ha hablado.
--   · no_contesta      «Te he llamado y no has cogido».
--   · tras_hablar      Después de una llamada con conversación.
--
-- Pueden llevar {{empresa}} (la tienda del lead) y {{mi_nombre}} (el nombre de quien escribe), que se rellenan solos. Tener VARIOS por situación es
-- a propósito: el botón reparte los leads entre ellos y no se manda siempre el mismo texto palabra por palabra (WhatsApp lo castiga).
--
-- PERSONALES (cada persona ve y toca los suyos) o DEL EQUIPO (user_id NULL: los ve todo el mundo y solo un administrador los crea y los toca), con
-- las mismas reglas que `plantillas_correo` (migración 238). Se leen y se escriben con la sesión de quien los usa: las políticas RLS mandan.
--
-- El código funciona SIN esta migración: el botón ofrece tres mensajes que vienen de serie; lo único que falta sin ella es poder cambiarlos.
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho.
-- No depende de ninguna otra migración: solo necesita la tabla `profiles`, que ya está.
-- ============================================================================


CREATE TABLE IF NOT EXISTS public.plantillas_whatsapp (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- De quién es. NULL = del equipo: solo un administrador los crea y los toca, y los ve todo el mundo
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,

  situacion TEXT NOT NULL CHECK (situacion IN ('primer_contacto', 'no_contesta', 'tras_hablar')),
  -- Puede llevar {{empresa}} y {{mi_nombre}}. Un mensaje largo no cabe en el enlace de WhatsApp: tope de 1.000 caracteres
  texto TEXT NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 1000),

  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plantillas_whatsapp_usuario_idx
  ON public.plantillas_whatsapp (user_id, situacion);

COMMENT ON TABLE public.plantillas_whatsapp IS
  'Mensajes de WhatsApp ya escritos para el boton de la ficha de Cold Calling, por situacion (primer contacto, no contesta, tras hablar). Llevan {{empresa}} y {{mi_nombre}}. user_id NULL = del equipo (los toca solo un admin). Cada persona ve los suyos y los del equipo y toca solo los suyos.';

ALTER TABLE public.plantillas_whatsapp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ver mis mensajes de WhatsApp y los del equipo" ON public.plantillas_whatsapp;
CREATE POLICY "Ver mis mensajes de WhatsApp y los del equipo"
  ON public.plantillas_whatsapp FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Crear mis mensajes de WhatsApp, o los del equipo si soy admin" ON public.plantillas_whatsapp;
CREATE POLICY "Crear mis mensajes de WhatsApp, o los del equipo si soy admin"
  ON public.plantillas_whatsapp FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  );

DROP POLICY IF EXISTS "Cambiar mis mensajes de WhatsApp, o los del equipo si soy admin" ON public.plantillas_whatsapp;
CREATE POLICY "Cambiar mis mensajes de WhatsApp, o los del equipo si soy admin"
  ON public.plantillas_whatsapp FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  );

DROP POLICY IF EXISTS "Borrar mis mensajes de WhatsApp, o los del equipo si soy admin" ON public.plantillas_whatsapp;
CREATE POLICY "Borrar mis mensajes de WhatsApp, o los del equipo si soy admin"
  ON public.plantillas_whatsapp FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  );

REVOKE ALL ON public.plantillas_whatsapp FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plantillas_whatsapp TO authenticated;

-- La hora de la última modificación se pone sola
CREATE OR REPLACE FUNCTION public.plantillas_whatsapp_tocada()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.actualizada_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.plantillas_whatsapp_tocada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_plantillas_whatsapp_tocada ON public.plantillas_whatsapp;
CREATE TRIGGER trg_plantillas_whatsapp_tocada
  BEFORE UPDATE ON public.plantillas_whatsapp
  FOR EACH ROW
  EXECUTE FUNCTION public.plantillas_whatsapp_tocada();


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Lo que falle revienta con un error; lo que salga bien se lee en la fila de abajo, y las tres
-- columnas tienen que decir «true».
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'plantillas_whatsapp' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'plantillas_whatsapp no tiene activada la seguridad por filas.';
  END IF;
  IF has_table_privilege('anon', 'public.plantillas_whatsapp', 'SELECT') THEN
    RAISE EXCEPTION 'plantillas_whatsapp se puede leer sin iniciar sesión: NO se deja así.';
  END IF;
END $$;

SELECT
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'plantillas_whatsapp' AND c.relrowsecurity)
    AS seguridad_por_filas_activada,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plantillas_whatsapp') = 4
    AS cuatro_politicas_puestas,
  NOT has_table_privilege('anon', 'public.plantillas_whatsapp', 'SELECT')
    AS cerrada_a_quien_no_ha_iniciado_sesion;

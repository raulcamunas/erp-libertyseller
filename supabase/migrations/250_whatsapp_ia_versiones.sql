-- ============================================================================
-- 250 · WHATSAPP CON IA: LAS VERSIONES DE SU CONFIGURACIÓN
-- ============================================================================
--
-- Configuración de la IA (Mi rendimiento) → pestaña «WhatsApp». Ahí quien supervisa al equipo comercial calibra cómo escribe la IA el botón «Generar con IA» de
-- WhatsApp de la ficha de Cold Calling: unos mandos (tono, longitud, insistencia, emojis), sus textos, qué se espera de cada momento del lead y el modelo.
--
--   · `whatsapp_ia_versiones`  Una VERSIÓN es la configuración entera, guardada con un nombre. Se escribe como borrador, se prueba con leads de ejemplo y con leads
--                              reales sin enviar nada y, cuando convence, se PUBLICA: desde ese momento la usa todo el equipo. Solo hay UNA en producción. Una versión
--                              que ya ha estado en producción no se edita (se duplica y se edita la copia): así el historial dice de verdad qué se le pidió a la IA cada
--                              día. La «original» (es_base) es la de serie del código y es el punto de partida y de vuelta atrás.
--
-- A diferencia del correo (migración 243) no hay reparto por pesos ni medición de respuestas: de un WhatsApp que se abre desde el ERP no se sabe si se envió ni si
-- contestaron, así que no hay nada que medir. Se calibra probando.
--
-- CERRADA al navegador, como todas las de la IA: sin políticas y con los permisos quitados. La lee y la escribe solo el servidor
-- (app/api/correo/laboratorio/whatsapp/*), que comprueba el permiso «Configuración de la IA» (el mismo de la configuración de correos).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni perder lo hecho. No depende de otras migraciones salvo la
-- tabla `profiles`, que ya está.
-- El código funciona SIN esta migración: la IA de WhatsApp escribe con la configuración de serie y la pantalla avisa de que falta lanzarla.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_ia_versiones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  nombre TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 80),
  notas TEXT CHECK (notas IS NULL OR length(notas) <= 1000),

  -- El perfil entero: {ajustes, secciones, ejemplosModo, momentos, modelo, esfuerzo}. Lo que falte se completa con la configuración de serie al leerlo.
  -- Las REGLAS FIJAS («nada de facturación»…) no están aquí: viven en el código y se añaden siempre
  perfil JSONB NOT NULL,

  -- La que usa el equipo ahora mismo. Como mucho una
  en_produccion BOOLEAN NOT NULL DEFAULT false,
  -- La original: la de serie del código. Como mucho una
  es_base BOOLEAN NOT NULL DEFAULT false,
  archivada BOOLEAN NOT NULL DEFAULT false,

  -- Cuándo se puso en producción por última vez y quién. Con una fecha aquí (o siendo la original) el contenido ya no se edita
  publicada_at TIMESTAMPTZ,
  publicada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  creada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Solo puede haber UNA versión en producción y UNA original
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_ia_versiones_una_en_produccion
  ON public.whatsapp_ia_versiones (en_produccion)
  WHERE en_produccion;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_ia_versiones_una_base
  ON public.whatsapp_ia_versiones (es_base)
  WHERE es_base;

COMMENT ON TABLE public.whatsapp_ia_versiones IS
  'Versiones de la configuracion de la IA que escribe WhatsApp a leads de Cold Calling: mandos, textos, momentos y modelo. Una sola en produccion; las que han estado en produccion no se editan. Cerrada al navegador: la lee y la escribe solo el servidor.';

ALTER TABLE public.whatsapp_ia_versiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_ia_versiones FROM anon, authenticated;


-- ============================================================================
-- COMPROBACIÓN · TERMINA EN UN SELECT, NO EN UN RAISE NOTICE
-- ============================================================================
--
-- El editor de Supabase NO ENSEÑA los NOTICE. Lo que falle revienta con un error; lo que salga bien se lee en la fila de abajo, y las cuatro columnas tienen que
-- decir «true».
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'whatsapp_ia_versiones' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'whatsapp_ia_versiones no tiene activada la seguridad por filas.';
  END IF;
  IF has_table_privilege('anon', 'public.whatsapp_ia_versiones', 'SELECT') OR has_table_privilege('authenticated', 'public.whatsapp_ia_versiones', 'SELECT') THEN
    RAISE EXCEPTION 'whatsapp_ia_versiones se puede leer desde el navegador: NO se deja así.';
  END IF;
END $$;

SELECT
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'whatsapp_ia_versiones')
    AS tabla_creada,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'whatsapp_ia_versiones' AND c.relrowsecurity)
    AS seguridad_por_filas_activada,
  NOT has_table_privilege('anon', 'public.whatsapp_ia_versiones', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.whatsapp_ia_versiones', 'SELECT')
    AS cerrada_al_navegador,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'whatsapp_ia_versiones' AND indexname IN ('whatsapp_ia_versiones_una_en_produccion', 'whatsapp_ia_versiones_una_base')) = 2
    AS indices_unicos_puestos;

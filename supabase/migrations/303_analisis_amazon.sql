-- ============================================================================
-- 303 · EL ANÁLISIS DE AMAZON DE CADA LEAD (el informe hecho con Keepa)
-- ============================================================================
-- Cada vendedor de Amazon de las listas recibe un análisis de su cuenta hecho con datos públicos (Keepa): catálogo, Buy Box, stock,
-- reputación, competencia y oportunidades. Se enseña en una página pública con enlace propio (/analisis/<token>) y el comercial lo
-- tiene en la ficha.
--
--   analisis_amazon            un informe: de qué lead, el enlace (token), el día de los datos y el informe ya calculado (JSON, ~20 KB).
--                              Se guardan todos: dentro de unos meses se repite y se compara con el anterior (`version`).
--   analisis_amazon_aperturas  cada vez que el lead abre su informe: el comercial recibe un aviso y queda en el historial.
--   cold_leads.analisis_amazon_at   cuándo se hizo su último informe. Es lo que usa la casilla «Con informe» de Cold Calling.
--   profiles.whatsapp          el móvil con WhatsApp de cada comercial, para el botón del informe.
--   notifications              admite el tipo nuevo 'analisis_abierto'.
--
-- Cerradas al navegador (sin políticas): solo el servidor entra, con la clave de servicio, y comprueba antes quién puede ver el lead.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.analisis_amazon (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id            UUID NOT NULL REFERENCES public.cold_leads(id) ON DELETE CASCADE,
  seller_id          TEXT NOT NULL CHECK (seller_id ~ '^[A-Z0-9]{8,20}$'),
  -- El enlace público: largo y al azar, para que no se pueda adivinar el de otro
  token              TEXT NOT NULL UNIQUE CHECK (length(token) >= 20),
  -- El día de los datos de Keepa
  fecha              DATE NOT NULL,
  -- 1 = el primero; 2, 3… las repeticiones (para enseñar la evolución)
  version            INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  tipo               TEXT CHECK (tipo IN ('marca_propia', 'revendedor', 'distribuidor', 'mixto')),
  informe            JSONB NOT NULL,
  aperturas          INTEGER NOT NULL DEFAULT 0,
  abierto_primera_at TIMESTAMPTZ,
  abierto_ultima_at  TIMESTAMPTZ,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analisis_amazon_lead_fecha_uk UNIQUE (lead_id, fecha)
);
CREATE INDEX IF NOT EXISTS analisis_amazon_lead_idx ON public.analisis_amazon (lead_id, fecha DESC);

CREATE TABLE IF NOT EXISTS public.analisis_amazon_aperturas (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analisis_id  UUID NOT NULL REFERENCES public.analisis_amazon(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES public.cold_leads(id) ON DELETE CASCADE,
  abierto_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 'movil' u 'ordenador' (del navegador; nada más de quien lo abre)
  dispositivo  TEXT CHECK (dispositivo IN ('movil', 'ordenador'))
);
CREATE INDEX IF NOT EXISTS analisis_amazon_aperturas_idx ON public.analisis_amazon_aperturas (analisis_id, abierto_at DESC);

ALTER TABLE public.analisis_amazon           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analisis_amazon_aperturas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cold_leads ADD COLUMN IF NOT EXISTS analisis_amazon_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS cold_leads_analisis_amazon_idx ON public.cold_leads (analisis_amazon_at) WHERE analisis_amazon_at IS NOT NULL;

COMMENT ON COLUMN public.cold_leads.analisis_amazon_at IS
  'Cuándo se hizo el último análisis de Amazon del lead (tabla analisis_amazon). NULL = sin informe. Lo usa la casilla «Con informe» de Cold Calling.';

-- El WhatsApp de cada comercial (el de llamar ya está en rinkel_vinculos.rinkel_numero)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp TEXT CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9 ]{9,20}$');
UPDATE public.profiles SET whatsapp = '+34 644268611' WHERE id = '55b6c3a2-af73-4fec-b082-ffa6542d9019' AND whatsapp IS NULL;  -- Maoli
UPDATE public.profiles SET whatsapp = '+34 711283291' WHERE id = '4f01dd8a-de2f-4ed7-8c5c-9b62cd46b7e4' AND whatsapp IS NULL;  -- Daniela
UPDATE public.profiles SET whatsapp = '+34 694227854' WHERE id = 'e2d283da-b72f-4a91-9478-9fc9ee817fcb' AND whatsapp IS NULL;  -- Alejandro

-- La campana admite 'analisis_abierto'. Lleva también 'factura_impagada' (de la 301) por si esta se lanza antes que aquella
DO $$
DECLARE
  desconocidos TEXT;
BEGIN
  SELECT string_agg(DISTINCT type, ', ') INTO desconocidos
  FROM public.notifications
  WHERE type NOT IN (
    'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
    'freno_stock', 'fallo_stock', 'fallo_amazon', 'job_amazon',
    'alarma_correo',
    'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
    'fba_alerta', 'fba_resumen',
    'factura_impagada',
    'analisis_abierto'
  );
  IF desconocidos IS NOT NULL THEN
    RAISE EXCEPTION 'Hay avisos en la campana de un tipo que esta migracion no conoce (%). Anadelo a la lista de abajo antes de lanzarla.', desconocidos;
  END IF;

  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'comment', 'mention', 'task_assigned', 'task_updated', 'web_lead',
      'freno_stock', 'fallo_stock',
      'fallo_amazon', 'job_amazon',
      'alarma_correo',
      'correo_nuevo', 'correo_rebote', 'secuencia_pausada', 'secuencia_parada', 'respuesta_lead',
      'fba_alerta', 'fba_resumen',
      'factura_impagada',
      'analisis_abierto'
    ));
END $$;

-- ============================================================================
-- COMPROBACIÓN · las cinco columnas tienen que decir «true»
-- ============================================================================
SELECT
  to_regclass('public.analisis_amazon') IS NOT NULL                                                          AS hay_tabla_de_informes,
  to_regclass('public.analisis_amazon_aperturas') IS NOT NULL                                                AS hay_tabla_de_aperturas,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cold_leads' AND column_name = 'analisis_amazon_at') AS los_leads_tienen_la_marca,
  (SELECT count(*) = 3 FROM public.profiles WHERE whatsapp IS NOT NULL
     AND id IN ('55b6c3a2-af73-4fec-b082-ffa6542d9019', '4f01dd8a-de2f-4ed7-8c5c-9b62cd46b7e4', 'e2d283da-b72f-4a91-9478-9fc9ee817fcb')) AS whatsapp_de_los_tres,
  (SELECT pg_get_constraintdef(oid) LIKE '%analisis_abierto%' FROM pg_constraint
    WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass)              AS la_campana_admite_el_aviso;

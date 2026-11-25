-- ============================================================================
-- 338 · LAS MARCAS DE LA COMPETENCIA EN SEO (y la marca de cada ASIN en la caché del catálogo)
--
--   · seo_marcas            por cuenta y país, las marcas de la competencia. Se llenan solas (origen 'rival': competidores seguidos;
--                           'clics': los productos que se llevan los clics en cada búsqueda; 'ia': la IA repasando las búsquedas) y a mano
--                           ('manual'). activa = false: una persona ha dicho que NO es una marca ajena (no se vuelve a añadir sola).
--   · seo_busquedas_marca   lo que la IA ya ha repasado (una fila por búsqueda), para no preguntarle dos veces.
--   · producto_imagenes     (migración 337; se crea aquí también por si no está) + la marca del ASIN según el catálogo de Amazon.
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Sin ella el ERP sigue como antes (sin lista de marcas).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.producto_imagenes (
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  url TEXT,
  leida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (marketplace_id, asin)
);
ALTER TABLE public.producto_imagenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producto_imagenes ADD COLUMN IF NOT EXISTS marca TEXT;
ALTER TABLE public.producto_imagenes ADD COLUMN IF NOT EXISTS marca_leida BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.seo_marcas (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  marca TEXT NOT NULL,
  texto TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('rival', 'clics', 'ia', 'manual')),
  activa BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, marca)
);
ALTER TABLE public.seo_marcas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.seo_busquedas_marca (
  connection_id UUID NOT NULL REFERENCES public.amazon_connections(id) ON DELETE CASCADE,
  marketplace_id TEXT NOT NULL,
  consulta TEXT NOT NULL,
  marca TEXT,
  revisada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (connection_id, marketplace_id, consulta)
);
ALTER TABLE public.seo_busquedas_marca ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo el servidor (clave de servicio) lee y escribe

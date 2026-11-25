-- ============================================================================
-- 337 · LA IMAGEN PRINCIPAL DE CADA PRODUCTO (por ASIN y país)
--
-- Una caché: el ERP la lee del catálogo de Amazon (SP-API, Catalog Items) la primera vez que una pantalla la pide
-- (SEO, Marketing Test, Remesas) y la guarda aquí; se vuelve a leer a los 30 días. `url` NULL = Amazon no tiene
-- imagen para ese ASIN (se vuelve a preguntar a los 7 días). Solo la escribe el servidor (clave de servicio).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE. Sin ella todo funciona: las imágenes se piden a Amazon
-- cada vez (más lento) en vez de salir de aquí.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.producto_imagenes (
  marketplace_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  url TEXT,
  leida_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (marketplace_id, asin)
);

ALTER TABLE public.producto_imagenes ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo la clave de servicio lee y escribe (las pantallas la piden por /api/productos/imagenes)

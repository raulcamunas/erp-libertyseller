-- 342 · SEO TEST: COMENTARIOS EN LA PESTAÑA «CAMBIOS»
-- Raúl (26 nov 2026): en el registro de quién hizo qué, que el equipo pueda comentar cada cambio y se vea quién lo dijo y cuándo.
-- Un hilo por objeto: «cambio:<id de seo_ediciones>» (el envío, la comprobación y la tarjeta del cambio comparten hilo)
-- o «ev:<id del evento>» (búsquedas, marcas, Helium, IA…). Se lee y se escribe solo desde el servidor (service role),
-- detrás de los permisos de SEO Test; cada uno borra solo lo suyo.

CREATE TABLE IF NOT EXISTS public.seo_comentarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL,
  marketplace_id TEXT NOT NULL,
  hilo TEXT NOT NULL CHECK (char_length(hilo) BETWEEN 3 AND 200),
  asin TEXT,
  texto TEXT NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 2000),
  autor UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_comentarios_cuenta_idx
  ON public.seo_comentarios (connection_id, marketplace_id, created_at DESC);

ALTER TABLE public.seo_comentarios ENABLE ROW LEVEL SECURITY;

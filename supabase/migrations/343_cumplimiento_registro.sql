-- 343 · CUMPLIMIENTO: REGISTRO DE ACCIONES Y COMENTARIOS
-- Raúl (26 nov 2026): «que se pueda justificar por qué lo ha quitado del seguimiento y unos logs de acciones», con quién y cuándo.
-- Una fila por acción hecha desde el ERP sobre un cliente (quitar o volver a seguir un listing, revisar, corregir, cambiar
-- un precio) y por comentario. sku NULL = algo de todo el cliente (p. ej. «Revisar ahora»).
-- Quitar del seguimiento exige motivo: se guarda aquí y también en el propio listing (descartado_motivo).
-- Se lee y se escribe solo desde el servidor (service role) detrás de los permisos de Cumplimiento; cada uno borra solo sus comentarios.

CREATE TABLE IF NOT EXISTS public.cumplimiento_registro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  marketplace_id TEXT,
  sku TEXT,
  asin TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('comentario', 'descartar', 'recuperar', 'revisar', 'revisar-todo', 'corregir', 'precio')),
  texto TEXT CHECK (texto IS NULL OR char_length(texto) <= 2000),
  autor UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cumplimiento_registro_cliente_idx ON public.cumplimiento_registro (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cumplimiento_registro_listing_idx ON public.cumplimiento_registro (client_id, marketplace_id, sku);

ALTER TABLE public.cumplimiento_registro ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listing_cumplimiento ADD COLUMN IF NOT EXISTS descartado_motivo TEXT;

-- Los ya quitados antes de esta migración entran en el registro (sin motivo: no se pedía)
INSERT INTO public.cumplimiento_registro (client_id, marketplace_id, sku, asin, tipo, texto, autor, created_at)
SELECT c.client_id, l.marketplace_id, l.sku, l.asin, 'descartar', NULL, p.id, l.descartado_at
FROM public.listing_cumplimiento l
JOIN public.amazon_connections c ON c.id = l.connection_id
LEFT JOIN public.profiles p ON p.id = l.descartado_por
WHERE l.descartado_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.cumplimiento_registro r WHERE r.client_id = c.client_id AND r.marketplace_id = l.marketplace_id AND r.sku = l.sku AND r.tipo = 'descartar');

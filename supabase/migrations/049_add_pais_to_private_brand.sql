-- =====================================================
-- AÑADIR CAMPO PAIS A CLIENT_PRIVATE_BRAND
-- =====================================================

-- Añadir columna pais a la tabla client_private_brand
ALTER TABLE public.client_private_brand
ADD COLUMN IF NOT EXISTS pais TEXT;

-- Crear índice para búsquedas por país
CREATE INDEX IF NOT EXISTS idx_client_private_brand_pais ON public.client_private_brand(pais);


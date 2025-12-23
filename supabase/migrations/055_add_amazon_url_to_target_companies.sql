-- =====================================================
-- AÑADIR CAMPO AMAZON_URL A TARGET_COMPANIES
-- =====================================================

-- Añadir columna amazon_url a target_companies
ALTER TABLE public.target_companies
ADD COLUMN IF NOT EXISTS amazon_url TEXT;

-- Crear índice para búsqueda rápida por URL
CREATE INDEX IF NOT EXISTS idx_target_companies_amazon_url ON public.target_companies(amazon_url) WHERE amazon_url IS NOT NULL;


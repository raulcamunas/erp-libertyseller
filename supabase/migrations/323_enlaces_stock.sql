-- ============================================================================
-- 323 · ENLACES CON CLAVE TAMBIÉN PARA EL AUDITOR DE STOCK (ShoesF)
-- ============================================================================
-- Los enlaces de la 322 sirven ahora para dos páginas: el tráfico y la conversión ('trafico') y el auditor de stock contra PrestaShop ('stock').
-- NO TOCA NI BORRA NADA: los enlaces que ya existen quedan como 'trafico'. IDEMPOTENTE. Hace falta la 322.
-- ============================================================================
ALTER TABLE public.trafico_enlaces ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'trafico';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trafico_enlaces_tipo_check') THEN
    ALTER TABLE public.trafico_enlaces ADD CONSTRAINT trafico_enlaces_tipo_check CHECK (tipo IN ('trafico', 'stock'));
  END IF;
END $$;

-- Tiene que salir «true»
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'trafico_enlaces' AND column_name = 'tipo') AS tiene_la_columna_tipo;

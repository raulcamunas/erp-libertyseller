-- =====================================================
-- CREAR TABLAS PARA MÓDULO LINKEDIN PROSPECCIÓN
-- =====================================================

-- Tabla de Empresas Objetivo (Contenedores)
CREATE TABLE IF NOT EXISTS public.target_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discarded'))
);

-- Tabla de Prospectos (Empleados dentro de empresas)
CREATE TABLE IF NOT EXISTS public.company_prospects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.target_companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT,
  linkedin_url TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'connected', 'messaged', 'replied')),
  agent TEXT NOT NULL DEFAULT 'Raul' CHECK (agent IN ('Raul', 'Mario')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_target_companies_status ON public.target_companies(status);
CREATE INDEX IF NOT EXISTS idx_target_companies_created_at ON public.target_companies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_prospects_company_id ON public.company_prospects(company_id);
CREATE INDEX IF NOT EXISTS idx_company_prospects_status ON public.company_prospects(status);
CREATE INDEX IF NOT EXISTS idx_company_prospects_agent ON public.company_prospects(agent);
CREATE INDEX IF NOT EXISTS idx_company_prospects_created_at ON public.company_prospects(created_at DESC);

-- Trigger para actualizar updated_at en company_prospects
CREATE OR REPLACE FUNCTION update_company_prospects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger si existe antes de crearlo
DROP TRIGGER IF EXISTS trigger_update_company_prospects_updated_at ON public.company_prospects;
CREATE TRIGGER trigger_update_company_prospects_updated_at
  BEFORE UPDATE ON public.company_prospects
  FOR EACH ROW
  EXECUTE FUNCTION update_company_prospects_updated_at();

-- Habilitar RLS
ALTER TABLE public.target_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_prospects ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para target_companies
-- Eliminar políticas si existen antes de crearlas
DROP POLICY IF EXISTS "Users can view all target companies" ON public.target_companies;
DROP POLICY IF EXISTS "Users can insert target companies" ON public.target_companies;
DROP POLICY IF EXISTS "Users can update target companies" ON public.target_companies;
DROP POLICY IF EXISTS "Users can delete target companies" ON public.target_companies;

CREATE POLICY "Users can view all target companies"
  ON public.target_companies
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert target companies"
  ON public.target_companies
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update target companies"
  ON public.target_companies
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete target companies"
  ON public.target_companies
  FOR DELETE
  TO authenticated
  USING (true);

-- Políticas RLS para company_prospects
-- Eliminar políticas si existen antes de crearlas
DROP POLICY IF EXISTS "Users can view all company prospects" ON public.company_prospects;
DROP POLICY IF EXISTS "Users can insert company prospects" ON public.company_prospects;
DROP POLICY IF EXISTS "Users can update company prospects" ON public.company_prospects;
DROP POLICY IF EXISTS "Users can delete company prospects" ON public.company_prospects;

CREATE POLICY "Users can view all company prospects"
  ON public.company_prospects
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert company prospects"
  ON public.company_prospects
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update company prospects"
  ON public.company_prospects
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete company prospects"
  ON public.company_prospects
  FOR DELETE
  TO authenticated
  USING (true);


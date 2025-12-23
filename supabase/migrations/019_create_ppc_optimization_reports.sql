-- =====================================================
-- LIBERTY PPC AGENCY HUB - REPORTES PÚBLICOS DE OPTIMIZACIÓN
-- =====================================================

-- Tabla de Reportes de Optimización PPC
CREATE TABLE IF NOT EXISTS public.ppc_optimization_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.ppc_clients(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  week_start_date DATE NOT NULL,
  report_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_insights TEXT,
  changes_summary JSONB DEFAULT '[]'::jsonb,
  metrics JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ppc_optimization_reports_client_id ON public.ppc_optimization_reports(client_id);
CREATE INDEX IF NOT EXISTS idx_ppc_optimization_reports_slug ON public.ppc_optimization_reports(slug);
CREATE INDEX IF NOT EXISTS idx_ppc_optimization_reports_week_start_date ON public.ppc_optimization_reports(week_start_date DESC);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_ppc_optimization_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_ppc_optimization_reports_updated_at ON public.ppc_optimization_reports;
CREATE TRIGGER trigger_update_ppc_optimization_reports_updated_at
  BEFORE UPDATE ON public.ppc_optimization_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_ppc_optimization_reports_updated_at();

-- Habilitar RLS
ALTER TABLE public.ppc_optimization_reports ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
DROP POLICY IF EXISTS "Users can view all ppc optimization reports" ON public.ppc_optimization_reports;
DROP POLICY IF EXISTS "Users can insert ppc optimization reports" ON public.ppc_optimization_reports;
DROP POLICY IF EXISTS "Users can update ppc optimization reports" ON public.ppc_optimization_reports;
DROP POLICY IF EXISTS "Users can delete ppc optimization reports" ON public.ppc_optimization_reports;
DROP POLICY IF EXISTS "Public can read ppc optimization reports with slug" ON public.ppc_optimization_reports;

-- Políticas para usuarios autenticados
CREATE POLICY "Users can view all ppc optimization reports"
  ON public.ppc_optimization_reports
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert ppc optimization reports"
  ON public.ppc_optimization_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update ppc optimization reports"
  ON public.ppc_optimization_reports
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete ppc optimization reports"
  ON public.ppc_optimization_reports
  FOR DELETE
  TO authenticated
  USING (true);

-- Política para acceso público (solo lectura con slug)
CREATE POLICY "Public can read ppc optimization reports with slug"
  ON public.ppc_optimization_reports
  FOR SELECT
  TO anon, authenticated
  USING (slug IS NOT NULL);

-- También necesitamos permitir lectura pública de ppc_clients para mostrar el nombre
DROP POLICY IF EXISTS "Public can read ppc clients for public reports" ON public.ppc_clients;
CREATE POLICY "Public can read ppc clients for public reports"
  ON public.ppc_clients
  FOR SELECT
  TO anon, authenticated
  USING (true);





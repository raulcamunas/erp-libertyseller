-- =====================================================
-- CREAR TABLA WEB_LEADS
-- =====================================================

-- Tabla de Leads Web
CREATE TABLE IF NOT EXISTS public.web_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  status TEXT NOT NULL DEFAULT 'registrado' CHECK (status IN ('registrado', 'contactado', 'seguimiento', 'interesado', 'descartado')),
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  empresa TEXT,
  mensaje TEXT,
  ingresos TEXT,
  notas_internas TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_web_leads_status ON public.web_leads(status);
CREATE INDEX IF NOT EXISTS idx_web_leads_created_at ON public.web_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_leads_email ON public.web_leads(email);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_web_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_web_leads_updated_at
  BEFORE UPDATE ON public.web_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_web_leads_updated_at();

-- RLS Policies
ALTER TABLE public.web_leads ENABLE ROW LEVEL SECURITY;

-- Policy: Permitir inserts públicos (para webhook)
CREATE POLICY "Public can insert web_leads"
  ON public.web_leads
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Policy: Usuarios autenticados pueden leer todos los leads
CREATE POLICY "Authenticated users can read web_leads"
  ON public.web_leads
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Usuarios autenticados pueden actualizar leads
CREATE POLICY "Authenticated users can update web_leads"
  ON public.web_leads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy: Usuarios autenticados pueden eliminar leads
CREATE POLICY "Authenticated users can delete web_leads"
  ON public.web_leads
  FOR DELETE
  TO authenticated
  USING (true);


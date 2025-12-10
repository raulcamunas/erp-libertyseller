-- =====================================================
-- TABLA DE LEADS
-- =====================================================

-- Crear la tabla leads
CREATE TABLE public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  revenue_range TEXT,
  is_amazon_seller BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'nuevo' NOT NULL,
  notes TEXT,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Crear índice para búsquedas rápidas
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX idx_leads_assigned_to ON public.leads(assigned_to);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Política: Todos los usuarios autenticados pueden ver todos los leads
CREATE POLICY "Authenticated users can view all leads"
  ON public.leads
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Política: Todos los usuarios autenticados pueden insertar leads
CREATE POLICY "Authenticated users can insert leads"
  ON public.leads
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Política: Todos los usuarios autenticados pueden actualizar leads
CREATE POLICY "Authenticated users can update leads"
  ON public.leads
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


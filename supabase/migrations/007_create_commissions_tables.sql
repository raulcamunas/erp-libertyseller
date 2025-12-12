-- =====================================================
-- TABLAS DE COMISIONES
-- =====================================================

-- Tabla de Clientes
CREATE TABLE public.clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  base_commission_rate NUMERIC(5, 4) NOT NULL CHECK (base_commission_rate >= 0 AND base_commission_rate <= 1),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Tabla de Excepciones (Para reglas específicas por marca/producto)
CREATE TABLE public.commission_exceptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  keyword TEXT NOT NULL,
  special_rate NUMERIC(5, 4) NOT NULL CHECK (special_rate >= 0 AND special_rate <= 1),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(client_id, keyword)
);

-- Tabla de Reportes Guardados
CREATE TABLE public.commission_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  period TEXT,
  data JSONB NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Índices
CREATE INDEX idx_commission_exceptions_client ON public.commission_exceptions(client_id);
CREATE INDEX idx_commission_reports_client ON public.commission_reports(client_id);
CREATE INDEX idx_commission_reports_slug ON public.commission_reports(slug);

-- Habilitar RLS
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_reports ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Authenticated users can manage clients"
  ON public.clients
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage commission exceptions"
  ON public.commission_exceptions
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage commission reports"
  ON public.commission_reports
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Trigger para actualizar updated_at
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_commission_reports_updated_at
  BEFORE UPDATE ON public.commission_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Datos Semilla (Seed)
INSERT INTO public.clients (name, base_commission_rate) VALUES 
('Ham Master', 0.05),
('Lenobotics', 0.03)
ON CONFLICT (name) DO NOTHING;

-- Insertar excepciones para Lenobotics
-- Hércules: 1%
-- Thrustmaster: 1%
INSERT INTO public.commission_exceptions (client_id, keyword, special_rate)
SELECT id, keyword, rate
FROM public.clients,
(VALUES 
  ('Hércules', 0.01),
  ('Thrustmaster', 0.01)
) AS exceptions(keyword, rate)
WHERE name = 'Lenobotics'
ON CONFLICT (client_id, keyword) DO UPDATE SET special_rate = EXCLUDED.special_rate;


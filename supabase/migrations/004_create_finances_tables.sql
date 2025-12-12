-- =====================================================
-- TABLAS DE FINANZAS
-- =====================================================

-- Tabla de meses/periodos contables
CREATE TABLE public.finance_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(year, month)
);

-- Tabla de clientes/pagos
CREATE TABLE public.finance_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  period_id UUID REFERENCES public.finance_periods(id) ON DELETE CASCADE NOT NULL,
  client_name TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  description TEXT,
  payment_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Tabla de archivos adjuntos (facturas, recibos, etc.)
CREATE TABLE public.finance_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID REFERENCES public.finance_payments(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Índices para búsquedas rápidas
CREATE INDEX idx_finance_periods_year_month ON public.finance_periods(year DESC, month DESC);
CREATE INDEX idx_finance_payments_period ON public.finance_payments(period_id);
CREATE INDEX idx_finance_attachments_payment ON public.finance_attachments(payment_id);

-- Habilitar RLS
ALTER TABLE public.finance_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_attachments ENABLE ROW LEVEL SECURITY;

-- Políticas RLS: Todos los usuarios autenticados pueden ver/editar
CREATE POLICY "Authenticated users can manage finance periods"
  ON public.finance_periods
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage finance payments"
  ON public.finance_payments
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage finance attachments"
  ON public.finance_attachments
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Trigger para actualizar updated_at
CREATE TRIGGER update_finance_periods_updated_at
  BEFORE UPDATE ON public.finance_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_finance_payments_updated_at
  BEFORE UPDATE ON public.finance_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


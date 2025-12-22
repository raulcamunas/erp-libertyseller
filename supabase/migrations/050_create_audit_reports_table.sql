-- =====================================================
-- TABLA DE REPORTES DE AUDITORÍA DE VENTAS
-- =====================================================

-- Crear tipo ENUM para business_model
CREATE TYPE business_model_type AS ENUM ('PRIVATE_LABEL', 'ARBITRAGE', 'UNKNOWN');

-- Crear tipo ENUM para status
CREATE TYPE audit_status_type AS ENUM ('processing', 'completed', 'error');

-- Crear tabla audit_reports
CREATE TABLE IF NOT EXISTS public.audit_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  public_token TEXT UNIQUE NOT NULL,
  seller_url TEXT NOT NULL,
  business_model business_model_type DEFAULT 'UNKNOWN',
  input_data JSONB DEFAULT '{}'::jsonb,
  ai_analysis JSONB DEFAULT '{}'::jsonb,
  status audit_status_type DEFAULT 'processing',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Crear índices
CREATE INDEX IF NOT EXISTS idx_audit_reports_public_token ON public.audit_reports(public_token);
CREATE INDEX IF NOT EXISTS idx_audit_reports_status ON public.audit_reports(status);
CREATE INDEX IF NOT EXISTS idx_audit_reports_business_model ON public.audit_reports(business_model);
CREATE INDEX IF NOT EXISTS idx_audit_reports_created_at ON public.audit_reports(created_at DESC);

-- Habilitar RLS
ALTER TABLE public.audit_reports ENABLE ROW LEVEL SECURITY;

-- Política: Usuarios autenticados pueden ver todos los reportes
CREATE POLICY "Authenticated users can view audit reports"
  ON public.audit_reports
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Política: Usuarios autenticados pueden crear reportes
CREATE POLICY "Authenticated users can create audit reports"
  ON public.audit_reports
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Política: Usuarios autenticados pueden actualizar reportes
CREATE POLICY "Authenticated users can update audit reports"
  ON public.audit_reports
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Política: Usuarios autenticados pueden eliminar reportes
CREATE POLICY "Authenticated users can delete audit reports"
  ON public.audit_reports
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- Trigger para actualizar updated_at
CREATE TRIGGER update_audit_reports_updated_at
  BEFORE UPDATE ON public.audit_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


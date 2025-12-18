-- =====================================================
-- TABLA DE FACTURAS DE CLIENTES
-- =====================================================

-- Crear tabla para facturas de clientes
CREATE TABLE IF NOT EXISTS public.client_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL,
  coste_mensual_fijo DECIMAL(12, 2) DEFAULT 0,
  comision DECIMAL(12, 2) DEFAULT 0,
  reporte_url TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(client_id, month, year)
);

-- Habilitar RLS
ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden ver facturas de clientes accesibles
CREATE POLICY "Users can view invoices of accessible clients"
  ON public.client_invoices
  FOR SELECT
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los usuarios pueden crear facturas en clientes accesibles
CREATE POLICY "Users can create invoices in accessible clients"
  ON public.client_invoices
  FOR INSERT
  WITH CHECK (
    (
      public.is_user_client_creator(client_id, auth.uid())
      OR public.is_user_client_member(client_id, auth.uid())
      OR public.get_user_role_safe(auth.uid()) = 'admin'
    )
    AND created_by = auth.uid()
  );

-- Política: Los usuarios pueden actualizar facturas en clientes accesibles
CREATE POLICY "Users can update invoices in accessible clients"
  ON public.client_invoices
  FOR UPDATE
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  )
  WITH CHECK (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los usuarios pueden eliminar facturas en clientes accesibles
CREATE POLICY "Users can delete invoices in accessible clients"
  ON public.client_invoices
  FOR DELETE
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Trigger para actualizar updated_at
CREATE TRIGGER update_client_invoices_updated_at
  BEFORE UPDATE ON public.client_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Índices para búsquedas rápidas
CREATE INDEX idx_client_invoices_client_id ON public.client_invoices(client_id);
CREATE INDEX idx_client_invoices_year_month ON public.client_invoices(year DESC, month DESC);


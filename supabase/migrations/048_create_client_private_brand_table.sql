-- =====================================================
-- TABLA DE MARCA PRIVADA (CHECKLIST)
-- =====================================================

-- Crear tabla para checklist de marca privada
CREATE TABLE IF NOT EXISTS public.client_private_brand (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.client_canvas(id) ON DELETE CASCADE,
  nombre TEXT,
  asin TEXT,
  b1 BOOLEAN DEFAULT false,
  b2 BOOLEAN DEFAULT false,
  b3 BOOLEAN DEFAULT false,
  b4 BOOLEAN DEFAULT false,
  b5 BOOLEAN DEFAULT false,
  descripcion BOOLEAN DEFAULT false,
  a_plus BOOLEAN DEFAULT false,
  foto_1 BOOLEAN DEFAULT false,
  foto_2 BOOLEAN DEFAULT false,
  foto_3 BOOLEAN DEFAULT false,
  foto_4 BOOLEAN DEFAULT false,
  foto_5 BOOLEAN DEFAULT false,
  foto_6 BOOLEAN DEFAULT false,
  foto_7 BOOLEAN DEFAULT false,
  video BOOLEAN DEFAULT false,
  categoria BOOLEAN DEFAULT false,
  position INTEGER DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.client_private_brand ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden ver checklist de marca privada de clientes accesibles
CREATE POLICY "Users can view private brand checklist of accessible clients"
  ON public.client_private_brand
  FOR SELECT
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Política: Los usuarios pueden crear checklist en clientes accesibles
CREATE POLICY "Users can create private brand checklist in accessible clients"
  ON public.client_private_brand
  FOR INSERT
  WITH CHECK (
    (
      public.is_user_client_creator(client_id, auth.uid())
      OR public.is_user_client_member(client_id, auth.uid())
      OR public.get_user_role_safe(auth.uid()) = 'admin'
    )
    AND created_by = auth.uid()
  );

-- Política: Los usuarios pueden actualizar checklist en clientes accesibles
CREATE POLICY "Users can update private brand checklist in accessible clients"
  ON public.client_private_brand
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

-- Política: Los usuarios pueden eliminar checklist en clientes accesibles
CREATE POLICY "Users can delete private brand checklist in accessible clients"
  ON public.client_private_brand
  FOR DELETE
  USING (
    public.is_user_client_creator(client_id, auth.uid())
    OR public.is_user_client_member(client_id, auth.uid())
    OR public.get_user_role_safe(auth.uid()) = 'admin'
  );

-- Trigger para actualizar updated_at
CREATE TRIGGER update_client_private_brand_updated_at
  BEFORE UPDATE ON public.client_private_brand
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Índices para búsquedas rápidas
CREATE INDEX idx_client_private_brand_client_id ON public.client_private_brand(client_id);
CREATE INDEX idx_client_private_brand_asin ON public.client_private_brand(asin);


-- =====================================================
-- GESTIÓN DE USUARIOS Y PERMISOS
-- =====================================================

-- Tabla para almacenar permisos de aplicaciones por usuario
CREATE TABLE IF NOT EXISTS public.user_app_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL, -- 'linkedin', 'finances', 'commissions', 'web-leads', etc.
  can_access BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, app_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_user_app_permissions_user_id ON public.user_app_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_app_permissions_app_id ON public.user_app_permissions(app_id);

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_user_app_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_app_permissions_updated_at ON public.user_app_permissions;
CREATE TRIGGER trigger_update_user_app_permissions_updated_at
  BEFORE UPDATE ON public.user_app_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_app_permissions_updated_at();

-- Habilitar RLS
ALTER TABLE public.user_app_permissions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
-- Solo admins pueden ver todos los permisos
CREATE POLICY "Admins can view all user permissions"
  ON public.user_app_permissions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Solo admins pueden insertar permisos
CREATE POLICY "Admins can insert user permissions"
  ON public.user_app_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Solo admins pueden actualizar permisos
CREATE POLICY "Admins can update user permissions"
  ON public.user_app_permissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Solo admins pueden eliminar permisos
CREATE POLICY "Admins can delete user permissions"
  ON public.user_app_permissions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Los usuarios pueden ver sus propios permisos
CREATE POLICY "Users can view own permissions"
  ON public.user_app_permissions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());


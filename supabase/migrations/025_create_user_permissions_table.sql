-- =====================================================
-- TABLA DE PERMISOS DE APLICACIONES POR USUARIO
-- =====================================================

-- Tabla para almacenar permisos de acceso a aplicaciones por usuario
CREATE TABLE IF NOT EXISTS public.user_app_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  can_access BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, app_id)
);

-- Índices para búsqueda rápida
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

-- Eliminar trigger si existe antes de crearlo
DROP TRIGGER IF EXISTS trigger_update_user_app_permissions_updated_at ON public.user_app_permissions;

CREATE TRIGGER trigger_update_user_app_permissions_updated_at
  BEFORE UPDATE ON public.user_app_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_app_permissions_updated_at();

-- Habilitar RLS
ALTER TABLE public.user_app_permissions ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas si existen antes de crearlas
DROP POLICY IF EXISTS "Admins can view all permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can insert permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can update permissions" ON public.user_app_permissions;
DROP POLICY IF EXISTS "Admins can delete permissions" ON public.user_app_permissions;

-- Política: Solo admins pueden ver todos los permisos
CREATE POLICY "Admins can view all permissions"
  ON public.user_app_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política: Solo admins pueden insertar permisos
CREATE POLICY "Admins can insert permissions"
  ON public.user_app_permissions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política: Solo admins pueden actualizar permisos
CREATE POLICY "Admins can update permissions"
  ON public.user_app_permissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Política: Solo admins pueden eliminar permisos
CREATE POLICY "Admins can delete permissions"
  ON public.user_app_permissions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


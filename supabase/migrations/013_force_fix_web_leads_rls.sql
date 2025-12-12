-- =====================================================
-- FORZAR CORRECCIÓN DE POLÍTICAS RLS PARA WEB_LEADS
-- Solución definitiva para permitir inserts públicos
-- =====================================================

-- Deshabilitar RLS temporalmente para limpiar políticas
ALTER TABLE public.web_leads DISABLE ROW LEVEL SECURITY;

-- Eliminar TODAS las políticas existentes
DROP POLICY IF EXISTS "Public can insert web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "Authenticated users can insert web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "anon_can_insert_web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "authenticated_can_insert_web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "Authenticated users can read web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "Authenticated users can update web_leads" ON public.web_leads;
DROP POLICY IF EXISTS "Authenticated users can delete web_leads" ON public.web_leads;

-- Volver a habilitar RLS
ALTER TABLE public.web_leads ENABLE ROW LEVEL SECURITY;

-- Crear políticas desde cero

-- 1. INSERT: Permitir inserts anónimos (webhooks)
CREATE POLICY "anon_insert_web_leads"
  ON public.web_leads
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- 2. INSERT: Permitir inserts de usuarios autenticados
CREATE POLICY "authenticated_insert_web_leads"
  ON public.web_leads
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 3. SELECT: Solo usuarios autenticados pueden leer
CREATE POLICY "authenticated_select_web_leads"
  ON public.web_leads
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. UPDATE: Solo usuarios autenticados pueden actualizar
CREATE POLICY "authenticated_update_web_leads"
  ON public.web_leads
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. DELETE: Solo usuarios autenticados pueden eliminar
CREATE POLICY "authenticated_delete_web_leads"
  ON public.web_leads
  FOR DELETE
  TO authenticated
  USING (true);


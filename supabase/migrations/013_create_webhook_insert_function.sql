-- =====================================================
-- CREAR FUNCIÓN PARA INSERTAR WEB LEADS (BYPASS RLS)
-- Esta función permite inserts sin restricciones RLS
-- =====================================================

-- Función para insertar web leads desde webhook
CREATE OR REPLACE FUNCTION public.insert_web_lead(
  p_nombre TEXT,
  p_email TEXT,
  p_telefono TEXT DEFAULT NULL,
  p_empresa TEXT DEFAULT NULL,
  p_mensaje TEXT DEFAULT NULL,
  p_ingresos TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  status TEXT,
  nombre TEXT,
  email TEXT,
  telefono TEXT,
  empresa TEXT,
  mensaje TEXT,
  ingresos TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con permisos del creador de la función
AS $$
DECLARE
  v_result RECORD;
BEGIN
  INSERT INTO public.web_leads (
    nombre,
    email,
    telefono,
    empresa,
    mensaje,
    ingresos,
    status
  ) VALUES (
    p_nombre,
    p_email,
    p_telefono,
    p_empresa,
    p_mensaje,
    p_ingresos,
    'registrado'
  )
  RETURNING * INTO v_result;
  
  RETURN QUERY SELECT
    v_result.id,
    v_result.created_at,
    v_result.status,
    v_result.nombre,
    v_result.email,
    v_result.telefono,
    v_result.empresa,
    v_result.mensaje,
    v_result.ingresos;
END;
$$;

-- Permitir que usuarios anónimos ejecuten esta función
GRANT EXECUTE ON FUNCTION public.insert_web_lead TO anon;
GRANT EXECUTE ON FUNCTION public.insert_web_lead TO authenticated;


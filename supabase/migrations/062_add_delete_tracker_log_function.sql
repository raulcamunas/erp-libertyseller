-- =====================================================
-- FUNCIÓN PARA ELIMINAR LOGS INDIVIDUALES DE TRACKER
-- =====================================================

-- Función para eliminar un log individual de tracker_logs
CREATE OR REPLACE FUNCTION public.delete_tracker_log(
  p_log_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con permisos del creador de la función
AS $$
BEGIN
  -- Eliminar el log específico
  DELETE FROM public.tracker_logs
  WHERE id = p_log_id;
  
  -- FOUND es una variable especial de PL/pgSQL que se establece automáticamente
  -- después de operaciones DML (DELETE, UPDATE, INSERT)
  RETURN FOUND;
END;
$$;

-- Permitir que usuarios autenticados ejecuten esta función
GRANT EXECUTE ON FUNCTION public.delete_tracker_log TO authenticated;


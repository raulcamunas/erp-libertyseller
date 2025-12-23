-- =====================================================
-- FIX: Permitir que el trigger handle_new_user() inserte perfiles
-- =====================================================

-- Asegurarnos de que la función handle_new_user() puede insertar perfiles
-- Aunque usa SECURITY DEFINER, a veces RLS puede causar problemas

-- Primero, verificar y recrear la función con mejor manejo de errores
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- Intentar insertar el perfil
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'employee'::user_role
  )
  ON CONFLICT (id) DO NOTHING; -- Si ya existe, no hacer nada
  
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    -- Log del error pero no fallar la creación del usuario
    RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- Asegurarnos de que el trigger existe
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Añadir política RLS para permitir que el trigger inserte (por si acaso)
-- Aunque SECURITY DEFINER debería ser suficiente, esto es una medida adicional
DROP POLICY IF EXISTS "Allow trigger to insert profiles" ON public.profiles;
CREATE POLICY "Allow trigger to insert profiles"
  ON public.profiles
  FOR INSERT
  WITH CHECK (true); -- Permitir todos los inserts (el trigger se encarga de la validación)




-- ============================================================================
-- 290 · ROL «CEO»: DIRECCIÓN CUYO ACCESO A CADA APLICACIÓN LO DECIDEN LAS CASILLAS
-- ============================================================================
--
-- Un CEO es `role = 'admin'` + `profiles.puesto = 'ceo'` (ver lib/usuarios/ceo.ts: un rol nuevo en la base rompería las ~100 comparaciones `role = 'admin'` del código y de las políticas).
-- Conserva lo que solo hace un administrador, pero NO entra a todas las aplicaciones por serlo: entra a las que tenga marcadas en Gestión de Usuarios, como un empleado. Al hacer CEO a
-- alguien, el formulario le marca todas menos el Chat del equipo y Tareas de clientes (lo que se desarrolla dentro del ERP); se le puede dar o quitar cualquier acceso a mano.
--
-- Esta migración hace dos cosas:
--   1) Deja guardar el puesto 'ceo' (el CHECK de `profiles.puesto` solo conocía los de empleado).
--   2) Cierra en la BASE el Chat y Tareas de clientes a un CEO sin casilla: `puede_ver_chat()` y `puede_ver_tareas_clientes()` dejaban pasar a todo administrador, y ahora dejan pasar a un
--      administrador que NO sea CEO, o a cualquiera con la casilla (un CEO con la casilla «Chat» marcada entra).
--
-- Se lanza A MANO en el editor SQL de Supabase. IDEMPOTENTE: se puede volver a pegar sin romper nada ni borrar nada. Hacen falta antes la 257 y la 261 (los puestos), la 275 (tareas) y la 284 (chat).
-- ANTES de dar a nadie el rol CEO en Gestión de Usuarios hay que lanzar esto: sin ello el puesto no se guarda.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'puesto') THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 257_listas_de_leads_y_puestos.sql (la columna profiles.puesto).';
  END IF;
  IF to_regprocedure('public.puede_ver_chat()') IS NULL THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 284_chat_del_equipo.sql (public.puede_ver_chat).';
  END IF;
  IF to_regprocedure('public.puede_ver_tareas_clientes()') IS NULL THEN
    RAISE EXCEPTION 'Falta lanzar antes la migración 275_tareas_de_clientes.sql (public.puede_ver_tareas_clientes).';
  END IF;
END $$;

-- 1) El puesto 'ceo'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_puesto_check') THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_puesto_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_puesto_check
    CHECK (puesto IS NULL OR puesto IN ('comercial', 'manager_comercial', 'comercial_autonomo', 'gestion_administrativa', 'ceo'));
END $$;

COMMENT ON COLUMN public.profiles.puesto IS
  'El puesto de la persona: comercial, manager_comercial, comercial_autonomo o gestion_administrativa (empleados, NULL = sin puesto) o ceo (administrador cuyo acceso a cada aplicacion lo deciden las casillas). Solo nombra y pre-marca casillas, salvo ceo, que ademas hace que un administrador deje de entrar a todo: NO es un rol nuevo, mucho codigo compara role = admin.';

-- 2) Chat y Tareas: un administrador que no sea CEO, o quien tenga la casilla
CREATE OR REPLACE FUNCTION public.puede_ver_chat()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.puesto IS DISTINCT FROM 'ceo')
      OR EXISTS (SELECT 1 FROM public.user_app_permissions u WHERE u.user_id = auth.uid() AND u.app_id = 'chat' AND u.can_access);
$$;

CREATE OR REPLACE FUNCTION public.puede_ver_tareas_clientes()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.puesto IS DISTINCT FROM 'ceo')
      OR EXISTS (SELECT 1 FROM public.user_app_permissions u WHERE u.user_id = auth.uid() AND u.app_id = 'tareas-clientes' AND u.can_access);
$$;

-- Comprobación: tiene que salir UNA fila con las tres cosas en `true`
SELECT
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_puesto_check' AND pg_get_constraintdef(oid) LIKE '%ceo%') AS puesto_ceo,
  pg_get_functiondef('public.puede_ver_chat()'::regprocedure) LIKE '%ceo%'                 AS chat_cerrado_al_ceo,
  pg_get_functiondef('public.puede_ver_tareas_clientes()'::regprocedure) LIKE '%ceo%'      AS tareas_cerrado_al_ceo;

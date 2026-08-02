-- =====================================================
-- ACCESO A «MIS HORAS» PARA LOS COMERCIALES
-- =====================================================
-- El menú lateral solo enseña a un employee las apps que tenga en
-- user_app_permissions, así que sin esto los cuatro comerciales no verían
-- la app aunque la ruta estuviera abierta.

INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
SELECT p.id, 'horas', true
FROM public.profiles p
WHERE p.email IN (
  'yamila@libertyseller.com',
  'maoli@libertyseller.com',
  'alejandro@libertyseller.com',
  'jose@libertyseller.com'
)
ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

-- Por si alguno tenía la agenda sin dar de alta: sin ella no puede ver
-- de dónde salen sus citas cualificadas.
INSERT INTO public.user_app_permissions (user_id, app_id, can_access)
SELECT p.id, 'agenda', true
FROM public.profiles p
WHERE p.email IN (
  'yamila@libertyseller.com',
  'maoli@libertyseller.com',
  'alejandro@libertyseller.com',
  'jose@libertyseller.com'
)
ON CONFLICT (user_id, app_id) DO UPDATE SET can_access = true;

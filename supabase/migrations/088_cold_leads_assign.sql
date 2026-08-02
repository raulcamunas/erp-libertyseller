-- =====================================================
-- COLD CALLING: asignar los leads importados a su comercial
-- =====================================================
-- Se ejecuta DESPUÉS de subir supabase/seed/cold_leads.csv a la tabla
-- cold_leads desde el Table Editor. El CSV trae el email del comercial
-- en import_email; aquí se traduce al id de su perfil.

UPDATE public.cold_leads l
SET assigned_to = p.id
FROM public.profiles p
WHERE p.email = l.import_email
  AND l.assigned_to IS DISTINCT FROM p.id;

-- Comprobación rápida: no debería quedar ningún lead sin dueño.
-- SELECT import_email, count(*) FROM public.cold_leads
-- WHERE assigned_to IS NULL GROUP BY import_email;

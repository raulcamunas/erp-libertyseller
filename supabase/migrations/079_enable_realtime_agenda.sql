-- =====================================================
-- HABILITAR REALTIME PARA LA AGENDA
-- =====================================================
-- Sin esto, las suscripciones postgres_changes del calendario nunca
-- reciben eventos: hacía falta recargar la página para ver citas
-- nuevas de otros comerciales.

ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_comments;

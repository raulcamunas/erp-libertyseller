-- =====================================================
-- HABILITAR REALTIME PARA WEB_LEADS
-- Permite recibir actualizaciones en tiempo real
-- =====================================================

-- Habilitar Realtime para la tabla web_leads
ALTER PUBLICATION supabase_realtime ADD TABLE public.web_leads;


-- =====================================================
-- PRIVACIDAD: ocultar título/descripción de eventos externos ya importados
-- =====================================================
-- Los eventos que ya existían en Google Calendar (reuniones con clientes,
-- apuntes varios, etc.) se importaron con su título y descripción reales.
-- Por privacidad, en el ERP deben verse solo como un hueco ocupado, sin
-- revelar de qué se trata a los comerciales.

UPDATE public.appointments
SET lead_name = 'Hueco no disponible',
    notes = NULL
WHERE is_external = true;

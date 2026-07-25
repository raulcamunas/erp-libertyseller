-- =====================================================
-- MARCAR LOS 4 COMERCIALES + COLORES DE CALENDARIO
-- =====================================================
-- Colores tomados de la paleta estándar de Google Calendar, para que
-- coincidan visualmente entre el ERP y Google Calendar.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_comercial BOOLEAN NOT NULL DEFAULT false;

UPDATE public.profiles SET is_comercial = true, calendar_color = '#3F51B5' -- Blueberry
WHERE email = 'yamila@libertyseller.com';

UPDATE public.profiles SET is_comercial = true, calendar_color = '#D50000' -- Tomato
WHERE email = 'maoli@libertyseller.com';

UPDATE public.profiles SET is_comercial = true, calendar_color = '#F6BF26' -- Banana
WHERE email = 'alejandro@libertyseller.com';

UPDATE public.profiles SET is_comercial = true, calendar_color = '#0B8043' -- Basil
WHERE email = 'jose@libertyseller.com';

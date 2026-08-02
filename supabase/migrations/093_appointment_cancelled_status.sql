-- =====================================================
-- ESTADO «CANCELADA» PARA LAS CITAS
-- =====================================================
-- La 076 renombró 'cancelled' a 'not_qualified', pero son dos cosas
-- distintas: «no cualificada» es que la llamada se hizo y el lead no
-- encajaba; «cancelada» es que la reunión no llegó a existir.
--
-- El sincronizador seguía escribiendo 'cancelled' cuando alguien borraba
-- una cita en Google Calendar, y como el valor ya no existía, el sync
-- entero fallaba con «invalid input value for enum».

ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'cancelled';

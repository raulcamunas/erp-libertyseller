-- ==================================================================
-- 187 · SOLTAR LA ESPERA CUANDO EL PRECIO DE AMAZON YA SE HA MOVIDO
-- ==================================================================
--
-- La migración 180 y el guardia de las cuatro horas evitan reenviar un precio
-- que todavía está en camino. Pero el guardia da por hecho que «no ha pasado
-- nada todavía», y eso no siempre es cierto.
--
-- Caso real de hoy, SKU 34660:
--
--     12:04  el ERP manda 33,44
--     13:40  Raúl pone 33,90 A MANO en Seller Central
--     14:08  pasada del ERP: NO manda nada
--
-- No lo manda porque el guardia ve «33,44 enviado hace dos horas, sigue en
-- camino, no insistas hasta las 16:04». Pero el precio de Amazon YA NO es el
-- que había cuando se mandó: es 33,90, que no es ni el viejo ni el nuestro. Eso
-- demuestra que aquel envío ya se resolvió, y que hay un precio nuevo que
-- corregir AHORA, no dentro de dos horas.
--
-- Pasa igual cuando quien mueve el precio es una regla de Amazon o cualquier
-- otra cosa: mientras el precio no se toque, esperar está bien; en cuanto se
-- mueve, esperar es quedarse mirando.
--
--
-- ============ QUÉ GUARDA ESTA COLUMNA ============
--
-- El precio que Amazon tenía JUSTO ANTES de nuestro envío. Comparándolo con el
-- de ahora se sabe si el envío ya se resolvió:
--
--   · sigue igual   -> no ha pasado nada, se respeta la espera
--   · ha cambiado   -> ya pasó algo, se vuelve a evaluar sin esperar
ALTER TABLE public.entrais_precios
  ADD COLUMN IF NOT EXISTS pvp_al_enviar NUMERIC;

COMMENT ON COLUMN public.entrais_precios.pvp_al_enviar IS
  'El precio que tenía Amazon justo antes del último envío. Si el de ahora es distinto, '
  'aquel envío ya se resolvió y se puede volver a evaluar sin esperar las cuatro horas.';

DO $$
BEGIN
  RAISE NOTICE 'Listo. Un precio cambiado a mano o por una regla se corrige en la siguiente pasada.';
END $$;

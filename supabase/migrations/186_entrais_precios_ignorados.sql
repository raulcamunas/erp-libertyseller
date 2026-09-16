-- ==================================================================
-- 186 · DEJAR DE INSISTIR CON LOS PRECIOS QUE AMAZON NO APLICA
-- ==================================================================
--
-- Medido el 16 de septiembre sobre los envíos de los dos días anteriores:
--
--     combinaciones SKU+precio intentadas      2.098
--     se aplicaron                               341
--     todavía en camino (menos de 4 h)           495
--     AMAZON LAS IGNORA (más de 4 h)           1.262
--
-- Amazon contesta «aceptado» a las 1.262 y no las aplica nunca. No es lentitud:
-- el caso de 34660 lleva cuatro envíos hoy, todos aceptados, y el precio sigue
-- en 30,90 doce horas después.
--
-- Y no es nada que se vea desde aquí: comparados los 1.262 bloqueados con los
-- 341 que sí entraron, coinciden en todo lo que el ERP conoce — mismo canal
-- (DEFAULT), mismo reparto de stock, mismo estado del listado.
--
-- Lo que sí se ve es en Seller Central: esos listados tienen una REGLA DE PRECIO
-- AUTOMÁTICO puesta (el icono de las flechas junto al precio) con su precio
-- mínimo y máximo. La regla vuelve a poner su precio en cuanto el ERP pone otro.
-- Eso se apaga allí; desde aquí no hay forma.
--
--
-- ============ LO QUE HACE ESTA COLUMNA ============
--
-- Cuenta cuántas veces seguidas se ha mandado EL MISMO precio para un SKU sin
-- que Amazon llegue a aplicarlo. A la tercera se deja de insistir.
--
-- No se abandona para siempre: pasadas 24 horas se vuelve a probar una vez. Así
-- el día que se quite la regla en Seller Central, el precio entra solo sin que
-- nadie tenga que acordarse de venir a desbloquearlo. Y si el precio calculado
-- CAMBIA, el contador se reinicia: es un intento nuevo, no el mismo.
ALTER TABLE public.entrais_precios
  ADD COLUMN IF NOT EXISTS intentos_sin_aplicar INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.entrais_precios.intentos_sin_aplicar IS
  'Veces seguidas que se ha mandado el mismo precio sin que Amazon lo aplique. '
  'A partir de 3 se deja de insistir y solo se reintenta una vez al día. '
  'Se reinicia cuando el precio calculado cambia.';

DO $$
BEGIN
  RAISE NOTICE 'Listo. El ciclo dejara de reenviar los precios que Amazon acepta y no aplica.';
END $$;

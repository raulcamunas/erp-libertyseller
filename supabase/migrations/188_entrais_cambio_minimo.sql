-- ==================================================================
-- 188 · NO MANDAR A AMAZON UN CAMBIO DE UN CÉNTIMO
-- ==================================================================
--
-- El motor mandaba cualquier diferencia a partir de medio céntimo. Medido hoy
-- sobre las 7.032 referencias:
--
--     candidatos a enviar                 176
--     de esos, diferencia de 0,01 EUR     142   (81 %)
--
-- Ocho de cada diez envíos eran para mover un precio un céntimo. Eso no cambia
-- nada para nadie —ni el margen, ni lo que ve el comprador, ni la Buy Box— y
-- cuesta lo mismo que uno de verdad: una llamada a Amazon de las cinco por
-- segundo que deja, y un hueco en la ventana de la pasada.
--
-- Con un mínimo de 10 céntimos quedan 31 cambios reales de los 176.
--
--
-- ============ POR QUÉ CONFIGURABLE Y NO UN NÚMERO EN EL CÓDIGO ============
--
-- Porque el número correcto depende del catálogo. Con referencias de 6 EUR, diez
-- céntimos es un 1,7 %; con las de 130 es un 0,08 %. Hoy diez va bien, pero eso
-- se ajusta mirando la pantalla, no desplegando.
--
-- El tramo entre 2 y 10 céntimos está casi vacío —de 176 candidatos, solo 1 cae
-- ahí— así que el valor exacto no es delicado: lo que importa es que corte el
-- ruido del céntimo.
ALTER TABLE public.entrais_config
  ADD COLUMN IF NOT EXISTS publicar_min_dif_eur NUMERIC NOT NULL DEFAULT 0.10;

COMMENT ON COLUMN public.entrais_config.publicar_min_dif_eur IS
  'Diferencia mínima en euros para que un precio se mande a Amazon. Por debajo se deja como '
  'está: mover un precio un céntimo no cambia nada y gasta una llamada.';

DO $$
DECLARE v NUMERIC;
BEGIN
  SELECT publicar_min_dif_eur INTO v FROM public.entrais_config LIMIT 1;
  RAISE NOTICE 'Listo: no se mandan cambios de menos de % EUR.', v;
END $$;

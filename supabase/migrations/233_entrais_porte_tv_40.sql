-- ============================================================================
-- 233 · ENTRAIS: EL PORTE DE LAS TV DE 32 A 43 PULGADAS DEJA DE SER PROVISIONAL
-- ============================================================================
--
-- La regla «TV de 32 a 43 pulgadas» (orden 40, subfamilia «TV 32») se creó en la 155 con los 4 € de
-- siempre y una nota que decía «el cliente no lo cotizó, hasta preguntarle». Domingo (Entrais) lo
-- ha cotizado para las de 40 pulgadas: 12 € MÁS IVA.
--
--   · «Más IVA» quiere decir que el importe NO lleva IVA: se suma al coste tal cual, igual que los
--     4 € de siempre (iva_incluido = false). Los 35 y 60 de las otras reglas son los que llevan IVA.
--   · SUSTITUYE a los 4 €, no se suma a ellos: una regla de porte da UN importe por producto, y así
--     funcionan las demás de televisor.
--   · Se aplica a toda la subfamilia —32, 40 y 43 pulgadas— porque el proveedor las agrupa así y el
--     porte se resuelve por subfamilia. Hoy son seis Hisense: 46949 y 46951 (32''), 46950 y 46952
--     (40''), 46953 y 46958 (43''). Si el 32 o el 43 tienen otro porte, se afina con una regla de tipo
--     «sku» por delante (orden menor que 40).
--
-- LA COMISIÓN DE AMAZON EN LA SUBIDA YA ESTÁ EN LA FÓRMULA: el precio se despeja de
--
--     P × [ (1 − margen)/1,21 − tarifa × 1,03 ] = coste
--
-- así que el porte nuevo sube el precio con su IVA, con la tarifa de referencia (y la tasa digital)
-- que Amazon se lleva de la subida y con el margen sobre el coste añadido. Con la tarifa del 7 % y
-- el margen del 5 %, 8 € más de porte neto son 11,22 € más de precio.
--
-- No toca ningún precio: el motor recalcula con las reglas de la base en cada pasada (cada hora) y
-- la publicación automática manda lo que cambie. Es idempotente.

UPDATE public.entrais_portes
SET importe = 12,
    iva_incluido = false,
    nota = 'Cotizado por el cliente (20 oct 2026): 12 € MÁS IVA para las TV de 40 pulgadas, y sustituye a los 4 € provisionales. Se aplica a toda la subfamilia (32, 40 y 43 pulgadas) hasta que diga si el 32 o el 43 llevan otro porte.',
    updated_at = now()
WHERE orden = 40
  AND tipo = 'subfamilia'
  AND patron = 'TV 32';

-- ---------- Comprobación ----------
DO $$
DECLARE
  r public.entrais_portes%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.entrais_portes WHERE orden = 40 AND tipo = 'subfamilia' AND patron = 'TV 32';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la regla de porte «TV 32» (orden 40): no se ha cambiado nada.';
  END IF;
  IF r.importe <> 12 OR r.iva_incluido THEN
    RAISE EXCEPTION 'La regla «TV 32» debería llevar 12 € sin IVA y lleva % € (iva_incluido = %).', r.importe, r.iva_incluido;
  END IF;

  RAISE NOTICE 'Regla «%»: % € sin IVA.', r.nombre, r.importe;
END $$;

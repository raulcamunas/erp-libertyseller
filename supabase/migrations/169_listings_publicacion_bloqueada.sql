-- ==================================================================
-- 169 · LOS LISTADOS QUE AMAZON NO DEJA TOCAR, APARTADOS Y A LA VISTA
-- ==================================================================
--
-- Hay cinco SKU de Entrais que Amazon rechaza siempre con el mismo motivo:
--
--     «El tipo de producto especificado por Amazon no es valido o no es
--      compatible.»
--
--   43535  CAMERA_PRIVACY_COVER      37442  DOWNLOADABLE_SOFTWARE
--   18961  NETWORK_TRANSCEIVER       18468  ABIS_ELECTRONICS
--   18782
--
-- No es del precio ni del stock: es la ficha del producto. `ABIS_ELECTRONICS` es
-- de los tipos antiguos y la API de listings ya no lo admite; los otros son
-- tipos que existen pero no valen para editar ese listado en Espana. Se arregla
-- en Seller Central, no aqui.
--
--
-- LO QUE HACIA EL ERP HASTA AHORA
-- -------------------------------
-- Desde el freno de los cinco rechazos ya NO llamaba a Amazon por ellos —eso
-- estaba bien— pero seguia escribiendo su fila de envio fallido en cada pasada.
-- 204 filas para decir cinco veces lo mismo, cinco rojos en cada tanda de
-- precios, y el aviso de «sigue reintentando» encendido para siempre por algo
-- que nadie iba a arreglar mirando esa pantalla.
--
-- Con esto se apartan: se marcan en el catalogo con su motivo y su fecha, dejan
-- de entrar en los lotes, y salen listados en un sitio donde se lee lo que hay
-- que hacer. La cola vuelve a contener solo cosas accionables.
--
--
-- POR QUE EN amazon_listings Y NO EN UNA TABLA APARTE
-- ---------------------------------------------------
-- Porque es un hecho DEL LISTADO, como su ASIN o su tipo de producto: este
-- listado no se puede publicar hasta que se arregle su ficha. Una tabla aparte
-- obligaria a cruzarla en todos los sitios que ya leen el catalogo, y a
-- mantenerla en sincronia con las bajas.
--
-- Se limpia solo: en cuanto Amazon acepta un cambio de ese SKU, se borra la
-- marca. Asi, arreglar la ficha en Seller Central es todo lo que hay que hacer
-- —no hay que acordarse de venir aqui a desmarcar nada—.

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS publicacion_bloqueada_motivo TEXT;

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS publicacion_bloqueada_at TIMESTAMPTZ;

COMMENT ON COLUMN public.amazon_listings.publicacion_bloqueada_motivo IS
  'Por que este listado no se puede publicar, con las palabras de Amazon. Lo pone sendChanges() cuando se rinde tras cinco rechazos iguales. Se borra solo en cuanto Amazon acepta un cambio de ese SKU.';
COMMENT ON COLUMN public.amazon_listings.publicacion_bloqueada_at IS
  'Cuando se aparto. Sirve para saber si lleva un dia o dos meses esperando a que alguien arregle la ficha.';

-- Los que hay que enseñar son poquisimos, asi que el indice es parcial: ocupa
-- nada y hace instantanea la consulta que los lista.
CREATE INDEX IF NOT EXISTS amazon_listings_bloqueados_idx
  ON public.amazon_listings (connection_id, marketplace_id)
  WHERE publicacion_bloqueada_at IS NOT NULL;

-- ---------- Comprobacion ----------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'amazon_listings'
      AND column_name = 'publicacion_bloqueada_motivo'
  ) THEN
    RAISE EXCEPTION 'La columna publicacion_bloqueada_motivo no se ha creado.';
  END IF;
  RAISE NOTICE 'Listo. Los listados que Amazon no deja tocar se apartaran solos y saldran listados en Ejecuciones.';
END $$;

-- El desglose del stock de Amazon por referencia.
--
-- Hasta ahora el espejo del catálogo solo guardaba el total (`fba_quantity`) y lo disponible
-- (`fba_fulfillable_quantity`). El total de Amazon incluye lo que todavía viene de camino, lo
-- reservado para pedidos y lo no apto, y la pantalla de inventario lo deducía restando: 74 unidades
-- «Enviadas a Amazon» salían como «en Amazon» y como «no vendibles».
--
-- Con los mismos nombres que Seller Central:
--   · fba_inbound_quantity        «Enviado a Amazon»      (en envíos que Amazon aún no ha recibido)
--   · fba_reserved_quantity       «En reserva»            (pedidos de clientes y procesamiento)
--   · fba_unfulfillable_quantity  «No apto para envío»    (dañado o defectuoso)
--
-- Nulo = todavía no se ha leído desde Amazon (el código sigue calculándolo como antes).
-- El código llega antes que este SQL y no falla si las columnas aún no existen.

ALTER TABLE amazon_listings
  ADD COLUMN IF NOT EXISTS fba_inbound_quantity integer,
  ADD COLUMN IF NOT EXISTS fba_reserved_quantity integer,
  ADD COLUMN IF NOT EXISTS fba_unfulfillable_quantity integer;

-- Comprobación: tienen que salir las tres columnas
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'amazon_listings'
  AND column_name IN ('fba_inbound_quantity', 'fba_reserved_quantity', 'fba_unfulfillable_quantity')
ORDER BY column_name;

#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

# Refresca el espejo del catálogo de todos los clientes conectados a la
# Selling Partner API de Amazon: precios, stock y estado de cada listing, y de
# paso confirma los cambios que ya se habían enviado (Amazon acepta una
# petición y la aplica después, así que lo único que prueba que un cambio llegó
# es volver a leer el listing).
#
# Cada 15 minutos. Con unos 400 SKU por cliente el barrido son cuatro segundos,
# así que sobra margen de sobra dentro de la ventana.
#
# Sin CRON_SECRET la ruta contesta 401 y esto no hace nada: es a propósito, está
# explicado en app/api/amazon/cron-sync/route.ts.
curl -sf -X POST "http://localhost:3000/api/amazon/cron-sync" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null

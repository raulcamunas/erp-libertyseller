#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

# Dos trabajos encadenados, y en este orden:
#
#   1. Refresca el espejo del catálogo de todos los clientes conectados a la
#      Selling Partner API de Amazon: precios, stock y estado de cada listing, y
#      de paso confirma los cambios que ya se habían enviado (Amazon acepta una
#      petición y la aplica después, así que lo único que prueba que un cambio
#      llegó es volver a leer el listing).
#
#   2. EL CICLO DE STOCK: por cada cliente con perfil de origen automático, trae
#      su fichero, lo lee con SU perfil, lo cruza, lo contrasta contra el espejo
#      que acaba de refrescarse, evalúa los frenos y —solo si ese cliente tiene
#      el envío encendido— lo manda. El orden es el fondo del asunto: contrastar
#      contra un espejo viejo propondría otra vez cambios que ya se mandaron.
#
# Cada 15 minutos. El barrido del catálogo son unos cuatro segundos por cliente;
# el ciclo de stock se corta solo a los nueve minutos para no empalmar con la
# pasada siguiente, y lo que no le dé tiempo a mirar va primero en la siguiente.
#
# --max-time es lo que impide que se acumule un curl colgado por cada cuarto de
# hora si el servidor deja de contestar. Está por encima del presupuesto del
# ciclo a propósito: cortar por aquí no pararía el trabajo del servidor, solo
# dejaría de escuchar la respuesta.
#
# Sin CRON_SECRET la ruta contesta 401 y esto no hace nada: es a propósito, está
# explicado en app/api/amazon/cron-sync/route.ts.
curl -sf --max-time 780 -X POST "http://localhost:3000/api/amazon/cron-sync" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null

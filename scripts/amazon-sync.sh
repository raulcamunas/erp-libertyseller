#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

# El puerto NO se escribe a mano: el Dockerfile pone 3000 y Easypanel lo pisa
# con el 80. Con el 3000 fijo, esto pedía a un puerto vacío y contestaba 000.
: "${PORT:=3000}"

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
#
# PERO QUE SE ENTERE ALGUIEN. Aquí había un `curl -sf ... -o /dev/null`, y con
# `-f` curl se calla y descarta el cuerpo cuando la respuesta es un error. O sea
# que el día que CRON_SECRET se borre o se renombre en Easypanel, los dos crones
# de Amazon empezarían a recibir 401 —comprobado contra el servidor compilado
# sin la variable: 401 tanto sin cabecera como con una incorrecta— y el catálogo
# y el ciclo de stock dejarían de correr EN SILENCIO. Nadie se enteraría hasta
# que un cliente preguntara por qué no se le actualiza el stock.
#
# Se quita `-f` y se mira el código: si no es 200, se escribe una línea en la
# salida de error del contenedor (PID 1), que es la que se ve en los registros
# de Easypanel. La salida de crond va a syslog, que en este contenedor no
# recoge nadie, así que escribir ahí no serviría de nada.
CODIGO=$(curl -s --max-time 780 -X POST "http://localhost:${PORT:-3000}/api/amazon/cron-sync" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[amazon-sync] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

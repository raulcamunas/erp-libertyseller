#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LAS ALERTAS DE LOGÍSTICA FBA: ROTURA DE STOCK, ENVÍOS ATASCADOS, DESCUADRES Y STOCK PARADO.
#
# Se llama cada minuto como todas, y casi siempre contesta enseguida sin hacer nada: el reloj de verdad está en `cron_config`, que lo mira
# tocaAhora(), y está puesto a una vez al día. Se toca desde la pantalla de Sistema.
#
# Solo lee de la base del ERP (no llama a Amazon). Pero lee el libro mayor de cada cliente, así que tarda: --max-time 330, por encima del
# maxDuration de 300 de la ruta. Cortar aquí no pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO y
# las alertas dejarían de salir sin que nadie se entere.
CODIGO=$(curl -s --max-time 330 -X POST "http://localhost:${PORT:-3000}/api/fba/cron-alertas" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[fba-alertas] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

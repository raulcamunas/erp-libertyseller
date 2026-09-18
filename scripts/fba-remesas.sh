#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LAS REMESAS A FBA: LIBRO MAYOR Y STOCK EN LOS ALMACENES DE AMAZON.
#
# Se llama cada minuto como todas, y casi siempre contesta enseguida sin hacer
# nada: el reloj de verdad está en `cron_config`, que lo mira tocaAhora(), y
# está puesto a una vez al día. Se toca desde la pantalla de Sistema.
#
# Una vez al día y no más porque el libro mayor es histórico, no stock vivo:
# pedirlo cada hora no trae nada nuevo y cada pasada gasta una ficha de
# createReport, que Amazon repone UNA VEZ POR MINUTO.
#
# --max-time 780 por encima del maxDuration de 600 de la ruta: cortar aquí no
# pararía el trabajo del servidor, solo dejaría de escuchar la respuesta. Y hace
# falta margen de verdad: cada cuenta espera a que Amazon genere su informe, que
# tarda entre uno y quince minutos.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que
# CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO y las remesas
# dejarían de descontarse sin que nadie se entere.
CODIGO=$(curl -s --max-time 780 -X POST "http://localhost:${PORT:-3000}/api/fba/cron-remesas" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[fba-remesas] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

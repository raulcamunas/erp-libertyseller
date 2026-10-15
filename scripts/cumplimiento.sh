#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL CUMPLIMIENTO DE LISTINGS.
#
# Esta línea entra CADA MINUTO y casi siempre contesta «no me toca»: el reloj de
# verdad vive en la tabla cron_config y se cambia desde la pantalla de Sistema.
# Escrito en el crontab, pasar de una hora a dos obligaría a editar el Dockerfile y
# volver a desplegar.
#
# --max-time 290 va por debajo del maxDuration de la ruta (300). La pasada se corta
# sola a los cuatro minutos y guarda lo que lleve; cortar aquí no pararía el trabajo
# del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET
# desaparezca esto empezaría a recibir 401 EN SILENCIO y la revisión dejaría de
# correr sin que nadie se entere.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/cumplimiento/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[cumplimiento] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

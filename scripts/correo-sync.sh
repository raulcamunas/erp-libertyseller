#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL CORREO DE LOS COMERCIALES.
#
# Esta línea entra CADA MINUTO y casi siempre contesta «no me toca»: el reloj de
# verdad vive en la tabla cron_config y se cambia desde la pantalla de Sistema.
# Escrito en el crontab, pasar de 3 a 5 minutos obligaría a editar el
# Dockerfile y volver a desplegar.
#
# --max-time 290 va por debajo del maxDuration de la ruta (300). Una pasada lee
# varios buzones con un presupuesto de tiempo y se corta sola; cortar aquí no
# pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET
# desaparezca esto empezaría a recibir 401 EN SILENCIO y el correo se quedaría
# sin mensajes nuevos sin que nadie se entere.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/correo/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[correo-sync] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

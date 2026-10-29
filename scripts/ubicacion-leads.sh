#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LA COMUNIDAD AUTÓNOMA DE CADA LEAD, PARA AVISAR DE LOS FESTIVOS.
#
# Esta línea entra CADA MINUTO y casi siempre contesta «no me toca»: el reloj de verdad vive en la tabla cron_config (cada dos minutos por defecto; se cambia o se APAGA
# desde la pantalla de Sistema). Hasta que se lance la migración 263 cada pasada contesta «Falta lanzar la migración» sin tocar nada.
#
# --max-time 290 va por debajo del maxDuration de la ruta (300). Una pasada ubica hasta 6.000 leads en tandas con pausa (un minuto); cortar aquí no pararía el trabajo del
# servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/cold-calling/ubicacion/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[ubicacion-leads] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo; 500 = una pasada que falla: mira Sistema)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LOS AVISOS PUSH AL MÓVIL.
#
# Entra CADA MINUTO y manda los avisos nuevos de la campana a quien tenga los avisos activados. Sin nadie suscrito, contesta enseguida.
# --max-time 70 va por encima del maxDuration de la ruta (60). Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a
# recibir 401 EN SILENCIO y los avisos dejarían de llegar sin que nadie se entere.
CODIGO=$(curl -s --max-time 70 -X POST "http://localhost:${PORT:-3000}/api/push/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[push-avisos] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

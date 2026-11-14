#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL CHAT: RECORDATORIOS Y MENSAJES PROGRAMADOS.
#
# Entra CADA MINUTO y avisa de los recordatorios que ya tocan y envía los mensajes programados cuya hora ha llegado. Sin nada pendiente, contesta enseguida.
# --max-time 70 va por encima del maxDuration de la ruta (60). Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a
# recibir 401 EN SILENCIO y los recordatorios dejarían de llegar sin que nadie se entere.
CODIGO=$(curl -s --max-time 70 -X POST "http://localhost:${PORT:-3000}/api/chat/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[chat-avisos] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# TAREAS DE CLIENTES ↔ NOTION.
#
# Entra CADA MINUTO y casi siempre contesta «no me toca»: el reloj de verdad vive en la tabla cron_config
# (2 minutos por defecto) y se cambia desde la pantalla de Sistema, como el resto de procesos.
#
# --max-time 130 va por encima del maxDuration de la ruta (120). Cortar aquí no pararía el trabajo del servidor,
# solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a
# recibir 401 EN SILENCIO y Notion dejaría de sincronizarse sin que nadie se entere.
CODIGO=$(curl -s --max-time 130 -X POST "http://localhost:${PORT:-3000}/api/tareas-clientes/notion/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[tareas-notion] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

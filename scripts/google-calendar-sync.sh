#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

# El puerto NO se escribe a mano: el Dockerfile pone 3000 y Easypanel lo pisa
# con el 80. Con el 3000 fijo, esto pedía a un puerto vacío y contestaba 000.
: "${PORT:=3000}"

# Sincroniza el calendario de Google con el ERP (citas nuevas/movidas/
# canceladas creadas directamente en Google Calendar). Corre cada pocos
# minutos para que la agenda esté siempre al día sin depender de que
# nadie pulse un botón.
# Sin `-f` y mirando el codigo, por lo mismo que en amazon-sync.sh: con `-f`,
# curl se calla cuando la respuesta es un error, y esta sincronizacion llevaba
# meses contestando 000 —pedia al puerto 3000 y el servidor escucha en el 80—
# sin que nadie se enterara. Una agenda que deja de sincronizarse en silencio se
# descubre cuando alguien se presenta a una cita que ya no existe.
CODIGO=$(curl -s --max-time 120 -X POST "http://localhost:${PORT:-3000}/api/appointments/cron-sync" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[calendario] la ruta ha contestado HTTP ${CODIGO} (000 = no contesto a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

# Sincroniza el calendario de Google con el ERP (citas nuevas/movidas/
# canceladas creadas directamente en Google Calendar). Corre cada pocos
# minutos para que la agenda esté siempre al día sin depender de que
# nadie pulse un botón.
curl -sf -X POST "http://localhost:3000/api/appointments/cron-sync" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null

#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# PRECIOS DINÁMICOS DE ENTRAIS EN PCCOMPONENTES. Cada minuto; el reloj de verdad está en su configuración (30 min por defecto) y casi siempre contesta
# sin hacer nada. Ver app/api/pccomponentes/cron-precios/route.ts. Sin -f, mirando el código, por lo mismo que entrais-precios.sh.
CODIGO=$(curl -s --max-time 1200 -X POST "http://localhost:${PORT:-3000}/api/pccomponentes/cron-precios" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[pcc-precios] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

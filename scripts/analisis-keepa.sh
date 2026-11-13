#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LA RECOGIDA DE KEEPA PARA LOS ANÁLISIS DE AMAZON (app/api/analisis/cron).
#
# Cada minuto. Si Keepa no tiene saldo para una tienda entera contesta al momento; si lo tiene, analiza una (o varias, si hay saldo
# acumulado) y deja el informe en el ERP. --max-time 420 por encima del maxDuration de 360 de la ruta.
CODIGO=$(curl -s --max-time 420 -X POST "http://localhost:${PORT:-3000}/api/analisis/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[analisis-keepa] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

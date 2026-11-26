#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# RESEÑAS: pide la reseña de Amazon de los pedidos que toca (lib/ventas/resenas-servidor.ts). El reloj de verdad está en cron_config (10 min).
#
# Se llama cada minuto como todas; el reloj de verdad está en `cron_config` (tocaAhora), a cada 5 minutos. Cada pasada pide o recoge
# un informe por cuenta, sin esperar a que Amazon lo genere. --max-time 200, por encima del maxDuration de 180 de la ruta.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto recibiría 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 200 -X POST "http://localhost:${PORT:-3000}/api/ventas/resenas/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[resenas] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

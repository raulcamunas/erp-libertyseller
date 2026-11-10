#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL RENDIMIENTO DE AMAZON ADS: PIDE Y RECOGE EL INFORME DIARIO DE CAMPAÑAS DE CADA CUENTA EN USO.
#
# Se llama cada minuto como todas y casi siempre contesta enseguida: el reloj de verdad está en `cron_config` (cada 2 minutos) y lo mira tocaAhora(). Cada 2 minutos recoge los informes que Amazon
# ya haya terminado; cada 3 horas, por cuenta, empieza una lectura nueva (eso está en lib/ads/sincronizar.ts). Solo LEE de Amazon.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO y el rendimiento dejaría de actualizarse sin que nadie
# se entere. --max-time 150, por encima del maxDuration de 120 de la ruta.
CODIGO=$(curl -s --max-time 150 -X POST "http://localhost:${PORT:-3000}/api/ads/cron-rendimiento" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[ads-rendimiento] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

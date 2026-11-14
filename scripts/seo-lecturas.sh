#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# SEO TEST: LAS FICHAS Y EL INFORME DE BRAND ANALYTICS DE LOS PRODUCTOS SEGUIDOS.
#
# Se llama cada minuto como todas y casi siempre contesta enseguida: el reloj de verdad está en `cron_config` (cada 3 minutos) y lo mira tocaAhora(). Solo LEE de Amazon.
# Sin -f y mirando el código, por lo mismo que las demás. --max-time 290, por debajo del maxDuration de 300 de la ruta (la descarga semanal de Top Search Terms es larga).
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/seo/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[seo-lecturas] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

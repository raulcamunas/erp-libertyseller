#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# SEO TEST: LA FOTO DIARIA DE LOS ASIN DE LA COMPETENCIA QUE SE SIGUEN (título, viñetas, imágenes, BSR y precio) Y SUS CAMBIOS.
#
# Se llama cada minuto como todas y casi siempre contesta enseguida: el reloj de verdad está en `cron_config` (cada 60 minutos) y lo mira tocaAhora(). Solo LEE de Amazon.
# --max-time 290, por debajo del maxDuration de 300 de la ruta.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/seo/competencia-diaria" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[seo-competencia] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

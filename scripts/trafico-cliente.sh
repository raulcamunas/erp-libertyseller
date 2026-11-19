#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# TRÁFICO PARA CLIENTES CON ENLACE (migración 322): recoge los informes de Ventas y tráfico terminados y pide los días que faltan. Solo LEE de Amazon.
#
# Se llama cada minuto; el reloj de verdad (cada 2 minutos) está en cron_config y lo mira tocaAhora().
# --max-time 290, por debajo del maxDuration de 300 de la ruta.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/trafico/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[trafico-cliente] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

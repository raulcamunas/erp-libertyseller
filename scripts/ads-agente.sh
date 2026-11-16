#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL AGENTE PPC DE AMAZON ADS: VIGILA EL GASTO DE HOY, APLICA, PIENSA CON IA, MIDE Y AVISA EN LAS CUENTAS CON EL AGENTE ENCENDIDO (lib/ads/agente/agente-cron.ts).
#
# Se llama cada minuto como todas y casi siempre contesta enseguida: el reloj de verdad está en `cron_config` (cada 5 minutos, tarea «ads-agente») y lo mira tocaAhora(). ESCRIBE en Amazon Ads.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO y el agente dejaría de vigilar el gasto sin que nadie
# se entere. --max-time 330, por encima del maxDuration de 300 de la ruta.
CODIGO=$(curl -s --max-time 330 -X POST "http://localhost:${PORT:-3000}/api/ads/cron-agente" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[ads-agente] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

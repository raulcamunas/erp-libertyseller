#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LAS FACTURAS QUE LLEVAN DÍAS SIN PAGAR: UN AVISO EN LA CAMPANA DE LOS ADMINISTRADORES.
#
# Se llama cada minuto como todas, y casi siempre contesta enseguida sin hacer nada: solo trabaja en horario de oficina de un día laborable y
# una vez al día (el reloj está en `cron_config`, migración 301). Lee de Zoho; no manda nada al cliente.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 70 -X POST "http://localhost:${PORT:-3000}/api/facturacion/cron-impagadas" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[facturas-impagadas] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

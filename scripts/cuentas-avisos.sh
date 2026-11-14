#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# CUENTAS DE CLIENTES: EL AVISO AL RESPONSABLE DE CADA CUENTA (lib/cuentas/avisos.ts).
#
# Se llama cada minuto como todas, y casi siempre contesta enseguida sin hacer nada: solo trabaja una vez al día, en horario de oficina de
# un lunes (qué toca esa semana) o un jueves (lo que falta). Solo escribe en la campana; no toca Amazon.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 70 -X POST "http://localhost:${PORT:-3000}/api/cuentas/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[cuentas-avisos] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

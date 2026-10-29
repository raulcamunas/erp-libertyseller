#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL CICLO COMERCIAL: HACE AVANZAR DE FASE A LOS LEADS DE LAS LISTAS DE CICLO.
#
# Esta línea entra CADA MINUTO y casi siempre contesta «no me toca»: el reloj de verdad vive en la tabla cron_config (cada dos minutos por defecto; se cambia o se APAGA desde la pantalla
# de Sistema). Hasta que se lance la migración 264, o mientras no haya ninguna lista de ciclo, cada pasada es una consulta pequeña que no toca nada.
#
# --max-time 110 va por debajo del maxDuration de la ruta (120). Una pasada mueve como mucho 300 leads con una pausa corta entre cada uno; cortar aquí no pararía el trabajo del servidor,
# solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 110 -X POST "http://localhost:${PORT:-3000}/api/cold-calling/ciclo/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[ciclo-leads] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo; 500 = una pasada que falla: mira Sistema)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

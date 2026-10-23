#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LOS SEGUIMIENTOS AUTOMÁTICOS DE CORREO.
#
# Esta línea entra CADA MINUTO y casi siempre contesta «no me toca» o «apagado»: el reloj de verdad vive en la tabla cron_config (se
# cambia o se APAGA desde la pantalla de Sistema) y el interruptor de las secuencias, en Correo → Secuencias → Ajustes. Con ese
# interruptor apagado (que es como nace) cada pasada contesta «apagado» y no toca nada.
#
# --max-time 290 va por debajo del maxDuration de la ruta (300). Una pasada reserva pocos envíos y acaba en segundos; cortar aquí no
# pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO
# y los seguimientos se quedarían sin salir sin que nadie se entere.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/correo/secuencias/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[correo-secuencias] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

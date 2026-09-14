#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LOS PRECIOS DE ENTRAIS, EN SU PROPIA PASADA.
#
# Se llama CADA MINUTO y casi siempre contesta enseguida sin hacer nada: el
# reloj de verdad está dentro, en `publicar_cada_minutos` de la configuración
# del motor, que se ajusta desde la pantalla.
#
# Que corra cada minuto no es un descuido, es lo que hace que no se quede
# ningún precio sin mandar: cuando una pasada deja pendientes, no se sella
# `publicado_at` y la del minuto siguiente los retoma. Antes esto iba dentro de
# amazon-sync, que está a quince minutos, así que cada resto esperaba un cuarto
# de hora.
#
# --max-time 780 por encima del maxDuration de 600 de la ruta: cortar aquí no
# pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, por lo mismo que amazon-sync.sh: con -f, el día
# que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO y los
# precios dejarían de publicarse sin que nadie se entere.
CODIGO=$(curl -s --max-time 780 -X POST "http://localhost:${PORT:-3000}/api/entrais/cron-precios" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[entrais-precios] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

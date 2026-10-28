#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LA TRANSCRIPCIÓN DE LAS LLAMADAS DE RINKEL.
#
# Esta línea entra CADA MINUTO y llama a la ruta DOS VECES, con 30 s entre una y
# otra: crond no baja de un minuto, y una llamada que cumple los 45 s de espera
# no tiene por qué aguardar un minuto entero a su turno. Las dos veces casi
# siempre contestan «no me toca»: el reloj de verdad vive en la tabla
# cron_config y se cambia —o se APAGA, que es el interruptor del gasto— desde la
# pantalla de Sistema. Escrito en el crontab, cambiarlo obligaría a editar el
# Dockerfile y volver a desplegar. Con «1 minuto» en Sistema pasan las dos; con
# más, el reloj se queda con las que le tocan.
#
# Si una pasada tarda más de 30 s (transcribir una llamada larga), la siguiente
# no se le monta encima: la ruta contesta «ya hay una pasada en curso» y sigue.
#
# --max-time 290 va por debajo del maxDuration de la ruta (300). Una pasada
# empieza llamadas nuevas durante 150 s como mucho y acaba las que lleva; cortar
# aquí no pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET
# desaparezca esto empezaría a recibir 401 EN SILENCIO y las llamadas se
# quedarían sin resumen sin que nadie se entere.
llamar() {
  CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/rendimiento/transcribir" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -o /dev/null -w '%{http_code}')

  if [ "$CODIGO" != "200" ]; then
    echo "[rinkel-transcribir] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
      >> /proc/1/fd/2 2>/dev/null || true
  fi
}

llamar
sleep 30
llamar

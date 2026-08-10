#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

# El puerto NO se escribe a mano: el Dockerfile pone 3000 y Easypanel lo pisa
# con el 80. Con el 3000 fijo, esto pedía a un puerto vacío y contestaba 000.
: "${PORT:=3000}"

# EL MOTOR DE TRABAJOS DE LA PLATAFORMA (módulo A1).
#
# Cada cinco minutos coge el trabajo más prioritario que esté libre, procesa
# lotes hasta agotar su presupuesto de cuatro minutos, guarda por dónde iba y se
# va. La pasada siguiente lo recoge donde estaba.
#
# Por qué no va detrás del refresco del catálogo, como sí hace el ciclo de
# stock: aquel necesita contrastar contra un espejo recién actualizado y este no,
# y un barrido de horas debajo de un ciclo con nueve minutos de presupuesto haría
# que el refresco del catálogo llegara tarde. Está explicado entero en
# app/api/amazon/cron-jobs/route.ts.
#
# --max-time es lo que impide que se acumule un curl colgado por cada pasada si
# el servidor deja de contestar. Está por encima del presupuesto del motor a
# propósito: cortar por aquí no pararía el trabajo del servidor, solo dejaría de
# escuchar la respuesta.
#
# Sin CRON_SECRET la ruta contesta 401 y esto no hace nada: es a propósito, está
# explicado en la propia ruta.
#
# Y si contesta 401, QUE SE VEA. Mismo motivo y misma forma que
# scripts/amazon-sync.sh: con el `-f` que había antes, un 401 por una variable
# borrada dejaba el motor de trabajos parado sin dejar ni una línea.
CODIGO=$(curl -s --max-time 280 -X POST "http://localhost:${PORT:-3000}/api/amazon/cron-jobs" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[amazon-jobs] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

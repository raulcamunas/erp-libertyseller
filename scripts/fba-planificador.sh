#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# EL PLANIFICADOR DE REPOSICIÓN FBA: QUÉ HAY QUE ENVIAR A AMAZON, CUÁNTO Y ANTES DE QUÉ FECHA.
#
# Se llama cada minuto como todas, y casi siempre contesta enseguida sin hacer nada: el reloj de verdad está en `cron_config`, que lo mira
# tocaAhora(), y está puesto a cada 15 minutos. Aun así, la ruta solo calcula los clientes con algo nuevo (libro, remesas, envíos propuestos
# o ajustes) desde su última pasada. Se toca desde la pantalla de Sistema.
#
# Solo lee de la base del ERP (no llama a Amazon); escribe las pasadas, los envíos propuestos y los avisos. --max-time 330, por encima del
# maxDuration de 300 de la ruta: cortar aquí no pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, por lo mismo que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 330 -X POST "http://localhost:${PORT:-3000}/api/fba/cron-planificador" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[fba-planificador] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

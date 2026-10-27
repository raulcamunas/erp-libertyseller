#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

: "${PORT:=3000}"

# LAS NOTAS DE GEMINI DE LAS REUNIONES CON CLIENTES, DE GMAIL A LA FICHA DEL CRM.
#
# Esta línea entra CADA MINUTO y casi siempre contesta «no me toca»: el reloj de verdad vive en la tabla cron_config (cada tres minutos por defecto; se
# cambia o se APAGA desde la pantalla de Sistema). Hasta que se autoricen en Google Workspace los permisos de Gmail y Drive (y la migración 258 esté
# lanzada) cada pasada contesta «Google no está configurado» o «Falta lanzar la migración» sin tocar nada.
#
# --max-time 290 va por debajo del maxDuration de la ruta (300). Una pasada lee unos pocos correos y analiza como mucho un par de notas (de 30 s a dos minutos
# cada una); cortar aquí no pararía el trabajo del servidor, solo dejaría de escuchar la respuesta.
#
# Sin -f y mirando el código, igual que las demás: con -f, el día que CRON_SECRET desaparezca esto empezaría a recibir 401 EN SILENCIO.
CODIGO=$(curl -s --max-time 290 -X POST "http://localhost:${PORT:-3000}/api/crm/notas-gemini/cron" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null -w '%{http_code}')

if [ "$CODIGO" != "200" ]; then
  echo "[notas-gemini] la ruta ha contestado HTTP ${CODIGO} (000 = no contestó a tiempo; 500 = una pasada que falla: mira Sistema)" \
    >> /proc/1/fd/2 2>/dev/null || true
fi

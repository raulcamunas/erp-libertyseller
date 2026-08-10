#!/bin/sh

# ---------------------------------------------------------------------------
# EL ENTORNO QUE VE EL CRON, Y SOLO ESE
# ---------------------------------------------------------------------------
# crond arranca sin el entorno del contenedor, así que los scripts de
# scripts/*.sh cargan sus variables con `. /etc/environment`.
#
# ANTES AQUÍ HABÍA UN `env > /etc/environment` Y NO SE PUEDE VOLVER A ESO.
# Volcaba el entorno ENTERO —AMAZON_TOKEN_KEY, AMAZON_LWA_CLIENT_SECRET y
# SUPABASE_SERVICE_ROLE_KEY incluidos— a un fichero que la redirección del shell
# crea con el umask por defecto (0644), dentro de un contenedor que corre como
# root y sin ninguna directiva USER.
#
# Eso anulaba justo lo que promete lib/amazon/crypto.ts: la clave de cifrado
# vive FUERA de la base de datos para que quien se lleve un volcado de Postgres
# no se lleve las tiendas de los clientes. Con el entorno volcado al lado, un
# `docker cp`, una capa de la imagen, un snapshot del volumen o cualquier
# captura de diagnóstico entregaba de una sola vez la service_role key (que lee
# amazon_connections saltándose RLS) y la clave que descifra TODOS los
# refresh_token_enc. Las llaves de las tiendas de todos los clientes, en claro,
# en un paso.
#
# Así que aquí se escribe SOLO lo que los tres scripts del crontab usan de
# verdad, y con el fichero cerrado a 600:
#   CRON_SECRET                    -> amazon-sync.sh, google-calendar-sync.sh
#   PORT                           -> los tres, para saber A QUÉ PUERTO llamar
#   NEXT_PUBLIC_SUPABASE_URL       -> supabase-ping.sh
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  -> supabase-ping.sh (es pública por diseño)
#
# Si un script nuevo necesita otra variable, se añade UNA LÍNEA a la lista de
# abajo. Nunca el entorno entero.
umask 077
: > /etc/environment
chmod 600 /etc/environment

escribir_var() {
  eval "valor=\${$1:-}"
  if [ -n "$valor" ]; then
    # Entre comillas simples para que un valor con espacios se cargue entero al
    # hacer `. /etc/environment`. Las comillas simples que hubiera dentro del
    # valor se escapan a la manera de sh ('\'').
    printf "%s='%s'\n" "$1" "$(printf '%s' "$valor" | sed "s/'/'\\\\''/g")" \
      >> /etc/environment
  fi
}

escribir_var CRON_SECRET
# NO es un secreto, pero sin él los scripts llamaban a localhost:3000 a pelo. El
# Dockerfile pone PORT=3000 y Easypanel lo PISA con el 80, así que los tres crones
# llevaban desde siempre pidiendo a un puerto donde no escucha nadie: HTTP 000 en
# cada pasada, el catálogo sin refrescar y los trabajos con 0 pasadas.
escribir_var PORT
escribir_var NEXT_PUBLIC_SUPABASE_URL
escribir_var NEXT_PUBLIC_SUPABASE_ANON_KEY

# Iniciar crond en background
crond -b

# Iniciar Next.js
exec npm run start

#!/bin/sh

# Cargar variables de entorno (necesario para crond en Alpine)
. /etc/environment

curl -sf "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?limit=1" \
  -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  -o /dev/null

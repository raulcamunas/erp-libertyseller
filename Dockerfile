FROM node:20-alpine

WORKDIR /app

# Aceptar build args para variables de entorno
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

# Instalar curl (para el ping a Supabase)
RUN apk add --no-cache curl

# Copiar archivos de dependencias
COPY package.json package-lock.json* ./

# Instalar dependencias (incluyendo dev para el build)
RUN npm ci

# Copiar el resto del código
COPY . .

# Convertir build args en variables de entorno para el build
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Construir la aplicación
RUN npm run build

# Configurar scripts del entrypoint y cron
RUN chmod +x /app/docker-entrypoint.sh /app/scripts/supabase-ping.sh /app/scripts/google-calendar-sync.sh /app/scripts/amazon-sync.sh /app/scripts/amazon-jobs.sh

# Cron: ping a Supabase cada día a las 08:00 UTC + los tres procesos del ERP,
# que se despiertan CADA MINUTO.
#
# ============ POR QUÉ CADA MINUTO Y NO CADA 3, 5 Y 15 ============
#
# Porque el intervalo de verdad ya no vive aquí: vive en la tabla `cron_config`
# (migración 138) y lo decide la propia ruta nada más entrar —ver tocaAhora() en
# lib/sistema/cron.ts—. Si no le toca, contesta y no hace nada.
#
# Escrito en el crontab, cambiar «cada 15 minutos» por «cada 30» obligaba a
# editar este fichero, hacer commit y esperar un despliegue entero, y desde el
# ERP no se veía siquiera cuál era el intervalo. Ahora se cambia desde Amazon
# API · Sistema y tiene efecto en el minuto siguiente.
#
# El coste es una consulta por minuto y proceso —tres— para contestar «todavía
# no». Es más barato que el despliegue que costaba antes cada cambio.
#
# ============ POR QUÉ SIGUE HABIENDO UNA LÍNEA POR PROCESO ============
#
# Un único repartidor tendría que lanzar los tres, y el del catálogo puede tardar
# trece minutos: o encadena —y la agenda, que va cada tres, se queda esperando— o
# hay que gestionar procesos en segundo plano dentro del contenedor. Con una
# línea por proceso, cada uno conserva su propio --max-time y su propio registro.
#
# Solaparse no pueden: conRegistro() abre la fila ANTES de trabajar, así que una
# pasada en curso ya cuenta como «la última» y tocaAhora() dice que no.
#
# El ciclo de stock NO tiene línea propia: va detrás del refresco del catálogo,
# dentro de la misma llamada, porque decide qué mandar contrastando contra ese
# espejo. Con línea propia compararía contra la foto de hace un cuarto de hora y
# volvería a proponer cambios ya enviados. Ver scripts/amazon-sync.sh.
RUN { \
      echo "0 8 * * * /app/scripts/supabase-ping.sh"; \
      echo "* * * * * /app/scripts/google-calendar-sync.sh"; \
      echo "* * * * * /app/scripts/amazon-sync.sh"; \
      echo "* * * * * /app/scripts/amazon-jobs.sh"; \
    } > /etc/crontabs/root

# Exponer el puerto
EXPOSE 3000

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Entrypoint: arranca crond + Next.js
CMD ["/app/docker-entrypoint.sh"]

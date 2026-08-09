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

# Cron: ping a Supabase cada día a las 08:00 UTC + sync de Google Calendar cada
# 3 min + refresco del catálogo de Amazon y ciclo de stock cada 15 min + motor de
# trabajos de la plataforma cada 5 min.
#
# El ciclo de stock NO tiene línea propia: va detrás del refresco del catálogo,
# dentro de la misma llamada, porque decide qué mandar contrastando contra ese
# espejo. Con línea propia compararía contra la foto de hace un cuarto de hora y
# volvería a proponer cambios ya enviados. Ver scripts/amazon-sync.sh.
#
# El motor de trabajos SÍ tiene línea propia, y al revés que el ciclo de stock:
# no depende del refresco del catálogo, y un barrido que puede durar horas debajo
# de un ciclo con nueve minutos de presupuesto haría que el refresco llegara
# tarde. Cada pasada se corta sola a los cuatro minutos y guarda por dónde iba.
# Ver app/api/amazon/cron-jobs/route.ts.
RUN { \
      echo "0 8 * * * /app/scripts/supabase-ping.sh"; \
      echo "*/3 * * * * /app/scripts/google-calendar-sync.sh"; \
      echo "*/15 * * * * /app/scripts/amazon-sync.sh"; \
      echo "*/5 * * * * /app/scripts/amazon-jobs.sh"; \
    } > /etc/crontabs/root

# Exponer el puerto
EXPOSE 3000

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Entrypoint: arranca crond + Next.js
CMD ["/app/docker-entrypoint.sh"]

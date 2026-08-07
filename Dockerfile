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
RUN chmod +x /app/docker-entrypoint.sh /app/scripts/supabase-ping.sh /app/scripts/google-calendar-sync.sh /app/scripts/amazon-sync.sh

# Cron: ping a Supabase cada día a las 08:00 UTC + sync de Google Calendar cada
# 3 min + refresco del catálogo de Amazon cada 15 min
RUN { \
      echo "0 8 * * * /app/scripts/supabase-ping.sh"; \
      echo "*/3 * * * * /app/scripts/google-calendar-sync.sh"; \
      echo "*/15 * * * * /app/scripts/amazon-sync.sh"; \
    } > /etc/crontabs/root

# Exponer el puerto
EXPOSE 3000

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Entrypoint: arranca crond + Next.js
CMD ["/app/docker-entrypoint.sh"]

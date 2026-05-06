FROM node:20-alpine

WORKDIR /app

# Aceptar build args para variables de entorno
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

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

# Exponer el puerto
EXPOSE 3000

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Iniciar la aplicación
CMD ["npm", "run", "start"]

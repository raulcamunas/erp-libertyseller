#!/bin/sh

# Exportar variables de entorno al archivo para que crond las lea
env > /etc/environment

# Iniciar crond en background
crond -b

# Iniciar Next.js
exec npm run start

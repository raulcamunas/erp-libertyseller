# Liberty Seller Hub - ERP

ERP interno construido con Next.js 14, TypeScript, Tailwind CSS y Supabase.

## 🚀 Stack Tecnológico

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Estilos**: Tailwind CSS con sistema de diseño personalizado
- **Componentes**: Shadcn/UI (base) + Componentes propios
- **Backend/Auth**: Supabase
- **Iconos**: Lucide React

## 🎨 Sistema de Diseño

El proyecto sigue estrictamente el sistema de diseño de Liberty Seller:

- **Colores**: Naranja corporativo (#FF6600), fondo oscuro (#080808)
- **Estética**: Glassmorphism premium con blur y saturación
- **Tipografía**: Inter con letter-spacing personalizado
- **Componentes**: Botones, cards, inputs con estilo glassmorphism

## 📦 Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno:
```bash
cp .env.local.example .env.local
```

Edita `.env.local` y agrega tus credenciales de Supabase:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. Ejecutar en desarrollo:
```bash
npm run dev
```

4. Abrir en el navegador:
```
http://localhost:3000
```

## 🔐 Autenticación

La autenticación está configurada con Supabase. Las rutas protegidas están en `/app/dashboard`.

Para acceder:
1. Ve a `/auth/login`
2. Inicia sesión con tus credenciales de Supabase

## 📁 Estructura del Proyecto

```
├── app/
│   ├── auth/
│   │   └── login/          # Página de login
│   ├── dashboard/          # Dashboard protegido
│   ├── globals.css         # Estilos globales
│   ├── layout.tsx          # Layout principal
│   └── page.tsx            # Página de inicio
├── components/
│   └── ui/                 # Componentes UI base
├── lib/
│   ├── supabase/           # Clientes de Supabase
│   └── utils.ts            # Utilidades
└── middleware.ts           # Middleware para Supabase
```

## 🎯 Próximos Pasos

- [ ] Configurar más componentes UI
- [ ] Implementar rutas protegidas
- [ ] Crear sistema de navegación
- [ ] Agregar más funcionalidades del ERP
# erp-libertyseller

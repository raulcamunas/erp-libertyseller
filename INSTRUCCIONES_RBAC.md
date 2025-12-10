# Instrucciones para Configurar RBAC (Role-Based Access Control)

## Paso 1: Ejecutar SQL en Supabase

### 1.1. Crear la tabla de perfiles y trigger

Ve al **SQL Editor** de Supabase y ejecuta el archivo:
```
supabase/migrations/001_create_profiles_table.sql
```

Este script:
- Crea el tipo ENUM `user_role` con valores 'admin' y 'employee'
- Crea la tabla `profiles` con los campos necesarios
- Configura RLS (Row Level Security) con políticas apropiadas
- Crea un trigger que automáticamente crea un perfil cuando se registra un usuario
- El perfil se crea con `role='employee'` por defecto

### 1.2. Registrar tu usuario como admin

**IMPORTANTE:** Primero debes registrarte en la aplicación con tu email `tu@email.com`

Luego, ejecuta en el SQL Editor de Supabase:

```sql
-- Opción más fácil: Actualizar por email
UPDATE public.profiles 
SET role = 'admin' 
WHERE email = 'tu@email.com';

-- Verificar que se actualizó correctamente
SELECT id, email, full_name, role 
FROM public.profiles 
WHERE email = 'tu@email.com';
```

O si prefieres usar el archivo completo:
```
supabase/migrations/002_insert_admin_user.sql
```

## Paso 2: Verificar que todo funciona

1. **Regístrate** en `/auth/signup` con tu email `tu@email.com`
2. **Ejecuta el SQL** para convertirte en admin
3. **Inicia sesión** en `/auth/login`
4. Deberías poder acceder a:
   - `/dashboard` (todos los usuarios)
   - `/admin` (solo admins)

## Estructura de Roles

### Admin (`role='admin'`)
- Acceso a `/admin/*`
- Acceso a `/dashboard/*`
- Puede ver todos los perfiles (según políticas RLS)

### Employee (`role='employee'`)
- Acceso solo a `/dashboard/*`
- Si intenta acceder a `/admin/*`, será redirigido a `/dashboard`
- Solo puede ver su propio perfil

## Protección de Rutas

El middleware (`middleware.ts`) protege automáticamente:

- **Rutas públicas**: `/`, `/auth/login`, `/auth/signup`
- **Rutas protegidas**: `/dashboard/*` (admin + employee)
- **Rutas admin**: `/admin/*` (solo admin)

## Funciones Helper

### `getUserProfile()`
Función en `lib/supabase/get-user-profile.ts` que obtiene el perfil del usuario actual:

```typescript
const profile = await getUserProfile()
// profile.role será 'admin' o 'employee'
```

## Troubleshooting

### El trigger no crea el perfil automáticamente
- Verifica que el trigger esté creado: `SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';`
- Verifica que la función existe: `SELECT * FROM pg_proc WHERE proname = 'handle_new_user';`

### No puedo acceder a /admin
- Verifica tu rol: `SELECT role FROM public.profiles WHERE email = 'tu@email.com';`
- Asegúrate de que el rol sea exactamente 'admin' (en minúsculas)

### Error de permisos RLS
- Verifica que las políticas RLS estén activas: `SELECT * FROM pg_policies WHERE tablename = 'profiles';`


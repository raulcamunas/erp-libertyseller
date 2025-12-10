# Módulo de Leads - Documentación

## 📋 Estructura

### Base de Datos

Ejecuta el SQL en Supabase:
```
supabase/migrations/003_create_leads_table.sql
```

Esto crea la tabla `leads` con:
- `id` (UUID, auto-generado)
- `created_at` (timestamp)
- `updated_at` (timestamp, auto-actualizado)
- `name` (texto, requerido)
- `phone` (texto, opcional)
- `email` (texto, opcional)
- `revenue_range` (texto, opcional)
- `is_amazon_seller` (boolean, default: false)
- `status` (texto, default: 'nuevo')
- `notes` (texto, opcional)
- `assigned_to` (UUID, referencia a profiles)

### Rutas

- **Dashboard de Leads**: `/dashboard/leads`
- **Webhook API**: `/api/webhooks/leads` (POST)

## 🔌 Webhook de n8n

### Endpoint
```
POST /api/webhooks/leads
```

### Formato del JSON

```json
{
  "name": "Juan Pérez",
  "phone": "+34 600 123 456",
  "email": "juan@example.com",
  "revenue_range": "50k-100k",
  "is_amazon_seller": true,
  "status": "nuevo",
  "notes": "Interesado en servicios premium"
}
```

### Campos

- **Requerido**: `name`
- **Opcionales**: `phone`, `email`, `revenue_range`, `is_amazon_seller`, `status`, `notes`

### Respuesta exitosa

```json
{
  "success": true,
  "message": "Lead creado exitosamente",
  "data": {
    "id": "uuid-del-lead",
    "name": "Juan Pérez",
    ...
  }
}
```

### Respuesta de error

```json
{
  "error": "El campo 'name' es requerido"
}
```

## 🎨 UI

### Componentes

- **LeadsTable**: Tabla de datos con todos los leads
- **Badge**: Etiquetas de estado con colores:
  - `nuevo`: Naranja (#FF6600)
  - `contactado`: Azul (#0073FF)
  - `perdido`: Gris

### Estilos

- La tabla está dentro de un contenedor con clase `.glass-card`
- Los badges cambian de color según el estado
- Diseño responsive

## 🚀 Uso

1. **Ejecuta el SQL** en Supabase para crear la tabla
2. **Configura el webhook en n8n** apuntando a:
   ```
   https://tu-dominio.com/api/webhooks/leads
   ```
3. **Accede a** `/dashboard/leads` para ver todos los leads

## 📝 Notas

- Los leads se ordenan por fecha de creación (más recientes primero)
- El estado por defecto es 'nuevo'
- Todos los usuarios autenticados pueden ver y gestionar leads
- El campo `updated_at` se actualiza automáticamente


# Módulo de Finanzas - Documentación

## 📋 Configuración Inicial

### 1. Ejecutar Migraciones SQL en Supabase

Ejecuta en el SQL Editor de Supabase:

1. **`supabase/migrations/004_create_finances_tables.sql`**
   - Crea las tablas: `finance_periods`, `finance_payments`, `finance_attachments`
   - Configura RLS (Row Level Security)
   - Crea triggers para `updated_at`

2. **`supabase/migrations/005_create_storage_bucket.sql`**
   - Crea el bucket de storage para archivos adjuntos
   - Configura políticas de acceso

### 2. Configurar Storage Bucket Manualmente

Si el SQL no funciona, crea el bucket manualmente:

1. Ve a **Storage** en el dashboard de Supabase
2. Crea un nuevo bucket llamado `finance-attachments`
3. Configura como **Público**
4. Límite de tamaño: 50MB
5. Tipos MIME permitidos: `image/*`, `application/pdf`, documentos Office

### 3. Políticas de Storage

Asegúrate de que las políticas permitan:
- **INSERT**: Usuarios autenticados pueden subir
- **SELECT**: Usuarios autenticados pueden leer
- **DELETE**: Usuarios autenticados pueden eliminar

## 🎯 Funcionalidades

### Dashboard Mensual
- Selección de año y mes
- Vista de ingresos, gastos y beneficio neto
- Gráfica de evolución financiera (últimos 12 meses)

### Gestión de Pagos
- Agregar pagos con:
  - Nombre del cliente
  - Monto
  - Fecha de pago
  - Descripción
  - Archivos adjuntos (facturas, recibos)

### Archivos Adjuntos
- Subir múltiples archivos por pago
- Ver y descargar archivos
- Tipos soportados: imágenes, PDFs, documentos Office

### Gráficas
- Visualización de ingresos, gastos y beneficios
- Últimos 12 meses
- Colores: Naranja (ingresos), Rojo (gastos), Verde (beneficio)

## 📊 Estructura de Datos

### Finance Periods
- `id`: UUID
- `year`: Año (INTEGER)
- `month`: Mes (1-12)
- `created_at`, `updated_at`: Timestamps

### Finance Payments
- `id`: UUID
- `period_id`: Referencia al periodo
- `client_name`: Nombre del cliente
- `amount`: Monto (DECIMAL)
- `description`: Descripción opcional
- `payment_date`: Fecha del pago
- `created_at`, `updated_at`: Timestamps

### Finance Attachments
- `id`: UUID
- `payment_id`: Referencia al pago
- `file_name`: Nombre del archivo
- `file_url`: URL del archivo en storage
- `file_type`: Tipo MIME
- `file_size`: Tamaño en bytes
- `uploaded_at`: Timestamp

## 🎨 Mejoras Visuales Implementadas

### Fondo Liquid Glass
- Efecto de fondo animado con gradientes radiales
- Colores: Naranja (#FF6600) y Azul (#0073FF)
- Animación suave de 25 segundos
- Blur de 120px para efecto glass

### Transiciones Suaves
- Transiciones entre páginas con fadeInUp
- Duración: 500ms con easing suave
- Efecto blur durante la transición
- Transiciones en botones y enlaces

## 🚀 Uso

1. **Acceder a Finanzas**: `/dashboard/finances`
2. **Seleccionar Mes**: Usa el selector de mes en la parte superior
3. **Agregar Pago**: Clic en "Agregar Pago"
4. **Ver Gráfica**: Se muestra automáticamente la evolución
5. **Adjuntar Archivos**: Al agregar un pago, puedes subir facturas

## 📝 Notas

- Los periodos se crean automáticamente al seleccionar un mes
- Los archivos se almacenan en Supabase Storage
- La gráfica muestra los últimos 12 meses disponibles
- Los gastos están preparados para implementarse en el futuro


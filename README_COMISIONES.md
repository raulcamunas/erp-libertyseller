# 📊 Calculadora de Comisiones - Guía de Configuración

## 🗄️ Configuración en Supabase

### Paso 1: Ejecutar la Migración SQL

1. Ve a tu proyecto en Supabase: https://supabase.com/dashboard
2. Navega a **SQL Editor** (menú lateral izquierdo)
3. Crea una nueva consulta
4. Copia y pega el contenido completo de:
   ```
   supabase/migrations/007_create_commissions_tables.sql
   ```
5. Haz clic en **Run** (o presiona `Ctrl/Cmd + Enter`)

### Paso 2: Verificar que se crearon las tablas

1. Ve a **Table Editor** en Supabase
2. Deberías ver 3 nuevas tablas:
   - `clients` - Clientes con sus tasas de comisión
   - `commission_exceptions` - Excepciones por keyword
   - `commission_reports` - Reportes guardados

### Paso 3: Verificar datos semilla

En la tabla `clients` deberías ver:
- **Jamones Tapas Party** - 5% de comisión base
- **Lenobotics** - 3% de comisión base

En la tabla `commission_exceptions` deberías ver:
- Una excepción para **Lenobotics** con keyword **"Thrustmaster"** al 1%

## ✅ Verificación del Cálculo del IVA

El sistema calcula correctamente:

1. **Ventas Brutas** - Total de ventas del CSV
2. **Reembolsos** - Total de reembolsos (se restan)
3. **Facturación Real** = Ventas - Reembolsos
4. **IVA Descontado** = Facturación Real × (21/121) = Facturación Real - Base Neta
5. **Base Neta (SIN IVA)** = Facturación Real ÷ 1.21
6. **Comisión** = Base Neta × Tasa de Comisión

**IMPORTANTE:** La comisión se calcula sobre la **Base Neta (sin IVA)**, no sobre la facturación con IVA.

## 📋 Informe Detallado

El informe incluye:

### Resumen (8 Cards)
- Ventas Brutas Totales
- Reembolsos Totales
- Facturación Real (con IVA)
- IVA Descontado (21%)
- Base Neta (SIN IVA)
- Tasa Promedio de Comisión
- Comisión Total
- Resumen (productos, pedidos, errores)

### Tabla Detallada (11 Columnas)
- **#** - Número de fila en el CSV
- **Producto** - Nombre del producto
- **ASIN** - Código ASIN
- **Pedido** - ID del pedido (si está disponible)
- **Ventas** - Ventas brutas
- **Reembolsos** - Reembolsos aplicados
- **Fact. Real** - Facturación real (Ventas - Reembolsos)
- **IVA (-21%)** - IVA descontado
- **Base Neta** - Base sin IVA (sobre la que se calcula la comisión)
- **% Comisión** - Tasa aplicada (resaltada si hay excepción)
- **Comisión** - Comisión calculada

### Pie de Tabla
- Totales por cada columna
- Comisión total destacada

## 🔧 Agregar Nuevos Clientes

Puedes agregar clientes directamente desde Supabase:

```sql
INSERT INTO public.clients (name, base_commission_rate) 
VALUES ('Nombre del Cliente', 0.05); -- 5% = 0.05
```

## 🔧 Agregar Excepciones

Para agregar excepciones (tasas especiales por keyword):

```sql
-- Obtener el ID del cliente primero
SELECT id, name FROM public.clients WHERE name = 'Lenobotics';

-- Luego insertar la excepción (reemplaza CLIENT_ID con el ID real)
INSERT INTO public.commission_exceptions (client_id, keyword, special_rate)
VALUES ('CLIENT_ID', 'Thrustmaster', 0.01); -- 1% = 0.01
```

## 📝 Notas Importantes

- El IVA se calcula como **21% fijo**
- La comisión se calcula **SIEMPRE sobre la base sin IVA**
- Los reembolsos se restan **ANTES** de calcular el IVA
- Las excepciones se aplican si el nombre del producto contiene la keyword (case insensitive)
- El parser maneja formatos europeos (`1 200,50`) y delimitadores `;` o `,`

## 🐛 Solución de Problemas

### Error: "Cliente no encontrado"
- Verifica que hayas ejecutado la migración SQL
- Verifica que existan clientes en la tabla `clients`

### Error: "El archivo CSV está vacío"
- Verifica que el CSV tenga al menos una fila de datos (además del header)
- Verifica que el delimitador sea `;` o `,`

### Las comisiones no se calculan correctamente
- Verifica que el CSV tenga las columnas correctas (Sales, Refund Cost, etc.)
- Revisa la sección de errores en el informe para ver qué filas fallaron


# Paso 2 · Devolver el espacio al disco

**Esto no se puede hacer desde el editor de Supabase.** No es que sea mala idea:
es que no se puede. El editor manda todo dentro de una transacción y `VACUUM` no
corre dentro de una transacción. Da siempre:

```
ERROR: 25001: VACUUM cannot run inside a transaction block
```

Y lo peor no es el error: es que **deshace todo lo que iba en el mismo envío**.
Por eso los `DELETE` están en un fichero aparte.

## Por qué hace falta

Postgres, al borrar, marca las filas como muertas y reutiliza ese sitio para lo
que venga después — pero **no se lo devuelve al disco**. O sea que el paso 1
detiene el crecimiento, que es el problema de verdad, y deja la cifra de
«Database Size» exactamente igual que estaba.

Para que baje hay que reescribir la tabla, y eso es `VACUUM FULL`.

## Cómo

Hace falta `psql` y la conexión **directa** (puerto 5432), no el pooler:

1. En Supabase: **Project Settings → Database → Connection string → URI**
2. Elige **Session mode / Direct connection**. El pooler en modo transacción no
   deja lanzar VACUUM tampoco.
3. Copia esa cadena. Lleva tu contraseña dentro — no la pegues en ningún sitio
   que no sea tu terminal.

Y entonces, **una tabla por comando**:

```bash
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_snapshots_bsr;"
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_snapshots_precio;"
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_buybox_diagnostico;"
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_fees_estimados;"
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_eventos;"
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.cron_ejecuciones;"
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_jobs;"
```

**`amazon_listings` la última, y solo si hace falta:**

```bash
psql "LA_CADENA_QUE_HAS_COPIADO" -c "VACUUM FULL public.amazon_listings;"
```

Es la que usa el ciclo de stock cada quince minutos y la que más va a bloquear.
Lánzala cuando no estés trabajando. Si tarda más de lo que aguantas, déjala.

## Y el resultado

```bash
psql "LA_CADENA_QUE_HAS_COPIADO" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
```

## Si no quieres tocar psql

No pasa nada, y conviene saber qué se pierde y qué no:

- El crecimiento **está detenido** en cuanto corra el paso 1 y la purga
  automática. Eso es lo importante.
- El espacio liberado **se reutiliza** para las filas nuevas, así que la base no
  va a seguir subiendo.
- Lo único que no baja es **el número que enseña Supabase**, y con él la
  restricción del plan gratuito mientras siga por encima del medio giga.

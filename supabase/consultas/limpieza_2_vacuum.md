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

Hace falta `psql` — ya está instalado en este Mac (Homebrew, PostgreSQL 14).

En Supabase, botón **Connect** (arriba, al lado de «main PRODUCTION»):

### Elige **Session pooler**, NO «Direct connection»

Y esto no es una preferencia, es que la directa **no conecta desde aquí**:

- `db.<ref>.supabase.co` solo tiene registro **AAAA**, o sea solo IPv6. Sin
  registro A. Es lo que avisa el propio diálogo: «Direct connections use IPv6 by
  default».
- Este Mac **no tiene IPv6 global** — ni una dirección enrutable. Así que ni
  siquiera resuelve el nombre: `getaddrinfo` falla antes de intentar conectar.
- La alternativa de Supabase para eso es el add-on de IPv4, que es de pago.

El **Session pooler** va por IPv4 y —esto es lo que importa— **sí admite
VACUUM**, porque en modo sesión cada cliente tiene su conexión dedicada. El
**Transaction pooler** NO: ahí cada sentencia puede caer en una conexión
distinta y VACUUM no puede correr así.

Copia la URI del Session pooler. Lleva tu contraseña dentro — no la pegues en
ningún sitio que no sea tu terminal.

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

#!/bin/bash
#
# LIMPIAR LA BASE · BORRAR LO VIEJO Y DEVOLVER EL ESPACIO AL DISCO
# ================================================================
#
#   ./scripts/limpiar-base.sh
#
# Pide la cadena de conexión, la usa, y no la guarda en ningún sitio: ni en un
# fichero, ni en el historial del terminal, ni en una variable de entorno. Se lee
# oculta y vive en memoria mientras corre.
#
#
# POR QUÉ UN SCRIPT Y NO PEGAR EL SQL EN SUPABASE
# -----------------------------------------------
# Por dos cosas que desde el editor de Supabase no se pueden hacer:
#
#   1. VACUUM no corre dentro de una transacción, y el editor manda todo dentro
#      de una. Peor aún: al fallar el VACUUM, DESHACE los DELETE que iban en el
#      mismo envío — y no avisa de que los ha deshecho.
#
#   2. Los DELETE hay que repetirlos. Son cientos de miles de filas, cada una
#      pasando por el trigger de las series, y el editor corta por tiempo a
#      mitad. A mano hay que darle al botón una y otra vez mirando si los
#      números bajan. Aquí se repite solo hasta que deja de borrar.
#
#
# QUÉ BORRA
# ---------
# Mediciones de más de tres días y registros de más de quince. Los plazos son los
# mismos que los de lib/plataforma/limpieza.ts, que es la purga que corre sola
# cada minuto; esto es la primera pasada, la gorda.
#
# NO TOCA: el catálogo, los envíos a Amazon, los precios de Entrais, los leads,
# las citas, ni nada de gestión.
#
#
# ANTES: LA MIGRACIÓN 162
# El candado de solo inserción corta cualquier borrado en las cinco tablas de
# mediciones. La 162 lo afina para dejar retirar lo de hace más de un día.

set -uo pipefail

echo
echo "  LIMPIEZA DE LA BASE"
echo "  ==================="
echo
echo "  Necesito la cadena de conexión. En Supabase:"
echo
echo "    Connect  →  Session pooler  →  Type: URI"
echo
echo "  OJO: «Session pooler», no «Direct connection». La directa es solo IPv6"
echo "  y este Mac no tiene IPv6: no llega a conectar."
echo
echo "  Sustituye [YOUR-PASSWORD] por tu contraseña antes de pegarla."
echo "  No se va a ver mientras la escribes, y no se guarda en ningún sitio."
echo
printf "  URI: "
read -rs URI
echo
echo

if [ -z "${URI}" ]; then
  echo "  No has pegado nada. Fuera."
  exit 1
fi

# Un aviso que ahorra un cuarto de hora de pelea: el pooler de transacciones no
# admite VACUUM, y el error que da no menciona el pooler por ningún lado.
case "$URI" in
  *:6543*)
    echo "  ESO ES EL TRANSACTION POOLER (puerto 6543) y no sirve."
    echo "  Ahí cada sentencia puede caer en una conexión distinta, y VACUUM no"
    echo "  puede correr así. Vuelve al diálogo y marca «Session pooler»."
    exit 1
    ;;
esac

ejecutar() { psql "$URI" -qtA -c "$1" 2>&1; }

echo "  Comprobando la conexión…"
ANTES=$(ejecutar "SELECT pg_size_pretty(pg_database_size(current_database()));")
if [ -z "$ANTES" ] || [[ "$ANTES" == *"error"* ]] || [[ "$ANTES" == *"FATAL"* ]]; then
  echo "  No conecta: $ANTES"
  exit 1
fi
echo "  Conectado. La base ocupa ahora: $ANTES"
echo

# ------------------------------------------------------------------
# 1 · Borrar, en tandas, hasta que deje de haber qué borrar
# ------------------------------------------------------------------
#
# EN TANDAS DE 50.000 Y NO DE GOLPE. Un DELETE de trescientas mil filas con un
# trigger de fila detrás mantiene la transacción abierta minutos enteros: se come
# el WAL, bloquea, y en Supabase acaba cortado por tiempo. En tandas cada una
# entra y confirma, y si se corta una solo se pierde esa.

borrar_en_tandas() {
  local tabla="$1" condicion="$2" total=0
  printf "  %-30s" "$tabla"
  while true; do
    local n
    n=$(ejecutar "WITH viejas AS (
           SELECT ctid FROM public.$tabla WHERE $condicion LIMIT 50000
         )
         DELETE FROM public.$tabla t USING viejas v WHERE t.ctid = v.ctid;")
    # psql -qtA devuelve «DELETE n» solo con -c y sin -q; con -qtA no devuelve
    # nada, así que se cuenta preguntando cuántas quedan.
    n=$(ejecutar "SELECT count(*) FROM public.$tabla WHERE $condicion;")
    if [ -z "$n" ]; then echo " error al contar"; return; fi
    if [ "$n" -eq 0 ]; then break; fi
    total=$((total + 1))
    printf "."
    # Una salvaguarda por si algo no avanza: veinte tandas son un millón de
    # filas. Más que eso y algo va mal, no es que quede trabajo.
    if [ "$total" -gt 20 ]; then printf " (cortado a las 20 tandas)"; break; fi
  done
  local quedan
  quedan=$(ejecutar "SELECT count(*) FROM public.$tabla;")
  printf " listo · quedan %s filas\n" "$quedan"
}

echo "  BORRANDO"
echo "  --------"
borrar_en_tandas amazon_snapshots_bsr        "fecha < now() - interval '3 days'"
borrar_en_tandas amazon_snapshots_precio     "fecha < now() - interval '3 days'"
borrar_en_tandas amazon_buybox_diagnostico   "fecha < now() - interval '3 days'"
borrar_en_tandas amazon_snapshots_inventario "fecha < now() - interval '3 days'"
borrar_en_tandas amazon_fees_estimados       "fecha < now() - interval '3 days'"
borrar_en_tandas amazon_eventos              "created_at < now() - interval '15 days'"
borrar_en_tandas cron_ejecuciones            "iniciado_at < now() - interval '15 days'"
# `terminado_at IS NULL` es un trabajo VIVO: borrarlo dejaría al motor sin saber
# por dónde iba.
borrar_en_tandas amazon_jobs "terminado_at IS NOT NULL AND terminado_at < now() - interval '15 days'"

echo
MEDIO=$(ejecutar "SELECT pg_size_pretty(pg_database_size(current_database()));")
echo "  Después de borrar: $MEDIO  (todavía no baja: falta el VACUUM)"
echo

# ------------------------------------------------------------------
# 2 · Devolver el espacio
# ------------------------------------------------------------------
#
# Postgres, al borrar, marca las filas como muertas y reutiliza ese sitio para
# lo que venga — pero no se lo devuelve al disco. Sin este paso, el número de
# Supabase se queda exactamente igual que estaba.

echo "  DEVOLVIENDO EL ESPACIO"
echo "  ----------------------"
echo "  Cada tabla se reescribe entera y se bloquea mientras. Tarda."
echo

for t in amazon_snapshots_bsr amazon_snapshots_precio amazon_buybox_diagnostico \
         amazon_snapshots_inventario amazon_fees_estimados amazon_eventos \
         cron_ejecuciones amazon_jobs; do
  printf "  %-30s" "$t"
  SALIDA=$(ejecutar "VACUUM FULL public.$t;")
  if [ -n "$SALIDA" ]; then printf "%s\n" "$SALIDA"; else printf "hecho\n"; fi
done

echo
echo "  amazon_listings va aparte: es la que usa el ciclo de stock cada quince"
echo "  minutos y la que más va a bloquear. Son 113.746 filas."
printf "  ¿La hago también? [s/N] "
read -r RESP
case "$RESP" in
  s|S|si|SI|sí|SÍ)
    printf "  %-30s" "amazon_listings"
    SALIDA=$(ejecutar "VACUUM FULL public.amazon_listings;")
    if [ -n "$SALIDA" ]; then printf "%s\n" "$SALIDA"; else printf "hecho\n"; fi
    ;;
  *) echo "  Saltada. Se puede lanzar luego con:"
     echo "    psql \"\$URI\" -c 'VACUUM FULL public.amazon_listings;'" ;;
esac

echo
DESPUES=$(ejecutar "SELECT pg_size_pretty(pg_database_size(current_database()));")
echo "  ========================================"
echo "    Antes:    $ANTES"
echo "    Ahora:    $DESPUES"
echo "  ========================================"
echo
echo "  Y no vuelve a pasar: la purga corre sola cada minuto con el cron."
echo "  Acuérdate de resetear la contraseña de la base en Supabase."
echo

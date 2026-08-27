#!/bin/bash
#
# BORRAR LOS DATOS DE UN CLIENTE
# ==============================
#
#   ./scripts/borrar-datos-cliente.sh KeslemShop
#
# Se lleva TODO lo medido de esa conexión: catálogo espejo, snapshots de precio y
# de BSR, diagnósticos, tarifas, eventos y la cola de FOEP.
#
#
# LO QUE NO BORRA, Y POR QUÉ
# --------------------------
#
#   amazon_submissions   El registro de lo que HEMOS TOCADO en la tienda de ese
#                        cliente. Es contabilidad de cambios hechos en la cuenta
#                        de otro, y sobrevive incluso a borrar la conexión —está
#                        escrito así en la migración 118 a propósito. Si hay
#                        filas, este script se para y las enseña.
#
#   La conexión          Se queda. Borrarla obligaría al cliente a AUTORIZAR
#                        OTRA VEZ, que es pedirle algo a alguien de fuera, y eso
#                        no lo decide un script de limpieza. Con las ingestas
#                        apagadas no se regenera nada; si algún día se vuelven a
#                        encender, el censo reconstruye el espejo solo.
#
#
# EL CANDADO DE LAS SERIES HAY QUE QUITARLO Y REPONERLO
# -----------------------------------------------------
# La 162 dejó pasar el borrado de filas de MÁS DE UN DÍA. Aquí hay que llevarse
# también las de hoy, así que el trigger se desactiva y se vuelve a activar al
# terminar. El `trap` de abajo lo repone aunque el script se caiga o se corte a
# medias: dejar una serie sin candado es exactamente el estado que ese candado
# existe para evitar.

set -uo pipefail

CLIENTE="${1:-}"
if [ -z "$CLIENTE" ]; then
  echo "  Uso: ./scripts/borrar-datos-cliente.sh <nombre de la conexión>"
  echo "  Por ejemplo: ./scripts/borrar-datos-cliente.sh KeslemShop"
  exit 1
fi

echo
echo "  BORRAR LOS DATOS DE: $CLIENTE"
echo "  ================================"
echo
echo "  Cadena de conexión (Supabase → Connect → Session pooler → URI),"
echo "  con [YOUR-PASSWORD] ya sustituido. No se va a ver al pegarla."
echo
printf "  URI: "
read -rs URI
echo
echo

case "$URI" in
  postgresql://*|postgres://*) ;;
  *) echo "  Eso no es la cadena de conexión: tiene que empezar por postgresql://"; exit 1 ;;
esac
case "$URI" in
  *"[YOUR-PASSWORD]"*) echo "  Todavía lleva [YOUR-PASSWORD] dentro."; exit 1 ;;
esac
case "$URI" in
  *:6543*) echo "  Ese es el Transaction pooler (6543) y no vale. Usa el Session pooler."; exit 1 ;;
esac

ejecutar() { psql "$URI" -qtA -c "$1" 2>&1; }

# ---------- Quién es ----------
CONN=$(ejecutar "SELECT id FROM public.amazon_connections WHERE name = '$CLIENTE';")
SP=$(ejecutar "SELECT selling_partner_id FROM public.amazon_connections WHERE name = '$CLIENTE';")
CLI=$(ejecutar "SELECT client_id FROM public.amazon_connections WHERE name = '$CLIENTE';")

if [ -z "$CONN" ] || [[ "$CONN" == *"error"* ]] || [[ "$CONN" == *"FATAL"* ]]; then
  echo "  No encuentro una conexión que se llame «$CLIENTE»."
  echo "  Las que hay:"
  ejecutar "SELECT '    ' || name FROM public.amazon_connections ORDER BY name;"
  exit 1
fi
echo "  Conexión encontrada: $CONN"
echo

# ---------- Lo que NO se toca ----------
ENVIOS=$(ejecutar "SELECT count(*) FROM public.amazon_submissions WHERE connection_id = '$CONN';")
if [ "$ENVIOS" != "0" ]; then
  echo "  ALTO: hay $ENVIOS envíos registrados a la tienda de este cliente."
  echo
  echo "  Eso es la contabilidad de lo que le hemos cambiado en su cuenta, y no"
  echo "  se borra desde aquí. El resto sí se puede; dime y lo hacemos dejando"
  echo "  esa tabla intacta."
  exit 1
fi

# ---------- Qué hay ----------
echo "  QUÉ SE VA A BORRAR"
echo "  ------------------"
ejecutar "
  SELECT '    ' || rpad(t, 30) || lpad(to_char(n, 'FM999G999'), 9)
  FROM (
    SELECT 'amazon_listings' t, count(*) n FROM public.amazon_listings WHERE connection_id = '$CONN'
    UNION ALL SELECT 'amazon_snapshots_precio', count(*) FROM public.amazon_snapshots_precio WHERE connection_id = '$CONN'
    UNION ALL SELECT 'amazon_snapshots_bsr', count(*) FROM public.amazon_snapshots_bsr WHERE selling_partner_id = '$SP'
    UNION ALL SELECT 'amazon_buybox_diagnostico', count(*) FROM public.amazon_buybox_diagnostico WHERE connection_id = '$CONN'
    UNION ALL SELECT 'amazon_fees_estimados', count(*) FROM public.amazon_fees_estimados WHERE connection_id = '$CONN'
    UNION ALL SELECT 'amazon_snapshots_inventario', count(*) FROM public.amazon_snapshots_inventario WHERE connection_id = '$CONN'
    UNION ALL SELECT 'amazon_buybox_cola_foep', count(*) FROM public.amazon_buybox_cola_foep WHERE connection_id = '$CONN'
    UNION ALL SELECT 'amazon_eventos', count(*) FROM public.amazon_eventos WHERE connection_id = '$CONN'
  ) x WHERE n > 0 ORDER BY n DESC;"
echo
echo "  La CONEXIÓN se queda. Las ingestas ya están apagadas, así que no se"
echo "  regenera nada; si algún día se encienden, el censo reconstruye el espejo."
echo
printf "  Escribe BORRAR para seguir: "
read -r OK
if [ "$OK" != "BORRAR" ]; then echo "  Cancelado. No se ha tocado nada."; exit 0; fi
echo

ANTES=$(ejecutar "SELECT pg_size_pretty(pg_database_size(current_database()));")

# ---------- El candado, fuera y luego dentro ----------
SERIES="amazon_snapshots_precio amazon_snapshots_bsr amazon_snapshots_inventario amazon_fees_estimados amazon_buybox_diagnostico"

reponer_candado() {
  echo
  echo "  Reponiendo el candado de las series…"
  for t in $SERIES; do
    ejecutar "ALTER TABLE public.$t ENABLE TRIGGER trg_${t}_purga;" >/dev/null
  done
  echo "  Repuesto."
}
# Aunque esto se caiga o lo cortes con Ctrl-C. Una serie sin candado es el
# estado que el candado existe para evitar.
trap reponer_candado EXIT INT TERM

echo "  Quitando el candado de las series (se repone al terminar)…"
for t in $SERIES; do
  ejecutar "ALTER TABLE public.$t DISABLE TRIGGER trg_${t}_purga;" >/dev/null
done
echo

# ---------- Borrar ----------
borrar() {
  local tabla="$1" cond="$2"
  printf "  %-30s" "$tabla"
  while true; do
    ejecutar "WITH v AS (SELECT ctid FROM public.$tabla WHERE $cond LIMIT 50000)
              DELETE FROM public.$tabla t USING v WHERE t.ctid = v.ctid;" >/dev/null
    local n; n=$(ejecutar "SELECT count(*) FROM public.$tabla WHERE $cond;")
    if [ -z "$n" ] || [[ "$n" != [0-9]* ]]; then printf " error: %s\n" "$n"; return; fi
    if [ "$n" -eq 0 ]; then break; fi
    printf "."
  done
  printf " hecho\n"
}

echo "  BORRANDO"
echo "  --------"
borrar amazon_snapshots_bsr        "selling_partner_id = '$SP'"
borrar amazon_snapshots_precio     "connection_id = '$CONN'"
borrar amazon_buybox_diagnostico   "connection_id = '$CONN'"
borrar amazon_fees_estimados       "connection_id = '$CONN'"
borrar amazon_snapshots_inventario "connection_id = '$CONN'"
borrar amazon_buybox_cola_foep     "connection_id = '$CONN'"
borrar amazon_eventos              "connection_id = '$CONN'"
borrar amazon_listings             "connection_id = '$CONN'"
[ -n "$CLI" ] && borrar amazon_jobs "client_id = '$CLI' AND terminado_at IS NOT NULL"

# El trap lo repone, pero se hace aquí también para que el VACUUM corra ya con
# el candado puesto y no en una ventana sin él.
trap - EXIT INT TERM
reponer_candado
echo

# ---------- Devolver el espacio ----------
echo "  DEVOLVIENDO EL ESPACIO"
echo "  ----------------------"
for t in amazon_snapshots_bsr amazon_snapshots_precio amazon_buybox_diagnostico \
         amazon_fees_estimados amazon_snapshots_inventario amazon_buybox_cola_foep \
         amazon_eventos amazon_listings amazon_jobs; do
  printf "  %-30s" "$t"
  S=$(ejecutar "VACUUM FULL public.$t;")
  if [ -n "$S" ]; then printf "%s\n" "$S"; else printf "hecho\n"; fi
done

echo
DESPUES=$(ejecutar "SELECT pg_size_pretty(pg_database_size(current_database()));")
echo "  ========================================"
echo "    Antes:  $ANTES"
echo "    Ahora:  $DESPUES"
echo "  ========================================"
echo
echo "  La conexión de $CLIENTE sigue ahí, con las ingestas apagadas."
echo "  Para quitarla del todo —y que el cliente tenga que volver a autorizar—"
echo "  se hace desde Amazon API · Cuentas, con el botón Desconectar."
echo

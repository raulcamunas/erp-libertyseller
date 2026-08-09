/**
 * PAGINACIÓN DE CONSULTAS · POR QUÉ EXISTE ESTE FICHERO
 * =====================================================
 * PostgREST corta CUALQUIER consulta a 1000 filas. No da error, no avisa y no
 * pone ninguna marca en la respuesta: devuelve 1000 filas y se queda tan
 * ancho. Un `.limit(5000)` NO lo salta. Medido contra la base de producción de
 * este ERP el 2026-08-09:
 *
 *   tracker_logs    6993 filas existen -> 1000 vuelven
 *   appointments    5853 filas existen -> 1000 vuelven
 *   cold_leads      3978 filas existen -> 1000 vuelven
 *   cold_lead_notes 2675 filas existen -> 1000 vuelven
 *
 * O sea que la pantalla enseña menos de lo que hay y NADIE se entera. Eso no
 * es lentitud, es un dato incorrecto: un total de horas más bajo del real, un
 * SKU que se queda sin refrescar, un lead que no aparece en la lista.
 *
 * En este repositorio ya existen cuatro copias de esta misma función
 * (lib/employees/data.ts, lib/plataforma/datos.ts, lib/amazon/data.ts y
 * lib/stock-sync/api.ts). Se copiaron a mano y a propósito, porque importarlas
 * arrastraría el módulo entero: el de empleados se trae el cálculo de nóminas
 * y el de plataforma el cliente de service_role. Este fichero NO importa nada
 * —ni Supabase, ni tipos, ni configuración— justamente para poder usarse
 * desde los tres sitios donde aquellas cuatro no valen:
 *
 *   - páginas de servidor, que consultan con el cliente con sesión (RLS);
 *   - componentes de cliente, donde importar lib/employees/data.ts metería la
 *     clave de service_role en el bundle del navegador;
 *   - y cualquier módulo que no quiera una dependencia nueva por paginar.
 *
 * Las cuatro copias existentes se dejan como están: funcionan, están probadas
 * y reescribirlas sería mover código sin arreglar nada.
 */

/** PostgREST corta a 1000 filas y un `.limit()` mayor NO lo salta */
export const PAGE = 1000

/**
 * Recorre una consulta por tramos hasta traerla entera.
 *
 * EL ORDEN LO FIJA QUIEN LLAMA Y TIENE QUE TERMINAR SIEMPRE EN UNA COLUMNA
 * ÚNICA (normalmente `id`). No es un detalle de estilo: `.range()` sobre un
 * orden con empates es un orden indefinido entre tramos, así que Postgres
 * puede devolver la misma fila dos veces y saltarse otra. Paginar por
 * `work_date` a secas —donde varias personas apuntan el mismo día— pierde
 * filas de forma más silenciosa todavía que el corte de 1000 que viene a
 * arreglar.
 *
 * Si un tramo falla, LANZA en vez de devolver lo que llevaba. Devolver medio
 * resultado es exactamente el problema que este fichero existe para evitar:
 * medio catálogo es indistinguible de un catálogo entero mirando la pantalla.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

/**
 * Igual que `fetchAll`, pero SIN LANZAR: si un tramo falla, lo registra y
 * devuelve una lista vacía.
 *
 * NO ES UN «por si acaso»: es lo que EXIGE no cambiar el comportamiento de las
 * pantallas donde se usa. Esas páginas —LinkedIn, Mis Horas, el desglose de la
 * agenda y el CRM— hacían a propósito `const { data } = await ...` o incluso
 * `if (error) { console.error(...) }` sin cortar, y seguían pintando el tablero
 * con listas vacías. Con `fetchAll` a secas, un fallo de PostgREST pasó a
 * propagarse hasta app/dashboard/error.tsx, o sea que durante una caída de
 * Supabase la persona dejaba de ver un tablero vacío y pasaba a ver una
 * pantalla de error. Eso es un cambio visible que nadie pidió.
 *
 * NO devuelve lo que llevara acumulado: devuelve []. Media lista es
 * indistinguible de una lista entera mirando la pantalla, y ese es justo el
 * problema que este fichero existe para evitar. Vacío se ve.
 *
 * Donde el que llama SÍ quiere que un fallo corte —una ruta de API que escribe,
 * la sincronización con Google— se usa `fetchAll`, que lanza.
 */
export async function fetchAllTolerante<T>(
  etiqueta: string,
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  try {
    return await fetchAll<T>(build)
  } catch (error) {
    console.error(`[paginacion] ${etiqueta}: la consulta ha fallado, se sigue con lista vacía:`, error)
    return []
  }
}

/**
 * Trocea una lista de ids para un `.in(...)`.
 *
 * PostgREST manda el `.in()` en la URL, así que una lista larga revienta por
 * tamaño de cabecera ANTES de llegar a la base. Medido en este proyecto con
 * ids del largo real de los external_id de Wise (~64 caracteres):
 *
 *   100 ids -> bien (136 ms)
 *   300 ids -> TypeError: fetch failed / UND_ERR_HEADERS_OVERFLOW
 *   500 ids -> 400 Bad Request
 *
 * Por eso agrupar un N+1 en un solo `.in()` no basta: hay que trocearlo, o el
 * arreglo revienta justo con el volumen que venía a arreglar. 100 es el tramo
 * que se midió como seguro incluso con los ids más largos del repositorio.
 */
export function trocear<T>(items: T[], tam = 100): T[][] {
  const trozos: T[][] = []
  for (let i = 0; i < items.length; i += tam) trozos.push(items.slice(i, i + tam))
  return trozos
}

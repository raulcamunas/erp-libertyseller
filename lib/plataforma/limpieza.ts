/**
 * LA PURGA
 * ========
 * SOLO SERVIDOR.
 *
 * Este ERP escribía unas SESENTA MIL FILAS AL DÍA y no borraba ni una. No es una
 * exageración, es lo que había el 27 de agosto de 2026 cuando la base se pasó
 * del plan gratis al 177 %:
 *
 *     amazon_snapshots_precio     ~149.000 filas AL DÍA
 *     amazon_snapshots_bsr        ~110.000 filas AL DÍA
 *     amazon_buybox_diagnostico    ~77.000 filas AL DÍA
 *     amazon_fees_estimados        ~30.000 filas AL DÍA
 *
 * TRESCIENTAS SESENTA MIL AL DÍA. Y esa cifra hay que mirarla sabiendo de dónde
 * sale: el 75 % es de UN cliente. KeslemShop tiene 102.954 referencias en cuatro
 * países, y cada pasada de cada trabajo escribe una fila POR REFERENCIA.
 *
 *     BSR           205.279 de 243.535 son suyas   (84 %)
 *     precios       182.852 de 265.120             (69 %)
 *     diagnostico    91.508 de 137.678             (66 %)
 *
 * Con ese ritmo no se llena el plan gratis: se llena cualquier plan.
 *
 *
 * ============ Y LA RETENCIÓN SOLA NO LO ARREGLA ============
 *
 * Esto se descubrió purgando: después de retirar TODO lo de más de tres días, la
 * base seguía en 802 MB y las tablas casi igual de llenas. Porque a 360.000
 * filas al día, tres días son un millón de filas — la retención estaba haciendo
 * su trabajo y aun así no cabía.
 *
 * Los plazos de abajo bajan a uno o dos días, que es DOS PASADAS del trabajo que
 * escribe cada tabla. Pero lo que de verdad decide es cuánto se escribe, y eso
 * se decide APAGANDO TRABAJOS en Ingesta, cliente por cliente. Un trabajo que
 * mide algo que nadie mira cuesta lo mismo que uno que sirve.
 *
 *
 * ============ CADA PLAZO SALE DE QUIÉN LEE ESA TABLA ============
 *
 * Los números de abajo no son «una semana está bien». Cada uno es lo que
 * necesita el código que lee esa tabla, y ponerlos más cortos rompe algo
 * concreto:
 *
 *   PRECIO Y DIAGNÓSTICO · 3 días
 *     Aquí iban a ser cinco: el diagnóstico de Buy Box no mira la última
 *     lectura, mira si hay N SEGUIDAS perdiéndola, y para eso hay que guardar N.
 *     Ese diagnóstico se ha APAGADO —«no la voy a usar con los clientes»— así
 *     que ya no hace falta más que la última. Tres días y no uno para que una
 *     pasada fallida no deje a un SKU sin ninguna fila.
 *     Lo que sí sigue vivo es saber QUIÉN tiene la Buy Box, que sale de la
 *     última fila y es lo que lee el motor de precios.
 *
 *   BSR · 3 días
 *     Aquí sí basta con la última: la pantalla enseña el puesto de hoy y la
 *     evolución. La evolución se pierde, y es una decisión tomada con el dueño
 *     del dato delante —«el historial de BSR me da igual, ya usaré Keepa»—.
 *     Tres días y no uno porque la medición es diaria y un día justo se queda
 *     sin ninguna fila si una pasada falla.
 *
 *   TARIFAS · 3 días
 *     La tabla es de solo inserción, una fila por SKU y pasada, y el motor de
 *     precios se queda SIEMPRE con la última de cada SKU. Las anteriores no las
 *     lee nadie. El trabajo corre cada veinte horas, así que tres días
 *     garantizan al menos una fila por SKU aunque falle una pasada.
 *
 *   REGISTROS · 15 días
 *     Eventos, ejecuciones del cron y trabajos. Son el rastro que se mira
 *     cuando algo falla, y eso se mira en horas o en días, no en semanas.
 *
 *
 * ============ BORRAR NO DEVUELVE EL ESPACIO, Y HAY QUE SABERLO ============
 *
 * Postgres marca las filas como muertas y reutiliza ese sitio para lo que venga
 * después, pero NO se lo devuelve al disco. O sea: esto detiene el crecimiento
 * —que es el problema de verdad— y no baja la cifra de «Database Size» del
 * panel de Supabase.
 *
 * Para que baje hace falta un `VACUUM FULL`, que reescribe la tabla entera y la
 * bloquea mientras lo hace. Eso NO se lanza desde aquí: bloquear
 * `amazon_listings` en mitad de un ciclo de stock es peor que la cifra fea. Va
 * en supabase/consultas/limpieza_a_fondo.sql, para lanzarlo a mano y con calma.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/stock-sync/perfiles'

/** Qué se purga, cuántos días se guardan, y por qué columna se mide */
const REGLAS: { tabla: string; columna: string; dias: number }[] = [
  // Cada plazo es DOS PASADAS del trabajo que la escribe, ni una más. Ver la
  // nota de arriba: con este volumen, un día de más son cien mil filas.
  { tabla: 'amazon_snapshots_precio', columna: 'fecha', dias: 1 },
  { tabla: 'amazon_snapshots_bsr', columna: 'fecha', dias: 2 },
  { tabla: 'amazon_snapshots_inventario', columna: 'fecha', dias: 2 },
  { tabla: 'amazon_fees_estimados', columna: 'fecha', dias: 2 },
  { tabla: 'amazon_buybox_diagnostico', columna: 'fecha', dias: 1 },
  { tabla: 'amazon_eventos', columna: 'created_at', dias: 15 },
  /**
   * Desde que el ciclo apunta TODAS las pasadas —también las que no tenían nada
   * que hacer— esta tabla crece de verdad: 48 filas al día por cliente. Sin
   * plazo eran unas 70.000 al año, con su JSONB de fases dentro, en una base que
   * ya se pasó de cuota una vez.
   *
   * 30 días y no 15 porque este es el historial que se mira para reconstruir qué
   * le pasó a la cuenta de un cliente, y un mes es lo que se tarda en darse
   * cuenta de que algo lleva raro desde hace semanas.
   */
  { tabla: 'stock_profile_runs', columna: 'created_at', dias: 30 },
  /**
   * Los encargos de marketing NO guardan ningun Excel —se arma al descargarlo—
   * asi que aqui no se libera espacio de ficheros: lo que se quita son filas.
   *
   * 30 dias y no 7: lo que caduca de verdad es el informe en el lado de Amazon,
   * y borrar la fila antes solo consigue perder el enlace a algo que todavia se
   * podia bajar. Las partes se van solas por la clave foranea.
   */
  { tabla: 'marketing_informes', columna: 'pedido_at', dias: 30 },
  { tabla: 'cron_ejecuciones', columna: 'iniciado_at', dias: 15 },
  // Los trabajos TERMINADOS. Los vivos no se tocan: `terminado_at` a null es
  // justo lo que distingue «acabó hace un mes» de «está corriendo ahora», y
  // borrar uno en marcha dejaría al motor sin saber por dónde iba.
  { tabla: 'amazon_jobs', columna: 'terminado_at', dias: 15 },
]

/**
 * Las cinco tablas de medición: las que crecen de verdad y las que se purgan con
 * la función de la base. Ver la nota de dentro de limpiar().
 */
const SERIES = new Set([
  'amazon_snapshots_precio',
  'amazon_snapshots_bsr',
  'amazon_snapshots_inventario',
  'amazon_fees_estimados',
  'amazon_buybox_diagnostico',
])

export interface ResultadoLimpieza {
  tabla: string
  borradas: number
  error: string | null
}

/**
 * Borra lo que ya nadie va a leer.
 *
 * `tope` acota cuántas filas se quitan de cada tabla en una pasada. Existe
 * porque el primer barrido tiene que retirar cientos de miles y un DELETE de ese
 * tamaño mantiene una transacción abierta minutos enteros: bloquea, se come el
 * WAL y puede irse por tiempo dejando el trabajo a medias. En tandas se tarda
 * varias pasadas y no se nota nada.
 */
export async function limpiar(tope = 20_000): Promise<ResultadoLimpieza[]> {
  const service = createServiceClient()
  const salida: ResultadoLimpieza[] = []

  for (const regla of REGLAS) {
    const corte = new Date(Date.now() - regla.dias * 86_400_000).toISOString()
    try {
      /**
       * LAS SERIES SE PURGAN EN LA BASE, NO LEYENDO IDS.
       *
       * Más abajo se eligen los identificadores y luego se borran, porque
       * PostgREST no admite LIMIT en un DELETE. Con tablas pequeñas funciona;
       * con `amazon_snapshots_precio` a 314.000 filas ese SELECT se iba por
       * statement timeout —57014— y la purga fallaba EN SILENCIO cada minuto.
       * Nadie se enteró porque el error se queda en este resultado, y este
       * resultado no lo lee nadie.
       *
       * `purgar_serie` (migración 175) hace el DELETE acotado por ctid dentro de
       * la base: una sola ida y vuelta y ningún identificador viajando. Si la
       * migración no está aplicada, se sigue por el camino de siempre.
       */
      if (SERIES.has(regla.tabla)) {
        const { data, error } = await service.rpc('purgar_serie', {
          p_tabla: regla.tabla,
          p_dias: regla.dias,
          p_tope: tope,
        })
        if (!error) {
          salida.push({ tabla: regla.tabla, borradas: Number(data ?? 0), error: null })
          continue
        }
        if (!isMissingSchema(error)) {
          salida.push({ tabla: regla.tabla, borradas: 0, error: error.message })
          continue
        }
      }

      /**
       * SE ELIGEN LOS IDS PRIMERO Y SE BORRAN DESPUÉS.
       *
       * Un `.delete().lt(fecha, corte)` a secas no admite límite en PostgREST, y
       * sin límite el primer barrido intentaría llevarse trescientas mil filas
       * de una vez. Con dos pasos se acota de verdad.
       */
      const { data: viejas, error: errorLeer } = await service
        .from(regla.tabla)
        .select('id')
        .lt(regla.columna, corte)
        .limit(tope)
      if (errorLeer) {
        salida.push({ tabla: regla.tabla, borradas: 0, error: errorLeer.message })
        continue
      }

      const ids = (viejas ?? []).map((f) => (f as { id: string }).id)
      if (ids.length === 0) {
        salida.push({ tabla: regla.tabla, borradas: 0, error: null })
        continue
      }

      // De mil en mil: una lista de veinte mil identificadores dentro de un
      // `in()` se pasa del tamaño de URL que aguanta PostgREST.
      let borradas = 0
      for (let i = 0; i < ids.length; i += 1000) {
        const { error } = await service
          .from(regla.tabla)
          .delete()
          .in('id', ids.slice(i, i + 1000))
        if (error) {
          /**
           * EL CANDADO DE LAS SERIES, DICHO CON SU NOMBRE.
           *
           * Las cinco tablas de mediciones tienen desde la 123 un trigger que
           * corta cualquier borrado, y la 162 es la que lo afina para dejar
           * pasar la retención. Sin ella esto falla cada minuto con un
           * `restrict_violation` que no menciona ninguna migración, y a las tres
           * semanas nadie se acuerda de qué había que aplicar.
           */
          const esCandado = /solo insercion|solo inserción|serie temporal/i.test(error.message)
          salida.push({
            tabla: regla.tabla,
            borradas,
            error: esCandado
              ? `El candado de series lo impide. Falta aplicar la migración 162 (${error.message.slice(0, 120)})`
              : error.message,
          })
          borradas = -1
          break
        }
        borradas += Math.min(1000, ids.length - i)
      }
      if (borradas >= 0) salida.push({ tabla: regla.tabla, borradas, error: null })
    } catch (e) {
      salida.push({
        tabla: regla.tabla,
        borradas: 0,
        error: e instanceof Error ? e.message : 'error desconocido',
      })
    }
  }

  return salida
}

/** Los plazos, para poder enseñarlos en pantalla sin repetirlos a mano */
export const PLAZOS = REGLAS.map((r) => ({ tabla: r.tabla, dias: r.dias }))

/**
 * EL CICLO COMPLETO, DE UNA PIEZA.
 *
 *   origen -> lector -> reglas -> cruce -> contraste con Amazon -> frenos
 *
 * Es el único sitio donde se juntan todas las piezas, y por eso es corto: cada
 * una hace su trabajo y ninguna sabe de las demás. El cruce sigue sin enterarse
 * de que existen los perfiles, los frenos siguen sin saber de dónde salió el
 * fichero, y el conector de Drive no ha oído hablar de Amazon.
 *
 * ESTE FICHERO NO DECIDE ENVIAR, Y ESA DISTINCIÓN ES TODA LA SEGURIDAD DE LA
 * AUTOMATIZACIÓN. Deja preparado exactamente lo que se mandaría —en el formato
 * que consume sendChanges()— y solo lo manda si quien llama le pasa la función
 * `enviar`. Sin ese parámetro no hay ningún camino, ni uno, por el que esto
 * escriba en la tienda de un cliente: la ruta del simulacro no lo pasa nunca y
 * el ciclo automático solo lo pasa cuando el perfil tiene el envío encendido a
 * conciencia (decisión E: la escritura de PRECIO contra Amazon todavía no se ha
 * validado con una cuenta real).
 *
 * Y REGISTRA SIEMPRE. Una lectura que no cambió nada, una que saltó un freno y
 * una que falló dejan las tres su fila en stock_profile_runs. Si solo se
 * guardaran los envíos, un cliente frenado tres días seguidos parecería un
 * cliente sin novedades.
 */

import { createHash } from 'node:crypto'
import {
  loadConnection,
  loadListings,
  pickMarketplace,
  refrescarListingsPorSku,
} from '@/lib/amazon/data'
import { createServiceClient } from '@/lib/supabase/service'
import { marketplaceById, type AmazonListing } from '@/lib/types/amazon'
import type { StockProfileRunState, StockReadProfile } from '@/lib/types/stock-sync'
import {
  crossStock,
  normalizeHeader,
  StockSyncError,
  type CrossMapping,
  type EanIndex,
  type WorkbookInput,
} from './engine'
import {
  leerEan,
  leerStock,
  perfilDesdeFila,
  type ColumnasPerfil,
  type IndiceColumnas,
  type LecturaStock,
} from './lector'
import { conectorDe, OrigenError, type FicheroOrigen } from './origenes'
import { textoConfig } from './origenes/tipos'
import { segundoAdjunto } from './origenes/correo'
import { loadPerfilEan, marcarPerfil, registrarRun } from './perfiles'
import { SIGUIENTE_PASO, type FaseRegistrada } from '@/lib/types/stock-sync'
import { aplicarReglas, reglasDesdeFila, type ResultadoReglas } from './reglas'
import { umbralesDesdeFila } from './frenos'
import { simular, type Simulacro } from './simulacro'

/**
 * Tope de tamaño por fichero, venga de donde venga.
 *
 * Es el mismo número que aplica la subida a mano (lib/stock-sync/api.ts) y por
 * la misma razón: el volcado real son 2 MB, 20 deja sitio de sobra para que
 * crezca, y a la vez impide que un fichero equivocado se coma la memoria del
 * contenedor, que es compartida con el resto del ERP.
 */
export const MAX_FICHERO_BYTES = 20 * 1024 * 1024

/** Un fichero que llega en la petición, ya leído a bytes */
export interface SubidaManual {
  nombre: string
  bytes: ArrayBuffer
  tamano: number
}

export interface OpcionesProceso {
  perfil: StockReadProfile
  /** El fichero de stock, cuando el perfil es de subida a mano */
  subida?: SubidaManual | null
  /** El fichero de códigos de barras, opcional pero muy recomendable */
  subidaEan?: SubidaManual | null
  /**
   * El fichero ya traído del origen. Lo usa el ciclo automático, que necesita
   * mirarle la huella ANTES de decidir si merece la pena procesarlo. Sin esto
   * habría que bajarlo dos veces del origen del cliente.
   */
  fichero?: FicheroTraido | null
  /** Quién lo lanzó. null = lo lanzó el proceso automático, que no es nadie */
  userId?: string | null
  /** Entra por parámetro: una función que mira el reloj no se puede comprobar */
  ahora?: Date
  /**
   * LA ÚNICA PUERTA POR LA QUE UN SIMULACRO SE CONVIERTE EN UN ENVÍO.
   *
   * Se llama después de los frenos y solo si se puede enviar y hay algo que
   * enviar. Que sea un parámetro y no una condición interna es lo que hace
   * imposible mandar nada por descuido: la ruta del simulacro no lo pasa, así
   * que por ahí no se puede escribir en la tienda de un cliente ni cambiando un
   * booleano de la base.
   *
   * Devolver null significa «se ha decidido no enviar»: la ejecución queda como
   * simulacro. Lanzar significa que el envío falló y la ejecución queda en
   * error, con su fila en el historial.
   */
  enviar?: (antes: AntesDeEnviar) => Promise<EnvioRealizado | null>
}

/** Lo que hay sobre la mesa en el momento de decidir si se manda */
export interface AntesDeEnviar {
  perfil: StockReadProfile
  /** null = el perfil no apunta a ninguna conexión, así que no hay a dónde mandar */
  destino: DestinoProceso | null
  fichero: FicheroProcesado
  simulacro: Simulacro
}

/** Cómo fue el envío. Lo devuelve quien envía; este fichero solo lo registra */
export interface EnvioRealizado {
  batchId: string
  aceptados: number
  fallidos: number
  /** Por qué se cortó el lote antes de terminar, si se cortó */
  abortado: string | null
}

/** Cómo se identifica el fichero que se procesó, sin los bytes */
export interface FicheroProcesado {
  nombre: string
  idExterno: string | null
  huella: string | null
  modificadoAt: string | null
  tamano: number
  /** SHA-256 de los bytes que se han leído. Es con lo que se decide si es nuevo */
  huellaContenido: string
}

/** Un fichero del origen con la huella de su contenido ya calculada */
export interface FicheroTraido extends FicheroOrigen {
  huellaContenido: string
}

export interface DestinoProceso {
  connectionId: string
  connectionName: string
  marketplaceId: string
}

/** De dónde se leyó: hoja, fila de cabecera y qué columna se usó para cada campo */
/**
 * Lo que se guarda de una lectura en el historial de la ejecución.
 *
 * Fuera `lineas` —el catálogo entero no cabe— y fuera `muestraCruda`: esas
 * quince filas en crudo son DATOS DEL CLIENTE y existen solo para la pantalla de
 * configuración, donde alguien las está mirando en ese momento. Guardarlas en
 * cada ejecución sería dejar trozos del fichero de un cliente en una tabla que
 * crece para siempre, para nada.
 */
export type ResumenLectura = Omit<LecturaStock, 'lineas' | 'muestraCruda'>

/** Qué hicieron las reglas, con la lista de descartadas ya recortada */
export interface ResumenReglas
  extends Omit<ResultadoReglas, 'lineas' | 'descartadas' | 'sinPrecio'> {
  descartadas: ResultadoReglas['descartadas']
  /** Cuántas hubo de verdad, que casi nunca son las que viajan */
  descartadasTotal: number
  /** Las que mandan stock pero no precio, recortadas igual */
  sinPrecio: ResultadoReglas['sinPrecio']
  sinPrecioTotal: number
}

/** Cuántas líneas descartadas viajan de vuelta. Los totales van aparte y completos */
const MAX_DESCARTADAS = 200

export interface ResultadoProceso {
  fichero: FicheroProcesado
  lectura: ResumenLectura
  reglas: ResumenReglas
  /** null cuando el perfil todavía no apunta a ninguna conexión de Amazon */
  destino: DestinoProceso | null
  simulacro: Simulacro
  /** Id de la fila de stock_profile_runs, si se pudo registrar */
  runId: string | null
  /** true si el fichero es el mismo que ya procesó el ciclo automático */
  mismoFichero: boolean
  /** Cómo acabó: es lo que se ha guardado en la fila de la ejecución */
  estado: StockProfileRunState
  /** null salvo que se haya enviado de verdad */
  envio: EnvioRealizado | null
  /**
   * Líneas con código que traía el fichero, ANTES de las reglas. Es el número
   * con el que se calibra el freno de caída, así que sale a la superficie.
   */
  lineasLeidas: number
  duracionMs: number
}

/* ------------------------------------------------------------------ */
/* Traer el fichero y ponerle huella                                   */
/* ------------------------------------------------------------------ */

/**
 * Trae el fichero del origen del perfil y le calcula la huella del CONTENIDO.
 *
 * POR QUÉ SE VUELVE A CALCULAR AQUÍ EN VEZ DE FIARSE DE LA DEL ORIGEN.
 *
 * Drive da un md5 y es tentador usarlo: es content-based y sale gratis. Pero
 * ese md5 viene de LISTAR la carpeta y los bytes vienen de una descarga
 * POSTERIOR. Si el cliente reemplaza el fichero entre las dos llamadas —y un
 * volcado automático se reemplaza solo, a su hora—, se guardaría como huella la
 * del fichero A habiendo procesado el fichero B, y la siguiente pasada creería
 * que B ya está hecho y no lo procesaría NUNCA. El SHA-256 de los bytes que se
 * han leído de verdad no puede mentir sobre lo que se ha leído.
 *
 * Y es lo que pedía el encargo: por CONTENIDO, no por fecha de modificación.
 * En Drive la fecha se mueve porque alguien abre el fichero y lo vuelve a
 * guardar sin tocar nada, y eso dispararía un reproceso —y un envío a Amazon—
 * por nada.
 *
 * El único caso en que esta huella se mueve sin que el contenido cambie es una
 * hoja NATIVA de Google: se exporta a .xlsx en cada lectura y un .xlsx es un
 * zip, que lleva fechas dentro. Ahí se reprocesará de más; no es grave y se
 * apaga solo, porque el contraste contra el espejo del catálogo dirá que no hay
 * ningún cambio que mandar y la ejecución quedará como «sin cambios».
 */
export async function traerFichero(
  perfil: StockReadProfile,
  subida?: SubidaManual | null,
  /**
   * Solo la ruta de descarga a mano. Trae los bytes aunque el fichero esté
   * roto, porque mirarlo es justo lo que hace falta cuando lo está. Nada de lo
   * que se trae así se procesa: va al navegador y ahí acaba. Ver
   * `aunqueEsteRoto` en origenes/tipos.ts.
   */
  opciones?: { aunqueEsteRoto?: boolean }
): Promise<FicheroTraido> {
  const conector = conectorDe(perfil.origen)
  const fichero = await conector.traer({
    config: (perfil.origen_config ?? {}) as Record<string, unknown>,
    perfil: perfil.name,
    aunqueEsteRoto: opciones?.aunqueEsteRoto === true,
    // El id, no solo el nombre: es la llave de la credencial cifrada del origen
    // (stock_origen_credenciales, migración 124). Sin él, un perfil de SFTP no
    // encuentra su contraseña y el ciclo automático no podría leer nada.
    perfilId: perfil.id,
    maxBytes: MAX_FICHERO_BYTES,
    subida: subida ? { nombre: subida.nombre, bytes: subida.bytes, tamano: subida.tamano } : null,
  })

  return { ...fichero, huellaContenido: huellaDeContenido(fichero.bytes) }
}

/** SHA-256 en hexadecimal, con prefijo para que se sepa de dónde salió */
export function huellaDeContenido(bytes: WorkbookInput): string {
  const buffer =
    bytes instanceof ArrayBuffer
      ? Buffer.from(bytes)
      : // Un Uint8Array puede ser una VENTANA sobre un buffer más grande;
        // Buffer.from(u8) copiaría la ventana pero Buffer.from(u8.buffer) se
        // llevaría el buffer entero y la huella no sería la del fichero.
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`
}

/**
 * Lee el fichero de un perfil y calcula qué se mandaría, SIN mandarlo.
 *
 * Lanza StockSyncError (problema del fichero: se arregla mirando el Excel) u
 * OrigenError (problema de acceso: se arregla en Drive o en el servidor). Las
 * rutas los traducen a un 400 con el texto tal cual, porque los dos están
 * escritos para que quien los lea sepa qué hacer.
 */
export async function procesarPerfil(opciones: OpcionesProceso): Promise<ResultadoProceso> {
  const ahora = opciones.ahora ?? new Date()
  const arranque = Date.now()
  const { perfil } = opciones

  if (perfil.tipo !== 'stock') {
    throw new StockSyncError(
      `El perfil «${perfil.name}» es de códigos de barras, no de stock. El que se procesa es el de stock; el de EAN lo usa como apoyo.`
    )
  }

  /**
   * EL CRONÓMETRO POR PASOS.
   *
   * Se va rellenando según avanza y viaja DENTRO de la fila de la ejecución, en
   * la inserción que ya se hacía: no cuesta ni una escritura más. Ver la
   * migración 165.
   *
   * Sirve para una pregunta muy concreta que hasta ahora no tenía respuesta:
   * cuando una pasada tarda treinta segundos en vez de dos, ¿es el proveedor que
   * no contesta o es Amazon? Con un único `duracion_ms` las dos se ven igual.
   */
  const fases: FaseRegistrada[] = []
  let marca = arranque
  const anotar = (
    paso: FaseRegistrada['paso'],
    estado: FaseRegistrada['estado'],
    cifra: number | null = null,
    nota: string | null = null
  ) => {
    const t = Date.now()
    fases.push({ paso, estado, ms: t - marca, cifra, nota })
    marca = t
  }

  // ---------- 1) El fichero, venga de donde venga ----------
  // El ciclo automático ya lo ha traído para poder mirarle la huella antes de
  // decidir si valía la pena procesarlo; bajarlo otra vez sería pedirle al
  // cliente el mismo fichero dos veces en la misma pasada.
  const fichero = opciones.fichero ?? (await traerFichero(perfil, opciones.subida))
  anotar('origen', 'ok', fichero.tamano ?? null, fichero.nombre)

  const mismoFichero = fichero.huellaContenido === perfil.last_file_fingerprint

  try {
    // ---------- 2) Leer con el perfil del cliente ----------
    const lectura = leerStock(fichero.bytes, perfilDesdeFila(perfil))

    // ---------- 3) Las reglas de negocio ----------
    const reglas = reglasDesdeFila(perfil)
    const aplicadas = aplicarReglas(lectura.lineas, reglas, ahora)
    anotar(
      'leer',
      'ok',
      aplicadas.lineas.length,
      aplicadas.descartadas.length > 0
        ? `${lectura.lineas.length} líneas leídas, ${aplicadas.descartadas.length} descartadas por las reglas`
        : `${lectura.lineas.length} líneas leídas`
    )

    // ---------- 4) Los códigos de barras, si los hay ----------
    const ean = await construirEanIndex(perfil, opciones.subidaEan ?? null, fichero.idExterno)

    // ---------- 5) El espejo del catálogo de Amazon ----------
    // Va ANTES del cruce porque cuando el cliente no tiene tabla de mapeo es el
    // propio catálogo el que hace de diccionario. Ver resolverMapeo().
    const { destino, listings, refrescadoEn } = await cargarEspejo(perfil)

    // ---------- 6) El cruce ----------
    const mapeo = resolverMapeo(await cargarMapeo(perfil.client_id), listings)
    const cruce = crossStock({
      mappings: mapeo.filas,
      // LineaAplicada ES una StockLine: los cuatro campos que consume el cruce
      // están en su sitio y en su forma. No se convierte nada.
      stockLines: aplicadas.lineas,
      eanIndex: ean.indice,
    })
    anotar(
      'cruzar',
      cruce.stats.matched > 0 ? 'ok' : 'aviso',
      cruce.stats.matched,
      `${cruce.stats.matched} referencias casadas con SKU de Amazon` +
        (cruce.stats.unmatched > 0 ? `, ${cruce.stats.unmatched} sin casar` : '')
    )

    /**
     * ---------- 6 bis) AMAZON, LEÍDO AHORA MISMO ----------
     *
     * Aquí estaba el agujero grande de este módulo, y no daba ningún error.
     *
     * El espejo lo refresca el ciclo de catálogo paginando, y esa vía NO PASA DE
     * 1.000 REFERENCIAS por país. En un cliente de 5.460, las otras 4.460 se
     * comparaban contra lo que hubiera dejado el censo —cada seis horas— y, con
     * el censo apagado, contra datos de días.
     *
     * Pasó con el SKU 47680, un portátil de 1.001 € y el número 5.240 por orden
     * de SKU: Amazon lo tenía AGOTADO, el espejo decía 78 unidades, y el ciclo
     * no mandó nada porque para él ya coincidían. La comparación era correcta
     * contra un número falso, que es la peor clase de fallo que puede tener
     * esto.
     *
     * Así que ahora, ANTES de comparar, se lee de Amazon el estado de verdad de
     * las referencias que han casado. Va por `identifiers` y no por paginación,
     * así que no hay tope: una llamada por cada veinte SKU. Para Entrais son 273
     * llamadas, menos de un minuto.
     *
     * VA DESPUÉS DEL CRUCE A PROPÓSITO. El cruce necesita el espejo como
     * diccionario para saber QUÉ SKU de Amazon corresponde a cada referencia del
     * fichero, y eso no cambia con datos frescos. Lo que sí cambia —y es lo que
     * se compara— son las unidades y el precio, y esos se piden solo de los que
     * han casado en vez de del catálogo entero.
     */
    let listingsFrescos = listings
    let refrescoEnVivo: { leidos: number; llamadas: number; noVinieron: number } | null = null

    if (destino) {
      const skusDelCruce = [...new Set(cruce.rows.map((r) => r.sku))]
      if (skusDelCruce.length > 0) {
        try {
          const fresco = await refrescarListingsPorSku(
            destino.connectionId,
            destino.marketplaceId,
            skusDelCruce
          )
          const porSku = new Map(fresco.items.map((i) => [i.sku, i]))
          listingsFrescos = listings.map((l) => {
            const f = porSku.get(l.sku)
            if (!f) return l
            // Solo lo que se acaba de leer. `id`, `is_fba` y las columnas de FBA
            // se quedan como estaban: esta vía no las pide y sobrescribirlas con
            // un hueco sería borrar un dato bueno.
            return {
              ...l,
              asin: f.asin,
              title: f.title,
              // Lo que Amazon no devuelva en esta forma se queda como estaba: ver
              // la nota de refrescarListingsPorSku(). Un canal de logística
              // borrado hace que el ERP dé el listado por no editable y deje de
              // mandarle stock, sin dar ningún error.
              product_type: f.productType ?? l.product_type,
              condition_type: f.conditionType ?? l.condition_type,
              listing_status: f.listingStatus ?? l.listing_status,
              price: f.price,
              currency: f.currency ?? l.currency,
              quantity: f.quantity,
              fulfillment_channel_code: f.fulfillmentChannelCode ?? l.fulfillment_channel_code,
              last_seen_at: new Date().toISOString(),
            }
          })
          refrescoEnVivo = {
            leidos: fresco.items.length,
            llamadas: fresco.llamadas,
            noVinieron: fresco.noVinieron.length,
          }
          anotar(
            'amazon',
            'ok',
            fresco.items.length,
            `leídas en ${fresco.llamadas} llamadas` +
              (fresco.noVinieron.length > 0 ? `, ${fresco.noVinieron.length} no las devolvió` : '')
          )

          /**
           * QUE SE VEA QUE SE HA LEÍDO EN VIVO.
           *
           * Un envío calculado contra Amazon recién leído y uno calculado contra
           * un espejo de hace seis horas se ven EXACTAMENTE IGUAL en la
           * pantalla. Y no valen lo mismo. Así que se dice en cada ejecución, no
           * solo cuando falla.
           */
          aplicadas.avisos.push(
            `Se ha leído de Amazon el estado actual de ${fresco.items.length.toLocaleString('es-ES')} ` +
              `referencias en ${fresco.llamadas} llamadas, así que la comparación va contra lo que ` +
              'hay ahora mismo y no contra el espejo del catálogo.' +
              (fresco.noVinieron.length > 0
                ? ` ${fresco.noVinieron.length} no las ha devuelto: o ya no existen en su cuenta o ` +
                  'están en un estado que Amazon no lista.'
                : '')
          )
        } catch (error) {
          /**
           * SI NO SE PUEDE LEER, SE SIGUE CON EL ESPEJO Y SE DICE.
           *
           * Parar el ciclo porque Amazon no contesta dejaría el stock sin
           * sincronizar durante toda la caída. Seguir con el espejo es peor que
           * con datos frescos pero mejor que no hacer nada — con una condición:
           * que quede escrito en los avisos, porque un envío calculado contra
           * datos viejos y uno calculado contra datos frescos se parecen
           * exactamente igual en la pantalla.
           */
          anotar(
            'amazon',
            'aviso',
            null,
            'No ha contestado: se compara contra el espejo, que puede tener horas'
          )
          aplicadas.avisos.push(
            'No se ha podido leer el estado actual de Amazon, así que se ha comparado contra el ' +
              'espejo del catálogo, que puede tener horas. Motivo: ' +
              (error instanceof Error ? error.message : 'error desconocido')
          )
        }
      }
    }

    // ---------- 7) El simulacro ----------
    const simulacro = simular({
      lineas: aplicadas.lineas,
      cruce,
      listings: listingsFrescos,
      skusDelMapeo: new Set(mapeo.filas.map((m) => m.sku_amazon)),
      reglas,
      moneda: perfil.moneda,
      umbrales: umbralesDesdeFila(perfil),
      envioAutomatico: perfil.envio_automatico,
      filasDeMapeo: mapeo.filas.length,
      mapeoAutomatico: mapeo.origen === 'catalogo',
      espejoRefrescadoEn: refrescadoEn,
      conDestino: Boolean(destino),
      lineasLeidas: lectura.lineas.length,
      ahora,
    })

    // Los avisos del lector (columna casada por parecido, hoja que no existía) y
    // los del fichero de EAN se juntan con los del simulacro: es lo que se
    // guarda en la fila de la ejecución y lo que se enseña en pantalla.
    simulacro.avisos.unshift(...lectura.avisos, ...ean.avisos, ...aplicadas.avisos)
    anotar(
      'contrastar',
      simulacro.frenos.puedeEnviar ? 'ok' : 'freno',
      simulacro.cambios.length,
      simulacro.frenos.puedeEnviar
        ? simulacro.cambios.length === 0
          ? 'Amazon ya está como tiene que estar: no hay nada que cambiar'
          : `${simulacro.cambios.length} diferencias entre el fichero y Amazon`
        : simulacro.frenos.resumen
    )

    // ---------- 8) Enviar, SOLO si quien llama ha traído la puerta ----------
    // El orden importa: después de los frenos, nunca antes. Y con dos condiciones
    // más que no son de cortesía: un lote frenado no se manda ni troceado, y un
    // lote sin cambios no se manda porque no hay nada que mandar —llamar a
    // Amazon para no cambiar nada gasta cupo de todos los clientes y ensucia el
    // registro con un lote vacío.
    const envio =
      opciones.enviar && simulacro.frenos.puedeEnviar && simulacro.cambios.length > 0
        ? await opciones.enviar({
            perfil,
            destino,
            fichero: sinBytes(fichero),
            simulacro,
          })
        : null

    if (envio) {
      anotar(
        'enviar',
        envio.fallidos > 0 ? (envio.aceptados > 0 ? 'aviso' : 'error') : 'ok',
        envio.aceptados,
        envio.fallidos > 0 ? `${envio.fallidos} no los ha aceptado Amazon` : null
      )
    } else {
      /**
       * UN PASO QUE NO SE DIO TAMBIÉN SE APUNTA, Y CON SU MOTIVO.
       *
       * Sin esto, «el perfil está en simulacro», «el freno lo paró» y «no había
       * nada que cambiar» acaban siendo la misma casilla apagada en la pantalla,
       * y son tres cosas que se arreglan de tres formas distintas.
       */
      anotar(
        'enviar',
        'omitido',
        null,
        !opciones.enviar
          ? 'El perfil está en simulacro: calcula pero no manda'
          : !simulacro.frenos.puedeEnviar
            ? 'Frenado antes de mandar nada'
            : 'No había ningún cambio que mandar'
      )
    }

    const duracionMs = Date.now() - arranque

    // ---------- 9) Que quede constancia ----------
    const estado = estadoDe(simulacro, envio)

    const runId = await registrarRun({
      profile_id: perfil.id,
      client_id: perfil.client_id,
      created_by: opciones.userId ?? null,
      origen: perfil.origen,
      fichero_nombre: fichero.nombre,
      fichero_id_externo: fichero.idExterno,
      fichero_huella: fichero.huellaContenido,
      fichero_bytes: fichero.tamano,
      fichero_modificado_at: fichero.modificadoAt,
      estado,
      lineas_leidas: lectura.lineas.length,
      lineas_utiles: aplicadas.lineas.length,
      lineas_excluidas: aplicadas.descartadas.length,
      sku_casados: cruce.stats.matched,
      sku_sin_casar: cruce.stats.unmatched,
      unidades_total: simulacro.resumen.unidadesTotal,
      cambios_stock: simulacro.cambios.filter((c) => c.campo === 'cantidad').length,
      cambios_precio: simulacro.cambios.filter((c) => c.campo === 'precio').length,
      sku_a_cero: simulacro.resumen.stockACero,
      sku_suben: simulacro.resumen.stockSuben,
      sku_bajan: simulacro.resumen.stockBajan,
      reglas_detalle: {
        porMotivo: aplicadas.porMotivo,
        cortadasPorUmbral: aplicadas.cortadasPorUmbral,
        tocadasPorReserva: aplicadas.tocadasPorReserva,
        hoja: lectura.hoja,
        filaCabecera: lectura.filaCabecera,
      },
      // El CHECK de la tabla exige que un 'frenado' traiga freno Y frase: se
      // rellenan los dos o ninguno.
      freno: estado === 'frenado' ? simulacro.frenos.primero : null,
      freno_detalle: estado === 'frenado' ? simulacro.frenos.resumen : null,
      frenos: simulacro.frenos.todos,
      // Los avisos se GUARDAN, no solo se enseñan. Son lo único que explica un
      // resultado raro cuando nadie estaba delante: el espejo vacío, el fichero
      // de EAN ilegible, una columna emparejada por parecido de nombre. Antes
      // se redactaban y se perdían en cuanto se cerraba la pantalla.
      avisos: simulacro.avisos,
      batch_id: envio?.batchId ?? null,
      enviados_ok: envio?.aceptados ?? null,
      enviados_error: envio?.fallidos ?? null,
      envio_abortado: envio?.abortado ?? null,
      duracion_ms: duracionMs,
      fases,
      // El CHECK stock_profile_runs_error_ok exige mensaje cuando el estado es
      // 'error', y aquí se llega a 'error' con un envío que no aceptó ni uno.
      error_message: estado === 'error' ? mensajeDeEnvioFallido(envio) : null,
      notes: destino ? null : 'El perfil todavía no apunta a ninguna conexión de Amazon',
    })

    // La huella del fichero NO se escribe aquí a propósito: la escribe el ciclo
    // automático, que es el único que la usa para saltarse trabajo repetido. Si
    // la escribiera también un simulacro lanzado a mano, probar un fichero desde
    // la pantalla haría que el ciclo se lo saltara y ese fichero no llegaría
    // nunca a Amazon.
    // `last_ok_at` solo se mueve si la ejecución fue BIEN. Se llega aquí también
    // con estado 'error' —el envío salió y Amazon no aceptó ni uno—, y marcar
    // eso como «última correcta» dejaría la pantalla diciendo que el cliente se
    // actualizó hace un momento justo cuando no se ha actualizado nada.
    /**
     * Y NO SE MARCA COMO CORRECTA UNA EJECUCIÓN QUE NO HA PODIDO CONTRASTAR
     * NADA.
     *
     * Con el espejo del catálogo vacío —el refresco falló, o lleva días sin
     * correr— las filas del cruce salen todas como 'sin_listing', no hay
     * cambios que proponer y la ejecución quedaba en 'sin_cambios' con su
     * `last_ok_at` recién puesto y el `last_error` borrado. Resultado: un
     * cliente que lleva una semana sin actualizarse enseñaba «sin cambios ·
     * última correcta hace 4 minutos» cada cuarto de hora, indefinidamente,
     * sin que saltara nada. Eso es lo contrario de lo que hace falta.
     */
    const espejoInutil =
      destino !== null &&
      (listings.length === 0 ||
        (simulacro.resumen.skuEnFichero > 0 &&
          simulacro.resumen.sinListing === simulacro.resumen.skuEnFichero))

    const fallo = estado === 'error' ? mensajeDeEnvioFallido(envio) : null
    const sinContraste = espejoInutil
      ? listings.length === 0
        ? `El espejo del catálogo de Amazon está vacío para ${destino.connectionName}: no hay contra qué contrastar, ` +
          'así que esta lectura no ha podido decidir nada. Comprueba que el refresco del catálogo está corriendo.'
        : 'Ninguno de los SKU que resuelve el fichero está en el espejo del catálogo de Amazon. ' +
          'O el catálogo lleva sin refrescarse desde que se creó el mapeo, o esos listings ya no existen.'
      : null

    await marcarPerfil(perfil.id, {
      last_run_at: ahora.toISOString(),
      ...(fallo || sinContraste ? {} : { last_ok_at: ahora.toISOString() }),
      last_error: fallo ?? sinContraste,
      ...(await referenciaAlDia(perfil, lectura.lineas.length, estado, simulacro)),
    })

    return {
      fichero: sinBytes(fichero),
      lectura: quitarLineas(lectura),
      reglas: quitarLineasReglas(aplicadas),
      destino,
      simulacro,
      runId,
      mismoFichero,
      estado,
      envio,
      lineasLeidas: lectura.lineas.length,
      duracionMs,
    }
  } catch (error) {
    // El fallo también deja fila: un perfil que lleva tres días reventando en
    // el cron tiene que verse en el historial, no solo en los logs.
    const mensaje = error instanceof Error ? error.message : 'Error desconocido'

    /**
     * SE APUNTA EL PASO QUE SE ESTABA DANDO CUANDO REVENTÓ.
     *
     * Es lo único que convierte «Timeout expired» en algo accionable: los pasos
     * que sí terminaron están en la lista con su tiempo, y el que falta es el
     * que se rompió. Sin esto hay que adivinarlo por el mensaje, y los mensajes
     * de las librerías de terceros no dicen en qué parte del ciclo estabas.
     */
    fases.push({
      paso: SIGUIENTE_PASO[fases[fases.length - 1]?.paso ?? 'origen'],
      estado: 'error',
      ms: Date.now() - marca,
      cifra: null,
      nota: mensaje.slice(0, 300),
    })

    await registrarRun({
      profile_id: perfil.id,
      client_id: perfil.client_id,
      created_by: opciones.userId ?? null,
      origen: perfil.origen,
      fichero_nombre: fichero.nombre,
      fichero_id_externo: fichero.idExterno,
      fichero_huella: fichero.huellaContenido,
      fichero_bytes: fichero.tamano,
      fichero_modificado_at: fichero.modificadoAt,
      estado: 'error' satisfies StockProfileRunState,
      duracion_ms: Date.now() - arranque,
      fases,
      // El CHECK stock_profile_runs_error_ok exige mensaje cuando el estado es
      // 'error'; se recorta porque un stack entero no cabe ni aporta.
      error_message: mensaje.slice(0, 2000),
    })
    await marcarPerfil(perfil.id, {
      last_run_at: ahora.toISOString(),
      last_error: mensaje.slice(0, 2000),
    })
    throw error
  }
}

/* ------------------------------------------------------------------ */
/* «Probar»: configurar un perfil sin hacerlo a ciegas                 */
/* ------------------------------------------------------------------ */

/** Qué columna del fichero acabó usándose para cada campo del perfil */
export interface ColumnaEncontrada {
  campo: string
  etiqueta: string
  /** Los nombres que el perfil tenía apuntados */
  alias: string[]
  /** -1 = no se ha encontrado */
  indice: number
  /** El nombre REAL de la columna del fichero, que casi nunca es el primer alias */
  cabecera: string | null
  /**
   * Si la columna casó por su nombre EXACTO o solo porque empieza igual.
   *
   * La pantalla los pinta distinto, y no es un adorno: un acierto por prefijo
   * es como se acaba leyendo «Stock value» (un importe en euros) creyendo que
   * son las unidades, sin un solo error y con el catálogo entero a cero. En
   * verde con un tick, un acierto dudoso es indistinguible de uno bueno.
   */
  exacta: boolean
}

/** Una fila del fichero, ya interpretada y con las reglas aplicadas */
export interface FilaMuestra {
  fila: number
  articulo: string
  descripcion: string
  ean: string
  familia: string
  /** Lo que dice el fichero */
  stockLeido: number
  /** Lo que se publicaría, ya con reserva y umbral */
  stockPublicable: number
  precioLeido: number | null
  /** Ya resuelto por el modo de precio del perfil y redondeado */
  precioFinal: number | null
  /** Si las reglas la descartan, por qué */
  descarte: string | null
}

export interface PruebaPerfil {
  fichero: FicheroProcesado
  tipo: 'stock' | 'ean'
  hoja: string
  filaCabecera: number
  /** Todas las cabeceras del fichero, para poder copiar el nombre exacto que falta */
  cabeceras: string[]
  /**
   * LAS PRIMERAS FILAS SIN INTERPRETAR, alineadas con `cabeceras`.
   *
   * La muestra de abajo enseña lo que el ERP ha ENTENDIDO; esto enseña lo que el
   * fichero TRAE. Hacen falta las dos y no es redundancia: con solo la
   * interpretada, un «stock leído: 0» en todas las filas es indistinguible de
   * «la columna elegida está vacía» y de «se está leyendo la columna
   * equivocada», y son dos problemas opuestos.
   */
  muestraCruda: Array<{ fila: number; celdas: string[] }>
  columnas: ColumnaEncontrada[]
  muestra: FilaMuestra[]
  /** Muestra de artículo -> códigos de barras, solo en los perfiles de EAN */
  muestraEan: Array<{ articulo: string; codigos: string[] }>
  totalLineas: number
  /** Artículos con EAN indexados, solo en los perfiles de EAN */
  totalArticulos: number
  avisos: string[]
}

/**
 * Una celda de Excel, como texto para pintar.
 *
 * Sin inventar formatos: un número se enseña tal cual —incluidos los códigos de
 * barras, que Excel guarda como número y muestra en notación científica pero que
 * por dentro son el entero entero— y una fecha en ISO recortada. Lo que no se
 * sepa convertir sale vacío antes que salir como «[object Object]».
 */
function textoDeCelda(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : ''
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  if (valor instanceof Date) return valor.toISOString().slice(0, 10)
  return ''
}

/** Cuántas filas se devuelven de muestra. Suficiente para reconocer el fichero */
const FILAS_MUESTRA = 25

const ETIQUETAS: Record<keyof ColumnasPerfil, string> = {
  referencia: 'Referencia del artículo',
  stock: 'Unidades en stock',
  precio: 'Precio',
  precioRespaldo: 'Precio de respaldo',
  coste: 'Coste',
  ean: 'Código de barras',
  descripcion: 'Descripción',
  familia: 'Familia',
  tipo: 'Tipo de código',
}

/**
 * LEE EL FICHERO Y ENSEÑA LO QUE HA ENTENDIDO. No cruza, no contrasta y no
 * toca la base de datos.
 *
 * Es lo que convierte configurar un cliente en algo que se puede hacer: sin
 * esto se rellenan diez campos de alias a ciegas, se procesa, y el resultado es
 * «no ha casado nada» sin ninguna pista de si el fallo está en la hoja, en la
 * cabecera o en el nombre de una columna. Aquí se ve la hoja que se ha elegido,
 * la fila de cabecera, QUÉ COLUMNA REAL se ha llevado cada campo y las primeras
 * filas ya interpretadas con las reglas puestas.
 */
export async function probarPerfil(opciones: {
  perfil: StockReadProfile
  subida?: SubidaManual | null
  ahora?: Date
}): Promise<PruebaPerfil> {
  const ahora = opciones.ahora ?? new Date()
  const { perfil } = opciones

  const fichero = await traerFichero(perfil, opciones.subida)
  const perfilLectura = perfilDesdeFila(perfil)

  if (perfil.tipo === 'ean') {
    const lectura = leerEan(fichero.bytes, perfilLectura)
    return {
      fichero: sinBytes(fichero),
      tipo: 'ean',
      hoja: lectura.hoja,
      filaCabecera: lectura.filaCabecera,
      cabeceras: lectura.cabeceras,
      // El lector de EAN es otro y no captura la muestra en crudo: ese fichero
      // es un índice de dos columnas y no tiene la ambigüedad que esto resuelve.
      muestraCruda: [],
      columnas: columnasEncontradas(lectura.columnas, perfilLectura.columnas, lectura.cabeceras),
      muestra: [],
      muestraEan: Array.from(lectura.indice.entries())
        .slice(0, FILAS_MUESTRA)
        .map(([articulo, codigos]) => ({ articulo, codigos })),
      totalLineas: lectura.codigos,
      totalArticulos: lectura.articulos,
      avisos: lectura.avisos,
    }
  }

  const lectura = leerStock(fichero.bytes, perfilLectura)
  const reglas = reglasDesdeFila(perfil)
  const aplicadas = aplicarReglas(lectura.lineas, reglas, ahora)

  // Las descartadas se indexan por fila para poder decir, en la propia muestra,
  // cuáles no llegarían al cruce y por qué. Enseñar solo las que sobreviven
  // escondería justo el efecto que se quiere comprobar al configurar.
  const descartes = new Map(aplicadas.descartadas.map((d) => [d.fila, d.motivo]))
  const publicables = new Map(aplicadas.lineas.map((l) => [l.fila, l]))

  const muestra: FilaMuestra[] = lectura.lineas.slice(0, FILAS_MUESTRA).map((l) => {
    const aplicada = publicables.get(l.fila)
    return {
      fila: l.fila,
      articulo: l.articulo,
      descripcion: l.descripcion,
      ean: l.ean,
      familia: l.familia,
      stockLeido: l.stock,
      stockPublicable: aplicada?.stock ?? 0,
      precioLeido: l.precio,
      precioFinal: aplicada?.precioFinal ?? null,
      descarte: descartes.get(l.fila) ?? null,
    }
  })

  return {
    fichero: sinBytes(fichero),
    tipo: 'stock',
    hoja: lectura.hoja,
    filaCabecera: lectura.filaCabecera,
    cabeceras: lectura.cabeceras,
    // A texto plano aquí: lo que viaja a la pantalla es para MIRARLO, y un
    // `unknown` de Excel (una fecha, un número con notación científica) no se
    // puede pintar tal cual. Se enseña lo mismo que vería alguien abriendo el
    // fichero.
    muestraCruda: lectura.muestraCruda.map((f) => ({
      fila: f.fila,
      celdas: f.celdas.map((c) => textoDeCelda(c)),
    })),
    columnas: columnasEncontradas(lectura.columnas, perfilLectura.columnas, lectura.cabeceras),
    muestra,
    muestraEan: [],
    totalLineas: lectura.lineas.length,
    totalArticulos: 0,
    avisos: [...lectura.avisos, ...aplicadas.avisos],
  }
}

function columnasEncontradas(
  indices: IndiceColumnas,
  alias: ColumnasPerfil,
  cabeceras: string[]
): ColumnaEncontrada[] {
  // El cast del Object.keys es lo que ata ETIQUETAS a ColumnasPerfil: si un día
  // se añade un campo al perfil y no se le pone etiqueta aquí, el Record de
  // arriba deja de compilar y el campo nuevo no puede pasar desapercibido.
  return (Object.keys(ETIQUETAS) as (keyof ColumnasPerfil)[])
    .filter((campo) => (alias[campo] ?? []).length > 0)
    .map((campo) => {
      const indice = indices[campo] ?? -1
      const cabecera = indice >= 0 ? (cabeceras[indice] ?? null) : null
      return {
        campo,
        etiqueta: ETIQUETAS[campo],
        alias: alias[campo] ?? [],
        indice,
        cabecera,
        // Se compara con la MISMA normalización que usa el lector (sin tildes,
        // sin mayúsculas, sin puntuación), o «Artículo» contaría como dudoso.
        exacta:
          cabecera !== null &&
          (alias[campo] ?? []).some((a) => normalizeHeader(a) === normalizeHeader(cabecera)),
      }
    })
}

/* ------------------------------------------------------------------ */
/* Las piezas que hablan con la base                                   */
/* ------------------------------------------------------------------ */

/**
 * El índice de códigos de barras del cliente, si se puede construir.
 *
 * Devuelve null sin quejarse cuando no hay perfil de EAN o cuando su fichero no
 * ha llegado: el cruce funciona igual, solo pierde la vía 'ean_erp'. Lo que NO
 * se hace es tumbar el proceso entero por esto — el stock del cliente se
 * publicaría con menos referencias casadas, que es mejor que no publicarlo.
 *
 * Un fallo LEYENDO el fichero de EAN sí se traga a propósito y se convierte en
 * un cruce sin esa vía: un fichero de apoyo mal exportado no puede impedir que
 * se actualice el stock.
 */
async function construirEanIndex(
  perfil: StockReadProfile,
  subidaEan: SubidaManual | null,
  /** El correo del que salió el volcado, si vino de un buzón. Ver abajo */
  correoId: string | null
): Promise<{ indice: EanIndex | null; avisos: string[] }> {
  /**
   * PRIMERO: ¿VIENEN LOS DOS EN EL MISMO CORREO?
   *
   * Es el caso de un cliente que manda el volcado de stock y el de códigos de
   * barras adjuntos al mismo mensaje, tres veces por semana. Se resuelve aquí y
   * no con un segundo perfil por un motivo que no es de comodidad: con dos
   * perfiles, cada uno busca su correo por su cuenta y pueden acabar cogiendo
   * mensajes de DÍAS DISTINTOS. Cruzar el stock del lunes con los EAN del
   * viernes casa referencias que ya no se corresponden, y no lo delata nada.
   *
   * Con el id del correo delante eso es imposible: los dos adjuntos salen del
   * mismo mensaje o no sale ninguno.
   *
   * Una subida a mano manda sobre esto: si alguien ha traído el fichero de EAN
   * desde la pantalla, es el que quiere usar.
   */
  const patronEan = textoConfig(
    (perfil.origen_config ?? {}) as Record<string, unknown>,
    'adjunto_ean'
  )
  if (perfil.origen === 'correo' && patronEan && correoId && !subidaEan) {
    try {
      const adjunto = await segundoAdjunto(
        (perfil.origen_config ?? {}) as Record<string, unknown>,
        correoId,
        patronEan,
        MAX_FICHERO_BYTES
      )
      if (adjunto) {
        const lectura = leerEan(adjunto.bytes, perfilDesdeFila(perfilEanDelMismoCorreo(perfil)))
        return { indice: lectura.indice, avisos: lectura.avisos }
      }
      return {
        indice: null,
        avisos: [
          `El correo del que ha salido el volcado no trae ningún adjunto que encaje con ` +
            `«${patronEan}», así que el cruce va SIN la vía por EAN del ERP. Comprueba que el ` +
            'cliente sigue mandando los dos ficheros en el mismo mensaje.',
        ],
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'error desconocido'
      return {
        indice: null,
        avisos: [
          /**
           * EL MOTIVO ENTERO, NO LA PRIMERA LÍNEA.
           *
           * Aquí había un `motivo.split('\n')[0]` y tiraba justo lo que sirve:
           * el lector explica en las líneas siguientes qué columnas buscaba y
           * cuáles tiene la hoja, que es lo único con lo que se puede arreglar.
           * Recortado, el aviso decía «el fichero no encaja con el perfil» y ahí
           * se acababa la pista.
           */
          `No se ha podido leer el adjunto de códigos de barras del mismo correo. El cruce ha ido ` +
            `SIN la vía por EAN del ERP.\n${motivo}`,
        ],
      }
    }
  }

  const perfilEan = await loadPerfilEan(perfil.client_id)

  if (!perfilEan) {
    return {
      indice: null,
      avisos: [
        'Este cliente no tiene perfil de códigos de barras, así que el cruce va sin la vía por EAN del ERP. ' +
          'Es la que desempata las referencias que solo se diferencian en los ceros a la izquierda: sin ella casan ' +
          'menos referencias y las que casan lo hacen por caminos más frágiles.',
      ],
    }
  }

  try {
    const conector = conectorDe(perfilEan.origen)
    const fichero = await conector.traer({
      config: (perfilEan.origen_config ?? {}) as Record<string, unknown>,
      perfil: perfilEan.name,
      // Igual que arriba: el fichero de códigos de barras también puede venir
      // por SFTP, y su credencial cuelga de SU perfil, no del de stock.
      perfilId: perfilEan.id,
      maxBytes: MAX_FICHERO_BYTES,
      subida: subidaEan
        ? { nombre: subidaEan.nombre, bytes: subidaEan.bytes, tamano: subidaEan.tamano }
        : null,
    })
    const lectura = leerEan(fichero.bytes, perfilDesdeFila(perfilEan))
    return { indice: lectura.indice, avisos: lectura.avisos }
  } catch (error) {
    /**
     * EL FALLO SE SIGUE TRAGANDO —un fichero de apoyo mal exportado no puede
     * impedir que se actualice el stock— PERO YA NO SE PIERDE.
     *
     * Antes esto era un console.warn y nada más, así que el cruce se hacía sin
     * la vía por EAN y no lo decía ni la pantalla, ni el simulacro, ni la fila
     * de la ejecución. No es perder cuatro SKU: con los datos reales de este
     * cliente son 245 de 395 referencias que dejan de resolverse por su código
     * de barras y pasan a resolverse quitando ceros a la izquierda, que es la
     * vía heurística. El resultado cambia de arriba abajo y nadie lo ve.
     */
    const motivo = error instanceof Error ? error.message : 'error desconocido'
    console.warn(
      `No se ha podido leer el fichero de códigos de barras del cliente (perfil «${perfilEan.name}»). ` +
        'El cruce seguirá sin la vía por EAN del ERP:',
      error
    )
    return {
      indice: null,
      avisos: [
        // Mismo motivo que en la vía del mismo correo: el detalle de qué
        // columnas buscaba y cuáles hay va en las líneas siguientes, y era
        // justo lo que se tiraba.
        `El fichero de códigos de barras del perfil «${perfilEan.name}» no se ha podido leer. ` +
          'El cruce ha ido SIN la vía por EAN del ERP, que es la que desempata las referencias que ' +
          'solo se diferencian en los ceros a la izquierda: las que normalmente se resuelven por ahí ' +
          `se habrán resuelto quitando ceros, que es la vía heurística, o no se habrán resuelto.\n${motivo}`,
      ],
    }
  }
}

/**
 * Los nombres con los que se busca la columna del código de barras cuando el
 * perfil no dice ninguno.
 *
 * SIN ESTO, LA VÍA DEL MISMO CORREO NO FUNCIONABA. El perfil de stock trae sus
 * columnas —Articulo, St. Real, Descrip.Propia— y ninguna de ellas es un EAN,
 * porque el fichero de stock no lo lleva: lo lleva el OTRO adjunto. Así que el
 * lector abría el fichero de códigos de barras buscando columnas de stock, no
 * encontraba nada y contestaba «el fichero no encaja con el perfil», que es
 * verdad y no ayuda absolutamente nada.
 *
 * Son los mismos nombres que ya usaba el lector de siempre para este fichero.
 */
const EAN_POR_DEFECTO = ['Codigo de Barras', 'Código de Barras', 'Codigo barras', 'EAN']
const TIPO_POR_DEFECTO = ['Tipo']

/**
 * El MISMO perfil, leído como si fuera el de códigos de barras.
 *
 * Cuando los dos ficheros vienen en el mismo correo no hay un segundo perfil de
 * donde sacar la configuración, así que se usa la de este: las columnas de EAN
 * y de Tipo ya son campos suyos —están en la tabla desde el principio, aunque
 * un perfil de stock no las use— y las de referencia sirven para los dos, que
 * en la práctica es la misma columna del ERP del cliente.
 *
 * LA HOJA SE VACÍA A PROPÓSITO. Es lo único que casi seguro difiere entre los
 * dos ficheros, y con el nombre puesto el segundo no abriría. Vacío significa
 * «búscala por las columnas», que es lo que se recomienda de todas formas.
 *
 * Y SI EL PERFIL NO DICE QUÉ COLUMNA ES EL EAN, se usan los nombres de siempre.
 * Lo que el perfil declare manda; esto solo evita que la vía entera se caiga por
 * un campo que la pantalla de un perfil de stock ni siquiera enseñaba.
 */
function perfilEanDelMismoCorreo(perfil: StockReadProfile): StockReadProfile {
  return {
    ...perfil,
    tipo: 'ean',
    hoja: null,
    hoja_indice: null,
    col_ean: perfil.col_ean && perfil.col_ean.length > 0 ? perfil.col_ean : EAN_POR_DEFECTO,
    // El Tipo no se exige: si el fichero no trae esa columna se queda sin
    // resolver y no pasa nada. Solo sirve para los ficheros que mezclan EAN-13
    // con códigos internos del ERP, y ahí es lo que los separa.
    col_tipo: perfil.col_tipo && perfil.col_tipo.length > 0 ? perfil.col_tipo : TIPO_POR_DEFECTO,
  }
}

/* ------------------------------------------------------------------ */
/* «Cuántas líneas trae este fichero un día normal», sin teclearlo      */
/* ------------------------------------------------------------------ */

/** Cuántas ejecuciones buenas se miran para saber qué es «normal» */
const RUNS_PARA_LA_REFERENCIA = 10

/**
 * MANTIENE SOLA LA REFERENCIA DEL FRENO DE CAÍDA.
 *
 * Ese número era lo peor de la pantalla de frenos: había que teclearlo a mano,
 * se quedaba viejo en cuanto el cliente crecía, y no tenerlo impedía encender el
 * envío automático. Un cliente que un mes manda 244 referencias y al siguiente
 * repone y manda 350 obligaba a volver a la pantalla a corregir un número — y
 * nadie vuelve.
 *
 *
 * ============ LAS TRES REGLAS, Y LAS TRES IMPORTAN ============
 *
 * 1. SOLO APRENDE DE EJECUCIONES QUE FUERON BIEN. Si un fichero a medias
 *    pudiera fijar la referencia, el freno aprendería del desastre: mañana
 *    «lo normal» serían las 120 líneas del volcado roto de hoy, y el freno que
 *    existe para cazar volcados a medias dejaría de saltar para siempre. Es el
 *    fallo clásico de cualquier umbral que se calibra solo.
 *
 * 2. SE USA LA MEDIANA, no la media ni el último valor. Un día que el fichero
 *    venga duplicado no puede mover la referencia: la mediana de diez lo ignora
 *    y la media no.
 *
 * 3. SOLO SUBE, NUNCA BAJA SOLA. Y esto es lo que hace que sea seguro:
 *
 *      · Subirla es ESTRECHAR el freno. Si el cliente ha crecido a 350, una
 *        caída al día siguiente a 200 debe saltar, y con la referencia vieja de
 *        260 no saltaría.
 *      · Bajarla es AFLOJARLO. Un catálogo que mengua poco a poco —cada día un
 *        30%, por debajo del límite— arrastraría la referencia hacia abajo con
 *        él y el freno no saltaría nunca. Eso se llama deriva y es como se
 *        vacía un inventario sin que salte nada.
 *
 *    Así que bajar sigue siendo una decisión de una persona, en la casilla de
 *    siempre. Subir se hace solo, porque siempre protege más.
 */
async function referenciaAlDia(
  perfil: StockReadProfile,
  lineasLeidas: number,
  estado: StockProfileRunState,
  simulacro: Simulacro
): Promise<{ lineas_referencia?: number }> {
  // Regla 1: solo de ejecuciones buenas. Frenada, con error o sin una sola
  // línea no enseñan nada sobre qué es normal en este cliente.
  const buena =
    lineasLeidas > 0 &&
    estado !== 'error' &&
    estado !== 'frenado' &&
    simulacro.frenos.primero === null

  if (!buena) return {}

  const actual = perfil.lineas_referencia ?? null

  // Primera vez: se fija con lo que traiga esta ejecución, que ya ha pasado
  // todos los frenos. Es exactamente lo que se pedía hacer a mano —«rellénalo
  // con las líneas de una ejecución que hayas dado por buena»— pero sin que
  // haya que acordarse.
  if (actual === null) return { lineas_referencia: lineasLeidas }

  const historico = await lineasDeEjecucionesBuenas(perfil.id)
  const muestra = [...historico, lineasLeidas]
  // Con menos de tres no hay mediana que valga: una sola ejecución rara movería
  // la referencia igual que una tendencia.
  if (muestra.length < 3) return {}

  const mediana = medianaDe(muestra)
  // Regla 3: solo hacia arriba.
  return mediana > actual ? { lineas_referencia: mediana } : {}
}

/** Las líneas leídas en las últimas ejecuciones que NO frenaron ni fallaron */
async function lineasDeEjecucionesBuenas(perfilId: string): Promise<number[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_profile_runs')
    .select('lineas_leidas')
    .eq('profile_id', perfilId)
    .in('estado', ['enviado', 'sin_cambios', 'simulacro'])
    .not('lineas_leidas', 'is', null)
    .gt('lineas_leidas', 0)
    .order('created_at', { ascending: false })
    .limit(RUNS_PARA_LA_REFERENCIA)

  if (error) {
    // Que no se pueda leer el histórico no puede tumbar una ejecución que ya ha
    // terminado bien: se deja la referencia como estaba.
    console.error('No se ha podido leer el histórico para la referencia de líneas:', error)
    return []
  }
  return (data ?? []).map((f) => Number(f.lineas_leidas)).filter((n) => Number.isFinite(n))
}

function medianaDe(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 === 1
    ? orden[medio]
    : Math.round((orden[medio - 1] + orden[medio]) / 2)
}

/* ------------------------------------------------------------------ */
/* El diccionario referencia del cliente -> SKU de Amazon              */
/* ------------------------------------------------------------------ */

export interface MapeoResuelto {
  filas: CrossMapping[]
  /** 'tabla' = stock_mappings; 'catalogo' = generado a partir del espejo */
  origen: 'tabla' | 'catalogo'
}

/**
 * DE DÓNDE SALE EL DICCIONARIO, Y POR QUÉ HAY DOS SITIOS.
 *
 * El cruce necesita saber qué SKU de Amazon le toca a cada referencia del
 * fichero. Hay dos formas de saberlo y el ERP soporta las dos:
 *
 *   1. LA TABLA (`stock_mappings`). Un diccionario hecho a mano, fila a fila,
 *      que se importa desde un Excel. Es lo que hace falta cuando el SKU de
 *      Amazon NO se parece a la referencia del ERP —lo normal en un catálogo
 *      montado por una agencia años después que el almacén—. Manda siempre que
 *      exista: es un dato que alguien ha decidido a mano, y ninguna deducción
 *      automática puede pasarle por encima.
 *
 *   2. EL PROPIO CATÁLOGO DE AMAZON. Cuando no hay tabla, cada listing del
 *      espejo se convierte en una fila de mapeo cuya «referencia del ERP» es
 *      su propio SKU. Es el caso del cliente que da de alta sus productos en
 *      Amazon usando la referencia de su ERP como SKU, que es mayoría en los
 *      catálogos pequeños y medianos.
 *
 *
 * ============ LO QUE ESTO RESUELVE ============
 *
 * El volcado de un cliente trae SU ALMACÉN ENTERO: 4.774 referencias de las
 * que en Amazon hay unos cientos. El cruce recorre el DICCIONARIO y busca cada
 * entrada en el fichero, nunca al revés, así que las referencias del fichero
 * que no están en Amazon no tocan nada: no se publica lo que no existe y no se
 * crea nada. Lo que sobra del fichero simplemente no se mira.
 *
 * Y en el otro sentido: un listing de Amazon que no aparezca en el fichero sale
 * en la pantalla como huérfano con motivo 'sin_articulo' —que es distinto de
 * «no tiene mapeo»— y NO se le manda un 0. Publicar cero porque una referencia
 * no venía en el volcado es la forma más rápida de tirar las ventas de un
 * cliente por un fichero recortado.
 *
 *
 * ============ POR QUÉ NO SE GUARDA LO QUE SE DEDUCE ============
 *
 * Se genera en cada pasada y no se escribe en `stock_mappings`. Guardarlo
 * convertiría una deducción en un dato: al día siguiente nadie sabría si esa
 * fila la puso una persona mirando el catálogo o la dedujo el ERP solo, y la
 * regla de arriba —la tabla manda— dejaría de significar nada. Cuesta un map
 * sobre unos cientos de filas que ya están en memoria.
 */
export function resolverMapeo(
  tabla: CrossMapping[],
  listings: AmazonListing[]
): MapeoResuelto {
  if (tabla.length > 0) return { filas: tabla, origen: 'tabla' }

  const filas: CrossMapping[] = []
  for (const listing of listings) {
    const sku = (listing.sku ?? '').trim()
    if (!sku) continue
    filas.push({
      sku_amazon: sku,
      // El SKU HACE de referencia del ERP. crossStock lo prueba primero por
      // igualdad exacta y después quitando ceros a la izquierda, que es justo
      // lo que hace falta cuando el almacén escribe «0050119247» y Amazon
      // guarda «50119247».
      ref_erp: sku,
      asin: listing.asin,
    })
  }

  return { filas, origen: 'catalogo' }
}

/** Las filas de mapeo activas del cliente, que es el diccionario referencia -> SKU */
async function cargarMapeo(clientId: string): Promise<CrossMapping[]> {
  const service = createServiceClient()
  const out: CrossMapping[] = []
  const PAGE = 1000

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await service
      .from('stock_mappings')
      .select('sku_amazon, ref_erp, asin, ean_amazon, ean_erp, ean_final, todos_ean_erp, origen_ean')
      .eq('client_id', clientId)
      .eq('is_active', true)
      // El orden termina en columna única: .range() sobre un orden con empates
      // repite filas o se las salta, y aquí una fila saltada es un listing que
      // se queda sin actualizar.
      .order('id')
      .range(from, from + PAGE - 1)

    if (error) throw error
    const chunk = (data ?? []) as CrossMapping[]
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }

  return out
}

/**
 * El espejo del catálogo contra el que se contrasta.
 *
 * Si el perfil no apunta a ninguna conexión se devuelve vacío en vez de fallar:
 * el simulacro sigue siendo útil —enseña qué casa y qué no— y el aviso de
 * «espejo vacío» lo dice en pantalla. Obligar a conectar Amazon antes de poder
 * probar un perfil rompería justo el caso para el que se hizo el simulacro.
 */
async function cargarEspejo(perfil: StockReadProfile): Promise<{
  destino: DestinoProceso | null
  listings: AmazonListing[]
  /** Cuándo se refrescó el espejo por última vez. null = nunca, o sin conexión */
  refrescadoEn: string | null
}> {
  if (!perfil.connection_id) return { destino: null, listings: [], refrescadoEn: null }

  const connection = await loadConnection(perfil.connection_id)
  if (!connection) return { destino: null, listings: [], refrescadoEn: null }

  // pickMarketplace comprueba que el marketplace pedido esté ENTRE LOS QUE
  // CUBRE la conexión. Sin esa comprobación, un identificador mal escrito en el
  // perfil apuntaría a una tienda de otra región que este cliente no nos ha
  // autorizado.
  const marketplaceId = pickMarketplace(connection, perfil.marketplace_id)
  if (!marketplaceId) {
    throw new StockSyncError(
      `El perfil apunta al marketplace «${perfil.marketplace_id}», que no está entre los que cubre la conexión de ${connection.name}. ` +
        'Elige uno de los países autorizados en la configuración del perfil.'
    )
  }

  /**
   * LA DIVISA DEL FICHERO TIENE QUE SER LA DEL PAÍS AL QUE SE MANDA.
   *
   * El envío toma la divisa del listing o la del marketplace, no la del perfil,
   * así que nada comprobaba que coincidieran: un perfil con moneda EUR
   * apuntando a amazon.co.uk publicaba los euros del fichero como si fueran
   * libras. El número es el mismo, así que la variación por línea es del 0% y
   * NINGÚN freno lo ve; el cliente vende un 17% caro y no da ni un error.
   */
  const delMercado = marketplaceById(marketplaceId)?.currency
  const delPerfil = (perfil.moneda ?? '').trim().toUpperCase()
  if (delMercado && delPerfil && delMercado.toUpperCase() !== delPerfil) {
    throw new StockSyncError(
      `El perfil dice que los precios del fichero están en ${delPerfil} y el país al que se manda ` +
        `(${marketplaceId}) trabaja en ${delMercado}. Los precios se publicarían con el número del ` +
        'fichero y la divisa del país, que es un cambio de precio encubierto. ' +
        'Corrige la moneda del perfil o el país de destino.'
    )
  }

  const listings = await loadListings(connection.id, marketplaceId)

  return {
    destino: { connectionId: connection.id, connectionName: connection.name, marketplaceId },
    listings,
    refrescadoEn: connection.last_sync_at,
  }
}

/* ------------------------------------------------------------------ */

/** Los bytes no viajan de vuelta: son megas y ya se han usado */
function sinBytes(f: FicheroTraido): FicheroProcesado {
  return {
    nombre: f.nombre,
    idExterno: f.idExterno,
    huella: f.huella,
    huellaContenido: f.huellaContenido,
    modificadoAt: f.modificadoAt,
    tamano: f.tamano,
  }
}

/**
 * Cómo acabó la ejecución.
 *
 * El orden de las preguntas ES la política, así que se lee de arriba abajo:
 *
 *   1. Si saltó un freno, FRENADO. Gana a todo lo demás: da igual cuántos
 *      cambios hubiera, no se ha mandado ni uno.
 *   2. Sin cambios que mandar, SIN CAMBIOS. Es el caso normal de un ciclo sano.
 *   3. Había cambios y no se envió (el interruptor del cliente está apagado, o
 *      esta llamada no traía la puerta de envío): SIMULACRO. Es útil igual —se
 *      ve cada quince minutos qué habría pasado— y es el estado en el que nace
 *      todo cliente.
 *   4. Se envió y no entró NI UNO: ERROR, no «enviado». Un envío que Amazon
 *      rechazó entero es un fallo, y tiene que sonar la campana y salir en el
 *      índice de incidencias; llamarlo «enviado» sería exactamente la clase de
 *      verde que hace que nadie mire.
 *   5. Se envió y entró algo: ENVIADO, con el desglose de aceptados y fallidos.
 */
export function estadoDe(simulacro: Simulacro, envio: EnvioRealizado | null): StockProfileRunState {
  if (!simulacro.frenos.puedeEnviar) return 'frenado'
  if (simulacro.cambios.length === 0) return 'sin_cambios'
  if (!envio) return 'simulacro'
  if (envio.aceptados === 0 && envio.fallidos > 0) return 'error'
  return 'enviado'
}

function mensajeDeEnvioFallido(envio: EnvioRealizado | null): string {
  if (!envio) return 'El envío ha fallado.'
  return (
    `Amazon no ha aceptado ninguno de los ${envio.fallidos} cambios del lote ${envio.batchId}.` +
    (envio.abortado ? ` ${envio.abortado}` : '') +
    ' El detalle de cada uno está en el historial de cambios de la conexión.'
  )
}

/**
 * La pantalla necesita saber de DÓNDE se leyó, no las 21.000 líneas.
 *
 * Se construye campo a campo en vez de con un `...resto` que descarte `lineas`:
 * así, el día que el lector devuelva algo nuevo, hay que decidir a conciencia si
 * eso viaja al navegador. Con el resto, cualquier campo nuevo —incluido otro
 * array de 21.000 elementos— se cuela solo en la respuesta.
 */
function quitarLineas(lectura: LecturaStock): ResumenLectura {
  return {
    perfil: lectura.perfil,
    hoja: lectura.hoja,
    filaCabecera: lectura.filaCabecera,
    cabeceras: lectura.cabeceras,
    columnas: lectura.columnas,
    filasSinCodigo: lectura.filasSinCodigo,
    avisos: lectura.avisos,
  }
}

/**
 * Lo mismo con las reglas, y aquí hay un segundo recorte que importa:
 * `descartadas` trae UNA ENTRADA POR LÍNEA EXCLUIDA. En un cliente que excluye
 * dos familias enteras son decenas de miles de objetos, y la respuesta pasaría
 * de unos cientos de kilobytes a varias decenas de megas para enseñar una lista
 * que nadie lee entera. Los totales por motivo (`porMotivo`) van completos, que
 * es lo que de verdad se mira.
 */
function quitarLineasReglas(r: ResultadoReglas): ResumenReglas {
  return {
    descartadas: r.descartadas.slice(0, MAX_DESCARTADAS),
    descartadasTotal: r.descartadas.length,
    sinPrecio: r.sinPrecio.slice(0, MAX_DESCARTADAS),
    sinPrecioTotal: r.sinPrecio.length,
    porMotivo: r.porMotivo,
    cortadasPorUmbral: r.cortadasPorUmbral,
    tocadasPorReserva: r.tocadasPorReserva,
    recortadasPorTope: r.recortadasPorTope,
    avisos: r.avisos,
    aplicadoEn: r.aplicadoEn,
  }
}

export { OrigenError }

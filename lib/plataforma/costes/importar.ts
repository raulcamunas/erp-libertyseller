/**
 * IMPORTAR UN FICHERO DE COSTES
 * =============================
 * SOLO SERVIDOR: llama a datos.ts.
 *
 * Junta las cuatro piezas puras —leer, cruzar, planificar, juzgar— y las
 * convierte en un informe. El informe es el mismo en simulacro y de verdad: eso
 * es lo que hace que lo que se ve en pantalla sea exactamente lo que va a pasar.
 *
 *
 * ============ NACE EN SIMULACRO Y NO SE PUEDE CAMBIAR SIN DECIRLO ============
 *
 * `modo` es obligatorio y quien llama tiene que escribir 'aplicado' a
 * conciencia. La pantalla enseña primero el simulacro con el plan entero —cuántas
 * altas, cuántas correcciones, qué cambia en cada una— y solo entonces ofrece
 * aplicarlo.
 *
 *
 * ============ POR QUÉ ESTO NO USA EL MOTOR DE TRABAJOS DE A1 ============
 *
 * El motor de A1 existe para procesos que hablan con Amazon: gastan cupo, tardan
 * horas y hay que poder reanudarlos donde se quedaron porque repetir un tramo
 * cuesta llamadas que no se recuperan. Aquí no hay nada de eso:
 *
 *   · La entrada es un fichero que alguien acaba de subir, y sus bytes NO
 *     sobreviven entre pasadas del cron: guardarlos para reanudar sería montar
 *     un almacén de ficheros de clientes que nadie ha pedido.
 *   · No se gasta ni una llamada a Amazon.
 *   · Y sobre todo: la escritura es IDEMPOTENTE por (cliente, SKU, fecha de
 *     entrada en vigor). Una importación que se corta a la mitad se «reanuda»
 *     volviéndola a lanzar: las filas que ya entraron salen como «sin cambio» y
 *     las que faltaban se escriben. Eso es más simple y más seguro que un cursor.
 *
 * Lo que sí se comparte con el motor es la disciplina: por lotes, con recuento
 * de lo que pasó, y con el rastro guardado aunque salga mal.
 */

import { randomUUID } from 'crypto'
import type { WorkbookInput } from '@/lib/stock-sync/engine'
import { registrarEvento } from '../eventos'
import { apartarSkusEnConflicto, cruzarCostes, type CosteCasado, type LineaSinSku } from './cruce'
import {
  aplicarPlan,
  costesEnFechas,
  listingsDeCliente,
  mapeosDeStockClient,
  marcarPerfil,
  paraCruce,
  registrarImportacion,
} from './datos'
import { leerCostes } from './lectura'
import { planificarEscritura, type CosteAEscribir, type PlanEscritura } from './plan'
import type { ModoImportacion, PerfilCostes } from './tipos'

/** Cuántos ejemplos viajan a la pantalla. Ni uno más: el informe se guarda en
    JSONB y trece mil filas dentro de una columna no las lee nadie */
export const MUESTRA = 50

export interface OpcionesImportacion {
  clientId: string
  perfil: PerfilCostes
  bytes: WorkbookInput
  /** Nombre del fichero, tal cual lo mandó el cliente */
  fichero: string
  /** La fecha de entrada en vigor por defecto. Manda la de la fila si la trae */
  validoDesde: string
  modo: ModoImportacion
  userId: string | null
  /** Solo cuando lo lanza una persona sobre un fichero suelto */
  motivo?: string | null
}

export interface MuestraCoste {
  sku: string
  articulo: string
  fila: number
  via: string
  coste: number
  moneda: string
  validoDesde: string
  /** Solo en las correcciones: qué cambia */
  cambia?: string[]
  antes?: number
}

export interface InformeImportacion {
  importId: string | null
  modo: ModoImportacion
  aplicado: boolean
  fichero: string
  perfil: string
  hoja: string
  filaCabecera: number
  cabeceras: string[]
  /** Qué columna del fichero se ha usado para cada campo. -1 = no venía */
  columnas: Record<string, number>

  filasLeidas: number
  filasSinIdentidad: number
  filasSinCoste: number
  casados: number
  sinCasar: number
  skusNoCubiertos: number
  fueraDelCatalogo: number

  altas: number
  correcciones: number
  sinCambio: number

  monedas: string[]
  fechas: string[]

  muestraAltas: MuestraCoste[]
  muestraCorrecciones: MuestraCoste[]
  muestraSinSku: Array<{ fila: number; articulo: string; motivo: string; detalle: string }>
  avisos: string[]
}

/**
 * Lee, cruza, planifica y —solo si se le pide— escribe.
 *
 * Lanza con mensaje en español cuando el fichero no se puede leer o cuando falta
 * la divisa: los dos son cosas que se arreglan en el perfil o pidiéndole otro
 * fichero al cliente, y las dos tienen que verse, no colarse a medias.
 */
export async function importarCostes(op: OpcionesImportacion): Promise<InformeImportacion> {
  const ahora = new Date().toISOString()
  await marcarPerfil(op.perfil.id, { last_run_at: ahora })

  try {
    const informe = await procesar(op)
    await marcarPerfil(op.perfil.id, {
      last_ok_at: new Date().toISOString(),
      last_error: null,
    })
    return informe
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error importando costes'
    await marcarPerfil(op.perfil.id, { last_error: mensaje.slice(0, 500) })

    // FALLO RUIDOSO. La importación la lanza una persona, así que la campana no
    // suena (el trigger de la 123 no avisa cuando hay `created_by`), pero la
    // incidencia queda en la cola: un cliente cuyo fichero lleva tres semanas
    // sin poder leerse es un cliente cuyo margen está calculado con costes de
    // hace tres semanas, y eso no se ve por ningún otro sitio.
    await registrarEvento({
      tipo: 'costes_importacion_fallida',
      severidad: 'error',
      clientId: op.clientId,
      mensaje: `No se ha podido importar el fichero de costes «${op.fichero}» con el perfil «${op.perfil.name}»: ${mensaje}`,
      detalle: { perfil: op.perfil.id, fichero: op.fichero, modo: op.modo },
      createdBy: op.userId,
    })

    await registrarImportacion({
      client_id: op.clientId,
      profile_id: op.perfil.id,
      perfil_nombre: op.perfil.name,
      fichero: op.fichero,
      modo: op.modo,
      valido_desde: op.validoDesde,
      estado: 'error',
      error_message: mensaje.slice(0, 2000),
      created_by: op.userId,
    })

    throw error
  }
}

async function procesar(op: OpcionesImportacion): Promise<InformeImportacion> {
  // ---------- 1) Leer ----------
  const lectura = leerCostes(op.bytes, op.perfil)

  // ---------- 2) Cruzar ----------
  const listings = await listingsDeCliente(op.clientId)
  const mapeos = op.perfil.stock_client_id
    ? await mapeosDeStockClient(op.perfil.stock_client_id)
    : []

  const cruce = cruzarCostes({
    lineas: lectura.lineas,
    mapeos,
    listings: paraCruce(listings),
  })

  const { buenos, conflictos, aviso: avisoConflictos } = apartarSkusEnConflicto(cruce.casados)
  const avisos = [...lectura.avisos, ...cruce.avisos]
  if (avisoConflictos) avisos.push(avisoConflictos)

  if (mapeos.length === 0 && op.perfil.stock_client_id) {
    avisos.push(
      'El cliente de sincronización de stock enlazado en el perfil no tiene ninguna fila de mapeo activa, ' +
        'así que el cruce solo ha podido usar el catálogo de Amazon. Si muchas líneas se quedan sin SKU, ' +
        'es por ahí.'
    )
  }

  // ---------- 3) Convertir a filas de coste ----------
  const { costes, sinMoneda } = aCostes(buenos, op)
  if (sinMoneda > 0 && costes.length === 0) {
    throw new Error(
      `Ninguna línea del fichero tiene divisa: ni el fichero trae columna ni el perfil «${op.perfil.name}» ` +
        'tiene una puesta. No se importa nada a propósito: un coste sin divisa no se puede comparar con un ' +
        'precio de Amazon en cuanto el cliente compre en dólares y venda en euros.'
    )
  }
  if (sinMoneda > 0) {
    avisos.push(
      `${sinMoneda} líneas se han quedado fuera por no tener divisa. Pon la divisa del perfil o pide el ` +
        'fichero con su columna.'
    )
  }

  // ---------- 4) Planificar ----------
  const fechas = [...new Set(costes.map((c) => c.valido_desde))].sort()
  const existentes = await costesEnFechas(op.clientId, fechas)
  const plan = planificarEscritura(costes, existentes)

  // ---------- 5) Escribir, si toca ----------
  const importId = randomUUID()
  let aplicado = false
  let errorAlAplicar: string | null = null

  if (op.modo === 'aplicado' && (plan.altas.length > 0 || plan.correcciones.length > 0)) {
    try {
      await aplicarPlan(op.clientId, plan, {
        userId: op.userId,
        importId,
        motivo: op.motivo ?? `Importación del fichero ${op.fichero}`,
      })
      aplicado = true
    } catch (error) {
      errorAlAplicar = error instanceof Error ? error.message : 'Error escribiendo los costes'
    }
  }

  const informe = montarInforme({
    op,
    importId,
    lectura,
    cruce: { ...cruce, casados: buenos, conflictos },
    plan,
    aplicado,
    avisos,
    costes,
  })

  // ---------- 6) El rastro ----------
  // Se escribe SIEMPRE, también en simulacro: saber que alguien probó un fichero
  // y vio que no casaba nada es justo lo que hace falta cuando tres semanas
  // después nadie se acuerda de por qué ese cliente no tiene costes.
  await registrarImportacion({
    id: importId,
    client_id: op.clientId,
    profile_id: op.perfil.id,
    perfil_nombre: op.perfil.name,
    fichero: op.fichero,
    bytes: tamano(op.bytes),
    modo: op.modo,
    valido_desde: op.validoDesde,
    filas_leidas: informe.filasLeidas,
    filas_sin_coste: informe.filasSinCoste,
    filas_sin_referencia: informe.filasSinIdentidad,
    casados: informe.casados,
    sin_casar: informe.sinCasar,
    altas: aplicado || op.modo === 'simulacro' ? informe.altas : 0,
    correcciones: aplicado || op.modo === 'simulacro' ? informe.correcciones : 0,
    sin_cambio: informe.sinCambio,
    avisos: informe.avisos,
    detalle: {
      muestraSinSku: informe.muestraSinSku,
      columnas: informe.columnas,
      hoja: informe.hoja,
    },
    estado: errorAlAplicar ? 'error' : 'ok',
    error_message: errorAlAplicar,
    created_by: op.userId,
  })

  if (errorAlAplicar) throw new Error(errorAlAplicar)

  // Nada casó: no es una excepción, pero tampoco puede pasar en silencio. Un
  // fichero que se lee bien y no llega a ningún SKU significa que el mapeo está
  // mal enlazado, y desde fuera se parece muchísimo a que todo ha ido bien.
  if (informe.casados === 0 && informe.filasLeidas > 0) {
    await registrarEvento({
      tipo: 'costes_sin_casar',
      severidad: 'aviso',
      clientId: op.clientId,
      mensaje:
        `El fichero de costes «${op.fichero}» se ha leído bien (${informe.filasLeidas} líneas) pero ` +
        'ninguna ha llegado a un SKU. Revisa el mapeo enlazado en el perfil o las columnas de identidad.',
      detalle: { perfil: op.perfil.id, importId },
      createdBy: op.userId,
    })
  }

  return informe
}

/* ------------------------------------------------------------------ */
/* De línea casada a fila de coste                                     */
/* ------------------------------------------------------------------ */

function aCostes(
  casados: CosteCasado[],
  op: OpcionesImportacion
): { costes: CosteAEscribir[]; sinMoneda: number } {
  const costes: CosteAEscribir[] = []
  let sinMoneda = 0

  for (const fila of casados) {
    // La divisa de la fila manda sobre la del perfil, y si no hay ninguna la
    // línea se cae. NO se supone euros: un cliente que compra en dólares y
    // vende en euros con la divisa dada por supuesta produce márgenes
    // inventados, y ningún fichero de proveedor lleva escrito «esto son euros».
    const moneda = fila.linea.moneda || op.perfil.moneda || ''
    if (!moneda) {
      sinMoneda += 1
      continue
    }

    costes.push({
      sku: fila.sku,
      valido_desde: fila.linea.validoDesde ?? op.validoDesde,
      coste: fila.linea.coste as number,
      moneda,
      coste_envio: fila.linea.costeEnvio,
      coste_almacen_fba: fila.linea.costeAlmacen,
      coste_flete_fba: fila.linea.costeFlete,
      iva_incluido: op.perfil.iva_incluido,
      iva_porcentaje: op.perfil.iva_porcentaje,
      origen: 'fichero',
      // Con el nombre del fichero basta para investigar una cifra rara: la fila
      // de importación tiene el resto (perfil, hoja, huella, quién y cuándo).
      fuente_ref: op.fichero.slice(0, 200),
      notes: null,
    })
  }

  return { costes, sinMoneda }
}

/* ------------------------------------------------------------------ */
/* El informe                                                          */
/* ------------------------------------------------------------------ */

function montarInforme(params: {
  op: OpcionesImportacion
  importId: string
  lectura: ReturnType<typeof leerCostes>
  cruce: {
    casados: CosteCasado[]
    conflictos: CosteCasado[]
    lineasSinSku: LineaSinSku[]
    skusNoCubiertos: number
    fueraDelCatalogo: number
  }
  plan: PlanEscritura
  aplicado: boolean
  avisos: string[]
  costes: CosteAEscribir[]
}): InformeImportacion {
  const { op, lectura, cruce, plan } = params

  const porSku = new Map(cruce.casados.map((c) => [c.sku, c]))
  const muestra = (coste: CosteAEscribir): MuestraCoste => {
    const casado = porSku.get(coste.sku)
    return {
      sku: coste.sku,
      articulo: casado?.linea.articulo ?? '',
      fila: casado?.linea.fila ?? 0,
      via: casado?.via ?? '',
      coste: coste.coste,
      moneda: coste.moneda,
      validoDesde: coste.valido_desde,
    }
  }

  return {
    importId: params.importId,
    modo: op.modo,
    aplicado: params.aplicado,
    fichero: op.fichero,
    perfil: op.perfil.name,
    hoja: lectura.hoja,
    filaCabecera: lectura.filaCabecera,
    cabeceras: lectura.cabeceras,
    columnas: lectura.columnas,

    filasLeidas: lectura.lineas.length,
    filasSinIdentidad: lectura.filasSinIdentidad,
    filasSinCoste: lectura.filasSinCoste,
    casados: cruce.casados.length,
    sinCasar: cruce.lineasSinSku.length + cruce.conflictos.length,
    skusNoCubiertos: cruce.skusNoCubiertos,
    fueraDelCatalogo: cruce.fueraDelCatalogo,

    altas: plan.altas.length,
    correcciones: plan.correcciones.length,
    sinCambio: plan.sinCambio,

    monedas: [...new Set(params.costes.map((c) => c.moneda))].sort(),
    fechas: [...new Set(params.costes.map((c) => c.valido_desde))].sort(),

    muestraAltas: plan.altas.slice(0, MUESTRA).map(muestra),
    muestraCorrecciones: plan.correcciones.slice(0, MUESTRA).map((correccion) => ({
      ...muestra(correccion.nuevo),
      cambia: correccion.campos,
      antes: correccion.antes.coste,
    })),
    muestraSinSku: cruce.lineasSinSku.slice(0, MUESTRA).map((sin) => ({
      fila: sin.linea.fila,
      articulo: sin.linea.articulo || sin.linea.sku,
      motivo: sin.motivo,
      detalle: sin.detalle,
    })),
    avisos: params.avisos,
  }
}

function tamano(bytes: WorkbookInput): number {
  if (bytes instanceof Uint8Array) return bytes.byteLength
  return (bytes as ArrayBuffer).byteLength ?? 0
}

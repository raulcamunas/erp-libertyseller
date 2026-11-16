/**
 * LAS RUTAS DE AJUSTES DE REMESAS, LA PARTE PURA (spec remesas-pro §9, §11 D10, D13 y D14). Se prueba con ajustes-api.prueba.ts.
 * ==============================================================================================================================
 * Lo usan tres rutas (paquete S6):
 *
 *   /api/fba/alertas/config      el plazo por etapas del cliente. El PUT es PARCIAL: solo escribe las claves que llegan
 *                                (`cambiosConfigAlertas`) y, con `confirmarPlazos: true`, guarda como manuales las etapas
 *                                vigentes (las de partida o las medidas), que es lo que apaga la banda «plazo de partida».
 *   /api/fba/reposicion-config   los ajustes del planificador (tabla propia, `fba_reposicion_config`), con las medidas
 *                                del cliente al lado (`medidasDesdeEnvios`).
 *   /api/fba/reposicion-sku      caja, cobertura y exclusión de una referencia (`validarCambiosSku` + `filaSkuFusionada`),
 *                                y la caja deducida de sus envíos (`cantidadesPorSku`, `cajasDelEncaje`).
 *
 * La lectura de la base está en `ajustes-datos.ts`. Aquí no hay fechas del sistema: `hoy` y `ahora` llegan de fuera.
 */

import { antelacionValida, plazoValido } from './alertas'
import { medirCadencia, medirRecepcion, medirTransporte } from './medidas-cliente'
import type { MedidasCliente } from './plan-tipos'
import { etapasValidas, totalDeEtapas, type EtapasDePlazo } from './plazos'

/* ------------------------------------------------------------------ */
/* Plazos (fba_alertas_config): PUT parcial y «Confirmar plazos»        */
/* ------------------------------------------------------------------ */

/** La fila de `fba_alertas_config` (las etapas solo existen con la migración 291) */
export interface FilaConfigAlertas {
  plazo_reposicion_dias: number
  antelacion_dias: number
  avisar: boolean
  dias_preparacion?: number | null
  dias_transporte?: number | null
  dias_recepcion?: number | null
  margen_dias?: number | null
}

/** Las cuatro etapas guardadas, o null si falta alguna (o la fila no existe) */
export const etapasDeFila = (f: FilaConfigAlertas | null): EtapasDePlazo | null =>
  f && f.dias_preparacion != null && f.dias_transporte != null && f.dias_recepcion != null && f.margen_dias != null
    ? { preparacion: f.dias_preparacion, transporte: f.dias_transporte, recepcion: f.dias_recepcion, margen: f.margen_dias }
    : null

/** La fila en la forma que pide `plazoDelCliente` (planificador.ts). Sin fila, null: plazo medido o de partida */
export function configParaPlazo(f: FilaConfigAlertas | null): {
  diasPreparacion: number | null; diasTransporte: number | null; diasRecepcion: number | null; diasMargen: number | null; total: number | null
} | null {
  if (!f) return null
  return {
    diasPreparacion: f.dias_preparacion ?? null,
    diasTransporte: f.dias_transporte ?? null,
    diasRecepcion: f.dias_recepcion ?? null,
    diasMargen: f.margen_dias ?? null,
    total: typeof f.plazo_reposicion_dias === 'number' ? f.plazo_reposicion_dias : null,
  }
}

export const TEXTO_FALTA_291 = 'Falta lanzar la migración 291 en Supabase para guardar el plazo por etapas.'
export const TEXTO_SIN_PLAZO_GUARDADO =
  'Este cliente todavía no tiene plazos guardados: confírmalos o ponlos antes de cambiar solo la antelación o los avisos (si no, se guardaría un plazo de 45 días que nadie ha puesto).'

export type ResultadoConfigAlertas =
  | {
      ok: true
      /** Columnas que se escriben (sin client_id ni autor). null = no hay nada que tocar en la config (p. ej. solo plazos por SKU) */
      cambios: Record<string, unknown> | null
      /** Las etapas que se han confirmado con `confirmarPlazos`, para contestar a la pantalla */
      confirmadas: EtapasDePlazo | null
    }
  | { ok: false; status: 400 | 409; error: string }

/**
 * El PUT de `/api/fba/alertas/config`, PARCIAL. Solo se escribe lo que llega:
 *   · `etapas` → las cuatro etapas y el total (su suma).
 *   · `confirmarPlazos: true` (sin `etapas`) → las etapas VIGENTES (`vigentes`: manuales, medidas o de partida) pasan a manuales.
 *   · `plazoDias` (sin etapas) → el total; si ya había etapas que no suman eso, se borran (el desglose ya no dice la verdad).
 *   · `antelacionDias` y `avisar`, solo si llegan: ya NO se fuerzan 14 y true cuando faltan.
 * Un cliente sin fila que solo cambia la antelación o el aviso se rechaza: insertar la fila guardaría el plazo de 45 días por
 * defecto de la columna como si fuera manual, y el planificador dejaría de usar el medido.
 */
export function cambiosConfigAlertas(
  cuerpo: Record<string, unknown>,
  previo: FilaConfigAlertas | null,
  opciones: { vigentes: EtapasDePlazo | null; sinMigrar291: boolean },
): ResultadoConfigAlertas {
  const cambios: Record<string, unknown> = {}
  const confirmar = cuerpo.confirmarPlazos === true
  if (cuerpo.confirmarPlazos !== undefined && typeof cuerpo.confirmarPlazos !== 'boolean') {
    return { ok: false, status: 400, error: '«confirmarPlazos» tiene que ser sí o no' }
  }

  let etapas: EtapasDePlazo | null = null
  let confirmadas: EtapasDePlazo | null = null
  if (cuerpo.etapas !== undefined && cuerpo.etapas !== null) {
    etapas = etapasValidas(cuerpo.etapas)
    if (!etapas) return { ok: false, status: 400, error: 'Cada etapa tiene que ser un número de días entre 0 y 365, y el total, de 1 a 365' }
  } else if (confirmar) {
    etapas = opciones.vigentes ? etapasValidas(opciones.vigentes) : null
    if (!etapas) return { ok: false, status: 400, error: 'No se han podido calcular los plazos vigentes de este cliente para confirmarlos' }
    confirmadas = etapas
  }
  if (etapas && opciones.sinMigrar291) return { ok: false, status: 409, error: TEXTO_FALTA_291 }

  let plazo: number | null = null
  if (etapas) {
    plazo = totalDeEtapas(etapas)
    Object.assign(cambios, {
      plazo_reposicion_dias: plazo,
      dias_preparacion: etapas.preparacion,
      dias_transporte: etapas.transporte,
      dias_recepcion: etapas.recepcion,
      margen_dias: etapas.margen,
    })
  } else if (cuerpo.plazoDias !== undefined) {
    plazo = plazoValido(cuerpo.plazoDias)
    if (plazo === null) return { ok: false, status: 400, error: 'El plazo de reposición tiene que ser un número de días, entre 1 y 365' }
    cambios.plazo_reposicion_dias = plazo
    const anteriores = etapasDeFila(previo)
    if (anteriores && totalDeEtapas(anteriores) !== plazo) {
      Object.assign(cambios, { dias_preparacion: null, dias_transporte: null, dias_recepcion: null, margen_dias: null })
    }
  }

  if (cuerpo.antelacionDias !== undefined) {
    const a = antelacionValida(cuerpo.antelacionDias)
    if (a === null) return { ok: false, status: 400, error: 'La antelación tiene que ser un número de días, entre 0 y 120' }
    cambios.antelacion_dias = a
  }
  if (cuerpo.avisar !== undefined) {
    if (typeof cuerpo.avisar !== 'boolean') return { ok: false, status: 400, error: '«Avisar» tiene que ser sí o no' }
    cambios.avisar = cuerpo.avisar
  }

  if (Object.keys(cambios).length === 0) return { ok: true, cambios: null, confirmadas }
  if (!previo && plazo === null) return { ok: false, status: 400, error: TEXTO_SIN_PLAZO_GUARDADO }
  return { ok: true, cambios, confirmadas }
}

/* ------------------------------------------------------------------ */
/* Medidas del cliente (transporte, recepción, cadencia)                */
/* ------------------------------------------------------------------ */

export interface ReciboFila {
  referencia: string
  marketplaceId: string
  fecha: string
  cantidad: number
}

/**
 * Los Receipts del libro por número de envío, SIN la copia de cada mercado.
 * El libro es de toda la cuenta y se guarda bajo cada mercado leído (spec §0.2): sumar las copias doblaría lo recibido y la
 * recepción «llegaría al 90 %» con la mitad. Por número de envío se queda UNA copia: la del mercado que más unidades trae
 * (la lectura más completa); a igualdad, España, y si no, el orden alfabético.
 */
export function recibosSinDuplicar(filas: readonly ReciboFila[]): Map<string, Array<{ fecha: string; cantidad: number }>> {
  const porRef = new Map<string, Map<string, Array<{ fecha: string; cantidad: number }>>>()
  for (const f of filas) {
    if (!f.referencia || !f.fecha) continue
    const cantidad = Number(f.cantidad)
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue
    const porMercado = porRef.get(f.referencia) ?? new Map<string, Array<{ fecha: string; cantidad: number }>>()
    const lista = porMercado.get(f.marketplaceId) ?? []
    lista.push({ fecha: f.fecha.slice(0, 10), cantidad })
    porMercado.set(f.marketplaceId, lista)
    porRef.set(f.referencia, porMercado)
  }
  const salida = new Map<string, Array<{ fecha: string; cantidad: number }>>()
  for (const [ref, porMercado] of porRef) {
    const elegido = [...porMercado.entries()]
      .map(([mercado, lista]) => ({ mercado, lista, suma: lista.reduce((s, x) => s + x.cantidad, 0) }))
      .sort((a, b) => b.suma - a.suma || Number(b.mercado === 'A1RKKUPIHCS9HS') - Number(a.mercado === 'A1RKKUPIHCS9HS') || a.mercado.localeCompare(b.mercado))[0]
    salida.set(ref, [...elegido.lista].sort((a, b) => a.fecha.localeCompare(b.fecha)))
  }
  return salida
}

export interface EnvioMedible {
  fechaEnvio: string
  unidades: number
  referenciaEnvio: string | null
}

/**
 * Las medidas del cliente con sus remesas enviadas o cerradas y los Receipts de cada una (spec D10 y D14):
 *   · transporte = mediana envío → primer Receipt (6 últimos);
 *   · recepción = p75 del primer Receipt al 90 % de lo enviado (6 últimos);
 *   · `enviosMedidos` = cuántos de los 6 últimos tienen un Receipt en o después del envío (el planificador pide ≥ 2);
 *   · cadencia y tamaño típico con las 8 últimas.
 */
export function medidasDesdeEnvios(envios: readonly EnvioMedible[], recibos: Map<string, Array<{ fecha: string; cantidad: number }>>, hoy: string): MedidasCliente {
  const validos = envios.filter((e) => typeof e.fechaEnvio === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.fechaEnvio))
  const conRecibos = validos.map((e) => {
    const lista = e.referenciaEnvio ? recibos.get(e.referenciaEnvio) ?? [] : []
    const primer = lista.reduce<string | null>((m, x) => (m === null || x.fecha < m ? x.fecha : m), null)
    return { e, lista, primer, fecha: e.fechaEnvio.slice(0, 10) }
  })
  const transporteMediano = medirTransporte(conRecibos.map((x) => ({ fechaEnvio: x.fecha, primerReceipt: x.primer })))
  const recepcionP75 = medirRecepcion(conRecibos.filter((x) => x.lista.length > 0).map((x) => ({ enviadas: x.e.unidades, receipts: x.lista })), hoy)
  const enviosMedidos = Math.min(6, conRecibos.filter((x) => x.primer !== null && x.primer >= x.fecha).length)
  const cadencia = medirCadencia(validos.map((e) => ({ fechaEnvio: e.fechaEnvio.slice(0, 10), unidades: e.unidades })))
  return { transporteMediano, recepcionP75, enviosMedidos, cadenciaDias: cadencia.cadenciaDias, tamanoTipico: cadencia.tamanoTipico }
}

export const MEDIDAS_VACIAS: MedidasCliente = { transporteMediano: null, recepcionP75: null, enviosMedidos: 0, cadenciaDias: null, tamanoTipico: null }

/* ------------------------------------------------------------------ */
/* Caja de una referencia (D13)                                         */
/* ------------------------------------------------------------------ */

/** Envíos que se miran para deducir la caja de una referencia (los más recientes en que aparece) */
export const ENVIOS_PARA_CAJA = 6

/**
 * Por referencia, las unidades que se mandaron en cada una de sus últimas remesas (más reciente primero; varias líneas del mismo
 * SKU en una remesa se suman). `remesas` llega ordenada de la más reciente a la más vieja.
 */
export function cantidadesPorSku(remesas: ReadonlyArray<{ id: string; lineas: ReadonlyArray<{ sku: string; unidades: number }> }>, maximo = ENVIOS_PARA_CAJA): Map<string, number[]> {
  const salida = new Map<string, number[]>()
  for (const r of remesas) {
    const porSku = new Map<string, number>()
    for (const l of r.lineas) {
      const u = Number(l.unidades)
      if (!l.sku || !Number.isFinite(u) || u <= 0) continue
      porSku.set(l.sku, (porSku.get(l.sku) ?? 0) + u)
    }
    for (const [sku, u] of porSku) {
      const lista = salida.get(sku) ?? []
      if (lista.length < maximo) lista.push(u)
      salida.set(sku, lista)
    }
  }
  return salida
}

/**
 * La caja de cada referencia según el encaje: en las cajas que llevan UNA sola referencia, el número de unidades que más se
 * repite, si sale al menos 2 veces (la última caja de un envío suele ir a medias y no dice nada). A igualdad, el mayor.
 */
export function cajasDelEncaje(cajas: ReadonlyArray<{ contenido: ReadonlyArray<{ sku: string; unidades: number }> }>): Map<string, number> {
  const cuenta = new Map<string, Map<number, number>>()
  for (const c of cajas) {
    const conUnidades = c.contenido.filter((x) => x.sku && Number(x.unidades) > 0)
    const skus = new Set(conUnidades.map((x) => x.sku))
    if (skus.size !== 1) continue
    const sku = conUnidades[0].sku
    const u = Math.round(conUnidades.reduce((s, x) => s + Number(x.unidades), 0))
    if (u < 1 || u > 500) continue
    const m = cuenta.get(sku) ?? new Map<number, number>()
    m.set(u, (m.get(u) ?? 0) + 1)
    cuenta.set(sku, m)
  }
  const salida = new Map<string, number>()
  for (const [sku, m] of cuenta) {
    const mejor = [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    if (mejor && mejor[1] >= 2) salida.set(sku, mejor[0])
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Ajustes de una referencia (fba_reposicion_sku)                       */
/* ------------------------------------------------------------------ */

export interface FilaReposicionSku {
  client_id: string
  sku: string
  unidades_caja: number | null
  cobertura_dias: number | null
  excluir: boolean
  motivo: string | null
  actualizado_at?: string | null
  actualizado_por?: string | null
}

/** Lo que se pide cambiar de una referencia. `undefined` = no se toca; `null` = se quita */
export interface CambioSku {
  sku: string
  unidadesCaja?: number | null
  coberturaDias?: number | null
  excluir?: boolean
  motivo?: string | null
  /** «Guardar caja deducida»: la caja que se guarda es la que deduce el servidor de sus envíos */
  guardarCajaDeducida?: boolean
}

export const MAX_SKU_POR_PETICION = 400
export const LIMITES_SKU = {
  caja: { min: 1, max: 500 },
  cobertura: { min: 7, max: 180 },
  motivo: 300,
  sku: 120,
} as const

function entero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim().replace(',', '.')) : Number.NaN
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

export type ResultadoCambiosSku = { ok: true; cambios: CambioSku[] } | { ok: false; errores: string[] }

/**
 * Valida el cuerpo del PUT de `/api/fba/reposicion-sku`: una referencia (`{ sku, … }`) o varias (`{ filas: [{ sku, … }] }`).
 * Es parcial por referencia: lo que no llega no se toca. Fuera de rango es un error (no se acota: una caja de 600 es un dedo
 * que se ha ido, no un dato).
 */
export function validarCambiosSku(cuerpo: Record<string, unknown>): ResultadoCambiosSku {
  const brutos: unknown[] = Array.isArray(cuerpo.filas) ? cuerpo.filas : [cuerpo]
  if (brutos.length === 0) return { ok: false, errores: ['No llega ninguna referencia.'] }
  if (brutos.length > MAX_SKU_POR_PETICION) return { ok: false, errores: [`Como mucho ${MAX_SKU_POR_PETICION} referencias por vez.`] }

  const errores: string[] = []
  const cambios: CambioSku[] = []
  const vistos = new Set<string>()
  for (const b of brutos) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      errores.push('Cada referencia tiene que ser un objeto con su «sku».')
      continue
    }
    const o = b as Record<string, unknown>
    const sku = typeof o.sku === 'string' ? o.sku.trim() : ''
    if (!sku || sku.length > LIMITES_SKU.sku) {
      errores.push('Falta la referencia (sku) o es demasiado larga.')
      continue
    }
    if (vistos.has(sku)) {
      errores.push(`${sku} viene repetida.`)
      continue
    }
    vistos.add(sku)
    const c: CambioSku = { sku }
    let algo = false

    if (o.guardarCajaDeducida !== undefined) {
      if (typeof o.guardarCajaDeducida !== 'boolean') errores.push(`${sku}: «guardar caja deducida» tiene que ser sí o no.`)
      else if (o.guardarCajaDeducida) {
        if (o.unidadesCaja !== undefined) errores.push(`${sku}: o la caja a mano o la deducida, no las dos.`)
        c.guardarCajaDeducida = true
        algo = true
      }
    }
    if (o.unidadesCaja !== undefined && !c.guardarCajaDeducida) {
      if (o.unidadesCaja === null || o.unidadesCaja === '') c.unidadesCaja = null
      else {
        const n = entero(o.unidadesCaja)
        if (n === null || n < LIMITES_SKU.caja.min || n > LIMITES_SKU.caja.max) errores.push(`${sku}: las unidades por caja van de ${LIMITES_SKU.caja.min} a ${LIMITES_SKU.caja.max} (llega «${String(o.unidadesCaja)}»).`)
        else c.unidadesCaja = n
      }
      algo = true
    }
    if (o.coberturaDias !== undefined) {
      if (o.coberturaDias === null || o.coberturaDias === '') c.coberturaDias = null
      else {
        const n = entero(o.coberturaDias)
        if (n === null || n < LIMITES_SKU.cobertura.min || n > LIMITES_SKU.cobertura.max) errores.push(`${sku}: la cobertura va de ${LIMITES_SKU.cobertura.min} a ${LIMITES_SKU.cobertura.max} días (llega «${String(o.coberturaDias)}»).`)
        else c.coberturaDias = n
      }
      algo = true
    }
    if (o.excluir !== undefined) {
      if (typeof o.excluir !== 'boolean') errores.push(`${sku}: «excluir» tiene que ser sí o no.`)
      else c.excluir = o.excluir
      algo = true
    }
    if (o.motivo !== undefined) {
      if (o.motivo === null) c.motivo = null
      else if (typeof o.motivo !== 'string') errores.push(`${sku}: el motivo tiene que ser un texto.`)
      else {
        const t = o.motivo.trim()
        if (t.length > LIMITES_SKU.motivo) errores.push(`${sku}: el motivo es demasiado largo (máximo ${LIMITES_SKU.motivo} caracteres).`)
        else c.motivo = t === '' ? null : t
      }
      algo = true
    }
    if (!algo) {
      errores.push(`${sku}: no llega nada que cambiar.`)
      continue
    }
    cambios.push(c)
  }
  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, cambios }
}

export type ResultadoFilaSku =
  | { ok: true; fila: FilaReposicionSku; vacia: boolean }
  | { ok: false; error: string }

/**
 * La fila COMPLETA que queda tras aplicar un cambio a la guardada (siempre las mismas columnas: un upsert en lote con filas de
 * claves distintas pone NULL en las que faltan, spec §0.1).
 *   · «Guardar caja deducida» sin caja deducida es un error.
 *   · Dejar de excluir sin decir motivo borra el motivo (era el de la exclusión).
 *   · `vacia` = no queda nada propio (sin caja, sin cobertura, sin excluir y sin motivo): la ruta borra la fila.
 */
export function filaSkuFusionada(
  clienteId: string,
  previa: FilaReposicionSku | null,
  cambio: CambioSku,
  cajaDeducidaSku: number | null,
  autor: { usuarioId: string | null; ahora: string },
): ResultadoFilaSku {
  let unidadesCaja = previa?.unidades_caja ?? null
  if (cambio.guardarCajaDeducida) {
    if (cajaDeducidaSku === null || !(cajaDeducidaSku >= LIMITES_SKU.caja.min && cajaDeducidaSku <= LIMITES_SKU.caja.max)) {
      return { ok: false, error: `${cambio.sku}: sus envíos no dejan deducir una caja; ponla a mano.` }
    }
    unidadesCaja = cajaDeducidaSku
  } else if (cambio.unidadesCaja !== undefined) {
    unidadesCaja = cambio.unidadesCaja
  }
  const coberturaDias = cambio.coberturaDias !== undefined ? cambio.coberturaDias : previa?.cobertura_dias ?? null
  const excluir = cambio.excluir !== undefined ? cambio.excluir : previa?.excluir === true
  let motivo = cambio.motivo !== undefined ? cambio.motivo : previa?.motivo ?? null
  if (cambio.excluir === false && cambio.motivo === undefined) motivo = null

  const fila: FilaReposicionSku = {
    client_id: clienteId,
    sku: cambio.sku,
    unidades_caja: unidadesCaja,
    cobertura_dias: coberturaDias,
    excluir,
    motivo,
    actualizado_at: autor.ahora,
    actualizado_por: autor.usuarioId,
  }
  const vacia = unidadesCaja === null && coberturaDias === null && !excluir && motivo === null
  return { ok: true, fila, vacia }
}

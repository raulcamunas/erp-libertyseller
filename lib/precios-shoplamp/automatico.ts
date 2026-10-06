import { randomUUID } from 'node:crypto'
import { registrarEvento } from '@/lib/plataforma/eventos'
import { sendChanges, type ChangeToSend } from '@/lib/amazon/data'
import { construirPlan, type FilaPlan } from './plan'
import { MAX_POR_TRAMO } from './reglas'

/**
 * LA PASADA AUTOMÁTICA DE PRECIOS DE SHOPLAMP.
 * ============================================
 * SOLO SERVIDOR. Esto PUBLICA en la tienda de un cliente sin que nadie mire.
 *
 * España tiene precios dinámicos: un repricer la mueve sola. Medido, unas nueve
 * referencias españolas cambian cada once horas, y como España es la base, cada
 * una arrastra tres filas. A mano eso es entrar cada día a repasar veinticinco
 * líneas; automatizado es que los tres países sigan a España sin que nadie haga
 * nada.
 *
 *
 * ============ LO QUE DE VERDAD IMPORTA DE ESTE FICHERO ============
 *
 * No es que publique: es QUÉ SE NIEGA A PUBLICAR. Un automático de precios que
 * solo sabe decir que sí es una forma elegante de propagar un error a tres
 * países cada seis horas. Los frenos son tres y los tres se han puesto con un
 * número medido, no a ojo:
 *
 *   1. EL SALTO POR REFERENCIA. Si el precio nuevo se aparta más de un 25 % del
 *      que está publicado hoy, esa fila NO se manda y se deja para que la mire
 *      una persona. La deriva normal de un repricer es de céntimos; un salto
 *      grande significa que España ha hecho algo raro —o que el espejo está
 *      desfasado—, y ninguna de las dos cosas se arregla publicando.
 *
 *   2. EL TAMAÑO DEL LOTE. Si de golpe cambian más de 150 referencias, no se
 *      manda NADA y se levanta un aviso. Lo normal son veinticinco en once
 *      horas. Ciento cincuenta no es un día movido: es que algo se ha roto
 *      aguas arriba —una resincronización, un fallo del repricer, un censo que
 *      ha traído precios malos— y mandar mil doscientos cambios por si acaso es
 *      exactamente el accidente que esto tiene que evitar.
 *
 *   3. LAS QUE NO TIENEN FICHA FUERA NO SE TOCAN. Ya lo garantiza el plan —una
 *      fila 'sin_listado' no lleva precio calculado— pero aquí se filtra otra
 *      vez por `estado === 'cambia'`, que es la única clase enviable.
 *
 * Cuando un freno salta NO se calla: deja un evento que suena en la campana del
 * ERP, con el número y el motivo. Un automático que se planta en silencio es
 * indistinguible de un automático que no se ha ejecutado.
 *
 *
 * ============ POR QUÉ NO SIMULA ANTES ============
 *
 * La pantalla obliga a simular porque hay una persona a punto de pulsar y la
 * simulación es lo que le dice si Amazon lo aceptaría. Aquí no hay nadie: una
 * simulación previa doblaría las llamadas y lo único que haría con el resultado
 * sería lo mismo que ya hace con el resultado del envío de verdad —anotarlo—.
 * Lo que sustituye a la simulación son los frenos de arriba.
 */

/** Más de esto en un solo lote y no se manda nada: algo ha pasado aguas arriba */
export const MAX_AUTOMATICO = 150

/** Cuánto puede apartarse un precio del que está publicado hoy, sin intervención */
export const SALTO_MAXIMO = 0.25

export interface ResultadoAutomatico {
  /** null si Shoplamp no tiene conexión activa: no es un error, es un estado */
  connectionId: string | null
  /** Cuántas cambiaban según el plan */
  candidatas: number
  /** Las que se han mandado */
  enviadas: number
  aceptadas: number
  fallidas: number
  /** Apartadas por el freno del salto, con su motivo */
  frenadas: { sku: string; pais: string; actual: number | null; destino: number; salto: number }[]
  /** Si se ha plantado entero, por qué */
  plantado: string | null
  batchId: string | null
}

/** ¿Cuánto se aparta el precio nuevo del que hay publicado? */
export function salto(actual: number | null, destino: number): number {
  // Sin precio publicado no hay salto que medir, y tampoco hay nada que romper:
  // poner precio donde no había es la operación menos peligrosa de todas.
  if (actual === null || actual <= 0) return 0
  return Math.abs(destino - actual) / actual
}

export async function pasadaAutomatica(userId: string | null): Promise<ResultadoAutomatico> {
  const vacio: ResultadoAutomatico = {
    connectionId: null,
    candidatas: 0,
    enviadas: 0,
    aceptadas: 0,
    fallidas: 0,
    frenadas: [],
    plantado: null,
    batchId: null,
  }

  const plan = await construirPlan()
  if (!plan.connectionId) {
    return { ...vacio, plantado: 'Shoplamp no tiene ninguna cuenta de Amazon conectada y activa.' }
  }

  const candidatas = plan.filas.filter(
    (f): f is FilaPlan & { destino: number } =>
      f.estado === 'cambia' && f.destino !== null && f.productType !== null
  )

  if (candidatas.length === 0) {
    return { ...vacio, connectionId: plan.connectionId }
  }

  // ---- Freno 1: el salto por referencia ----
  const frenadas: ResultadoAutomatico['frenadas'] = []
  const enviables = candidatas.filter((f) => {
    const s = salto(f.actual, f.destino)
    if (s <= SALTO_MAXIMO) return true
    frenadas.push({ sku: f.sku, pais: f.pais, actual: f.actual, destino: f.destino, salto: s })
    return false
  })

  // ---- Freno 2: el tamaño del lote ----
  if (enviables.length > MAX_AUTOMATICO) {
    return {
      ...vacio,
      connectionId: plan.connectionId,
      candidatas: candidatas.length,
      frenadas,
      plantado:
        `${enviables.length} referencias querían cambiar de precio de golpe, y el tope automático ` +
        `son ${MAX_AUTOMATICO}. No se ha mandado nada. Lo normal son unas veinticinco: un número ` +
        'así significa que algo ha cambiado aguas arriba —una resincronización, el repricer de ' +
        'España, un censo con precios malos—. Revísalo en Precios Shoplamp y aplícalo a mano.',
    }
  }

  // ---- A Amazon, en tramos y con un solo identificador de lote ----
  const batchId = randomUUID()
  let aceptadas = 0
  let fallidas = 0

  for (let i = 0; i < enviables.length; i += MAX_POR_TRAMO) {
    const tramo = enviables.slice(i, i + MAX_POR_TRAMO)
    const cambios: ChangeToSend[] = tramo.map((f) => ({
      sku: f.sku,
      marketplaceId: f.marketplaceId,
      field: 'precio',
      newValue: f.destino,
    }))

    const res = await sendChanges({
      connectionId: plan.connectionId,
      changes: cambios,
      source: 'manual',
      userId,
      batchId,
    })
    aceptadas += res.accepted
    fallidas += res.failed

    // La conexión se ha caído o nos han revocado el permiso: el resto del lote
    // son errores idénticos. Se para y se dice.
    if (res.abortReason) {
      return {
        connectionId: plan.connectionId,
        candidatas: candidatas.length,
        enviadas: aceptadas + fallidas,
        aceptadas,
        fallidas,
        frenadas,
        plantado: res.abortReason,
        batchId,
      }
    }
  }

  return {
    connectionId: plan.connectionId,
    candidatas: candidatas.length,
    enviadas: aceptadas + fallidas,
    aceptadas,
    fallidas,
    frenadas,
    plantado: null,
    batchId,
  }
}

/** Una línea para el registro del cron y para la campana */
export function resumirAutomatico(r: ResultadoAutomatico): string {
  if (r.plantado) return `No se ha publicado nada: ${r.plantado}`
  if (r.candidatas === 0) return 'Los tres países ya estaban al día. Nada que mandar.'
  const partes = [`${r.aceptadas} precios publicados`]
  if (r.fallidas > 0) partes.push(`${r.fallidas} rechazados por Amazon`)
  if (r.frenadas.length > 0) {
    partes.push(
      `${r.frenadas.length} apartados por saltar más del ${Math.round(SALTO_MAXIMO * 100)} %`
    )
  }
  return partes.join(' · ')
}

/** Deja constancia en el registro de eventos del ERP, para que suene la campana */
export async function anotarEvento(r: ResultadoAutomatico): Promise<void> {
  // Solo se anota lo que hay que mirar: una pasada limpia no tiene que hacer
  // ruido, o la campana deja de significar nada en una semana.
  if (!r.plantado && r.fallidas === 0 && r.frenadas.length === 0) return

  const severidad = r.plantado ? 'error' : 'aviso'
  const detalle = r.frenadas
    .slice(0, 6)
    .map(
      (f) =>
        `${f.sku} (${f.pais}): ${f.actual?.toFixed(2) ?? '—'} € → ${f.destino.toFixed(2)} €, ` +
        `${Math.round(f.salto * 100)} %`
    )
    .join(' · ')

  // `registrarEvento` NUNCA lanza: que no se pueda anotar no puede tumbar una
  // pasada que YA ha publicado precios en la tienda del cliente.
  await registrarEvento({
    tipo: 'precios_shoplamp',
    severidad,
    connectionId: r.connectionId,
    mensaje: `Precios Shoplamp (automático): ${resumirAutomatico(r)}${detalle ? `. ${detalle}` : ''}`,
    detalle: { frenadas: r.frenadas, batchId: r.batchId, candidatas: r.candidatas },
  })
}

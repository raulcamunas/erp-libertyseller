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
 * No es que publique: es QUÉ SE NIEGA A PUBLICAR. Pero OJO con qué se frena,
 * porque aquí hubo un freno de más y se quitó:
 *
 *   NO SE LIMITA CUÁNTO PUEDE SUBIR O BAJAR UNA REFERENCIA, Y ES A PROPÓSITO.
 *
 * El primer intento apartaba toda fila que se moviera más de un 25 % de su
 * precio de hoy, razonando que «la deriva de un repricer es de céntimos». Está
 * mal planteado: el precio de fuera NO lo pone un repricer, lo pone esta regla,
 * y la regla es una orden de Shoplamp. Una referencia que vale 17,12 € en
 * Alemania y tiene que pasar a 25,90 € no es una anomalía que haya que revisar:
 * es exactamente lo que el cliente ha pedido que pase. Con aquel freno se
 * apartaban 15 de 154 y todas eran correctas.
 *
 * Queda UN SOLO freno, y no mira el precio sino el VOLUMEN:
 *
 *   EL TAMAÑO DEL LOTE. Si de golpe cambian más de `MAX_AUTOMATICO`, no se manda
 *   NADA y se levanta un aviso. Lo normal son unas veinticinco en once horas, y
 *   la puesta al día más grande medida fueron 154. Un número muy por encima no
 *   es un día movido: es que algo se ha roto aguas arriba —una resincronización,
 *   un censo que ha traído precios malos, el repricer de España disparado— y
 *   publicar mil doscientos cambios por si acaso es exactamente el accidente que
 *   esto tiene que evitar. No limita CUÁNTO cambia cada precio; limita que se
 *   mueva medio catálogo de golpe sin que nadie lo haya mirado.
 *
 * Y las que no tienen ficha fuera no se tocan: lo garantiza el plan —una fila
 * 'sin_listado' no lleva precio calculado— y aquí se filtra otra vez por
 * `estado === 'cambia'`, que es la única clase enviable.
 *
 * Cuando el freno salta NO se calla: deja un evento que suena en la campana del
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

/**
 * Más de esto en un solo lote y no se manda nada: algo ha pasado aguas arriba.
 *
 * 400 sobre un plan de unas 1.255 referencias que pueden cambiar, o sea un
 * tercio del catálogo. La deriva normal son veinticinco cada once horas y la
 * puesta al día más grande medida fueron 154: nada legítimo mueve un tercio del
 * catálogo en seis horas.
 */
export const MAX_AUTOMATICO = 400

export interface ResultadoAutomatico {
  /** null si Shoplamp no tiene conexión activa: no es un error, es un estado */
  connectionId: string | null
  /** Cuántas cambiaban según el plan */
  candidatas: number
  /** Las que se han mandado */
  enviadas: number
  aceptadas: number
  fallidas: number
  /** Si se ha plantado entero, por qué */
  plantado: string | null
  batchId: string | null
}

export async function pasadaAutomatica(userId: string | null): Promise<ResultadoAutomatico> {
  const vacio: ResultadoAutomatico = {
    connectionId: null,
    candidatas: 0,
    enviadas: 0,
    aceptadas: 0,
    fallidas: 0,
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

  // Cuánto suba o baje cada referencia NO se mira: es la regla del cliente. Ver
  // la cabecera.
  const enviables = candidatas

  // ---- El único freno: el tamaño del lote ----
  if (enviables.length > MAX_AUTOMATICO) {
    return {
      ...vacio,
      connectionId: plan.connectionId,
      candidatas: candidatas.length,
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
  return partes.join(' · ')
}

/** Deja constancia en el registro de eventos del ERP, para que suene la campana */
export async function anotarEvento(r: ResultadoAutomatico): Promise<void> {
  // Solo se anota lo que hay que mirar: una pasada limpia no tiene que hacer
  // ruido, o la campana deja de significar nada en una semana.
  if (!r.plantado && r.fallidas === 0) return

  const severidad = r.plantado ? 'error' : 'aviso'

  // `registrarEvento` NUNCA lanza: que no se pueda anotar no puede tumbar una
  // pasada que YA ha publicado precios en la tienda del cliente.
  await registrarEvento({
    tipo: 'precios_shoplamp',
    severidad,
    connectionId: r.connectionId,
    mensaje: `Precios Shoplamp (automático): ${resumirAutomatico(r)}`,
    detalle: { batchId: r.batchId, candidatas: r.candidatas },
  })
}

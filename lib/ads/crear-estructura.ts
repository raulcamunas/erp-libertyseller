/**
 * AMAZON ADS · CREAR LA ESTRUCTURA DE CAMPAÑAS DE UN PRODUCTO.
 * SOLO SERVIDOR. ESCRIBE EN LA CUENTA DE UN CLIENTE.
 *
 * Dos pasos, y el segundo solo se da si la persona ha visto el primero:
 *
 *   1. `previsualizar`  lee las campañas que ya hay en la cuenta (en vivo) y devuelve el plan con lo que se crearía y lo que ya existe. No escribe nada.
 *   2. `crear`          crea lo que falta, campaña por campaña: la campaña PAUSADA, su grupo de anuncios, el anuncio del producto y, en la automática, sus grupos de segmentación.
 *
 *
 * ============ CADA PASO DEJA RASTRO, TAMBIÉN EL QUE FALLA ============
 *
 * Cada cosa creada se apunta en el log (`ads_cambios_log`) con el origen «estructura». Si algo falla a mitad, el error también se apunta y la campaña que se acababa de crear se ARCHIVA para no
 * dejar en la cuenta del cliente una campaña a medias (sin grupo o sin anuncio). Solo se archiva lo creado en esta misma pasada.
 *
 * Las campañas que ya existen (mismo nombre) se saltan: pulsar dos veces el botón, o reintentar tras un fallo, no duplica nada.
 */

import { campanasDe } from './campanas'
import { archivarCampana, configurarAutomatica, crearAnuncio, crearCampana, crearGrupo } from './escritura'
import { anotarCambio, guardarEstructura, type CuentaDeAnunciante, type ProductoDeAds } from './cuenta'
import { planDeEstructura, yaExistentes, type CampanaPlan, type OpcionesDePlan, type Rol } from './estructura'
import { AdsError } from './oauth'

export interface VistaPrevia {
  campanas: Array<CampanaPlan & { yaExiste: boolean }>
  /** true si la lista de campañas de Amazon vino cortada: podría haber alguna que no se ha visto */
  listaTruncada: boolean
}

/** El plan y qué parte de él ya está en la cuenta. Lee de Amazon, no escribe */
export async function previsualizar(cuenta: CuentaDeAnunciante, producto: ProductoDeAds, opciones: OpcionesDePlan): Promise<{ ok: true; vista: VistaPrevia } | { ok: false; error: string }> {
  const plan = planDeEstructura({ asin: producto.asin, sku: producto.sku, resumen: producto.resumen }, opciones)
  if (!plan.ok) return plan
  const { campanas, truncado } = await campanasDe(cuenta.conexionId, cuenta.profileId)
  // Las archivadas no cuentan: el nombre de una campaña archivada se puede volver a usar
  const nombres = campanas.filter((c) => c.estado !== 'ARCHIVED').map((c) => c.nombre)
  const existentes = yaExistentes(plan.campanas, nombres)
  return { ok: true, vista: { campanas: plan.campanas.map((c) => ({ ...c, yaExiste: existentes.has(c.rol) })), listaTruncada: truncado } }
}

export interface ResultadoDeCampana {
  rol: Rol
  nombre: string
  estado: 'creada' | 'ya-existia' | 'error'
  campaignId?: string
  adGroupId?: string
  error?: string
}

const euros = (n: number) => `${n.toFixed(2).replace('.', ',')}`

/**
 * Crea las campañas del plan que todavía no existen. Re-lee la cuenta justo antes (no se fía de la vista previa, que pudo quedarse vieja) y, por cada campaña, hace los cuatro pasos o la deja
 * como estaba. Devuelve qué pasó con cada una.
 */
export async function crear(cuenta: CuentaDeAnunciante & { id: string }, producto: ProductoDeAds, opciones: OpcionesDePlan, userId: string): Promise<{ ok: true; resultados: ResultadoDeCampana[] } | { ok: false; error: string }> {
  const previa = await previsualizar(cuenta, producto, opciones)
  if (!previa.ok) return previa
  if (previa.vista.listaTruncada) return { ok: false, error: 'La cuenta tiene tantas campañas que no se han podido ver todas, y podría duplicarse alguna. No se ha creado nada: avisa para revisarlo.' }

  const resultados: ResultadoDeCampana[] = []
  for (const c of previa.vista.campanas) {
    if (c.yaExiste) {
      resultados.push({ rol: c.rol, nombre: c.nombre, estado: 'ya-existia' })
      continue
    }

    let campaignId: string | undefined
    let adGroupId: string | undefined
    const comun = { perfilId: cuenta.id, productoId: producto.id, nombreCampana: c.nombre, origen: 'estructura' as const, userId }
    try {
      campaignId = await crearCampana(cuenta.conexionId, cuenta.profileId, c)
      await anotarCambio({ ...comun, campaignId, entidad: 'campaña', accion: 'crear', campo: 'estado · presupuesto diario', valorNuevo: `PAUSADA · ${euros(c.presupuestoDiario)} al día`, motivo: `Estructura de arranque de ${producto.resumen} (${c.rol}, ${c.repartoPct} % del presupuesto)` })

      adGroupId = await crearGrupo(cuenta.conexionId, cuenta.profileId, campaignId, c.grupo, c.pujaBase)
      await anotarCambio({ ...comun, campaignId, entidad: 'grupo', accion: 'crear', campo: 'puja por defecto', valorNuevo: `${c.grupo} · ${euros(c.pujaBase)}` })

      await crearAnuncio(cuenta.conexionId, cuenta.profileId, campaignId, adGroupId, { asin: producto.asin, sku: producto.sku }, cuenta.tipo)
      await anotarCambio({ ...comun, campaignId, entidad: 'anuncio', accion: 'crear', campo: cuenta.tipo === 'vendor' ? 'ASIN' : 'SKU', valorNuevo: cuenta.tipo === 'vendor' ? producto.asin : producto.sku })

      if (c.targetsAuto) {
        await configurarAutomatica(cuenta.conexionId, cuenta.profileId, campaignId, adGroupId, c.targetsAuto, c.pujaBase)
        await anotarCambio({
          ...comun,
          campaignId,
          entidad: 'target',
          accion: 'cambiar',
          campo: 'grupos de segmentación',
          valorNuevo: c.targetsAuto.map((t) => `${t.nombre}: ${t.activo ? `activo a ${euros(Math.max(0.02, c.pujaBase * t.factorDePuja))}` : 'apagado'}`).join(' · '),
        })
      }

      await guardarEstructura({ perfilId: cuenta.id, productoId: producto.id, rol: c.rol, campaignId, adGroupId, nombre: c.nombre, presupuestoDiario: c.presupuestoDiario, pujaBase: c.pujaBase, userId })
      resultados.push({ rol: c.rol, nombre: c.nombre, estado: 'creada', campaignId, adGroupId })
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e)
      await anotarCambio({ ...comun, campaignId, entidad: 'campaña', accion: 'crear', ok: false, error: mensaje, motivo: 'La creación se ha cortado' })
      let detalle = mensaje
      if (campaignId) {
        try {
          await archivarCampana(cuenta.conexionId, cuenta.profileId, campaignId)
          await anotarCambio({ ...comun, campaignId, entidad: 'campaña', accion: 'archivar', motivo: 'Se archiva la campaña que se acababa de crear porque quedó a medias' })
          detalle += ' (la campaña que se había creado a medias se ha archivado)'
        } catch (e2) {
          detalle += ` (OJO: la campaña quedó a medias y no se ha podido archivar: ${e2 instanceof Error ? e2.message : String(e2)})`
        }
      }
      resultados.push({ rol: c.rol, nombre: c.nombre, estado: 'error', error: detalle })
      // Sin autorización no tiene sentido seguir: el resto fallará igual
      if (e instanceof AdsError && e.esDeAutorizacion) break
    }
  }
  return { ok: true, resultados }
}

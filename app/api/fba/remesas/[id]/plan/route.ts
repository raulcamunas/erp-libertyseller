import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { cajasDeRemesa } from '@/lib/fba/cajas'
import { diaEnEspana } from '@/lib/fba/fechas'
import {
  cajasDelEnvio,
  cancelarPlan,
  confirmarEmpaquetado,
  confirmarReparto,
  confirmarTransporte,
  crearPlan,
  generarOpcionesEmpaquetado,
  generarOpcionesReparto,
  generarOpcionesTransporte,
  listarOpcionesEmpaquetado,
  listarOpcionesReparto,
  listarOpcionesTransporte,
  mandarCajas,
  mandarSeguimientos,
  verEnvio,
  type Direccion,
} from '@/lib/fba/plan'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CREAR EL ENVÍO EN AMAZON, PASO A PASO.
 * ======================================
 *
 * SOLO ADMIN, y no por costumbre: cada acción de aquí crea o confirma cosas en
 * la cuenta de Amazon del cliente, y una de ellas es irreversible.
 *
 *
 * ============ UN PASO POR LLAMADA, NO TODO DE GOLPE ============
 *
 * Se podría encadenar entero en una petición. No se hace por dos motivos:
 *
 *   1. AMAZON COBRA. Las opciones de agrupado y de reparto vienen con tarifas,
 *      y a veces con descuentos por elegir una u otra. Confirmar una por
 *      nosotros sin enseñarla sería gastar el dinero del cliente a ciegas.
 *   2. Cada paso asíncrono tarda. Nueve seguidos se pasan del tiempo de una
 *      petición web, y al cortarse nadie sabría en cuál se quedó.
 *
 * Así que cada llamada avanza UNO, guarda dónde ha llegado, y devuelve lo que
 * hay que decidir a continuación.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Accion =
  | 'crear'
  | 'opciones-empaquetado'
  | 'confirmar-empaquetado'
  | 'mandar-cajas'
  | 'opciones-reparto'
  | 'confirmar-reparto'
  | 'opciones-transporte'
  | 'confirmar-transporte'
  | 'mandar-seguimientos'
  | 'cancelar'
  | 'refrescar'

interface Contexto {
  remesa: {
    id: string
    client_id: string
    connection_id: string | null
    marketplace_id: string
    nombre: string | null
    estado: string
    paso_plan: string | null
    inbound_plan_id: string | null
    packing_option_id: string | null
    placement_option_id: string | null
  }
  creds: Awaited<ReturnType<typeof connectionCredentials>>
}

async function contexto(id: string): Promise<Contexto | NextResponse> {
  const service = createServiceClient()
  const { data } = await service
    .from('fba_remesas')
    .select('id, client_id, connection_id, marketplace_id, nombre, estado, paso_plan, inbound_plan_id, packing_option_id, placement_option_id')
    .eq('id', id)
    .maybeSingle()
  if (!data) return fail(404, 'Esa remesa ya no existe')

  const remesa = data as Contexto['remesa']
  if (!remesa.connection_id) {
    return fail(400, 'Este cliente no tiene la API de Amazon conectada, así que no se le puede crear el envío')
  }

  const creds = await connectionCredentials(remesa.connection_id)
  if (!creds) return fail(400, 'La conexión de Amazon de este cliente ya no existe')

  return { remesa, creds }
}

async function guardar(id: string, cambios: Record<string, unknown>) {
  const service = createServiceClient()
  await service
    .from('fba_remesas')
    .update({ ...cambios, plan_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const service = createServiceClient()
  try {
    // Todo esto es de la agencia. El cliente aprueba y encaja; crear el envío,
    // elegir transportista y gastar su dinero en tarifas, no.
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const accion = body.accion as Accion

    const ctx = await contexto(params.id)
    if (ctx instanceof NextResponse) return ctx
    const { remesa, creds } = ctx
    const credenciales = creds!.credentials
    const planId = remesa.inbound_plan_id

    /* ---------------- 1 · Crear el plan ---------------- */
    if (accion === 'crear') {
      if (planId) return fail(409, 'Esta remesa ya tiene un plan en Amazon')
      if (remesa.estado !== 'lista') {
        return fail(409, 'El envío se crea cuando la remesa está lista, con sus cajas cerradas')
      }

      const datos = await cajasDeRemesa(params.id)
      if (!datos.cuadre.cuadra) {
        return fail(409, 'Las cajas no cuadran con lo declarado. Corrígelas antes de crear el envío')
      }
      if (datos.estado.cajas === 0 || datos.estado.sinMedidas > 0) {
        return fail(409, 'Faltan medidas o pesos en alguna caja')
      }

      const { data: dir } = await service
        .from('fba_direcciones')
        .select('*')
        .eq('client_id', remesa.client_id)
        .maybeSingle()
      if (!dir) {
        return fail(
          400,
          'Falta la dirección desde la que envía este cliente. Amazon la exige para crear el plan.'
        )
      }
      const d = dir as Record<string, string>
      const origen: Direccion = {
        nombre: d.nombre,
        empresa: d.empresa,
        linea1: d.linea1,
        linea2: d.linea2,
        ciudad: d.ciudad,
        provincia: d.provincia,
        codigoPostal: d.codigo_postal,
        pais: d.pais,
        telefono: d.telefono,
        email: d.email,
      }

      const { data: lineas } = await service
        .from('fba_remesa_lineas')
        .select('sku, unidades')
        .eq('remesa_id', params.id)

      const { inboundPlanId, avisos } = await crearPlan(credenciales, {
        nombre: remesa.nombre ?? `Remesa ${params.id.slice(0, 8)}`,
        marketplaceId: remesa.marketplace_id,
        origen,
        articulos: ((lineas ?? []) as Array<{ sku: string; unidades: number }>).map((l) => ({
          msku: l.sku,
          unidades: l.unidades,
        })),
      })

      await guardar(params.id, {
        inbound_plan_id: inboundPlanId,
        paso_plan: 'creado',
        plan_error: null,
      })
      return NextResponse.json({ ok: true, paso: 'creado', inboundPlanId, avisos })
    }

    if (!planId) return fail(409, 'Esta remesa todavía no tiene plan en Amazon')

    /* ---------------- 2 · Cómo agrupa Amazon ---------------- */
    if (accion === 'opciones-empaquetado') {
      await generarOpcionesEmpaquetado(credenciales, planId)
      const opciones = await listarOpcionesEmpaquetado(credenciales, planId)
      return NextResponse.json({ ok: true, opciones })
    }

    if (accion === 'confirmar-empaquetado') {
      const opcion = typeof body.opcion === 'string' ? body.opcion : ''
      if (!opcion) return fail(400, 'Elige una opción de agrupado')
      await confirmarEmpaquetado(credenciales, planId, opcion)
      await guardar(params.id, { packing_option_id: opcion, paso_plan: 'empaquetado', plan_error: null })
      return NextResponse.json({ ok: true, paso: 'empaquetado' })
    }

    /* ---------------- 3 · Nuestras cajas ---------------- */
    if (accion === 'mandar-cajas') {
      const grupo = typeof body.grupo === 'string' ? body.grupo : ''
      if (!grupo) return fail(400, 'Falta el grupo de empaquetado al que van las cajas')

      const datos = await cajasDeRemesa(params.id)
      if (!datos.cuadre.cuadra) return fail(409, 'Las cajas no cuadran con lo declarado')

      const incompletas = datos.cajas.filter((c) => !c.completa)
      if (incompletas.length > 0) {
        return fail(409, `Faltan medidas o peso en ${incompletas.length} caja(s)`)
      }

      await mandarCajas(credenciales, planId, [
        {
          packingGroupId: grupo,
          cajas: datos.cajas.map((c) => ({
            largoCm: c.largoCm!,
            anchoCm: c.anchoCm!,
            altoCm: c.altoCm!,
            pesoKg: c.pesoKg!,
            contenido: c.contenido.map((x) => ({ msku: x.sku, unidades: x.unidades })),
          })),
        },
      ])
      await guardar(params.id, { paso_plan: 'cajas', plan_error: null })
      return NextResponse.json({ ok: true, paso: 'cajas', cajas: datos.cajas.length })
    }

    /* ---------------- 4 · Dónde lo quiere Amazon ---------------- */
    if (accion === 'opciones-reparto') {
      // Se vuelven a generar SIEMPRE. Amazon lo exige si las cajas han cambiado
      // desde la última vez, y no avisa: las opciones viejas siguen ahí y se
      // pueden confirmar, dejando un envío con unas cajas que no son las que hay.
      await generarOpcionesReparto(credenciales, planId)
      const opciones = await listarOpcionesReparto(credenciales, planId)
      return NextResponse.json({ ok: true, opciones })
    }

    if (accion === 'confirmar-reparto') {
      const opcion = typeof body.opcion === 'string' ? body.opcion : ''
      if (!opcion) return fail(400, 'Elige una opción de reparto')

      await confirmarReparto(credenciales, planId, opcion)

      // Los envíos ya tienen identificador de verdad: se guardan.
      const opciones = await listarOpcionesReparto(credenciales, planId)
      const elegida = opciones.find((o) => o.placementOptionId === opcion)
      const envios = elegida?.envios ?? []

      for (const shipmentId of envios) {
        const info = await verEnvio(credenciales, planId, shipmentId)
        await service.from('fba_envios').upsert(
          {
            remesa_id: params.id,
            shipment_id: shipmentId,
            confirmation_id: info.confirmacion,
            nombre: info.nombre,
            destino: info.destino,
            estado: info.estado,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'remesa_id,shipment_id' }
        )
      }

      // El primero manda como referencia de la remesa, que es lo que ya usa el
      // seguimiento diario para saber por dónde va.
      const primero = envios[0] ? await verEnvio(credenciales, planId, envios[0]) : null

      await guardar(params.id, {
        placement_option_id: opcion,
        paso_plan: 'confirmado',
        estado: 'en_amazon',
        plan_error: null,
        ...(primero?.confirmacion ? { referencia_envio: primero.confirmacion } : {}),
      })

      return NextResponse.json({ ok: true, paso: 'confirmado', envios: envios.length })
    }

    /* ---------------- 5 · Quién lo lleva ---------------- */
    if (accion === 'opciones-transporte') {
      if (!remesa.placement_option_id) return fail(409, 'Antes hay que confirmar el reparto')

      const { data: envios } = await service
        .from('fba_envios')
        .select('shipment_id')
        .eq('remesa_id', params.id)
      const lista = ((envios ?? []) as Array<{ shipment_id: string }>).map((e) => e.shipment_id)
      if (lista.length === 0) return fail(409, 'Este plan no tiene envíos')

      const saleEl = typeof body.saleEl === 'string' ? body.saleEl : diaEnEspana()
      const contacto =
        typeof body.contacto === 'object' && body.contacto
          ? (body.contacto as { nombre: string; telefono: string; email?: string })
          : undefined

      await generarOpcionesTransporte(credenciales, planId, {
        placementOptionId: remesa.placement_option_id,
        envios: lista.map((shipmentId) => ({ shipmentId, saleEl, contacto })),
      })
      const opciones = await listarOpcionesTransporte(
        credenciales,
        planId,
        remesa.placement_option_id
      )
      return NextResponse.json({ ok: true, opciones })
    }

    if (accion === 'confirmar-transporte') {
      const selecciones = Array.isArray(body.selecciones)
        ? (body.selecciones as Array<{ shipmentId?: unknown; transportationOptionId?: unknown }>)
        : []
      const limpias = selecciones
        .filter((s) => typeof s.shipmentId === 'string' && typeof s.transportationOptionId === 'string')
        .map((s) => ({
          shipmentId: s.shipmentId as string,
          transportationOptionId: s.transportationOptionId as string,
        }))
      if (limpias.length === 0) return fail(400, 'Elige un transportista para cada envío')

      const contacto =
        typeof body.contacto === 'object' && body.contacto
          ? (body.contacto as { nombre: string; telefono: string; email?: string })
          : undefined

      await confirmarTransporte(
        credenciales,
        planId,
        limpias.map((s) => ({ ...s, contacto }))
      )

      const opciones = await listarOpcionesTransporte(credenciales, planId)
      for (const s of limpias) {
        const o = opciones.find((x) => x.transportationOptionId === s.transportationOptionId)
        await service
          .from('fba_envios')
          .update({
            transportation_option_id: s.transportationOptionId,
            transportista: o?.transportista ?? null,
            es_de_amazon: o?.deAmazon ?? null,
            coste: o?.coste ?? null,
            moneda: o?.moneda ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('remesa_id', params.id)
          .eq('shipment_id', s.shipmentId)
      }

      await guardar(params.id, { paso_plan: 'transporte', plan_error: null })
      return NextResponse.json({ ok: true, paso: 'transporte' })
    }

    /* ---------------- 6 · Los seguimientos ---------------- */
    if (accion === 'mandar-seguimientos') {
      const shipmentId = typeof body.envio === 'string' ? body.envio : ''
      if (!shipmentId) return fail(400, 'Falta de qué envío son los seguimientos')

      const { data: envio } = await service
        .from('fba_envios')
        .select('id, es_de_amazon')
        .eq('remesa_id', params.id)
        .eq('shipment_id', shipmentId)
        .maybeSingle()
      if (!envio) return fail(404, 'Ese envío no es de esta remesa')
      if ((envio as { es_de_amazon: boolean | null }).es_de_amazon) {
        return fail(
          409,
          'Este envío va con el transportista asociado de Amazon: los seguimientos los pone él y ' +
            'mandar los nuestros los pisaría'
        )
      }

      if (body.tipo === 'camion') {
        const pro = Array.isArray(body.numerosPro)
          ? (body.numerosPro as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : []
        if (pro.length === 0) return fail(400, 'Falta el número PRO del transportista')
        await mandarSeguimientos(credenciales, planId, shipmentId, {
          tipo: 'camion',
          numerosPro: pro,
          albaran: typeof body.albaran === 'string' ? body.albaran : null,
        })
      } else {
        // Paquetería: un seguimiento por caja, con el boxId que dio Amazon.
        const deAmazon = await cajasDelEnvio(credenciales, planId, shipmentId)
        const porCaja = Array.isArray(body.porCaja)
          ? (body.porCaja as Array<{ boxId?: unknown; seguimiento?: unknown }>)
              .filter((c) => typeof c.boxId === 'string' && typeof c.seguimiento === 'string' && c.seguimiento.trim() !== '')
              .map((c) => ({ boxId: c.boxId as string, seguimiento: (c.seguimiento as string).trim() }))
          : []
        if (porCaja.length === 0) return fail(400, 'Falta el seguimiento de al menos una caja')

        const conocidas = new Set(deAmazon.map((c) => c.boxId).filter(Boolean))
        const ajenas = porCaja.filter((c) => !conocidas.has(c.boxId))
        if (ajenas.length > 0) {
          return fail(400, 'Alguna caja no es de este envío según Amazon')
        }

        await mandarSeguimientos(credenciales, planId, shipmentId, { tipo: 'paquete', porCaja })
      }

      await guardar(params.id, { paso_plan: 'seguimientos', plan_error: null })
      return NextResponse.json({ ok: true, paso: 'seguimientos' })
    }

    /* ---------------- Consultar y deshacer ---------------- */
    if (accion === 'refrescar') {
      const { data: envios } = await service
        .from('fba_envios')
        .select('shipment_id')
        .eq('remesa_id', params.id)
      const actualizados: Array<Record<string, unknown>> = []
      for (const e of (envios ?? []) as Array<{ shipment_id: string }>) {
        const info = await verEnvio(credenciales, planId, e.shipment_id)
        await service
          .from('fba_envios')
          .update({
            confirmation_id: info.confirmacion,
            estado: info.estado,
            destino: info.destino,
            updated_at: new Date().toISOString(),
          })
          .eq('remesa_id', params.id)
          .eq('shipment_id', e.shipment_id)
        actualizados.push({ ...info })
      }
      return NextResponse.json({ ok: true, envios: actualizados })
    }

    if (accion === 'cancelar') {
      // Antes de confirmar el reparto esto no deja rastro. Después cancela un
      // envío de verdad, y por eso la pantalla lo avisa de otra manera.
      await cancelarPlan(credenciales, planId)
      await service.from('fba_envios').delete().eq('remesa_id', params.id)
      await guardar(params.id, {
        inbound_plan_id: null,
        paso_plan: null,
        packing_option_id: null,
        placement_option_id: null,
        plan_error: null,
        estado: 'lista',
      })
      return NextResponse.json({ ok: true, cancelado: true })
    }

    return fail(400, 'Esa acción no existe')
  } catch (error) {
    // Lo que dijo Amazon se guarda en la remesa: así la pantalla lo puede
    // enseñar en el sitio, sin que nadie tenga que mirar los registros.
    const mensaje = error instanceof Error ? error.message.slice(0, 500) : 'Error desconocido'
    if (UUID.test(params.id)) {
      await service
        .from('fba_remesas')
        .update({ plan_error: mensaje, plan_at: new Date().toISOString() })
        .eq('id', params.id)
    }
    return errorResponse(error, 'No se ha podido avanzar el envío en Amazon')
  }
}

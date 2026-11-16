import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import type { AccionEnvio } from '@/lib/fba/envio-amazon'
import { SIN_CACHE, respuestaDeFallo, soloAdminConRemesa } from '@/lib/fba/envio-amazon-http'
import { avanzar, cambiarModo, ejecutarAccion, estadoDelEnvio, type ParametrosDeAccion } from '@/lib/fba/envio-amazon-motor'

/**
 * ENVIAR A AMAZON DESDE EL ERP (solo administradores).
 *
 *   GET  → el estado del envío. Si hay una operación de Amazon en curso, pregunta por ella UNA vez y, si ha
 *          acabado, da el paso siguiente (lib/fba/envio-amazon-motor.ts). La pantalla lo llama cada pocos
 *          segundos SOLO mientras hay algo en curso. Nunca espera dentro de la petición.
 *   POST → { modo: 'api' | 'manual' } o { accion, ...parámetros }. Cada acción lanza su operación y vuelve.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACCIONES: AccionEnvio[] = ['iniciar', 'elegir_embalaje', 'reenviar_cajas', 'reabrir_cajas', 'confirmar_reparto', 'generar_transporte', 'elegir_transporte', 'confirmar_transporte', 'guardar_seguimiento', 'reintentar', 'cancelar']

/** Las que no tienen vuelta atrás piden escribir la palabra también aquí, no solo en la pantalla */
const PALABRA: Partial<Record<AccionEnvio, string>> = { confirmar_reparto: 'REPARTO', confirmar_transporte: 'TRANSPORTE' }

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const p = await soloAdminConRemesa(params.id)
    if (p instanceof NextResponse) return p
    try {
      await avanzar(params.id, p.sesion.userId)
    } catch (e) {
      // Un fallo al preguntar no tumba la pantalla: se enseña lo que hay y se vuelve a preguntar
      console.error('[envío] avanzar:', e instanceof Error ? e.message : e)
    }
    const estado = await estadoDelEnvio(params.id)
    if (!estado) return fail(404, 'Esa remesa ya no existe')
    return NextResponse.json(estado, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo(error, 'No se ha podido leer el envío a Amazon')
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const p = await soloAdminConRemesa(params.id)
    if (p instanceof NextResponse) return p
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    if (body.modo === 'api' || body.modo === 'manual') {
      await cambiarModo(params.id, body.modo, p.sesion.userId)
    } else {
      const accion = body.accion as AccionEnvio
      if (!ACCIONES.includes(accion)) return fail(400, 'Esa acción no existe')
      const palabra = PALABRA[accion] ?? (accion === 'cancelar' && body.grave ? 'CANCELAR' : null)
      if (palabra && String(body.palabra ?? '').trim().toUpperCase() !== palabra) return fail(400, `Para confirmar hay que escribir «${palabra}»`)
      const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
      const contacto = body.contacto && typeof body.contacto === 'object' ? (body.contacto as Record<string, unknown>) : null
      const nume = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : undefined)
      const pal = body.palets && typeof body.palets === 'object' ? (body.palets as Record<string, unknown>) : null
      const parametros: ParametrosDeAccion = {
        palets: pal ? { cantidad: nume(pal.cantidad), largoCm: nume(pal.largoCm), anchoCm: nume(pal.anchoCm), altoCm: nume(pal.altoCm), pesoKg: nume(pal.pesoKg), apilable: pal.apilable === true } : undefined,
        bol: texto(body.bol, 60),
        fletes: Array.isArray(body.fletes) ? body.fletes.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 40)).slice(0, 10) : undefined,
        packingOptionId: texto(body.packingOptionId),
        placementOptionId: texto(body.placementOptionId),
        transportationOptionId: texto(body.transportationOptionId),
        dia: texto(body.dia, 10),
        palabra: texto(body.palabra, 20),
        contacto: contacto ? { nombre: texto(contacto.nombre, 80), telefono: texto(contacto.telefono, 30), email: texto(contacto.email, 120) } : undefined,
      }
      await ejecutarAccion(params.id, accion, parametros, p.sesion.userId)
    }
    const estado = await estadoDelEnvio(params.id)
    return NextResponse.json(estado, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo(error, 'No se ha podido dar el paso en Amazon')
  }
}

import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { agenciaQueEdita, esAgencia, requireFbaAccess } from '@/lib/fba/acceso'
import { cantidadesPorSku, filaSkuFusionada, validarCambiosSku, type FilaReposicionSku } from '@/lib/fba/ajustes-api'
import { FALTA_LA_MIGRACION_316, leerCajasDelEncaje, leerFilaReposicion, leerFilasSku, leerRemesasEnviadas } from '@/lib/fba/ajustes-datos'
import { ajustesDesdeFila } from '@/lib/fba/ajustes-reposicion'
import { cajaDeducida } from '@/lib/fba/medidas-cliente'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { cajaDeLaReferencia } from '@/lib/fba/planificador'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CAJA, COBERTURA Y EXCLUSIÓN DE CADA REFERENCIA (spec remesas-pro §7, §9 y §11 D13; paquete S6). Tabla `fba_reposicion_sku` (316).
 *
 *   GET  ?cliente=…[&sku=A,B]   { referencias: ReferenciaAjustes[], multiploCliente, migracion316, aviso }
 *        Una fila por referencia guardada o enviada en las últimas remesas del cliente, con:
 *        · lo guardado: `unidadesCaja`, `coberturaDias`, `excluir`, `motivo`;
 *        · `cajaDeducida` (D13): la del encaje si sus cajas de una sola referencia repiten cantidad, si no el divisor común ≥ 6 de
 *          lo que se mandó en sus últimas 6 remesas (90, 180, 270 → 90), con `cantidadesEnviadas` para enseñarlo;
 *        · `caja`: la que usa el plan (suya > deducida > del cliente > ninguna, `cajaDeLaReferencia`);
 *        · `puedeGuardarDeducida`: hay deducida y no es la que ya está guardada («caja deducida: 18 · [Guardar]»).
 *        Sin la 316 contesta igual (sin nada guardado), `migracion316: false` y el aviso «Falta lanzar la migración 316…».
 *
 *   PUT  { cliente | clienteId, sku, unidadesCaja?, coberturaDias?, excluir?, motivo?, guardarCajaDeducida? }
 *        o { cliente, filas: [{ sku, … }] } (hasta 400). PARCIAL por referencia: lo que no llega no se toca; null quita.
 *        `guardarCajaDeducida: true` guarda como suya la caja que deduce el servidor (si no hay, 400). Dejar de excluir sin motivo
 *        borra el motivo. Si a una referencia no le queda nada propio, se borra su fila. Contesta las referencias tocadas como el GET.
 *        Sin la 316, 409 «Falta lanzar la migración 316».
 *
 * Permisos: la agencia; guardar, con permiso de editar el cliente (`agenciaQueEdita`, spec §1.4, anotado: antes la exclusión y la
 * caja no existían y lo de reposición era del admin). El cliente de fuera, 403 (D26).
 */
export const dynamic = 'force-dynamic'

const NO_CLIENTE = 'Los ajustes de reposición los pone la agencia'

const clienteDe = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

type Servicio = ReturnType<typeof createServiceClient>

interface ReferenciaAjustes {
  sku: string
  unidadesCaja: number | null
  coberturaDias: number | null
  excluir: boolean
  motivo: string | null
  actualizadoAt: string | null
  guardada: boolean
  cajaDeducida: number | null
  cajaEncaje: number | null
  cantidadesEnviadas: number[]
  caja: { unidades: number; origen: 'sku' | 'deducida' | 'cliente' } | null
  puedeGuardarDeducida: boolean
}

/** Lo que hace falta para deducir la caja de cada referencia: cantidades de sus últimas remesas y cajas del encaje */
async function datosDeCaja(service: Servicio, clienteId: string) {
  const remesas = await leerRemesasEnviadas(service, clienteId)
  const encaje = await leerCajasDelEncaje(service, remesas.map((r) => r.id))
  const cantidades = cantidadesPorSku(remesas)
  const deducida = (sku: string): number | null => cajaDeducida(cantidades.get(sku) ?? [], encaje.get(sku) ?? null)
  return { cantidades, encaje, deducida }
}

async function referencias(service: Servicio, clienteId: string, soloSkus: string[] | null) {
  const [caja, guardadas, repo] = await Promise.all([
    datosDeCaja(service, clienteId),
    leerFilasSku(service, clienteId, soloSkus ?? undefined),
    leerFilaReposicion(service, clienteId),
  ])
  const multiploCliente = ajustesDesdeFila(repo.fila, null).multiploCaja
  const porSku = new Map<string, FilaReposicionSku>(guardadas.filas.map((f) => [f.sku, f]))
  const skus = new Set<string>(soloSkus ?? [...porSku.keys(), ...caja.cantidades.keys()])

  const lista: ReferenciaAjustes[] = [...skus].map((sku) => {
    const g = porSku.get(sku) ?? null
    const deducida = caja.deducida(sku)
    const unidadesCaja = g?.unidades_caja ?? null
    return {
      sku,
      unidadesCaja,
      coberturaDias: g?.cobertura_dias ?? null,
      excluir: g?.excluir === true,
      motivo: g?.motivo ?? null,
      actualizadoAt: g?.actualizado_at ?? null,
      guardada: g !== null,
      cajaDeducida: deducida,
      cajaEncaje: caja.encaje.get(sku) ?? null,
      cantidadesEnviadas: caja.cantidades.get(sku) ?? [],
      caja: cajaDeLaReferencia({ cajaSku: unidadesCaja, cajaDeducida: deducida }, { multiploCaja: multiploCliente }),
      puedeGuardarDeducida: deducida !== null && deducida !== unidadesCaja,
    }
  })
  // Primero lo que tiene algo guardado, luego por referencia
  lista.sort((a, b) => Number(b.guardada) - Number(a.guardada) || a.sku.localeCompare(b.sku, 'es', { numeric: true }))
  return {
    ok: true,
    referencias: lista,
    multiploCliente,
    migracion316: guardadas.migracion316 && repo.migracion316,
    aviso: guardadas.migracion316 && repo.migracion316 ? null : FALTA_LA_MIGRACION_316,
  }
}

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const clienteId = clienteDe(p.get('cliente') ?? p.get('clienteId'))
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!esAgencia(sesion)) return fail(403, NO_CLIENTE)

    const skuParam = p.get('sku')
    const soloSkus = skuParam
      ? [...new Set(skuParam.split(',').map((s) => s.trim()).filter((s) => s && s.length <= 120))].slice(0, 400)
      : null
    return NextResponse.json(await referencias(createServiceClient(), clienteId, soloSkus && soloSkus.length > 0 ? soloSkus : null))
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los ajustes de las referencias')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return fail(400, 'Falta el cuerpo de la petición')
    const clienteId = clienteDe(request.nextUrl.searchParams.get('cliente') ?? cuerpo.cliente ?? cuerpo.clienteId)
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!esAgencia(sesion)) return fail(403, NO_CLIENTE)
    if (!agenciaQueEdita(sesion, clienteId)) return fail(403, 'Tu acceso a esta cuenta es solo de lectura')

    const v = validarCambiosSku(cuerpo)
    if (!v.ok) return fail(400, v.errores.join(' '))

    const service = createServiceClient()
    const skus = v.cambios.map((c) => c.sku)
    const previas = await leerFilasSku(service, clienteId, skus)
    if (!previas.migracion316) return fail(409, FALTA_LA_MIGRACION_316)
    const previaDe = new Map(previas.filas.map((f) => [f.sku, f]))

    // La caja deducida solo se lee si alguien pide guardarla
    const caja = v.cambios.some((c) => c.guardarCajaDeducida) ? await datosDeCaja(service, clienteId) : null

    const ahora = new Date().toISOString()
    const poner: FilaReposicionSku[] = []
    const quitar: string[] = []
    const errores: string[] = []
    for (const c of v.cambios) {
      const r = filaSkuFusionada(clienteId, previaDe.get(c.sku) ?? null, c, caja ? caja.deducida(c.sku) : null, { usuarioId: sesion.userId, ahora })
      if (!r.ok) errores.push(r.error)
      else if (r.vacia) {
        if (previaDe.has(c.sku)) quitar.push(c.sku)
      } else poner.push(r.fila)
    }
    if (errores.length > 0) return fail(400, errores.join(' '))

    // Todas las filas con las mismas columnas (filaSkuFusionada): el upsert en lote no pone NULL donde no toca (spec §0.1)
    if (poner.length > 0) {
      const { error } = await service.from('fba_reposicion_sku').upsert(poner, { onConflict: 'client_id,sku' })
      if (error) {
        if (faltaLaTabla(error)) return fail(409, FALTA_LA_MIGRACION_316)
        if ((error as { code?: string }).code === '23514') return fail(400, 'Algún valor se sale de los límites permitidos')
        throw error
      }
    }
    if (quitar.length > 0) {
      const { error } = await service.from('fba_reposicion_sku').delete().eq('client_id', clienteId).in('sku', quitar)
      if (error) {
        if (faltaLaTabla(error)) return fail(409, FALTA_LA_MIGRACION_316)
        throw error
      }
    }

    const tras = await referencias(service, clienteId, skus)
    return NextResponse.json({ ...tras, guardadas: poner.length, borradas: quitar.length })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los ajustes de las referencias')
  }
}

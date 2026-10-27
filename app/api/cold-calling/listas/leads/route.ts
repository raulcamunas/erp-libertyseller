import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { leerFiltroDeLeads } from '@/lib/cold-calling/listas'
import { DEMASIADAS_PETICIONES, SIN_CACHE, dentroDelLimite, leerCuerpoJson, requerirGestorDeListas, respuestaDeError } from '@/lib/cold-calling/listas-rutas'
import { LEADS_POR_PAGINA, leadsDelFiltro } from '@/lib/cold-calling/listas-servidor'

/**
 * BUSCAR LEADS CON FILTROS, DE PÁGINA EN PÁGINA — SOLO QUIEN GESTIONA LISTAS.
 *
 * POST application/json  { filtro, pagina? }
 *   filtro   { lista, dueno, estado, vende, tipo, nivel, empresa, q, orden }: cada campo vale lo que debe valer o es «sin filtro» (leerFiltroDeLeads)
 *   pagina   desde 0; de 100 en 100
 * Contesta { ok, total, filas, porPagina }. `total` es cuántos cumplen el filtro en toda la base, no solo en esta página.
 *
 * Es un POST y no un GET para no meter el filtro en la URL: una búsqueda puede llevar un nombre de tienda, un teléfono o un correo, y las direcciones se quedan en los
 * registros de los servidores.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const gestor = await requerirGestorDeListas()
  if (gestor instanceof NextResponse) return gestor
  if (!dentroDelLimite(`listas-leads:${gestor.userId}`, 240)) return fail(429, DEMASIADAS_PETICIONES)
  const cuerpo = await leerCuerpoJson(request)
  if (cuerpo instanceof NextResponse) return cuerpo

  try {
    const pagina = typeof cuerpo.pagina === 'number' && Number.isFinite(cuerpo.pagina) ? cuerpo.pagina : 0
    const r = await leadsDelFiltro(gestor.service, leerFiltroDeLeads(cuerpo.filtro), pagina)
    return NextResponse.json({ ok: true, ...r, porPagina: LEADS_POR_PAGINA }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeError('Cold Calling · listas: buscar leads', error)
  }
}

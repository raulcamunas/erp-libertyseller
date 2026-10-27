import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { leerFiltroDeBanco } from '@/lib/cold-calling/listas'
import { DEMASIADAS_PETICIONES, SIN_CACHE, dentroDelLimite, leerCuerpoJson, requerirGestorDeListas, respuestaDeError } from '@/lib/cold-calling/listas-rutas'
import { TIENDAS_POR_PAGINA, anadirDelBanco, buscarEnElBanco, resumenDelBanco } from '@/lib/cold-calling/listas-servidor'

/**
 * EL BANCO DE TIENDAS POR REPARTIR (las del Excel «Tienda no Amazon») — SOLO QUIEN GESTIONA LISTAS.
 *
 * GET   el resumen: cuántas tiendas hay y cuántas quedan sin repartir, por nivel, tramo, tipo de empresa, categoría y plataforma
 * POST application/json
 *   { accion: 'buscar', filtro, pagina? }                                       las tiendas que cumplen el filtro, de 50 en 50, por orden de prioridad (nivel y ventas)
 *   { accion: 'anadir', dominios, lista, dueno }                                convierte esas tiendas (por su dominio) en leads de la lista, del dueño que se diga (o de nadie)
 *   { accion: 'anadir', filtro, primeras, lista, dueno }                        lo mismo con las `primeras` N que cumplen el filtro, por orden de prioridad
 *
 * Una tienda cuya web ya está entre los leads NO se duplica: se enlaza y se cuenta como «ya estaba». Como mucho 3.000 de una vez. Queda apuntado en el historial y se
 * puede deshacer (se borran los leads que siguen sin tocar; los que ya tienen una llamada o una nota se quedan).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const gestor = await requerirGestorDeListas()
  if (gestor instanceof NextResponse) return gestor
  if (!dentroDelLimite(`banco-leer:${gestor.userId}`, 120)) return fail(429, DEMASIADAS_PETICIONES)
  try {
    return NextResponse.json({ ok: true, resumen: await resumenDelBanco(gestor.service) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeError('Cold Calling · banco: resumen', error)
  }
}

export async function POST(request: NextRequest) {
  const gestor = await requerirGestorDeListas()
  if (gestor instanceof NextResponse) return gestor
  if (!dentroDelLimite(`banco:${gestor.userId}`, 120)) return fail(429, DEMASIADAS_PETICIONES)
  const cuerpo = await leerCuerpoJson(request)
  if (cuerpo instanceof NextResponse) return cuerpo

  try {
    switch (cuerpo.accion) {
      case 'buscar': {
        const pagina = typeof cuerpo.pagina === 'number' && Number.isFinite(cuerpo.pagina) ? cuerpo.pagina : 0
        const r = await buscarEnElBanco(gestor.service, leerFiltroDeBanco(cuerpo.filtro), pagina)
        return NextResponse.json({ ok: true, ...r, porPagina: TIENDAS_POR_PAGINA }, { headers: SIN_CACHE })
      }
      case 'anadir': {
        if (typeof cuerpo.lista !== 'string') return fail(400, 'Elige la lista a la que se añaden.')
        if (cuerpo.dueno !== null && cuerpo.dueno !== undefined && typeof cuerpo.dueno !== 'string') return fail(400, 'La persona no es válida.')
        const dueno = typeof cuerpo.dueno === 'string' && cuerpo.dueno !== '' ? cuerpo.dueno : null
        const r = Array.isArray(cuerpo.dominios)
          ? await anadirDelBanco(gestor.service, gestor.userId, { dominios: cuerpo.dominios as string[], lista: cuerpo.lista, dueno })
          : await anadirDelBanco(gestor.service, gestor.userId, { filtro: leerFiltroDeBanco(cuerpo.filtro), primeras: typeof cuerpo.primeras === 'number' ? cuerpo.primeras : 0, lista: cuerpo.lista, dueno })
        return NextResponse.json({ ok: true, ...r }, { headers: SIN_CACHE })
      }
      default:
        return fail(400, 'No se entiende qué hacer.')
    }
  } catch (error) {
    return respuestaDeError('Cold Calling · banco: operación', error)
  }
}

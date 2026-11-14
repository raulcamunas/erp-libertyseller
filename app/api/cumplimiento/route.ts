import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail } from '@/lib/amazon/api'
import { filtrosValidos, paginaDeCliente, resumenDeCliente } from '@/lib/cumplimiento/consulta'
import { panelDeCliente } from '@/lib/cumplimiento/panel'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import {
  hayRevisionEnCurso,
  lanzarRevisionManual,
  revisarUnSku,
  ultimoResultadoManual,
} from '@/lib/cumplimiento/revisar'
import { corregir, correccionesRecientes, prepararCorreccion } from '@/lib/cumplimiento/correccion-servidor'
import type { Formulario } from '@/lib/cumplimiento/correccion'
import { clientesGrowth } from '@/lib/growth/clientes'
import { requireAppDeCuentas } from '@/lib/cuentas/acceso'

/**
 * CUMPLIMIENTO DE LISTINGS · LO QUE USA LA PANTALLA.
 *
 *   resumen   las cifras de arriba (y si hay una revisión en marcha).
 *   filas     una página de la lista, con los filtros elegidos.
 *   ahora     lanza una revisión del cliente y CONTESTA EN SEGUIDA.
 *   sku       vuelve a mirar UN listing, tras arreglarlo en Seller Central.
 *   panel     el panel de la app Cumplimiento: cifras por país, temas, incidencias agrupadas y evolución.
 *   corregir-preparar / corregir-validar / corregir-enviar   el panel «Corregir» de una incidencia (correccion-servidor.ts).
 *             ENVIAR ESCRIBE EN LA FICHA DEL CLIENTE: solo tras validar los mismos cambios, y queda registrado (migración 313).
 *   correcciones  las últimas correcciones enviadas del cliente.
 *
 * EL CLIENTE LLEGA COMO SLUG Y SE TRADUCE AQUÍ. Nunca llega una conexión ni un
 * identificador de cuenta: las consultas salen de las conexiones de ese cliente, así
 * que no se puede pedir lo de otro por mucho SKU que se conozca.
 *
 * Entran los administradores y quien tenga la casilla de Cumplimiento (requireAppDeCuentas). Decisión de Raúl (14 nov 2026):
 * los mismos pueden corregir desde el ERP, siempre con validación previa y registro.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function clienteDe(slug: unknown) {
  if (typeof slug !== 'string' || !slug) return null
  const c = (await clientesGrowth()).find((x) => x.slug === slug)
  return c && c.amazonClientId ? { ...c, amazonClientId: c.amazonClientId } : null
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAppDeCuentas('cumplimiento')
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      cliente?: string
      filtros?: unknown
      pagina?: number
      mercado?: string
      sku?: string
      codigo?: string
      atributos?: unknown
      formulario?: unknown
    }

    const cliente = await clienteDe(body.cliente)
    if (!cliente) return fail(404, 'Ese cliente no existe o no tiene una cuenta de Amazon conectada.')

    if (body.accion === 'resumen') {
      const conexiones = await conexionesDeCliente(cliente.amazonClientId)
      const ultimo = ultimoResultadoManual(cliente.amazonClientId)
      return NextResponse.json({
        ok: true,
        resumen: await resumenDeCliente(cliente.amazonClientId, filtrosValidos({ mercado: body.mercado }).mercado),
        enCurso: hayRevisionEnCurso(conexiones.map((c) => c.id)),
        ultimo,
      })
    }

    if (body.accion === 'panel') {
      const mercado = filtrosValidos({ mercado: body.mercado }).mercado
      return NextResponse.json({ ok: true, panel: await panelDeCliente(cliente.amazonClientId, mercado === 'todos' ? null : mercado) })
    }

    if (body.accion === 'filas') {
      const pagina = await paginaDeCliente(
        cliente.amazonClientId,
        filtrosValidos(body.filtros),
        Number.isFinite(body.pagina) ? Number(body.pagina) : 0
      )
      if ('error' in pagina) return fail(500, pagina.error)
      return NextResponse.json({ ok: true, ...pagina })
    }

    if (body.accion === 'ahora') {
      const r = await lanzarRevisionManual(cliente.amazonClientId)
      return NextResponse.json({ ok: true, ...r })
    }

    if (body.accion === 'sku') {
      const mercado = typeof body.mercado === 'string' ? body.mercado : ''
      const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
      if (!/^[A-Z0-9]{8,16}$/.test(mercado) || !sku || sku.length > 200) return fail(400, 'Listing no válido.')
      const r = await revisarUnSku(cliente.amazonClientId, mercado, sku)
      if (!r.ok) return fail(409, r.error)
      return NextResponse.json({ ok: true, encontrado: r.encontrado })
    }

    if (body.accion === 'correcciones') {
      const mercado = filtrosValidos({ mercado: body.mercado }).mercado
      // 50 y no 12: «Hoy» cuenta con ellas los envíos aceptados de la semana (la lista solo enseña 8)
      const lista = await correccionesRecientes(cliente.amazonClientId, mercado === 'todos' ? null : mercado, 50)
      return NextResponse.json({ ok: true, correcciones: lista, faltaMigracion: lista === null })
    }

    if (body.accion === 'corregir-preparar' || body.accion === 'corregir-validar' || body.accion === 'corregir-enviar') {
      const mercado = typeof body.mercado === 'string' ? body.mercado : ''
      const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
      if (!/^[A-Z0-9]{8,16}$/.test(mercado) || !sku || sku.length > 200) return fail(400, 'Listing no válido.')
      const codigo = typeof body.codigo === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(body.codigo) ? body.codigo : null
      if (body.accion === 'corregir-preparar') {
        const atributos = Array.isArray(body.atributos) ? body.atributos.filter((a): a is string => typeof a === 'string' && /^[a-z0-9_]{1,80}$/.test(a)).slice(0, 12) : []
        const r = await prepararCorreccion(cliente.amazonClientId, mercado, sku, codigo, atributos)
        if (!r.ok) return fail(409, r.error)
        return NextResponse.json(r)
      }
      const formulario = formularioValido(body.formulario)
      if (!formulario) return fail(400, 'El formulario no es válido.')
      const r = await corregir(body.accion === 'corregir-validar' ? 'validar' : 'enviar', cliente.amazonClientId, mercado, sku, codigo, formulario, session.userId)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, errores: 'errores' in r ? r.errores : undefined }, { status: 409 })
      return NextResponse.json(r)
    }

    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Error en el cumplimiento de listings')
  }
}

/** El formulario que llega de la pantalla: { atributo: [{ clave: texto }] }, con topes para que nadie mande cualquier cosa */
function formularioValido(v: unknown): Formulario | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const salida: Formulario = {}
  const entradas = Object.entries(v as Record<string, unknown>)
  if (entradas.length === 0 || entradas.length > 12) return null
  for (const [atributo, filas] of entradas) {
    if (!/^[a-z0-9_]{1,80}$/.test(atributo) || !Array.isArray(filas) || filas.length > 10) return null
    salida[atributo] = []
    for (const f of filas) {
      if (typeof f !== 'object' || f === null || Array.isArray(f)) return null
      const fila: Record<string, string> = {}
      for (const [k, x] of Object.entries(f as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_.]{1,120}$/.test(k) || typeof x !== 'string' || x.length > 5000) return null
        fila[k] = x
      }
      salida[atributo].push(fila)
    }
  }
  return salida
}

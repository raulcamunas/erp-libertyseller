import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail } from '@/lib/amazon/api'
import { filtrosValidos, paginaDeCliente, resumenDeCliente } from '@/lib/cumplimiento/consulta'
import { panelDeCliente } from '@/lib/cumplimiento/panel'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import { bloqueosDeCliente } from '@/lib/cumplimiento/bloqueos-servidor'
import { pedirSaludDeCliente, saludDeCliente } from '@/lib/cumplimiento/salud-servidor'
import { cambiarPrecio, corregir as corregirLimites, leer as leerPrecios, resolverConexion } from '@/lib/precios-limites/servidor'
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
 *   bloqueos      lo que impide vender, agrupado (lib/cumplimiento/bloqueos*.ts). Solo lee.
 *   salud / salud-ahora  la salud de la cuenta (informe de rendimiento de Amazon, migración 339); «ahora» lo pide a Amazon en ese momento (solo lee de Amazon).
 *   precios-leer  precio, mínimo y máximo de AHORA de unos SKU con error de precio (lee Amazon).
 *   precio-ajustar  ESCRIBE: el límite roto pasa a valer el precio (lib/precios-limites, la misma regla que Growth).
 *   precio-cambiar  ESCRIBE: un precio nuevo para un SKU; si se sale de los límites, el límite roto se mueve con él.
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
      skus?: unknown
      precio?: unknown
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

    if (body.accion === 'salud' || body.accion === 'salud-ahora') {
      const mercado = filtrosValidos({ mercado: body.mercado }).mercado
      const m = mercado === 'todos' ? null : mercado
      if (body.accion === 'salud-ahora') await pedirSaludDeCliente(cliente.amazonClientId, m)
      const salud = await saludDeCliente(cliente.amazonClientId, m)
      return NextResponse.json({ ok: true, disponible: salud !== null, salud: salud ?? [] })
    }

    if (body.accion === 'bloqueos') {
      const mercado = filtrosValidos({ mercado: body.mercado }).mercado
      const r = await bloqueosDeCliente(cliente.amazonClientId, mercado === 'todos' ? null : mercado)
      if (!r.ok) return fail(409, r.error)
      return NextResponse.json(r)
    }

    if (body.accion === 'precios-leer' || body.accion === 'precio-ajustar' || body.accion === 'precio-cambiar') {
      const mercado = typeof body.mercado === 'string' ? body.mercado : ''
      if (!/^[A-Z0-9]{8,16}$/.test(mercado)) return fail(400, 'Falta el país.')
      const conexion = await resolverConexion(cliente.amazonClientId, mercado)
      if ('error' in conexion) return fail(conexion.status, conexion.error)
      if (body.accion === 'precio-cambiar') {
        const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
        const precio = Number(body.precio)
        if (!sku || sku.length > 200) return fail(400, 'Listing no válido.')
        const r = await cambiarPrecio({ clientId: cliente.amazonClientId, connectionId: conexion.connectionId, marketplaceId: mercado, sku, precio, userId: session.userId })
        if ('error' in r) return fail(r.status, r.error)
        return NextResponse.json({ ok: true, ...r })
      }
      const skus = Array.isArray(body.skus) ? [...new Set(body.skus.filter((x): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= 200))].slice(0, 200) : []
      if (skus.length === 0) return fail(400, 'Faltan los listings.')
      if (body.accion === 'precios-leer') {
        const r = await leerPrecios(conexion.connectionId, mercado, skus)
        if ('error' in r) return fail(r.status, r.error)
        return NextResponse.json({ ok: true, ...r })
      }
      const r = await corregirLimites({ clientId: cliente.amazonClientId, connectionId: conexion.connectionId, marketplaceId: mercado, skus, simular: false, userId: session.userId })
      if ('error' in r) return fail(r.status, r.error)
      return NextResponse.json({ ok: true, ...r })
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

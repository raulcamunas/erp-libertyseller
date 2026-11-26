import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, UUID } from '@/lib/amazon/api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { descartarListing, filtrosValidos, paginaDeCliente, resumenDeCliente } from '@/lib/cumplimiento/consulta'
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
import { apuntar, borrarComentario, comentar, comentariosPorListing, MAX_TEXTO, registroDeCliente } from '@/lib/cumplimiento/registro-servidor'

/**
 * CUMPLIMIENTO DE LISTINGS · LO QUE USA LA PANTALLA.
 *
 *   resumen   las cifras de arriba (y si hay una revisión en marcha).
 *   filas     una página de la lista, con los filtros elegidos.
 *   ahora     lanza una revisión del cliente y CONTESTA EN SEGUIDA.
 *   sku       vuelve a mirar UN listing, tras arreglarlo en Seller Central.
 *   descartar / recuperar   quita un listing del seguimiento (no lo tenemos o no se puede recuperar) o lo devuelve. Migración 341. Quitar EXIGE motivo (343).
 *   registro      quién hizo qué sobre el cliente (o un listing: mercado + sku) y los comentarios. Migración 343.
 *   comentar / borrar-comentario   un comentario en un listing, con su autor; cada uno borra solo los suyos.
 *   Las acciones que cambian algo (quitar, recuperar, revisar, precios) se apuntan en el registro con quien las hizo (lib/cumplimiento/registro-servidor.ts).
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
      listings?: unknown[]
      motivo?: unknown
      texto?: unknown
      asin?: unknown
      id?: unknown
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
      const conteos = await comentariosPorListing(cliente.amazonClientId, pagina.filas)
      let quitados = new Map<string, { autor: string | null; texto: string | null }>()
      if (filtrosValidos(body.filtros).gravedad === 'descartados' && pagina.filas.length > 0) {
        const reg = (await registroDeCliente(cliente.amazonClientId, { limite: 500 }).catch(() => null)) ?? []
        quitados = new Map(reg.filter((e) => e.tipo === 'descartar').reverse().map((e) => [`${e.mercado}|${e.sku}`, { autor: e.autor, texto: e.texto }]))
      }
      const filas = pagina.filas.map((f) => {
        const k = `${f.marketplace_id}|${f.sku}`
        const q = quitados.get(k)
        return { ...f, comentarios: conteos[k] ?? 0, ...(q ? { descartado_por_nombre: q.autor, descartado_motivo: q.texto } : {}) }
      })
      return NextResponse.json({ ok: true, ...pagina, filas })
    }

    if (body.accion === 'ahora') {
      const r = await lanzarRevisionManual(cliente.amazonClientId)
      if (r.iniciada) await apuntar(cliente.amazonClientId, { tipo: 'revisar-todo' }, session.userId)
      return NextResponse.json({ ok: true, ...r })
    }

    if (body.accion === 'sku') {
      const mercado = typeof body.mercado === 'string' ? body.mercado : ''
      const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
      if (!/^[A-Z0-9]{8,16}$/.test(mercado) || !sku || sku.length > 200) return fail(400, 'Listing no válido.')
      const r = await revisarUnSku(cliente.amazonClientId, mercado, sku)
      if (!r.ok) return fail(409, r.error)
      await apuntar(cliente.amazonClientId, { tipo: 'revisar', mercado, sku, asin: typeof body.asin === 'string' ? body.asin : null, texto: r.encontrado ? null : 'Amazon ya no lo tiene en su catálogo' }, session.userId)
      return NextResponse.json({ ok: true, encontrado: r.encontrado })
    }

    if (body.accion === 'descartar' || body.accion === 'recuperar') {
      // Uno (mercado + sku) o varios (listings: [{ mercado, sku }], hasta 500)
      const crudos = Array.isArray(body.listings) ? body.listings : [{ mercado: body.mercado, sku: body.sku }]
      const listings = crudos
        .map((x) => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {}))
        .map((x) => ({ mercado: typeof x.mercado === 'string' ? x.mercado : '', sku: typeof x.sku === 'string' ? x.sku.trim() : '' }))
        .filter((x) => /^[A-Z0-9]{8,16}$/.test(x.mercado) && x.sku && x.sku.length <= 200)
        .slice(0, 500)
      if (listings.length === 0) return fail(400, 'Listing no válido.')
      const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, MAX_TEXTO) : ''
      if (body.accion === 'descartar' && motivo.length < 3) return fail(400, 'Hay que explicar por qué se quita del seguimiento.')
      const r = await descartarListing(cliente.amazonClientId, listings, body.accion === 'descartar', session.userId, motivo || null)
      if (!r.ok) return fail(409, r.error)
      await apuntar(
        cliente.amazonClientId,
        listings.filter((l) => `${l.mercado}|${l.sku}` in r.asins).map((l) => ({ tipo: body.accion === 'descartar' ? ('descartar' as const) : ('recuperar' as const), mercado: l.mercado, sku: l.sku, asin: r.asins[`${l.mercado}|${l.sku}`], texto: motivo || null })),
        session.userId
      )
      return NextResponse.json({ ok: true, cambiados: r.cambiados })
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
        await apuntar(cliente.amazonClientId, { tipo: 'precio', mercado, sku, texto: `Cambió el precio a ${precio.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }, session.userId)
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
      await apuntar(cliente.amazonClientId, skus.map((sku) => ({ tipo: 'precio' as const, mercado, sku, texto: 'Ajustó el precio mínimo o máximo al precio actual' })), session.userId)
      return NextResponse.json({ ok: true, ...r })
    }

    if (body.accion === 'registro') {
      const mercado = typeof body.mercado === 'string' && /^[A-Z0-9]{8,16}$/.test(body.mercado) ? body.mercado : null
      const sku = typeof body.sku === 'string' && body.sku.trim() && body.sku.length <= 200 ? body.sku.trim() : null
      const registro = await registroDeCliente(cliente.amazonClientId, { mercado, sku, limite: sku ? 100 : 300 })
      return NextResponse.json({ ok: true, registro: registro ?? [], faltaMigracion: registro === null, yo: session.userId })
    }

    if (body.accion === 'comentar') {
      const mercado = typeof body.mercado === 'string' ? body.mercado : ''
      const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
      const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
      if (!/^[A-Z0-9]{8,16}$/.test(mercado) || !sku || sku.length > 200) return fail(400, 'Listing no válido.')
      if (!texto) return fail(400, 'El comentario está vacío.')
      if (texto.length > MAX_TEXTO) return fail(400, `Máximo ${MAX_TEXTO} caracteres.`)
      const asin = typeof body.asin === 'string' && /^[A-Z0-9]{10}$/.test(body.asin) ? body.asin : null
      try {
        return NextResponse.json({ ok: true, comentario: await comentar(cliente.amazonClientId, { mercado, sku, asin, texto }, session.userId) })
      } catch (e) {
        if (isMissingSchema(e)) return fail(409, 'Falta lanzar la migración 343 (registro de Cumplimiento) en Supabase.')
        throw e
      }
    }

    if (body.accion === 'borrar-comentario') {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail(400, 'Falta el comentario.')
      if (!(await borrarComentario(cliente.amazonClientId, session.userId, body.id))) return fail(404, 'Ese comentario no existe o no es tuyo.')
      return NextResponse.json({ ok: true })
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

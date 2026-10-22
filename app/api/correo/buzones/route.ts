import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { ErrorDeCorreo, probarBuzon } from '@/lib/correo/conexion'
import { MAX_CONTRASENA, guardarContrasena } from '@/lib/correo/credenciales'
import { dominioDe, limpiarNombre, normalizarDireccion } from '@/lib/correo/direcciones'
import { PREAJUSTES, diasDeHistoricoValidos, proveedorPorMx, validarServidor, type IdProveedor, type Servidor } from '@/lib/correo/proveedores'
import { servidoresMx } from '@/lib/correo/red'
import { FALLO_GENERICO, SIN_CACHE, requerirCorreo, respuestaDeFallo, resumenDeLectura } from '@/lib/correo/rutas'
import { buzonesVisibles, estadoHttpDe, nombreDeLaSesion, sincronizarBuzonPorId, type ResultadoDeSincronizacion } from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS BUZONES: LISTARLOS Y CONECTAR EL PROPIO.
 *
 * GET   · los buzones que esta sesión puede ver: los suyos y, si supervisa, los del equipo comercial (o todos, si
 *         es administrador). Cada uno con sus cifras. Nunca lleva contraseñas ni datos de conexión.
 * POST  · { direccion, password, nombre?, proveedor?, desdeDias?, imap?, smtp? } conecta (o vuelve a conectar) el buzón
 *         de quien llama: comprueba la contraseña contra el servidor de correo (IMAP y SMTP), la guarda cifrada y
 *         empieza a traer los correos. Cada persona conecta SOLO el suyo: no hay forma de conectar el de otra.
 *
 * LAS RESPUESTAS SON FRASES FIJAS. Esta ruta maneja una contraseña, así que no se reenvía el texto de ninguna excepción
 * y la contraseña no se escribe en ningún registro.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_CUERPO = 8 * 1024
const MAX_BUZONES_POR_PERSONA = 3
const PRESUPUESTO_PRIMERA_LECTURA_MS = 20_000

export async function GET() {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const buzones = await buzonesVisibles(createServiceClient(), sesion)
    return NextResponse.json({ buzones, cifradoConfigurado: hasTokenKey() }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · buzones: fallo', error)
  }
}

type Servidores = { ok: true; proveedor: IdProveedor; imap: Servidor; smtp: Servidor } | { ok: false; estado: number; mensaje: string; necesitaProveedor?: boolean }

/** A qué servidores va este buzón: el que se pide, o el que dicen los MX del dominio */
async function resolverServidores(json: { proveedor?: unknown; imap?: unknown; smtp?: unknown }, direccion: string, rol: string): Promise<Servidores> {
  if (json.proveedor === 'personalizado') {
    if (rol !== 'admin') return { ok: false, estado: 403, mensaje: 'Solo un administrador puede conectar un servidor de correo que no sea el de Hostinger.' }
    const imap = validarServidor(json.imap, 'imap')
    const smtp = validarServidor(json.smtp, 'smtp')
    if (!imap || !smtp) return { ok: false, estado: 400, mensaje: 'Los servidores no son válidos: hace falta el nombre del servidor y el puerto (IMAP 993 o 143, SMTP 465 o 587).' }
    return { ok: true, proveedor: 'personalizado', imap, smtp }
  }
  if (json.proveedor === 'hostinger' || json.proveedor === 'titan') {
    const p = PREAJUSTES[json.proveedor]
    return { ok: true, proveedor: p.id, imap: p.imap, smtp: p.smtp }
  }

  const detectado = proveedorPorMx(await servidoresMx(dominioDe(direccion)))
  if (detectado === 'hostinger' || detectado === 'titan') {
    const p = PREAJUSTES[detectado]
    return { ok: true, proveedor: p.id, imap: p.imap, smtp: p.smtp }
  }
  if (detectado === 'google' || detectado === 'microsoft') {
    return { ok: false, estado: 422, mensaje: `Ese correo está en ${detectado === 'google' ? 'Google Workspace' : 'Microsoft 365'}, que no admite entrar con la contraseña del buzón. De momento aquí solo se conectan buzones de Hostinger.` }
  }
  return { ok: false, estado: 422, necesitaProveedor: true, mensaje: 'No se ha podido saber en qué proveedor está ese correo. Escoge si es de Hostinger o de Titan.' }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  if (!hasTokenKey()) {
    return fail(503, 'El servidor no tiene configurada la clave de cifrado, así que no puede guardar la contraseña del buzón. Avisa a Liberty Seller.')
  }

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { direccion?: unknown; password?: unknown; nombre?: unknown; proveedor?: unknown; desdeDias?: unknown; imap?: unknown; smtp?: unknown }
  try {
    json = JSON.parse(cuerpo.texto) as typeof json
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }

  const direccion = normalizarDireccion(json.direccion)
  if (!direccion) return fail(400, 'Eso no parece una dirección de correo.')
  const password = typeof json.password === 'string' ? json.password : ''
  if (password === '' || password.length > MAX_CONTRASENA) return fail(400, 'Escribe la contraseña del buzón.')

  try {
    const service = createServiceClient()

    const { data: existente, error: errorExistente } = await service.from('correo_buzones').select('id, user_id, desde_fecha').eq('direccion', direccion).maybeSingle()
    if (errorExistente) throw new Error('No se ha podido comprobar el buzón.', { cause: errorExistente })
    const previo = existente as { id: string; user_id: string; desde_fecha: string } | null

    if (previo && previo.user_id !== sesion.userId) {
      // Solo un administrador puede saber de quién es: así no se descubre qué correos están conectados
      const quien = sesion.role === 'admin' ? await nombreDeLaSesion(service, previo.user_id) : null
      return fail(409, `Este buzón ya está conectado por otra persona del equipo${quien ? ` (${quien})` : ''}.`)
    }
    if (!previo) {
      const { count, error } = await service.from('correo_buzones').select('id', { count: 'exact', head: true }).eq('user_id', sesion.userId)
      if (error) throw new Error('No se han podido contar tus buzones.', { cause: error })
      if ((count ?? 0) >= MAX_BUZONES_POR_PERSONA) return fail(409, `Ya tienes ${MAX_BUZONES_POR_PERSONA} buzones conectados, que es el máximo.`)
    }

    const servidores = await resolverServidores(json, direccion, sesion.role)
    if (!servidores.ok) return NextResponse.json({ error: servidores.mensaje, necesitaProveedor: servidores.necesitaProveedor === true }, { status: servidores.estado })

    const conexion = {
      usuario: direccion,
      imap_host: servidores.imap.host,
      imap_puerto: servidores.imap.puerto,
      imap_seguro: servidores.imap.seguro,
      smtp_host: servidores.smtp.host,
      smtp_puerto: servidores.smtp.puerto,
      smtp_seguro: servidores.smtp.seguro,
    }

    // Se comprueba ANTES de guardar nada: una contraseña mala no deja un buzón a medias
    try {
      await probarBuzon(conexion, password)
    } catch (error) {
      const e = error instanceof ErrorDeCorreo ? error : new ErrorDeCorreo('otro')
      return fail(estadoHttpDe(e.codigo), e.message)
    }

    const nombre = limpiarNombre(json.nombre) || (await nombreDeLaSesion(service, sesion.userId))
    const desde = new Date(Date.now() - diasDeHistoricoValidos(json.desdeDias) * 24 * 3600 * 1000)

    let buzonId: string
    if (previo) {
      // Volver a conectar: la ventana de importación solo puede crecer. Si se pide una más antigua, falta traer lo anterior
      const ampliada = desde.getTime() < Date.parse(previo.desde_fecha)
      const { error } = await service
        .from('correo_buzones')
        .update({
          ...conexion,
          nombre,
          proveedor: servidores.proveedor,
          desde_fecha: ampliada ? desde.toISOString() : previo.desde_fecha,
          ...(ampliada ? { historico_completo: false } : {}),
          credenciales_invalidas: false,
          fallos_seguidos: 0,
          ultimo_error: null,
        })
        .eq('id', previo.id)
      if (error) throw new Error('No se ha podido actualizar el buzón.', { cause: error })
      buzonId = previo.id
    } else {
      const { data, error } = await service
        .from('correo_buzones')
        .insert({ user_id: sesion.userId, direccion, nombre, proveedor: servidores.proveedor, desde_fecha: desde.toISOString(), ...conexion })
        .select('id')
        .single()
      if (error || !data) throw new Error('No se ha podido guardar el buzón.', { cause: error })
      buzonId = (data as { id: string }).id
    }

    const guardada = await guardarContrasena(service, buzonId, password)
    if (!guardada.ok) {
      // Un buzón nuevo sin contraseña no sirve para nada: se quita para no dejar basura
      if (!previo) await service.from('correo_buzones').delete().eq('id', buzonId)
      return fail(guardada.motivo === 'sin_clave_de_cifrado' ? 503 : 500, 'No se ha podido guardar la contraseña. Vuelve a probar en un momento.')
    }

    // La primera lectura: lo más reciente ya sale en la pantalla; el resto lo va trayendo la propia pantalla y el cron
    let lectura: ResultadoDeSincronizacion
    try {
      lectura = await sincronizarBuzonPorId(service, buzonId, { presupuestoMs: PRESUPUESTO_PRIMERA_LECTURA_MS })
    } catch (error) {
      console.error('Correo · conectar: la primera lectura ha fallado', { mensaje: error instanceof Error ? error.message : 'sin mensaje' })
      lectura = { tipo: 'error', codigo: 'base', mensaje: FALLO_GENERICO }
    }

    return NextResponse.json({ ok: true, buzonId, buzones: await buzonesVisibles(service, sesion), lectura: resumenDeLectura(lectura) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · conectar: fallo', error)
  }
}

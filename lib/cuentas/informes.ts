/**
 * EL INFORME AL CLIENTE · GUARDAR, LEER Y ENVIAR. SOLO SERVIDOR. Tabla `cuentas_informes` (migración 307).
 *
 * Un informe nace en BORRADOR con las cifras congeladas (lo que se le enseñará al cliente no cambia aunque Amazon corrija un dato mañana) y la lectura
 * de la IA. El administrativo edita la lectura y añade lo que ha hecho fuera del ERP; al enviarlo sale un correo desde SU buzón con un enlace a la
 * página del informe (/informe/<token>, sin sesión: el token es la credencial y solo abre ese informe) y queda marcado como enviado.
 */
import { randomBytes } from 'crypto'
import type { AmazonSession } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { urlBaseApp } from '@/lib/url-app'
import { elegirMiBuzon } from '@/lib/correo/mi-buzon'
import { leerLista } from '@/lib/correo/direcciones'
import { autorizarBuzon, buzonesVisibles, contarEnviosRecientes, enviarDesdeBuzon } from '@/lib/correo/servidor'
import { MAX_ENVIOS_POR_MINUTO } from '@/lib/correo/enviar'
import { correoDelInformeHtml, correoDelInformeTexto, NOMBRE_DEL_INFORME, periodoEnTexto, type DatosDelInforme, type LineaEjecutada, type TipoDeInforme } from './informe'

export interface InformeGuardado {
  id: string
  amazonClientId: string
  tipo: TipoDeInforme
  desde: string
  hasta: string
  datos: DatosDelInforme
  lectura: string
  lecturaIa: boolean
  /** Lo hecho fuera del ERP, que añade el administrativo */
  extra: LineaEjecutada[]
  token: string
  estado: 'borrador' | 'enviado'
  enviadoAt: string | null
  enviadoA: string | null
  creadoAt: string
}

const COLUMNAS = 'id, amazon_client_id, tipo, desde, hasta, datos, lectura, lectura_ia, extra, token, estado, enviado_at, enviado_a, creado_at'

function deFila(r: Record<string, unknown>): InformeGuardado {
  return {
    id: String(r.id),
    amazonClientId: String(r.amazon_client_id),
    tipo: r.tipo as TipoDeInforme,
    desde: String(r.desde),
    hasta: String(r.hasta),
    datos: r.datos as DatosDelInforme,
    lectura: String(r.lectura ?? ''),
    lecturaIa: Boolean(r.lectura_ia),
    extra: Array.isArray(r.extra) ? (r.extra as LineaEjecutada[]) : [],
    token: String(r.token),
    estado: r.estado === 'enviado' ? 'enviado' : 'borrador',
    enviadoAt: (r.enviado_at as string | null) ?? null,
    enviadoA: (r.enviado_a as string | null) ?? null,
    creadoAt: String(r.creado_at),
  }
}

export async function crearInforme(e: { amazonClientId: string; datos: DatosDelInforme; lectura: string; lecturaIa: boolean; userId: string }): Promise<InformeGuardado> {
  const { data, error } = await createServiceClient()
    .from('cuentas_informes')
    .insert({
      amazon_client_id: e.amazonClientId,
      tipo: e.datos.tipo,
      desde: e.datos.desde,
      hasta: e.datos.hasta,
      datos: e.datos,
      lectura: e.lectura,
      lectura_ia: e.lecturaIa,
      extra: [],
      token: randomBytes(18).toString('base64url'),
      creado_por: e.userId,
    })
    .select(COLUMNAS)
    .single()
  if (error) throw error
  return deFila(data as Record<string, unknown>)
}

export async function informePorId(id: string): Promise<InformeGuardado | null> {
  const { data, error } = await createServiceClient().from('cuentas_informes').select(COLUMNAS).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? deFila(data as Record<string, unknown>) : null
}

export async function informePorToken(token: string): Promise<InformeGuardado | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null
  const { data, error } = await createServiceClient().from('cuentas_informes').select(COLUMNAS).eq('token', token).maybeSingle()
  if (error) throw error
  return data ? deFila(data as Record<string, unknown>) : null
}

export async function informesDeCliente(amazonClientId: string, limite = 12): Promise<Array<Pick<InformeGuardado, 'id' | 'tipo' | 'desde' | 'hasta' | 'estado' | 'enviadoAt' | 'creadoAt'>>> {
  const { data, error } = await createServiceClient().from('cuentas_informes').select('id, tipo, desde, hasta, estado, enviado_at, creado_at').eq('amazon_client_id', amazonClientId).order('creado_at', { ascending: false }).limit(limite)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), tipo: r.tipo as TipoDeInforme, desde: String(r.desde), hasta: String(r.hasta), estado: r.estado === 'enviado' ? 'enviado' : 'borrador', enviadoAt: (r.enviado_at as string | null) ?? null, creadoAt: String(r.creado_at) }))
}

export async function guardarBorrador(id: string, cambios: { lectura?: string; extra?: LineaEjecutada[]; datos?: DatosDelInforme }): Promise<void> {
  const fila: Record<string, unknown> = { actualizado_at: new Date().toISOString() }
  if (cambios.lectura !== undefined) fila.lectura = cambios.lectura.slice(0, 6000)
  if (cambios.extra !== undefined) fila.extra = cambios.extra.slice(0, 20).map((x) => ({ accion: String(x.accion).slice(0, 140), cantidad: Math.max(0, Math.round(Number(x.cantidad) || 0)), criterio: String(x.criterio ?? '').slice(0, 240) }))
  if (cambios.datos !== undefined) fila.datos = cambios.datos
  const { error } = await createServiceClient().from('cuentas_informes').update(fila).eq('id', id)
  if (error) throw error
}

export async function borrarBorrador(id: string): Promise<void> {
  const { error } = await createServiceClient().from('cuentas_informes').delete().eq('id', id).eq('estado', 'borrador')
  if (error) throw error
}

export const urlDelInforme = (token: string) => `${urlBaseApp()}/informe/${token}`

/** Envía el informe desde el buzón de quien lo envía y lo marca como enviado */
export async function enviarInforme(sesion: AmazonSession, inf: InformeGuardado, p: { para: string; asunto: string; saludo: string; firma: string }): Promise<{ ok: true; para: string } | { ok: false; estado: number; error: string }> {
  const lista = leerLista(p.para.slice(0, 500))
  if (lista.invalidas.length) return { ok: false, estado: 400, error: `La dirección «${lista.invalidas[0]}» no es válida.` }
  if (lista.personas.length === 0 || lista.personas.length > 5) return { ok: false, estado: 400, error: 'Pon entre una y cinco direcciones.' }
  const asunto = p.asunto.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  if (!asunto) return { ok: false, estado: 400, error: 'Falta el asunto.' }
  if (!inf.lectura.trim()) return { ok: false, estado: 400, error: 'Escribe la lectura del periodo antes de enviarlo.' }

  const service = createServiceClient()
  const mio = elegirMiBuzon(await buzonesVisibles(service, sesion))
  if (mio.tipo === 'sin-buzon') return { ok: false, estado: 409, error: 'No tienes tu correo conectado al ERP. Conéctalo en Correo y vuelve a probar.' }
  if (mio.tipo === 'credenciales') return { ok: false, estado: 409, error: `El servidor ha rechazado la contraseña de ${mio.direccion}. Vuelve a ponerla en Correo.` }
  const auth = await autorizarBuzon(service, sesion, mio.buzon.id, 'escribir')
  if (!auth.ok) return { ok: false, estado: auth.estado, error: auth.mensaje }
  if ((await contarEnviosRecientes(service, auth.buzon.id, Date.now() - 60_000)) >= MAX_ENVIOS_POR_MINUTO) return { ok: false, estado: 429, error: 'Estás enviando demasiado rápido. Espera un minuto.' }

  const piezas = { cliente: inf.datos.cliente, tipo: inf.tipo, desde: inf.desde, hasta: inf.hasta, saludo: p.saludo.trim().slice(0, 120) || 'Hola,', lectura: inf.lectura, url: urlDelInforme(inf.token), firma: p.firma.trim().slice(0, 300) }
  const r = await enviarDesdeBuzon(service, auth.buzon, { para: lista.personas, cc: [], asunto, texto: correoDelInformeTexto(piezas), html: correoDelInformeHtml(piezas) })
  if (r.tipo === 'error') return { ok: false, estado: r.estado, error: r.mensaje }

  const para = lista.personas.map((x) => x.direccion).join(', ')
  const { error } = await service.from('cuentas_informes').update({ estado: 'enviado', enviado_at: new Date().toISOString(), enviado_por: sesion.userId, enviado_a: para }).eq('id', inf.id)
  if (error) console.error('[informe] enviado pero sin marcar', { codigo: error.code })
  return { ok: true, para }
}

export const asuntoPorDefecto = (inf: Pick<InformeGuardado, 'tipo' | 'desde' | 'hasta'> & { cliente: string }) => `${NOMBRE_DEL_INFORME[inf.tipo]} de Amazon · ${inf.cliente} · ${periodoEnTexto(inf.desde, inf.hasta)}`

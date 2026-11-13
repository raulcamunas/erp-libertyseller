/**
 * MANDAR EL ANÁLISIS DE AMAZON POR CORREO A UN LEAD — SOLO SERVIDOR.
 *
 * Dos pasos, los dos desde la ficha del lead (components/cold-calling/EnviarAnalisisPorCorreo.tsx):
 *   preparar  la IA escribe asunto y entradilla según en qué punto está el lead (correo-ia.ts); el comercial lo ve tal cual saldrá y lo retoca
 *   enviar    se rehace el correo EN EL SERVIDOR (del cliente solo llegan el asunto, el saludo y la entradilla) y sale desde el buzón de quien
 *             lo envía, con la misma verificación de direcciones y el mismo freno de envíos por minuto que cualquier correo del ERP
 *
 * Queda en el historial del lead como un correo más (kind 'email', con el texto entero) y sella su último contacto. No cambia su estado.
 * Sin migración: que ya se le mandó, y que pidió la baja, son apuntes de su historial con una marca fija al principio.
 */
import type { AmazonSession } from '@/lib/amazon/api'
import { elegirMiBuzon } from '@/lib/correo/mi-buzon'
import { leerLista } from '@/lib/correo/direcciones'
import { cuerpoDelApunte } from '@/lib/correo/apunte'
import { autorizarBuzon, buzonesVisibles, contarEnviosRecientes, enviarDesdeBuzon } from '@/lib/correo/servidor'
import { MAX_ENVIOS_POR_MINUTO } from '@/lib/correo/enviar'
import { verificarAntesDeEnviar } from '@/lib/correo/verificacion/pago-servidor'
import { createServiceClient } from '@/lib/supabase/service'
import { urlBaseApp } from '@/lib/url-app'
import type { InformeAnalisis } from './construir'
import { correoAnalisisHtml, textoCorreoAnalisis, type DatosCorreoAnalisis } from './correo'
import { ETIQUETA_DE_SITUACION, escribirTextos, nombreDePila, situacionDelLead, type LeadParaCorreo, type NotaParaCorreo } from './correo-ia'
import { contactoDeUsuario, ultimoAnalisisDelLead } from './servidor'

/** Así empieza el apunte del historial cuando el correo llevaba el análisis (y así se sabe que ya se mandó) */
export const MARCA_ENVIADO = '📈 Con su análisis de Amazon:'
/** Así empieza el apunte cuando el lead pulsa la baja del correo */
export const MARCA_BAJA = '🚫 Ha pedido no recibir más correos'

type Fallo = { ok: false; estado: number; error: string }

type Contexto = {
  lead: LeadParaCorreo & { email: string | null; store_name: string | null }
  notas: NotaParaCorreo[]
  informe: InformeAnalisis
  datos: DatosCorreoAnalisis
  buzon: { id: string; direccion: string }
  enviadoAt: string | null
}

async function cargarContexto(sesion: AmazonSession, leadId: string): Promise<Contexto | Fallo> {
  // La sesión de quien envía decide si el lead es suyo (RLS); lo demás, con la clave de servicio
  const { data: lead } = await sesion.supabase
    .from('cold_leads')
    .select('id, status, ciclo_fase, decisor, last_contacted_at, email, store_name')
    .eq('id', leadId)
    .maybeSingle()
  if (!lead) return { ok: false, estado: 404, error: 'No tienes acceso a este lead.' }

  const service = createServiceClient()
  const [analisis, notasR, buzones, comercial] = await Promise.all([
    ultimoAnalisisDelLead(leadId),
    service.from('cold_lead_notes').select('kind, body, occurred_at').eq('lead_id', leadId).order('occurred_at', { ascending: false }).limit(40),
    buzonesVisibles(service, sesion),
    contactoDeUsuario(sesion.userId),
  ])
  if (!analisis) return { ok: false, estado: 404, error: 'Este lead todavía no tiene análisis.' }
  const notas = (notasR.data ?? []) as NotaParaCorreo[]
  if (notas.some((n) => n.body.startsWith(MARCA_BAJA))) return { ok: false, estado: 409, error: 'Este lead pidió no recibir más correos (está en su historial).' }

  const mio = elegirMiBuzon(buzones)
  if (mio.tipo === 'sin-buzon') return { ok: false, estado: 409, error: 'No tienes tu correo conectado al ERP. Conéctalo en Correo y vuelve a probar.' }
  if (mio.tipo === 'credenciales') return { ok: false, estado: 409, error: `El servidor ha rechazado la contraseña de ${mio.direccion}. Vuelve a ponerla en Correo.` }

  const base = urlBaseApp()
  const enviado = notas.find((n) => n.kind === 'email' && n.body.includes(MARCA_ENVIADO))
  return {
    lead: lead as Contexto['lead'],
    notas: notas.slice(0, 8),
    informe: analisis.informe,
    datos: {
      url: `${base}/analisis/${analisis.token}`,
      urlBaja: `${base}/analisis/${analisis.token}/baja`,
      comercial: { nombre: comercial?.nombre ?? 'Liberty Seller', whatsapp: comercial?.whatsapp ?? null, telefono: comercial?.telefono ?? null },
      base,
    },
    buzon: { id: mio.buzon.id, direccion: mio.buzon.direccion },
    enviadoAt: enviado?.occurred_at ?? null,
  }
}

export type CorreoPreparado = {
  ok: true
  para: string
  desde: string
  asunto: string
  saludo: string
  entradilla: string
  deIa: boolean
  situacion: string
  enviadoAt: string | null
  informe: InformeAnalisis
  datos: DatosCorreoAnalisis
}

export async function prepararCorreo(sesion: AmazonSession, leadId: string): Promise<CorreoPreparado | Fallo> {
  const ctx = await cargarContexto(sesion, leadId)
  if ('error' in ctx) return ctx
  const situacion = situacionDelLead(ctx.lead, ctx.notas)
  const textos = await escribirTextos(ctx.informe, { situacion, nombre: nombreDePila(ctx.lead.decisor), comercial: ctx.datos.comercial.nombre, notas: ctx.notas })
  if (textos.tokens) console.log('[analisis-correo] IA', { entrada: textos.tokens.entrada, salida: textos.tokens.salida })
  return {
    ok: true,
    para: ctx.lead.email ?? '',
    desde: ctx.buzon.direccion,
    asunto: textos.asunto,
    saludo: textos.saludo,
    entradilla: textos.entradilla,
    deIa: textos.deIa,
    situacion: ETIQUETA_DE_SITUACION[situacion],
    enviadoAt: ctx.enviadoAt,
    informe: ctx.informe,
    datos: ctx.datos,
  }
}

export type PeticionDeEnvio = { leadId: string; para: string; asunto: string; saludo: string; entradilla: string }

export async function enviarCorreoDelAnalisis(sesion: AmazonSession, p: PeticionDeEnvio): Promise<{ ok: true; para: string; avisos: string[] } | Fallo> {
  const ctx = await cargarContexto(sesion, p.leadId)
  if ('error' in ctx) return ctx

  const lista = leerLista(p.para.slice(0, 500))
  if (lista.invalidas.length) return { ok: false, estado: 400, error: `La dirección «${lista.invalidas[0]}» no es válida.` }
  if (lista.personas.length !== 1) return { ok: false, estado: 400, error: 'Pon una sola dirección: el análisis es de esa empresa.' }
  const asunto = p.asunto.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  const saludo = p.saludo.replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  const entradilla = p.entradilla.replace(/\r\n?/g, '\n').trim().slice(0, 2000)
  if (!asunto) return { ok: false, estado: 400, error: 'Falta el asunto.' }

  const service = createServiceClient()
  const auth = await autorizarBuzon(service, sesion, ctx.buzon.id, 'escribir')
  if (!auth.ok) return { ok: false, estado: auth.estado, error: auth.mensaje }
  if ((await contarEnviosRecientes(service, auth.buzon.id, Date.now() - 60_000)) >= MAX_ENVIOS_POR_MINUTO) {
    return { ok: false, estado: 429, error: 'Estás enviando demasiado rápido. Espera un minuto y vuelve a probar.' }
  }
  const verificacion = await verificarAntesDeEnviar(service, { para: lista.personas.map((x) => x.direccion), direccionDelBuzon: auth.buzon.direccion, usuarioId: sesion.userId })
  if (verificacion?.bloqueo) return { ok: false, estado: 422, error: verificacion.bloqueo.mensaje }

  const datos: DatosCorreoAnalisis = { ...ctx.datos, saludo: saludo || null, entradilla: entradilla || null }
  const resultado = await enviarDesdeBuzon(service, auth.buzon, {
    para: lista.personas,
    cc: [],
    asunto,
    texto: textoCorreoAnalisis(ctx.informe, datos),
    html: correoAnalisisHtml(ctx.informe, datos),
    bajaUrl: ctx.datos.urlBaja,
  })
  if (resultado.tipo === 'error') return { ok: false, estado: resultado.estado, error: resultado.mensaje }

  // El correo YA HA SALIDO: lo que falle de aquí en adelante no se devuelve como error
  const ahora = new Date().toISOString()
  const cuerpo = cuerpoDelApunte({
    para: lista.personas[0].direccion,
    asunto,
    texto: `${saludo}\n\n${entradilla || '(entradilla de siempre)'}\n\n${MARCA_ENVIADO} ${ctx.datos.url}`,
  })
  const { error: e1 } = await service.from('cold_lead_notes').insert({ lead_id: p.leadId, author_id: sesion.userId, kind: 'email', body: cuerpo, occurred_at: ahora })
  if (e1) console.error('[analisis-correo] enviado pero sin apuntar en el historial', { codigo: e1.code })
  const { error: e2 } = await service.from('cold_leads').update({ last_contacted_at: ahora }).eq('id', p.leadId)
  if (e2) console.error('[analisis-correo] enviado pero sin sellar el último contacto', { codigo: e2.code })

  return { ok: true, para: lista.personas[0].direccion, avisos: verificacion?.avisos ?? [] }
}

/** El lead pulsa «darse de baja» en el correo: queda en su historial y ya no se le puede mandar otro desde aquí */
export async function registrarBaja(leadId: string, tienda: string): Promise<void> {
  const service = createServiceClient()
  const { data } = await service.from('cold_lead_notes').select('id').eq('lead_id', leadId).like('body', `${MARCA_BAJA}%`).limit(1)
  if (data?.length) return
  const cuando = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  await service.from('cold_lead_notes').insert({ lead_id: leadId, author_id: null, kind: 'nota', body: `${MARCA_BAJA} (${tienda}, desde el enlace del correo del análisis · ${cuando}). No volver a escribirle por correo.` })
}

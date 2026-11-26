/**
 * SEO · EL REGISTRO DE QUIÉN HA HECHO QUÉ EN UNA CUENTA Y PAÍS. SOLO SERVIDOR, SOLO LEE.
 *
 * No hay tabla de registro aparte: cada cosa que se hace en SEO Test ya deja quién y cuándo en su propia tabla, y aquí se juntan en una sola línea de tiempo:
 *   · seo_ediciones (312): envíos de ficha a Amazon (enviado_por) y lo que comprobó el ERP después (aplicada, no aplicada, parcial), o el error;
 *   · seo_propuestas (299): las propuestas pedidas a la IA (creada_por);
 *   · seo_helium_importaciones (312): los Cerebro / Magnet subidos (subido_por);
 *   · seo_busquedas_decididas (333): las búsquedas marcadas «no es nuestro producto» o «sí es nuestro» (created_by);
 *   · seo_marcas (338): las marcas de la competencia añadidas a mano (created_by; las automáticas salen como «el ERP»);
 *   · seo_fichas.highlights_manual_* (334): los Item Highlights apuntados a mano.
 * Si falta una migración, esa parte sale vacía (no tumba el resto).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { NOMBRE_DE_CAMPO, type CampoFicha } from './edicion'
import { nombresDe, type EdicionGuardada } from './edicion-servidor'

export type TipoDeEvento = 'ficha' | 'verificacion' | 'ia' | 'helium' | 'busqueda' | 'marca' | 'highlights'

export interface EventoSeo {
  id: string
  at: string
  /** Nombre de la persona; null = lo hizo el ERP solo */
  quien: string | null
  tipo: TipoDeEvento
  asin: string | null
  accion: string
  detalle: string | null
  tono: 'bien' | 'mal' | 'aviso' | 'neutro'
  /** El hilo de comentarios: «cambio:<edición>» (lo comparten el envío, la comprobación y la tarjeta) o «ev:<id>» */
  hilo: string
}

const LIMITE = 300
const DIAS = 180

const camposTexto = (campos: readonly string[]) => campos.map((c) => (NOMBRE_DE_CAMPO as Record<string, string>)[c as CampoFicha] ?? c).join(', ') || 'la ficha'

async function filas(tabla: string, columnas: string, c: { connectionId: string; marketplaceId: string }, orden: string, noNulo?: string): Promise<Array<Record<string, unknown>>> {
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString()
  let q = createServiceClient().from(tabla).select(columnas).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).gte(orden, desde)
  if (noNulo) q = q.not(noNulo, 'is', null)
  const { data, error } = await q.order(orden, { ascending: false }).limit(LIMITE)
  if (error) {
    if (isMissingSchema(error)) return []
    console.error(`SEO registro: ${tabla}:`, error.message)
    return []
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>
}

/** Los eventos de las ediciones de ficha (ya leídas con sus nombres) */
export function eventosDeEdiciones(ediciones: readonly EdicionGuardada[]): EventoSeo[] {
  const ev: EventoSeo[] = []
  const hilo = (e: EdicionGuardada) => `cambio:${e.id}`
  for (const e of ediciones) {
    const que = camposTexto(e.campos)
    if (e.enviadaAt)
      ev.push({
        id: `${e.id}-envio`,
        at: e.enviadaAt,
        quien: e.enviadoPor,
        tipo: 'ficha',
        asin: e.asin,
        accion: `Envió a Amazon un cambio de ${que}${e.origen === 'ia' ? ' (propuesta de la IA)' : ''}`,
        detalle: e.fueraDeVentana ? 'Se saltó la ventana de 30 días entre cambios' : null,
        tono: e.fueraDeVentana ? 'aviso' : 'neutro',
        hilo: hilo(e),
      })
    if (e.verificadaAt && (e.estado === 'aplicada' || e.estado === 'no_aplicada' || e.estado === 'parcial'))
      ev.push({
        id: `${e.id}-verif`,
        at: e.verificadaAt,
        quien: null,
        tipo: 'verificacion',
        asin: e.asin,
        accion: e.estado === 'aplicada' ? `Comprobó que Amazon aplicó el cambio de ${que}` : e.estado === 'parcial' ? `Comprobó que Amazon aplicó solo parte del cambio de ${que}` : `Comprobó que Amazon NO aplicó el cambio de ${que}`,
        detalle: e.verificacion?.explicacion ?? null,
        tono: e.estado === 'aplicada' ? 'bien' : e.estado === 'parcial' ? 'aviso' : 'mal',
        hilo: hilo(e),
      })
    if (e.estado === 'error')
      ev.push({ id: `${e.id}-error`, at: e.enviadaAt ?? e.createdAt, quien: e.enviadoPor ?? e.creadoPor, tipo: 'ficha', asin: e.asin, accion: `Tuvo un error al enviar el cambio de ${que}`, detalle: e.error, tono: 'mal', hilo: hilo(e) })
  }
  return ev
}

/** El registro completo de la cuenta y país: los eventos de las ediciones más todo lo demás, los más nuevos primero */
export async function registroDeLaCuenta(c: { connectionId: string; marketplaceId: string }, ediciones: readonly EdicionGuardada[]): Promise<EventoSeo[]> {
  const [propuestas, helium, busquedas, marcas, highlights] = await Promise.all([
    filas('seo_propuestas', 'id, asin, creada_por, creada_at', c, 'creada_at'),
    filas('seo_helium_importaciones', 'id, asin, tipo, fichero, filas, subido_por, subido_at', c, 'subido_at'),
    filas('seo_busquedas_decididas', 'consulta, texto, decision, asin, created_by, created_at', c, 'created_at'),
    filas('seo_marcas', 'marca, texto, origen, activa, created_by, created_at', c, 'created_at'),
    filas('seo_fichas', 'asin, highlights_manual_at, highlights_manual_por', c, 'highlights_manual_at', 'highlights_manual_at'),
  ])
  const nombres = await nombresDe([...propuestas.map((r) => r.creada_por), ...helium.map((r) => r.subido_por), ...busquedas.map((r) => r.created_by), ...marcas.map((r) => r.created_by), ...highlights.map((r) => r.highlights_manual_por)])
  const nombre = (id: unknown) => (typeof id === 'string' ? (nombres.get(id) ?? 'alguien del equipo') : null)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)

  const ev: EventoSeo[] = eventosDeEdiciones(ediciones)
  const otros: Array<Omit<EventoSeo, 'hilo'>> = []
  for (const r of propuestas)
    otros.push({ id: `prop-${r.id}`, at: String(r.creada_at), quien: nombre(r.creada_por), tipo: 'ia', asin: str(r.asin), accion: 'Pidió una propuesta de ficha a la IA', detalle: null, tono: 'neutro' })
  for (const r of helium) {
    const tipo = r.tipo === 'cerebro' ? 'Cerebro' : r.tipo === 'magnet' ? 'Magnet' : 'Keyword Tracker'
    otros.push({ id: `hel-${r.id}`, at: String(r.subido_at), quien: nombre(r.subido_por), tipo: 'helium', asin: str(r.asin), accion: `Subió un ${tipo} de Helium 10`, detalle: `${Number(r.filas ?? 0).toLocaleString('es-ES')} palabras${str(r.fichero) ? ` · ${str(r.fichero)}` : ''}`, tono: 'neutro' })
  }
  for (const r of busquedas)
    otros.push({
      id: `bus-${r.consulta}`,
      at: String(r.created_at),
      quien: nombre(r.created_by),
      tipo: 'busqueda',
      asin: str(r.asin),
      accion: r.decision === 'ajena' ? 'Marcó una búsqueda como «no es nuestro producto»' : 'Marcó una búsqueda como «sí es nuestro producto»',
      detalle: `«${str(r.texto) ?? str(r.consulta) ?? ''}»`,
      tono: 'neutro',
    })
  for (const r of marcas) {
    const aMano = r.origen === 'manual'
    otros.push({ id: `mar-${r.marca}`, at: String(r.created_at), quien: aMano ? nombre(r.created_by) : null, tipo: 'marca', asin: null, accion: aMano ? 'Añadió una marca de la competencia' : 'Detectó una marca de la competencia', detalle: `${str(r.texto) ?? str(r.marca)}${r.activa === false ? ' (desactivada)' : ''}`, tono: 'neutro' })
  }
  for (const r of highlights)
    otros.push({ id: `hig-${r.asin}`, at: String(r.highlights_manual_at), quien: nombre(r.highlights_manual_por), tipo: 'highlights', asin: str(r.asin), accion: 'Apuntó a mano los Item Highlights', detalle: null, tono: 'neutro' })

  for (const o of otros) ev.push({ ...o, hilo: `ev:${o.id}` })
  return ev.sort((a, b) => b.at.localeCompare(a.at))
}

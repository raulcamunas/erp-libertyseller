/**
 * Los textos y colores de una propuesta del motor (qué hace, cómo se llama, de qué color va), comunes a la tarjeta, la confirmación y la barra del lote.
 */
import type { TonoEstado } from '@/lib/estilo/denso'
import type { Propuesta } from '@/lib/ads/motor'

const n2 = (x: number | null) => (x == null ? '—' : x.toFixed(2).replace('.', ','))

/** Lo que hace una propuesta, en una frase (para la confirmación) */
export function queHace(p: Propuesta): string {
  switch (p.tipo) {
    case 'negativizar':
      return p.esAsin ? `Excluir la ficha ${p.termino.toUpperCase()} (segmentación negativa por productos) del grupo de anuncios de ${p.campaignNombre}` : `Excluir «${p.termino}» (negativa exacta) de la campaña ${p.campaignNombre}`
    case 'puja':
      return `Cambiar la puja de «${p.termino}» de ${n2(p.valorActual)} a ${n2(p.valorNuevo)} en ${p.campaignNombre}`
    case 'presupuesto':
      return `Cambiar el presupuesto diario de ${n2(p.valorActual)} a ${n2(p.valorNuevo)} en ${p.campaignNombre}`
    case 'pausar':
      return p.objetivoTipo === 'anuncio' ? `Pausar el anuncio de ${p.asin ?? p.termino} en ${p.campaignNombre} (sin stock)` : `Pausar «${p.termino}» en ${p.campaignNombre}`
    case 'pausar-campana':
      return `Pausar la campaña ${p.campaignNombre} (sin stock)`
    default:
      return p.esAsin ? `Atacar la ficha ${p.termino.toUpperCase()} en ${p.haciaCampaignNombre ?? 'ATAQUE ASIN'} y excluirla de ${p.campaignNombre}` : `Añadir «${p.termino}» (exacta) a ${p.haciaCampaignNombre ?? '—'} y excluirlo de ${p.campaignNombre}`
  }
}

const sube = (p: Propuesta) => (p.valorNuevo ?? 0) >= (p.valorActual ?? 0)

export function nombreDePropuesta(p: Propuesta): string {
  if (p.tipo === 'negativizar') return p.esAsin ? 'Excluir ASIN' : 'Excluir'
  if (p.tipo === 'promover') return p.esAsin ? 'Atacar ASIN' : 'Cosechar a exacta'
  if (p.tipo === 'pausar') return p.objetivoTipo === 'anuncio' ? 'Pausar anuncio' : 'Pausar'
  if (p.tipo === 'pausar-campana') return 'Pausar campaña'
  if (p.tipo === 'presupuesto') return sube(p) ? 'Subir presupuesto' : 'Bajar presupuesto'
  return sube(p) ? 'Subir puja' : 'Bajar puja'
}

/** Lo que recorta gasto en rojo/ámbar, lo que lo amplía en verde, el presupuesto en azul */
export function tonoDePropuesta(p: Propuesta): TonoEstado {
  if (p.tipo === 'negativizar' || p.tipo === 'pausar' || p.tipo === 'pausar-campana') return 'rojo'
  if (p.tipo === 'promover') return 'verde'
  if (p.tipo === 'presupuesto') return 'azul'
  return sube(p) ? 'verde' : 'ambar'
}

/** «3 excluir · 2 bajar puja» */
export function resumenDeLote(ps: readonly Propuesta[]): string {
  const c = new Map<string, number>()
  for (const p of ps) {
    const k = nombreDePropuesta(p).toLowerCase()
    c.set(k, (c.get(k) ?? 0) + 1)
  }
  return [...c].map(([k, v]) => `${v} ${k}`).join(' · ')
}

/** El estado de una propuesta, para la insignia del historial */
export const ESTADO_DE_PROPUESTA: Record<string, { texto: string; tono: TonoEstado }> = {
  pendiente: { texto: 'Pendiente', tono: 'ambar' },
  aplicada: { texto: 'Aplicada', tono: 'verde' },
  aplicando: { texto: 'Aplicando…', tono: 'azul' },
  aprobada: { texto: 'Aplicando…', tono: 'azul' },
  descartada: { texto: 'Descartada', tono: 'gris' },
  deshecha: { texto: 'Deshecha', tono: 'gris' },
  error: { texto: 'Error', tono: 'rojo' },
  caducada: { texto: 'Caducada', tono: 'gris' },
  obsoleta: { texto: 'Obsoleta', tono: 'gris' },
  ensayada: { texto: 'Ensayada (agente)', tono: 'cian' },
}

/** ¿Se quedó colgada una reserva? (el proceso murió a mitad de aplicar: puede estar aplicada en Amazon) */
export function reservaColgada(p: Propuesta, minutos: number, ahora = Date.now()): boolean {
  return (p.estado === 'aplicando' || p.estado === 'aprobada') && p.resueltaAt != null && ahora - Date.parse(p.resueltaAt) > minutos * 60_000
}

/** Lo que la propuesta ahorra o pone en juego, para la línea de impacto. null = no se puede decir con los datos que trae */
export function impactoDe(p: Propuesta): { texto: string; tono: TonoEstado } | null {
  const m = p.metricas
  if ((p.tipo === 'negativizar' || p.tipo === 'pausar') && m.gasto > 0) return { texto: m.pedidos > 0 ? `Gasto que deja de ir a esto: ${m.gasto.toFixed(2).replace('.', ',')} (con ${m.pedidos} pedidos)` : `Gasto sin un solo pedido que se corta: ${m.gasto.toFixed(2).replace('.', ',')}`, tono: 'rojo' }
  if (p.tipo === 'promover' && m.ventas > 0) return { texto: `Ventas que ya trae este término: ${m.ventas.toFixed(2).replace('.', ',')} con ${m.pedidos} pedidos`, tono: 'verde' }
  if ((p.tipo === 'puja' || p.tipo === 'presupuesto') && p.valorActual && p.valorNuevo != null) {
    const pct = Math.round(((p.valorNuevo - p.valorActual) / p.valorActual) * 100)
    return { texto: `${pct >= 0 ? '+' : ''}${pct} % ${p.tipo === 'puja' ? 'de puja' : 'de presupuesto diario'}`, tono: pct >= 0 ? 'verde' : 'ambar' }
  }
  return null
}

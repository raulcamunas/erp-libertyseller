/**
 * LOS CASOS DE CUMPLIMIENTO NORMATIVO — PURO (sin red ni base), para probarlo en casos.prueba.ts.
 *
 * Un caso es uno abierto con Ayuda al vendedor de Amazon. Quien lo da de alta escribe su ID a mano: es lo que une el caso con los correos
 * de Amazon que llegan al buzón vigilado, sea cual sea el formato del asunto («[ID del caso 17123456781]», «Case 17123456781»…). Se busca
 * el número entero, nunca dentro de otro número más largo.
 */

export type EstadoDeCaso = 'abierto' | 'esperando_amazon' | 'esperando_cliente' | 'resuelto'

export const ESTADOS_DE_CASO: ReadonlyArray<{ id: EstadoDeCaso; nombre: string; tono: 'azul' | 'ambar' | 'violeta' | 'verde' }> = [
  { id: 'abierto', nombre: 'Abierto', tono: 'azul' },
  { id: 'esperando_amazon', nombre: 'Esperando a Amazon', tono: 'ambar' },
  { id: 'esperando_cliente', nombre: 'Esperando al cliente', tono: 'violeta' },
  { id: 'resuelto', nombre: 'Resuelto', tono: 'verde' },
]

export const esEstadoDeCaso = (v: unknown): v is EstadoDeCaso => ESTADOS_DE_CASO.some((e) => e.id === v)

/** Un correo de Amazon colgado de un caso, tal como lo ve la pantalla (sin el cuerpo: ese se pide al abrirlo) */
export interface CorreoDeCaso {
  id: string
  de: string
  asunto: string
  fecha: string
  vistaPrevia: string
  adjuntos: number
}

export interface CasoTC {
  id: string
  clienteId: string
  casoAmazon: string
  titulo: string
  estado: EstadoDeCaso
  responsable: string | null
  notas: string
  creadoPor: string | null
  creadoEn: string
  actualizadoEn: string
  ultimoCorreoEn: string | null
  correos: CorreoDeCaso[]
}

/**
 * EL ID DEL CASO, LIMPIO, O null SI NO LO PARECE.
 *
 * Se quitan espacios, guiones y el «#» de delante que se pega al copiarlo. Solo cifras, de 6 a 20: los de Ayuda al vendedor son números
 * largos (hoy, de 10 u 11 cifras); con menos de 6 saldría en cualquier correo.
 */
export function normalizarIdDeCaso(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const limpio = String(v).trim().replace(/^#/, '').replace(/[\s-]/g, '')
  return /^\d{6,20}$/.test(limpio) ? limpio : null
}

/** ¿Este texto nombra este caso? El número entero, sin cifras pegadas delante ni detrás («171234567812» no es el caso «17123456781») */
export function nombraElCaso(texto: string | null | undefined, idCaso: string): boolean {
  if (!texto || !idCaso) return false
  let desde = 0
  for (;;) {
    const i = texto.indexOf(idCaso, desde)
    if (i < 0) return false
    const antes = i > 0 ? texto[i - 1] : ''
    const despues = texto[i + idCaso.length] ?? ''
    if (!/\d/.test(antes) && !/\d/.test(despues)) return true
    desde = i + 1
  }
}

/** Los casos a los que pertenece un correo, mirando el asunto y el texto */
export function casosDelCorreo<C extends { id: string; casoAmazon: string }>(correo: { asunto: string | null; texto: string | null }, casos: readonly C[]): C[] {
  return casos.filter((c) => nombraElCaso(correo.asunto, c.casoAmazon) || nombraElCaso(correo.texto, c.casoAmazon))
}

/** ¿Este buzón se vigila? Los elegidos; si no se ha elegido ninguno, los que empiezan por «business@» */
export function buzonVigilado(buzon: { id: string; direccion: string }, elegidos: readonly string[]): boolean {
  if (elegidos.length > 0) return elegidos.includes(buzon.id)
  return buzon.direccion.trim().toLowerCase().startsWith('business@')
}

/** Los abiertos primero (los que esperan a Amazon después), los resueltos al final; dentro, lo que ha movido algo más reciente arriba */
export function ordenarCasos<C extends Pick<CasoTC, 'estado' | 'actualizadoEn' | 'ultimoCorreoEn'>>(casos: readonly C[]): C[] {
  const peso: Record<EstadoDeCaso, number> = { abierto: 0, esperando_cliente: 1, esperando_amazon: 2, resuelto: 3 }
  const reciente = (c: C) => Math.max(Date.parse(c.actualizadoEn) || 0, Date.parse(c.ultimoCorreoEn ?? '') || 0)
  return [...casos].sort((a, b) => peso[a.estado] - peso[b.estado] || reciente(b) - reciente(a))
}

/** El texto del aviso en #cumplimiento-normativo (formato del chat: **negrita**, y el enlace se reconoce solo) */
export function avisoDeCorreo(args: { cliente: string; casoAmazon: string; titulo: string; de: string; asunto: string; vistaPrevia: string; enlace: string }): string {
  const vista = args.vistaPrevia.replace(/\s+/g, ' ').trim().slice(0, 280)
  return [
    `📨 **${args.cliente} · caso ${args.casoAmazon}**: ha llegado un correo`,
    `**${args.asunto || '(sin asunto)'}** — ${args.de}`,
    vista ? `> ${vista}${args.vistaPrevia.length > 280 ? '…' : ''}` : '',
    `${args.titulo} · ${args.enlace}`,
  ]
    .filter(Boolean)
    .join('\n')
}

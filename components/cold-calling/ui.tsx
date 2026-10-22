import { CalendarClock, CheckCircle2, Circle, Flame, Mail, PhoneMissed, XCircle, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { COLD_NIVEL_LABELS, type ColdLead, type ColdLeadStatus, esTiendaOnline } from '@/lib/types/cold-leads'

/**
 * LAS PIEZAS VISUALES COMUNES DE COLD CALLING: el glifo de cada estado, las insignias de lista y de nivel.
 *
 * El estado se dice con FORMA (un icono distinto por estado), con PALABRA (su nombre, en el título y donde cabe) y solo al final con
 * color. Los colores son los del Excel que usaba el equipo —amarillo no contesta, cian programado, magenta info enviada, naranja
 * seguimiento, verde cualificada, rojo descartado—, pero salen de los tokens del ERP (`--ls-e-*`, lib/estilo/denso.ts) y por eso valen
 * en los dos temas y nunca hay un color suelto.
 */

export const ESTADO_VISUAL: Record<ColdLeadStatus, { icono: LucideIcon; tono: TonoEstado }> = {
  pendiente: { icono: Circle, tono: 'gris' },
  no_contesta: { icono: PhoneMissed, tono: 'ambar' },
  programado: { icono: CalendarClock, tono: 'cian' },
  email_enviado: { icono: Mail, tono: 'magenta' },
  seguimiento: { icono: Flame, tono: 'naranja' },
  cita_cualificada: { icono: CheckCircle2, tono: 'verde' },
  no_interesa: { icono: XCircle, tono: 'rojo' },
}

/** El icono de un estado en el color de su estado */
export function GlifoDeEstado({ estado, tamano = 14, className = '' }: { estado: ColdLeadStatus; tamano?: number; className?: string }) {
  const { icono: Icono, tono } = ESTADO_VISUAL[estado]
  return <Icono aria-hidden className={`shrink-0 ${className}`} style={{ color: COLOR_ESTADO[tono], width: tamano, height: tamano }} />
}

/** Un color suave del tono, para fondos de insignias y chips: el color al 14 % sobre la superficie */
export const tinte = (tono: TonoEstado, porcentaje = 14) => `color-mix(in srgb, ${COLOR_ESTADO[tono]} ${porcentaje}%, transparent)`

/* ------------------------------------------------------------------ */
/* Listas de origen                                                    */
/* ------------------------------------------------------------------ */

/**
 * Un tono estable por lista, para distinguirlas de un vistazo. Es el mismo reparto que colorForList() de lib/types/cold-leads.ts
 * (mismo hash, mismo orden de seis colores), pero con los tonos del ERP: cada lista sigue teniendo el color de siempre.
 */
const TONOS_DE_LISTA: TonoEstado[] = ['violeta', 'azul', 'ambar', 'magenta', 'cian', 'gris']

export function tonoDeLista(nombre: string | null): TonoEstado {
  if (!nombre) return 'gris'
  let hash = 0
  for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash)
  return TONOS_DE_LISTA[Math.abs(hash) % TONOS_DE_LISTA.length]
}

const INSIGNIA = 'inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-[10.5px] font-medium leading-none'

export function InsigniaDeLista({ nombre, titulo = 'Lista del Excel de la que viene este lead' }: { nombre: string; titulo?: string }) {
  const tono = tonoDeLista(nombre)
  return (
    <span title={titulo} className={INSIGNIA} style={{ color: COLOR_ESTADO[tono], background: tinte(tono) }}>
      {nombre}
    </span>
  )
}

/** El nivel de prioridad de una tienda de la lista nueva: 1 potencial alto, 2 muy buenos números, 3 lead correcto */
export const TONO_DE_NIVEL: Record<number, TonoEstado> = { 1: 'verde', 2: 'ambar', 3: 'gris' }

export function InsigniaDeNivel({ nivel, corta = false }: { nivel: number; corta?: boolean }) {
  const tono = TONO_DE_NIVEL[nivel] ?? 'gris'
  return (
    <span title={`Nivel ${nivel} · ${COLD_NIVEL_LABELS[nivel] ?? ''}`} className={INSIGNIA} style={{ color: COLOR_ESTADO[tono], background: tinte(tono) }}>
      {corta ? `N${nivel}` : `Nivel ${nivel} · ${COLD_NIVEL_LABELS[nivel] ?? ''}`}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Cifras                                                              */
/* ------------------------------------------------------------------ */

/**
 * La cifra que acompaña al nombre en la lista. En un vendedor de Amazon es su facturación mensual («80 k€»); en una tienda online
 * NO hay facturación —su cifra son dólares estimados por un modelo de tráfico, que no se dicen en la llamada—, así que lo que sale
 * es su nivel, que es su criterio de prioridad. Esa cifra se queda en la ficha, donde cabe la advertencia.
 */
export function CifraDeLista({ lead }: { lead: Pick<ColdLead, 'tipo_lead' | 'nivel' | 'revenue_monthly'> }) {
  if (esTiendaOnline(lead)) return lead.nivel != null ? <InsigniaDeNivel nivel={lead.nivel} corta /> : null
  if (lead.revenue_monthly == null) return null
  const n = Number(lead.revenue_monthly)
  return <span className="shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">{n >= 1000 ? `${Math.round(n / 1000).toLocaleString('es-ES')} k€` : `${Math.round(n)} €`}</span>
}

/** Una tecla del teclado, para las pistas de atajos */
export function Tecla({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-1 font-sans text-[10px] font-medium text-[var(--ls-t3)]">{children}</kbd>
}

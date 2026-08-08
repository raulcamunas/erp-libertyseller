'use client'

/**
 * LOS ESTADOS, CON TRES CANALES Y EN ESTE ORDEN: forma, palabra y color.
 *
 * El color es el tercero, nunca el único. Un 8 % de los hombres no distingue
 * rojo de verde, y el equipo comercial mira estas siete etiquetas todo el día.
 *
 * Lo que hoy SÍ está bien y se conserva: la etiqueta siempre lleva palabra en
 * español y hay una frase que explica cada estado. Lo que se añade: un icono
 * distinto por estado, para que la fila se pueda barrer con la vista sin leer.
 * Lo que se quita: el tinte de la fila entera al 8 % de alfa, que con siete
 * tonos y deuteranopía es el mismo beige siete veces.
 */

import {
  Ban, CalendarCheck, CalendarClock, Circle, Flame, Mail, PhoneMissed,
  Minus, FlaskConical, ShieldAlert, CheckCheck, AlertOctagon,
  type LucideIcon,
} from 'lucide-react'
import type { EstadoLead, Ejecucion } from './datos'

export interface DefEstado {
  etiqueta: string
  /** Qué significa, para que nadie dude al elegir. Del ERP de hoy. */
  pista: string
  icono: LucideIcon
}

export const ESTADOS_LEAD: Record<EstadoLead, DefEstado> = {
  pendiente: { etiqueta: 'Sin contactar', pista: 'Todavía no se ha llamado', icono: Circle },
  no_contesta: { etiqueta: 'No contesta', pista: 'No coge, buzón o cuelga: hay que reintentar', icono: PhoneMissed },
  programado: { etiqueta: 'Rellamada programada', pista: 'Nos ha dado día y hora para volver a llamar', icono: CalendarClock },
  email_enviado: { etiqueta: 'Info enviada', pista: 'Pidió la información por correo y se la mandamos', icono: Mail },
  seguimiento: { etiqueta: 'En seguimiento', pista: 'Muestra interés, hay que insistir', icono: Flame },
  cita_cualificada: { etiqueta: 'Cita cualificada', pista: 'Sesión de consultoría agendada', icono: CalendarCheck },
  no_interesa: { etiqueta: 'No le interesa', pista: 'Descartado: no quiere, ya tiene agencia o no encaja', icono: Ban },
}

export const ORDEN_ESTADOS: EstadoLead[] = [
  'pendiente', 'no_contesta', 'programado', 'email_enviado',
  'seguimiento', 'cita_cualificada', 'no_interesa',
]

type EstadoRun = Ejecucion['estado']

export const ESTADOS_RUN: Record<EstadoRun, DefEstado> = {
  sin_cambios: { etiqueta: 'Sin cambios', pista: 'El fichero es idéntico al anterior', icono: Minus },
  simulacro: { etiqueta: 'Simulacro', pista: 'Se ha calculado todo pero NO se ha mandado nada', icono: FlaskConical },
  frenado: { etiqueta: 'Frenado', pista: 'Ha saltado un freno: no se envió', icono: ShieldAlert },
  enviado: { etiqueta: 'Enviado', pista: 'Los cambios están en Amazon', icono: CheckCheck },
  error: { etiqueta: 'Error', pista: 'No se pudo leer el fichero', icono: AlertOctagon },
}

/** Etiqueta de estado en línea: icono + palabra. Sin caja, para dentro de una tabla. */
export function EstadoLinea({ estado, tam = 13 }: { estado: EstadoLead; tam?: number }) {
  const d = ESTADOS_LEAD[estado]
  const Icono = d.icono
  return (
    <span className={`lsd-estado lsd-e-${estado}`} title={d.pista}>
      <Icono size={tam} strokeWidth={2.25} className="lsd-sincolor" aria-hidden />
      {d.etiqueta}
    </span>
  )
}

/** Pastilla con borde, para fuera de la tabla. */
export function PastillaRun({ estado }: { estado: EstadoRun }) {
  const d = ESTADOS_RUN[estado]
  const Icono = d.icono
  return (
    <span className={`lsd-pastilla lsd-r-${estado}`} title={d.pista}>
      <Icono size={12} strokeWidth={2.5} className="lsd-sincolor" aria-hidden />
      {d.etiqueta}
    </span>
  )
}

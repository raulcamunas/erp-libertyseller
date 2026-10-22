'use client'

import { CalendarCheck, Clock, Mail, MessageCircle, MessageSquareReply, PhoneCall, PhoneIncoming } from 'lucide-react'
import type { ReactNode } from 'react'
import { tiempoHablado, type ActividadDeNotas, type ResumenDeLlamadas } from '@/lib/rendimiento/metricas'

/**
 * LAS CIFRAS DE UN DÍA: las mismas cinco que se apuntaban a mano en el recap, y debajo lo que sale de Rinkel.
 *
 * Llamadas hechas, conversaciones de WhatsApp, conversaciones por correo, respuestas de clientes y citas agendadas.
 * Si la persona no tiene Rinkel vinculado no se pinta un 0 en las llamadas —un cero es una afirmación—, sino
 * un guion con la explicación.
 *
 * WhatsApp y correos cuentan CONVERSACIONES, no apuntes: varias interacciones con el mismo cliente el mismo día son
 * una sola. Debajo de la cifra se ve cuántas interacciones se apuntaron, para que se entienda la diferencia.
 */

interface Props {
  /** «hoy», «ayer» o «el miércoles 21 de octubre»: cómo se llama el día que se está mirando */
  quien: string
  llamadas: ResumenDeLlamadas
  actividad: ActividadDeNotas
  citas: number
  /** Si hay una cuenta de Rinkel de la que leer llamadas */
  conRinkel: boolean
  cargando: boolean
}

const numero = (n: number) => n.toLocaleString('es-ES')

/** «conversaciones · 12 interacciones apuntadas» */
function detalleDeConversaciones(conversaciones: number, apuntes: number): string {
  if (conversaciones === 0) return 'Sin conversaciones'
  return `${conversaciones === 1 ? 'conversación' : 'conversaciones'} · ${numero(apuntes)} ${apuntes === 1 ? 'interacción apuntada' : 'interacciones apuntadas'}`
}

function Tarjeta({
  icono,
  titulo,
  valor,
  detalle,
  destacada = false,
  ayuda,
}: {
  icono: ReactNode
  titulo: string
  valor: string
  detalle: string
  destacada?: boolean
  /** Lo que sale al dejar el ratón encima: para explicar cómo se cuenta */
  ayuda?: string
}) {
  return (
    <div
      title={ayuda}
      className={`relative overflow-hidden rounded-2xl border p-3.5 ${
        destacada ? 'border-white/10 bg-gradient-to-br from-[#FF6600]/[0.13] via-white/[0.03] to-transparent' : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/40 flex items-center gap-1.5">
        <span className="text-[#FF6600]">{icono}</span>
        {titulo}
      </p>
      <p className="text-white font-bold text-[34px] leading-none mt-2 tabular-nums">{valor}</p>
      <p className="text-[11px] text-white/40 mt-1.5 leading-snug min-h-[1.5em]">{detalle}</p>
    </div>
  )
}

export function CifrasDelDia({ quien, llamadas, actividad, citas, conRinkel, cargando }: Props) {
  const sinRinkel = !conRinkel

  const contestadasPorcentaje = llamadas.realizadas > 0 ? Math.round(llamadas.tasaDeContacto * 100) : 0

  return (
    <section className={`space-y-2.5 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-label={`Cifras de ${quien}`}>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
        <Tarjeta
          destacada
          ayuda="Cuenta como contestada la llamada que dura 10 segundos o más: por debajo es un contestador automático y va con las no contestadas"
          icono={<PhoneCall className="h-3 w-3" />}
          titulo="Llamadas hechas"
          valor={sinRinkel ? '—' : numero(llamadas.realizadas)}
          detalle={
            sinRinkel
              ? 'Vincula Rinkel para verlas'
              : llamadas.realizadas === 0
                ? 'Ninguna llamada saliente'
                : `${numero(llamadas.contestadas)} contestadas · ${contestadasPorcentaje} %`
          }
        />
        <Tarjeta
          icono={<MessageCircle className="h-3 w-3" />}
          titulo="WhatsApp"
          valor={numero(actividad.whatsapp)}
          detalle={detalleDeConversaciones(actividad.whatsapp, actividad.whatsappApuntes)}
        />
        <Tarjeta
          icono={<Mail className="h-3 w-3" />}
          titulo="Correos"
          valor={numero(actividad.correos)}
          detalle={detalleDeConversaciones(actividad.correos, actividad.correosApuntes)}
        />
        <Tarjeta
          icono={<MessageSquareReply className="h-3 w-3" />}
          titulo="Respuestas"
          valor={numero(actividad.respuestas)}
          detalle="Clientes que han contestado"
        />
        <Tarjeta icono={<CalendarCheck className="h-3 w-3" />} titulo="Citas agendadas" valor={numero(citas)} detalle="De la Agenda" />
      </div>

      {conRinkel && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[12px] text-white/50">
          <span className="flex items-center gap-1.5">
            <PhoneCall className="h-3 w-3 text-white/30" />
            <span className="text-white/80 font-semibold tabular-nums">{numero(llamadas.conversaciones)}</span>
            conversaciones (más de 1 min)
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-white/30" />
            <span className="text-white/80 font-semibold tabular-nums">{tiempoHablado(llamadas.segundosHablados)}</span>
            al teléfono
          </span>
          <span className="flex items-center gap-1.5">
            <PhoneIncoming className="h-3 w-3 text-white/30" />
            <span className="text-white/80 font-semibold tabular-nums">{numero(llamadas.recibidas)}</span>
            recibidas
          </span>
          {llamadas.numerosDistintos > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-white/80 font-semibold tabular-nums">{numero(llamadas.numerosDistintos)}</span>
              números distintos
            </span>
          )}
        </div>
      )}
    </section>
  )
}

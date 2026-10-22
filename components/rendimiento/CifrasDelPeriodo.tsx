'use client'

import { CalendarCheck, Clock, Mail, MessageCircle, MessageSquareReply, Minus, PhoneCall, PhoneIncoming, TrendingDown, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { contacto, llamadasPorDiaLaborable, variacion, variacionDePuntos, type Comparacion, type ResultadoDePersona, type Variacion } from '@/lib/rendimiento/comparativa'
import { rangoDe, type Periodo } from '@/lib/rendimiento/periodos'
import { tiempoHablado } from '@/lib/rendimiento/metricas'

/**
 * LAS CIFRAS DE UNA PERSONA EN UN PERIODO, CON SU CAMBIO FRENTE A LA REFERENCIA.
 *
 * Las mismas cinco de siempre —llamadas hechas, conversaciones de WhatsApp, conversaciones por correo, respuestas y
 * citas— pero de un día, una semana o un mes, y cada una con lo que ha subido o bajado respecto a la referencia
 * (la semana anterior, el mes anterior, la media de los jueves anteriores…). Si no tiene Rinkel vinculado no se
 * pinta un 0 en las llamadas —un cero es una afirmación—, sino un guion con la explicación.
 *
 * WhatsApp y correos cuentan CONVERSACIONES, no apuntes: varias interacciones con el mismo cliente el mismo día son
 * una sola. Debajo de la cifra se ve cuántas interacciones se apuntaron.
 */

interface Props {
  periodo: Periodo
  hoy: string
  resultado: ResultadoDePersona | null
  comparacion: Comparacion | null
  /** Hay cuenta de Rinkel de la que leer llamadas */
  conRinkel: boolean
  cargando: boolean
  /** Solo en un día: a cuántos números distintos se llamó (sale de las llamadas de ese día) */
  numerosDistintos: number | null
}

const numero = (n: number) => Math.round(n).toLocaleString('es-ES')

function detalleDeConversaciones(conversaciones: number, apuntes: number): string {
  if (conversaciones === 0) return 'Sin conversaciones'
  return `${conversaciones === 1 ? 'conversación' : 'conversaciones'} · ${numero(apuntes)} ${apuntes === 1 ? 'interacción apuntada' : 'interacciones apuntadas'}`
}

/** Lo que ha cambiado, con su color: verde si sube, rojo si baja. En estas cifras más es siempre mejor */
function Cambio({ v, contra }: { v: Variacion | null; contra: string }) {
  if (!v) return null
  if (v.sentido === 'sinBase') {
    return (
      <span title={`Sin referencia: no hay actividad con la que comparar (${contra})`} className="text-[10px] text-white/30 whitespace-nowrap">
        sin referencia
      </span>
    )
  }
  const color = v.sentido === 'sube' ? 'text-emerald-400' : v.sentido === 'baja' ? 'text-red-400' : 'text-white/35'
  const Icono = v.sentido === 'sube' ? TrendingUp : v.sentido === 'baja' ? TrendingDown : Minus
  return (
    <span title={`Comparado con ${contra}`} className={`flex items-center gap-0.5 text-[11px] font-medium whitespace-nowrap ${color}`}>
      <Icono className="h-3 w-3" aria-hidden /> {v.texto}
    </span>
  )
}

function Tarjeta({
  icono,
  titulo,
  valor,
  detalle,
  cambio,
  contra,
  destacada = false,
  ayuda,
}: {
  icono: ReactNode
  titulo: string
  valor: string
  detalle: string
  cambio: Variacion | null
  contra: string
  destacada?: boolean
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
      <div className="flex items-baseline justify-between gap-2 mt-2">
        <p className="text-white font-bold text-[34px] leading-none tabular-nums">{valor}</p>
        <Cambio v={cambio} contra={contra} />
      </div>
      <p className="text-[11px] text-white/40 mt-1.5 leading-snug min-h-[1.5em]">{detalle}</p>
    </div>
  )
}

function Dato({ icono, valor, texto, cambio, contra }: { icono?: ReactNode; valor: string; texto: string; cambio?: Variacion | null; contra?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {icono}
      <span className="text-white/80 font-semibold tabular-nums">{valor}</span>
      {texto}
      {cambio && contra && <Cambio v={cambio} contra={contra} />}
    </span>
  )
}

export function CifrasDelPeriodo({ periodo, hoy, resultado, comparacion, conRinkel, cargando, numerosDistintos }: Props) {
  const actual = resultado?.actual
  const base = resultado?.base ?? null
  const contra = comparacion?.texto ?? 'el periodo anterior'
  const sinRinkel = !conRinkel
  const cambio = (a: number | undefined, b: number | undefined): Variacion | null => (resultado && comparacion && a !== undefined ? variacion(a, base ? (b ?? 0) : null) : null)

  const tasa = actual ? contacto(actual) : 0
  const tasaBase = base ? contacto(base) : null
  const llamadas = actual?.llamadas ?? 0
  const rango = comparacion?.actual ?? rangoDe(periodo)

  return (
    <section className={`space-y-2.5 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-label="Cifras del periodo">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2.5">
        <Tarjeta
          destacada
          ayuda="Cuenta como contestada la llamada que dura 10 segundos o más: por debajo es un contestador automático y va con las no contestadas"
          icono={<PhoneCall className="h-3 w-3" />}
          titulo="Llamadas hechas"
          valor={sinRinkel ? '—' : numero(llamadas)}
          detalle={sinRinkel ? 'Vincula Rinkel para verlas' : llamadas === 0 ? 'Ninguna llamada saliente' : `${numero(actual?.contestadas ?? 0)} contestadas · ${Math.round(tasa * 100)} %`}
          cambio={sinRinkel ? null : cambio(actual?.llamadas, base?.llamadas)}
          contra={contra}
        />
        <Tarjeta
          icono={<MessageCircle className="h-3 w-3" />}
          titulo="WhatsApp"
          valor={numero(actual?.whatsapp ?? 0)}
          detalle={detalleDeConversaciones(actual?.whatsapp ?? 0, actual?.whatsappApuntes ?? 0)}
          cambio={cambio(actual?.whatsapp, base?.whatsapp)}
          contra={contra}
        />
        <Tarjeta
          icono={<Mail className="h-3 w-3" />}
          titulo="Correos"
          valor={numero(actual?.correos ?? 0)}
          detalle={detalleDeConversaciones(actual?.correos ?? 0, actual?.correosApuntes ?? 0)}
          cambio={cambio(actual?.correos, base?.correos)}
          contra={contra}
        />
        <Tarjeta
          icono={<MessageSquareReply className="h-3 w-3" />}
          titulo="Respuestas"
          valor={numero(actual?.respuestas ?? 0)}
          detalle="Clientes que han contestado"
          cambio={cambio(actual?.respuestas, base?.respuestas)}
          contra={contra}
        />
        <Tarjeta
          icono={<CalendarCheck className="h-3 w-3" />}
          titulo="Citas agendadas"
          valor={numero(actual?.citas ?? 0)}
          detalle="De la Agenda"
          cambio={cambio(actual?.citas, base?.citas)}
          contra={contra}
        />
      </div>

      {conRinkel && actual && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[12px] text-white/50">
          <Dato
            icono={<PhoneCall className="h-3 w-3 text-white/30" />}
            valor={numero(actual.conversaciones)}
            texto="conversaciones (más de 1 min)"
            cambio={cambio(actual.conversaciones, base?.conversaciones)}
            contra={contra}
          />
          <Dato
            icono={<Clock className="h-3 w-3 text-white/30" />}
            valor={tiempoHablado(actual.segundos)}
            texto="al teléfono"
          />
          <Dato icono={<PhoneIncoming className="h-3 w-3 text-white/30" />} valor={numero(actual.recibidas)} texto="recibidas" />
          {llamadas > 0 && (
            <Dato valor={`${Math.round(tasa * 100)} %`} texto="de contacto" cambio={comparacion && tasaBase !== null ? variacionDePuntos(tasa, tasaBase) : null} contra={contra} />
          )}
          {periodo.tipo !== 'dia' && comparacion && llamadas > 0 && (
            <Dato valor={numero(llamadasPorDiaLaborable(llamadas, rango, hoy))} texto="llamadas por día laborable" />
          )}
          {periodo.tipo === 'dia' && numerosDistintos !== null && numerosDistintos > 0 && <Dato valor={numero(numerosDistintos)} texto="números distintos" />}
        </div>
      )}

      {comparacion && (
        <p className="px-1 text-[10px] text-white/30">Los cambios comparan con {comparacion.texto}.</p>
      )}
    </section>
  )
}

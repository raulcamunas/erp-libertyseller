'use client'

import { CalendarCheck, Clock, Mail, MessageCircle, MessageSquareReply, Percent, PhoneCall, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatoDe, type DiaDeSemana, type Kpi, type Metrica } from '@/lib/rendimiento/informe'
import { tiempoHablado } from '@/lib/rendimiento/metricas'
import { TarjetaDeCifra } from '../TarjetaDeCifra'

/**
 * LAS OCHO CIFRAS DEL EQUIPO EN LA SEMANA, CADA UNA CON SU CAMBIO Y SUS SIETE DÍAS.
 *
 * Son las mismas tarjetas del panel (cuentan hasta su valor, llevan su cambio en una píldora y sus días en barritas):
 * cada una con los días de esta semana al lado de los de la anterior. Pulsar una cifra enseña esa misma cifra día a
 * día y persona a persona en la tabla de debajo.
 */

interface Props {
  kpis: Kpi[]
  dias: DiaDeSemana[]
  /** Con qué se compara, para el texto que sale al pasar el ratón por el cambio */
  contra: string
  metrica: Metrica
  onElegir: (m: Metrica) => void
}

const ICONO: Record<Kpi['id'], ReactNode> = {
  llamadas: <PhoneCall className="h-3 w-3" />,
  contacto: <Percent className="h-3 w-3" />,
  conversaciones: <Phone className="h-3 w-3" />,
  tiempo: <Clock className="h-3 w-3" />,
  whatsapp: <MessageCircle className="h-3 w-3" />,
  correos: <Mail className="h-3 w-3" />,
  respuestas: <MessageSquareReply className="h-3 w-3" />,
  citas: <CalendarCheck className="h-3 w-3" />,
}

const FORMATO: Record<Kpi['unidad'], (n: number) => string> = {
  n: (n) => Math.round(n).toLocaleString('es-ES'),
  pct: (n) => `${Math.round(n)} %`,
  tiempo: tiempoHablado,
}

export function CifrasDeLaSemana({ kpis, dias, contra, metrica, onElegir }: Props) {
  return (
    <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Cifras de la semana">
      {kpis.map((k, i) => (
        <TarjetaDeCifra
          key={k.id}
          indice={i}
          icono={ICONO[k.id]}
          titulo={k.etiqueta}
          valor={k.bruto}
          formato={FORMATO[k.unidad]}
          sinDato={k.valor === '—'}
          detalle={k.detalle}
          cambio={k.cambio}
          contra={contra}
          seleccionada={k.metrica === metrica}
          destacada={i === 0}
          onClick={() => onElegir(k.metrica)}
          ayuda="Pulsa para ver esta cifra día a día y por persona"
          barras={{ valores: k.diario, anteriores: k.diarioAnterior, etiquetas: dias.map((d) => d.etiqueta), formato: (n) => formatoDe(k.metrica, n) }}
        />
      ))}
    </section>
  )
}

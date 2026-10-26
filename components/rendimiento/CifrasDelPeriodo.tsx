'use client'

import { CalendarCheck, Clock, Mail, MessageCircle, MessageSquareReply, PhoneCall, PhoneIncoming } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import {
  contacto,
  llamadasPorDiaLaborable,
  variacion,
  variacionDePuntos,
  type ClaveDeSerie,
  type Comparacion,
  type ResultadoDePersona,
  type SerieDeCifra,
  type Variacion,
} from '@/lib/rendimiento/comparativa'
import { tiempoHablado } from '@/lib/rendimiento/metricas'
import { rangoDe, type Periodo } from '@/lib/rendimiento/periodos'
import { TarjetaDeCifra } from './TarjetaDeCifra'
import { Delta, Numero } from './ui'

/**
 * LAS CIFRAS DE UNA PERSONA EN UN PERIODO, CON SU CAMBIO FRENTE A LA REFERENCIA.
 *
 * Las mismas cinco de siempre —llamadas hechas, conversaciones de WhatsApp, conversaciones por correo, respuestas y
 * citas— pero de un día, una semana o un mes. Cada una cuenta hasta su valor, lleva en una píldora lo que ha subido o
 * bajado respecto a la referencia (la semana anterior, el mes anterior, la media de los jueves anteriores…) y, a la
 * derecha, sus últimos siete días laborables en barritas. Si no tiene Rinkel vinculado no se pinta un 0 en las
 * llamadas —un cero es una afirmación—, sino un guion con la explicación.
 *
 * WhatsApp, correos y LLAMADAS cuentan CLIENTES, no apuntes ni intentos: varias interacciones con el mismo cliente el mismo
 * día son una sola (a un cliente al que se llama tres veces se le ha llamado una vez ese día; al siguiente día, otra).
 * Debajo de la cifra se ve cuántos apuntes o intentos se hicieron.
 *
 * Con `onAbrir`, cada tarjeta se puede pulsar para ir a la lista que hay detrás de su cifra: las llamadas, o las
 * conversaciones, respuestas y citas con el cliente y el comentario de cada una.
 */

/** Lo que hay detrás de cada tarjeta */
export type DestinoDeTarjeta = 'llamadas' | 'whatsapp' | 'correos' | 'respuestas' | 'citas'

/** El cambio de una cifra, para quien lo importe con el nombre de siempre */
export { Delta as Cambio }

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
  /** Sus últimos siete días laborables de cada cifra, para las barritas */
  series?: Record<ClaveDeSerie, SerieDeCifra> | null
  /** Pulsar una tarjeta. Sin esto las tarjetas son solo para mirar */
  onAbrir?: (destino: DestinoDeTarjeta) => void
}

const numero = (n: number) => Math.round(n).toLocaleString('es-ES')

function detalleDeConversaciones(conversaciones: number, apuntes: number): string {
  if (conversaciones === 0) return 'Sin conversaciones'
  return `${conversaciones === 1 ? '1 conversación' : `${numero(conversaciones)} conversaciones`} · ${numero(apuntes)} ${apuntes === 1 ? 'apunte' : 'apuntes'}`
}

/** Un dato suelto de la tira de debajo de las tarjetas */
function Dato({ icono, valor, texto, cambio, contra, ayuda }: { icono?: ReactNode; valor: ReactNode; texto: string; cambio?: Variacion | null; contra?: string; ayuda?: string }) {
  return (
    <span title={ayuda} className="flex h-8 min-w-[150px] flex-1 items-center gap-1.5 whitespace-nowrap bg-[var(--ls-sup)] px-3 text-[12px] text-[var(--ls-t4)]">
      {icono && <span className="text-[var(--ls-t4)]">{icono}</span>}
      <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{valor}</span>
      <span className="truncate">{texto}</span>
      {cambio && contra && (
        <span className="ml-auto">
          <Delta v={cambio} contra={contra} />
        </span>
      )}
    </span>
  )
}

export function CifrasDelPeriodo({ periodo, hoy, resultado, comparacion, conRinkel, cargando, numerosDistintos, series = null, onAbrir }: Props) {
  const actual = resultado?.actual
  const base = resultado?.base ?? null
  const contra = comparacion?.texto ?? 'el periodo anterior'
  const sinRinkel = !conRinkel
  const cambio = (a: number | undefined, b: number | undefined): Variacion | null => (resultado && comparacion && a !== undefined ? variacion(a, base ? (b ?? 0) : null) : null)
  const barras = (clave: ClaveDeSerie) => (series ? { valores: series[clave].valores, etiquetas: series[clave].etiquetas } : undefined)

  const tasa = actual ? contacto(actual) : 0
  const tasaBase = base ? contacto(base) : null
  const llamadas = actual?.llamadas ?? 0
  const intentos = actual?.intentos ?? llamadas
  const rango = comparacion?.actual ?? rangoDe(periodo)

  return (
    <section className={`space-y-2 transition-opacity duration-300 ${cargando ? 'opacity-60' : ''}`} aria-label="Cifras del periodo">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <TarjetaDeCifra
          destacada
          indice={0}
          ayuda="Cuenta los clientes a los que se llamó: un cliente llamado varias veces el mismo día es una sola llamada (los intentos se ven debajo, en la tira), y al día siguiente vuelve a contar. Cuenta como contestada la llamada que dura 10 segundos o más: por debajo es un contestador automático y va con las no contestadas"
          icono={<PhoneCall className="h-3 w-3" />}
          titulo="Llamadas hechas"
          valor={llamadas}
          sinDato={sinRinkel}
          detalle={
            sinRinkel ? (
              'Vincula Rinkel para verlas'
            ) : llamadas === 0 ? (
              'Ninguna llamada saliente'
            ) : (
              <>
                <span className="block truncate">{`${numero(actual?.contestadas ?? 0)} contestadas · ${Math.round(tasa * 100)} %`}</span>
                {/* Un cliente llamado varias veces el mismo día cuenta una llamada; los intentos se ven debajo, como los apuntes de WhatsApp */}
                {intentos > llamadas && <span className="block truncate">{`${numero(intentos)} ${intentos === 1 ? 'intento' : 'intentos'}`}</span>}
              </>
            )
          }
          cambio={sinRinkel ? null : cambio(actual?.llamadas, base?.llamadas)}
          contra={contra}
          barras={barras('llamadas')}
          onClick={onAbrir && !sinRinkel ? () => onAbrir('llamadas') : undefined}
        />
        <TarjetaDeCifra
          indice={1}
          icono={<MessageCircle className="h-3 w-3" />}
          titulo="WhatsApp"
          valor={actual?.whatsapp ?? 0}
          detalle={detalleDeConversaciones(actual?.whatsapp ?? 0, actual?.whatsappApuntes ?? 0)}
          cambio={cambio(actual?.whatsapp, base?.whatsapp)}
          contra={contra}
          barras={barras('whatsapp')}
          onClick={onAbrir ? () => onAbrir('whatsapp') : undefined}
        />
        <TarjetaDeCifra
          indice={2}
          icono={<Mail className="h-3 w-3" />}
          titulo="Correos"
          valor={actual?.correos ?? 0}
          detalle={detalleDeConversaciones(actual?.correos ?? 0, actual?.correosApuntes ?? 0)}
          cambio={cambio(actual?.correos, base?.correos)}
          contra={contra}
          barras={barras('correos')}
          onClick={onAbrir ? () => onAbrir('correos') : undefined}
        />
        <TarjetaDeCifra
          indice={3}
          icono={<MessageSquareReply className="h-3 w-3" />}
          titulo="Respuestas"
          valor={actual?.respuestas ?? 0}
          detalle="Clientes que han contestado"
          cambio={cambio(actual?.respuestas, base?.respuestas)}
          contra={contra}
          barras={barras('respuestas')}
          onClick={onAbrir ? () => onAbrir('respuestas') : undefined}
        />
        <TarjetaDeCifra
          indice={4}
          icono={<CalendarCheck className="h-3 w-3" />}
          titulo="Citas agendadas"
          valor={actual?.citas ?? 0}
          detalle="De la Agenda"
          cambio={cambio(actual?.citas, base?.citas)}
          contra={contra}
          barras={barras('citas')}
          onClick={onAbrir ? () => onAbrir('citas') : undefined}
        />
      </div>

      {conRinkel && actual && (
        <div className="rend-aparece flex flex-wrap gap-px overflow-hidden rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-linea)]" style={{ '--d': 5 } as CSSProperties}>
          <Dato
            icono={<PhoneCall className="h-3 w-3" />}
            valor={<Numero valor={actual.conversaciones} />}
            texto="conversaciones"
            ayuda="Clientes con una llamada contestada de más de 1 minuto"
            cambio={cambio(actual.conversaciones, base?.conversaciones)}
            contra={contra}
          />
          <Dato icono={<Clock className="h-3 w-3" />} valor={<Numero valor={actual.segundos} formato={tiempoHablado} />} texto="al teléfono" />
          <Dato icono={<PhoneIncoming className="h-3 w-3" />} valor={<Numero valor={actual.recibidas} />} texto="recibidas" />
          {llamadas > 0 && (
            <Dato
              valor={<Numero valor={Math.round(tasa * 100)} formato={(n) => `${Math.round(n)} %`} />}
              texto="de contacto"
              cambio={comparacion && tasaBase !== null ? variacionDePuntos(tasa, tasaBase) : null}
              contra={contra}
            />
          )}
          {periodo.tipo !== 'dia' && comparacion && llamadas > 0 && <Dato valor={<Numero valor={llamadasPorDiaLaborable(llamadas, rango, hoy)} />} texto="llamadas por día laborable" />}
          {periodo.tipo === 'dia' && numerosDistintos !== null && numerosDistintos > 0 && <Dato valor={<Numero valor={numerosDistintos} />} texto="números distintos" />}
        </div>
      )}
    </section>
  )
}

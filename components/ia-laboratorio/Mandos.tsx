'use client'

import { MANDOS, lineasDeAjustes, type AjustesDeWhatsapp, type InfoDeMando } from '@/lib/whatsapp/ia-perfil'
import { Interruptor } from './ui'

/**
 * LOS AJUSTES RÁPIDOS: cuatro mandos de varias opciones y un interruptor.
 *
 * Es la forma más cómoda de calibrar: se mueven con un clic, sin escribir. Y debajo de cada mando se lee, tal cual, la frase que se le dice a la IA con esa opción: nada de
 * adivinar qué hace cada cosa. Cambiar un mando cambia el mensaje de TODOS los casos de prueba (se ve al momento al volver a probar).
 */

interface Props {
  ajustes: AjustesDeWhatsapp
  onCambio: (cambios: Partial<AjustesDeWhatsapp>) => void
  /** Sin poder tocarlos (una versión que ya ha estado en producción) */
  deshabilitado?: boolean
  /** Los de serie, para marcar lo que se ha cambiado */
  serie: AjustesDeWhatsapp
}

export function Mandos({ ajustes, onCambio, deshabilitado, serie }: Props) {
  const lineas = lineasDeAjustes(ajustes)
  const lineaDe = (clave: keyof AjustesDeWhatsapp) => lineas.find((l) => l.clave === clave)?.linea ?? ''

  return (
    <div className="space-y-4">
      {MANDOS.map((m) => (
        <Mando key={m.clave} info={m as InfoDeMando<string>} valor={String(ajustes[m.clave])} deSerie={String(serie[m.clave])} linea={lineaDe(m.clave)} deshabilitado={deshabilitado} onElegir={(v) => onCambio({ [m.clave]: v } as Partial<AjustesDeWhatsapp>)} />
      ))}
      <div className="space-y-1.5 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
        <Interruptor
          marcado={ajustes.variar}
          onCambio={(v) => onCambio({ variar: v })}
          deshabilitado={deshabilitado}
          titulo="Variar la forma de empezar y de cerrar"
          ayuda="Cada mensaje abre y cierra de otra manera, repartida al azar (no en «después de hablar»). WhatsApp castiga el texto repetido."
        />
        {ajustes.variar && <p className="border-l-2 border-[var(--ls-linea2)] pl-2 text-[11.5px] leading-snug text-[var(--ls-t4)]">Le dice a la IA: {lineaDe('variar')}</p>}
      </div>
    </div>
  )
}

function Mando({ info, valor, deSerie, linea, deshabilitado, onElegir }: { info: InfoDeMando<string>; valor: string; deSerie: string; linea: string; deshabilitado?: boolean; onElegir: (v: string) => void }) {
  const id = `mando-${info.clave}`
  return (
    <div role="group" aria-labelledby={id}>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span id={id} className="text-[12.5px] font-semibold text-[var(--ls-t1)]">
          {info.titulo}
        </span>
        <span className="text-[11.5px] text-[var(--ls-t4)]">{info.ayuda}</span>
        {valor !== deSerie && <span className="rounded-[4px] bg-[var(--ls-acc-suave)] px-1.5 py-px text-[10.5px] font-medium text-[var(--ls-t2)]">cambiado</span>}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${info.opciones.length}, minmax(0, 1fr))` }}>
        {info.opciones.map((o) => {
          const activa = o.valor === valor
          return (
            <button
              key={o.valor}
              type="button"
              disabled={deshabilitado}
              onClick={() => onElegir(o.valor)}
              aria-pressed={activa}
              className={`flex flex-col items-start gap-0.5 rounded-[8px] border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)]'
              }`}
            >
              <span className={`text-[12.5px] font-medium ${activa ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t2)]'}`}>{o.etiqueta}</span>
              <span className="text-[11px] leading-tight text-[var(--ls-t4)]">{o.detalle}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 border-l-2 border-[var(--ls-linea2)] pl-2 text-[11.5px] leading-snug text-[var(--ls-t4)]">Le dice a la IA: {linea}</p>
    </div>
  )
}

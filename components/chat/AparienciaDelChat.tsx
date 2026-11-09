'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import { FONDOS_DEL_CHAT, GRUPOS_DE_FONDOS, fondoDelChat, variablesDeFondo, type GrupoDeFondo } from '@/lib/chat/fondos'
import { DENSIDADES, ESTILOS, TEMAS, TEXTOS, type OpcionDeAjuste } from '@/lib/chat/temas'
import { ProbadorDeSonidos } from './ProbadorDeSonidos'
import { useTemaDelChat } from './TemaDelChat'

function Selector<T extends string>({ titulo, opciones, valor, alElegir }: { titulo: string; opciones: ReadonlyArray<OpcionDeAjuste<T>>; valor: T; alElegir: (v: T) => void }) {
  return (
    <fieldset className="chat-ap-grupo">
      <legend>{titulo}</legend>
      <div className="chat-ap-segmentos" role="radiogroup" aria-label={titulo}>
        {opciones.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={valor === o.id} onClick={() => alElegir(o.id)} title={o.detalle}>
            {o.nombre}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Los fondos, por familias y con una muestra de cada uno (se ven con el color del tema elegido) */
function SelectorDeFondos({ valor, alElegir }: { valor: string; alElegir: (id: string) => void }) {
  const [grupo, setGrupo] = useState<GrupoDeFondo>(fondoDelChat(valor)?.grupo ?? 'luces')
  const actual = fondoDelChat(valor)
  return (
    <fieldset className="chat-ap-grupo">
      <legend>Fondo{actual ? ` · ${actual.nombre}` : ''}</legend>
      <div className="chat-ap-segmentos" role="tablist" aria-label="Familias de fondos">
        {GRUPOS_DE_FONDOS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={grupo === g.id} aria-checked={grupo === g.id} onClick={() => setGrupo(g.id)}>{g.nombre}</button>
        ))}
      </div>
      <div className="chat-fondos" role="radiogroup" aria-label="Fondo">
        {FONDOS_DEL_CHAT.filter((f) => f.grupo === grupo).map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={valor === f.id} title={f.nombre} aria-label={f.nombre} className="chat-fondo-muestra" style={variablesDeFondo(f.id) as CSSProperties} onClick={() => alElegir(f.id)}>
            <span>{f.nombre}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** El panel «Apariencia»: tema de color, fondo, estilo de los mensajes, densidad y tamaño del texto. Cada cambio se ve al instante en el chat de detrás */
export function AparienciaDelChat({ onCerrar }: { onCerrar: () => void }) {
  const { ajustes, cambiar, restablecer } = useTemaDelChat()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const alPulsar = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node) && !(e.target as Element).closest('[data-abre-apariencia]')) onCerrar()
    }
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('pointerdown', alPulsar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('pointerdown', alPulsar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [onCerrar])

  return (
    <div className="chat-apariencia" ref={panel} role="dialog" aria-label="Apariencia del chat">
      <header>
        <b>Apariencia</b>
        <button type="button" className="chat-icono" onClick={restablecer} title="Volver a lo de siempre" aria-label="Restablecer la apariencia"><RotateCcw className="h-3.5 w-3.5" /></button>
        <button type="button" className="chat-icono" onClick={onCerrar} aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </header>
      <fieldset className="chat-ap-grupo">
        <legend>Tema</legend>
        <div className="chat-ap-temas" role="radiogroup" aria-label="Tema de color">
          {TEMAS.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={ajustes.tema === t.id} onClick={() => cambiar({ tema: t.id })} style={{ ['--t1' as string]: t.acento, ['--t2' as string]: t.acentoDos }} title={t.nombre}>
              <span className="chat-ap-muestra">{ajustes.tema === t.id && <Check className="h-4 w-4" strokeWidth={3} />}</span>
              <span>{t.nombre}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <SelectorDeFondos valor={ajustes.fondo} alElegir={(fondo) => cambiar({ fondo })} />
      <Selector titulo="Mensajes" opciones={ESTILOS} valor={ajustes.estilo} alElegir={(estilo) => cambiar({ estilo })} />
      <Selector titulo="Densidad" opciones={DENSIDADES} valor={ajustes.densidad} alElegir={(densidad) => cambiar({ densidad })} />
      <Selector titulo="Tamaño del texto" opciones={TEXTOS} valor={ajustes.texto} alElegir={(texto) => cambiar({ texto })} />
      <ProbadorDeSonidos />
      <p className="chat-ap-nota">Solo lo ves tú, en este navegador.</p>
    </div>
  )
}

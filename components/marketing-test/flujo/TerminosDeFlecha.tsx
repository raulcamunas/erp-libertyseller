'use client'

import { useMemo, useState } from 'react'
import { Bot, Cog, FlaskConical, Search, User } from 'lucide-react'
import { Insignia, Segmentado } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { rolCorto, SUMIDERO, type Flujo, type TerminoDeFlujo } from '@/lib/ads/flujo-calculo'
import { decimal, dinero, diaCorto, entero } from '../formato'
import { ChipsDeNodo } from './DiagramaDeFlujo'
import { ESTADO_DE_TERMINO, VEREDICTO, cuentasDeFlecha, fechaCorta, nombreDeFlecha, nombreDeNodo, type Seleccion } from './comun'

type Filtro = 'todo' | 'hecho' | 'propuesto' | 'otro'

/** El título del panel según lo elegido */
export function tituloDeSeleccion(s: Seleccion, flujo: Flujo): { titulo: string; descripcion: string } {
  if (s.tipo === 'flecha') {
    const f = flujo.flechas.find((x) => x.id === s.id)
    if (!f) return { titulo: 'Términos', descripcion: '' }
    return { titulo: nombreDeFlecha(f, flujo), descripcion: `${f.tipo === 'cosecha' ? 'Cosecha' : 'Negativas'} · ${cuentasDeFlecha(f)}` }
  }
  const n = flujo.nodos.find((x) => x.id === s.id)
  if (s.id === SUMIDERO) return { titulo: 'Negativizadas', descripcion: 'Todo lo que se ha excluido (o se propone excluir) en las campañas de este producto' }
  return { titulo: nombreDeNodo(n), descripcion: n?.nombre ?? '' }
}

/** Los términos de lo elegido: los de la flecha o, de una campaña, todo lo que entra, sale o se negativiza en ella */
export function terminosDeSeleccion(s: Seleccion, flujo: Flujo): TerminoDeFlujo[] {
  if (s.tipo === 'flecha') return flujo.terminos.filter((t) => t.flechaId === s.id)
  const ids = new Set(flujo.flechas.filter((f) => f.desde === s.id || f.hacia === s.id).map((f) => f.id))
  return flujo.terminos.filter((t) => ids.has(t.flechaId))
}

const ICONO_QUIEN = { agente: Bot, motor: Cog, persona: User, ensayo: FlaskConical } as const

function quienTexto(t: TerminoDeFlujo): string {
  if (t.quien === 'ensayo') return 'Ensayo'
  if (t.quien === 'agente') return t.persona ? `Agente PPC · ${t.persona}` : 'Agente PPC'
  if (t.quien === 'motor') return t.persona ? `Motor · ${t.persona}` : 'Motor'
  return t.persona ?? 'A mano'
}

/** Cómo está ahora: «En EXACTA desde el 18 nov: 12 clics, 2 pedidos», «Negativa activa», «Caducada: …» */
function estadoActual(t: TerminoDeFlujo, flujo: Flujo, moneda: string | null): string {
  const f = flujo.flechas.find((x) => x.id === t.flechaId)
  const destino = f ? nombreDeNodo(flujo.nodos.find((n) => n.id === f.hacia)) : ''
  const cosecha = f?.tipo === 'cosecha'
  switch (t.estado) {
    case 'hecho':
      if (cosecha) {
        if (!t.despues) return `En ${destino} desde el ${fechaCorta(t.fecha).split(',')[0]}${t.negativizadoEnOrigen ? ', y excluida en el origen' : ''}`
        return `En ${destino} desde el ${diaCorto(t.despues.desde)}: ${entero(t.despues.clics)} ${t.despues.clics === 1 ? 'clic' : 'clics'}, ${entero(t.despues.pedidos)} ${t.despues.pedidos === 1 ? 'pedido' : 'pedidos'}${t.despues.gasto ? `, ${dinero(t.despues.gasto, moneda)} gastados` : ''}${t.negativizadoEnOrigen ? ' · excluida en el origen' : ''}`
      }
      return 'Negativa activa: ya no aparece en esas búsquedas'
    case 'deshecho':
      return 'Deshecho: se ha quitado de Amazon'
    case 'fallido':
      return 'Amazon no lo aceptó: no se ha hecho'
    case 'pendiente':
      return 'Propuesto, esperando a que alguien lo apruebe (o al agente)'
    case 'caducada':
      return `Caducado sin aplicar${t.motivo ? `: ${t.motivo}` : ''}`
    case 'descartada':
      return 'Descartado: no se va a hacer'
    case 'ensayada':
      return 'Ensayo: se simuló, no se hizo en Amazon'
  }
}

function FichaDeTermino({ t, flujo, moneda }: { t: TerminoDeFlujo; flujo: Flujo; moneda: string | null }) {
  const est = ESTADO_DE_TERMINO[t.estado]
  const Icono = ICONO_QUIEN[t.quien]
  const veredicto = t.veredicto ? VEREDICTO[t.veredicto] : null
  const f = flujo.flechas.find((x) => x.id === t.flechaId)
  return (
    <li className="flex flex-col gap-2 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3" style={{ borderLeft: `3px solid ${COLOR_ESTADO[est.tono]}` }}>
      <div className="flex flex-wrap items-center gap-[6px]">
        <span className="min-w-0 break-words text-[14px] font-semibold text-[var(--ls-t1)]">{t.esAsin ? t.termino.toUpperCase() : `"${t.termino}"`}</span>
        <Insignia tono={est.tono} tamano="sm">
          {est.texto}
        </Insignia>
        {t.concordancia && (
          <Insignia tono="gris" tamano="sm" variante="contorno">
            {t.concordancia === 'producto' ? 'ASIN' : t.concordancia}
          </Insignia>
        )}
        {veredicto && (
          <Insignia tono={veredicto.tono} tamano="sm" variante="contorno">
            {veredicto.texto}
          </Insignia>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ls-t3)]">
        <span className="tabular-nums">{fechaCorta(t.fecha)}</span>
        <span className="inline-flex items-center gap-1">
          <Icono className="h-[12px] w-[12px]" aria-hidden />
          {quienTexto(t)}
        </span>
        {f && <span className="text-[var(--ls-t4)]">{nombreDeFlecha(f, flujo)}</span>}
      </div>
      {t.antes && (
        <div className="text-[12.5px] tabular-nums text-[var(--ls-t2)]">
          <span className="text-[var(--ls-t4)]">Lo que lo justificó: </span>
          {entero(t.antes.clics)} {t.antes.clics === 1 ? 'clic' : 'clics'} · {entero(t.antes.pedidos)} {t.antes.pedidos === 1 ? 'pedido' : 'pedidos'} · {dinero(t.antes.gasto, moneda)} gastados
          {t.antes.ventas > 0 ? ` · ${dinero(t.antes.ventas, moneda)} en ventas` : ''}
          {t.antes.acosPct != null ? ` · ACoS ${decimal(t.antes.acosPct, 1)} %` : ''}
        </div>
      )}
      {t.motivo && t.estado !== 'caducada' && <p className="break-words text-[12.5px] leading-[1.45] text-[var(--ls-t3)]">{t.motivo}</p>}
      <div className="rounded-[8px] bg-[var(--ls-sup2)] px-2 py-[6px] text-[12.5px] text-[var(--ls-t2)]">{estadoActual(t, flujo, moneda)}</div>
    </li>
  )
}

/**
 * EL CONTENIDO DEL PANEL LATERAL de una flecha o de una campaña del flujo: cada término con su fecha, quién, por qué (con las cifras que lo justificaron) y cómo está
 * ahora (lo que lleva en su campaña nueva, si sigue la negativa, si se deshizo o por qué caducó) y, si se ha medido, el resultado.
 */
export function TerminosDeFlecha({ seleccion, flujo, moneda }: { seleccion: Seleccion; flujo: Flujo; moneda: string | null }) {
  const [filtro, setFiltro] = useState<Filtro>('todo')
  const [busqueda, setBusqueda] = useState('')
  const todos = useMemo(() => terminosDeSeleccion(seleccion, flujo), [seleccion, flujo])
  const cuenta = (f: Filtro) => todos.filter((t) => encaja(t, f)).length
  const lista = todos.filter((t) => encaja(t, filtro) && (!busqueda.trim() || t.termino.toLowerCase().includes(busqueda.trim().toLowerCase())))
  const nodo = seleccion.tipo === 'nodo' && seleccion.id !== SUMIDERO ? flujo.nodos.find((n) => n.id === seleccion.id) : null

  return (
    <div className="flex flex-col gap-3">
      {nodo && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-[var(--ls-sup2)] p-3 text-[12.5px] text-[var(--ls-t2)]">
          <span>
            {rolCorto(nodo.rol)}: {nodo.entran} {nodo.entran === 1 ? 'término ha entrado' : 'términos han entrado'}, {nodo.salen} {nodo.salen === 1 ? 'ha salido' : 'han salido'} a otra campaña y {nodo.negativas} {nodo.negativas === 1 ? 'se ha negativizado' : 'se han negativizado'}.
          </span>
          <span className="flex flex-wrap gap-1">
            <ChipsDeNodo n={nodo} moneda={moneda} />
          </span>
        </div>
      )}
      <Segmentado
        etiqueta="Qué términos ver"
        tamano="sm"
        valor={filtro}
        onCambio={setFiltro}
        opciones={[
          { id: 'todo', texto: 'Todos', cuenta: todos.length },
          { id: 'hecho', texto: 'Hechos', cuenta: cuenta('hecho') },
          { id: 'propuesto', texto: 'Sin aplicar', cuenta: cuenta('propuesto') },
          { id: 'otro', texto: 'Deshechos o fallidos', cuenta: cuenta('otro') },
        ]}
      />
      {todos.length > 8 && (
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar un término…" className={`${CAMPO.input} min-h-[36px] w-full pl-9 text-[13.5px] [@media(pointer:coarse)]:min-h-[44px]`} aria-label="Buscar un término" />
        </label>
      )}
      {lista.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--ls-t3)]">{todos.length === 0 ? 'Aquí no hay ningún término en estos días.' : 'Ningún término con este filtro.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.slice(0, 300).map((t) => (
            <FichaDeTermino key={t.id} t={t} flujo={flujo} moneda={moneda} />
          ))}
          {lista.length > 300 && <li className="text-center text-[12px] text-[var(--ls-t4)]">Y {lista.length - 300} más: busca uno concreto arriba.</li>}
        </ul>
      )}
    </div>
  )
}

function encaja(t: TerminoDeFlujo, f: Filtro): boolean {
  if (f === 'todo') return true
  if (f === 'hecho') return t.estado === 'hecho'
  if (f === 'propuesto') return t.estado === 'pendiente' || t.estado === 'caducada' || t.estado === 'descartada' || t.estado === 'ensayada'
  return t.estado === 'deshecho' || t.estado === 'fallido'
}

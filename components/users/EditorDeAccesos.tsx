'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Search, SearchX, Sparkles, UserPen } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { EstadoVacio, Insignia } from '@/components/ui-ls'
import { CASILLAS, GRUPOS_DE_CASILLAS, casillaCoincide, origenDeCasilla, type CasillaDePermiso } from '@/lib/usuarios/casillas'
import { CAMPO, Interruptor } from './piezas'

/**
 * LOS ACCESOS DE UNA PERSONA, AGRUPADOS COMO EL MENÚ.
 *
 * Cada casilla lleva su icono, su nombre, su descripción a la vista (antes solo en un tooltip) y un interruptor grande. Cada grupo tiene su propio interruptor (enciende o
 * apaga todo el grupo) y se puede plegar. Arriba, un buscador. Las marcadas dicen de dónde salen: «del puesto» (las pre-marca el rol elegido) o «a mano». Las que no hacen nada
 * salen apagadas y con el motivo escrito.
 *
 * No guarda nada: cambia `marcadas` y la ficha decide cuándo se guarda.
 */
export function EditorDeAccesos({ marcadas, onCambiar, puesto }: { marcadas: ReadonlySet<string>; onCambiar: (siguiente: Set<string>) => void; puesto: string | null }) {
  const [busqueda, setBusqueda] = useState('')
  const [plegados, setPlegados] = useState<Set<string>>(new Set())

  const grupos = useMemo(
    () =>
      GRUPOS_DE_CASILLAS.map((g) => ({ ...g, casillas: CASILLAS.filter((c) => c.grupo === g.id && casillaCoincide(c, busqueda)) })).filter((g) => g.casillas.length > 0),
    [busqueda],
  )

  const total = CASILLAS.filter((c) => !c.sinEfecto && marcadas.has(c.id)).length

  const poner = (ids: readonly string[], valor: boolean) => {
    const sig = new Set(marcadas)
    for (const id of ids) {
      if (valor) sig.add(id)
      else sig.delete(id)
    }
    onCambiar(sig)
  }

  const plegar = (id: string) =>
    setPlegados((p) => {
      const s = new Set(p)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar un acceso…"
            aria-label="Buscar un acceso"
            className={cn(CAMPO, 'pl-9')}
          />
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-[var(--ls-t3)]">
          {total} {total === 1 ? 'acceso concedido' : 'accesos concedidos'}
        </span>
      </div>

      {grupos.length === 0 && <EstadoVacio compacto icono={SearchX} titulo="Ningún acceso se llama así" descripcion="Prueba con otra palabra: se busca en el nombre y en la descripción." accion={{ texto: 'Borrar la búsqueda', onClick: () => setBusqueda('') }} />}

      {grupos.map((g) => {
        const utiles = g.casillas.filter((c) => !c.sinEfecto)
        const encendidas = utiles.filter((c) => marcadas.has(c.id)).length
        const todo = utiles.length > 0 && encendidas === utiles.length
        const plegado = plegados.has(g.id) && !busqueda
        const Icono = g.icono
        return (
          <section key={g.id} className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]" aria-label={g.nombre}>
            <header className="flex items-center gap-3 bg-[linear-gradient(180deg,var(--ls-velo),transparent)] py-1 pl-3 pr-1">
              <button
                type="button"
                onClick={() => plegar(g.id)}
                aria-expanded={!plegado}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                  style={{ background: 'color-mix(in srgb, var(--ls-mod-personas) 16%, transparent)', color: 'var(--ls-mod-personas)' }}
                >
                  <Icono className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{g.nombre}</span>
                  <span className="block text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                    {encendidas} de {utiles.length}
                  </span>
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform', plegado && '-rotate-90')} aria-hidden />
              </button>
              {utiles.length > 0 && (
                <Interruptor
                  etiqueta={`${todo ? 'Quitar' : 'Dar'} todo ${g.nombre}`}
                  activo={todo}
                  mixto={!todo && encendidas > 0}
                  onCambio={() => poner(utiles.map((c) => c.id), !todo)}
                />
              )}
            </header>
            <AnimatePresence initial={false}>
              {!plegado && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="divide-y divide-[var(--ls-linea)] border-t border-[var(--ls-linea)]"
                >
                  {g.casillas.map((c) => (
                    <FilaDeCasilla key={c.id} casilla={c} marcada={marcadas.has(c.id)} puesto={puesto} onCambio={(v) => poner([c.id], v)} />
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </section>
        )
      })}
    </div>
  )
}

function FilaDeCasilla({ casilla: c, marcada, puesto, onCambio }: { casilla: CasillaDePermiso; marcada: boolean; puesto: string | null; onCambio: (v: boolean) => void }) {
  const origen = origenDeCasilla(c.id, marcada, puesto)
  const Icono = c.icono
  return (
    <li className={cn('flex items-start gap-3 py-2 pl-3 pr-1 transition-colors', marcada && !c.sinEfecto && 'bg-[color-mix(in_srgb,var(--ls-mod-personas)_5%,transparent)]')}>
      <span
        className={cn('mt-[10px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[var(--ls-linea)]', marcada && !c.sinEfecto ? 'text-[var(--ls-mod-personas)]' : 'text-[var(--ls-t4)]')}
        aria-hidden
      >
        <Icono className="h-[15px] w-[15px]" />
      </span>
      <div className="min-w-0 flex-1 py-[6px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('text-[13.5px] font-medium', c.sinEfecto ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]')}>{c.nombre}</span>
          {origen === 'puesto' && (
            <Insignia tono="violeta" tamano="sm" icono={Sparkles} title="Lo marca el rol o puesto elegido">
              del puesto
            </Insignia>
          )}
          {origen === 'mano' && !c.sinEfecto && (
            <Insignia tono="gris" variante="contorno" tamano="sm" icono={UserPen} title="Añadido a mano, fuera de lo que marca el puesto">
              a mano
            </Insignia>
          )}
        </div>
        <p className={cn('mt-[2px] text-[12px] leading-snug', c.sinEfecto ? 'text-[var(--ls-e-ambar)]' : 'line-clamp-2 text-[var(--ls-t3)]')} title={c.sinEfecto ? undefined : c.descripcion}>
          {c.sinEfecto ?? c.descripcion}
        </p>
      </div>
      <Interruptor etiqueta={c.nombre} activo={marcada} deshabilitado={!!c.sinEfecto} onCambio={onCambio} />
    </li>
  )
}

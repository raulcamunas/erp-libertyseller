'use client'

import { Inbox, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Avatar, ChipDeFiltro, Esqueleto, PANEL, Revelar } from '@/components/rendimiento/ui'
import { CAMPO, BOTON_SECUNDARIO } from '../ui'
import type { TonoDeEstado } from '@/lib/correo/secuencias/vistas'
import { useCola, useRecien, type FiltroDeCola, type Tablero } from './datos'
import { LineaMini } from './LineaDeTiempo'

/**
 * LA COLA: CADA LEAD QUE ESTÁ EN UNA SECUENCIA, CON SU LÍNEA DE TIEMPO.
 *
 * Los que siguen en marcha, ordenados por lo que antes va a salir; los que ya terminaron, por fecha. Se puede buscar por el nombre del lead o por su
 * dirección. Cada fila enseña el estado y la línea de tiempo (el primer correo, los seguimientos y cómo acaba o acabará); al pulsarla se abre el detalle con
 * los textos y el rastro. La lista se refresca sola cada 30 segundos y, si un correo sale mientras se mira, su nodo hace un destello verde.
 */

interface Props {
  filtro: FiltroDeCola
  onFiltro: (f: FiltroDeCola) => void
  tablero: Tablero | null
  ahora: number
  onAbrir: (id: string) => void
  activa: boolean
}

export function ChipDeEstado({ tono, children }: { tono: TonoDeEstado; children: ReactNode }) {
  const color = tono === 'marcha' ? 'var(--ls-acc)' : tono === 'espera' ? 'var(--ls-e-ambar)' : tono === 'bien' ? 'var(--ls-e-verde)' : tono === 'mal' ? 'var(--ls-e-rojo)' : 'var(--ls-t3)'
  return (
    <span className="inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[10.5px] font-semibold" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      {tono === 'marcha' && <span className="sec-ahora h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />}
      {children}
    </span>
  )
}

export function ColaDeLeads({ filtro, onFiltro, tablero, ahora, onAbrir, activa }: Props) {
  const cola = useCola(filtro, activa)
  const [texto, setTexto] = useState(filtro.q)
  // La búsqueda espera a que se deje de teclear
  useEffect(() => {
    const t = setTimeout(() => texto !== filtro.q && onFiltro({ ...filtro, q: texto }), 350)
    return () => clearTimeout(t)
  }, [texto, filtro, onFiltro])

  const vistos = useMemo(() => cola.items.flatMap((i) => i.pasos.map((p) => ({ id: p.id, enviado: p.estado === 'enviado' }))), [cola.items])
  const recien = useRecien(vistos)
  const c = tablero?.conteos
  const vivas = (c?.activa ?? 0) + (c?.pausada ?? 0)
  const terminadas = c ? c.respondida + c.parada + c.completada + c.sin_respuesta + c.cancelada : 0
  const buzones = tablero?.buzones ?? []

  return (
    <section className={PANEL} aria-label="Cola de secuencias">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ls-linea)] px-3 py-2">
        <ChipDeFiltro activo={filtro.grupo === 'vivas'} onClick={() => onFiltro({ ...filtro, grupo: 'vivas' })}>
          En marcha <span className="tabular-nums text-[var(--ls-t4)]">{vivas}</span>
        </ChipDeFiltro>
        <ChipDeFiltro activo={filtro.grupo === 'terminadas'} onClick={() => onFiltro({ ...filtro, grupo: 'terminadas' })}>
          Terminadas <span className="tabular-nums text-[var(--ls-t4)]">{terminadas}</span>
        </ChipDeFiltro>
        <ChipDeFiltro activo={filtro.grupo === 'todas'} onClick={() => onFiltro({ ...filtro, grupo: 'todas' })}>
          Todas
        </ChipDeFiltro>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {buzones.length > 1 && (
            <select value={filtro.buzonId ?? ''} onChange={(e) => onFiltro({ ...filtro, buzonId: e.target.value || null })} aria-label="Buzón" className={`${CAMPO} !h-7 !w-auto !px-2 !text-[12px]`}>
              <option value="">Todos los buzones</option>
              {buzones.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.propietario.nombre}
                </option>
              ))}
            </select>
          )}
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
            <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar lead o dirección…" aria-label="Buscar en la cola" className={`${CAMPO} !h-7 !w-[200px] !pl-7 !pr-6 !text-[12px]`} />
            {texto && (
              <button type="button" onClick={() => setTexto('')} aria-label="Borrar la búsqueda" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </label>
        </div>
      </div>

      {cola.error && <p className="px-3 py-3 text-[12.5px] text-[var(--ls-e-ambar)]">{cola.error}</p>}

      {cola.cargando && cola.items.length === 0 ? (
        <div className="space-y-2 p-3" aria-busy="true" aria-label="Cargando la cola">
          <Esqueleto className="h-16 w-full" />
          <Esqueleto className="h-16 w-full" />
          <Esqueleto className="h-16 w-full" />
        </div>
      ) : cola.items.length === 0 && !cola.error ? (
        <div className="px-6 py-12 text-center">
          <Inbox className="mx-auto h-6 w-6 text-[var(--ls-t4)]" aria-hidden />
          <p className="mt-2 text-[13px] font-medium text-[var(--ls-t2)]">{filtro.q ? 'No hay nada con esa búsqueda' : filtro.grupo === 'vivas' ? 'No hay ninguna secuencia en marcha' : 'No hay secuencias que mostrar'}</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--ls-t4)]">
            {filtro.q ? 'Prueba con otra parte del nombre o de la dirección.' : 'Cuando un comercial envíe un correo con los seguimientos automáticos activados, el lead aparecerá aquí con su línea de tiempo.'}
          </p>
        </div>
      ) : (
        <ul>
          {cola.items.map((item, i) => (
            <li key={item.id}>
              <Revelar i={Math.min(i, 10)}>
                <button type="button" onClick={() => onAbrir(item.id)} className="grid w-full gap-x-6 gap-y-2.5 border-b border-[var(--ls-linea)] px-3 py-3 text-left transition-colors hover:bg-[var(--ls-sup2)] md:grid-cols-[minmax(0,230px)_minmax(0,1fr)]">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-[var(--ls-t1)]">{item.lead.nombre}</span>
                      <ChipDeEstado tono={item.tono}>{item.etiquetaDeEstado}</ChipDeEstado>
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[var(--ls-t3)]">{item.destinatario}</span>
                    {!item.propio && (
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
                        <Avatar id={item.buzonId} nombre={item.propietario} tamano={16} /> {item.propietario}
                      </span>
                    )}
                    {item.motivo && item.tono !== 'marcha' && item.tono !== 'neutro' && <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-[var(--ls-t4)]">{item.motivo}</span>}
                  </span>
                  <span className="min-w-0 overflow-x-auto pb-1">
                    <LineaMini item={item} ahora={ahora} recien={recien} />
                  </span>
                </button>
              </Revelar>
            </li>
          ))}
        </ul>
      )}

      {cola.hayMas && (
        <div className="flex justify-center p-3">
          <button type="button" onClick={cola.masPaginas} className={BOTON_SECUNDARIO}>
            Ver más ({cola.total - cola.items.length} más)
          </button>
        </div>
      )}
    </section>
  )
}

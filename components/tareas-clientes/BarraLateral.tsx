'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight, Home, KanbanSquare, LayoutGrid, Search, Star, UserCheck } from 'lucide-react'
import { ETIQUETA_DE_GRUPO, estadosDe, type ClienteTC, type GrupoDeCliente } from '@/lib/tareas-clientes/tipos'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { colorValido } from '@/lib/tareas-clientes/colores'
import type { Ambito } from '@/lib/tareas-clientes/ambito'

/**
 * LA COLUMNA DE LA IZQUIERDA: de un vistazo, todos los clientes con lo que les queda por hacer, «Todas las tareas», «Mis tareas» y tus favoritos. Plegada, se queda en una
 * fila de iconos. El número de cada cliente son sus tareas sin terminar; en rojo si alguna ya está vencida.
 */

export type { Ambito }

const ORDEN_DE_GRUPOS: GrupoDeCliente[] = ['agencia', 'marcas_eeuu', 'otros']

/**
 * EL SELECTOR DEL MÓVIL: por debajo de 860 px la columna de clientes se esconde (no cabe), y esto es su sustituto: una lista desplegable con el inicio, «Todas», «Mis tareas» y
 * los clientes por grupos. Es el desplegable nativo del teléfono, que es lo que mejor se maneja con el pulgar.
 */
export function SelectorMovil({ clientes, ambito, onNavegar }: { clientes: readonly ClienteTC[]; ambito: Ambito; onNavegar: (ruta: string) => void }) {
  const valor = ambito.tipo === 'cliente' ? ambito.id : ambito.tipo
  return (
    <label className="tc-selector-movil">
      <span className="sr-only">Ir a</span>
      <select
        value={valor}
        onChange={(e) => {
          const v = e.target.value
          onNavegar(v === 'inicio' ? '/dashboard/tareas-clientes' : v === 'todas' ? '/dashboard/tareas-clientes/todas' : v === 'mias' ? '/dashboard/tareas-clientes/mis-tareas' : `/dashboard/tareas-clientes/${v}`)
        }}
      >
        <option value="inicio">🏠 Inicio</option>
        <option value="todas">▦ Todas las tareas</option>
        <option value="mias">✓ Mis tareas</option>
        {ORDEN_DE_GRUPOS.map((g) => {
          const delGrupo = clientes.filter((c) => c.grupo === g)
          if (delGrupo.length === 0) return null
          return (
            <optgroup key={g} label={ETIQUETA_DE_GRUPO[g]}>
              {delGrupo.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icono ?? '•'} {c.nombre}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </label>
  )
}

export function BarraLateral({
  clientes,
  tareas,
  ambito,
  miId,
  favoritos,
  colapsada,
  onAlternar,
  onNavegar,
  onFavorito,
}: {
  clientes: readonly ClienteTC[]
  tareas: readonly TareaLigera[]
  ambito: Ambito
  miId: string
  favoritos: readonly string[]
  colapsada: boolean
  onAlternar: () => void
  onNavegar: (ruta: string) => void
  onFavorito: (id: string) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const hoy = new Date().toISOString().slice(0, 10)

  const cifras = useMemo(() => {
    const porCliente = new Map<string, { abiertas: number; vencidas: number }>()
    const hechas = new Map(clientes.map((c) => [c.id, new Set(estadosDe(c).filter((e) => e.grupo === 'hecho').map((e) => e.nombre))]))
    let mias = 0
    for (const t of tareas) {
      if (hechas.get(t.cliente_id)?.has(t.estado)) continue
      const f = porCliente.get(t.cliente_id) ?? { abiertas: 0, vencidas: 0 }
      f.abiertas += 1
      const limite = (t.fecha_fin ?? t.fecha_inicio)?.slice(0, 10)
      if (limite && limite < hoy) f.vencidas += 1
      porCliente.set(t.cliente_id, f)
      if (t.responsables.includes(miId)) mias += 1
    }
    return { porCliente, mias }
  }, [clientes, tareas, hoy, miId])

  const filtrados = clientes.filter((c) => c.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()))
  const losFavoritos = filtrados.filter((c) => favoritos.includes(c.id))

  const Item = ({ activo, icono, nombre, cifra, rojo, ruta, color, id }: { activo: boolean; icono: React.ReactNode; nombre: string; cifra?: number; rojo?: boolean; ruta: string; color?: string; id?: string }) => (
    <div className="group/i relative" style={color ? ({ '--tono': `var(--tc-${colorValido(color)})` } as React.CSSProperties) : undefined}>
      <button type="button" aria-current={activo ? 'page' : undefined} title={colapsada ? nombre : undefined} onClick={() => onNavegar(ruta)} className="tc-lat-item" data-activo={activo ? 'true' : undefined}>
        <span className="tc-lat-icono">{icono}</span>
        {!colapsada && <span className="min-w-0 flex-1 truncate text-left">{nombre}</span>}
        {!colapsada && cifra != null && cifra > 0 && <span className={`text-[11px] tabular-nums ${rojo ? 'font-medium text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t4)]'}`}>{cifra}</span>}
      </button>
      {!colapsada && id && (
        <button type="button" aria-label={favoritos.includes(id) ? 'Quitar de favoritos' : 'Añadir a favoritos'} aria-pressed={favoritos.includes(id)} onClick={() => onFavorito(id)} className="tc-lat-estrella" data-puesta={favoritos.includes(id) ? 'true' : undefined}>
          <Star className="h-3 w-3" />
        </button>
      )}
    </div>
  )

  return (
    <aside className="tc-lateral" data-colapsada={colapsada ? 'true' : undefined} aria-label="Clientes">
      <div className="tc-marca">
        <span className="tc-marca-icono" aria-hidden><KanbanSquare className="h-4 w-4" /></span>
        {!colapsada && (
          <span className="tc-marca-texto">
            <b>Tareas Clientes</b>
            <span>{clientes.length} clientes</span>
          </span>
        )}
        <button type="button" onClick={onAlternar} aria-label={colapsada ? 'Ampliar la barra' : 'Plegar la barra'} className="tc-icono-boton">
          {colapsada ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {!colapsada && (
        <label className="mx-2.5 mb-1.5 flex items-center gap-1.5 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 focus-within:border-[var(--ls-acc-graf)]">
          <Search className="h-3 w-3 text-[var(--ls-t4)]" />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar cliente…" aria-label="Buscar cliente" className="h-8 w-full bg-transparent text-[12px] outline-none placeholder:text-[var(--ls-t4)]" />
        </label>
      )}

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        <Link href="/dashboard/tareas-clientes" className="tc-lat-item" title={colapsada ? 'Inicio' : undefined}>
          <span className="tc-lat-icono"><Home className="h-3.5 w-3.5" /></span>
          {!colapsada && <span className="flex-1 truncate">Inicio</span>}
        </Link>
        <Item activo={ambito.tipo === 'todas'} icono={<LayoutGrid className="h-3.5 w-3.5" />} nombre="Todas las tareas" ruta="/dashboard/tareas-clientes/todas" />
        <Item activo={ambito.tipo === 'mias'} icono={<UserCheck className="h-3.5 w-3.5" />} nombre="Mis tareas" cifra={cifras.mias} ruta="/dashboard/tareas-clientes/mis-tareas" />

        {losFavoritos.length > 0 && !colapsada && (
          <>
            <p className="tc-lat-rotulo">Favoritos</p>
            {losFavoritos.map((c) => (
              <Item key={`f-${c.id}`} id={c.id} activo={ambito.tipo === 'cliente' && ambito.id === c.id} icono={<span className="text-[14px] leading-none">{c.icono ?? '•'}</span>} nombre={c.nombre} cifra={cifras.porCliente.get(c.id)?.abiertas} rojo={(cifras.porCliente.get(c.id)?.vencidas ?? 0) > 0} ruta={`/dashboard/tareas-clientes/${c.id}`} color={c.color} />
            ))}
          </>
        )}

        {ORDEN_DE_GRUPOS.map((g) => {
          const delGrupo = filtrados.filter((c) => c.grupo === g)
          if (delGrupo.length === 0) return null
          return (
            <div key={g}>
              {!colapsada ? <p className="tc-lat-rotulo">{ETIQUETA_DE_GRUPO[g]}</p> : <div className="mx-2 my-1.5 h-px bg-[var(--ls-linea)]" />}
              {delGrupo.map((c) => (
                <Item key={c.id} id={c.id} activo={ambito.tipo === 'cliente' && ambito.id === c.id} icono={<span className="text-[14px] leading-none">{c.icono ?? '•'}</span>} nombre={c.nombre} cifra={cifras.porCliente.get(c.id)?.abiertas} rojo={(cifras.porCliente.get(c.id)?.vencidas ?? 0) > 0} ruta={`/dashboard/tareas-clientes/${c.id}`} color={c.color} />
              ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

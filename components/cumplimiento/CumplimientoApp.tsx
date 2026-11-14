'use client'

import { useEffect, useState } from 'react'
import { ClipboardCheck, LayoutDashboard, ListChecks, ListTodo, RefreshCw, TriangleAlert } from 'lucide-react'
import { AvatarDeCliente, BarraDeClientes, type ClienteDeBarra } from '@/components/marketing-test/BarraDeClientes'
import { bandera } from '@/components/marketing-test/piezas'
import { Vacio } from '@/components/plataforma/comun'
import { TableroCumplimiento } from '@/components/growth/cumplimiento/TableroCumplimiento'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { nombreDePais } from '@/lib/ads/paises'
import { saludDe, tonoDeSalud } from '@/lib/cumplimiento/panel-calculo'
import type { FiltrosCumplimiento } from '@/lib/cumplimiento/tipos'
import type { TareaDeHoy } from '@/lib/cumplimiento/acciones'
import { ACCIONES } from '@/lib/cumplimiento/acciones'
import { usePanel } from './usePanel'
import { PestanaPanel } from './PestanaPanel'
import { PestanaIncidencias } from './PestanaIncidencias'
import { PestanaHoy, tareasPendientes } from './PestanaHoy'

const PESTANAS = [
  // La primera y la de por defecto: lo que hay que hacer hoy. El panel es para ver cómo va; esta, para trabajar
  { id: 'hoy', nombre: 'Hoy', icono: ListTodo },
  { id: 'panel', nombre: 'Panel', icono: LayoutDashboard },
  { id: 'incidencias', nombre: 'Incidencias', icono: TriangleAlert },
  { id: 'listings', nombre: 'Listings', icono: ListChecks },
] as const
export type IdPestana = (typeof PESTANAS)[number]['id']

/** «Todos los países» en la barra: es una entrada más, con id fijo */
export const TODOS = 'todos'

/**
 * CUMPLIMIENTO — LA APP. Los clientes y sus países a la izquierda; a la derecha, cómo va el elegido: un panel con la salud de su catálogo ante Amazon, las incidencias agrupadas por lo que dice
 * Amazon y la lista de listings. Todo es de UN cliente: ninguna pantalla junta ni compara clientes (los datos de cada vendedor son solo para operar su cuenta).
 */
export function CumplimientoApp({ clientes, clienteInicial, cuentaInicial, pestana }: { clientes: ClienteDeBarra[]; clienteInicial: string; cuentaInicial: string | null; pestana: string }) {
  const [clienteSlug, setClienteSlug] = useState(clienteInicial)
  const [cuentaId, setCuentaId] = useState<string | null>(cuentaInicial)
  const [activa, setActiva] = useState<IdPestana>(PESTANAS.some((p) => p.id === pestana) ? (pestana as IdPestana) : 'hoy')
  // Con qué filtros se abre la lista al llegar desde una tarea de «Hoy» o un código de «Incidencias» (null = los de siempre)
  const [filtroListings, setFiltroListings] = useState<Partial<FiltrosCumplimiento> | null>(null)
  const [colapsada, setColapsada] = useState(false)

  useEffect(() => {
    try {
      setColapsada(window.localStorage.getItem('cumplimiento-lateral') === '1')
    } catch {
      /* desplegada */
    }
  }, [])

  const cliente = clientes.find((c) => c.slug === clienteSlug) ?? clientes[0]
  const cuenta = cliente?.cuentas.find((c) => c.id === cuentaId) ?? cliente?.cuentas[0] ?? null

  const escribirUrl = (c: string, p: string | null, t: string) => {
    const q = new URLSearchParams(window.location.search)
    q.set('c', c)
    if (p) q.set('p', p)
    else q.delete('p')
    q.set('t', t)
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
  }
  const elegir = (slug: string, id: string | null) => {
    setClienteSlug(slug)
    setCuentaId(id)
    setFiltroListings(null)
    escribirUrl(slug, id, activa)
  }
  const irA = (t: IdPestana, filtro?: Partial<FiltrosCumplimiento>) => {
    setActiva(t)
    setFiltroListings(filtro ?? null)
    escribirUrl(cliente.slug, cuenta?.id ?? null, t)
  }
  const elegirPais = (id: string) => {
    setCuentaId(id)
    escribirUrl(cliente.slug, id, activa)
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      <BarraDeClientes
        titulo="Cumplimiento"
        icono={<ClipboardCheck className="h-[17px] w-[17px]" />}
        pie={<>Clientes con la cuenta de vendedor conectada. Amazon se revisa sola cada hora, listing a listing.</>}
        clientes={clientes}
        clienteSlug={cliente.slug}
        cuentaId={cuenta?.id ?? null}
        colapsada={colapsada}
        alternar={() =>
          setColapsada((v) => {
            try {
              window.localStorage.setItem('cumplimiento-lateral', v ? '0' : '1')
            } catch {
              /* nada */
            }
            return !v
          })
        }
        elegir={elegir}
      />
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {/* En el móvil la barra lateral no cabe: cliente y país en dos desplegables */}
        <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 md:hidden">
          <select aria-label="Cliente" value={cliente.slug} onChange={(e) => { const c = clientes.find((x) => x.slug === e.target.value); if (c) elegir(c.slug, c.cuentas[0]?.id ?? null) }} className="h-[34px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)]">
            {clientes.map((c) => <option key={c.slug} value={c.slug}>{c.nombre}</option>)}
          </select>
          <select aria-label="País" value={cuenta?.id ?? ''} onChange={(e) => elegir(cliente.slug, e.target.value)} className="h-[34px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)]">
            {cliente.cuentas.map((c) => <option key={c.id} value={c.id}>{c.etiqueta ?? nombreDePais(c.pais)}</option>)}
          </select>
        </div>
        {cuenta ? (
          <Cuerpo key={`${cliente.slug}|${cuenta.id}`} cliente={cliente} cuenta={cuenta} activa={activa} irA={irA} filtroListings={filtroListings} elegirPais={elegirPais} />
        ) : (
          <Vacio icono={<ClipboardCheck />} titulo="Este cliente no tiene ninguna cuenta de vendedor activa">
            Se conecta en <strong>Amazon API · Cuentas</strong>.
          </Vacio>
        )}
      </div>
    </div>
  )
}

function Cuerpo({
  cliente,
  cuenta,
  activa,
  irA,
  filtroListings,
  elegirPais,
}: {
  cliente: ClienteDeBarra
  cuenta: ClienteDeBarra['cuentas'][number]
  activa: IdPestana
  irA: (t: IdPestana, filtro?: Partial<FiltrosCumplimiento>) => void
  filtroListings: Partial<FiltrosCumplimiento> | null
  elegirPais: (id: string) => void
}) {
  const mercado = cuenta.id
  const { panel, cargando, recargar } = usePanel(cliente.slug, mercado)
  const salud = panel?.ok ? saludDe(panel.cifras) : null
  const tono = tonoDeSalud(salud)
  const color = tono === 'gris' ? 'var(--ls-t3)' : COLOR_ESTADO[tono]

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 pb-3 lg:pr-36">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarDeCliente slug={cliente.slug} nombre={cliente.nombre} tamano={38} />
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--ls-t1)]">{cliente.nombre}</h1>
            <div className="mt-[2px] flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
              <span aria-hidden>{cuenta.pais === '*' ? '🌍' : bandera(cuenta.pais)}</span>
              <span className="font-medium text-[var(--ls-t2)]">{cuenta.etiqueta ?? nombreDePais(cuenta.pais)}</span>
            </div>
          </div>
        </div>
        {salud != null && (
          <span className="inline-flex h-[24px] items-center gap-[6px] rounded-full px-[10px] text-[11.5px] font-semibold tabular-nums" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)` }} title="Parte de los listings revisados sin errores ni ocultos">
            Salud {(Math.floor(salud * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
          </span>
        )}
        <button type="button" onClick={() => void recargar()} className="ml-auto inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Volver a leer las cifras (las revisiones de Amazon llegan solas cada hora)">
          <RefreshCw className={`h-[13px] w-[13px] ${cargando ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </header>

      <nav className="-mx-1 flex shrink-0 items-end gap-1 overflow-x-auto border-b border-[var(--ls-linea)] px-1" aria-label="Cumplimiento">
        {PESTANAS.map((p) => {
          const Icono = p.icono
          const encendida = p.id === activa
          const n = !panel?.ok ? null : p.id === 'hoy' ? tareasPendientes(panel.tareas) : p.id === 'listings' ? panel.cifras.atencion : null
          return (
            <button key={p.id} type="button" onClick={() => irA(p.id)} aria-current={encendida ? 'page' : undefined} className={`relative inline-flex h-[38px] shrink-0 items-center gap-[7px] rounded-t-[8px] px-3 text-[13px] font-medium transition-colors ${encendida ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'}`}>
              <Icono className={`h-[14px] w-[14px] shrink-0 ${encendida ? 'text-[var(--ls-acc)]' : ''}`} />
              {p.nombre}
              {n != null && n > 0 && <span className="rounded-full bg-[var(--ls-sup3)] px-[6px] text-[10.5px] font-semibold tabular-nums text-[var(--ls-t3)]">{n.toLocaleString('es-ES')}</span>}
              {encendida && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--ls-acc-graf)]" />}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-4">
        {activa === 'listings' ? (
          <div className="flex h-full min-h-[520px] flex-col">
            <TableroCumplimiento
              key={`${cliente.slug}|${mercado}|${JSON.stringify(filtroListings)}`}
              slug={cliente.slug}
              nombre={cliente.nombre}
              mercadoFijo={mercado === TODOS ? undefined : mercado}
              filtrosIniciales={filtroListings ?? undefined}
            />
          </div>
        ) : !panel ? (
          <EsqueletoDelPanel />
        ) : !panel.ok ? (
          <p className="rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px]" style={{ color: panel.faltaMigracion ? COLOR_ESTADO.ambar : COLOR_ESTADO.rojo }}>
            {panel.faltaMigracion ? 'Falta lanzar la migración 297 en Supabase: sin ella no se pueden sacar las cifras del panel. La pestaña «Listings» sí funciona.' : panel.error}
          </p>
        ) : activa === 'hoy' ? (
          <PestanaHoy panel={panel} mercado={mercado} nombreCliente={cliente.nombre} nombrePais={cuenta.etiqueta ?? nombreDePais(cuenta.pais)} verTarea={(t, soloStock) => irA('listings', filtroDeTarea(t, soloStock))} />
        ) : activa === 'panel' ? (
          <PestanaPanel panel={panel} todos={mercado === TODOS} verPais={elegirPais} verIncidencias={() => irA('incidencias')} verCodigo={(c) => irA('listings', { codigo: c, gravedad: 'cualquiera' })} verHoy={() => irA('hoy')} />
        ) : (
          <PestanaIncidencias panel={panel} verCodigo={(c) => irA('listings', { codigo: c, gravedad: 'cualquiera' })} />
        )}
      </div>
    </>
  )
}

function EsqueletoDelPanel() {
  return (
    <div className="grid max-w-[1240px] gap-3" aria-busy="true" aria-label="Cargando el panel">
      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="h-[196px] animate-pulse rounded-[14px] bg-[var(--ls-sup)]" />
        <div className="h-[196px] animate-pulse rounded-[14px] bg-[var(--ls-sup)]" />
      </div>
      <div className="h-[260px] animate-pulse rounded-[14px] bg-[var(--ls-sup)]" />
    </div>
  )
}

/** Los filtros de la lista para ver los listings de una tarea de «Hoy»: sus códigos, con cualquier gravedad */
function filtroDeTarea(t: TareaDeHoy, soloStock: boolean): Partial<FiltrosCumplimiento> {
  return { codigos: t.codigos, rotuloCodigos: ACCIONES[t.accion].titulo, gravedad: 'cualquiera', soloStock }
}


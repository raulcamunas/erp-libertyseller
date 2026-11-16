'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Users } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { FOCO, PanelLateral, TACTIL } from '@/components/ui-ls'
import { SALUD } from '../comun/estilo-plan'
import type { ClienteRemesas } from '../comun/tipos-ui'
import { cx } from '../comun/ui'
import { nuevosDe } from '../envios/useEnviosNuevos'

/**
 * EL SELECTOR DE CLIENTE DE REMESAS A FBA (spec remesas-pro §1.2 y §8).
 *
 *   ESCRITORIO (lg+)  la BarraClientes de siempre: un botón por cliente en una fila que se desliza de lado, con el nº de envíos, el contador
 *                     naranja de propuestas en marcha, el «+N» ámbar de envíos nuevos en Amazon (solo a quien puede importarlos), los
 *                     clientes sin nada apagados (pero clicables: hay que poder crearles la primera) y el activo centrado. NUEVO: el punto
 *                     de salud (rojo, ámbar, verde o gris «sin datos») de la última pasada del planificador.
 *   MÓVIL             un botón «Cliente: Opinas ▾» que abre una hoja inferior (PanelLateral) con un buscador y la misma información por fila.
 *                     Solo se lee y se elige: nada de editores dentro (la hoja es modal, D38).
 *
 * No navega: llama a `onElegir(id)`. Quien lo monta hace `router.push` (deja historial para «Atrás», D25).
 *
 *   <SelectorDeCliente clientes activo onElegir cargando? nuevos? />
 */

export interface SelectorDeClienteProps {
  clientes: readonly ClienteRemesas[]
  /** El cliente abierto */
  activo: string
  onElegir: (id: string) => void
  /** El cliente que se está cargando (late mientras llega del servidor) */
  cargando?: string | null
  /** Envíos nuevos en Amazon por cliente (useEnviosNuevosDeTodos) */
  nuevos?: Record<string, number>
}

export function SelectorDeCliente({ clientes, activo, onElegir, cargando = null, nuevos = {} }: SelectorDeClienteProps) {
  return (
    <>
      <div className="hidden min-w-0 flex-1 lg:flex">
        <BarraClientes clientes={clientes} activo={activo} onElegir={onElegir} cargando={cargando} nuevos={nuevos} />
      </div>
      <div className="min-w-0 flex-1 lg:hidden">
        <HojaClientes clientes={clientes} activo={activo} onElegir={onElegir} cargando={cargando} nuevos={nuevos} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas comunes                                                      */
/* ------------------------------------------------------------------ */

/** El punto de salud. Sin pasada del planificador (o sin la 316) no se pinta: no se inventa */
function PuntoDeSalud({ cliente, grande = false }: { cliente: ClienteRemesas; grande?: boolean }) {
  if (!cliente.salud) return null
  const estilo = SALUD[cliente.salud.tono]
  const color = COLOR_ESTADO[estilo.tono]
  const gris = cliente.salud.tono === 'gris'
  return (
    <span
      className={cx('inline-block shrink-0 rounded-full', grande ? 'h-[9px] w-[9px]' : 'h-[7px] w-[7px]')}
      style={gris ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }}
      title={`${estilo.texto}: ${cliente.salud.motivo}`}
      aria-label={`${estilo.texto}: ${cliente.salud.motivo}`}
      role="img"
    />
  )
}

function textoDeContadores(c: ClienteRemesas): string {
  const { envios, propuestas } = c.contadores
  if (envios + propuestas === 0) return 'todavía sin remesas'
  return `${envios} envío${envios === 1 ? '' : 's'} · ${propuestas} propuesta${propuestas === 1 ? '' : 's'}`
}

function InsigniaPropuestas({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span
      className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-[5px] text-[10.5px] font-semibold tabular-nums"
      style={{ background: 'color-mix(in srgb, var(--ls-acc) 20%, transparent)', color: 'var(--ls-acc)' }}
      title={`${n} propuesta${n === 1 ? '' : 's'} en marcha`}
    >
      {n}
    </span>
  )
}

function InsigniaNuevos({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span
      className="rounded-full px-[6px] text-[10.5px] font-semibold tabular-nums"
      style={{ background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 18%, transparent)`, color: COLOR_ESTADO.ambar }}
      title={`${n} envío${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} en Amazon sin importar`}
    >
      +{n}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Escritorio: la barra de siempre                                     */
/* ------------------------------------------------------------------ */

/**
 * UN BOTÓN POR CLIENTE, EN HORIZONTAL. Con once cuentas un desplegable obliga a abrirlo para saber qué hay; en horizontal se ven todas de un
 * vistazo y se salta de una a otra con un clic, que es como se trabaja cuando revisas varias seguidas.
 */
function BarraClientes({ clientes, activo, onElegir, cargando, nuevos }: Required<Omit<SelectorDeClienteProps, 'cargando'>> & { cargando: string | null }) {
  const fila = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Se mueve SOLO la fila, de lado. scrollIntoView movía también la ventana
    const f = fila.current
    const b = f?.querySelector<HTMLElement>('[data-activo="true"]')
    if (!f || !b) return
    const caja = f.getBoundingClientRect()
    const boton = b.getBoundingClientRect()
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    f.scrollTo({ left: f.scrollLeft + boton.left - caja.left - (caja.width - boton.width) / 2, behavior: suave ? 'smooth' : 'auto' })
  }, [activo])

  // Difuminado en el borde por el que la fila sigue: sin él, el último cliente quedaba cortado en seco y parecía un fallo
  const [bordes, setBordes] = useState({ izq: false, der: false })
  const medirBordes = useCallback(() => {
    const f = fila.current
    if (!f) return
    const izq = f.scrollLeft > 2
    const der = f.scrollLeft + f.clientWidth < f.scrollWidth - 2
    setBordes((b) => (b.izq === izq && b.der === der ? b : { izq, der }))
  }, [])
  useEffect(() => {
    const f = fila.current
    if (!f) return
    medirBordes()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medirBordes) : null
    ro?.observe(f)
    return () => ro?.disconnect()
  }, [medirBordes, clientes.length])
  const mascara = `linear-gradient(to right, ${bordes.izq ? 'transparent, #000 28px' : '#000, #000'}, ${bordes.der ? '#000 calc(100% - 40px), transparent' : '#000, #000'})`

  return (
    <div
      ref={fila}
      onScroll={medirBordes}
      role="tablist"
      aria-label="Clientes"
      className="flex min-w-0 flex-1 items-center gap-[6px] overflow-x-auto py-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: mascara, WebkitMaskImage: mascara }}
    >
      {clientes.map((c) => {
        const esActivo = c.id === activo
        const vacio = c.contadores.envios + c.contadores.propuestas === 0
        const n = nuevosDe(nuevos, c.id, c.puedeEditar)
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={esActivo}
            data-activo={esActivo}
            onClick={() => onElegir(c.id)}
            title={`${c.nombre} · ${textoDeContadores(c)}${c.salud ? ` · ${c.salud.motivo}` : ''}`}
            className={cx(
              'relative inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-[9px] border px-[11px] text-[12.5px] transition-colors',
              FOCO,
              c.id === cargando && 'animate-pulse motion-reduce:animate-none',
              esActivo
                ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] font-medium text-[var(--ls-t1)] shadow-[0_6px_18px_-12px_var(--ls-acc)]'
                : vacio
                  ? 'border-[var(--ls-linea)] text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t2)]'
                  : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]'
            )}
          >
            <PuntoDeSalud cliente={c} />
            {c.nombre}
            {c.contadores.envios > 0 && <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{c.contadores.envios}</span>}
            <InsigniaPropuestas n={c.contadores.propuestas} />
            <InsigniaNuevos n={n} />
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Móvil: botón y hoja con buscador                                    */
/* ------------------------------------------------------------------ */

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

function HojaClientes({ clientes, activo, onElegir, cargando, nuevos }: Required<Omit<SelectorDeClienteProps, 'cargando'>> & { cargando: string | null }) {
  const [abierta, setAbierta] = useState(false)
  const [buscar, setBuscar] = useState('')
  const actual = clientes.find((c) => c.id === activo) ?? null
  const totalNuevos = clientes.reduce((s, c) => s + nuevosDe(nuevos, c.id, c.puedeEditar), 0)

  useEffect(() => {
    if (!abierta) setBuscar('')
  }, [abierta])

  const visibles = useMemo(() => {
    const q = normalizar(buscar.trim())
    return q ? clientes.filter((c) => normalizar(c.nombre).includes(q)) : clientes
  }, [clientes, buscar])

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-haspopup="dialog"
        className={cx(
          'flex w-full min-w-0 items-center gap-2 rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-3 text-left text-[14px] text-[var(--ls-t1)] shadow-[var(--ls-sombra-1)]',
          TACTIL,
          FOCO,
          cargando && 'animate-pulse motion-reduce:animate-none'
        )}
      >
        {actual && <PuntoDeSalud cliente={actual} grande />}
        <span className="shrink-0 text-[12.5px] text-[var(--ls-t3)]">Cliente:</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{actual?.nombre ?? 'Elige uno'}</span>
        {totalNuevos > 0 && <InsigniaNuevos n={totalNuevos} />}
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" aria-hidden />
      </button>

      <PanelLateral
        abierto={abierta}
        onCambio={setAbierta}
        titulo="Elige un cliente"
        descripcion={`${clientes.length} cuenta${clientes.length === 1 ? '' : 's'} de Amazon`}
        icono={Users}
        acento="remesas"
      >
        <div className="flex min-h-0 flex-col gap-3 px-4 pb-4 pt-3">
          {clientes.length > 6 && (
            <label className="relative block">
              <span className="sr-only">Buscar cliente</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
              <input
                type="search"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Buscar cliente"
                className={cx(
                  'h-11 w-full min-w-0 rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] pl-9 pr-3 text-[16px] text-[var(--ls-t1)] placeholder:text-[var(--ls-t4)]',
                  FOCO
                )}
              />
            </label>
          )}

          <ul className="flex flex-col gap-[6px]" role="listbox" aria-label="Clientes">
            {visibles.map((c) => {
              const esActivo = c.id === activo
              const n = nuevosDe(nuevos, c.id, c.puedeEditar)
              const vacio = c.contadores.envios + c.contadores.propuestas === 0
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={esActivo}
                    onClick={() => {
                      setAbierta(false)
                      if (!esActivo) onElegir(c.id)
                    }}
                    className={cx(
                      'flex min-h-[52px] w-full min-w-0 items-center gap-3 rounded-[12px] border px-3 py-2 text-left transition-colors',
                      FOCO,
                      esActivo ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)] active:bg-[var(--ls-sup3)]'
                    )}
                  >
                    <span className="flex w-[10px] shrink-0 justify-center">
                      <PuntoDeSalud cliente={c} grande />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate text-[14px] font-medium', vacio && !esActivo ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t1)]')}>{c.nombre}</span>
                      <span className="block truncate text-[12px] text-[var(--ls-t4)]">
                        {textoDeContadores(c)}
                        {c.salud && c.salud.tono !== 'verde' ? ` · ${c.salud.motivo}` : ''}
                      </span>
                    </span>
                    <InsigniaPropuestas n={c.contadores.propuestas} />
                    <InsigniaNuevos n={n} />
                    {esActivo && <Check className="h-4 w-4 shrink-0 text-[var(--ls-acc)]" aria-hidden />}
                  </button>
                </li>
              )
            })}
            {visibles.length === 0 && <li className="px-2 py-6 text-center text-[13px] text-[var(--ls-t3)]">Ningún cliente se llama así</li>}
          </ul>
        </div>
      </PanelLateral>
    </>
  )
}

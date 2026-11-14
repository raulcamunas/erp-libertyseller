'use client'

import { useEffect, useState } from 'react'
import { BadgeCheck, CircleAlert, FileText, ListChecks, Loader2, Package, RefreshCw, Search, SearchCheck } from 'lucide-react'
import { AvatarDeCliente, BarraDeClientes, type ClienteDeBarra } from '@/components/marketing-test/BarraDeClientes'
import { bandera } from '@/components/marketing-test/piezas'
import { haceCuanto } from '@/components/marketing-test/formato'
import { Vacio } from '@/components/plataforma/comun'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { nombreDePais } from '@/lib/ads/paises'
import { useCuentaSeo, type LecturaSeo } from './useCuentaSeo'
import { PestanaSeoHoy } from './PestanaSeoHoy'
import { PestanaSeoProductos } from './PestanaSeoProductos'
import { PestanaSeoBusquedas } from './PestanaSeoBusquedas'
import { PestanaSeoFicha } from './PestanaSeoFicha'

const PESTANAS = [
  { id: 'hoy', nombre: 'Qué hacer hoy', icono: ListChecks },
  { id: 'productos', nombre: 'Productos', icono: Package },
  { id: 'busquedas', nombre: 'Búsquedas', icono: Search },
  { id: 'ficha', nombre: 'Ficha', icono: FileText },
] as const
type IdPestana = (typeof PESTANAS)[number]['id']

/**
 * SEO TEST — el armazón: los clientes y sus países a la izquierda (la misma barra que Marketing Test), la cabecera con el cliente y el estado de Brand Analytics, y las pestañas. La primera es «Qué
 * hacer hoy» (las tareas del día, ordenadas por impacto); las demás son para profundizar en un producto. Cambiar de cliente, país, pestaña o producto no pasa por el servidor.
 */
export function SeoTest({ clientes, clienteInicial, cuentaInicial, pestana }: { clientes: ClienteDeBarra[]; clienteInicial: string; cuentaInicial: string | null; pestana: string }) {
  const [clienteSlug, setClienteSlug] = useState(clienteInicial)
  const [cuentaId, setCuentaId] = useState<string | null>(cuentaInicial)
  const [activa, setActiva] = useState<IdPestana>(PESTANAS.some((p) => p.id === pestana) ? (pestana as IdPestana) : 'hoy')
  const [asin, setAsin] = useState<string | null>(null)
  const [colapsada, setColapsada] = useState(false)

  useEffect(() => {
    try {
      setColapsada(window.localStorage.getItem('seo-lateral') === '1')
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
    setAsin(null)
    escribirUrl(slug, id, activa)
  }
  const irA = (t: IdPestana, conAsin?: string) => {
    setActiva(t)
    if (conAsin) setAsin(conAsin)
    escribirUrl(cliente.slug, cuenta?.id ?? null, t)
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      <BarraDeClientes
        titulo="SEO Test"
        icono={<SearchCheck className="h-[17px] w-[17px]" />}
        pie={<>Cuentas de vendedor conectadas y sus países. Se conectan en <span className="text-[var(--ls-t3)]">Amazon API · Cuentas</span>.</>}
        clientes={clientes}
        clienteSlug={cliente.slug}
        cuentaId={cuenta?.id ?? null}
        colapsada={colapsada}
        alternar={() =>
          setColapsada((v) => {
            try {
              window.localStorage.setItem('seo-lateral', v ? '0' : '1')
            } catch {
              /* nada */
            }
            return !v
          })
        }
        elegir={elegir}
      />
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {cuenta ? <CuerpoDeCuenta key={cuenta.id} cuentaId={cuenta.id} cliente={cliente} cuenta={cuenta} activa={activa} irA={irA} asin={asin} setAsin={setAsin} /> : (
          <Vacio icono={<SearchCheck />} titulo="Este cliente no tiene ninguna cuenta de vendedor activa">
            Se conecta en <strong>Amazon API · Cuentas</strong>.
          </Vacio>
        )}
      </div>
    </div>
  )
}

function CuerpoDeCuenta({ cuentaId, cliente, cuenta, activa, irA, asin, setAsin }: { cuentaId: string; cliente: ClienteDeBarra; cuenta: ClienteDeBarra['cuentas'][number]; activa: IdPestana; irA: (t: IdPestana, asin?: string) => void; asin: string | null; setAsin: (a: string | null) => void }) {
  const { datos, error, recargar, actualizar } = useCuentaSeo(cuentaId)
  const productos = datos?.productos ?? []
  const asinElegido = asin && productos.some((p) => p.asin === asin) ? asin : (productos[0]?.asin ?? null)

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 pb-3 lg:pr-36">
        <div className="flex min-w-0 items-center gap-3">
          <AvatarDeCliente slug={cliente.slug} nombre={cliente.nombre} tamano={38} />
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-semibold leading-[1.2] tracking-[-0.02em] text-[var(--ls-t1)]">{cliente.nombre}</h1>
            <div className="mt-[2px] flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
              <span aria-hidden>{bandera(cuenta.pais)}</span>
              <span className="font-medium text-[var(--ls-t2)]">{nombreDePais(cuenta.pais)}</span>
              {cuenta.nombre && (
                <>
                  <span className="text-[var(--ls-t4)]">·</span>
                  <span className="truncate">Cuenta {cuenta.nombre}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {datos && <EstadoDeBrandAnalytics lectura={datos.lectura} hayProductos={productos.length > 0} />}
        <button type="button" onClick={actualizar} className="ml-auto inline-flex h-[30px] items-center gap-[6px] rounded-[9px] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" title="Volver a leer la ficha y pedir el informe a Amazon">
          <RefreshCw className={`h-[13px] w-[13px] ${datos?.lectura.sincronizando ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </header>

      <nav className="-mx-1 flex shrink-0 items-end gap-1 overflow-x-auto border-b border-[var(--ls-linea)] px-1" aria-label="SEO Test">
        {PESTANAS.map((p) => {
          const Icono = p.icono
          const encendida = p.id === activa
          return (
            <button key={p.id} type="button" onClick={() => irA(p.id)} aria-current={encendida ? 'page' : undefined} className={`relative inline-flex h-[38px] shrink-0 items-center gap-[7px] rounded-t-[8px] px-3 text-[13px] font-medium transition-colors ${encendida ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'}`}>
              <Icono className={`h-[14px] w-[14px] shrink-0 ${encendida ? 'text-[var(--ls-acc)]' : ''}`} />
              {p.nombre}
              {encendida && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--ls-acc-graf)]" />}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-4">
        {error ? (
          <p className="rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>
        ) : !datos ? (
          <div className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : activa === 'hoy' ? (
          <PestanaSeoHoy cuentaId={cuentaId} datos={datos} irA={(t, a) => irA(t, a)} />
        ) : activa === 'productos' ? (
          <PestanaSeoProductos cuentaId={cuentaId} datos={datos} recargar={recargar} verBusquedas={(a) => irA('busquedas', a)} verFicha={(a) => irA('ficha', a)} />
        ) : activa === 'busquedas' ? (
          <PestanaSeoBusquedas cuentaId={cuentaId} datos={datos} moneda={cuenta.moneda} asin={asinElegido} setAsin={setAsin} irAProductos={() => irA('productos')} />
        ) : (
          <PestanaSeoFicha cuentaId={cuentaId} datos={datos} asin={asinElegido} setAsin={setAsin} irAProductos={() => irA('productos')} />
        )}
      </div>
    </>
  )
}

/** Si hay acceso a Brand Analytics, y de cuándo son los datos. Si no lo hay, por qué y qué hacer */
function EstadoDeBrandAnalytics({ lectura, hayProductos }: { lectura: LecturaSeo; hayProductos: boolean }) {
  const mes = lectura.mesOk ? new Date(`${lectura.mesOk}T00:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : null
  if (lectura.acceso === 'no')
    return (
      <span className="inline-flex max-w-[520px] items-start gap-[6px] rounded-[10px] px-[10px] py-[5px] text-[11.5px] leading-[1.4]" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 12%, transparent)` }} title={lectura.error ?? undefined}>
        <CircleAlert className="mt-[2px] h-3 w-3 shrink-0" /> Sin acceso a Brand Analytics: falta el rol en la app de Amazon del ERP o el cliente no tiene Brand Registry. Las fichas sí se leen.
      </span>
    )
  // Un error de la última lectura (informe que falla, fichas que no se leen…) se enseña aunque haya acceso: antes se quedaba escondido y la pantalla parecía al día
  const aviso = lectura.error && !lectura.sincronizando ? (
    <span className="inline-flex max-w-[520px] items-start gap-[6px] rounded-[10px] px-[10px] py-[5px] text-[11.5px] leading-[1.4]" style={{ color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 12%, transparent)` }}>
      <CircleAlert className="mt-[2px] h-3 w-3 shrink-0" /> {lectura.error} Se reintenta solo en unos 30 minutos.
    </span>
  ) : null
  if (lectura.acceso === 'si')
    return (
      <>
      {aviso}
      <span className="inline-flex h-[24px] items-center gap-[6px] rounded-full px-[10px] text-[11.5px] font-medium" style={{ color: COLOR_ESTADO.verde, background: `color-mix(in srgb, ${COLOR_ESTADO.verde} 12%, transparent)` }}>
        <BadgeCheck className="h-[13px] w-[13px]" /> Brand Analytics conectado{mes ? ` · datos de ${mes}` : ''}
        {lectura.sincronizando ? ' · actualizando…' : ''}
      </span>
      </>
    )
  if (aviso) return aviso
  if (!hayProductos) return <span className="text-[11.5px] text-[var(--ls-t4)]">Añade productos para empezar a leer</span>
  return (
    <span className="inline-flex h-[24px] items-center gap-[6px] rounded-full bg-[var(--ls-sup2)] px-[10px] text-[11.5px] font-medium text-[var(--ls-t3)]">
      <Loader2 className="h-3 w-3 animate-spin" /> Comprobando el acceso a Brand Analytics…{lectura.fichaLeidaAt ? ` · fichas leídas ${haceCuanto(Date.parse(lectura.fichaLeidaAt))}` : ''}
    </span>
  )
}

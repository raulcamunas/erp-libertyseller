'use client'

import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, CircleAlert, FileText, KeyRound, ListChecks, Loader2, Package, Radar, RefreshCw, Search, SearchCheck, ShoppingCart, Target } from 'lucide-react'
import { AvatarDeCliente, BarraDeClientes, type ClienteDeBarra } from '@/components/marketing-test/BarraDeClientes'
import { bandera } from '@/components/marketing-test/piezas'
import { haceCuanto } from '@/components/marketing-test/formato'
import { Boton, CabeceraDeModulo, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Insignia, Kpi, PanelDePestana, Pestanas, formatoPorcentaje, mezcla, type Opcion } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { nombreDePais } from '@/lib/ads/paises'
import { useCuentaSeo, type DatosSeo, type LecturaSeo } from './useCuentaSeo'
import { PestanaSeoHoy } from './PestanaSeoHoy'
import { PestanaSeoProductos } from './PestanaSeoProductos'
import { PestanaSeoBusquedas } from './PestanaSeoBusquedas'
import { PestanaSeoFicha } from './PestanaSeoFicha'
import { PestanaSeoHelium } from './PestanaSeoHelium'
import { PestanaSeoCompetencia } from './PestanaSeoCompetencia'
import { useHistorial } from './useHistorial'

const PESTANAS = [
  { id: 'hoy', texto: 'Qué hacer hoy', icono: ListChecks },
  { id: 'productos', texto: 'Productos', icono: Package },
  { id: 'busquedas', texto: 'Búsquedas', icono: Search },
  { id: 'ficha', texto: 'Ficha', icono: FileText },
  { id: 'competencia', texto: 'Competencia', icono: Radar },
  { id: 'helium', texto: 'Helium 10', icono: KeyRound },
] as const satisfies ReadonlyArray<Opcion<string>>
type IdPestana = (typeof PESTANAS)[number]['id']

/**
 * SEO TEST — el armazón con el kit visual (components/ui-ls): los clientes y sus países a la izquierda en el ordenador (la misma barra que Marketing Test) y
 * un selector arriba en el móvil; la cabecera del módulo con el acento azul de SEO, el estado de Brand Analytics y las pestañas con indicador. «Qué hacer
 * hoy» es la primera; las demás son para profundizar en un producto. Cambiar de cliente, país, pestaña o producto no pasa por el servidor.
 *
 * En el móvil la página se desplaza entera (sin barras anidadas); en el ordenador, la barra de clientes queda fija y el contenido se desplaza a su lado.
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
    <div className="flex min-w-0 gap-3 lg:h-full lg:min-h-0">
      <BarraDeClientes
        titulo="SEO de fichas"
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
      <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
        <SelectorMovil clientes={clientes} cliente={cliente} cuentaId={cuenta?.id ?? null} elegir={elegir} />
        {cuenta ? (
          <CuerpoDeCuenta key={cuenta.id} cuentaId={cuenta.id} cliente={cliente} cuenta={cuenta} activa={activa} irA={irA} asin={asin} setAsin={setAsin} />
        ) : (
          <EstadoVacio icono={SearchCheck} titulo="Este cliente no tiene ninguna cuenta de vendedor activa" descripcion="Se conecta en Amazon API · Cuentas." acento="seo" />
        )}
      </div>
    </div>
  )
}

/** En el móvil la barra de clientes no cabe: un selector de cliente y país arriba (44 px, al dedo) */
function SelectorMovil({ clientes, cliente, cuentaId, elegir }: { clientes: ClienteDeBarra[]; cliente: ClienteDeBarra; cuentaId: string | null; elegir: (slug: string, id: string | null) => void }) {
  const clase = 'h-11 min-w-0 flex-1 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 text-[16px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]'
  return (
    <div className="mb-3 flex gap-2 md:hidden">
      <select aria-label="Cliente" value={cliente.slug} onChange={(e) => elegir(e.target.value, clientes.find((c) => c.slug === e.target.value)?.cuentas[0]?.id ?? null)} className={clase}>
        {clientes.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.nombre}
          </option>
        ))}
      </select>
      {cliente.cuentas.length > 1 && (
        <select aria-label="País" value={cuentaId ?? ''} onChange={(e) => elegir(cliente.slug, e.target.value)} className={`${clase} max-w-[40%]`}>
          {cliente.cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {bandera(c.pais)} {nombreDePais(c.pais)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

function CuerpoDeCuenta({ cuentaId, cliente, cuenta, activa, irA, asin, setAsin }: { cuentaId: string; cliente: ClienteDeBarra; cuenta: ClienteDeBarra['cuentas'][number]; activa: IdPestana; irA: (t: IdPestana, asin?: string) => void; asin: string | null; setAsin: (a: string | null) => void }) {
  const { datos, error, recargar, actualizar } = useCuentaSeo(cuentaId)
  // El historial de 5 semanas de la cuenta, cargado aparte (no frena la primera pintura): movimientos de la semana y gasto PPC
  const historial = useHistorial(cuentaId, { semanas: 5 })
  // La búsqueda abierta en «Búsquedas» (su ficha en el panel lateral), para abrirla desde Hoy y Productos
  const [consultaAbierta, setConsultaAbierta] = useState<string | null>(null)
  const verBusqueda = (a: string, consulta: string) => {
    setConsultaAbierta(consulta)
    irA('busquedas', a)
  }
  const productos = datos?.productos ?? []
  const asinElegido = asin && productos.some((p) => p.asin === asin) ? asin : (productos[0]?.asin ?? null)

  return (
    <div className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
      <CabeceraDeModulo
        icono={SearchCheck}
        acento="seo"
        titulo={
          <span className="flex min-w-0 items-center gap-2">
            <span className="hidden sm:inline-flex">
              <AvatarDeCliente slug={cliente.slug} nombre={cliente.nombre} tamano={28} />
            </span>
            <span className="truncate">{cliente.nombre}</span>
          </span>
        }
        subtitulo={
          <span className="inline-flex flex-wrap items-center gap-[6px]">
            <span aria-hidden>{bandera(cuenta.pais)}</span>
            {nombreDePais(cuenta.pais)}
            {cuenta.nombre ? <span className="text-[var(--ls-t4)]">· Cuenta {cuenta.nombre}</span> : null}
            <span className="text-[var(--ls-t4)]">· SEO de fichas con Brand Analytics</span>
          </span>
        }
        acciones={
          <>
            {datos && <EstadoDeBrandAnalytics lectura={datos.lectura} hayProductos={productos.length > 0} />}
            <Boton variante="secundario" icono={RefreshCw} cargando={datos?.lectura.sincronizando} onClick={actualizar} title="Volver a leer la ficha y pedir el informe a Amazon">
              Actualizar
            </Boton>
          </>
        }
        debajo={<Pestanas etiqueta="Secciones de SEO" acento="seo" opciones={PESTANAS} valor={activa} onCambio={(t) => irA(t)} idPanel="panel-seo" />}
      />

      {datos?.lectura.error && datos.lectura.acceso !== 'no' && !datos.lectura.sincronizando && (
        <p className="mb-4 flex items-start gap-2 rounded-[14px] px-4 py-3 text-[13px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar, background: mezcla(COLOR_ESTADO.ambar, 10) }}>
          <CircleAlert className="mt-[2px] h-[14px] w-[14px] shrink-0" /> {datos.lectura.error} Se reintenta solo en unos 30 minutos.
        </p>
      )}

      <PanelDePestana id="panel-seo" key={activa} className="pb-8">
        {error ? (
          <EstadoVacio icono={CircleAlert} titulo="No se ha podido cargar la cuenta" descripcion={error} accion={{ texto: 'Reintentar', onClick: () => void recargar() }} acento="seo" />
        ) : !datos ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <EsqueletoTarjeta key={i} />
            ))}
          </div>
        ) : (
          <>
            {(activa === 'hoy' || activa === 'productos') && productos.length > 0 && <KpisDeCuenta datos={datos} />}
            {activa === 'hoy' ? (
              <PestanaSeoHoy cuentaId={cuentaId} datos={datos} irA={(t, a) => irA(t, a)} historial={historial} verBusqueda={verBusqueda} />
            ) : activa === 'productos' ? (
              <PestanaSeoProductos cuentaId={cuentaId} datos={datos} recargar={recargar} verBusquedas={(a) => irA('busquedas', a)} verFicha={(a) => irA('ficha', a)} />
            ) : activa === 'busquedas' ? (
              <PestanaSeoBusquedas cuentaId={cuentaId} datos={datos} moneda={cuenta.moneda} asin={asinElegido} setAsin={setAsin} irAProductos={() => irA('productos')} recargar={recargar} consulta={consultaAbierta} setConsulta={setConsultaAbierta} />
            ) : activa === 'competencia' ? (
              <PestanaSeoCompetencia cuentaId={cuentaId} datos={datos} asin={asinElegido} setAsin={setAsin} irAProductos={() => irA('productos')} />
            ) : activa === 'helium' ? (
              <PestanaSeoHelium cuentaId={cuentaId} datos={datos} asin={asinElegido} setAsin={setAsin} irAProductos={() => irA('productos')} />
            ) : (
              <PestanaSeoFicha cuentaId={cuentaId} datos={datos} asin={asinElegido} setAsin={setAsin} irAProductos={() => irA('productos')} recargar={recargar} />
            )}
          </>
        )}
      </PanelDePestana>
    </div>
  )
}

/**
 * LAS CIFRAS DE LA CUENTA de un vistazo, del último mes leído de Brand Analytics: compras propias, cuota de compras en sus búsquedas, búsquedas donde sale
 * y productos seguidos, con la línea de los meses anteriores (la evolución de la 299).
 */
function KpisDeCuenta({ datos }: { datos: DatosSeo }) {
  const k = useMemo(() => {
    const mes = datos.consultas.MONTH
    const compras = mes.reduce((s, c) => s + (c.comprasAsin ?? 0), 0)
    const total = mes.reduce((s, c) => s + (c.comprasTotal ?? 0), 0)
    // La evolución por mes de toda la cuenta: se suman los productos
    const porMes = new Map<string, { compras: number; total: number; busquedas: number }>()
    for (const p of datos.evolucion ?? []) {
      if (p.periodo !== 'MONTH') continue
      const x = porMes.get(p.desde) ?? { compras: 0, total: 0, busquedas: 0 }
      x.compras += p.compras
      x.total += p.cuotaCompras && p.cuotaCompras > 0 ? p.compras / p.cuotaCompras : 0
      x.busquedas += p.busquedas
      porMes.set(p.desde, x)
    }
    const serie = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
    return {
      compras,
      comprasAntes: serie.length > 1 ? serie[serie.length - 2].compras : null,
      cuota: total > 0 ? compras / total : null,
      cuotaAntes: serie.length > 1 && serie[serie.length - 2].total > 0 ? serie[serie.length - 2].compras / serie[serie.length - 2].total : null,
      busquedas: new Set(mes.map((c) => c.consulta.toLowerCase())).size,
      serieCompras: serie.map((s) => s.compras),
      serieCuota: serie.map((s) => (s.total > 0 ? s.compras / s.total : 0)),
      serieBusquedas: serie.map((s) => s.busquedas),
    }
  }, [datos])
  const mes = datos.lectura.mesOk ? new Date(`${datos.lectura.mesOk}T00:00:00Z`).toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' }) : null
  return (
    <FilaDeKpis className="mb-5">
      <Kpi indice={0} etiqueta="Compras propias" valor={datos.lectura.mesOk ? k.compras : null} anterior={k.comprasAntes} serie={k.serieCompras} icono={ShoppingCart} acento="seo" nota={mes ? `en sus búsquedas · ${mes}` : 'llega con Brand Analytics'} />
      <Kpi indice={1} etiqueta="Cuota de compras" valor={k.cuota} formato={(n) => formatoPorcentaje(n)} anterior={k.cuotaAntes} serie={k.serieCuota} icono={Target} acento="seo" nota="de las compras de esas búsquedas" />
      <Kpi indice={2} etiqueta="Búsquedas donde sale" valor={datos.lectura.mesOk ? k.busquedas : null} serie={k.serieBusquedas} icono={Search} acento="seo" />
      <Kpi indice={3} etiqueta="Productos seguidos" valor={datos.productos.length} icono={Package} acento="seo" nota={`${datos.fichas.length} fichas leídas`} />
    </FilaDeKpis>
  )
}

/** Si hay acceso a Brand Analytics, y de cuándo son los datos. Si no lo hay, por qué y qué hacer */
function EstadoDeBrandAnalytics({ lectura, hayProductos }: { lectura: LecturaSeo; hayProductos: boolean }) {
  const mes = lectura.mesOk ? new Date(`${lectura.mesOk}T00:00:00Z`).toLocaleDateString('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
  if (lectura.acceso === 'no')
    return (
      <Insignia tono="ambar" icono={CircleAlert} title={lectura.error ?? 'Falta el rol de Brand Analytics en la app de Amazon del ERP o el cliente no tiene Brand Registry. Las fichas sí se leen.'}>
        Sin Brand Analytics
      </Insignia>
    )
  if (lectura.acceso === 'si')
    return (
      <Insignia tono="verde" icono={BadgeCheck} vivo={lectura.sincronizando} title={lectura.fichaLeidaAt ? `Fichas leídas ${haceCuanto(Date.parse(lectura.fichaLeidaAt))}` : undefined}>
        Brand Analytics{mes ? ` · ${mes}` : ''}
        {lectura.sincronizando ? ' · actualizando' : ''}
      </Insignia>
    )
  if (!hayProductos) return <Insignia tono="gris">Añade productos</Insignia>
  return (
    <Insignia tono="gris" icono={Loader2} vivo>
      Comprobando el acceso
    </Insignia>
  )
}

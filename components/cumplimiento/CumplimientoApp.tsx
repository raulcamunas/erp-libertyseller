'use client'

import { useEffect, useState } from 'react'
import { ClipboardCheck, LayoutDashboard, ListChecks, ListTodo, RefreshCw, ShieldX, TriangleAlert } from 'lucide-react'
import { BarraDeClientes, type ClienteDeBarra } from '@/components/marketing-test/BarraDeClientes'
import { bandera } from '@/components/marketing-test/piezas'
import { TableroCumplimiento } from '@/components/growth/cumplimiento/TableroCumplimiento'
import { Boton, CabeceraDeModulo, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Insignia, PanelDePestana, Pestanas, TACTIL } from '@/components/ui-ls'
import { nombreDePais } from '@/lib/ads/paises'
import { saludDe, tonoDeSalud } from '@/lib/cumplimiento/panel-calculo'
import type { FiltrosCumplimiento } from '@/lib/cumplimiento/tipos'
import type { TareaDeHoy } from '@/lib/cumplimiento/acciones'
import { ACCIONES } from '@/lib/cumplimiento/acciones'
import { usePanel } from './usePanel'
import { PanelCorregir, type ObjetivoDeCorreccion, type TareaACorregir } from './PanelCorregir'
import { PestanaPanel } from './PestanaPanel'
import { PestanaIncidencias } from './PestanaIncidencias'
import { PestanaHoy, tareasPendientes } from './PestanaHoy'
import { PestanaBloqueos } from './PestanaBloqueos'
import { SaludDeLaCuenta } from './SaludDeLaCuenta'

const PESTANAS = [
  // La primera y la de por defecto (Raúl, 25 nov 2026): lo que deja listings sin vender. Cumplimiento es que lo que se puede vender esté activo
  { id: 'bloqueos', nombre: 'No se venden', icono: ShieldX },
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
  const [activa, setActiva] = useState<IdPestana>(PESTANAS.some((p) => p.id === pestana) ? (pestana as IdPestana) : 'bloqueos')
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
    // Alto fijo solo desde md (ver app/dashboard/cumplimiento/page.tsx): en el móvil todo crece y hace scroll la ventana, sin cajas con scroll dentro
    <div className="flex gap-3 md:h-full md:min-h-0">
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
      <div className="flex min-w-0 flex-1 flex-col md:h-full md:min-h-0">
        {/* En el móvil la barra lateral no cabe: cliente y país en dos desplegables */}
        <div className="mb-3 grid shrink-0 grid-cols-2 gap-2 md:hidden">
          <select aria-label="Cliente" value={cliente.slug} onChange={(e) => { const c = clientes.find((x) => x.slug === e.target.value); if (c) elegir(c.slug, c.cuentas[0]?.id ?? null) }} className={`h-[40px] min-w-0 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-[13px] font-medium text-[var(--ls-t1)] ${TACTIL}`}>
            {clientes.map((c) => <option key={c.slug} value={c.slug}>{c.nombre}</option>)}
          </select>
          <select aria-label="País" value={cuenta?.id ?? ''} onChange={(e) => elegir(cliente.slug, e.target.value)} className={`h-[40px] min-w-0 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 text-[13px] font-medium text-[var(--ls-t1)] ${TACTIL}`}>
            {cliente.cuentas.map((c) => <option key={c.id} value={c.id}>{c.etiqueta ?? nombreDePais(c.pais)}</option>)}
          </select>
        </div>
        {cuenta ? (
          <Cuerpo key={`${cliente.slug}|${cuenta.id}`} cliente={cliente} cuenta={cuenta} activa={activa} irA={irA} filtroListings={filtroListings} elegirPais={elegirPais} />
        ) : (
          <EstadoVacio icono={ClipboardCheck} acento="cumplimiento" titulo="Este cliente no tiene ninguna cuenta de vendedor activa" descripcion="Se conecta en Amazon API · Cuentas." accion={{ texto: 'Ir a Amazon API', href: '/dashboard/amazon-api' }} />
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
  const nombrePais = cuenta.etiqueta ?? nombreDePais(cuenta.pais)
  // El panel «Corregir»: de una incidencia (desde la lista) o de una tarea de «Hoy» (primero se elige el listing)
  const [corregir, setCorregir] = useState<{ objetivo?: ObjetivoDeCorreccion; tarea?: TareaACorregir } | null>(null)
  // Al corregir, la lista se vuelve a montar para leer lo nuevo
  const [vuelta, setVuelta] = useState(0)

  const opciones = PESTANAS.map((p) => ({
    id: p.id,
    texto: p.nombre,
    icono: p.icono,
    cuenta: !panel?.ok ? undefined : p.id === 'hoy' ? tareasPendientes(panel.tareas) || undefined : p.id === 'listings' ? panel.cifras.atencion || undefined : undefined,
  }))

  return (
    <>
      <CabeceraDeModulo
        pegajosa={false}
        className="!mb-3 shrink-0 lg:pr-36"
        icono={ClipboardCheck}
        acento="cumplimiento"
        titulo={cliente.nombre}
        subtitulo={
          <>
            <span aria-hidden>{cuenta.pais === '*' ? '🌍' : bandera(cuenta.pais)}</span> {nombrePais} · cumplimiento ante Amazon
          </>
        }
        junto={
          salud != null ? (
            <Insignia tono={tono === 'gris' ? 'gris' : tono} title="Parte de los listings revisados sin errores ni ocultos">
              Salud {(Math.floor(salud * 1000) / 10).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
            </Insignia>
          ) : undefined
        }
        acciones={
          <Boton variante="fantasma" tamano="sm" icono={RefreshCw} cargando={cargando} onClick={() => void recargar()} title="Volver a leer las cifras (las revisiones de Amazon llegan solas cada hora)">
            Actualizar
          </Boton>
        }
        debajo={<Pestanas etiqueta="Cumplimiento" acento="cumplimiento" opciones={opciones} valor={activa} onCambio={(t) => irA(t)} idPanel="cumplimiento-panel" />}
      />

      {/* Desde md, el contenido baja aquí dentro con la cabecera quieta; en el móvil no hay scroll interior (lo hace la ventana) */}
      <div className="min-w-0 pt-1 md:min-h-0 md:flex-1 md:overflow-auto">
        <PanelDePestana id="cumplimiento-panel" key={activa}>
          {activa === 'listings' ? (
            <div className="flex min-h-[520px] flex-col md:h-full">
              <TableroCumplimiento
                key={`${cliente.slug}|${mercado}|${JSON.stringify(filtroListings)}|${vuelta}`}
                slug={cliente.slug}
                nombre={cliente.nombre}
                mercadoFijo={mercado === TODOS ? undefined : mercado}
                filtrosIniciales={filtroListings ?? undefined}
                alCorregir={(f, i) => setCorregir({ objetivo: { mercado: f.marketplace_id, sku: f.sku, codigo: i.codigo, atributos: i.atributos, mensaje: i.mensaje, titulo: f.titulo } })}
              />
            </div>
          ) : !panel ? (
            <EsqueletoDelPanel />
          ) : !panel.ok ? (
            <EstadoVacio
              icono={TriangleAlert}
              acento="cumplimiento"
              titulo={panel.faltaMigracion ? 'Falta lanzar la migración 297' : 'No se ha podido leer el panel'}
              descripcion={panel.faltaMigracion ? 'Sin ella no se pueden sacar las cifras del panel. La pestaña «Listings» sí funciona.' : panel.error}
              accion={panel.faltaMigracion ? { texto: 'Ir a Listings', onClick: () => irA('listings') } : { texto: 'Volver a intentarlo', icono: RefreshCw, onClick: () => void recargar() }}
            />
          ) : activa === 'bloqueos' ? (
            <div className="flex flex-col gap-3">
              <SaludDeLaCuenta key={`salud-${cliente.slug}|${mercado}`} cliente={cliente.slug} mercado={mercado} />
              <PestanaBloqueos key={`${cliente.slug}|${mercado}`} cliente={cliente.slug} amazonClientId={cliente.amazonClientId ?? null} mercado={mercado} todos={mercado === TODOS} />
            </div>
          ) : activa === 'hoy' ? (
            <PestanaHoy
              panel={panel}
              cliente={cliente.slug}
              mercado={mercado}
              nombreCliente={cliente.nombre}
              nombrePais={nombrePais}
              verTarea={(t, soloStock) => irA('listings', filtroDeTarea(t, soloStock))}
              corregirTarea={(t) => setCorregir({ tarea: { titulo: ACCIONES[t.accion].titulo, codigos: t.codigos, mercado } })}
              vuelta={vuelta}
            />
          ) : activa === 'panel' ? (
            <PestanaPanel panel={panel} todos={mercado === TODOS} verPais={elegirPais} verIncidencias={() => irA('incidencias')} verCodigo={(c) => irA('listings', { codigo: c, gravedad: 'cualquiera' })} verHoy={() => irA('hoy')} />
          ) : (
            <PestanaIncidencias panel={panel} verCodigo={(c) => irA('listings', { codigo: c, gravedad: 'cualquiera' })} />
          )}
        </PanelDePestana>
      </div>

      <PanelCorregir
        abierto={corregir !== null}
        onCambio={(a) => !a && setCorregir(null)}
        cliente={cliente.slug}
        objetivo={corregir?.objetivo ?? null}
        tarea={corregir?.tarea ?? null}
        alTerminar={() => {
          setVuelta((v) => v + 1)
          void recargar()
        }}
      />
    </>
  )
}

function EsqueletoDelPanel() {
  return (
    <div className="grid max-w-[1240px] gap-4" aria-busy="true" aria-label="Cargando el panel">
      <FilaDeKpis>
        {Array.from({ length: 4 }, (_, i) => (
          <EsqueletoTarjeta key={i} alto={124} />
        ))}
      </FilaDeKpis>
      <div className="grid gap-3 lg:grid-cols-2">
        <EsqueletoTarjeta alto={190} />
        <EsqueletoTarjeta alto={190} />
      </div>
      <EsqueletoTarjeta alto={220} />
    </div>
  )
}

/** Los filtros de la lista para ver los listings de una tarea de «Hoy»: sus códigos, con cualquier gravedad */
function filtroDeTarea(t: TareaDeHoy, soloStock: boolean): Partial<FiltrosCumplimiento> {
  return { codigos: t.codigos, rotuloCodigos: ACCIONES[t.accion].titulo, gravedad: 'cualquiera', soloStock }
}


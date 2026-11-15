'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BriefcaseBusiness, Megaphone, PackageCheck, RefreshCw, Search, ShieldCheck, Truck, UserRound, Users, Wallet } from 'lucide-react'
import { NOMBRE_SEMANA } from '@/lib/cuentas/ciclo'
import { semaforos, tonoGeneral, urgencia, type Semaforo } from '@/lib/cuentas/salud'
import {
  Avatar,
  Boton,
  CabeceraDeModulo,
  Chispa,
  EsqueletoTarjeta,
  EstadoVacio,
  FilaDeKpis,
  Insignia,
  Kpi,
  Segmentado,
  Tarjeta,
  Variacion,
  formatoEuros,
  formatoPorcentaje,
  mezcla,
  TACTIL,
} from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { acosDe, entradaDeSalud, sumaPpc, type CuentaEnLista, type RespuestaCuentas } from './tipos'
import { DetalleDeCuenta, type PestanaDeCuenta } from './DetalleDeCuenta'
import { dinero, entero, porcentaje } from './formato'
import { Nota } from './piezas'
import { AnilloDeProgreso, colorDeTono, SemaforosCompactos } from './salud-ui'

type Filtro = 'mias' | 'todas' | 'sin'
type Foco = 'todo' | 'urgente'

interface CuentaConSalud {
  c: CuentaEnLista
  salud: Semaforo[]
  urgencia: number
}

/**
 * CUENTAS DE CLIENTES · EL CENTRO DE CONTROL. Arriba, las cifras de la cartera (las cuentas que llevas, o todas); debajo, una tarjeta por cliente con su salud
 * por área (semáforos), la semana del ciclo, la publicidad de 7 días y lo que tiene pendiente. Lo que más arde sale primero. Al pulsar una se abre su panel
 * (DetalleDeCuenta), que vive en la misma dirección con ?c=slug&t=pestaña para poder mandar el enlace.
 */
export function CuentasApp({ clienteInicial, pestanaInicial }: { clienteInicial: string | null; pestanaInicial?: string | null }) {
  const [datos, setDatos] = useState<RespuestaCuentas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(clienteInicial)
  // La pestaña del enlace (?t=) vale solo para el cliente con el que se entró: al volver a la lista y abrir otro, se empieza por el Resumen
  const [pestanaDeEntrada, setPestanaDeEntrada] = useState<string | null>(pestanaInicial ?? null)
  const [filtro, setFiltro] = useState<Filtro>('mias')
  const [foco, setFoco] = useState<Foco>('todo')
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch('/api/cuentas', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se han podido leer las cuentas.')
      setDatos(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer las cuentas.')
    } finally {
      setCargando(false)
    }
  }, [])

  // La lista solo se pide estando en la lista (o al volver): al entrar por un enlace a un cliente no hace falta calcular toda la cartera
  useEffect(() => {
    if (!abierto && !datos) cargar()
  }, [abierto, datos, cargar])

  // La dirección sigue al cliente abierto (para poder copiarla y mandarla); al volver a la lista se quita también la pestaña
  useEffect(() => {
    const url = new URL(window.location.href)
    if (abierto) url.searchParams.set('c', abierto)
    else {
      url.searchParams.delete('c')
      url.searchParams.delete('t')
    }
    window.history.replaceState(null, '', url.toString())
  }, [abierto])

  // EL SCROLL AL ABRIR Y AL VOLVER. La lista y el panel viven en la misma página y el documento hace scroll en la ventana: sin esto, al pulsar una tarjeta
  // de abajo el panel se abría con el scroll de la lista (665 px en el móvil) y se caía en mitad de la cuenta, sin ver ni el nombre ni las pestañas; y al
  // volver se perdía el sitio. Al abrir se guarda dónde estaba la lista y se sube arriba; al volver se recupera (15 nov 2026).
  const scrollDeLaLista = useRef<number | null>(null)
  const abrir = (slug: string) => {
    scrollDeLaLista.current = window.scrollY
    setAbierto(slug)
  }
  useLayoutEffect(() => {
    if (abierto) {
      window.scrollTo(0, 0)
    } else if (scrollDeLaLista.current != null) {
      const y = scrollDeLaLista.current
      scrollDeLaLista.current = null
      window.scrollTo(0, y)
    }
  }, [abierto])

  // La primera vez: si no llevas ninguna, se enseñan todas
  useEffect(() => {
    if (datos && !datos.clientes.some((c) => c.responsable?.id === datos.yo)) setFiltro('todas')
  }, [datos])

  const conSalud = useMemo<CuentaConSalud[]>(() => {
    if (!datos) return []
    return datos.clientes.map((c) => {
      const salud = semaforos(entradaDeSalud(c, datos.hoy))
      return { c, salud, urgencia: urgencia(salud) }
    })
  }, [datos])

  const enFiltro = useMemo(() => {
    if (!datos) return []
    return conSalud.filter(({ c }) => (filtro === 'mias' ? c.responsable?.id === datos.yo : filtro === 'sin' ? !c.responsable : true))
  }, [conSalud, datos, filtro])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es')
    return enFiltro
      .filter((x) => (foco === 'urgente' ? x.salud.some((s) => s.tono === 'rojo' || s.tono === 'ambar') : true))
      .filter((x) => !q || x.c.nombre.toLocaleLowerCase('es').includes(q) || (x.c.responsable?.nombre ?? '').toLocaleLowerCase('es').includes(q))
      .sort((a, b) => b.urgencia - a.urgencia || a.c.nombre.localeCompare(b.c.nombre, 'es'))
  }, [enFiltro, foco, busqueda])

  if (abierto) {
    return (
      <DetalleDeCuenta
        slug={abierto}
        pestanaInicial={(pestanaDeEntrada as PestanaDeCuenta | null) ?? null}
        volver={() => {
          setAbierto(null)
          setPestanaDeEntrada(null)
          // Al volver se refresca la lista (puede haber cambiado el responsable o lo hecho); si nunca se pidió, la pide el efecto
          if (datos) cargar()
        }}
        personas={datos?.personas ?? []}
      />
    )
  }

  const mias = datos?.clientes.filter((c) => c.responsable?.id === datos.yo).length ?? 0
  const sin = datos?.clientes.filter((c) => !c.responsable).length ?? 0
  const urgentes = enFiltro.filter((x) => x.salud.some((s) => s.tono === 'rojo' || s.tono === 'ambar')).length

  return (
    // Sin margen lateral propio por debajo de lg: la ruta ya pone p-6 y sumar px-4 dejaba 295 px útiles en un móvil de 375 (losetas cortadas, «Mark…»)
    <div className="mx-auto w-full max-w-[1280px] min-w-0 pb-12 lg:px-1">
      <CabeceraDeModulo
        icono={BriefcaseBusiness}
        acento="cuentas"
        titulo="Cuentas de clientes"
        subtitulo="El centro de control de cada cuenta: salud por área, qué toca esta semana, cómo va la publicidad y qué hay pendiente. Pulsa un cliente para abrir su panel."
        acciones={
          <Boton variante="secundario" icono={RefreshCw} onClick={cargar} cargando={cargando} disabled={cargando}>
            Actualizar
          </Boton>
        }
        debajo={
          datos ? (
            <div className="flex flex-wrap items-center gap-2">
              <Segmentado<Filtro>
                etiqueta="Qué cuentas"
                valor={filtro}
                onCambio={setFiltro}
                opciones={[
                  { id: 'mias', texto: 'Las mías', icono: UserRound, cuenta: mias },
                  { id: 'todas', texto: 'Todas', icono: Users, cuenta: datos.clientes.length },
                  { id: 'sin', texto: 'Sin responsable', cuenta: sin },
                ]}
              />
              <Segmentado<Foco>
                etiqueta="Qué enseñar"
                valor={foco}
                onCambio={setFoco}
                opciones={[
                  { id: 'todo', texto: 'Todo' },
                  { id: 'urgente', texto: 'Con algo que mirar', icono: AlertTriangle, cuenta: urgentes },
                ]}
              />
              <label className={cn('relative ml-auto flex h-9 w-full items-center sm:w-[240px]', TACTIL)}>
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--ls-t4)]" aria-hidden />
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar cliente o responsable"
                  aria-label="Buscar cliente o responsable"
                  className={cn('h-9 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] pl-9 pr-3 text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-linea2)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]', TACTIL)}
                />
              </label>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        {datos?.aviso307 && <Nota tono="ambar">{datos.aviso307}</Nota>}
        {error && <Nota tono="rojo">{error}</Nota>}

        {!datos && !error && <CargandoLista />}

        {datos && <KpisDeCartera cuentas={enFiltro.map((x) => x.c)} />}

        {datos && visibles.length === 0 && (
          <Tarjeta>
            <EstadoVacio
              icono={filtro === 'mias' ? UserRound : busqueda ? Search : PackageCheck}
              acento="cuentas"
              titulo={busqueda ? 'Ningún cliente coincide' : filtro === 'mias' ? 'No llevas ninguna cuenta todavía' : foco === 'urgente' ? 'Nada que mirar' : 'No hay clientes en esta vista'}
              descripcion={
                busqueda
                  ? 'Prueba con otra parte del nombre o del responsable.'
                  : filtro === 'mias'
                    ? 'Abre un cliente en «Todas» y ponte como responsable: a partir de ahí aparece aquí con su semana del ciclo.'
                    : foco === 'urgente'
                      ? 'Todas las cuentas de esta vista están en verde o sin datos. Buen momento para adelantar el ciclo.'
                      : 'Cuando un cliente tenga su cuenta de Amazon conectada aparecerá aquí.'
              }
              accion={
                busqueda
                  ? { texto: 'Quitar la búsqueda', onClick: () => setBusqueda('') }
                  : filtro === 'mias'
                    ? { texto: 'Ver todas las cuentas', onClick: () => setFiltro('todas') }
                    : foco === 'urgente'
                      ? { texto: 'Ver todas', onClick: () => setFoco('todo') }
                      : undefined
              }
            />
          </Tarjeta>
        )}

        {visibles.length > 0 && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))' }}>
            {visibles.map((x, i) => (
              <TarjetaDeCuenta key={x.c.slug} x={x} indice={i} abrir={() => abrir(x.c.slug)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CargandoLista() {
  return (
    <>
      <FilaDeKpis>
        {[0, 1, 2, 3, 4].map((i) => (
          <Kpi key={i} etiqueta="…" valor={null} cargando />
        ))}
      </FilaDeKpis>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 330px), 1fr))' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <EsqueletoTarjeta key={i} alto={300} />
        ))}
      </div>
    </>
  )
}

/** Las cifras de la cartera visible. El dinero se suma solo en euros: mezclar monedas daría una cifra que no existe */
function KpisDeCartera({ cuentas }: { cuentas: CuentaEnLista[] }) {
  const k = useMemo(() => {
    let gasto = 0
    let ventas = 0
    let gastoAnt = 0
    let ventasAnt = 0
    let otrasMonedas = false
    const serie: number[] = []
    let pendientes = 0
    let recuperable = 0
    let bloqueadas = 0
    let enCurso = 0
    let criticas = 0
    let altas = 0
    for (const c of cuentas) {
      for (const x of c.ppc.cuentas) {
        pendientes += x.pendientes
        if (x.moneda && x.moneda !== 'EUR') {
          if (x.ultimos.gasto > 0) otrasMonedas = true
          continue
        }
        gasto += x.ultimos.gasto
        ventas += x.ultimos.ventas
        gastoAnt += x.anteriores.gasto
        ventasAnt += x.anteriores.ventas
        recuperable += x.recuperable
        ;(x.serie ?? []).forEach((d, i) => (serie[i] = (serie[i] ?? 0) + d.gasto))
      }
      bloqueadas += c.cumplimiento?.atencionConStock ?? 0
      enCurso += c.remesas.abiertas
      criticas += c.remesas.alertas.critica
      altas += c.remesas.alertas.alta
    }
    return { gasto, ventas, gastoAnt, ventasAnt, otrasMonedas, serie, pendientes, recuperable, bloqueadas, enCurso, criticas, altas }
  }, [cuentas])

  const acos = acosDe(k)
  const acosAnt = acosDe({ gasto: k.gastoAnt, ventas: k.ventasAnt })
  return (
    <FilaDeKpis minimo={180}>
      <Kpi
        indice={0}
        etiqueta="Gasto Ads · 7 d"
        icono={Wallet}
        acento="marketing"
        valor={k.gasto}
        formato={(n) => formatoEuros(n)}
        anterior={k.gastoAnt}
        mejor="neutro"
        serie={k.serie.length > 1 ? k.serie : undefined}
        nota={k.otrasMonedas ? 'Solo cuentas en euros' : `${entero(cuentas.length)} ${cuentas.length === 1 ? 'cuenta' : 'cuentas'}`}
      />
      <Kpi indice={1} etiqueta="ACoS de la cartera" icono={Megaphone} acento="marketing" valor={acos} formato={(n) => formatoPorcentaje(n)} anterior={acosAnt} mejor="baja" nota={`Ventas Ads ${formatoEuros(k.ventas)}`} />
      <Kpi indice={2} etiqueta="Propuestas por revisar" icono={PackageCheck} acento="cuentas" valor={k.pendientes} nota={k.recuperable >= 1 ? `${formatoEuros(k.recuperable)} que no venden` : 'Del motor de PPC'} />
      <Kpi indice={3} etiqueta="Fichas con stock bloqueadas" icono={ShieldCheck} acento="cumplimiento" valor={k.bloqueadas} nota={k.bloqueadas > 0 ? 'Ventas que se pierden hoy' : 'Nada bloquea la venta'} />
      <Kpi
        indice={4}
        etiqueta="Envíos FBA en curso"
        icono={Truck}
        acento="remesas"
        valor={k.enCurso}
        nota={k.criticas + k.altas > 0 ? `${entero(k.criticas)} críticas · ${entero(k.altas)} altas` : 'Sin alertas graves'}
      />
    </FilaDeKpis>
  )
}

function TarjetaDeCuenta({ x, abrir, indice }: { x: CuentaConSalud; abrir: () => void; indice: number }) {
  const { c, salud } = x
  const s = sumaPpc(c.ppc.cuentas)
  const moneda = c.ppc.cuentas[0]?.moneda ?? 'EUR'
  const acos = acosDe(s)
  const acosAnt = acosDe({ gasto: s.gastoAnt, ventas: s.ventasAnt })
  const tacos = s.conTotales && s.totales > 0 ? s.gasto / s.totales : null
  const hechos = c.pasos.filter((p) => c.hechos.includes(p.id)).length
  const siguiente = c.pasos.find((p) => !c.hechos.includes(p.id))
  const general = tonoGeneral(salud)
  const colorGeneral = colorDeTono(general)
  const serie = useMemo(() => {
    const xs: number[] = []
    for (const cu of c.ppc.cuentas) (cu.serie ?? []).forEach((d, i) => (xs[i] = (xs[i] ?? 0) + d.gasto))
    return xs
  }, [c.ppc.cuentas])
  const bloquea = c.cumplimiento?.atencionConStock ?? 0
  const alertasFba = c.remesas.alertas.critica + c.remesas.alertas.alta

  return (
    <Tarjeta variante="interactiva" onClick={abrir} indice={indice} aria-label={`Abrir la cuenta de ${c.nombre}`} sinRelleno>
      {/* Filo de arriba con el color de la peor área: se ve de un vistazo en la rejilla */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: general === 'gris' ? 'transparent' : `linear-gradient(90deg, ${colorGeneral}, ${mezcla(colorGeneral, 0)})` }} />
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <Avatar nombre={c.nombre} tamano={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">{c.nombre}</div>
          <div className="mt-[3px] flex min-w-0 items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
            {c.responsable ? <Avatar nombre={c.responsable.nombre} tamano={16} /> : <UserRound className="h-3.5 w-3.5" aria-hidden />}
            <span className="truncate">{c.responsable?.nombre ?? 'Sin responsable'}</span>
          </div>
        </div>
        {c.semana ? (
          <AnilloDeProgreso hechos={hechos} total={c.pasos.length} tamano={42} />
        ) : (
          <Insignia tono="gris" tamano="sm">
            Sin ciclo
          </Insignia>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          {c.semana ? (
            <>
              <Insignia tono="verde" tamano="sm" punto={false}>
                {NOMBRE_SEMANA[c.semana.semana]}
              </Insignia>
              <span className="min-w-0 flex-1 truncate text-[var(--ls-t3)]">{siguiente ? `Siguiente: ${siguiente.titulo}` : 'Semana terminada'}</span>
            </>
          ) : (
            <span className="truncate text-[var(--ls-t4)]">Ábrela y elige cuándo empieza su S1.</span>
          )}
        </div>

        <SemaforosCompactos semaforos={salud} />

        <div className="rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)]">
          <div className="grid grid-cols-3 divide-x divide-[var(--ls-linea)]">
            <Cifra etiqueta="Gasto 7 d" valor={c.ppc.cuentas.length ? dinero(s.gasto, moneda) : '—'} extra={c.ppc.cuentas.length ? <Variacion actual={s.gasto} anterior={s.gastoAnt} mejor="neutro" /> : null} />
            <Cifra etiqueta="ACoS" valor={porcentaje(acos)} extra={acos != null && acosAnt != null ? <Variacion actual={acos} anterior={acosAnt} mejor="baja" /> : null} />
            <Cifra etiqueta="TACoS" valor={porcentaje(tacos)} />
          </div>
          {serie.some((v) => v > 0) && (
            <div className="border-t border-[var(--ls-linea)] pt-1">
              <Chispa valores={serie} color="var(--ls-mod-marketing)" alto={30} />
            </div>
          )}
        </div>

        <div className="flex min-h-[22px] flex-wrap gap-[6px]">
          {s.pendientes > 0 && (
            <Insignia tono="naranja" tamano="sm">
              {entero(s.pendientes)} propuestas PPC
            </Insignia>
          )}
          {s.recuperable >= 5 && (
            <Insignia tono="ambar" tamano="sm">
              {dinero(s.recuperable, moneda)} sin vender
            </Insignia>
          )}
          {bloquea > 0 && (
            <Insignia tono="rojo" tamano="sm" vivo>
              {entero(bloquea)} fichas bloqueadas
            </Insignia>
          )}
          {alertasFba > 0 && (
            <Insignia tono={c.remesas.alertas.critica > 0 ? 'rojo' : 'ambar'} tamano="sm">
              {entero(alertasFba)} alertas FBA
            </Insignia>
          )}
          {c.remesas.abiertas > 0 && (
            <Insignia tono="cian" tamano="sm">
              {entero(c.remesas.abiertas)} envíos en curso
            </Insignia>
          )}
          {c.ppc.cuentas.length === 0 && (
            <Insignia tono="gris" tamano="sm">
              Sin Amazon Ads
            </Insignia>
          )}
          {c.ppc.error && (
            <Insignia tono="rojo" tamano="sm">
              PPC sin leer
            </Insignia>
          )}
        </div>
      </div>
    </Tarjeta>
  )
}

function Cifra({ etiqueta, valor, extra }: { etiqueta: string; valor: string; extra?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-[9px]">
      <div className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</div>
      <div className="truncate text-[16px] font-semibold tabular-nums tracking-[-0.01em] text-[var(--ls-t1)]">{valor}</div>
      {extra && <div className="mt-[3px]">{extra}</div>}
    </div>
  )
}

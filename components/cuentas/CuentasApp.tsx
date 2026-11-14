'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, ChevronRight, RefreshCw, UserRound } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { NOMBRE_SEMANA } from '@/lib/cuentas/ciclo'
import { CAJA, Segmentado } from '@/components/marketing-test/piezas'
import { dinero, entero, porcentaje } from '@/components/marketing-test/formato'
import { Cargando } from '@/components/plataforma/comun'
import { acosDe, sumaPpc, type CuentaEnLista, type RespuestaCuentas } from './tipos'
import { DetalleDeCuenta } from './DetalleDeCuenta'
import { Chip, Nota } from './piezas'

type Filtro = 'mias' | 'todas' | 'sin'

/**
 * CUENTAS DE CLIENTES. Arriba, las cuentas que llevas (o todas); cada tarjeta dice en qué semana del ciclo está el cliente, qué falta de esa semana y
 * cómo van sus cifras. Al pulsar una se abre su panel (DetalleDeCuenta), que vive en la misma dirección con ?c=slug para poder mandar el enlace.
 */
export function CuentasApp({ clienteInicial }: { clienteInicial: string | null }) {
  const [datos, setDatos] = useState<RespuestaCuentas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(clienteInicial)
  const [filtro, setFiltro] = useState<Filtro>('mias')

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

  useEffect(() => {
    cargar()
  }, [cargar])

  // La dirección sigue al cliente abierto (para poder copiarla y mandarla), y el botón de atrás del navegador vuelve a la lista
  useEffect(() => {
    const url = new URL(window.location.href)
    if (abierto) url.searchParams.set('c', abierto)
    else url.searchParams.delete('c')
    window.history.replaceState(null, '', url.toString())
  }, [abierto])

  // La primera vez: si no llevas ninguna, se enseñan todas
  useEffect(() => {
    if (datos && !datos.clientes.some((c) => c.responsable?.id === datos.yo)) setFiltro('todas')
  }, [datos])

  const visibles = useMemo(() => {
    if (!datos) return []
    const xs = datos.clientes.filter((c) => (filtro === 'mias' ? c.responsable?.id === datos.yo : filtro === 'sin' ? !c.responsable : true))
    // Primero lo que tiene trabajo pendiente esta semana, luego por nombre
    return xs.sort((a, b) => pendientesDe(b) - pendientesDe(a) || a.nombre.localeCompare(b.nombre, 'es'))
  }, [datos, filtro])

  if (abierto) {
    return <DetalleDeCuenta slug={abierto} volver={() => (setAbierto(null), cargar())} personas={datos?.personas ?? []} />
  }

  const mias = datos?.clientes.filter((c) => c.responsable?.id === datos.yo).length ?? 0
  const sin = datos?.clientes.filter((c) => !c.responsable).length ?? 0

  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-4 px-1 pb-10">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[min(100%,300px)] flex-1 items-start gap-3">
        <BriefcaseBusiness className="mt-[3px] h-5 w-5 shrink-0 text-[var(--ls-acc)]" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-[var(--ls-t1)]">Cuentas de clientes</h1>
          <p className="text-[12.5px] text-[var(--ls-t3)]">Qué toca esta semana en cada cuenta, cómo van sus cifras y qué hay pendiente. Pulsa un cliente para abrir su panel.</p>
        </div>
        </div>
        {datos && (
          <Segmentado<Filtro>
            etiqueta="Qué cuentas"
            valor={filtro}
            cambiar={setFiltro}
            opciones={[
              { id: 'mias', texto: 'Las mías', cuenta: mias },
              { id: 'todas', texto: 'Todas', cuenta: datos.clientes.length },
              { id: 'sin', texto: 'Sin responsable', cuenta: sin },
            ]}
          />
        )}
        <button type="button" onClick={cargar} disabled={cargando} className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--ls-linea)] px-3 text-[12px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </header>

      {datos?.aviso307 && <Nota tono="ambar">{datos.aviso307}</Nota>}
      {error && <Nota tono="rojo">{error}</Nota>}
      {!datos && !error && <Cargando texto="Leyendo las cuentas…" />}

      {datos && visibles.length === 0 && (
        <div className={`${CAJA.base} px-4 py-6 text-[13px] text-[var(--ls-t3)]`}>
          {filtro === 'mias' ? 'No llevas ninguna cuenta todavía. Abre un cliente en «Todas» y ponte como responsable.' : 'No hay clientes en esta vista.'}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
        {visibles.map((c) => (
          <Tarjeta key={c.slug} c={c} abrir={() => setAbierto(c.slug)} />
        ))}
      </div>
    </div>
  )
}

const pendientesDe = (c: CuentaEnLista) => (c.semana ? c.pasos.filter((p) => !c.hechos.includes(p.id)).length : 0) + sumaPpc(c.ppc.cuentas).pendientes / 1000

function Tarjeta({ c, abrir }: { c: CuentaEnLista; abrir: () => void }) {
  const s = sumaPpc(c.ppc.cuentas)
  const moneda = c.ppc.cuentas[0]?.moneda ?? 'EUR'
  const acos = acosDe(s)
  const acosAnt = acosDe({ gasto: s.gastoAnt, ventas: s.ventasAnt })
  const tacos = s.conTotales && s.totales > 0 ? s.gasto / s.totales : null
  const hechos = c.pasos.filter((p) => c.hechos.includes(p.id)).length
  const siguiente = c.pasos.find((p) => !c.hechos.includes(p.id))
  const bloquea = c.cumplimiento?.atencionConStock ?? 0

  return (
    <button type="button" onClick={abrir} className={`${CAJA.base} group flex flex-col text-left transition-colors hover:border-[var(--ls-linea2)]`}>
      <div className={CAJA.cabecera}>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--ls-t1)]">{c.nombre}</span>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t3)]">
          <UserRound className="h-3 w-3" /> {c.responsable?.nombre ?? 'Sin responsable'}
        </span>
        <ChevronRight className="h-4 w-4 text-[var(--ls-t4)] group-hover:text-[var(--ls-t2)]" />
      </div>
      <div className={`${CAJA.cuerpo} flex flex-col gap-3`}>
        {c.semana ? (
          <div className="flex flex-col gap-[6px]">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="rounded-full px-2 py-[1px] font-semibold" style={{ color: 'var(--ls-acc)', background: 'color-mix(in srgb, var(--ls-acc) 12%, transparent)' }}>
                {NOMBRE_SEMANA[c.semana.semana]}
              </span>
              <span className="tabular-nums text-[var(--ls-t3)]">
                {hechos} de {c.pasos.length} hechos
              </span>
            </div>
            <div className="h-[4px] overflow-hidden rounded-full bg-[var(--ls-sup2)]">
              <div className="h-full rounded-full" style={{ width: `${(hechos / Math.max(1, c.pasos.length)) * 100}%`, background: hechos === c.pasos.length ? COLOR_ESTADO.verde : 'var(--ls-acc-graf)' }} />
            </div>
            <div className="truncate text-[12px] text-[var(--ls-t2)]">{siguiente ? `Siguiente: ${siguiente.titulo}` : 'Semana terminada'}</div>
          </div>
        ) : (
          <div className="text-[12px] text-[var(--ls-t3)]">Sin ciclo todavía: ábrelo y elige cuándo empieza su S1.</div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Cifra etiqueta="Gasto 7 días" valor={c.ppc.cuentas.length ? dinero(s.gasto, moneda, 0) : '—'} />
          <Cifra etiqueta="ACoS" valor={porcentaje(acos)} nota={acos != null && acosAnt != null ? `antes ${porcentaje(acosAnt)}` : undefined} />
          <Cifra etiqueta="TACoS" valor={porcentaje(tacos)} />
        </div>

        <div className="flex flex-wrap gap-[6px]">
          {s.pendientes > 0 && <Chip tono="naranja">{entero(s.pendientes)} propuestas de PPC</Chip>}
          {s.recuperable >= 5 && <Chip tono="ambar">{dinero(s.recuperable, moneda, 0)} sin vender</Chip>}
          {bloquea > 0 && <Chip tono="rojo">{entero(bloquea)} fichas con stock a revisar</Chip>}
          {c.ppc.cuentas.length === 0 && <Chip tono="gris">Sin Amazon Ads conectado</Chip>}
          {c.ppc.error && <Chip tono="rojo">PPC sin leer</Chip>}
        </div>
      </div>
    </button>
  )
}

function Cifra({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</div>
      <div className="truncate text-[16px] font-semibold tabular-nums text-[var(--ls-t1)]">{valor}</div>
      {nota && <div className="truncate text-[10.5px] text-[var(--ls-t4)]">{nota}</div>}
    </div>
  )
}

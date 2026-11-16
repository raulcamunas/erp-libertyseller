'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowRight, Repeat, Users } from 'lucide-react'
import { Avatar, BarraDeProgreso, Insignia, TablaAdaptable, Tarjeta, type Columna } from '@/components/ui-ls'
import { cuandoCorto, diaConSemana, diasHasta, entero, TEXTO_TIPO, type ComercialDelPanel, type PanelDeInformes } from './tipos'

/**
 * EL TURNO Y EL REPARTO POR COMERCIAL. Arriba, la tira: los últimos 30 informes hechos (el más nuevo a la derecha), «ahora» y los 10 que
 * vienen. Debajo, cuántos lleva cada uno, cuántos le quedan y cuándo acabaría al ritmo de ahora.
 */

/** useLayoutEffect sin el aviso del render en el servidor */
const useEfectoDeMaquetado = typeof window === 'undefined' ? useEffect : useLayoutEffect

function Ficha({ nombre, tipo, titulo, atenuada }: { nombre: string; tipo: 'amazon' | 'sin'; titulo: string; atenuada?: boolean }) {
  return (
    <span className={`relative flex shrink-0 flex-col items-center gap-1 ${atenuada ? 'opacity-55' : ''}`} title={titulo}>
      <Avatar nombre={nombre} tamano={30} />
      <span className="h-[3px] w-4 rounded-full" style={{ background: tipo === 'amazon' ? 'var(--viz-1)' : 'var(--viz-2)' }} aria-hidden />
    </span>
  )
}

export function TiraDeTurnos({ turno, indice }: { turno: PanelDeInformes['turno']; indice?: number }) {
  const ultimos = [...turno.ultimos].reverse()
  const pct = turno.cumplimiento
  // La tira va del más viejo al más nuevo: se abre por el final, donde están «ahora» y los próximos (en el móvil, si no, solo se veían los
  // más viejos). Se vuelve a llevar al final cada vez que cambia el turno.
  const tira = useRef<HTMLDivElement>(null)
  const firma = `${turno.ultimos[0]?.at ?? ''}|${turno.proximos.map((p) => `${p.id}:${p.tipo}`).join(',')}`
  useEfectoDeMaquetado(() => {
    const el = tira.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [firma])
  return (
    <Tarjeta
      indice={indice}
      icono={Repeat}
      acento="marca"
      titulo="Turno de comerciales"
      subtitulo="Uno de cada uno en este orden; al que no le quedan se le salta. A cada uno se le alterna Amazon y sin Amazon"
      acciones={
        pct == null ? (
          <Insignia tono="gris" title="Se mide desde que el turno lo decide el código">
            Cumplimiento: aún sin datos
          </Insignia>
        ) : (
          <Insignia tono={pct >= 0.9 ? 'verde' : pct >= 0.7 ? 'ambar' : 'rojo'} title={turno.desde ? `De los informes hechos desde ${cuandoCorto(turno.desde)}` : undefined}>
            {Math.round(pct * 100)} % en su turno
          </Insignia>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {turno.orden.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1.5">
            <span className="flex items-center gap-1.5 rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-0.5 pl-0.5 pr-2.5 text-[12.5px] text-[var(--ls-t2)]">
              <Avatar nombre={c.nombre} tamano={22} />
              <span className="tabular-nums text-[var(--ls-t4)]">{i + 1}.</span> {c.nombre}
            </span>
            {i < turno.orden.length - 1 && <ArrowRight className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />}
          </span>
        ))}
        <span className="ml-1 text-[11.5px] text-[var(--ls-t4)]">y vuelta a empezar</span>
      </div>

      <div ref={tira} className="ls-sin-barra mt-4 overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-1.5">
          {ultimos.map((u, i) => (
            <Ficha key={`u${i}`} nombre={u.nombre} tipo={u.tipo} titulo={`${u.nombre} · ${TEXTO_TIPO[u.tipo]} · ${cuandoCorto(u.at)}`} />
          ))}
          <span className="mx-1.5 flex flex-col items-center self-stretch">
            <span className="w-px flex-1 bg-[var(--ls-acc-graf)]" />
            <span className="mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ls-acc-graf)]">ahora</span>
          </span>
          {turno.proximos.map((p, i) => (
            <Ficha key={`p${i}`} nombre={p.nombre.replace(' (resto)', '')} tipo={p.tipo} atenuada titulo={`${i === 0 ? 'El siguiente' : `Dentro de ${i + 1}`}: ${p.nombre} · ${TEXTO_TIPO[p.tipo]}`} />
          ))}
        </div>
      </div>

      <p className="mt-3 text-[12.5px] text-[var(--ls-t3)]">
        {turno.siguiente ? (
          <>
            Siguiente: <span className="font-medium text-[var(--ls-t1)]">{turno.siguiente.nombre}</span> · {TEXTO_TIPO[turno.siguiente.tipo]}
          </>
        ) : (
          'No queda nada en las colas.'
        )}
        <span className="text-[var(--ls-t4)]"> · La rayita de color: </span>
        <span style={{ color: 'var(--viz-1)' }}>Amazon</span>
        <span className="text-[var(--ls-t4)]"> o </span>
        <span style={{ color: 'var(--viz-2)' }}>sin Amazon</span>
      </p>
    </Tarjeta>
  )
}

export function RepartoPorComercial({ comerciales, ahora, indice }: { comerciales: ComercialDelPanel[]; ahora: number; indice?: number }) {
  const columnas: Columna<ComercialDelPanel>[] = [
    {
      id: 'nombre',
      cabecera: 'Comercial',
      movil: 'titulo',
      ordenar: (c) => c.posicion ?? 99,
      celda: (c) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar nombre={c.nombre} tamano={26} />
          <span className="truncate font-medium text-[var(--ls-t1)]">{c.nombre}</span>
        </span>
      ),
    },
    {
      id: 'turno',
      cabecera: 'Turno',
      movil: 'insignia',
      celda: (c) =>
        c.enTurno ? (
          <Insignia tono="verde" tamano="sm">
            En turno n.º {c.posicion}
          </Insignia>
        ) : (
          <Insignia tono="gris" tamano="sm" title="No está en el orden de turnos: sus tiendas van cuando a los del turno no les quede nada">
            Fuera del turno
          </Insignia>
        ),
    },
    {
      id: 'hechos',
      cabecera: 'Hechos',
      alinear: 'derecha',
      ordenar: (c) => c.hechos.amazon + c.hechos.sin,
      celda: (c) => (
        <span title={`${entero(c.hechos.amazon)} de Amazon · ${entero(c.hechos.sin)} sin Amazon`}>
          {entero(c.hechos.amazon + c.hechos.sin)}
          <span className="ml-1 text-[11px] text-[var(--ls-t4)]">
            ({entero(c.hechos.amazon)} · {entero(c.hechos.sin)})
          </span>
        </span>
      ),
    },
    { id: 'hoy', cabecera: 'Hoy', alinear: 'derecha', ordenar: (c) => c.hechos.hoy, celda: (c) => <span className="font-medium text-[var(--ls-t1)]">{entero(c.hechos.hoy)}</span> },
    { id: 'ayer', cabecera: 'Ayer', alinear: 'derecha', ordenar: (c) => c.hechos.ayer, celda: (c) => entero(c.hechos.ayer) },
    {
      id: 'pendientes',
      cabecera: 'Le quedan',
      alinear: 'derecha',
      ordenar: (c) => c.pendientes.amazon + c.pendientes.sin,
      celda: (c) => (
        <span title={`${entero(c.pendientes.amazon)} de Amazon · ${entero(c.pendientes.sin)} sin Amazon`}>
          {entero(c.pendientes.amazon + c.pendientes.sin)}
          <span className="ml-1 text-[11px] text-[var(--ls-t4)]">
            ({entero(c.pendientes.amazon)} · {entero(c.pendientes.sin)})
          </span>
        </span>
      ),
    },
    {
      id: 'fin',
      cabecera: 'Acabaría',
      alinear: 'derecha',
      ordenar: (c) => (c.finEstimado ? Date.parse(c.finEstimado) : Number.MAX_SAFE_INTEGER),
      celda: (c) => {
        const quedan = c.pendientes.amazon + c.pendientes.sin
        if (!quedan) return <span className="text-[var(--ls-t4)]">Nada pendiente</span>
        if (!c.finEstimado) return '—'
        const d = diasHasta(c.finEstimado, ahora)
        return (
          <span className="whitespace-nowrap" title="Al ritmo de ahora, repartido por turnos (aproximado)">
            {diaConSemana(c.finEstimado)} <span className="text-[11px] text-[var(--ls-t4)]">· {d} d</span>
          </span>
        )
      },
    },
    {
      id: 'avance',
      cabecera: 'Avance',
      ancho: '140px',
      movil: 'oculto',
      ordenar: (c) => {
        const h = c.hechos.amazon + c.hechos.sin
        const t = h + c.pendientes.amazon + c.pendientes.sin
        return t ? h / t : 0
      },
      celda: (c) => {
        const h = c.hechos.amazon + c.hechos.sin
        const t = h + c.pendientes.amazon + c.pendientes.sin
        return <BarraDeProgreso valor={t ? h / t : 0} tamano="sm" acento="marca" mostrarPorcentaje />
      },
    },
    { id: 'saltados', cabecera: 'Saltados', alinear: 'derecha', ordenar: (c) => c.saltados, celda: (c) => entero(c.saltados) },
    {
      id: 'aperturas',
      cabecera: 'Abiertos · correo',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (c) => c.aperturas,
      celda: (c) => (
        <span title={`${entero(c.aperturas)} aperturas del informe · ${entero(c.enviados)} enviados por correo`}>
          {entero(c.aperturas)} <span className="text-[11px] text-[var(--ls-t4)]">· {entero(c.enviados)}</span>
        </span>
      ),
    },
  ]

  return (
    <Tarjeta indice={indice} icono={Users} acento="marca" titulo="Reparto por comercial" subtitulo="Hechos: por el dueño actual del lead. Pendientes: por el comercial de la cola" sinRelleno>
      <TablaAdaptable columnas={columnas} filas={comerciales} claveDe={(c) => c.id ?? 'sin-asignar'} porPagina={0} etiqueta="Informes por comercial" className="p-2 lg:p-0" />
    </Tarjeta>
  )
}

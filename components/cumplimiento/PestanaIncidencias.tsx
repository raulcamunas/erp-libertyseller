'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Segmentado } from '@/components/marketing-test/piezas'
import { ROTULO_NIVEL, ROTULO_TEMA, type Nivel } from '@/lib/cumplimiento/tipos'
import { ACCIONES, accionDe } from '@/lib/cumplimiento/acciones'
import { nivelDe } from '@/lib/cumplimiento/incidencias'
import type { CodigoDelPanel, PanelDeCumplimiento } from '@/lib/cumplimiento/panel-calculo'
import { COLOR_NIVEL, haceTiempo } from './comun'

type PanelOk = Extract<PanelDeCumplimiento, { ok: true }>
const cifra = (v: number) => v.toLocaleString('es-ES')
type Filtro = 'importantes' | Nivel

/**
 * La importancia de un código tal como llega agrupado de la base: si oculta algún listing, «bloquea» (es lo que más
 * pesa de él); si no, lo que diga nivelDe con su código, gravedad y tema.
 */
export function nivelDeCodigo(k: Pick<CodigoDelPanel, 'codigo' | 'gravedad' | 'tema' | 'mensaje' | 'ocultan'>, ahora: Date): Nivel {
  if (k.ocultan > 0) return 'bloquea'
  return nivelDe({ codigo: k.codigo, gravedad: k.gravedad, mensaje: k.mensaje, tema: k.tema, acciones: [], exencion: null }, ahora)
}

/** Lo que oculta con stock (o una cota sin la 306): es lo primero que hay que ver */
const ocultosConStock = (k: CodigoDelPanel) => k.ocultanConStock ?? (k.ocultan > 0 ? Math.min(k.ocultan, k.conStock) : 0)

/**
 * LAS INCIDENCIAS AGRUPADAS POR LO QUE DICE AMAZON: el mismo aviso en diez mil listings es una sola línea, con cuántos tiene, cuántos con stock y a cuántos está ocultando. Es por dónde se empieza a
 * arreglar: una plantilla corregida quita miles de golpe. Pulsar una abre la lista de esos listings.
 *
 * Cada código lleva delante QUÉ HAY QUE HACER (lib/cumplimiento/acciones.ts) y su importancia. Los avisos menores (no
 * cambian nada en la venta) no salen si no se piden: eran casi un tercio de las líneas.
 */
export function PestanaIncidencias({ panel, verCodigo }: { panel: PanelOk; verCodigo: (codigo: string) => void }) {
  const [filtro, setFiltro] = useState<Filtro>('importantes')
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)

  const conNivel = useMemo(() => {
    const ahora = new Date()
    return panel.codigos.map((k) => {
      const nivel = nivelDeCodigo(k, ahora)
      return { ...k, nivel, accion: accionDe(k, nivel) }
    })
  }, [panel.codigos])

  const lista = useMemo(() => {
    const b = q.trim().toLowerCase()
    return conNivel
      .filter((k) => (filtro === 'importantes' ? k.nivel !== 'menor' : k.nivel === filtro))
      .filter((k) => !b || k.mensaje.toLowerCase().includes(b) || k.codigo.includes(b) || ROTULO_TEMA[k.tema].corto.toLowerCase().includes(b) || ACCIONES[k.accion].titulo.toLowerCase().includes(b))
      .sort((a, z) => ocultosConStock(z) - ocultosConStock(a) || z.conStock - a.conStock || z.listings - a.listings)
  }, [conNivel, filtro, q])
  const cuenta = (n: Nivel) => conNivel.filter((k) => k.nivel === n).length

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Segmentado
            etiqueta="Importancia"
            opciones={[
              { id: 'importantes', texto: 'Lo importante', cuenta: conNivel.length - cuenta('menor') },
              { id: 'bloquea', texto: 'Bloquean', cuenta: cuenta('bloquea') },
              { id: 'normativa', texto: 'Normativa', cuenta: cuenta('normativa') },
              { id: 'afecta', texto: 'Se venden peor', cuenta: cuenta('afecta') },
              { id: 'menor', texto: 'Avisos menores', cuenta: cuenta('menor') },
            ]}
            valor={filtro}
            cambiar={(v) => setFiltro(v as Filtro)}
          />
        </div>
        <label className="relative ml-auto max-w-full">
          <span className="sr-only">Buscar en las incidencias</span>
          <Search className="pointer-events-none absolute left-[10px] top-[9px] h-[13px] w-[13px] text-[var(--ls-t4)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar mensaje, tarea o código" className="h-[30px] w-[280px] max-w-full rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
        </label>
      </div>

      <section className={CAJA.base}>
        {lista.length === 0 ? (
          <p className={`${CAJA.cuerpo} text-[12.5px] text-[var(--ls-t3)]`}>{panel.codigos.length === 0 ? 'Amazon no ha puesto ninguna incidencia a los listings revisados.' : 'Ninguna incidencia con ese filtro.'}</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
            <div className="hidden grid-cols-[minmax(0,1fr)_96px_96px_96px_120px] gap-3 bg-[var(--ls-sup2)] px-4 py-[8px] text-[11px] font-semibold text-[var(--ls-t4)] md:grid">
              <span>Qué hacer · lo que dice Amazon</span>
              <span className="text-right">Listings</span>
              <span className="text-right">Con stock</span>
              <span className="text-right">Los oculta</span>
              <span />
            </div>
            {lista.map((k) => {
              const ab = abierta === k.codigo
              return (
                <div key={k.codigo} className="grid grid-cols-1 gap-x-3 gap-y-2 px-4 py-[11px] md:grid-cols-[minmax(0,1fr)_96px_96px_96px_120px] md:items-start">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-label={ROTULO_NIVEL[k.nivel].corto} title={ROTULO_NIVEL[k.nivel].largo} className="mt-[6px] h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: COLOR_NIVEL[k.nivel], boxShadow: `0 0 0 3px color-mix(in srgb, ${COLOR_NIVEL[k.nivel]} 18%, transparent)` }} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold leading-[1.45] text-[var(--ls-t1)]">{ACCIONES[k.accion].titulo}</p>
                      <button type="button" onClick={() => setAbierta(ab ? null : k.codigo)} className={`text-left text-[12px] leading-[1.5] text-[var(--ls-t3)] ${ab ? '' : 'line-clamp-2'}`} title={ab ? 'Ver menos' : 'Ver el mensaje entero'}>
                        {k.mensaje || `Incidencia ${k.codigo}`}
                      </button>
                      <div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ls-t4)]">
                        <span className="rounded-[5px] px-[6px] py-[1px] font-semibold" style={{ color: COLOR_NIVEL[k.nivel], background: `color-mix(in srgb, ${COLOR_NIVEL[k.nivel]} 12%, transparent)` }}>{ROTULO_NIVEL[k.nivel].corto}</span>
                        <span>{ROTULO_TEMA[k.tema].corto}</span>
                        <span>· código {k.codigo}</span>
                        {k.desde && <span>· la primera, {haceTiempo(k.desde)}</span>}
                      </div>
                    </div>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--ls-t1)] md:text-right"><span className="text-[11px] font-normal text-[var(--ls-t4)] md:hidden">Listings </span>{cifra(k.listings)}</span>
                  <span className="text-[12.5px] tabular-nums text-[var(--ls-t2)] md:text-right"><span className="text-[11px] text-[var(--ls-t4)] md:hidden">Con stock </span>{cifra(k.conStock)}</span>
                  <span className="text-[12.5px] tabular-nums md:text-right" style={{ color: k.ocultan > 0 ? COLOR_ESTADO.rojo : 'var(--ls-t4)' }}><span className="text-[11px] text-[var(--ls-t4)] md:hidden">Los oculta </span>{cifra(k.ocultan)}</span>
                  <button type="button" onClick={() => verCodigo(k.codigo)} className="inline-flex h-[28px] items-center justify-center gap-1 justify-self-start rounded-[8px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] md:justify-self-end">
                    Ver listings <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
      <p className="text-[11px] text-[var(--ls-t4)]">
        Agrupadas por el código de Amazon ({cifra(panel.codigos.length)} distintos), lo que oculta con stock primero. El mensaje es el que más se repite con ese código; en cada listing puede nombrar un dato distinto.
        {!panel.exacto && filtro === 'menor' && <> Los avisos menores salen incompletos hasta lanzar la migración 306.</>}
      </p>
    </div>
  )
}

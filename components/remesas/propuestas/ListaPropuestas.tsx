'use client'

import { useMemo, useRef, useState } from 'react'
import { ClipboardList, Plus, Search } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import type { Actor } from '@/lib/fba/flujo'
import { diasEntre, FASES_PROPUESTA, leToca, turnoDe, type FasePropuesta } from '@/lib/fba/vista'
import { cx, Insignia, Vacio } from '../comun/ui'
import { useTecladoDeLista } from '../comun/useTeclado'
import { fecha } from '../formato'
import { INFO_FASE } from './FasesPropuesta'

/**
 * LA LISTA DE PROPUESTAS, POR FASES.
 *
 * Lo primero que hay que ver al llegar es qué espera A TI: cada tarjeta lleva
 * «te toca» o «espera al cliente», y dentro de cada fase las que llevan más tiempo
 * paradas salen primero. Las fases vacías no ocupan sitio, pero las cifras de
 * arriba siguen contando las cuatro y sirven de filtro.
 */

export function ListaPropuestas({
  propuestas,
  seleccionada,
  onElegir,
  verComo,
  hoy,
  puedeEditar,
  onNueva,
}: {
  propuestas: RemesaDePanel[]
  seleccionada: string | null
  onElegir: (id: string) => void
  verComo: Actor
  hoy: string
  puedeEditar: boolean
  onNueva: () => void
}) {
  const [fase, setFase] = useState<FasePropuesta | 'todas'>('todas')
  const [busca, setBusca] = useState('')

  const cuentas = useMemo(() => {
    const c: Record<FasePropuesta, number> = { borrador: 0, aprobada: 0, encajando: 0, lista: 0 }
    for (const r of propuestas) if (r.estado in c) c[r.estado as FasePropuesta] += 1
    return c
  }, [propuestas])

  const tocanAMi = propuestas.filter((r) => leToca(turnoDe(r.estado, r.lineas.length), verComo)).length

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return FASES_PROPUESTA.filter((f) => fase === 'todas' || fase === f)
      .map((f) => ({
        fase: f,
        items: propuestas
          .filter((r) => r.estado === f)
          .filter((r) => !q || (r.nombre ?? '').toLowerCase().includes(q) || r.lineas.some((l) => l.sku.toLowerCase().includes(q) || (l.nombre ?? '').toLowerCase().includes(q)))
          // Las que llevan más tiempo sin tocarse, primero
          .sort((a, b) => (a.actualizadaAt ?? a.fechaEnvio).localeCompare(b.actualizadaAt ?? b.fechaEnvio)),
      }))
      .filter((g) => g.items.length > 0)
  }, [propuestas, fase, busca])

  const raiz = useRef<HTMLElement>(null)
  useTecladoDeLista(raiz, grupos.flatMap((g) => g.items.map((r) => r.id)), seleccionada, onElegir)

  return (
    <aside ref={raiz} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o SKU" className={cx(CAMPO.input, 'h-[28px] pl-[26px]')} />
        </label>
        <div className="flex flex-wrap items-center gap-[6px]">
          <button type="button" onClick={() => setFase('todas')} className={cx(BOTON.chip, fase === 'todas' && BOTON.chipEncendido)}>
            Todas
            <span className="tabular-nums text-[var(--ls-t4)]">{propuestas.length}</span>
          </button>
          {FASES_PROPUESTA.map((f) => (
            <button key={f} type="button" onClick={() => setFase(f)} className={cx(BOTON.chip, fase === f && BOTON.chipEncendido, cuentas[f] === 0 && 'opacity-55')} title={INFO_FASE[f].pista}>
              {INFO_FASE[f].titulo}
              <span className="tabular-nums text-[var(--ls-t4)]">{cuentas[f]}</span>
            </button>
          ))}
        </div>
        {tocanAMi > 0 && (
          <p className="text-[11.5px] text-[var(--ls-t3)]">
            <span className="mr-[6px] inline-block h-[7px] w-[7px] rounded-full align-middle" style={{ background: 'var(--ls-acc-graf)' }} />
            {tocanAMi} {tocanAMi === 1 ? 'espera' : 'esperan'} a que muevas tú
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-[2px]">
        {grupos.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
            <Vacio
              icono={<ClipboardList />}
              titulo={propuestas.length === 0 ? 'No hay ninguna propuesta' : 'Nada con este filtro'}
              accion={
                propuestas.length === 0 && puedeEditar ? (
                  <button type="button" onClick={onNueva} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                    <Plus className="h-3 w-3" />
                    Nueva propuesta
                  </button>
                ) : undefined
              }
            >
              {propuestas.length === 0 ? 'Aquí se prepara lo que se va a mandar a Amazon: se propone, el cliente lo aprueba, lo etiqueta y lo encaja.' : 'Prueba con otra fase o quita la búsqueda.'}
            </Vacio>
          </div>
        )}

        {grupos.map((g) => (
          <section key={g.fase}>
            <h3 className="mb-[6px] flex items-center gap-2 px-[2px] text-[11px] font-semibold text-[var(--ls-t4)]">
              {INFO_FASE[g.fase].titulo}
              <span className="rounded-[4px] bg-[var(--ls-sup2)] px-[5px] py-[1px] tabular-nums">{g.items.length}</span>
              <span className="font-normal">· {INFO_FASE[g.fase].quien.toLowerCase()}</span>
            </h3>
            <div className="space-y-[6px]">
              {g.items.map((r) => (
                <TarjetaPropuesta key={r.id} remesa={r} activa={r.id === seleccionada} verComo={verComo} hoy={hoy} onClick={() => onElegir(r.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}

function TarjetaPropuesta({ remesa, activa, verComo, hoy, onClick }: { remesa: RemesaDePanel; activa: boolean; verComo: Actor; hoy: string; onClick: () => void }) {
  const turno = turnoDe(remesa.estado, remesa.lineas.length)
  const mio = leToca(turno, verComo)
  const unidades = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  const dias = remesa.actualizadaAt ? Math.max(0, diasEntre(remesa.actualizadaAt, hoy)) : null
  const parada = dias !== null && dias >= 7

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa}
      className={cx(
        'relative block w-full rounded-[8px] border px-[11px] py-[9px] text-left transition-colors',
        activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sel)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cx(TIPO.l, 'min-w-0 truncate text-[var(--ls-t1)]')}>{remesa.nombre ?? `Propuesta del ${fecha(remesa.fechaEnvio)}`}</p>
        {remesa.version > 1 && (
          <span className="shrink-0 rounded-[4px] border border-[var(--ls-linea2)] px-[5px] text-[10.5px] font-semibold tabular-nums text-[var(--ls-t3)]" title="Se ha reabierto: va por esta versión">
            v{remesa.version}
          </span>
        )}
      </div>
      <p className="mt-[1px] truncate text-[11px] text-[var(--ls-t4)]">
        {remesa.lineas.length} ref · {unidades.toLocaleString('es-ES')} ud · para el {fecha(remesa.fechaEnvio)}
      </p>
      <div className="mt-[7px] flex items-center justify-between gap-2">
        {mio ? (
          <Insignia tono="naranja" icono={<span className="h-[7px] w-[7px] rounded-full" style={{ background: 'currentColor' }} />} titulo={verComo === 'agencia' ? turno.paraAgencia : turno.paraCliente}>
            Te toca
          </Insignia>
        ) : (
          <Insignia tono="gris" icono={<span className="h-[7px] w-[7px] rounded-full border border-current" />} titulo={verComo === 'agencia' ? turno.paraAgencia : turno.paraCliente}>
            {verComo === 'agencia' ? 'Espera al cliente' : 'Espera a Liberty Seller'}
          </Insignia>
        )}
        {dias !== null && (
          <span className="text-[11px] tabular-nums" style={{ color: parada ? COLOR_ESTADO.ambar : 'var(--ls-t4)' }} title="Desde la última vez que se tocó">
            {dias === 0 ? 'hoy' : `hace ${dias} d`}
          </span>
        )}
      </div>
    </button>
  )
}

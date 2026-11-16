'use client'

import { useMemo, useRef, useState } from 'react'
import { ClipboardList, Plus, Search, Sparkles } from 'lucide-react'
import { Boton, EstadoVacio, Insignia } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import type { Actor } from '@/lib/fba/flujo'
import { diasEntre, FASES_PROPUESTA, leToca, turnoDe, type FasePropuesta } from '@/lib/fba/vista'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { cx } from '../comun/ui'
import { useTecladoDeLista } from '../comun/useTeclado'
import { fecha } from '../formato'
import { INFO_FASE } from './FasesPropuesta'

/**
 * LA LISTA DE PROPUESTAS, POR FASES.
 *
 * Lo primero que hay que ver al llegar es qué espera A TI: cada tarjeta lleva «te toca» o «espera al cliente»,
 * y dentro de cada fase las que llevan más tiempo paradas salen primero. Las fases vacías no ocupan sitio, pero
 * las cifras de arriba siguen contando las cuatro y sirven de filtro.
 *
 * Insignias (spec remesas-pro §8): «Del plan» si nació de un envío propuesto por el planificador (solo la ve la
 * agencia) y «vN» si se ha reabierto. La lista no tiene scroll propio: la página hace scroll normal y, en el
 * escritorio, quien la monta la pone en una columna pegajosa.
 */

/**
 * ¿Nació de un envío propuesto del plan? La remesa del panel no trae `envio_propuesto_id` (no está en
 * `RemesaDePanel`), pero «Convertir en remesa» guarda en su análisis `origen: 'planificador'` y el id del envío.
 * Al cliente de fuera no le llega el análisis (D26), y tampoco tiene por qué ver esta insignia.
 */
export function esDelPlan(r: Pick<RemesaDePanel, 'analisisIa'>): boolean {
  const a = r.analisisIa as (RemesaDePanel['analisisIa'] & { origen?: unknown; envioPropuestoId?: unknown }) | null
  return !!a && (a.origen === 'planificador' || typeof a.envioPropuestoId === 'string')
}

export function ListaPropuestas({
  propuestas,
  sesion,
  cliente,
  seleccionada,
  onElegir,
  hoy,
  onNueva,
  onNuevaIa,
}: {
  propuestas: RemesaDePanel[]
  sesion: SesionRemesas
  cliente: ClienteRemesas
  seleccionada: string | null
  onElegir: (id: string) => void
  hoy: string
  /** «Nueva propuesta» manual. También el cliente de fuera con `puede_editar` (D39) */
  onNueva: () => void
  /** «Propuesta a medida (IA)»: solo la agencia que edita este cliente */
  onNuevaIa?: () => void
}) {
  const verComo: Actor = sesion.actor
  const puedeEditar = cliente.puedeEditar
  const conIa = !!onNuevaIa && sesion.esAgencia && puedeEditar
  const [fase, setFase] = useState<FasePropuesta | 'todas'>('todas')
  const [busca, setBusca] = useState('')

  const cuentas = useMemo(() => {
    const c: Record<FasePropuesta, number> = { borrador: 0, aprobada: 0, encajando: 0, lista: 0 }
    for (const r of propuestas) if (r.estado in c) c[r.estado as FasePropuesta] += 1
    return c
  }, [propuestas])

  const tocanAMi = propuestas.filter((r) => leToca(turnoDe(r.estado, r.lineas.length, r.propuesta), verComo)).length

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

  const botones = puedeEditar ? (
    <div className="flex flex-wrap items-center gap-2">
      {conIa && (
        <Boton variante="primario" tamano="sm" icono={Sparkles} onClick={onNuevaIa} title="Que la IA mire el inventario y proponga qué mandar; tú lo revisas antes de crearla">
          Propuesta a medida (IA)
        </Boton>
      )}
      <Boton variante={conIa ? 'secundario' : 'primario'} tamano="sm" icono={Plus} onClick={onNueva}>
        Nueva propuesta
      </Boton>
    </div>
  ) : null

  return (
    <aside ref={raiz} className="flex min-w-0 flex-col gap-3" aria-label="Propuestas">
      <div className="flex flex-col gap-2">
        {propuestas.length > 0 && botones}
        <label className="relative block">
          <span className="sr-only">Buscar propuestas</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre o SKU"
            className={cx(CAMPO.input, 'h-9 rounded-[10px] pl-9 text-[13px] [@media(pointer:coarse)]:h-11')}
          />
        </label>
        {/* Fases como filtro: en el móvil la fila se desliza de lado en vez de partirse en tres líneas */}
        <div className="-mx-1 flex gap-[6px] overflow-x-auto [contain:inline-size] px-1 pb-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por fase">
          <Chip activo={fase === 'todas'} onClick={() => setFase('todas')} cuenta={propuestas.length}>
            Todas
          </Chip>
          {FASES_PROPUESTA.map((f) => (
            <Chip key={f} activo={fase === f} apagado={cuentas[f] === 0} onClick={() => setFase(f)} cuenta={cuentas[f]} titulo={INFO_FASE[f].pista}>
              {INFO_FASE[f].titulo}
            </Chip>
          ))}
        </div>
        {tocanAMi > 0 && (
          <p className="flex items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: COLOR_ESTADO.naranja }} aria-hidden />
            {tocanAMi} {tocanAMi === 1 ? 'espera' : 'esperan'} a que muevas tú
          </p>
        )}
      </div>

      {grupos.length === 0 && (
        <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)]">
          {propuestas.length === 0 ? (
            <EstadoVacio
              compacto
              icono={ClipboardList}
              acento="remesas"
              titulo="No hay ninguna propuesta"
              descripcion="Aquí se prepara lo que se va a mandar a Amazon: se propone, el cliente lo aprueba, lo etiqueta y lo encaja."
              accion={puedeEditar ? (conIa ? { texto: 'Propuesta a medida (IA)', onClick: onNuevaIa!, icono: Sparkles } : { texto: 'Nueva propuesta', onClick: onNueva, icono: Plus }) : undefined}
              accionSecundaria={puedeEditar && conIa ? { texto: 'Nueva propuesta manual', onClick: onNueva, icono: Plus } : undefined}
            />
          ) : (
            <EstadoVacio compacto icono={Search} acento="remesas" titulo="Nada con este filtro" descripcion="Prueba con otra fase o quita la búsqueda." accion={{ texto: 'Ver todas', onClick: () => { setFase('todas'); setBusca('') } }} />
          )}
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.fase} aria-label={INFO_FASE[g.fase].titulo}>
          <h3 className="mb-2 flex items-center gap-2 px-[2px] text-[12px] font-semibold text-[var(--ls-t3)]">
            {INFO_FASE[g.fase].titulo}
            <span className="rounded-full bg-[var(--ls-sup2)] px-[7px] py-[1px] text-[11px] tabular-nums text-[var(--ls-t3)]">{g.items.length}</span>
            <span className="font-normal text-[var(--ls-t4)]">· {INFO_FASE[g.fase].quien.toLowerCase()}</span>
          </h3>
          <div className="space-y-2">
            {g.items.map((r) => (
              <TarjetaPropuesta key={r.id} remesa={r} activa={r.id === seleccionada} verComo={verComo} conPlan={sesion.esAgencia} hoy={hoy} onClick={() => onElegir(r.id)} />
            ))}
          </div>
        </section>
      ))}
    </aside>
  )
}

function Chip({ activo, apagado, onClick, cuenta, titulo, children }: { activo: boolean; apagado?: boolean; onClick: () => void; cuenta: number; titulo?: string; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-pressed={activo}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-[6px] whitespace-nowrap rounded-full border px-3 text-[12.5px] transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:h-10',
        activo ? 'border-[color-mix(in_srgb,var(--ls-mod-remesas)_45%,var(--ls-linea))] bg-[color-mix(in_srgb,var(--ls-mod-remesas)_12%,var(--ls-sup))] font-medium text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:border-[var(--ls-linea2)]',
        apagado && !activo && 'opacity-55',
      )}
    >
      {children}
      <span className="tabular-nums text-[var(--ls-t4)]">{cuenta}</span>
    </button>
  )
}

function TarjetaPropuesta({ remesa, activa, verComo, conPlan, hoy, onClick }: { remesa: RemesaDePanel; activa: boolean; verComo: Actor; conPlan: boolean; hoy: string; onClick: () => void }) {
  const turno = turnoDe(remesa.estado, remesa.lineas.length, remesa.propuesta)
  const mio = leToca(turno, verComo)
  const unidades = remesa.lineas.reduce((s, l) => s + l.enviadas, 0)
  const dias = remesa.actualizadaAt ? Math.max(0, diasEntre(remesa.actualizadaAt, hoy)) : null
  const parada = dias !== null && dias >= 7
  const explica = verComo === 'agencia' ? turno.paraAgencia : turno.paraCliente

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa}
      className={cx(
        'relative block w-full overflow-hidden rounded-[14px] border px-[14px] py-3 text-left transition-colors motion-reduce:transition-none',
        activa
          ? 'border-[color-mix(in_srgb,var(--ls-mod-remesas)_50%,var(--ls-linea))] bg-[color-mix(in_srgb,var(--ls-mod-remesas)_8%,var(--ls-sup))] shadow-[var(--ls-sombra-1)]'
          : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)] lg:hover:bg-[var(--ls-sup2)]',
      )}
    >
      {activa && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: 'var(--ls-mod-remesas)' }} />}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{remesa.nombre ?? `Propuesta del ${fecha(remesa.fechaEnvio)}`}</p>
        <span className="flex shrink-0 items-center gap-1">
          {conPlan && esDelPlan(remesa) && (
            <Insignia tono="cian" variante="contorno" tamano="sm" punto={false} title="Nació de un envío propuesto por el planificador">
              Del plan
            </Insignia>
          )}
          {remesa.version > 1 && (
            <Insignia tono="violeta" variante="contorno" tamano="sm" punto={false} title="Se ha reabierto: va por esta versión">
              v{remesa.version}
            </Insignia>
          )}
        </span>
      </div>
      <p className="mt-[2px] truncate text-[12px] tabular-nums text-[var(--ls-t3)]">
        {remesa.lineas.length} ref · {unidades.toLocaleString('es-ES')} ud · para el {fecha(remesa.fechaEnvio)}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {mio ? (
          <Insignia tono="naranja" tamano="sm" title={explica}>
            {remesa.estado === 'borrador' && remesa.propuesta?.aceptoAt && verComo === 'agencia' ? 'Revisar cambios' : 'Te toca'}
          </Insignia>
        ) : (
          <Insignia tono="gris" variante="contorno" tamano="sm" title={explica}>
            {verComo === 'agencia' ? 'Espera al cliente' : 'Espera a Liberty Seller'}
          </Insignia>
        )}
        {dias !== null && (
          <span className="text-[11.5px] tabular-nums" style={{ color: parada ? COLOR_ESTADO.ambar : 'var(--ls-t4)' }} title={parada ? 'Lleva una semana o más sin moverse' : 'Desde la última vez que se tocó'}>
            {dias === 0 ? 'hoy' : `hace ${dias} d`}
          </span>
        )}
      </div>
    </button>
  )
}

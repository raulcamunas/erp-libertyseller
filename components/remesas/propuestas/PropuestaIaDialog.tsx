'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Info, Loader2, Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { Boton } from '@/components/ui-ls'
import { AVISO, CAMPO, CELDA, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { AnalisisIa } from '@/lib/fba/analisis-ia'
import type { PlazoEtapas } from '@/lib/fba/plan-tipos'
import type { PropuestaGenerada } from '@/lib/fba/propuesta-ia'
import type { LineaGenerada, Nivel, ParametrosReposicion } from '@/lib/fba/reposicion'
import { marketplaceById } from '@/lib/types/amazon'
import { sinRespuestaDe } from '../comun/errores'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { cx, Segmentado } from '../comun/ui'
import { fecha } from '../formato'
import { ESTADO_SKU, n0, n1, n2, pct } from '../inventario/formato'
import { EnPortal } from './NuevaPropuestaDialog'

/**
 * PROPUESTA A MEDIDA (IA): DEL INVENTARIO A UN BORRADOR REVISADO.
 *
 * (Antes «Propuesta con IA». El planificador propone los envíos de cada semana; esta es la propuesta hecha a
 * mano, con los ajustes que se quieran y el criterio de la IA. Spec remesas-pro §3.)
 *
 * Tres pasos y ninguno escribe en la base hasta el último clic:
 *
 *   AJUSTES    cuántos días debe aguantar el envío, cuánto tarda en estar a la venta, cuántas unidades como
 *              mucho, y lo que la agencia quiera decirle a la IA («Black Friday en seis semanas, no mandes la
 *              REF 8412»). Arrancan con los AJUSTES DEL CLIENTE (cobertura, caja, mínimo) y su plazo por etapas
 *              del planificador, no con números sueltos.
 *   GENERANDO  se lee el inventario, se calcula qué hace falta de cada referencia —restando lo que ya está en
 *              propuestas sin enviar— y la IA lo revisa con criterio. Tarda entre medio minuto y un minuto.
 *   REVISAR    la propuesta entera, referencia a referencia, con el porqué de cada línea. Todo se puede
 *              cambiar: la cantidad, quitar una línea, volver a generar. Solo cuando está como se quiere se crea
 *              el borrador.
 *
 * Una IA que monta envíos sin que nadie los vea sería muy rápida y muy poco de fiar: lo que propone se REVISA
 * aquí, y lo que se crea es un borrador como cualquier otro, que el cliente todavía tiene que aprobar.
 *
 * QUIÉN: la agencia que edita este cliente (antes, solo el administrador; la ruta lo comprueba). EL MERCADO: el
 * de la remesa del cliente (D20), no España fijo. Va en un portal, como los demás diálogos del módulo.
 */

type Fase = 'ajustes' | 'generando' | 'revisar'

interface LineaEditable {
  linea: LineaGenerada
  incluir: boolean
  /** Texto, para poder borrar el campo mientras se escribe */
  unidades: string
}

interface DelCliente {
  parametros?: ParametrosReposicion
  plazo?: { mediana: number | null; envios: number }
  plazoEtapas?: PlazoEtapas
  origenPlazo?: 'pasada' | 'calculado'
  mercadoRemesa?: string
  faltaMigracion316?: boolean
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const COBERTURAS = [30, 45, 60, 90]

const sumarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

const TONO_PRIORIDAD: Record<Nivel, { texto: string; color: string }> = {
  alta: { texto: 'Alta', color: COLOR_ESTADO.rojo },
  media: { texto: 'Media', color: COLOR_ESTADO.ambar },
  baja: { texto: 'Baja', color: COLOR_ESTADO.gris },
}

const ORIGEN_ETAPA: Record<string, string> = { manual: 'puesto a mano', medido: 'medido', partida: 'de partida' }

export function PropuestaIaDialog({
  sesion,
  cliente,
  hoy,
  marketplaceId,
  onCerrar,
  onCreada,
}: {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  hoy: string
  /** Solo para forzar otro mercado; por defecto el de la remesa del cliente (D20) */
  marketplaceId?: string
  onCerrar: () => void
  onCreada: (id: string) => void
}) {
  const clienteId = cliente.id
  const [fase, setFase] = useState<Fase>('ajustes')
  const [nombre, setNombre] = useState(`Reposición de ${MESES[Number(hoy.slice(5, 7)) - 1]}`)
  const [fecha_, setFecha] = useState(() => sumarDias(hoy, 3))
  const [cobertura, setCobertura] = useState(60)
  const [plazo, setPlazo] = useState('10')
  const [delCliente, setDelCliente] = useState<DelCliente | null>(null)
  const [margen, setMargen] = useState('7')
  const [multiplo, setMultiplo] = useState('1')
  const [minimo, setMinimo] = useState('2')
  const [tope, setTope] = useState('')
  const [notas, setNotas] = useState('')
  const [usarIa, setUsarIa] = useState(true)
  const [masOpciones, setMasOpciones] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<PropuestaGenerada | null>(null)
  const [filas, setFilas] = useState<LineaEditable[]>([])
  const [creando, setCreando] = useState(false)
  const [verFuera, setVerFuera] = useState(false)
  const control = useRef<AbortController | null>(null)

  const mercado = marketplaceId ?? propuesta?.mercadoRemesa ?? delCliente?.mercadoRemesa ?? cliente.mercadoRemesa
  const infoMercado = marketplaceById(mercado)

  // Los ajustes DEL CLIENTE (plazo por etapas del planificador, cobertura, caja y mínimo): no se empieza con números inventados
  useEffect(() => {
    let vivo = true
    fetch(`/api/fba/propuesta-ia?cliente=${clienteId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: DelCliente | null) => {
        if (!vivo || !p?.parametros) return
        setDelCliente(p)
        setPlazo(String(p.parametros.plazoDias))
        setCobertura(p.parametros.coberturaObjetivo || 60)
        setMargen(String(p.parametros.margenDias))
        setMultiplo(String(p.parametros.multiplo || 1))
        setMinimo(String(p.parametros.minimoLinea || 1))
        if (p.parametros.topeUnidades) setTope(String(p.parametros.topeUnidades))
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [clienteId])

  // Salir del diálogo con una petición en vuelo no deja nada colgando. Se lee `.current` al desmontar —el último
  // controlador, no el de cuando se montó—: por eso el alias, que además evita el aviso de react-hooks
  useEffect(() => {
    const c = control
    return () => c.current?.abort()
  }, [])

  async function generar() {
    setError(null)
    setFase('generando')
    control.current = new AbortController()
    try {
      const res = await fetch('/api/fba/propuesta-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: control.current.signal,
        body: JSON.stringify({
          clienteId,
          usarIa,
          parametros: { coberturaObjetivo: cobertura, plazoDias: plazo, margenDias: margen, multiplo, minimoLinea: minimo, topeUnidades: tope, notas: usarIa ? notas : '' },
        }),
      })
      const cuerpo = (await res.json().catch(() => null)) as { propuesta?: PropuestaGenerada; error?: string } | null
      if (!res.ok || !cuerpo?.propuesta) {
        setError(cuerpo?.error ?? sinRespuestaDe('No se ha podido generar la propuesta', res.status))
        setFase('ajustes')
        return
      }
      setPropuesta(cuerpo.propuesta)
      setFilas(cuerpo.propuesta.lineas.map((l) => ({ linea: l, incluir: true, unidades: String(l.unidades) })))
      setVerFuera(false)
      setFase('revisar')
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return
      setError('Se ha cortado la conexión con el servidor. Si la aplicación se estaba actualizando, espera un minuto; si no, revisa la conexión. Después vuelve a probar.')
      setFase('ajustes')
    }
  }

  function cancelarGeneracion() {
    control.current?.abort()
    setFase('ajustes')
  }

  /* ---------- lo que se va a crear ---------- */
  const elegidas = useMemo(
    () =>
      filas
        .filter((f) => f.incluir)
        .map((f) => ({ f, unidades: Number(f.unidades) }))
        .filter((x) => Number.isInteger(x.unidades) && x.unidades > 0),
    [filas]
  )
  const invalidas = filas.filter((f) => f.incluir && !(Number.isInteger(Number(f.unidades)) && Number(f.unidades) > 0)).length
  const totalUnidades = elegidas.reduce((s, x) => s + x.unidades, 0)
  const totalBase = filas.reduce((s, f) => s + f.linea.base, 0)

  async function crear() {
    if (!propuesta || elegidas.length === 0 || invalidas > 0) return
    setCreando(true)
    try {
      // El porqué de cada línea viaja con la propuesta: meses después se podrá contestar «¿por qué 120 de esto?»
      const analisis: Partial<AnalisisIa> = {
        version: 1,
        generadaEn: propuesta.generadaEn,
        ventasHasta: propuesta.leidoHasta,
        modelo: propuesta.ia.modelo,
        usada: propuesta.ia.usada,
        aviso: propuesta.ia.aviso,
        resumen: propuesta.resumen,
        estrategia: propuesta.estrategia,
        riesgos: propuesta.riesgos,
        dudas: propuesta.dudas,
        notas: propuesta.notas,
        parametros: propuesta.parametros,
        lineas: Object.fromEntries(
          propuesta.lineas.map((l) => [l.sku, { motivo: l.motivo, prioridad: l.prioridad, confianza: l.confianza, origen: l.origen, base: l.base, propuestas: l.unidades }])
        ),
        descartadas: propuesta.descartadas.map((d) => ({ sku: d.sku, nombre: d.nombre, motivo: d.motivo, base: d.base })),
      }
      const res = await fetch('/api/fba/remesas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId,
          marketplaceId: mercado,
          nombre: nombre.trim() || null,
          fechaEnvio: fecha_,
          referenciaEnvio: null,
          analisisIa: analisis,
          lineas: elegidas.map(({ f, unidades: u }) => ({
            sku: f.linea.sku,
            unidades: u,
            referencia: f.linea.referencia,
            nombre: f.linea.nombre,
            variante: f.linea.variante,
            ean: f.linea.ean,
            fnsku: f.linea.fnsku,
            asin: f.linea.asin,
          })),
        }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; id?: string; analisisGuardado?: boolean } | null
      if (!res.ok || !p?.id) {
        toast.error(p?.error ?? sinRespuestaDe('No se ha podido crear la propuesta', res.status))
        return
      }
      toast.success(`Propuesta creada: ${elegidas.length} referencias, ${n0(totalUnidades)} unidades`)
      if (p.analisisGuardado === false) {
        toast.warning('La propuesta se ha creado, pero no se ha guardado el análisis de la IA: falta lanzar la migración 230_fba_propuesta_ia.sql en Supabase.', { duration: 12_000 })
      }
      invalidarRemesas(clienteId)
      onCerrar()
      onCreada(p.id)
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Revisa la red y vuelve a probar.')
    } finally {
      setCreando(false)
    }
  }

  /* ---------- el pie, según la fase ---------- */
  const pie =
    fase === 'ajustes' ? (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <Boton variante="secundario" tamano="sm" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton variante="primario" tamano="sm" icono={Sparkles} onClick={() => void generar()}>
          {usarIa ? 'Generar con IA' : 'Generar sin IA'}
        </Boton>
      </div>
    ) : fase === 'generando' ? (
      <Boton variante="secundario" tamano="sm" onClick={cancelarGeneracion}>
        Cancelar
      </Boton>
    ) : (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <span className="mr-auto min-w-0 text-[12px] text-[var(--ls-t3)]">
          <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{elegidas.length}</b> referencia{elegidas.length === 1 ? '' : 's'} ·{' '}
          <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{n0(totalUnidades)}</b> unidades
          {totalBase > 0 && <span className="text-[var(--ls-t4)]"> (el cálculo solo: {n0(totalBase)})</span>}
          {invalidas > 0 && (
            <span className="ml-2" style={{ color: COLOR_ESTADO.ambar }}>
              {invalidas} sin unidades válidas
            </span>
          )}
        </span>
        <Boton variante="secundario" tamano="sm" icono={Undo2} disabled={creando} onClick={() => setFase('ajustes')}>
          Cambiar ajustes
        </Boton>
        <Boton variante="primario" tamano="sm" cargando={creando} disabled={elegidas.length === 0 || invalidas > 0} onClick={() => void crear()}>
          Crear propuesta
        </Boton>
      </div>
    )

  const etapas = delCliente?.plazoEtapas
  const coberturas = COBERTURAS.includes(cobertura) ? COBERTURAS : [...COBERTURAS, cobertura].sort((a, b) => a - b)

  return (
    <EnPortal>
      <Dialogo
        titulo="Propuesta a medida (IA)"
        entradilla={
          fase === 'revisar'
            ? `Revisa lo que propone para ${cliente.nombre}. Todo se puede cambiar antes de crear el borrador.`
            : `La IA mira el inventario de ${cliente.nombre} —stock, ritmo de venta, devoluciones, lo que lleva parado y lo que ya está en otras propuestas— y propone qué mandar a Amazon.`
        }
        onCerrar={onCerrar}
        ancho={fase === 'revisar' ? 'max-w-[1280px]' : 'max-w-[760px]'}
        pie={pie}
      >
        {fase === 'ajustes' && (
          <div className="space-y-3">
            {error && (
              <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.rojo }} role="alert">
                <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
                {error}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={CAMPO.etiqueta} htmlFor="pia-nombre">
                  Nombre
                </label>
                <input id="pia-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={cx(CAMPO.input, '[@media(pointer:coarse)]:h-11')} />
              </div>
              <div>
                <label className={CAMPO.etiqueta} htmlFor="pia-fecha">
                  Fecha prevista de envío
                </label>
                <input id="pia-fecha" type="date" value={fecha_} onChange={(e) => setFecha(e.target.value)} className={cx(CAMPO.input, '[@media(pointer:coarse)]:h-11')} />
                {infoMercado && <p className={CAMPO.nota}>Va a {infoMercado.label}.</p>}
              </div>
            </div>

            <div>
              <span className={CAMPO.etiqueta}>Cuántos días de venta debe aguantar el envío cuando llegue</span>
              <div className="-mx-[2px] overflow-x-auto [contain:inline-size] px-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <Segmentado valor={cobertura} onCambio={setCobertura} etiqueta="Cobertura objetivo" opciones={coberturas.map((d) => ({ id: d, texto: <>{d} días</> }))} />
              </div>
              <p className={CAMPO.nota}>
                Más días es más seguro frente a roturas de stock, y más almacenaje y más dinero parado. De octubre a diciembre el almacenaje cuesta casi el doble.
                {delCliente?.parametros && <> Arranca con la cobertura de los ajustes de reposición del cliente.</>}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={CAMPO.etiqueta} htmlFor="pia-plazo">
                  Días hasta que está a la venta
                </label>
                <input id="pia-plazo" inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '[@media(pointer:coarse)]:h-11')} />
                <p className={CAMPO.nota}>
                  Lo que tarda un envío en prepararse, llegar y recibirse. Mientras tanto se sigue vendiendo.
                  {etapas && (
                    <>
                      {' '}
                      Del plazo del cliente: preparación {etapas.preparacion} ({ORIGEN_ETAPA[etapas.origen.preparacion] ?? etapas.origen.preparacion}), transporte {etapas.transporte} (
                      {ORIGEN_ETAPA[etapas.origen.transporte] ?? etapas.origen.transporte}) y recepción {etapas.recepcion} ({ORIGEN_ETAPA[etapas.origen.recepcion] ?? etapas.origen.recepcion}).
                    </>
                  )}
                  {delCliente?.plazo && delCliente.plazo.mediana !== null && (
                    <>
                      {' '}
                      Sus envíos tardan {n0(delCliente.plazo.mediana)} días en llegar (medido con {delCliente.plazo.envios}).
                    </>
                  )}
                </p>
              </div>
              <div>
                <label className={CAMPO.etiqueta} htmlFor="pia-tope">
                  Máximo de unidades (opcional)
                </label>
                <input id="pia-tope" inputMode="numeric" value={tope} onChange={(e) => setTope(e.target.value)} placeholder="Sin tope" className={cx(CAMPO.input, CAMPO.numero, '[@media(pointer:coarse)]:h-11')} />
                <p className={CAMPO.nota}>Lo que tiene el cliente en su almacén, o las cajas que caben. Si se pasa, se deja fuera lo menos urgente.</p>
              </div>
            </div>

            {delCliente?.faltaMigracion316 && (
              <p className="flex items-start gap-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">
                <Info className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
                Falta lanzar la migración 316: los ajustes de reposición del cliente son los de partida.
              </p>
            )}

            <div>
              <label className={CAMPO.etiqueta} htmlFor="pia-notas">
                Qué quieres que tenga en cuenta (opcional){!usarIa && <span className="font-normal"> · solo con la IA</span>}
              </label>
              <textarea
                id="pia-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                disabled={!usarIa}
                rows={3}
                maxLength={1500}
                placeholder="Black Friday en seis semanas. No mandes la REF 8412, la descatalogan. El cliente solo tiene unos 300 pares en su almacén."
                className={cx(CAMPO.input, 'h-auto py-2', !usarIa && 'opacity-50')}
              />
            </div>

            <button type="button" onClick={() => setMasOpciones((v) => !v)} className="inline-flex min-h-[32px] items-center gap-1 text-[12px] text-[var(--ls-t3)] hover:text-[var(--ls-t1)]" aria-expanded={masOpciones}>
              <ChevronDown className={cx('h-3 w-3 transition-transform motion-reduce:transition-none', masOpciones && 'rotate-180')} aria-hidden />
              Más ajustes
            </button>
            {masOpciones && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={CAMPO.etiqueta} htmlFor="pia-margen">
                    Margen de seguridad (días)
                  </label>
                  <input id="pia-margen" inputMode="numeric" value={margen} onChange={(e) => setMargen(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '[@media(pointer:coarse)]:h-11')} />
                  <p className={CAMPO.nota}>Un colchón de días de venta sobre la cobertura.</p>
                </div>
                <div>
                  <label className={CAMPO.etiqueta} htmlFor="pia-multiplo">
                    Se manda de N en N
                  </label>
                  <input id="pia-multiplo" inputMode="numeric" value={multiplo} onChange={(e) => setMultiplo(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '[@media(pointer:coarse)]:h-11')} />
                  <p className={CAMPO.nota}>Cajas de N unidades. 1 = sin múltiplo.</p>
                </div>
                <div>
                  <label className={CAMPO.etiqueta} htmlFor="pia-minimo">
                    Mínimo por línea
                  </label>
                  <input id="pia-minimo" inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value)} className={cx(CAMPO.input, CAMPO.numero, '[@media(pointer:coarse)]:h-11')} />
                  <p className={CAMPO.nota}>Por debajo, solo si es urgente.</p>
                </div>
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[10px]">
              <input type="checkbox" checked={usarIa} onChange={(e) => setUsarIa(e.target.checked)} className="mt-[3px] h-4 w-4" />
              <span className="text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                <b className="font-semibold text-[var(--ls-t1)]">Usar la IA</b> para revisar el cálculo con criterio: tendencia, devoluciones, lo que ya está parado, las fechas de venta fuerte. Sin ella sale solo la cuenta: ritmo de venta por días de cobertura. Se envían a la IA referencias y unidades de este cliente, nada más.
              </span>
            </label>
            {!sesion.esAgencia && <p className={CAMPO.nota}>La propuesta a medida la genera Liberty Seller.</p>}
          </div>
        )}

        {fase === 'generando' && (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center" aria-live="polite">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--ls-mod-remesas)]" aria-hidden />
            <p className="text-[13.5px] font-semibold text-[var(--ls-t1)]">{usarIa ? 'Analizando el inventario y pensando qué mandar…' : 'Calculando qué hace falta…'}</p>
            <p className="max-w-[420px] text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">
              {usarIa ? 'Se lee el libro mayor de Amazon, se calcula cada referencia y la IA revisa las candidatas una a una. Tarda entre medio minuto y un minuto.' : 'Se lee el libro mayor de Amazon y se calcula cada referencia. Son unos segundos.'}
            </p>
          </div>
        )}

        {fase === 'revisar' && propuesta && (
          <Revision propuesta={propuesta} filas={filas} onFilas={setFilas} multiplo={propuesta.parametros.multiplo} verFuera={verFuera} onVerFuera={() => setVerFuera((v) => !v)} />
        )}
      </Dialogo>
    </EnPortal>
  )
}

/* ------------------------------------------------------------------ */
/* La revisión                                                         */
/* ------------------------------------------------------------------ */

function Revision({
  propuesta,
  filas,
  onFilas,
  multiplo,
  verFuera,
  onVerFuera,
}: {
  propuesta: PropuestaGenerada
  filas: LineaEditable[]
  onFilas: (f: LineaEditable[]) => void
  multiplo: number
  verFuera: boolean
  onVerFuera: () => void
}) {
  const cambia = (sku: string, parche: Partial<LineaEditable>) => onFilas(filas.map((f) => (f.linea.sku === sku ? { ...f, ...parche } : f)))
  // Las ventas con las que se ha calculado llegan hasta un día: lo vendido desde entonces no cuenta, y con unos días
  // de atraso una referencia que parece a punto de agotarse puede llevar días agotada
  const atraso = propuesta.leidoHasta ? diasEntre(propuesta.leidoHasta, propuesta.hoy) : null
  const avisoVentas =
    atraso !== null && atraso >= 2
      ? `Las ventas de este cliente están leídas hasta el ${fecha(propuesta.leidoHasta)}: hace ${atraso} días. La propuesta no cuenta lo vendido desde entonces. Se ponen al día con «Leer ventas de Amazon»; después, vuelve a generarla.`
      : null
  // Lo que ya está en otras propuestas sin enviar se ha RESTADO (cambio de comportamiento anotado, §3)
  const c = propuesta.comprometido
  const avisoComprometido =
    c && c.unidades > 0
      ? `Se han restado ${n0(c.unidades)} ud que ya están en ${c.remesas} propuesta${c.remesas === 1 ? '' : 's'} sin enviar (${c.referenciasCubiertas} referencia${c.referenciasCubiertas === 1 ? '' : 's'} ya cubierta${c.referenciasCubiertas === 1 ? '' : 's'}).`
      : null
  const avisoParado =
    c && c.parado.unidades > 0
      ? `Hay ${n0(c.parado.unidades)} ud en ${c.parado.remesas} propuesta${c.parado.remesas === 1 ? '' : 's'} parada${c.parado.remesas === 1 ? '' : 's'} desde hace semanas: no se han restado.`
      : null
  // El aviso de «la IA no ha contestado» ya sale en su propio recuadro; el resto, aparte
  const avisos = [
    ...(avisoVentas ? [avisoVentas] : []),
    ...(propuesta.avisosInventario ?? []),
    ...(propuesta.resumen && propuesta.ia.aviso ? [propuesta.ia.aviso] : []),
    ...propuesta.notas,
    ...(avisoParado ? [avisoParado] : []),
  ]

  return (
    // A la altura de la pantalla, para que «Crear propuesta» no quede nunca fuera de la vista: lo de la IA arriba,
    // con su propio scroll si es largo, y las líneas ocupando el resto con el suyo
    <div className="flex h-[calc(92dvh-170px)] min-h-[380px] flex-col gap-3">
      <div className="max-h-[40%] min-h-0 shrink-0 space-y-2 overflow-y-auto pr-[2px]">
        {/* ---------- lo que dice la IA ---------- */}
        {propuesta.resumen ? (
          <div className="rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[10px]">
            <div className="mb-1 flex items-center gap-2 text-[11.5px] font-semibold text-[var(--ls-mod-remesas)]">
              <Sparkles className="h-3 w-3" aria-hidden />
              La IA dice{propuesta.ia.modelo && <span className="font-normal text-[var(--ls-t4)]">· {propuesta.ia.modelo}</span>}
            </div>
            <p className="text-[13px] leading-[1.55] text-[var(--ls-t1)]">{propuesta.resumen}</p>
            {propuesta.estrategia && <p className="mt-1 text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">Criterio: {propuesta.estrategia}</p>}
          </div>
        ) : (
          <div className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
            <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
            <span>
              <b className={AVISO.fuerte}>Esta propuesta no lleva el criterio de la IA: sale solo de la cuenta.</b> {propuesta.ia.aviso ?? ''}
            </span>
          </div>
        )}

        {avisoComprometido && (
          <p className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.azul }}>
            <Info className={AVISO.icono} style={{ color: COLOR_ESTADO.azul }} />
            {avisoComprometido}
          </p>
        )}

        {avisos.length > 0 && (
          <ul className="space-y-[6px]">
            {avisos.map((a) => (
              <li key={a} className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
                <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
                {a}
              </li>
            ))}
          </ul>
        )}

        {(propuesta.riesgos.length > 0 || propuesta.dudas.length > 0) && (
          <div className="grid gap-2 md:grid-cols-2">
            {propuesta.riesgos.length > 0 && <Lista titulo="Riesgos a vigilar" textos={propuesta.riesgos} />}
            {propuesta.dudas.length > 0 && <Lista titulo="Por confirmar con el cliente" textos={propuesta.dudas} />}
          </div>
        )}
      </div>

      {/* ---------- las líneas, y debajo lo que se deja fuera: un solo scroll ---------- */}
      <div className="min-h-[200px] flex-1 overflow-auto rounded-[10px] border border-[var(--ls-linea)]">
        {/* Escritorio: la tabla de siempre, con la cabecera pegada */}
        <table className={cx(TABLA.tabla, 'hidden md:table')}>
          <thead>
            <tr>
              <th className={cx(TABLA.cabecera, 'w-8')} aria-label="Incluir" />
              <th className={cx(TABLA.cabecera, 'min-w-[250px]')}>Producto</th>
              <th className={cx(TABLA.cabecera, TABLA.derecha)} title="En Amazon: vendibles + lo que viene de camino">
                Stock
              </th>
              <th className={cx(TABLA.cabecera, TABLA.derecha)}>Ud/día</th>
              <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Días que dura el stock vendible al ritmo actual">
                Días
              </th>
              <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Devoluciones sobre lo vendido en 90 días">
                Devol.
              </th>
              <th className={cx(TABLA.cabecera, TABLA.derecha)} title="Lo que sale de la cuenta, sin la IA">
                Cálculo
              </th>
              <th className={cx(TABLA.cabecera, TABLA.derecha)}>Mandar</th>
              <th className={TABLA.cabecera}>Prioridad</th>
              <th className={TABLA.cabecera}>Por qué</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const l = f.linea
              const editada = Number(f.unidades) !== l.unidades
              const pri = TONO_PRIORIDAD[l.prioridad]
              return (
                <tr key={l.sku} className={cx(TABLA.fila, !f.incluir && 'opacity-45')}>
                  <td className={cx(TABLA.celda, 'text-center')}>
                    <input type="checkbox" checked={f.incluir} onChange={(e) => cambia(l.sku, { incluir: e.target.checked })} aria-label={`Incluir ${l.sku}`} />
                  </td>
                  <td className={cx(TABLA.celda, 'max-w-[300px]')}>
                    <div className="flex items-baseline gap-2 overflow-hidden">
                      <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{l.sku}</span>
                      <span className="truncate text-[var(--ls-t1)]" title={l.nombre ?? ''}>
                        {l.referencia && <span className="mr-1 text-[var(--ls-t3)]">{l.referencia}</span>}
                        {l.nombre ?? '—'}
                        {l.variante && <span className="ml-1 text-[var(--ls-t3)]">· {l.variante}</span>}
                      </span>
                    </div>
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero)} title={`${ESTADO_SKU[l.estado].texto}${l.comprometido > 0 ? ` · ${l.comprometido} en otras propuestas` : ''}`}>
                    {n0(l.vendibles)}
                    {l.entrante > 0 && <span className="text-[var(--ls-t4)]"> +{n0(l.entrante)}</span>}
                    {l.comprometido > 0 && <span className="text-[var(--ls-t4)]"> ·{n0(l.comprometido)}</span>}
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero)}>
                    <span className="inline-flex items-center justify-end gap-[3px]">
                      {l.tendencia === 'sube' && <ArrowUp className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} aria-label="al alza" />}
                      {l.tendencia === 'baja' && <ArrowDown className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} aria-label="a la baja" />}
                      {n2(l.ritmo)}
                    </span>
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{l.cobertura === null ? '—' : n1(l.cobertura)}</td>
                  <td className={cx(TABLA.celda, TABLA.numero)} style={l.tasaDevolucion !== null && l.tasaDevolucion >= 0.12 ? { color: COLOR_ESTADO.ambar } : undefined}>
                    {l.tasaDevolucion === null ? <span className="text-[var(--ls-t4)]">—</span> : pct(l.tasaDevolucion)}
                  </td>
                  <td className={cx(TABLA.celda, TABLA.numero, 'text-[var(--ls-t3)]')}>{n0(l.base)}</td>
                  <td className={TABLA.celda}>
                    <input
                      value={f.unidades}
                      onChange={(e) => cambia(l.sku, { unidades: e.target.value.replace(/[^\d]/g, '') })}
                      inputMode="numeric"
                      step={multiplo}
                      aria-label={`Unidades de ${l.sku}`}
                      className={cx(CELDA.editable, CELDA.numero, '!w-[58px] font-semibold !text-[var(--ls-t1)]', editada && '!border-[var(--ls-acc-graf)]')}
                      title={editada ? `La propuesta era ${l.unidades}` : undefined}
                    />
                  </td>
                  <td className={TABLA.celda}>
                    <span className="inline-flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t2)]">
                      <span className="h-[7px] w-[7px] rounded-full" style={{ background: pri.color }} aria-hidden />
                      {pri.texto}
                      {l.origen === 'calculo' && propuesta.ia.usada && (
                        <span className="text-[var(--ls-t4)]" title="La IA no la ha comentado: es la cantidad del cálculo">
                          ·cálculo
                        </span>
                      )}
                    </span>
                  </td>
                  {/* La anchura la pone el div: una celda con texto largo se estira a una sola línea y se sale del diálogo */}
                  <td className={cx(TABLA.celda, '!whitespace-normal py-[4px]')} style={{ height: 'auto' }}>
                    <div className="w-[440px] text-[12px] leading-[1.4] text-[var(--ls-t2)]">{l.motivo}</div>
                  </td>
                </tr>
              )
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={10} className={cx(TABLA.celda, 'h-16 text-center text-[var(--ls-t4)]')}>
                  Ahora mismo no hace falta mandar nada.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Móvil: una tarjeta por referencia (diez columnas no caben en 375 px) */}
        <ul className="divide-y divide-[var(--ls-linea)] md:hidden">
          {filas.map((f) => {
            const l = f.linea
            const editada = Number(f.unidades) !== l.unidades
            const pri = TONO_PRIORIDAD[l.prioridad]
            return (
              <li key={l.sku} className={cx('px-3 py-3', !f.incluir && 'opacity-50')}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={f.incluir} onChange={(e) => cambia(l.sku, { incluir: e.target.checked })} aria-label={`Incluir ${l.sku}`} className="mt-[3px] h-5 w-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-[var(--ls-t1)]" title={l.nombre ?? ''}>
                      {l.referencia && <span className="mr-1 text-[var(--ls-t3)]">{l.referencia}</span>}
                      {l.nombre ?? '—'}
                      {l.variante && <span className="ml-1 text-[var(--ls-t3)]">· {l.variante}</span>}
                    </p>
                    <p className="truncate font-mono text-[11.5px] text-[var(--ls-t4)]">{l.sku}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-[2px] text-[12px] tabular-nums text-[var(--ls-t3)]">
                      <span>
                        Stock {n0(l.vendibles)}
                        {l.entrante > 0 && ` +${n0(l.entrante)}`}
                      </span>
                      <span>{n2(l.ritmo)} ud/día</span>
                      <span>{l.cobertura === null ? '—' : `${n1(l.cobertura)} días`}</span>
                      <span>Cálculo {n0(l.base)}</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-[7px] w-[7px] rounded-full" style={{ background: pri.color }} aria-hidden />
                        {pri.texto}
                      </span>
                    </p>
                    {l.motivo && <p className="mt-1 text-[12px] leading-[1.45] text-[var(--ls-t2)]">{l.motivo}</p>}
                  </div>
                  <label className="flex shrink-0 flex-col items-end gap-[2px]">
                    <span className="text-[10.5px] text-[var(--ls-t4)]">Mandar</span>
                    <input
                      value={f.unidades}
                      onChange={(e) => cambia(l.sku, { unidades: e.target.value.replace(/[^\d]/g, '') })}
                      inputMode="numeric"
                      aria-label={`Unidades de ${l.sku}`}
                      className={cx(CAMPO.input, CAMPO.numero, 'h-10 !w-[68px] font-semibold', editada && '!border-[var(--ls-acc-graf)]')}
                    />
                  </label>
                </div>
              </li>
            )
          })}
          {filas.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-[var(--ls-t4)]">Ahora mismo no hace falta mandar nada.</li>}
        </ul>

        {/* ---------- lo que se deja fuera ---------- */}
        {propuesta.descartadas.length > 0 && (
          <div className="border-t border-[var(--ls-linea)]">
            <button type="button" onClick={onVerFuera} className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3 py-[9px] text-left" aria-expanded={verFuera}>
              <span className="min-w-0 text-[13px] font-semibold text-[var(--ls-t1)]">
                Lo que se deja fuera
                <span className="ml-2 text-[12px] font-normal text-[var(--ls-t3)]">{propuesta.descartadas.length} referencias que pedían envío y no se mandan, con su motivo</span>
              </span>
              <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform motion-reduce:transition-none', verFuera && 'rotate-180')} aria-hidden />
            </button>
            {verFuera && (
              <ul className="divide-y divide-[var(--ls-linea)] border-t border-[var(--ls-linea)]">
                {propuesta.descartadas.map((d) => (
                  <li key={d.sku} className="grid gap-x-3 gap-y-[2px] px-3 py-2 md:grid-cols-[minmax(0,320px)_70px_minmax(0,1fr)]">
                    <span className="min-w-0">
                      <span className="mr-2 font-mono text-[11.5px] text-[var(--ls-t3)]">{d.sku}</span>
                      <span className="text-[12.5px] text-[var(--ls-t2)]">{d.nombre ?? ''}</span>
                    </span>
                    <span className="text-[12px] tabular-nums text-[var(--ls-t3)] md:text-right" title="Lo que habría salido de la cuenta">
                      <span className="md:hidden">Cálculo </span>
                      {n0(d.base)}
                    </span>
                    <span className="text-[12px] leading-[1.4] text-[var(--ls-t2)]">{d.motivo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="border-t border-[var(--ls-linea)] px-3 py-[9px] text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
          Se analizaron {propuesta.analizadas} referencias; otras {propuesta.sinNecesidad} tienen stock y no necesitan envío. El «cálculo» es ritmo de venta por días de cobertura menos lo que habrá al llegar y lo que ya está en otras
          propuestas; la IA lo revisa y lo corrige con lo que una cuenta no sabe. Lo que no se ve aquí —cuánto tiene el cliente en su almacén— lo sabe quien lo revisa.
        </p>
      </div>
    </div>
  )
}

function Lista({ titulo, textos }: { titulo: string; textos: string[] }) {
  return (
    <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-[9px]">
      <h4 className="mb-1 text-[12.5px] font-semibold text-[var(--ls-t1)]">{titulo}</h4>
      <ul className="space-y-[4px]">
        {textos.map((t) => (
          <li key={t} className="flex gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
            <span className="mt-[8px] h-[4px] w-[4px] shrink-0 rounded-full bg-[var(--ls-t4)]" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}

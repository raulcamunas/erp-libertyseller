'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, MotionConfig } from 'framer-motion'
import { AlertTriangle, ArrowLeft, BarChart3, ChevronDown, Database, FileDown, Layers, Loader2, Pencil, Plus, Search, Tags, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { Boton, FilaDeKpis, Insignia, Kpi, PanelLateral, TACTIL_CUADRADO } from '@/components/ui-ls'
import { BOTON, CAMPO, CELDA, COLOR_ESTADO, TABLA, TIPO } from '@/lib/estilo/denso'
import { coincide, textoBuscable, type Modelo } from '@/lib/fba/catalogo/indice'
import { limpiarCodigoAmazon, limpiarEan, limpiarPrecio, limpiarSku, limpiarTalla } from '@/lib/fba/catalogo/normalizar'
import { claveModelo, type DatosFila, type FilaCatalogo } from '@/lib/fba/catalogo/tipos'
import { avisosDeFila, estaCompleta } from '@/lib/fba/catalogo/validar'
import { CONFIANZA } from '../comun/estilo-plan'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { cx, Segmentado, Vacio } from '../comun/ui'
import { useTecladoDeLista } from '../comun/useTeclado'
import { entero, fechaCorta, ritmo as fRitmo } from '../formato'
import { AnadirReferenciaDialog, type PrellenadoReferencia } from './AnadirReferenciaDialog'
import { ImportarCatalogoDialog } from './ImportarCatalogoDialog'
import { datoDeFila, resumenDeModelo, textoPlan, type DatoTalla, type RefFuera } from './plan-por-talla'
import { corregirReferencias, exportarCatalogo, quitarReferencias, useCatalogo, usePlanDeLaBase, type PlanDeLaBase } from './useCatalogo'
import { VistaPorModelo } from './VistaPorModelo'

/**
 * LA BASE DE DATOS DE REFERENCIAS DE UN CLIENTE (spec remesas-pro §8, D5, D38, D40 y D43.4).
 *
 * A la izquierda, los modelos —cada REF con sus colores—; a la derecha, las tallas del elegido con todos sus
 * códigos, que se corrigen en la propia tabla. Junto a los códigos, lo que dice el plan de la ÚLTIMA pasada:
 * stock en FBA, ritmo (con su confianza) y lo que propone mandar o por qué no («Talla sin ventas en 180 días»).
 * La pestaña «Curva de tallas» enseña el modelo entero: vendido, en FBA y propuesto por talla (VistaPorModelo).
 *
 * Se activa por datos (D40): la sección `base` sale si `cliente.tieneCatalogo` (filas en fba_catalogo o el
 * nombre contiene «shoesf»). Con `cliente.tieneCatalogo = false` no se pide el plan.
 *
 *
 * ============ SE EDITA EN LA CELDA Y SE GUARDA AL SALIR DE ELLA ============
 *
 * No hay un botón Guardar por fila: se toca una casilla, se pulsa Enter o Tab, y se guarda. El cambio se ve al
 * instante y, si el servidor lo rechaza —un FBASKU que ya es de otra talla, una talla repetida—, la casilla
 * vuelve a lo que tenía y avisa del motivo. Es lo que permite arreglar veinte códigos seguidos sin esperar.
 *
 *
 * ============ EN EL MÓVIL ============
 *
 * Lista de modelos → detalle apilado con «← Volver» (D38: nada de editores dentro de una hoja modal). Cada talla
 * es una tarjeta con sus casillas grandes. La curva de tallas, que es de solo lectura, se abre en un PanelLateral.
 *
 *
 * API
 *   <VistaBaseDeDatos cliente sesion />                         nueva: barra propia (cifras, Exportar, Importar, Añadir) y diálogos dentro
 *   <VistaBaseDeDatos clienteId clienteNombre onAnadir onImportar />   la de antes: la barra y los diálogos los pone el padre
 */

type Filtro = 'todos' | 'incompletos' | 'sinContinuidad' | 'conPropuesta'
type PestanaModelo = 'codigos' | 'curva'

export interface VistaBaseDeDatosProps {
  cliente?: ClienteRemesas
  sesion?: SesionRemesas
  /** Compatibilidad: si no hay `cliente` */
  clienteId?: string
  clienteNombre?: string
  /** Si se dan, el padre abre los diálogos y pone la barra (EspacioRemesas de antes) */
  onAnadir?: (prellenado?: PrellenadoReferencia) => void
  onImportar?: () => void
}

const hoyIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function VistaBaseDeDatos({ cliente, sesion, clienteId: idSuelto, clienteNombre: nombreSuelto, onAnadir, onImportar }: VistaBaseDeDatosProps) {
  const clienteId = cliente?.id ?? idSuelto ?? ''
  const clienteNombre = cliente?.nombre ?? nombreSuelto ?? ''
  /** Sin callbacks del padre, la vista pone su barra y sus diálogos */
  const propia = !onAnadir && !onImportar

  const catalogo = useCatalogo(clienteId)
  const ix = catalogo.indice
  // Si viene la sesión, manda también ella: un cliente externo sin editar no edita aunque la API dijera otra cosa
  const puedeEditar = catalogo.puedeEditar && (cliente ? cliente.puedeEditar : true)
  const puedeBorrar = catalogo.puedeBorrar && (sesion ? sesion.esAdmin : true)

  const conFilas = !!catalogo.filas && catalogo.filas.length > 0
  const plan = usePlanDeLaBase(clienteId, catalogo.filas, conFilas && (cliente ? cliente.tieneCatalogo : true))

  const [anadiendo, setAnadiendo] = useState<PrellenadoReferencia | null>(null)
  const [importando, setImportando] = useState(false)
  const anadir = (p?: PrellenadoReferencia) => (onAnadir ? onAnadir(p) : setAnadiendo(p ?? {}))
  const importar = () => (onImportar ? onImportar() : setImportando(true))

  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [elegido, setElegido] = useState<string | null>(null)
  const [pestana, setPestana] = useState<PestanaModelo>('codigos')
  /** En el móvil: se ve la lista o el detalle (apilados, D38) */
  const [detalleMovil, setDetalleMovil] = useState(false)
  const [curvaMovil, setCurvaMovil] = useState(false)

  const resumenes = useMemo(() => new Map(ix.modelos.map((m) => [m.clave, resumenDeModelo(m.filas, plan.datos)])), [ix, plan.datos])
  const textos = useMemo(() => new Map(ix.modelos.map((m) => [m.clave, textoBuscable(m)])), [ix])
  const cuentas = useMemo(
    () => ({
      todos: ix.modelos.length,
      incompletos: ix.modelos.filter((m) => m.incompletas > 0).length,
      sinContinuidad: ix.modelos.filter((m) => m.sinContinuidad).length,
      conPropuesta: ix.modelos.filter((m) => (resumenes.get(m.clave)?.propuesto ?? 0) > 0).length,
    }),
    [ix, resumenes]
  )

  const grupos = useMemo(
    () =>
      ix.grupos
        .map((g) => ({
          ...g,
          modelos: g.modelos.filter(
            (m) =>
              (filtro === 'todos' ||
                (filtro === 'incompletos' && m.incompletas > 0) ||
                (filtro === 'sinContinuidad' && m.sinContinuidad) ||
                (filtro === 'conPropuesta' && (resumenes.get(m.clave)?.propuesto ?? 0) > 0)) &&
              (busqueda.trim() === '' || coincide(textos.get(m.clave) ?? '', busqueda))
          ),
        }))
        .filter((g) => g.modelos.length > 0),
    [ix, filtro, busqueda, textos, resumenes]
  )

  const visibles = useMemo(() => grupos.flatMap((g) => g.modelos), [grupos])
  /** El elegido, derivado: si ya no existe o el filtro lo esconde, se enseña el primero */
  const modelo = ix.modelos.find((m) => m.clave === elegido) ?? visibles[0] ?? null

  const raiz = useRef<HTMLElement>(null)
  useTecladoDeLista(
    raiz,
    useMemo(() => visibles.map((m) => m.clave), [visibles]),
    modelo?.clave ?? null,
    setElegido
  )

  const cifras = useMemo(() => {
    const filas = catalogo.filas ?? []
    return { referencias: ix.grupos.length, modelos: ix.modelos.length, tallas: filas.length, incompletas: filas.filter((f) => !estaCompleta(f)).length }
  }, [catalogo.filas, ix])

  function elegirModelo(clave: string) {
    setElegido(clave)
    setDetalleMovil(true)
    // En el móvil el detalle sustituye a la lista: se sube al principio para no aterrizar a media página
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023.98px)').matches) window.scrollTo({ top: 0 })
  }

  /* ---------- Estados de la base ---------- */

  let cuerpo: React.ReactNode
  if (!catalogo.filas && !catalogo.error) {
    cuerpo = (
      <div className="flex min-h-[240px] items-center justify-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        Cargando la base de datos de {clienteNombre}…
      </div>
    )
  } else if (catalogo.sinMigrar || catalogo.error || !conFilas) {
    cuerpo = (
      <div className="flex min-h-[240px] items-center justify-center rounded-[14px] border border-dashed border-[var(--ls-linea2)]">
        <Vacio
          icono={<Database />}
          titulo={catalogo.sinMigrar ? 'Falta lanzar la migración 226' : catalogo.error ? 'No se ha podido leer la base de datos' : `Todavía no hay referencias de ${clienteNombre}`}
          accion={
            catalogo.error ? (
              <Boton variante="secundario" onClick={() => void catalogo.recargar()}>
                Reintentar
              </Boton>
            ) : !catalogo.sinMigrar && puedeEditar ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Boton variante="primario" icono={Upload} onClick={importar}>
                  Importar CSV
                </Boton>
                <Boton variante="secundario" icono={Plus} onClick={() => anadir()}>
                  Añadir referencia
                </Boton>
              </div>
            ) : undefined
          }
        >
          {catalogo.sinMigrar
            ? 'La tabla de la base de datos de referencias no existe todavía en Supabase. Lanza el fichero 226_fba_catalogo.sql en el editor SQL y recarga esta pantalla.'
            : catalogo.error
              ? catalogo.error
              : 'Aquí vive la hoja de cálculo de referencias —REF, Nombre y color, Talla, EAN, FNSKU, ASIN y FBASKU—. Impórtala de golpe o añade las referencias una a una; después se eligen con desplegables al montar una propuesta.'}
        </Vacio>
      </div>
    )
  } else {
    cuerpo = (
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 lg:grid-cols-[272px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* ================= LOS MODELOS ================= */}
        <aside
          ref={raiz}
          className={cx(
            'min-w-0 flex-col gap-2 lg:sticky lg:top-3 lg:flex lg:max-h-[calc(100dvh-7rem)]',
            detalleMovil ? 'hidden' : 'flex'
          )}
        >
          <div className="flex shrink-0 flex-col gap-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar REF, color, EAN, FBASKU…"
                className={cx(CAMPO.input, 'h-[34px] rounded-[10px] pl-[32px] text-[16px] lg:h-[30px] lg:text-[12.5px] [@media(pointer:coarse)]:h-[44px]')}
                aria-label="Buscar en la base de datos"
              />
            </label>
            <div className="flex flex-wrap items-center gap-[6px]">
              <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')} cuenta={cuentas.todos}>
                Todos
              </Chip>
              <Chip activo={filtro === 'incompletos'} onClick={() => setFiltro('incompletos')} cuenta={cuentas.incompletos} apagado={cuentas.incompletos === 0} titulo="Modelos a los que les falta algún FBASKU, EAN, FNSKU o ASIN">
                Incompletos
              </Chip>
              <Chip activo={filtro === 'sinContinuidad'} onClick={() => setFiltro('sinContinuidad')} cuenta={cuentas.sinContinuidad} apagado={cuentas.sinContinuidad === 0} titulo="Modelos que se descatalogan">
                Sin continuidad
              </Chip>
              {plan.deAgencia && plan.hayPlan && (
                <Chip activo={filtro === 'conPropuesta'} onClick={() => setFiltro('conPropuesta')} cuenta={cuentas.conPropuesta} apagado={cuentas.conPropuesta === 0} titulo="Modelos con alguna talla que el plan propone mandar">
                  Con propuesta
                </Chip>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-[10px] lg:overflow-y-auto lg:pr-[2px]">
            {grupos.length === 0 && (
              <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)]">
                <Vacio icono={<Search />} titulo="Nada que coincida">
                  Prueba con otra búsqueda, o quita el filtro.
                </Vacio>
              </div>
            )}
            {grupos.map((g) => (
              <section key={g.clave}>
                <h3 className="mb-[4px] flex items-baseline gap-2 px-[2px] text-[11px] font-semibold text-[var(--ls-t4)]">
                  <span className="truncate text-[var(--ls-t3)]">{g.ref}</span>
                  {g.modelos.length > 1 && <span className="font-normal">{g.modelos.length} colores</span>}
                </h3>
                <div className="space-y-[5px]">
                  {g.modelos.map((m) => (
                    <TarjetaModelo key={m.clave} modelo={m} activa={m.clave === modelo?.clave} resumen={resumenes.get(m.clave) ?? null} deAgencia={plan.deAgencia} onClick={() => elegirModelo(m.clave)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>

        {/* ================= EL MODELO ELEGIDO ================= */}
        <section className={cx('min-w-0', detalleMovil ? 'block' : 'hidden lg:block')}>
          <button
            type="button"
            onClick={() => setDetalleMovil(false)}
            className={cx('mb-2 inline-flex min-h-[44px] items-center gap-2 text-[13px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)] lg:hidden')}
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a los modelos
          </button>
          {modelo ? (
            <motion.div key={modelo.clave} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              <FichaModelo
                clienteId={clienteId}
                modelo={modelo}
                plan={plan}
                pestana={pestana}
                onPestana={setPestana}
                puedeEditar={puedeEditar}
                puedeBorrar={puedeBorrar}
                onAnadirTalla={() => anadir({ ref: modelo.ref, nombre: modelo.nombre })}
                onRenombrado={(ref, nombre) => setElegido(claveModelo(ref, nombre))}
                onVerCurvaMovil={() => setCurvaMovil(true)}
              />
            </motion.div>
          ) : (
            <div className="flex min-h-[240px] items-center justify-center rounded-[14px] border border-dashed border-[var(--ls-linea2)]">
              <Vacio icono={<Database />} titulo="Elige un modelo de la lista">
                Aquí aparecen sus tallas con todos los códigos, que se corrigen en la propia tabla.
              </Vacio>
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-w-0 space-y-3">
        {/* ================= LA BARRA DE LA BASE ================= */}
        {propia && conFilas && (
          // En el móvil, con el detalle de un modelo abierto, la barra se esconde: el detalle va arriba del todo
          <div className={cx('min-w-0 flex-col gap-3 lg:flex', detalleMovil ? 'hidden' : 'flex')}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-[12px] text-[var(--ls-t3)]">
                La hoja de referencias de <b className="font-semibold text-[var(--ls-t1)]">{clienteNombre}</b>: de aquí salen los desplegables de las propuestas.
              </p>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Boton variante="secundario" tamano="sm" icono={FileDown} onClick={() => exportarCatalogo(catalogo.filas ?? [], clienteNombre, hoyIso())} title="Descargar la base de datos en el formato de la hoja de cálculo">
                  Exportar CSV
                </Boton>
                {puedeEditar && !catalogo.sinMigrar && (
                  <>
                    <Boton variante="secundario" tamano="sm" icono={Upload} onClick={importar} title="Cargar o completar la base de datos desde el CSV de la hoja">
                      Importar CSV
                    </Boton>
                    <Boton variante="primario" tamano="sm" icono={Plus} onClick={() => anadir()}>
                      Añadir referencia
                    </Boton>
                  </>
                )}
              </div>
            </div>
            <FilaDeKpis minimo={150}>
              <Kpi etiqueta="REF" valor={cifras.referencias} acento="remesas" icono={Tags} indice={0} />
              <Kpi etiqueta="Modelos" valor={cifras.modelos} acento="remesas" icono={Layers} indice={1} />
              <Kpi etiqueta="Tallas" valor={cifras.tallas} acento="remesas" icono={Database} indice={2} />
              <Kpi
                etiqueta="Incompletas"
                valor={cifras.incompletas}
                acento={cifras.incompletas > 0 ? COLOR_ESTADO.ambar : 'remesas'}
                icono={AlertTriangle}
                nota="sin FBASKU, EAN, FNSKU o ASIN"
                onClick={cifras.incompletas > 0 ? () => setFiltro('incompletos') : undefined}
                indice={3}
              />
            </FilaDeKpis>
          </div>
        )}

        {/* ================= LO QUE VENDE Y NO ESTÁ (D5.5) ================= */}
        {conFilas && plan.deAgencia && !detalleMovil && <AvisoFueraDeLaBase plan={plan} clienteNombre={clienteNombre} puedeEditar={puedeEditar && !catalogo.sinMigrar} onAnadir={anadir} />}

        {/* ================= DE DÓNDE SALEN LAS CIFRAS ================= */}
        {conFilas && <LineaDelPlan plan={plan} />}

        {cuerpo}

        {/* ================= MÓVIL: LA CURVA, EN HOJA (solo lectura) ================= */}
        {modelo && (
          <PanelLateral
            abierto={curvaMovil}
            onCambio={setCurvaMovil}
            titulo={`${modelo.ref} · ${modelo.nombre}`}
            descripcion="Curva de tallas"
            icono={BarChart3}
            acento="remesas"
            ancho={560}
          >
            <div className="px-4 py-4">
              <VistaPorModelo modelo={modelo} plan={plan} conCodigos />
            </div>
          </PanelLateral>
        )}

        {propia && anadiendo && <AnadirReferenciaDialog clienteId={clienteId} clienteNombre={clienteNombre} prellenado={anadiendo} onCerrar={() => setAnadiendo(null)} />}
        {propia && importando && <ImportarCatalogoDialog clienteId={clienteId} clienteNombre={clienteNombre} onCerrar={() => setImportando(false)} />}
      </div>
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

function LineaDelPlan({ plan }: { plan: PlanDeLaBase }) {
  if (plan.cargando && !plan.hayPlan) {
    return (
      <p className="flex items-center gap-2 text-[11.5px] text-[var(--ls-t4)]">
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
        Leyendo el plan de reposición…
      </p>
    )
  }
  if (!plan.hayPlan) {
    return (
      <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
        {plan.error
          ? `No se ha podido leer el plan: ${plan.error}. Las columnas Stock FBA, Ritmo y Plan salen vacías.`
          : plan.migracion316 === false
            ? 'Falta lanzar la migración 316: sin pasadas del plan, las columnas Stock FBA, Ritmo y Plan salen vacías.'
            : 'Todavía no hay plan de reposición de este cliente: las columnas Stock FBA, Ritmo y Plan salen cuando se calcule.'}
      </p>
    )
  }
  return (
    <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t4)]">
      {plan.deAgencia ? 'Stock FBA, Ritmo y Plan' : 'Stock FBA y Ritmo'} son de la última pasada del plan
      {plan.calculadoAt ? ` (${fechaCorta(plan.calculadoAt.slice(0, 10))}, ${plan.calculadoAt.slice(11, 16)})` : ''}. El ritmo es ud/día, media de los días con stock.
    </p>
  )
}

function AvisoFueraDeLaBase({ plan, clienteNombre, puedeEditar, onAnadir }: { plan: PlanDeLaBase; clienteNombre: string; puedeEditar: boolean; onAnadir: (p: PrellenadoReferencia) => void }) {
  const [abierto, setAbierto] = useState(false)
  const lista = plan.fueraDeLaBase
  const n = plan.refsFueraDeCatalogo ?? lista.length
  if (n <= 0 && lista.length === 0) return null
  const total = Math.max(n, lista.length)
  return (
    <section className="min-w-0 rounded-[14px] border border-[var(--ls-linea)] border-l-2 bg-[var(--ls-sup)]" style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left">
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-[var(--ls-t2)]">
          <b className="font-semibold text-[var(--ls-t1)]">
            {entero(total)} referencia{total === 1 ? '' : 's'} que venden no {total === 1 ? 'está' : 'están'} en la base de datos
          </b>{' '}
          de {clienteNombre}. El plan las reparte por modelo con el SKU, pero no salen en los desplegables de las propuestas.
        </span>
        {lista.length > 0 && <ChevronDown className={cx('h-4 w-4 shrink-0 text-[var(--ls-t3)] transition-transform motion-reduce:transition-none', abierto && 'rotate-180')} />}
      </button>
      {abierto && lista.length > 0 && (
        <ul className="max-h-[360px] divide-y divide-[var(--ls-linea)] overflow-y-auto border-t border-[var(--ls-linea)]">
          {lista.map((r) => (
            <FilaFuera key={r.sku} r={r} puedeEditar={puedeEditar} onAnadir={onAnadir} />
          ))}
        </ul>
      )}
    </section>
  )
}

function FilaFuera({ r, puedeEditar, onAnadir }: { r: RefFuera; puedeEditar: boolean; onAnadir: (p: PrellenadoReferencia) => void }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px] text-[var(--ls-t1)]">{r.sku}</p>
        <p className="truncate text-[11px] text-[var(--ls-t4)]">
          {[r.nombre, r.modelo && r.talla ? `modelo ${r.modelo}, talla ${r.talla}` : null].filter(Boolean).join(' · ') || 'sin nombre'}
        </p>
      </div>
      <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--ls-t3)]">
        {r.ventas90 !== null ? `${entero(r.ventas90)} vendidas en 90 d` : fRitmo(r.ritmo)} · {entero(r.vendibles)} en FBA
      </span>
      {puedeEditar && (
        <Boton
          variante="fantasma"
          tamano="sm"
          icono={Plus}
          onClick={() => onAnadir({ ref: r.modelo ?? undefined, tallas: [{ talla: r.talla ?? '', fbasku: r.sku, asin: r.asin, fnsku: r.fnsku }] })}
          title="Darla de alta en la base de datos con su SKU (falta el nombre y color)"
        >
          Añadir
        </Boton>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* La lista                                                            */
/* ------------------------------------------------------------------ */

function Chip({ activo, onClick, cuenta, children, apagado, titulo }: { activo: boolean; onClick: () => void; cuenta: number; children: React.ReactNode; apagado?: boolean; titulo?: string }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-pressed={activo} className={cx(BOTON.chip, activo && BOTON.chipEncendido, apagado && !activo && 'opacity-55', '[@media(pointer:coarse)]:min-h-[36px]')}>
      {children}
      <span className="tabular-nums text-[var(--ls-t4)]">{cuenta}</span>
    </button>
  )
}

function TarjetaModelo({ modelo, activa, resumen, deAgencia, onClick }: { modelo: Modelo; activa: boolean; resumen: { enFba: number; propuesto: number | null } | null; deAgencia: boolean; onClick: () => void }) {
  const primera = modelo.filas[0]?.talla
  const ultima = modelo.filas[modelo.filas.length - 1]?.talla
  const propone = deAgencia && (resumen?.propuesto ?? 0) > 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa}
      className={cx(
        'relative block min-h-[44px] w-full rounded-[10px] border px-[12px] py-[8px] text-left transition-colors motion-reduce:transition-none',
        activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sel)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] lg:hover:border-[var(--ls-linea2)] lg:hover:bg-[var(--ls-sup2)]',
        modelo.sinContinuidad && !activa && 'opacity-70'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-[var(--ls-t1)]">{modelo.nombre}</p>
        <span className="flex shrink-0 items-center gap-2">
          {propone && (
            <span className="text-[11px] font-semibold tabular-nums text-[var(--ls-acc)]" title="Lo que propone mandar el plan de este modelo">
              +{entero(resumen!.propuesto)} ud
            </span>
          )}
          {modelo.incompletas > 0 && (
            <span className="inline-flex items-center gap-[3px] text-[11px] tabular-nums" style={{ color: COLOR_ESTADO.ambar }} title={`${modelo.incompletas} talla${modelo.incompletas === 1 ? '' : 's'} sin algún código`}>
              <AlertTriangle className="h-3 w-3" />
              {modelo.incompletas}
            </span>
          )}
        </span>
      </div>
      <p className="mt-[1px] truncate text-[11px] text-[var(--ls-t4)]">
        {modelo.filas.length} talla{modelo.filas.length === 1 ? '' : 's'}
        {modelo.filas.length > 1 && ` · ${primera}–${ultima}`}
        {resumen && ` · ${entero(resumen.enFba)} en FBA`}
        {modelo.sinContinuidad && ' · sin continuidad'}
      </p>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* El modelo                                                           */
/* ------------------------------------------------------------------ */

function FichaModelo({
  clienteId,
  modelo,
  plan,
  pestana,
  onPestana,
  puedeEditar,
  puedeBorrar,
  onAnadirTalla,
  onRenombrado,
  onVerCurvaMovil,
}: {
  clienteId: string
  modelo: Modelo
  plan: PlanDeLaBase
  pestana: PestanaModelo
  onPestana: (p: PestanaModelo) => void
  puedeEditar: boolean
  puedeBorrar: boolean
  onAnadirTalla: () => void
  onRenombrado: (ref: string, nombre: string) => void
  onVerCurvaMovil: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [quitando, setQuitando] = useState(false)

  const filas = modelo.filas
  const cod = Array.from(new Set(filas.map((f) => f.codArt).filter(Boolean)))
  const resumen = resumenDeModelo(filas, plan.datos)

  async function quitarModelo() {
    setQuitando(true)
    const r = await quitarReferencias(clienteId, filas.map((f) => f.id))
    setQuitando(false)
    setConfirmar(false)
    if (!r.ok) toast.error(r.error)
    else toast.success(`${modelo.ref} ${modelo.nombre} quitado de la base de datos`)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="relative min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3 shadow-[var(--ls-sombra-1)]">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={cx(TIPO.xl, 'break-words text-[var(--ls-t1)]')}>
              {modelo.ref}
              <span className="mx-2 text-[var(--ls-t4)]">·</span>
              {modelo.nombre}
            </h2>
            <p className="mt-[3px] text-[12px] text-[var(--ls-t3)]">
              {filas.length} talla{filas.length === 1 ? '' : 's'}
              {cod.length === 1 && (
                <>
                  {' '}
                  · COD ART <span className="font-mono text-[11.5px]">{cod[0]}</span>
                </>
              )}
              {resumen && <> · {entero(resumen.enFba)} en FBA</>}
              {plan.deAgencia && resumen && (resumen.propuesto ?? 0) > 0 && (
                <>
                  {' '}
                  · <span className="font-medium text-[var(--ls-acc)]">el plan propone {entero(resumen.propuesto)} ud</span>
                </>
              )}
              {modelo.sinContinuidad && (
                <>
                  {' '}
                  · <span style={{ color: COLOR_ESTADO.ambar }}>sin continuidad</span>
                </>
              )}
              {modelo.incompletas > 0 && (
                <>
                  {' '}
                  · <span style={{ color: COLOR_ESTADO.ambar }}>{modelo.incompletas} incompleta{modelo.incompletas === 1 ? '' : 's'}</span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
            <Boton variante="secundario" tamano="sm" icono={BarChart3} onClick={onVerCurvaMovil} className="lg:hidden">
              Curva de tallas
            </Boton>
            {puedeEditar && (
              <>
                <Boton variante="secundario" tamano="sm" icono={Plus} onClick={onAnadirTalla}>
                  Añadir talla
                </Boton>
                <Boton variante="fantasma" tamano="sm" soloIcono icono={Pencil} onClick={() => setEditando(true)} title="Cambiar la REF o el color de todo el modelo" aria-label="Editar el modelo" />
                {puedeBorrar &&
                  (confirmar ? (
                    <span className="flex items-center gap-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 py-1 text-[12px]">
                      <span className="text-[var(--ls-t2)]">¿Quitar las {filas.length} tallas?</span>
                      <button type="button" onClick={quitarModelo} disabled={quitando} className={cx('px-1 font-semibold text-[var(--ls-e-rojo)] hover:underline', TACTIL_CUADRADO)}>
                        {quitando ? '…' : 'Sí'}
                      </button>
                      <button type="button" onClick={() => setConfirmar(false)} className={cx('px-1 text-[var(--ls-t3)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <Boton variante="fantasma" tamano="sm" soloIcono icono={Trash2} onClick={() => setConfirmar(true)} title="Quitar el modelo entero de la base de datos" aria-label="Quitar el modelo" className="hover:!text-[var(--ls-e-rojo)]" />
                  ))}
              </>
            )}
          </div>
        </div>
        <div className="mt-3 hidden lg:block">
          <Segmentado<PestanaModelo>
            valor={pestana}
            onCambio={onPestana}
            etiqueta="Qué ver del modelo"
            opciones={[
              { id: 'codigos', texto: 'Tallas y códigos' },
              { id: 'curva', texto: 'Curva de tallas', titulo: 'Vendido, en FBA y propuesto por talla' },
            ]}
          />
        </div>
      </header>

      {/* ---------- Escritorio: tabla o curva ---------- */}
      <div className="hidden min-w-0 lg:block">
        {pestana === 'curva' ? (
          <VistaPorModelo modelo={modelo} plan={plan} />
        ) : (
          <div className={cx(TABLA.caja, 'rounded-[14px]')}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={cx(TABLA.cabecera, 'w-[64px]')}>Talla</th>
                  <th className={cx(TABLA.cabecera, TABLA.derecha, 'w-[76px]')} title="Unidades vendibles en FBA (última pasada del plan)">
                    Stock FBA
                  </th>
                  <th className={cx(TABLA.cabecera, 'w-[104px]')} title="ud/día, media de los días con stock. «del modelo» = ritmo del modelo repartido por tallas">
                    Ritmo
                  </th>
                  {plan.deAgencia && (
                    <th className={cx(TABLA.cabecera, 'w-[120px]')} title="Lo que propone mandar el plan, o por qué no">
                      Plan
                    </th>
                  )}
                  <th className={cx(TABLA.cabecera, 'w-[124px]')}>EAN</th>
                  <th className={cx(TABLA.cabecera, 'w-[104px]')}>FNSKU</th>
                  <th className={cx(TABLA.cabecera, 'w-[104px]')}>ASIN</th>
                  <th className={cx(TABLA.cabecera, 'w-[136px]')}>FBASKU</th>
                  <th className={cx(TABLA.cabecera, 'w-[80px]')}>COD ART</th>
                  <th className={cx(TABLA.cabecera, TABLA.derecha, 'w-[68px]')}>Precio</th>
                  <th className={cx(TABLA.cabecera, 'w-[48px] text-center')} title="El modelo sigue en catálogo">
                    Cont.
                  </th>
                  <th className={cx(TABLA.cabecera, 'w-[52px]')} />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <FilaTalla key={f.id} fila={f} clienteId={clienteId} dato={datoDeFila(f, plan.datos)} conPlan={plan.hayPlan} deAgencia={plan.deAgencia} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- Móvil: una tarjeta por talla, apiladas en la página (D38) ---------- */}
      <div className="space-y-2 lg:hidden">
        {filas.map((f) => (
          <TarjetaTalla key={f.id} fila={f} clienteId={clienteId} dato={datoDeFila(f, plan.datos)} conPlan={plan.hayPlan} deAgencia={plan.deAgencia} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar} />
        ))}
      </div>

      {editando && (
        <EditarModeloDialog
          clienteId={clienteId}
          modelo={modelo}
          onCerrar={() => setEditando(false)}
          onHecho={(ref, nombre) => {
            setEditando(false)
            onRenombrado(ref, nombre)
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Una talla: lo común a la fila de la tabla y a la tarjeta del móvil  */
/* ------------------------------------------------------------------ */

interface PropsTalla {
  fila: FilaCatalogo
  clienteId: string
  dato: DatoTalla | null
  conPlan: boolean
  deAgencia: boolean
  puedeEditar: boolean
  puedeBorrar: boolean
}

type CampoCelda = 'talla' | 'ean' | 'fnsku' | 'asin' | 'fbasku' | 'codArt' | 'precio'

function useTalla({ fila, clienteId }: Pick<PropsTalla, 'fila' | 'clienteId'>) {
  const avisos = avisosDeFila(fila)

  async function guardar(campos: Partial<DatosFila>): Promise<boolean> {
    const r = await corregirReferencias(clienteId, [fila.id], campos)
    if (!r.ok) {
      toast.error(r.error)
      return false
    }
    return true
  }

  async function quitar() {
    const r = await quitarReferencias(clienteId, [fila.id])
    if (!r.ok) toast.error(r.error)
  }

  const falta = (campo: keyof DatosFila) => avisos.some((a) => a.campo === campo)

  /** Las props de la casilla de cada campo: la misma lógica de guardar y limpiar en la tabla y en la tarjeta */
  function celda(campo: CampoCelda): Omit<PropsCelda, 'soloLectura' | 'grande'> {
    const t = fila.talla
    switch (campo) {
      case 'talla':
        return { valor: fila.talla, limpiar: limpiarTalla, onGuardar: (v) => (v ? guardar({ talla: v }) : Promise.resolve(false)), etiqueta: `Talla ${t}`, negrita: true }
      case 'ean':
        return { valor: fila.ean, limpiar: limpiarEan, onGuardar: (v) => guardar({ ean: v }), etiqueta: `EAN de la talla ${t}`, mono: true, marca: falta('ean'), numerico: true }
      case 'fnsku':
        return { valor: fila.fnsku, limpiar: limpiarCodigoAmazon, onGuardar: (v) => guardar({ fnsku: v }), etiqueta: `FNSKU de la talla ${t}`, mono: true, marca: falta('fnsku') }
      case 'asin':
        return { valor: fila.asin, limpiar: limpiarCodigoAmazon, onGuardar: (v) => guardar({ asin: v }), etiqueta: `ASIN de la talla ${t}`, mono: true, marca: falta('asin') }
      case 'fbasku':
        return { valor: fila.fbasku, limpiar: limpiarSku, onGuardar: (v) => guardar({ fbasku: v }), etiqueta: `FBASKU de la talla ${t}`, mono: true, marca: falta('fbasku') }
      case 'codArt':
        return { valor: fila.codArt, limpiar: limpiarSku, onGuardar: (v) => guardar({ codArt: v }), etiqueta: `COD ART de la talla ${t}`, mono: true }
      case 'precio':
        return {
          valor: fila.precio === null ? null : fila.precio.toFixed(2).replace('.', ','),
          limpiar: (v) => v.trim(),
          onGuardar: async (v) => {
            if (v === null) return guardar({ precio: null })
            const n = limpiarPrecio(v)
            if (n === null) {
              toast.error('Ese precio no es un número')
              return false
            }
            return guardar({ precio: n })
          },
          etiqueta: `Precio de la talla ${t}`,
          derecha: true,
          decimal: true,
        }
    }
  }

  return { avisos, guardar, quitar, celda }
}

function RitmoDeTalla({ dato }: { dato: DatoTalla | null }) {
  if (!dato) return <span className="text-[var(--ls-t4)]">—</span>
  const conf = CONFIANZA[dato.confianza]
  return (
    <span className="inline-flex min-w-0 items-center gap-[5px]" title={dato.explicacion || undefined}>
      <span className="tabular-nums text-[var(--ls-t2)]">{dato.ritmo === null ? '—' : fRitmo(dato.ritmo).replace(' ud/día', '')}</span>
      {dato.origenRitmo === 'modelo' && (
        <Insignia tono="cian" tamano="sm" title="Ritmo del modelo repartido por lo que vende cada talla">
          modelo
        </Insignia>
      )}
      {conf && dato.origenRitmo !== 'modelo' && (
        <Insignia tono={conf.tono} variante={conf.variante} tamano="sm" title={conf.texto}>
          {conf.corto}
        </Insignia>
      )}
    </span>
  )
}

function PlanDeTalla({ dato, conPlan }: { dato: DatoTalla | null; conPlan: boolean }) {
  const t = textoPlan(dato, true)
  if (!conPlan) return <span className="text-[var(--ls-t4)]">—</span>
  return (
    <span
      className={cx('block truncate', t.tono === 'propone' ? 'font-semibold text-[var(--ls-acc)]' : t.tono === 'fuera' ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t4)]')}
      title={[t.texto, t.detalle].filter(Boolean).join('. ')}
    >
      {t.texto}
    </span>
  )
}

function AvisoTalla({ avisos }: { avisos: ReturnType<typeof avisosDeFila> }) {
  if (avisos.length === 0) return null
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center" title={avisos.map((a) => a.texto).join('\n')} aria-label={avisos.map((a) => a.texto).join('. ')}>
      <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
    </span>
  )
}

function QuitarTalla({ talla, onQuitar }: { talla: string; onQuitar: () => void }) {
  const [confirmar, setConfirmar] = useState(false)
  return confirmar ? (
    <span className="flex items-center gap-[6px] text-[11.5px]">
      <button type="button" onClick={onQuitar} className={cx('px-1 font-semibold text-[var(--ls-e-rojo)] hover:underline', TACTIL_CUADRADO)}>
        Quitar
      </button>
      <button type="button" onClick={() => setConfirmar(false)} className={cx('px-1 text-[var(--ls-t3)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)}>
        No
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirmar(true)} className={cx(BOTON.icono, TACTIL_CUADRADO, 'hover:!text-[var(--ls-e-rojo)]')} title="Quitar esta talla" aria-label={`Quitar la talla ${talla}`}>
      <Trash2 className="h-3 w-3" />
    </button>
  )
}

function FilaTalla(p: PropsTalla) {
  const { fila, dato, conPlan, deAgencia, puedeEditar, puedeBorrar } = p
  const { avisos, guardar, quitar, celda } = useTalla(p)
  const ro = !puedeEditar
  const td = cx(TABLA.celda, 'px-[3px]')
  return (
    <tr className={cx(TABLA.fila, !fila.continuidad && 'opacity-75')}>
      <td className={td}>
        <Celda {...celda('talla')} soloLectura={ro} />
      </td>
      <td className={cx(TABLA.celda, TABLA.derecha, 'pr-[8px] tabular-nums text-[var(--ls-t2)]')}>{dato ? entero(dato.vendibles) : <span className="text-[var(--ls-t4)]">—</span>}</td>
      <td className={cx(TABLA.celda, 'px-[7px]')}>{conPlan ? <RitmoDeTalla dato={dato} /> : <span className="text-[var(--ls-t4)]">—</span>}</td>
      {deAgencia && (
        <td className={cx(TABLA.celda, 'max-w-[140px] px-[7px]')}>
          <PlanDeTalla dato={dato} conPlan={conPlan} />
        </td>
      )}
      <td className={td}>
        <Celda {...celda('ean')} soloLectura={ro} />
      </td>
      <td className={td}>
        <Celda {...celda('fnsku')} soloLectura={ro} />
      </td>
      <td className={td}>
        <Celda {...celda('asin')} soloLectura={ro} />
      </td>
      <td className={td}>
        <Celda {...celda('fbasku')} soloLectura={ro} />
      </td>
      <td className={td}>
        <Celda {...celda('codArt')} soloLectura={ro} />
      </td>
      <td className={td}>
        <Celda {...celda('precio')} soloLectura={ro} />
      </td>
      <td className={cx(TABLA.celda, 'text-center')}>
        <input
          type="checkbox"
          checked={fila.continuidad}
          disabled={!puedeEditar}
          onChange={(e) => void guardar({ continuidad: e.target.checked })}
          className="h-3 w-3 accent-[var(--ls-acc)] disabled:opacity-60"
          aria-label={`Talla ${fila.talla} con continuidad`}
          title={fila.continuidad ? 'Sigue en catálogo' : 'Se descataloga'}
        />
      </td>
      <td className={cx(TABLA.celda, 'pr-[4px]')}>
        <span className="flex items-center justify-end gap-[2px]">
          <AvisoTalla avisos={avisos} />
          {puedeBorrar && <QuitarTalla talla={fila.talla} onQuitar={() => void quitar()} />}
        </span>
      </td>
    </tr>
  )
}

/** La talla en el móvil: una tarjeta con sus cifras arriba y las casillas grandes (44 px) debajo */
function TarjetaTalla(p: PropsTalla) {
  const { fila, dato, conPlan, deAgencia, puedeEditar, puedeBorrar } = p
  const { avisos, guardar, quitar, celda } = useTalla(p)
  const ro = !puedeEditar
  return (
    <article className={cx('min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3', !fila.continuidad && 'opacity-80')}>
      <header className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="w-[120px]">
            <Celda {...celda('talla')} soloLectura={ro} grande />
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="text-[var(--ls-t3)]">
              <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{dato ? entero(dato.vendibles) : '—'}</b> en FBA
            </span>
            {conPlan && (
              <span className="inline-flex items-center gap-1 text-[var(--ls-t3)]">
                <RitmoDeTalla dato={dato} /> ud/día
              </span>
            )}
          </div>
          {deAgencia && conPlan && (
            <div className="mt-1 min-w-0 text-[12px]">
              <PlanDeTalla dato={dato} conPlan={conPlan} />
            </div>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          <AvisoTalla avisos={avisos} />
          {puedeBorrar && <QuitarTalla talla={fila.talla} onQuitar={() => void quitar()} />}
        </span>
      </header>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
        <CampoTarjeta etiqueta="EAN">
          <Celda {...celda('ean')} soloLectura={ro} grande />
        </CampoTarjeta>
        <CampoTarjeta etiqueta="FNSKU">
          <Celda {...celda('fnsku')} soloLectura={ro} grande />
        </CampoTarjeta>
        <CampoTarjeta etiqueta="ASIN">
          <Celda {...celda('asin')} soloLectura={ro} grande />
        </CampoTarjeta>
        <CampoTarjeta etiqueta="Precio">
          <Celda {...celda('precio')} soloLectura={ro} grande />
        </CampoTarjeta>
        <CampoTarjeta etiqueta="FBASKU" className="col-span-2">
          <Celda {...celda('fbasku')} soloLectura={ro} grande />
        </CampoTarjeta>
        <CampoTarjeta etiqueta="COD ART">
          <Celda {...celda('codArt')} soloLectura={ro} grande />
        </CampoTarjeta>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 self-end text-[12.5px] text-[var(--ls-t2)]">
          <input
            type="checkbox"
            checked={fila.continuidad}
            disabled={!puedeEditar}
            onChange={(e) => void guardar({ continuidad: e.target.checked })}
            className="h-4 w-4 accent-[var(--ls-acc)] disabled:opacity-60"
          />
          Con continuidad
        </label>
      </div>
    </article>
  )
}

function CampoTarjeta({ etiqueta, children, className }: { etiqueta: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <p className="mb-[3px] text-[11px] font-medium text-[var(--ls-t4)]">{etiqueta}</p>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La casilla                                                          */
/* ------------------------------------------------------------------ */

interface PropsCelda {
  valor: string | null
  onGuardar: (v: string | null) => Promise<boolean>
  limpiar: (v: string) => string
  etiqueta: string
  mono?: boolean
  negrita?: boolean
  derecha?: boolean
  /** Falta el dato o está mal escrito: la casilla vacía se pinta con un guion ámbar */
  marca?: boolean
  soloLectura?: boolean
  /** La versión del móvil: casilla visible de 44 px y letra de 16 px (iOS no hace zoom) */
  grande?: boolean
  numerico?: boolean
  decimal?: boolean
}

/**
 * Una casilla que se edita en su sitio. No parece un campo hasta que pasas por encima (CELDA.editable).
 * Enter o salir de ella guarda; Esc deja lo que había. Si el servidor rechaza el cambio, vuelve a lo anterior
 * (el motivo sale en un aviso).
 */
function Celda({ valor, onGuardar, limpiar, etiqueta, mono, negrita, derecha, marca, soloLectura, grande, numerico, decimal }: PropsCelda) {
  const [texto, setTexto] = useState(valor ?? '')
  const [guardando, setGuardando] = useState(false)
  const cancelado = useRef(false)

  // Si el valor cambia por fuera (otra pestaña, una importación, un rechazo del servidor), la casilla lo sigue
  useEffect(() => setTexto(valor ?? ''), [valor])

  async function confirmar() {
    if (cancelado.current) {
      cancelado.current = false
      setTexto(valor ?? '')
      return
    }
    const limpio = limpiar(texto)
    if (limpio === (valor ?? '')) {
      setTexto(valor ?? '')
      return
    }
    setGuardando(true)
    const ok = await onGuardar(limpio === '' ? null : limpio)
    setGuardando(false)
    if (!ok) setTexto(valor ?? '')
  }

  if (soloLectura) {
    return (
      <span
        className={cx(
          'block truncate',
          grande ? 'min-h-[24px] text-[14px] leading-6' : 'h-5 px-[5px] leading-5',
          mono ? 'font-mono text-[var(--ls-t3)]' : 'text-[var(--ls-t2)]',
          mono && !grande && 'text-[12px]',
          derecha && !grande && 'text-right tabular-nums',
          negrita && 'font-semibold text-[var(--ls-t1)]'
        )}
        title={valor ?? undefined}
      >
        {valor ?? <span style={marca ? { color: COLOR_ESTADO.ambar } : undefined}>—</span>}
      </span>
    )
  }

  return (
    <input
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => void confirmar()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelado.current = true
          e.currentTarget.blur()
        }
      }}
      disabled={guardando}
      aria-label={etiqueta}
      placeholder="—"
      autoComplete="off"
      autoCapitalize={mono ? 'characters' : 'off'}
      spellCheck={false}
      inputMode={numerico ? 'numeric' : decimal ? 'decimal' : undefined}
      className={cx(
        grande
          ? 'block h-[44px] w-full min-w-0 rounded-[10px] border bg-[var(--ls-sup2)] px-3 text-[16px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]'
          : CELDA.editable,
        grande && (marca && !texto ? 'border-[var(--ls-e-ambar)]' : 'border-[var(--ls-linea)]'),
        mono && (grande ? 'font-mono' : 'font-mono text-[12px]'),
        derecha && 'text-right tabular-nums',
        negrita && 'font-semibold text-[var(--ls-t1)]',
        guardando && 'opacity-60',
        marca && !texto && 'placeholder:text-[var(--ls-e-ambar)]'
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Editar el modelo entero                                             */
/* ------------------------------------------------------------------ */

function EditarModeloDialog({ clienteId, modelo, onCerrar, onHecho }: { clienteId: string; modelo: Modelo; onCerrar: () => void; onHecho: (ref: string, nombre: string) => void }) {
  const [ref, setRef] = useState(modelo.ref)
  const [nombre, setNombre] = useState(modelo.nombre)
  const [continuidad, setContinuidad] = useState(!modelo.sinContinuidad)
  const [guardando, setGuardando] = useState(false)

  const cambios: Partial<DatosFila> = {}
  if (ref.trim() !== modelo.ref) cambios.ref = ref.trim()
  if (nombre.trim() !== modelo.nombre) cambios.nombre = nombre.trim()
  if (continuidad !== !modelo.sinContinuidad) cambios.continuidad = continuidad
  const hayCambios = Object.keys(cambios).length > 0

  async function guardar() {
    if (!ref.trim() || !nombre.trim()) {
      toast.error('La REF y el nombre y color no pueden quedar vacíos')
      return
    }
    setGuardando(true)
    const r = await corregirReferencias(clienteId, modelo.filas.map((f) => f.id), cambios)
    setGuardando(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success('Modelo actualizado en todas sus tallas')
    onHecho(ref.trim(), nombre.trim())
  }

  return (
    <Dialogo
      titulo="Editar el modelo"
      entradilla={`Los cambios se aplican a las ${modelo.filas.length} tallas. Las remesas que ya usan estas referencias no cambian: guardan una copia de lo que se mandó.`}
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!hayCambios || guardando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {guardando && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
            Guardar
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={CAMPO.etiqueta} htmlFor="em-ref">
            REF
          </label>
          <input id="em-ref" value={ref} onChange={(e) => setRef(e.target.value)} autoFocus autoComplete="off" className={cx(CAMPO.input, 'max-lg:h-[44px] max-lg:text-[16px]')} />
        </div>
        <div>
          <label className={CAMPO.etiqueta} htmlFor="em-nombre">
            Nombre y color
          </label>
          <input id="em-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={cx(CAMPO.input, 'max-lg:h-[44px] max-lg:text-[16px]')} />
        </div>
      </div>
      <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
        <input type="checkbox" checked={continuidad} onChange={(e) => setContinuidad(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ls-acc)]" />
        Sigue en catálogo (con continuidad)
      </label>
    </Dialogo>
  )
}

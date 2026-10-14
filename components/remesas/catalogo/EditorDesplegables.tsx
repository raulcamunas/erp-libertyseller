'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Loader2, Plus, Upload, X } from 'lucide-react'
import { BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import { aLineaElegida, buscarTalla, coloresDe, type LineaElegida } from '@/lib/fba/catalogo/indice'
import { avisosDeFila } from '@/lib/fba/catalogo/validar'
import { cx } from '../comun/ui'
import { AnadirReferenciaDialog, type PrellenadoReferencia } from './AnadirReferenciaDialog'
import { Combo, type OpcionCombo } from './Combo'
import { ImportarCatalogoDialog } from './ImportarCatalogoDialog'
import { useCatalogo } from './useCatalogo'

/**
 * MONTAR UN ENVÍO ELIGIENDO EN DESPLEGABLES.
 *
 * Lo que se hacía en la hoja de cálculo: una fila por talla, con REF, Nombre y color
 * y Talla como desplegables encadenados, y EAN, FNSKU, ASIN y FBASKU que se rellenan
 * solos al elegir la talla. La diferencia es que aquí los desplegables salen de la
 * base de datos del cliente, que se puede ampliar sin salir de la propuesta.
 *
 *
 * ============ EL FLUJO, PENSADO PARA NO TOCAR EL RATÓN ============
 *
 * La última fila, siempre a la vista, es donde se añade:
 *
 *     REF  ->  color  ->  talla  ->  unidades  ->  (vuelta a REF)
 *
 * Cada elección salta sola a la siguiente casilla; si una REF tiene un único color,
 * lo toma y se salta ese paso. En la lista de tallas, la primera opción es «Todas las
 * tallas»: añade la serie entera de golpe, solo queda poner las unidades de cada una.
 *
 *
 * ============ UNA TALLA SOLO UNA VEZ ============
 *
 * Una talla que ya está en la lista aparece en el desplegable deshabilitada y diciendo
 * en qué fila: esconderla haría pensar que no existe. Y una talla sin FBASKU también
 * se ve y no se deja elegir: la remesa exige SKU en cada línea.
 *
 *
 * ============ LO QUE EMITE ============
 *
 * Solo las líneas COMPLETAS: talla resuelta y unidades. Las que están a medias se
 * cuentan en `sinTerminar` para que quien guarda lo sepa y no se pierdan en silencio.
 * Las líneas de una remesa ya guardada cuyo SKU no está en la base de datos se
 * conservan tal cual —no se tiran por no encontrarlas— y se marcan.
 */

interface FilaEd {
  uid: number
  /** El SKU de una línea ya guardada: así se reconoce en la base de datos aunque la REF esté escrita distinto */
  sku: string | null
  ref: string
  nombre: string
  talla: string
  unidades: string
  /** La línea tal como estaba guardada. Se usa si su SKU no está en la base de datos */
  origen: LineaElegida | null
}

export interface EstadoEditor {
  sinTerminar: number
  fueraDeLaBase: number
}

type Campo = 'ref' | 'nombre' | 'talla' | 'uds'

let contador = 0
const nuevoUid = () => ++contador

/**
 * Las columnas, una sola vez para la cabecera, las filas y la fila fija de abajo.
 * Van como clases COMPLETAS (con su variante `2xl:`) y no montadas con plantillas de
 * texto: Tailwind solo genera las que ve escritas enteras en el código.
 */
const GRID_CON_ASIN = 'grid-cols-[26px_124px_minmax(140px,1fr)_66px_112px_92px_92px_132px_62px_52px]'
/** En el panel, por debajo de 1536 px no cabe el ASIN: es lo que menos se mira al montar un envío */
const GRID_PANEL = 'grid-cols-[26px_124px_minmax(140px,1fr)_66px_112px_92px_132px_62px_52px] 2xl:grid-cols-[26px_124px_minmax(140px,1fr)_66px_112px_92px_92px_132px_62px_52px]'

export function EditorDesplegables({
  clienteId,
  clienteNombre,
  puedeAnadir,
  inicial,
  onCambio,
  variante = 'panel',
  alturaMaxima,
  onUsarOtroModo,
}: {
  clienteId: string
  clienteNombre: string
  /** Puede dar de alta referencias nuevas (permiso de editar de ese cliente) */
  puedeAnadir: boolean
  inicial: LineaElegida[]
  onCambio: (lineas: LineaElegida[], estado: EstadoEditor) => void
  /** 'dialogo' muestra todas las columnas; 'panel' esconde el ASIN en pantallas medianas */
  variante?: 'dialogo' | 'panel'
  /** Si se da, la tabla hace scroll dentro de esa altura (en un diálogo) */
  alturaMaxima?: string
  /** Para cuando la base de datos no sirve (vacía, sin migrar): pasar al catálogo de Amazon */
  onUsarOtroModo?: () => void
}) {
  const catalogo = useCatalogo(clienteId)
  const ix = catalogo.indice

  const [filas, setFilas] = useState<FilaEd[]>(() =>
    inicial.map((l) => ({
      uid: nuevoUid(),
      sku: l.sku,
      ref: l.referencia ?? '',
      nombre: l.titulo ?? '',
      talla: l.variante ?? '',
      unidades: String(l.unidades),
      origen: l,
    }))
  )
  const [nuevo, setNuevo] = useState({ ref: '', nombre: '', talla: '' })
  const [anadiendo, setAnadiendo] = useState<PrellenadoReferencia | null>(null)
  const [importando, setImportando] = useState(false)

  /* ---------- Foco ---------- */

  const campos = useRef(new Map<string, HTMLInputElement>())
  const pendiente = useRef<string | null>(null)
  const registrar = useCallback(
    (clave: string) => (el: HTMLInputElement | null) => {
      if (el) campos.current.set(clave, el)
      else campos.current.delete(clave)
    },
    []
  )
  // Se enfoca DESPUÉS de pintar: la casilla siguiente puede estar deshabilitada hasta que llegue el estado
  useEffect(() => {
    if (!pendiente.current) return
    const el = campos.current.get(pendiente.current)
    if (el && !el.disabled) {
      el.focus()
      el.select?.()
      pendiente.current = null
    }
  })
  const irA = (uid: number | 'nuevo', campo: Campo) => {
    pendiente.current = `${uid}:${campo}`
  }

  /* ---------- Resolver cada fila contra la base de datos ---------- */

  const resuelta = useCallback(
    (f: FilaEd) => (f.sku ? ix.porSku.get(f.sku) : undefined) ?? (f.ref && f.nombre && f.talla ? buscarTalla(ix, f.ref, f.nombre, f.talla) : undefined),
    [ix]
  )

  const cargada = catalogo.filas !== null
  const filasPintadas = useMemo(
    () =>
      filas.map((f) => {
        const r = resuelta(f)
        return {
          f,
          r: r ?? null,
          // Lo que se enseña: la base de datos manda sobre cómo estaba escrito
          ref: r?.ref ?? f.ref,
          nombre: r?.nombre ?? f.nombre,
          talla: r?.talla ?? f.talla,
          // Una línea guardada cuyo SKU no está en la base de datos (y esta ya ha cargado)
          fuera: cargada && !r && !!f.origen,
        }
      }),
    [filas, resuelta, cargada]
  )

  /** Qué fila usa cada talla, para marcar las repetidas en el desplegable */
  const enUso = useMemo(() => {
    const m = new Map<string, number>()
    filasPintadas.forEach((p, i) => {
      if (p.r) m.set(p.r.id, i + 1)
    })
    return m
  }, [filasPintadas])

  /* ---------- Lo que se emite ---------- */

  const salida = useMemo(() => {
    const lineas: LineaElegida[] = []
    let sinTerminar = 0
    let fueraDeLaBase = 0
    for (const p of filasPintadas) {
      const u = Number(p.f.unidades)
      const unidadesOk = Number.isInteger(u) && u >= 1
      if (p.r) {
        if (!p.r.fbasku || !unidadesOk) {
          sinTerminar += 1
        } else {
          const linea = aLineaElegida(p.r, u)
          // Una línea ya guardada no pierde un código porque la base de datos aún no lo tenga:
          // al guardar, la ruta reescribe la línea entera y lo que no viaje se borra.
          const o = p.f.origen
          if (o && o.sku === linea.sku) {
            linea.fnsku = linea.fnsku ?? o.fnsku
            linea.asin = linea.asin ?? o.asin
            linea.ean = linea.ean ?? o.ean ?? null
          }
          lineas.push(linea)
        }
      } else if (p.f.origen) {
        // Una línea guardada que no está en la base de datos: se respeta tal cual
        if (!unidadesOk) sinTerminar += 1
        else lineas.push({ ...p.f.origen, unidades: u })
        if (p.fuera) fueraDeLaBase += 1
      } else {
        sinTerminar += 1
      }
    }
    return { lineas, sinTerminar, fueraDeLaBase }
  }, [filasPintadas])

  // El padre se entera de cada cambio. `onCambio` va en una ref: si el padre pasa una
  // función nueva en cada render, no debe volver a emitirse por eso.
  const aviso = useRef(onCambio)
  aviso.current = onCambio
  useEffect(() => {
    aviso.current(salida.lineas, { sinTerminar: salida.sinTerminar, fueraDeLaBase: salida.fueraDeLaBase })
  }, [salida])

  /* ---------- Opciones de los desplegables ---------- */

  const opcionesRef = useMemo<OpcionCombo[]>(
    () =>
      ix.grupos.map((g) => ({
        valor: g.ref,
        texto: g.ref,
        // Con un solo color se dice cuál: así se elige sin abrir el desplegable siguiente
        detalle: g.modelos.length === 1 ? g.modelos[0].nombre : `${g.modelos.length} colores`,
        // Y la REF también se encuentra escribiendo el color («cuero» lleva a 8412)
        claves: g.modelos.map((m) => m.nombre).join(' '),
        atenuada: g.modelos.every((m) => m.sinContinuidad),
      })),
    [ix]
  )

  const opcionesNombre = useCallback(
    (ref: string): OpcionCombo[] =>
      coloresDe(ix, ref).map((m) => ({
        valor: m.nombre,
        texto: m.nombre,
        etiqueta: (
          <span className="flex min-w-0 items-center gap-[6px]">
            <span className="truncate">{m.nombre}</span>
            {m.sinContinuidad && <span className="shrink-0 rounded-[3px] border border-[var(--ls-linea2)] px-[4px] text-[10px] text-[var(--ls-t3)]">sin continuidad</span>}
          </span>
        ),
        detalle: `${m.filas.length} talla${m.filas.length === 1 ? '' : 's'}${m.incompletas > 0 ? ` · ${m.incompletas} incompleta${m.incompletas === 1 ? '' : 's'}` : ''}`,
        atenuada: m.sinContinuidad,
      })),
    [ix]
  )

  /** Las tallas de un color; `propia` es la que ya tiene esa fila (para no marcarla como repetida) */
  const opcionesTalla = useCallback(
    (ref: string, nombre: string, propia: string | null, conTodas: boolean): OpcionCombo[] => {
      const modelo = coloresDe(ix, ref).find((m) => m.nombre === nombre)
      if (!modelo) return []
      const lista: OpcionCombo[] = modelo.filas.map((f) => {
        const fila = enUso.get(f.id)
        const repetida = !!fila && f.id !== propia
        const sinSku = !f.fbasku
        return {
          valor: f.talla,
          texto: f.talla,
          detalle: repetida ? `ya está en la fila ${fila}` : sinSku ? 'sin FBASKU' : f.fnsku ? undefined : 'sin FNSKU',
          deshabilitada: repetida || sinSku,
          atenuada: !f.continuidad,
        }
      })
      const libres = lista.filter((o) => !o.deshabilitada).length
      if (conTodas && libres > 1) {
        lista.unshift({ valor: '__todas__', texto: 'Todas las tallas', detalle: `${libres}`, especial: true })
      }
      return lista
    },
    [ix, enUso]
  )

  /* ---------- Acciones ---------- */

  function cambiarFila(uid: number, cambios: Partial<FilaEd>) {
    setFilas((prev) => prev.map((f) => (f.uid === uid ? { ...f, ...cambios } : f)))
  }

  /** Elegir REF en una fila: el color y la talla se vacían, salvo que solo haya un color */
  function elegirRefEnFila(uid: number, ref: string) {
    const colores = coloresDe(ix, ref)
    const unico = colores.length === 1 ? colores[0].nombre : ''
    cambiarFila(uid, { sku: null, origen: null, ref, nombre: unico, talla: '' })
    irA(uid, unico ? 'talla' : 'nombre')
  }

  function elegirNombreEnFila(uid: number, ref: string, nombre: string) {
    cambiarFila(uid, { sku: null, origen: null, ref, nombre, talla: '' })
    irA(uid, 'talla')
  }

  function elegirTallaEnFila(uid: number, ref: string, nombre: string, talla: string) {
    cambiarFila(uid, { sku: null, origen: null, ref, nombre, talla })
    irA(uid, 'uds')
  }

  function quitar(uid: number) {
    setFilas((prev) => prev.filter((f) => f.uid !== uid))
  }

  /** La fila de abajo: cuando están las tres, la línea pasa a la lista y se piden las unidades */
  function elegirRefNuevo(ref: string) {
    const colores = coloresDe(ix, ref)
    const unico = colores.length === 1 ? colores[0].nombre : ''
    setNuevo({ ref, nombre: unico, talla: '' })
    irA('nuevo', unico ? 'talla' : 'nombre')
  }

  function elegirNombreNuevo(nombre: string) {
    setNuevo((n) => ({ ...n, nombre, talla: '' }))
    irA('nuevo', 'talla')
  }

  function elegirTallaNueva(talla: string) {
    const modelo = coloresDe(ix, nuevo.ref).find((m) => m.nombre === nuevo.nombre)
    if (!modelo) return

    if (talla === '__todas__') {
      const libres = modelo.filas.filter((f) => f.fbasku && !enUso.has(f.id))
      const creadas = libres.map((f) => ({ uid: nuevoUid(), sku: null, ref: f.ref, nombre: f.nombre, talla: f.talla, unidades: '', origen: null }))
      setFilas((prev) => [...prev, ...creadas])
      setNuevo({ ref: '', nombre: '', talla: '' })
      if (creadas[0]) irA(creadas[0].uid, 'uds')
      return
    }

    const fila = modelo.filas.find((f) => f.talla === talla)
    if (!fila || !fila.fbasku) return
    const uid = nuevoUid()
    setFilas((prev) => [...prev, { uid, sku: null, ref: fila.ref, nombre: fila.nombre, talla: fila.talla, unidades: '', origen: null }])
    setNuevo({ ref: '', nombre: '', talla: '' })
    irA(uid, 'uds')
  }

  function cambiarUnidades(uid: number, valor: string) {
    cambiarFila(uid, { unidades: valor.replace(/\D/g, '').slice(0, 6) })
  }

  function alPulsarUnidades(e: React.KeyboardEvent<HTMLInputElement>, indice: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      irA('nuevo', 'ref')
      // La casilla ya está habilitada: se enfoca ahora, sin esperar a otro render
      campos.current.get('nuevo:ref')?.focus()
      pendiente.current = null
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const destino = filasPintadas[indice + (e.key === 'ArrowDown' ? 1 : -1)]
      if (destino) campos.current.get(`${destino.f.uid}:uds`)?.focus()
      else if (e.key === 'ArrowDown') campos.current.get('nuevo:ref')?.focus()
    }
  }

  const abrirAnadir = (prellenado: PrellenadoReferencia) => setAnadiendo(prellenado)

  /* ---------- Estados de la base de datos ---------- */

  const sinFilas = cargada && catalogo.filas!.length === 0
  const esperando = !cargada && !catalogo.error

  if (catalogo.sinMigrar || catalogo.error || sinFilas || esperando) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)] px-5 py-7 text-center">
        {esperando ? (
          <p className="flex items-center justify-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando la base de datos de {clienteNombre}…
          </p>
        ) : (
          <>
            <Database className="mx-auto h-6 w-6 text-[var(--ls-t4)]" />
            <p className="mt-2 text-[13px] font-semibold text-[var(--ls-t1)]">
              {catalogo.sinMigrar ? 'Falta lanzar la migración 226' : catalogo.error ? 'No se ha podido leer la base de datos' : `Todavía no hay referencias en la base de datos de ${clienteNombre}`}
            </p>
            <p className="mx-auto mt-1 max-w-[460px] text-[12px] leading-[1.55] text-[var(--ls-t3)]">
              {catalogo.sinMigrar
                ? 'La tabla de la base de datos de referencias no existe todavía en Supabase. Lanza el fichero 226_fba_catalogo.sql y vuelve a abrir esto.'
                : catalogo.error
                  ? catalogo.error
                  : 'Importa la hoja de cálculo (REF, Nombre y color, Talla, EAN, FBASKU…) o añade las referencias una a una. Después se eligen aquí con desplegables.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {catalogo.error && (
                <button type="button" onClick={() => void catalogo.recargar()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                  Reintentar
                </button>
              )}
              {sinFilas && puedeAnadir && (
                <>
                  <button type="button" onClick={() => setImportando(true)} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                    <Upload className="h-3 w-3" />
                    Importar CSV
                  </button>
                  <button type="button" onClick={() => abrirAnadir({})} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                    <Plus className="h-3 w-3" />
                    Añadir referencia
                  </button>
                </>
              )}
              {onUsarOtroModo && (
                <button type="button" onClick={onUsarOtroModo} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                  Usar el catálogo de Amazon
                </button>
              )}
            </div>
          </>
        )}
        {importando && <ImportarCatalogoDialog clienteId={clienteId} clienteNombre={clienteNombre} onCerrar={() => setImportando(false)} />}
        {anadiendo && <AnadirReferenciaDialog clienteId={clienteId} clienteNombre={clienteNombre} prellenado={anadiendo} onCerrar={() => setAnadiendo(null)} />}
      </div>
    )
  }

  /* ---------- La tabla ---------- */

  const panel = variante === 'panel'
  const plantilla = panel ? GRID_PANEL : GRID_CON_ASIN
  const clasesAsin = panel ? 'hidden 2xl:block' : 'block'
  const refNuevoOk = nuevo.ref !== ''
  const nombreNuevoOk = nuevo.nombre !== ''

  return (
    <div className="space-y-2">
      {/* Un único recuadro con scroll: la cabecera y la fila de abajo se quedan pegadas a sus bordes.
          El scroll-padding evita que una casilla enfocada quede escondida detrás de ellas. */}
      <div className="overflow-auto rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" style={{ maxHeight: alturaMaxima, scrollPaddingTop: 30, scrollPaddingBottom: 46 }}>
        <div className={panel ? 'min-w-[810px] 2xl:min-w-[905px]' : 'min-w-[905px]'}>
          {/* ---- Cabecera ---- */}
          <div role="row" className={cx('sticky top-0 z-20 grid items-center border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)]', plantilla)}>
            <Cab className="text-center">#</Cab>
            <Cab>REF</Cab>
            <Cab>Nombre y color</Cab>
            <Cab>Talla</Cab>
            <Cab>EAN</Cab>
            <Cab>FNSKU</Cab>
            <Cab className={clasesAsin}>ASIN</Cab>
            <Cab>FBASKU</Cab>
            <Cab className="text-right">Unidades</Cab>
            <Cab />
          </div>

          {/* ---- Las líneas ---- */}
          {filasPintadas.length === 0 && (
            <p className="px-4 py-6 text-center text-[12px] leading-[1.6] text-[var(--ls-t3)]">
              Todavía no hay líneas. Elige una <b className="font-semibold text-[var(--ls-t2)]">REF</b> en la fila de abajo: con <kbd className="rounded-[3px] border border-[var(--ls-linea2)] px-[4px] text-[10.5px]">Enter</kbd> saltas a la casilla siguiente.
            </p>
          )}

          {filasPintadas.map((p, i) => {
            const u = Number(p.f.unidades)
            const sinUnidades = !Number.isInteger(u) || u < 1
            const avisos = p.r ? avisosDeFila(p.r).filter((a) => a.gravedad === 'falta') : []
            const resueltaCompleta = !!p.r
            return (
              <div key={p.f.uid} role="row" className={cx('grid items-center border-b border-[var(--ls-linea)] focus-within:bg-[var(--ls-sup2)] hover:bg-[var(--ls-sup2)]', plantilla)}>
                <div className="text-center text-[11px] tabular-nums text-[var(--ls-t4)]">{i + 1}</div>

                <div className="px-[3px] py-[3px]">
                  <Combo
                    valor={p.ref || null}
                    opciones={opcionesRef}
                    onElegir={(v) => elegirRefEnFila(p.f.uid, v)}
                    etiqueta={`REF de la línea ${i + 1}`}
                    placeholder="REF"
                    inputRef={registrar(`${p.f.uid}:ref`)}
                    anchoLista={200}
                  />
                </div>
                <div className="px-[3px] py-[3px]">
                  <Combo
                    valor={p.nombre || null}
                    opciones={p.ref ? opcionesNombre(p.ref) : []}
                    onElegir={(v) => elegirNombreEnFila(p.f.uid, p.ref, v)}
                    etiqueta={`Nombre y color de la línea ${i + 1}`}
                    placeholder="Nombre y color"
                    deshabilitado={!p.ref}
                    inputRef={registrar(`${p.f.uid}:nombre`)}
                    anchoLista={280}
                  />
                </div>
                <div className="px-[3px] py-[3px]">
                  <Combo
                    valor={p.talla || null}
                    opciones={p.ref && p.nombre ? opcionesTalla(p.ref, p.nombre, p.r?.id ?? null, false) : []}
                    onElegir={(v) => elegirTallaEnFila(p.f.uid, p.ref, p.nombre, v)}
                    etiqueta={`Talla de la línea ${i + 1}`}
                    placeholder="Talla"
                    deshabilitado={!p.ref || !p.nombre}
                    inputRef={registrar(`${p.f.uid}:talla`)}
                    anchoLista={170}
                  />
                </div>

                <Codigo valor={p.r?.ean ?? p.f.origen?.ean} />
                <Codigo valor={p.r?.fnsku ?? p.f.origen?.fnsku} falta={resueltaCompleta || !!p.f.origen} />
                <Codigo valor={p.r?.asin ?? p.f.origen?.asin} className={clasesAsin} />
                <Codigo valor={p.r?.fbasku ?? p.f.origen?.sku} fuerte />

                <div className="px-[3px] py-[3px]">
                  <input
                    ref={registrar(`${p.f.uid}:uds`)}
                    value={p.f.unidades}
                    onChange={(e) => cambiarUnidades(p.f.uid, e.target.value)}
                    onKeyDown={(e) => alPulsarUnidades(e, i)}
                    onFocus={(e) => e.currentTarget.select()}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label={`Unidades de la línea ${i + 1}`}
                    autoComplete="off"
                    className={cx(
                      'block h-[24px] w-full rounded-[4px] border bg-[var(--ls-sup2)] px-[6px] text-right text-[12.5px] font-semibold tabular-nums text-[var(--ls-t1)] outline-none',
                      'placeholder:font-normal placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]',
                      sinUnidades && (p.r || p.f.origen) ? 'border-[var(--ls-e-ambar)]' : 'border-[var(--ls-linea)]'
                    )}
                  />
                </div>

                <div className="flex items-center justify-end gap-[1px] pr-[4px]">
                  {p.fuera && (
                    <button
                      type="button"
                      disabled={!puedeAnadir}
                      onClick={() =>
                        abrirAnadir({
                          ref: p.f.origen?.referencia ?? undefined,
                          nombre: p.f.origen?.titulo ?? undefined,
                          tallas: [{ talla: p.f.origen?.variante ?? '', ean: p.f.origen?.ean, fnsku: p.f.origen?.fnsku, asin: p.f.origen?.asin, fbasku: p.f.origen?.sku }],
                        })
                      }
                      className={cx(BOTON.icono, 'disabled:cursor-default disabled:hover:bg-transparent')}
                      title={puedeAnadir ? 'Esta línea no está en la base de datos. Pulsa para añadirla' : 'Esta línea no está en la base de datos'}
                      aria-label={`La línea ${i + 1} no está en la base de datos`}
                    >
                      <Database className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
                    </button>
                  )}
                  {avisos.length > 0 && (
                    <span className="inline-flex h-5 w-5 items-center justify-center" title={avisos.map((a) => a.texto).join('\n')}>
                      <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
                    </span>
                  )}
                  <button type="button" onClick={() => quitar(p.f.uid)} className={cx(BOTON.icono, 'hover:!text-[var(--ls-e-rojo)]')} title="Quitar esta línea" aria-label={`Quitar la línea ${i + 1}`}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* ---- La fila fija de abajo: donde se añade ---- */}
          <div role="row" className={cx('sticky bottom-0 z-20 grid items-center border-t border-[var(--ls-acc-graf)] bg-[var(--ls-sup2)] shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.5)]', plantilla)}>
            <div className="flex justify-center text-[var(--ls-acc)]">
              <Plus className="h-3 w-3" />
            </div>
            <div className="px-[3px] py-[4px]">
              <Combo
                valor={nuevo.ref || null}
                opciones={opcionesRef}
                onElegir={elegirRefNuevo}
                etiqueta="REF de la línea nueva"
                placeholder="Elige REF…"
                inputRef={registrar('nuevo:ref')}
                anchoLista={220}
                pie={
                  puedeAnadir
                    ? {
                        texto: (
                          <>
                            <Plus className="h-3 w-3" />
                            Nueva referencia…
                          </>
                        ),
                        onClick: (escrito) => abrirAnadir({ ref: escrito || undefined }),
                      }
                    : undefined
                }
              />
            </div>
            <div className="px-[3px] py-[4px]">
              <Combo
                valor={nuevo.nombre || null}
                opciones={refNuevoOk ? opcionesNombre(nuevo.ref) : []}
                onElegir={elegirNombreNuevo}
                etiqueta="Nombre y color de la línea nueva"
                placeholder="Nombre y color"
                deshabilitado={!refNuevoOk}
                inputRef={registrar('nuevo:nombre')}
                anchoLista={280}
                pie={
                  puedeAnadir && refNuevoOk
                    ? {
                        texto: (
                          <>
                            <Plus className="h-3 w-3" />
                            Otro color de {nuevo.ref}…
                          </>
                        ),
                        onClick: (escrito) => abrirAnadir({ ref: nuevo.ref, nombre: escrito || undefined }),
                      }
                    : undefined
                }
              />
            </div>
            <div className="px-[3px] py-[4px]">
              <Combo
                valor={nuevo.talla || null}
                opciones={refNuevoOk && nombreNuevoOk ? opcionesTalla(nuevo.ref, nuevo.nombre, null, true) : []}
                onElegir={elegirTallaNueva}
                etiqueta="Talla de la línea nueva"
                placeholder="Talla"
                deshabilitado={!refNuevoOk || !nombreNuevoOk}
                inputRef={registrar('nuevo:talla')}
                anchoLista={190}
                pie={
                  puedeAnadir && refNuevoOk && nombreNuevoOk
                    ? {
                        texto: (
                          <>
                            <Plus className="h-3 w-3" />
                            Otra talla de {nuevo.ref}…
                          </>
                        ),
                        onClick: () => abrirAnadir({ ref: nuevo.ref, nombre: nuevo.nombre }),
                      }
                    : undefined
                }
              />
            </div>
            <p className="truncate pl-3 pr-3 text-[11.5px] text-[var(--ls-t4)]" style={{ gridColumn: '5 / -1' }}>
              {!refNuevoOk ? 'Elige la REF, después el color y la talla. Enter salta a la casilla siguiente.' : !nombreNuevoOk ? 'Ahora el color.' : 'Y la talla: la primera opción las añade todas.'}
            </p>
          </div>
        </div>
      </div>

      {anadiendo && (
        <AnadirReferenciaDialog
          clienteId={clienteId}
          clienteNombre={clienteNombre}
          prellenado={anadiendo}
          onCerrar={() => setAnadiendo(null)}
          onAnadidas={({ ref, nombre }) => {
            // Si se dio de alta desde la fila de abajo, queda elegido y se sigue con la talla.
            // Si era una línea ya guardada que faltaba, se reconoce sola por su SKU.
            if (!anadiendo.tallas) {
              setNuevo({ ref, nombre, talla: '' })
              irA('nuevo', 'talla')
            }
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Cab({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cx('h-[26px] px-[7px] text-[11px] font-semibold leading-[26px] text-[var(--ls-t4)]', className)}>{children}</div>
}

/** Un código de solo lectura: EAN, FNSKU, ASIN o FBASKU. Si falta, un guion ámbar */
function Codigo({ valor, falta, fuerte, className }: { valor?: string | null; falta?: boolean; fuerte?: boolean; className?: string }) {
  return (
    <div className={cx('truncate px-[7px] font-mono text-[11.5px]', fuerte ? 'text-[var(--ls-t2)]' : 'text-[var(--ls-t3)]', className)} title={valor ?? undefined}>
      {valor ? valor : <span style={falta ? { color: COLOR_ESTADO.ambar } : undefined}>—</span>}
    </div>
  )
}

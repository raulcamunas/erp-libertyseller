'use client'

import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, CAMPO, CELDA, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { buscarModelo, buscarTalla, coloresDe } from '@/lib/fba/catalogo/indice'
import { compararTalla, expandirTallas, limpiarCodigoAmazon, limpiarEan, limpiarPrecio, limpiarSku, limpiarTalla, sugerirFbasku } from '@/lib/fba/catalogo/normalizar'
import { avisosDeFila } from '@/lib/fba/catalogo/validar'
import { cx } from '../comun/ui'
import { anadirReferencias, useCatalogo } from './useCatalogo'

/**
 * AÑADIR UN MODELO A LA BASE DE DATOS: SU REF, SU COLOR Y SUS TALLAS.
 *
 * Se abre desde dos sitios —la pantalla de la base de datos y el desplegable de REF de
 * una propuesta— porque el momento de darla de alta es MIENTRAS se monta un envío, al
 * ver que falta una. Por eso se puede abrir ya con la REF escrita, y por eso al guardar
 * devuelve cuál ha creado: la propuesta la deja elegida y se sigue.
 *
 * Un modelo son varias tallas, y las tallas se escriben de golpe («36-41»). Y, como lo
 * que se tiene a mano suele ser una columna de EAN en una hoja, se puede PEGAR varias
 * filas en cualquier casilla y se reparten hacia abajo y hacia la derecha.
 *
 * El FBASKU sale solo del código de artículo (FBA + código + talla), pero como
 * propuesta: si se toca la casilla, ya es de quien la tocó.
 */

export interface PrellenadoReferencia {
  ref?: string
  nombre?: string
  tallas?: Array<{ talla: string; ean?: string | null; fnsku?: string | null; asin?: string | null; fbasku?: string | null }>
}

interface FilaNueva {
  uid: number
  talla: string
  ean: string
  fnsku: string
  asin: string
  fbasku: string
  /** Si es false, el FBASKU que se enseña es la propuesta y se recalcula con el código de artículo */
  fbaskuTocado: boolean
}

type Columna = 'talla' | 'ean' | 'fnsku' | 'asin' | 'fbasku'
const COLUMNAS: Columna[] = ['talla', 'ean', 'fnsku', 'asin', 'fbasku']

/** Las series de tallas que más se repiten en la hoja de ShoesF */
const SERIES = ['35-41', '36-41', '36-42', '39-46', '39-47']

let contador = 0
const nuevaFila = (extra: Partial<FilaNueva> = {}): FilaNueva => ({
  uid: ++contador,
  talla: '',
  ean: '',
  fnsku: '',
  asin: '',
  fbasku: '',
  fbaskuTocado: false,
  ...extra,
})

export function AnadirReferenciaDialog({
  clienteId,
  clienteNombre,
  prellenado,
  onCerrar,
  onAnadidas,
}: {
  clienteId: string
  clienteNombre: string
  prellenado?: PrellenadoReferencia
  onCerrar: () => void
  /** Se llama al guardar, con el modelo creado: quien la abrió lo deja elegido */
  onAnadidas?: (r: { ref: string; nombre: string; fbaskus: string[] }) => void
}) {
  const catalogo = useCatalogo(clienteId)
  const ix = catalogo.indice

  const [ref, setRef] = useState(prellenado?.ref ?? '')
  const [nombre, setNombre] = useState(prellenado?.nombre ?? '')
  const [codArt, setCodArt] = useState('')
  const [precio, setPrecio] = useState('')
  const [sinContinuidad, setSinContinuidad] = useState(false)
  const [serie, setSerie] = useState('')
  const [yaEstaban, setYaEstaban] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [filas, setFilas] = useState<FilaNueva[]>(() =>
    (prellenado?.tallas ?? []).map((t) =>
      nuevaFila({
        talla: t.talla,
        ean: t.ean ?? '',
        fnsku: t.fnsku ?? '',
        asin: t.asin ?? '',
        fbasku: t.fbasku ?? '',
        fbaskuTocado: !!t.fbasku,
      })
    )
  )

  const primerCampo = useRef<HTMLInputElement>(null)
  const campoSerie = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // Con la REF y el color ya puestos, lo que falta son las tallas
    const t = setTimeout(() => (prellenado?.ref && prellenado?.nombre ? campoSerie : primerCampo).current?.focus(), 30)
    return () => clearTimeout(t)
  }, [prellenado?.ref, prellenado?.nombre])

  /* ---------- Lo que ya existe ---------- */

  const existente = useMemo(() => (ref.trim() && nombre.trim() ? buscarModelo(ix, ref, nombre) : undefined), [ix, ref, nombre])
  const refsConocidas = useMemo(() => ix.grupos.map((g) => g.ref), [ix])
  const coloresConocidos = useMemo(() => coloresDe(ix, ref).map((m) => m.nombre), [ix, ref])

  const fbaskuDe = (f: FilaNueva): string => (f.fbaskuTocado ? f.fbasku : sugerirFbasku(codArt, f.talla))

  /** El problema de una fila, si lo hay: es lo que impide guardar */
  const errores = useMemo(() => {
    const mapa = new Map<number, string>()
    const tallas = new Map<string, number>()
    const skus = new Map<string, number>()
    for (const f of filas) {
      const t = limpiarTalla(f.talla)
      if (!t) {
        mapa.set(f.uid, 'Falta la talla')
        continue
      }
      if (tallas.has(t.toLowerCase())) mapa.set(f.uid, `La talla ${t} está dos veces`)
      tallas.set(t.toLowerCase(), f.uid)
      if (ref.trim() && nombre.trim() && buscarTalla(ix, ref, nombre, t)) mapa.set(f.uid, `${t} ya existe en la base de datos`)
      const sku = limpiarSku(fbaskuDe(f))
      if (sku) {
        const otra = ix.porSku.get(sku)
        if (otra) mapa.set(f.uid, `El FBASKU ${sku} ya es de ${otra.ref} ${otra.nombre} talla ${otra.talla}`)
        else if (skus.has(sku)) mapa.set(f.uid, `El FBASKU ${sku} está en dos filas`)
        skus.set(sku, f.uid)
      }
    }
    return mapa
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, codArt, ref, nombre, ix])

  const incompletas = filas.filter((f) =>
    avisosDeFila({ talla: f.talla, ean: limpiarEan(f.ean) || null, fnsku: limpiarCodigoAmazon(f.fnsku) || null, asin: limpiarCodigoAmazon(f.asin) || null, fbasku: limpiarSku(fbaskuDe(f)) || null }).some(
      (a) => a.gravedad === 'falta'
    )
  ).length

  const puedeGuardar = ref.trim() !== '' && nombre.trim() !== '' && filas.length > 0 && errores.size === 0 && !guardando

  /* ---------- Tallas ---------- */

  function anadirTallas(lista: string[]) {
    const ya = new Set(filas.map((f) => limpiarTalla(f.talla).toLowerCase()))
    const nuevas: FilaNueva[] = []
    const repetidas: string[] = []
    for (const t of lista) {
      if (ya.has(t.toLowerCase())) continue
      if (ref.trim() && nombre.trim() && buscarTalla(ix, ref, nombre, t)) {
        repetidas.push(t)
        continue
      }
      ya.add(t.toLowerCase())
      nuevas.push(nuevaFila({ talla: t }))
    }
    setYaEstaban(repetidas)
    if (nuevas.length > 0) setFilas((prev) => [...prev, ...nuevas].sort((a, b) => compararTalla(limpiarTalla(a.talla), limpiarTalla(b.talla))))
  }

  function aplicarSerie(texto: string) {
    const tallas = expandirTallas(texto)
    if (tallas.length === 0) {
      toast.error('No entiendo esas tallas. Escribe un rango (36-41) o una lista (39, 40, 42).')
      return
    }
    anadirTallas(tallas)
    setSerie('')
  }

  function cambiar(uid: number, campo: Columna, valor: string) {
    setFilas((prev) => prev.map((f) => (f.uid === uid ? { ...f, [campo]: valor, ...(campo === 'fbasku' ? { fbaskuTocado: true } : {}) } : f)))
  }

  /** Pegar varias filas desde una hoja: se reparten hacia abajo y hacia la derecha */
  function pegar(e: ClipboardEvent<HTMLInputElement>, indice: number, campo: Columna) {
    const texto = e.clipboardData.getData('text').replace(/\r/g, '')
    if (!/[\n\t]/.test(texto.replace(/\n+$/, ''))) return // una celda suelta: pegado normal
    e.preventDefault()
    const lineas = texto.replace(/\n+$/, '').split('\n')
    const c0 = COLUMNAS.indexOf(campo)
    setFilas((prev) => {
      const copia = [...prev]
      lineas.forEach((linea, k) => {
        const destino = indice + k
        while (copia.length <= destino) copia.push(nuevaFila())
        linea.split('\t').forEach((valor, j) => {
          const col = COLUMNAS[c0 + j]
          if (!col) return
          copia[destino] = { ...copia[destino], [col]: valor.trim(), ...(col === 'fbasku' ? { fbaskuTocado: true } : {}) }
        })
      })
      return copia
    })
  }

  /* ---------- Guardar ---------- */

  async function guardar() {
    if (!puedeGuardar) return
    setGuardando(true)
    try {
      // Si el modelo ya existe se respeta cómo está escrito: «Cuero» no abre un color nuevo junto a «CUERO»
      const refFinal = existente?.ref ?? coloresDe(ix, ref)[0]?.ref ?? ref.trim()
      const nombreFinal = existente?.nombre ?? nombre.trim()
      const continuidad = !sinContinuidad
      const precioFinal = limpiarPrecio(precio)
      const datos = filas.map((f) => ({
        ref: refFinal,
        nombre: nombreFinal,
        talla: limpiarTalla(f.talla),
        ean: limpiarEan(f.ean) || null,
        fnsku: limpiarCodigoAmazon(f.fnsku) || null,
        asin: limpiarCodigoAmazon(f.asin) || null,
        fbasku: limpiarSku(fbaskuDe(f)) || null,
        codArt: limpiarSku(codArt) || null,
        continuidad,
        precio: precioFinal,
        nota: null,
      }))
      const r = await anadirReferencias(clienteId, datos)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(`${datos.length} talla${datos.length === 1 ? '' : 's'} de ${refFinal} ${nombreFinal} en la base de datos`)
      onAnadidas?.({ ref: refFinal, nombre: nombreFinal, fbaskus: datos.map((d) => d.fbasku).filter((x): x is string => !!x) })
      onCerrar()
    } finally {
      setGuardando(false)
    }
  }

  const tallasDelModelo = existente ? `${existente.filas[0].talla}–${existente.filas[existente.filas.length - 1].talla}` : ''

  return (
    <Dialogo
      titulo="Añadir referencia"
      entradilla={`Se guarda en la base de datos de ${clienteNombre}. Desde ahí se eligen las referencias al montar una propuesta.`}
      onCerrar={onCerrar}
      ancho="max-w-[920px]"
      pie={
        <>
          <span className="mr-auto text-[11.5px] text-[var(--ls-t3)]">
            {filas.length === 0 ? (
              'Añade al menos una talla'
            ) : (
              <>
                <b className="font-semibold text-[var(--ls-t1)]">{filas.length}</b> talla{filas.length === 1 ? '' : 's'}
                {incompletas > 0 && (
                  <span className="ml-2 text-[var(--ls-t3)]" title="Les falta el FBASKU, el EAN, el FNSKU o el ASIN. Se pueden completar después.">
                    · {incompletas} sin algún código
                  </span>
                )}
              </>
            )}
          </span>
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={!puedeGuardar} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {filas.length > 1 ? `Añadir ${filas.length} tallas` : 'Añadir talla'}
          </button>
        </>
      }
    >
      {/* ================= EL MODELO ================= */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_1fr_110px]">
        <div>
          <label className={CAMPO.etiqueta} htmlFor="ar-ref">
            REF <span className={CAMPO.obligatorio}>*</span>
          </label>
          <input ref={primerCampo} id="ar-ref" list="ar-refs" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="8412" autoComplete="off" className={CAMPO.input} />
          <datalist id="ar-refs">
            {refsConocidas.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={CAMPO.etiqueta} htmlFor="ar-nombre">
            Nombre y color <span className={CAMPO.obligatorio}>*</span>
          </label>
          <input id="ar-nombre" list="ar-colores" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="CUERO" autoComplete="off" className={CAMPO.input} />
          <datalist id="ar-colores">
            {coloresConocidos.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className={CAMPO.etiqueta} htmlFor="ar-cod">
            COD ART
          </label>
          <input id="ar-cod" value={codArt} onChange={(e) => setCodArt(e.target.value)} placeholder="047768" autoComplete="off" className={cx(CAMPO.input, 'font-mono text-[12px]')} />
        </div>
        <div>
          <label className={CAMPO.etiqueta} htmlFor="ar-precio">
            Precio
          </label>
          <input id="ar-precio" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="89,90" inputMode="decimal" autoComplete="off" className={cx(CAMPO.input, CAMPO.numero)} />
        </div>
      </div>
      <p className={CAMPO.nota}>
        El COD ART sirve para proponer el FBASKU de cada talla (FBA + código + talla). Si el FBASKU de Amazon es otro, se cambia en la tabla.
        <label className="ml-3 inline-flex cursor-pointer items-center gap-[6px] text-[var(--ls-t3)]">
          <input type="checkbox" checked={sinContinuidad} onChange={(e) => setSinContinuidad(e.target.checked)} className="h-3 w-3 accent-[var(--ls-acc)]" />
          Sin continuidad (se descataloga)
        </label>
      </p>

      {existente && (
        <div className="flex items-start gap-[7px] rounded-[6px] border border-[var(--ls-linea2)] border-l-2 bg-[var(--ls-sup2)] px-[9px] py-[7px] text-[11.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderLeftColor: COLOR_ESTADO.azul }}>
          <span>
            <b className="font-semibold text-[var(--ls-t1)]">
              {existente.ref} {existente.nombre}
            </b>{' '}
            ya está en la base de datos con {existente.filas.length} talla{existente.filas.length === 1 ? '' : 's'} ({tallasDelModelo}). Aquí solo se añaden las que falten.
          </span>
        </div>
      )}

      {/* ================= LAS TALLAS ================= */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1 sm:max-w-[320px]">
          <label className={CAMPO.etiqueta} htmlFor="ar-serie">
            Tallas
          </label>
          <input
            ref={campoSerie}
            id="ar-serie"
            value={serie}
            onChange={(e) => setSerie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (serie.trim()) aplicarSerie(serie)
              }
            }}
            placeholder="36-41   ó   39, 40, 42"
            autoComplete="off"
            className={CAMPO.input}
          />
        </div>
        <button type="button" onClick={() => aplicarSerie(serie)} disabled={!serie.trim()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
          <Plus className="h-3 w-3" />
          Añadir tallas
        </button>
        <div className="flex flex-wrap items-center gap-[5px] pb-[1px]">
          <span className="text-[11px] text-[var(--ls-t4)]">Series:</span>
          {SERIES.map((s) => (
            <button key={s} type="button" onClick={() => aplicarSerie(s)} className={BOTON.chip}>
              {s}
            </button>
          ))}
          <button type="button" onClick={() => setFilas((prev) => [...prev, nuevaFila()])} className={BOTON.chip} title="Una fila en blanco">
            + una
          </button>
        </div>
      </div>
      {yaEstaban.length > 0 && <p className={CAMPO.nota}>Ya estaban en la base de datos y no se repiten: {yaEstaban.join(', ')}.</p>}

      {filas.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[var(--ls-linea2)] px-4 py-6 text-center text-[12px] text-[var(--ls-t3)]">
          Escribe las tallas arriba (por ejemplo <b className="font-semibold text-[var(--ls-t2)]">36-41</b>) o pulsa una serie, y rellena los códigos de cada una.
          <br />
          Si los tienes en una hoja, copia las celdas y pégalas en cualquier casilla de la tabla.
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto rounded-[6px] border border-[var(--ls-linea)]">
          <table className={TABLA.tabla}>
            <thead>
              <tr>
                <th className={cx(TABLA.cabecera, 'w-[70px]')}>Talla</th>
                <th className={cx(TABLA.cabecera, 'w-[150px]')}>EAN</th>
                <th className={cx(TABLA.cabecera, 'w-[120px]')}>FNSKU</th>
                <th className={cx(TABLA.cabecera, 'w-[120px]')}>ASIN</th>
                <th className={TABLA.cabecera}>FBASKU</th>
                <th className={cx(TABLA.cabecera, 'w-[60px]')} />
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const error = errores.get(f.uid)
                const avisos = avisosDeFila({ talla: f.talla, ean: limpiarEan(f.ean) || null, fnsku: limpiarCodigoAmazon(f.fnsku) || null, asin: limpiarCodigoAmazon(f.asin) || null, fbasku: limpiarSku(fbaskuDe(f)) || null }).filter((a) => a.gravedad === 'aviso')
                const celda = (campo: Columna, valor: string, ancho?: string, mono = true) => (
                  <td className={cx(TABLA.celda, 'px-[3px]')}>
                    <input
                      value={valor}
                      onChange={(e) => cambiar(f.uid, campo, e.target.value)}
                      onPaste={(e) => pegar(e, i, campo)}
                      aria-label={`${campo.toUpperCase()} de la fila ${i + 1}`}
                      autoComplete="off"
                      spellCheck={false}
                      className={cx(CELDA.editable, mono && 'font-mono text-[12px]', ancho)}
                      style={error && (campo === 'talla' || campo === 'fbasku') ? { borderColor: COLOR_ESTADO.rojo } : undefined}
                    />
                  </td>
                )
                return (
                  <tr key={f.uid} className={TABLA.fila}>
                    {celda('talla', f.talla, undefined, false)}
                    {celda('ean', f.ean)}
                    {celda('fnsku', f.fnsku)}
                    {celda('asin', f.asin)}
                    <td className={cx(TABLA.celda, 'px-[3px]')}>
                      <input
                        value={fbaskuDe(f)}
                        onChange={(e) => cambiar(f.uid, 'fbasku', e.target.value)}
                        onPaste={(e) => pegar(e, i, 'fbasku')}
                        aria-label={`FBASKU de la fila ${i + 1}`}
                        autoComplete="off"
                        spellCheck={false}
                        className={cx(CELDA.editable, 'font-mono text-[12px]', !f.fbaskuTocado && 'text-[var(--ls-t3)]')}
                        title={f.fbaskuTocado ? undefined : 'Propuesto a partir del COD ART. Escríbelo para fijarlo'}
                        style={error ? { borderColor: COLOR_ESTADO.rojo } : undefined}
                      />
                    </td>
                    <td className={cx(TABLA.celda, 'px-[3px]')}>
                      <span className="flex items-center justify-end gap-[2px]">
                        {(error || avisos.length > 0) && (
                          <span title={error ?? avisos.map((a) => a.texto).join('\n')} className="inline-flex h-5 w-5 items-center justify-center">
                            <AlertTriangle className="h-[13px] w-[13px]" style={{ color: error ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }} />
                          </span>
                        )}
                        <button type="button" onClick={() => setFilas((prev) => prev.filter((x) => x.uid !== f.uid))} className={cx(BOTON.icono, 'hover:!text-[var(--ls-e-rojo)]')} title="Quitar esta talla" aria-label={`Quitar la fila ${i + 1}`}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {errores.size > 0 && (
        <p className="text-[11.5px] leading-[1.5]" style={{ color: COLOR_ESTADO.rojo }}>
          {Array.from(errores.values())[0]}
          {errores.size > 1 && ` (y ${errores.size - 1} más)`}
        </p>
      )}
    </Dialogo>
  )
}

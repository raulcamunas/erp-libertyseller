'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Loader2, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, CAMPO, CELDA, COLOR_ESTADO, TABLA, TIPO } from '@/lib/estilo/denso'
import { coincide, textoBuscable, type Modelo } from '@/lib/fba/catalogo/indice'
import { limpiarCodigoAmazon, limpiarEan, limpiarPrecio, limpiarSku, limpiarTalla } from '@/lib/fba/catalogo/normalizar'
import { claveModelo, type DatosFila, type FilaCatalogo } from '@/lib/fba/catalogo/tipos'
import { avisosDeFila } from '@/lib/fba/catalogo/validar'
import { cx, Vacio } from '../comun/ui'
import { useTecladoDeLista } from '../comun/useTeclado'
import type { PrellenadoReferencia } from './AnadirReferenciaDialog'
import { corregirReferencias, quitarReferencias, useCatalogo } from './useCatalogo'

/**
 * LA BASE DE DATOS DE REFERENCIAS DE UN CLIENTE.
 *
 * A la izquierda, los modelos —cada REF con sus colores—; a la derecha, las tallas del
 * elegido con todos sus códigos, que se corrigen en la propia tabla. Es la misma
 * estructura de las otras pantallas del módulo (lista y espacio de trabajo), para que
 * moverse por aquí no sea aprender otra cosa.
 *
 *
 * ============ SE EDITA EN LA CELDA Y SE GUARDA AL SALIR DE ELLA ============
 *
 * No hay un botón Guardar por fila: se toca una casilla, se pulsa Enter o Tab, y se
 * guarda. El cambio se ve al instante y, si el servidor lo rechaza —un FBASKU que ya
 * es de otra talla, una talla repetida—, la casilla vuelve a lo que tenía y avisa del
 * motivo. Es lo que permite arreglar veinte códigos seguidos sin esperar a nadie.
 *
 * Lo que se puede hacer con un modelo entero (cambiar su REF o su color, quitarlo) y
 * con la base (añadir, importar) está en la cabecera de cada panel.
 */

type Filtro = 'todos' | 'incompletos' | 'sinContinuidad'

export function VistaBaseDeDatos({
  clienteId,
  clienteNombre,
  onAnadir,
  onImportar,
}: {
  clienteId: string
  clienteNombre: string
  onAnadir: (prellenado?: PrellenadoReferencia) => void
  onImportar: () => void
}) {
  const catalogo = useCatalogo(clienteId)
  const ix = catalogo.indice
  const puedeEditar = catalogo.puedeEditar

  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [elegido, setElegido] = useState<string | null>(null)

  const textos = useMemo(() => new Map(ix.modelos.map((m) => [m.clave, textoBuscable(m)])), [ix])
  const cuentas = useMemo(
    () => ({
      todos: ix.modelos.length,
      incompletos: ix.modelos.filter((m) => m.incompletas > 0).length,
      sinContinuidad: ix.modelos.filter((m) => m.sinContinuidad).length,
    }),
    [ix]
  )

  const grupos = useMemo(
    () =>
      ix.grupos
        .map((g) => ({
          ...g,
          modelos: g.modelos.filter(
            (m) =>
              (filtro === 'todos' || (filtro === 'incompletos' && m.incompletas > 0) || (filtro === 'sinContinuidad' && m.sinContinuidad)) &&
              (busqueda.trim() === '' || coincide(textos.get(m.clave) ?? '', busqueda))
          ),
        }))
        .filter((g) => g.modelos.length > 0),
    [ix, filtro, busqueda, textos]
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

  /* ---------- Estados de la base ---------- */

  if (!catalogo.filas && !catalogo.error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando la base de datos de {clienteNombre}…
      </div>
    )
  }

  if (catalogo.sinMigrar || catalogo.error || (catalogo.filas && catalogo.filas.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
        <Vacio
          icono={<Database />}
          titulo={catalogo.sinMigrar ? 'Falta lanzar la migración 226' : catalogo.error ? 'No se ha podido leer la base de datos' : `Todavía no hay referencias de ${clienteNombre}`}
          accion={
            catalogo.error ? (
              <button type="button" onClick={() => void catalogo.recargar()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                Reintentar
              </button>
            ) : !catalogo.sinMigrar && puedeEditar ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={onImportar} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                  <Upload className="h-3 w-3" />
                  Importar CSV
                </button>
                <button type="button" onClick={() => onAnadir()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                  <Plus className="h-3 w-3" />
                  Añadir referencia
                </button>
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
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* ================= LOS MODELOS ================= */}
      <aside ref={raiz} className="flex min-h-0 min-w-0 flex-col gap-2">
        <div className="flex shrink-0 flex-col gap-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar REF, color, EAN, FBASKU…" className={cx(CAMPO.input, 'h-[28px] pl-[26px]')} aria-label="Buscar en la base de datos" />
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
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-[10px] overflow-y-auto pr-[2px]">
          {grupos.length === 0 && (
            <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
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
              <div className="space-y-[4px]">
                {g.modelos.map((m) => (
                  <TarjetaModelo key={m.clave} modelo={m} activa={m.clave === modelo?.clave} onClick={() => setElegido(m.clave)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </aside>

      {/* ================= EL MODELO ELEGIDO ================= */}
      <section className="min-h-0 min-w-0">
        {modelo ? (
          <FichaModelo
            key={modelo.clave}
            clienteId={clienteId}
            modelo={modelo}
            puedeEditar={puedeEditar}
            puedeBorrar={catalogo.puedeBorrar}
            onAnadirTalla={() => onAnadir({ ref: modelo.ref, nombre: modelo.nombre })}
            onRenombrado={(ref, nombre) => setElegido(claveModelo(ref, nombre))}
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
            <Vacio icono={<Database />} titulo="Elige un modelo de la lista">
              Aquí aparecen sus tallas con todos los códigos, que se corrigen en la propia tabla.
            </Vacio>
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La lista                                                            */
/* ------------------------------------------------------------------ */

function Chip({ activo, onClick, cuenta, children, apagado, titulo }: { activo: boolean; onClick: () => void; cuenta: number; children: React.ReactNode; apagado?: boolean; titulo?: string }) {
  return (
    <button type="button" onClick={onClick} title={titulo} className={cx(BOTON.chip, activo && BOTON.chipEncendido, apagado && !activo && 'opacity-55')}>
      {children}
      <span className="tabular-nums text-[var(--ls-t4)]">{cuenta}</span>
    </button>
  )
}

function TarjetaModelo({ modelo, activa, onClick }: { modelo: Modelo; activa: boolean; onClick: () => void }) {
  const primera = modelo.filas[0]?.talla
  const ultima = modelo.filas[modelo.filas.length - 1]?.talla
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa}
      className={cx(
        'relative block w-full rounded-[8px] border px-[11px] py-[7px] text-left transition-colors',
        activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sel)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)]',
        modelo.sinContinuidad && !activa && 'opacity-70'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{modelo.nombre}</p>
        {modelo.incompletas > 0 && (
          <span className="inline-flex shrink-0 items-center gap-[3px] text-[11px] tabular-nums" style={{ color: COLOR_ESTADO.ambar }} title={`${modelo.incompletas} talla${modelo.incompletas === 1 ? '' : 's'} sin algún código`}>
            <AlertTriangle className="h-3 w-3" />
            {modelo.incompletas}
          </span>
        )}
      </div>
      <p className="mt-[1px] truncate text-[11px] text-[var(--ls-t4)]">
        {modelo.filas.length} talla{modelo.filas.length === 1 ? '' : 's'}
        {modelo.filas.length > 1 && ` · ${primera}–${ultima}`}
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
  puedeEditar,
  puedeBorrar,
  onAnadirTalla,
  onRenombrado,
}: {
  clienteId: string
  modelo: Modelo
  puedeEditar: boolean
  puedeBorrar: boolean
  onAnadirTalla: () => void
  onRenombrado: (ref: string, nombre: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [quitando, setQuitando] = useState(false)

  const filas = modelo.filas
  const cod = Array.from(new Set(filas.map((f) => f.codArt).filter(Boolean)))

  async function quitarModelo() {
    setQuitando(true)
    const r = await quitarReferencias(clienteId, filas.map((f) => f.id))
    setQuitando(false)
    setConfirmar(false)
    if (!r.ok) toast.error(r.error)
    else toast.success(`${modelo.ref} ${modelo.nombre} quitado de la base de datos`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <header className="shrink-0 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-[10px]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className={cx(TIPO.xl, 'truncate text-[var(--ls-t1)]')}>
              {modelo.ref}
              <span className="mx-2 text-[var(--ls-t4)]">·</span>
              {modelo.nombre}
            </h2>
            <p className="mt-[3px] text-[12px] text-[var(--ls-t3)]">
              {filas.length} talla{filas.length === 1 ? '' : 's'}
              {cod.length === 1 && <> · COD ART <span className="font-mono text-[11.5px]">{cod[0]}</span></>}
              {modelo.sinContinuidad && <> · <span style={{ color: COLOR_ESTADO.ambar }}>sin continuidad</span></>}
              {modelo.incompletas > 0 && (
                <>
                  {' '}
                  · <span style={{ color: COLOR_ESTADO.ambar }}>{modelo.incompletas} incompleta{modelo.incompletas === 1 ? '' : 's'}</span>
                </>
              )}
            </p>
          </div>

          {puedeEditar && (
            <div className="flex shrink-0 items-center gap-[6px]">
              <button type="button" onClick={onAnadirTalla} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
                <Plus className="h-3 w-3" />
                Añadir talla
              </button>
              <button type="button" onClick={() => setEditando(true)} className={cx(BOTON.icono, 'h-7 w-7')} title="Cambiar la REF o el color de todo el modelo" aria-label="Editar el modelo">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {puedeBorrar &&
                (confirmar ? (
                  <span className="flex items-center gap-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2 py-1 text-[11.5px]">
                    <span className="text-[var(--ls-t2)]">¿Quitar las {filas.length} tallas?</span>
                    <button type="button" onClick={quitarModelo} disabled={quitando} className="font-semibold text-[var(--ls-e-rojo)] hover:underline">
                      {quitando ? '…' : 'Sí'}
                    </button>
                    <button type="button" onClick={() => setConfirmar(false)} className="text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmar(true)} className={cx(BOTON.icono, 'h-7 w-7 hover:!text-[var(--ls-e-rojo)]')} title="Quitar el modelo entero de la base de datos" aria-label="Quitar el modelo">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ))}
            </div>
          )}
        </div>
      </header>

      <div className={cx(TABLA.caja, 'min-h-0')}>
        <table className={TABLA.tabla}>
          <thead>
            <tr>
              <th className={cx(TABLA.cabecera, 'w-[72px]')}>Talla</th>
              <th className={cx(TABLA.cabecera, 'w-[140px]')}>EAN</th>
              <th className={cx(TABLA.cabecera, 'w-[116px]')}>FNSKU</th>
              <th className={cx(TABLA.cabecera, 'w-[116px]')}>ASIN</th>
              <th className={cx(TABLA.cabecera, 'w-[160px]')}>FBASKU</th>
              <th className={cx(TABLA.cabecera, 'w-[104px]')}>COD ART</th>
              <th className={cx(TABLA.cabecera, TABLA.derecha, 'w-[80px]')}>Precio</th>
              <th className={cx(TABLA.cabecera, 'w-[52px] text-center')} title="El modelo sigue en catálogo">
                Cont.
              </th>
              <th className={cx(TABLA.cabecera, 'w-[64px]')} />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <FilaTalla key={f.id} fila={f} clienteId={clienteId} puedeEditar={puedeEditar} puedeBorrar={puedeBorrar} />
            ))}
          </tbody>
        </table>
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

function FilaTalla({ fila, clienteId, puedeEditar, puedeBorrar }: { fila: FilaCatalogo; clienteId: string; puedeEditar: boolean; puedeBorrar: boolean }) {
  const [confirmar, setConfirmar] = useState(false)
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

  return (
    <tr className={TABLA.fila}>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda valor={fila.talla} soloLectura={!puedeEditar} limpiar={limpiarTalla} onGuardar={(v) => (v ? guardar({ talla: v }) : Promise.resolve(false))} etiqueta={`Talla ${fila.talla}`} negrita />
      </td>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda valor={fila.ean} soloLectura={!puedeEditar} limpiar={limpiarEan} onGuardar={(v) => guardar({ ean: v })} etiqueta={`EAN de la talla ${fila.talla}`} mono marca={falta('ean')} />
      </td>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda valor={fila.fnsku} soloLectura={!puedeEditar} limpiar={limpiarCodigoAmazon} onGuardar={(v) => guardar({ fnsku: v })} etiqueta={`FNSKU de la talla ${fila.talla}`} mono marca={falta('fnsku')} />
      </td>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda valor={fila.asin} soloLectura={!puedeEditar} limpiar={limpiarCodigoAmazon} onGuardar={(v) => guardar({ asin: v })} etiqueta={`ASIN de la talla ${fila.talla}`} mono marca={falta('asin')} />
      </td>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda valor={fila.fbasku} soloLectura={!puedeEditar} limpiar={limpiarSku} onGuardar={(v) => guardar({ fbasku: v })} etiqueta={`FBASKU de la talla ${fila.talla}`} mono marca={falta('fbasku')} />
      </td>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda valor={fila.codArt} soloLectura={!puedeEditar} limpiar={limpiarSku} onGuardar={(v) => guardar({ codArt: v })} etiqueta={`COD ART de la talla ${fila.talla}`} mono />
      </td>
      <td className={cx(TABLA.celda, 'px-[3px]')}>
        <Celda
          valor={fila.precio === null ? null : fila.precio.toFixed(2).replace('.', ',')}
          soloLectura={!puedeEditar}
          limpiar={(v) => v.trim()}
          onGuardar={async (v) => {
            if (v === null) return guardar({ precio: null })
            const n = limpiarPrecio(v)
            if (n === null) {
              toast.error('Ese precio no es un número')
              return false
            }
            return guardar({ precio: n })
          }}
          etiqueta={`Precio de la talla ${fila.talla}`}
          derecha
        />
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
          {avisos.length > 0 && (
            <span className="inline-flex h-5 w-5 items-center justify-center" title={avisos.map((a) => a.texto).join('\n')}>
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
            </span>
          )}
          {puedeBorrar &&
            (confirmar ? (
              <span className="flex items-center gap-[6px] text-[11px]">
                <button type="button" onClick={quitar} className="font-semibold text-[var(--ls-e-rojo)] hover:underline">
                  Quitar
                </button>
                <button type="button" onClick={() => setConfirmar(false)} className="text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
                  No
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmar(true)} className={cx(BOTON.icono, 'hover:!text-[var(--ls-e-rojo)]')} title="Quitar esta talla" aria-label={`Quitar la talla ${fila.talla}`}>
                <Trash2 className="h-3 w-3" />
              </button>
            ))}
        </span>
      </td>
    </tr>
  )
}

/**
 * Una casilla que se edita en su sitio. No parece un campo hasta que pasas por
 * encima (CELDA.editable). Enter o salir de ella guarda; Esc deja lo que había.
 * Si el servidor rechaza el cambio, vuelve a lo anterior.
 */
function Celda({
  valor,
  onGuardar,
  limpiar,
  etiqueta,
  mono,
  negrita,
  derecha,
  marca,
  soloLectura,
}: {
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
}) {
  const [texto, setTexto] = useState(valor ?? '')
  const [guardando, setGuardando] = useState(false)
  const cancelado = useRef(false)

  // Si el valor cambia por fuera (otra pestaña, una importación), la casilla lo sigue
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
      <span className={cx('block h-5 truncate px-[5px] leading-5', mono ? 'font-mono text-[12px] text-[var(--ls-t3)]' : 'text-[var(--ls-t2)]', derecha && 'text-right tabular-nums', negrita && 'font-semibold text-[var(--ls-t1)]')} title={valor ?? undefined}>
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
      spellCheck={false}
      className={cx(CELDA.editable, mono && 'font-mono text-[12px]', derecha && 'text-right tabular-nums', negrita && 'font-semibold text-[var(--ls-t1)]', guardando && 'opacity-60', marca && !texto && 'placeholder:text-[var(--ls-e-ambar)]')}
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
            {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
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
          <input id="em-ref" value={ref} onChange={(e) => setRef(e.target.value)} autoFocus autoComplete="off" className={CAMPO.input} />
        </div>
        <div>
          <label className={CAMPO.etiqueta} htmlFor="em-nombre">
            Nombre y color
          </label>
          <input id="em-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={CAMPO.input} />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
        <input type="checkbox" checked={continuidad} onChange={(e) => setContinuidad(e.target.checked)} className="h-3 w-3 accent-[var(--ls-acc)]" />
        Sigue en catálogo (con continuidad)
      </label>
    </Dialogo>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, Package, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, TACTIL } from '@/components/ui-ls/Boton'
import { Insignia } from '@/components/ui-ls/Insignia'
import { EsqueletoTexto } from '@/components/ui-ls/Esqueleto'
import { CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { LineaPlan } from '@/lib/fba/plan-tipos'
import { entero } from '../formato'
import { leerRespuesta } from '../comun/errores'
import { invalidarRemesas } from '../comun/useAgencia'
import { cx } from '../comun/ui'

/**
 * LOS AJUSTES DE UNA REFERENCIA PARA EL PLAN (spec remesas-pro §7, §9 y D13; paquete C5).
 *
 * Contra `GET/PUT /api/fba/reposicion-sku?cliente=` (tabla `fba_reposicion_sku`, migración 316):
 *   · Unidades por caja: la suya manda sobre la deducida de sus envíos y sobre la del cliente. «Caja deducida: 18 ·
 *     Guardar» la guarda como suya (con las cantidades de las que sale, para que se vea por qué).
 *   · Cobertura propia (7-180 días): para la referencia que se quiere más o menos cubierta que el resto.
 *   · Excluir del plan, con motivo: «no se repone», «descatalogada»… El plan la deja fuera como `descatalogada`.
 * PUT parcial: solo va lo que cambia. Vacío = quitar lo suyo (vuelve a la del cliente).
 *
 * Sin la 316 la ruta contesta 409: se enseña el aviso y no se puede guardar.
 *
 * API
 *   <AjustesSku clienteId sku linea? puedeEditar alGuardar? />
 *   guardarAjusteSku(clienteId, cambio)   PUT de una referencia fuera del formulario (Guardar caja deducida, Descatalogada)
 *     → { ok: true } | { ok: false, error }. Invalida la memoria del cliente (el plan se vuelve a pedir).
 */

export interface CambioAjusteSku {
  sku: string
  unidadesCaja?: number | null
  coberturaDias?: number | null
  excluir?: boolean
  motivo?: string | null
  guardarCajaDeducida?: boolean
}

interface ReferenciaAjustes {
  sku: string
  unidadesCaja: number | null
  coberturaDias: number | null
  excluir: boolean
  motivo: string | null
  actualizadoAt: string | null
  guardada: boolean
  cajaDeducida: number | null
  cajaEncaje: number | null
  cantidadesEnviadas: number[]
  caja: { unidades: number; origen: 'sku' | 'deducida' | 'cliente' } | null
  puedeGuardarDeducida: boolean
}

interface RespuestaSku {
  referencias: ReferenciaAjustes[]
  multiploCliente: number | null
  migracion316: boolean
  aviso: string | null
}

const SIN_RED = 'No hay conexión con el servidor: comprueba la red y vuelve a probar.'

export async function guardarAjusteSku(clienteId: string, cambio: CambioAjusteSku): Promise<{ ok: true; referencia: ReferenciaAjustes | null } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(`/api/fba/reposicion-sku?cliente=${encodeURIComponent(clienteId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente: clienteId, ...cambio }),
    })
  } catch {
    return { ok: false, error: SIN_RED }
  }
  const r = await leerRespuesta<RespuestaSku>(res, 'No se ha podido guardar el ajuste de la referencia')
  if (!r.ok) return { ok: false, error: r.error }
  invalidarRemesas(clienteId)
  return { ok: true, referencia: r.datos.referencias?.find((x) => x.sku === cambio.sku) ?? null }
}

const ORIGEN_CAJA: Record<'sku' | 'deducida' | 'cliente', string> = { sku: 'suya', deducida: 'deducida de sus envíos', cliente: 'la del cliente' }

const aTexto = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n))
const aNumero = (t: string): number | null | 'mal' => {
  const s = t.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isInteger(n) ? n : 'mal'
}

const INPUT = cx(CAMPO.input, CAMPO.numero, 'h-8 !w-[96px] rounded-[10px]', TACTIL)

export function AjustesSku({
  clienteId,
  sku,
  linea,
  puedeEditar,
  alGuardar,
  className,
}: {
  clienteId: string
  sku: string
  /** La línea del plan, para enseñar la caja y la cobertura que usa hoy */
  linea?: Pick<LineaPlan, 'caja' | 'coberturaEfectiva'> | null
  puedeEditar: boolean
  alGuardar?: () => void
  className?: string
}) {
  const [ref, setRef] = useState<ReferenciaAjustes | null>(null)
  const [migracion, setMigracion] = useState<boolean>(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [caja, setCaja] = useState('')
  const [cobertura, setCobertura] = useState('')
  const [excluir, setExcluir] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    fetch(`/api/fba/reposicion-sku?cliente=${encodeURIComponent(clienteId)}&sku=${encodeURIComponent(sku)}`, { cache: 'no-store' })
      .then((res) => leerRespuesta<RespuestaSku>(res, 'No se han podido leer los ajustes de la referencia'))
      .catch(() => ({ ok: false as const, estado: 0, error: SIN_RED, datos: null }))
      .then((r) => {
        if (!vivo) return
        if (!r.ok) {
          setError(r.error)
          setCargando(false)
          return
        }
        const x = r.datos.referencias?.find((f) => f.sku === sku) ?? null
        setRef(x)
        setMigracion(r.datos.migracion316 !== false)
        setAviso(r.datos.aviso ?? null)
        setError(null)
        setCaja(aTexto(x?.unidadesCaja))
        setCobertura(aTexto(x?.coberturaDias))
        setExcluir(x?.excluir === true)
        setMotivo(x?.motivo ?? '')
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [clienteId, sku, version])

  const cajaN = aNumero(caja)
  const coberturaN = aNumero(cobertura)
  const errorCaja = cajaN === 'mal' || (typeof cajaN === 'number' && (cajaN < 1 || cajaN > 500)) ? 'De 1 a 500, sin decimales' : null
  const errorCobertura = coberturaN === 'mal' || (typeof coberturaN === 'number' && (coberturaN < 7 || coberturaN > 180)) ? 'De 7 a 180 días' : null
  const errorMotivo = motivo.trim().length > 300 ? 'Máximo 300 caracteres' : null

  const cambio: CambioAjusteSku = { sku }
  if (cajaN !== 'mal' && cajaN !== (ref?.unidadesCaja ?? null)) cambio.unidadesCaja = cajaN
  if (coberturaN !== 'mal' && coberturaN !== (ref?.coberturaDias ?? null)) cambio.coberturaDias = coberturaN
  if (excluir !== (ref?.excluir === true)) cambio.excluir = excluir
  if ((motivo.trim() || null) !== (ref?.motivo ?? null)) cambio.motivo = motivo.trim() || null
  const hayCambios = Object.keys(cambio).length > 1
  const deshabilitado = !puedeEditar || !migracion || guardando
  const hayErrores = !!(errorCaja || errorCobertura || errorMotivo)

  async function guardar(c: CambioAjusteSku, exito: string) {
    setGuardando(true)
    try {
      const r = await guardarAjusteSku(clienteId, c)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(exito)
      setVersion((v) => v + 1)
      alGuardar?.()
    } finally {
      setGuardando(false)
    }
  }

  if (cargando && !ref) {
    return (
      <div className={cx('min-w-0', className)}>
        <EsqueletoTexto lineas={3} />
      </div>
    )
  }
  if (error) {
    return (
      <p role="alert" className={cx('flex items-start gap-2 text-[12px] text-[var(--ls-t2)]', className)}>
        <AlertTriangle className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.rojo }} aria-hidden />
        {error}
      </p>
    )
  }

  const cajaVigente = linea?.caja ?? ref?.caja ?? null

  return (
    <div className={cx('min-w-0 space-y-3', className)}>
      {(!migracion || aviso) && (
        <p className="rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-[7px] text-[12px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
          {aviso ?? 'Falta lanzar la migración 316: los ajustes por referencia no se pueden guardar todavía.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ls-t3)]">
        <Package className="h-[14px] w-[14px] text-[var(--ls-t4)]" aria-hidden />
        {cajaVigente ? (
          <span>
            El plan redondea a cajas de <b className="text-[var(--ls-t1)]">{entero(cajaVigente.unidades)} ud</b> ({ORIGEN_CAJA[cajaVigente.origen]})
          </span>
        ) : (
          <span>El plan no conoce la caja: propone unidades sueltas.</span>
        )}
        {linea && <span>· cubre {entero(linea.coberturaEfectiva)} días tras llegar</span>}
      </div>

      {ref?.cajaDeducida != null && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t2)]">
          <span className="min-w-0 flex-1">
            Caja deducida: <b className="tabular-nums text-[var(--ls-t1)]">{entero(ref.cajaDeducida)}</b>
            {ref.cajaEncaje ? ' (del encaje de sus cajas)' : ref.cantidadesEnviadas.length > 0 ? ` (de lo enviado: ${ref.cantidadesEnviadas.slice(0, 6).map(entero).join(', ')})` : ''}
          </span>
          {ref.puedeGuardarDeducida ? (
            <Boton tamano="sm" variante="secundario" icono={Save} disabled={deshabilitado} cargando={guardando} onClick={() => void guardar({ sku, guardarCajaDeducida: true }, `Caja de ${sku}: ${ref.cajaDeducida} ud`)}>
              Guardar
            </Boton>
          ) : (
            <Insignia tono="verde" tamano="sm" icono={Check}>
              Guardada
            </Insignia>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <Campo id={`sku-caja-${sku}`} titulo="Unidades por caja" unidad="ud" valor={caja} onCambio={setCaja} error={errorCaja} deshabilitado={deshabilitado} placeholder={ref?.cajaDeducida ? String(ref.cajaDeducida) : '—'} />
        <Campo id={`sku-cob-${sku}`} titulo="Cobertura propia" unidad="días" valor={cobertura} onCambio={setCobertura} error={errorCobertura} deshabilitado={deshabilitado} placeholder="la del cliente" />
      </div>

      <div className="space-y-2">
        <label className={cx('flex items-start gap-2 text-[12.5px] text-[var(--ls-t1)]', TACTIL)}>
          <input type="checkbox" checked={excluir} disabled={deshabilitado} onChange={(e) => setExcluir(e.target.checked)} className="mt-[3px] h-4 w-4 accent-[var(--ls-acc)]" />
          <span>
            <span className="inline-flex items-center gap-1">
              <Ban className="h-[13px] w-[13px] text-[var(--ls-t4)]" aria-hidden /> Sacar del plan
            </span>
            <span className="block text-[11.5px] text-[var(--ls-t4)]">No se propone nunca (se deja de vender, la repone el cliente por su cuenta…).</span>
          </span>
        </label>
        {(excluir || motivo) && (
          <div className="min-w-0">
            <label htmlFor={`sku-motivo-${sku}`} className={CAMPO.etiqueta}>
              Motivo
            </label>
            <input
              id={`sku-motivo-${sku}`}
              value={motivo}
              maxLength={300}
              disabled={deshabilitado}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descatalogada, la manda el cliente…"
              className={cx(CAMPO.input, 'h-8 rounded-[10px]', TACTIL)}
            />
            {errorMotivo && <p className="mt-1 text-[11px] text-[var(--ls-e-rojo)]">{errorMotivo}</p>}
          </div>
        )}
      </div>

      {puedeEditar && (
        <div className="flex flex-wrap justify-end gap-2">
          {hayCambios && (
            <Boton
              tamano="sm"
              variante="fantasma"
              icono={RotateCcw}
              disabled={guardando}
              onClick={() => {
                setCaja(aTexto(ref?.unidadesCaja))
                setCobertura(aTexto(ref?.coberturaDias))
                setExcluir(ref?.excluir === true)
                setMotivo(ref?.motivo ?? '')
              }}
            >
              Descartar
            </Boton>
          )}
          <Boton tamano="sm" variante="secundario" icono={Save} disabled={!hayCambios || hayErrores || deshabilitado} cargando={guardando} onClick={() => void guardar(cambio, `Ajustes de ${sku} guardados. El plan los usa al recalcular.`)}>
            Guardar ajustes
          </Boton>
        </div>
      )}
    </div>
  )
}

function Campo({
  id,
  titulo,
  unidad,
  valor,
  onCambio,
  error,
  deshabilitado,
  placeholder,
}: {
  id: string
  titulo: string
  unidad: string
  valor: string
  onCambio: (t: string) => void
  error: string | null
  deshabilitado: boolean
  placeholder?: string
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={CAMPO.etiqueta}>
        {titulo}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          inputMode="numeric"
          value={valor}
          disabled={deshabilitado}
          placeholder={placeholder}
          onChange={(e) => onCambio(e.target.value)}
          aria-invalid={!!error}
          className={INPUT}
        />
        <span className="text-[11.5px] text-[var(--ls-t4)]">{unidad}</span>
      </div>
      {error && <p className="mt-1 text-[11px] text-[var(--ls-e-rojo)]">{error}</p>}
    </div>
  )
}

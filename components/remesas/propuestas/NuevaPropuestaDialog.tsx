'use client'

import { useMemo, useState } from 'react'
import { ClipboardPaste, ListChecks, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { interpretar, type LineaPegada } from '@/lib/fba/pegado'
import { cx, Segmentado } from '../comun/ui'
import { SelectorProductos, type Elegido } from '../SelectorProductos'

/**
 * NUEVA PROPUESTA: QUÉ SE VA A MANDAR.
 *
 * Una propuesta nace en borrador, sin número de envío: ese número solo existe
 * cuando se crea el envío en Seller Central, y se pide al final, al marcarla como
 * enviada. Aquí solo se dice cómo se llama, para cuándo es y qué lleva.
 *
 * Dos formas de montar la lista y las dos hacen falta: elegir del catálogo es lo
 * del día a día; pegar una tabla sirve para traerse de golpe una hoja de cálculo
 * entera —una remesa de ShoesF trae 83 líneas, y teclearlas es justo lo que hizo
 * que el Excel dejara de actualizarse—.
 */

export function NuevaPropuestaDialog({
  clienteId,
  clienteNombre,
  marketplaceId = 'A1RKKUPIHCS9HS',
  esAdmin,
  onCerrar,
  onCreada,
}: {
  clienteId: string
  clienteNombre: string
  marketplaceId?: string
  esAdmin: boolean
  onCerrar: () => void
  onCreada: (id: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [modo, setModo] = useState<'elegir' | 'pegar'>('elegir')
  const [pegado, setPegado] = useState('')
  const [elegidos, setElegidos] = useState<Elegido[]>([])
  const [guardando, setGuardando] = useState(false)

  const { lineas: pegadas, avisos } = useMemo(() => interpretar(pegado), [pegado])
  const lineas: LineaPegada[] = useMemo(
    () =>
      modo === 'elegir'
        ? elegidos.map((e) => ({ sku: e.sku, unidades: e.unidades, referencia: null, nombre: e.titulo, variante: null, ean: null, fnsku: e.fnsku, asin: e.asin }))
        : pegadas,
    [modo, elegidos, pegadas]
  )
  const unidades = lineas.reduce((s, l) => s + l.unidades, 0)

  async function crear() {
    if (lineas.length === 0) return
    setGuardando(true)
    try {
      const res = await fetch('/api/fba/remesas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clienteId, marketplaceId, nombre: nombre.trim() || null, fechaEnvio: fecha, referenciaEnvio: null, lineas }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; id?: string } | null
      if (!res.ok || !p?.id) {
        toast.error(p?.error ?? 'No se ha podido crear la propuesta')
        return
      }
      toast.success(`Propuesta creada: ${lineas.length} referencias, ${unidades.toLocaleString('es-ES')} unidades`)
      onCerrar()
      onCreada(p.id)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialogo
      titulo="Nueva propuesta"
      entradilla={`Lo que se va a mandar a Amazon para ${clienteNombre}. Se prepara aquí con el cliente y, cuando está enviada, pasa a Envíos.`}
      onCerrar={onCerrar}
      ancho="max-w-[880px]"
      pie={
        <>
          <span className="mr-auto text-[11.5px] text-[var(--ls-t3)]">
            {lineas.length > 0 ? (
              <>
                <b className="font-semibold text-[var(--ls-t1)]">{lineas.length}</b> referencia{lineas.length === 1 ? '' : 's'} ·{' '}
                <b className="font-semibold text-[var(--ls-t1)]">{unidades.toLocaleString('es-ES')}</b> unidades
              </>
            ) : (
              'Añade al menos una referencia'
            )}
          </span>
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          <button type="button" onClick={crear} disabled={lineas.length === 0 || guardando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Crear propuesta
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={CAMPO.etiqueta} htmlFor="np-nombre">
            Nombre
          </label>
          <input id="np-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Reposición de octubre" className={CAMPO.input} />
          <p className={CAMPO.nota}>Como lo llames tú. Opcional.</p>
        </div>
        <div>
          <label className={CAMPO.etiqueta} htmlFor="np-fecha">
            Fecha prevista de envío
          </label>
          <input id="np-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={CAMPO.input} />
          <p className={CAMPO.nota}>Para cuándo se quiere mandar. Se puede corregir después.</p>
        </div>
      </div>

      <Segmentado
        valor={modo}
        onCambio={setModo}
        etiqueta="Cómo montar la lista"
        opciones={[
          { id: 'elegir', texto: (<><ListChecks className="h-3 w-3" />Elegir del catálogo</>) },
          { id: 'pegar', texto: (<><ClipboardPaste className="h-3 w-3" />Pegar una tabla</>) },
        ]}
      />

      {modo === 'elegir' && <SelectorProductos clienteId={clienteId} esAdmin={esAdmin} elegidos={elegidos} onCambio={setElegidos} />}

      {modo === 'pegar' && (
        <div className="space-y-2">
          <div>
            <label className={CAMPO.etiqueta} htmlFor="np-pegado">
              Pega aquí las referencias
            </label>
            <textarea
              id="np-pegado"
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              rows={7}
              spellCheck={false}
              placeholder={'FBASKU\tUnidades a enviar\tTalla\nFBA047768-40\t2\t40'}
              className={cx(CAMPO.input, 'h-auto py-2 font-mono text-[11.5px]')}
            />
            <p className={CAMPO.nota}>
              Copia las celdas de tu hoja de cálculo con la fila de títulos. Reconoce los nombres de siempre: FBASKU, Unidades a enviar, Talla, REF, Nombre y color, EAN, FNSKU y ASIN.
            </p>
          </div>
          {avisos.length > 0 && (
            <ul className="space-y-[2px] rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[7px] text-[11.5px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
              {avisos.slice(0, 6).map((a) => (
                <li key={a}>{a}</li>
              ))}
              {avisos.length > 6 && <li className="text-[var(--ls-t4)]">y {avisos.length - 6} más</li>}
            </ul>
          )}
          {lineas.length > 0 && (
            <div className="max-h-[220px] overflow-auto rounded-[6px] border border-[var(--ls-linea)]">
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={TABLA.cabecera}>SKU</th>
                    <th className={TABLA.cabecera}>Producto</th>
                    <th className={TABLA.cabecera}>Variante</th>
                    <th className={cx(TABLA.cabecera, TABLA.derecha)}>Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.sku} className={TABLA.fila}>
                      <td className={cx(TABLA.celda, 'font-mono text-[11.5px] text-[var(--ls-t3)]')}>{l.sku}</td>
                      <td className={cx(TABLA.celda, 'max-w-[320px] truncate text-[var(--ls-t1)]')}>{l.nombre ?? '—'}</td>
                      <td className={cx(TABLA.celda, 'text-[var(--ls-t3)]')}>{l.variante ?? '—'}</td>
                      <td className={cx(TABLA.celda, TABLA.numero, 'font-semibold text-[var(--ls-t1)]')}>{l.unidades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialogo>
  )
}

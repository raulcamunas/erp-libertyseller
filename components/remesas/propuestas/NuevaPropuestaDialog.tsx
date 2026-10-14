'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ClipboardPaste, Database, ListChecks, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import type { LineaElegida } from '@/lib/fba/catalogo/indice'
import { interpretar, type LineaPegada } from '@/lib/fba/pegado'
import { cx, Segmentado } from '../comun/ui'
import { EditorDesplegables, type EstadoEditor } from '../catalogo/EditorDesplegables'
import { SelectorProductos, type Elegido } from '../SelectorProductos'

/**
 * NUEVA PROPUESTA: QUÉ SE VA A MANDAR.
 *
 * Una propuesta nace en borrador, sin número de envío: ese número solo existe
 * cuando se crea el envío en Seller Central, y se pide al final, al marcarla como
 * enviada. Aquí solo se dice cómo se llama, para cuándo es y qué lleva.
 *
 * Tres formas de montar la lista y las tres hacen falta:
 *
 *   DESPLEGABLES   (clientes con base de datos de referencias: ShoesF) REF, color y
 *                  talla, con los códigos rellenándose solos. Es lo del día a día.
 *   CATÁLOGO       elegir de los productos de FBA que Amazon tiene del cliente.
 *   PEGAR          traerse de golpe una hoja de cálculo entera —una remesa de ShoesF
 *                  trae 83 líneas, y teclearlas es justo lo que hizo que el Excel
 *                  dejara de actualizarse—.
 *
 * Cada una guarda su propia lista y cambiar de pestaña no la pierde. La que se crea
 * es la de la pestaña que está abierta al pulsar «Crear propuesta».
 */

type Modo = 'desplegables' | 'elegir' | 'pegar'

/** De cualquier forma de elegir a la línea que entiende la ruta de alta */
function aLineaPegada(e: Elegido | LineaElegida): LineaPegada {
  return {
    sku: e.sku,
    unidades: e.unidades,
    referencia: e.referencia ?? null,
    nombre: e.titulo,
    variante: e.variante ?? null,
    ean: e.ean ?? null,
    fnsku: e.fnsku,
    asin: e.asin,
  }
}

export function NuevaPropuestaDialog({
  clienteId,
  clienteNombre,
  marketplaceId = 'A1RKKUPIHCS9HS',
  esAdmin,
  conCatalogo = false,
  onCerrar,
  onCreada,
}: {
  clienteId: string
  clienteNombre: string
  marketplaceId?: string
  esAdmin: boolean
  /** El cliente trabaja con base de datos de referencias: se monta con desplegables */
  conCatalogo?: boolean
  onCerrar: () => void
  onCreada: (id: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [modo, setModo] = useState<Modo>(conCatalogo ? 'desplegables' : 'elegir')
  const [pegado, setPegado] = useState('')
  const [elegidos, setElegidos] = useState<Elegido[]>([])
  const [desplegables, setDesplegables] = useState<LineaElegida[]>([])
  const [estado, setEstado] = useState<EstadoEditor>({ sinTerminar: 0, fueraDeLaBase: 0 })
  const [guardando, setGuardando] = useState(false)

  const { lineas: pegadas, avisos } = useMemo(() => interpretar(pegado), [pegado])
  const lineas: LineaPegada[] = useMemo(
    () => (modo === 'pegar' ? pegadas : (modo === 'desplegables' ? desplegables : elegidos).map(aLineaPegada)),
    [modo, elegidos, desplegables, pegadas]
  )
  const unidades = lineas.reduce((s, l) => s + l.unidades, 0)
  const aMedias = modo === 'desplegables' ? estado.sinTerminar : 0

  async function crear() {
    if (lineas.length === 0) return
    if (aMedias > 0) {
      toast.error(`Hay ${aMedias} línea${aMedias === 1 ? '' : 's'} sin terminar (falta la talla o las unidades). Termínalas o quítalas: si no, se quedarían fuera.`)
      return
    }
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

  const ancho = modo === 'desplegables' ? 'max-w-[1060px]' : 'max-w-[880px]'

  return (
    <Dialogo
      titulo="Nueva propuesta"
      entradilla={`Lo que se va a mandar a Amazon para ${clienteNombre}. Se prepara aquí con el cliente y, cuando está enviada, pasa a Envíos.`}
      onCerrar={onCerrar}
      ancho={ancho}
      pie={
        <>
          <span className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--ls-t3)]">
            {lineas.length > 0 ? (
              <span>
                <b className="font-semibold text-[var(--ls-t1)]">{lineas.length}</b> referencia{lineas.length === 1 ? '' : 's'} ·{' '}
                <b className="font-semibold text-[var(--ls-t1)]">{unidades.toLocaleString('es-ES')}</b> unidades
              </span>
            ) : (
              <span>Añade al menos una referencia</span>
            )}
            {aMedias > 0 && (
              <span className="flex items-center gap-1" style={{ color: COLOR_ESTADO.ambar }}>
                <AlertTriangle className="h-3 w-3" />
                {aMedias} línea{aMedias === 1 ? '' : 's'} sin terminar
              </span>
            )}
          </span>
          <button type="button" onClick={onCerrar} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
            Cancelar
          </button>
          <button type="button" onClick={crear} disabled={lineas.length === 0 || guardando || aMedias > 0} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
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
          ...(conCatalogo
            ? [
                {
                  id: 'desplegables' as const,
                  texto: (
                    <>
                      <Database className="h-3 w-3" />
                      Desplegables
                    </>
                  ),
                  titulo: 'REF, color y talla de la base de datos de referencias',
                },
              ]
            : []),
          {
            id: 'elegir' as const,
            texto: (
              <>
                <ListChecks className="h-3 w-3" />
                {conCatalogo ? 'Catálogo de Amazon' : 'Elegir del catálogo'}
              </>
            ),
          },
          {
            id: 'pegar' as const,
            texto: (
              <>
                <ClipboardPaste className="h-3 w-3" />
                Pegar una tabla
              </>
            ),
          },
        ]}
      />

      {/* El editor de desplegables se queda montado al cambiar de pestaña: lo elegido no se pierde */}
      {conCatalogo && (
        <div className={modo === 'desplegables' ? undefined : 'hidden'}>
          <EditorDesplegables
            clienteId={clienteId}
            clienteNombre={clienteNombre}
            puedeAnadir
            inicial={[]}
            onCambio={(l, e) => {
              setDesplegables(l)
              setEstado(e)
            }}
            variante="dialogo"
            alturaMaxima="min(50vh, 440px)"
            onUsarOtroModo={() => setModo('elegir')}
          />
        </div>
      )}

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

'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ClipboardPaste, Database, ListChecks, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialogo } from '@/components/plataforma/comun'
import { Boton } from '@/components/ui-ls'
import { CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { LineaElegida } from '@/lib/fba/catalogo/indice'
import { interpretar, type LineaPegada } from '@/lib/fba/pegado'
import { marketplaceById } from '@/lib/types/amazon'
import type { ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { invalidarRemesas } from '../comun/useAgencia'
import { cx, Segmentado } from '../comun/ui'
import { EditorDesplegables, type EstadoEditor } from '../catalogo/EditorDesplegables'
import { SelectorProductos, type Elegido } from '../SelectorProductos'

/**
 * NUEVA PROPUESTA: QUÉ SE VA A MANDAR.
 *
 * Una propuesta nace en borrador, sin número de envío: ese número solo existe cuando se crea el envío en Seller
 * Central, y se pide al final, al marcarla como enviada. Aquí solo se dice cómo se llama, para cuándo es y qué lleva.
 *
 * Tres formas de montar la lista y las tres hacen falta:
 *
 *   DESPLEGABLES   (clientes con base de datos de referencias: ShoesF) REF, color y talla, con los códigos
 *                  rellenándose solos. Es lo del día a día.
 *   CATÁLOGO       elegir de los productos de FBA que Amazon tiene del cliente.
 *   PEGAR          traerse de golpe una hoja de cálculo entera —una remesa de ShoesF trae 83 líneas, y
 *                  teclearlas es justo lo que hizo que el Excel dejara de actualizarse—.
 *
 * Cada una guarda su propia lista y cambiar de pestaña no la pierde. La que se crea es la de la pestaña que está
 * abierta al pulsar «Crear propuesta».
 *
 * EL MERCADO (D20): por defecto el de `cliente.mercadoRemesa` (el de su última remesa enviada o el de la región de
 * su conexión), no España fijo: Portico manda a EE. UU. Y los desplegables salen si el cliente TIENE base de datos
 * (`cliente.tieneCatalogo`, D40), no por el nombre. Lo puede usar el cliente de fuera con `puede_editar` (D39).
 *
 * El diálogo va en un PORTAL: `.pagina-de-ruta` deja un `transform` y un `fixed` dentro se colocaría respecto a ella.
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

/** Monta en document.body (y nada en el servidor) */
export function EnPortal({ children }: { children: ReactNode }) {
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])
  return montado ? createPortal(children, document.body) : null
}

export function NuevaPropuestaDialog({
  sesion,
  cliente,
  marketplaceId,
  onCerrar,
  onCreada,
}: {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  /** Solo para forzar otro mercado; por defecto el de la remesa del cliente (D20) */
  marketplaceId?: string
  onCerrar: () => void
  onCreada: (id: string) => void
}) {
  const conCatalogo = cliente.tieneCatalogo
  const mercado = marketplaceId ?? cliente.mercadoRemesa
  const infoMercado = marketplaceById(mercado)
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
        body: JSON.stringify({ clienteId: cliente.id, marketplaceId: mercado, nombre: nombre.trim() || null, fechaEnvio: fecha, referenciaEnvio: null, lineas }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; id?: string } | null
      if (!res.ok || !p?.id) {
        toast.error(p?.error ?? 'No se ha podido crear la propuesta')
        return
      }
      toast.success(`Propuesta creada: ${lineas.length} referencias, ${unidades.toLocaleString('es-ES')} unidades`)
      invalidarRemesas(cliente.id)
      onCerrar()
      onCreada(p.id)
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Revisa la red y vuelve a probar: no se ha creado nada.')
    } finally {
      setGuardando(false)
    }
  }

  const ancho = modo === 'desplegables' ? 'max-w-[1060px]' : 'max-w-[880px]'

  return (
    <EnPortal>
      <Dialogo
        titulo="Nueva propuesta"
        entradilla={`Lo que se va a mandar a Amazon para ${cliente.nombre}. Se prepara aquí con el cliente y, cuando está enviada, pasa a Envíos.`}
        onCerrar={onCerrar}
        ancho={ancho}
        pie={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <span className="mr-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--ls-t3)]">
              {lineas.length > 0 ? (
                <span>
                  <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{lineas.length}</b> referencia{lineas.length === 1 ? '' : 's'} ·{' '}
                  <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{unidades.toLocaleString('es-ES')}</b> unidades
                </span>
              ) : (
                <span>Añade al menos una referencia</span>
              )}
              {aMedias > 0 && (
                <span className="flex items-center gap-1" style={{ color: COLOR_ESTADO.ambar }}>
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  {aMedias} línea{aMedias === 1 ? '' : 's'} sin terminar
                </span>
              )}
            </span>
            <Boton variante="secundario" tamano="sm" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton variante="primario" tamano="sm" icono={Plus} cargando={guardando} disabled={lineas.length === 0 || aMedias > 0} onClick={() => void crear()}>
              Crear propuesta
            </Boton>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={CAMPO.etiqueta} htmlFor="np-nombre">
              Nombre
            </label>
            <input id="np-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Reposición de octubre" className={cx(CAMPO.input, '[@media(pointer:coarse)]:h-11')} />
            <p className={CAMPO.nota}>Como lo llames tú. Opcional.</p>
          </div>
          <div>
            <label className={CAMPO.etiqueta} htmlFor="np-fecha">
              Fecha prevista de envío
            </label>
            <input id="np-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={cx(CAMPO.input, '[@media(pointer:coarse)]:h-11')} />
            <p className={CAMPO.nota}>
              Para cuándo se quiere mandar. Se puede corregir después.
              {infoMercado && sesion.esAgencia && <> Va a {infoMercado.label}.</>}
            </p>
          </div>
        </div>

        <div className="-mx-[2px] overflow-x-auto [contain:inline-size] px-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                          <Database className="h-3 w-3" aria-hidden />
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
                    <ListChecks className="h-3 w-3" aria-hidden />
                    {conCatalogo ? 'Catálogo de Amazon' : 'Elegir del catálogo'}
                  </>
                ),
              },
              {
                id: 'pegar' as const,
                texto: (
                  <>
                    <ClipboardPaste className="h-3 w-3" aria-hidden />
                    Pegar una tabla
                  </>
                ),
              },
            ]}
          />
        </div>

        {/* El editor de desplegables se queda montado al cambiar de pestaña: lo elegido no se pierde */}
        {conCatalogo && (
          <div className={modo === 'desplegables' ? undefined : 'hidden'}>
            <EditorDesplegables
              clienteId={cliente.id}
              clienteNombre={cliente.nombre}
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

        {modo === 'elegir' && <SelectorProductos clienteId={cliente.id} esAdmin={sesion.esAdmin} elegidos={elegidos} onCambio={setElegidos} />}

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
                className={cx(CAMPO.input, 'h-auto py-2 font-mono text-[12px]')}
              />
              <p className={CAMPO.nota}>
                Copia las celdas de tu hoja de cálculo con la fila de títulos. Reconoce los nombres de siempre: FBASKU, Unidades a enviar, Talla, REF, Nombre y color, EAN, FNSKU y ASIN.
              </p>
            </div>
            {avisos.length > 0 && (
              <ul className="space-y-[2px] rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
                {avisos.slice(0, 6).map((a) => (
                  <li key={a}>{a}</li>
                ))}
                {avisos.length > 6 && <li className="text-[var(--ls-t4)]">y {avisos.length - 6} más</li>}
              </ul>
            )}
            {lineas.length > 0 && (
              <ul className="max-h-[240px] divide-y divide-[var(--ls-linea)] overflow-auto rounded-[10px] border border-[var(--ls-linea)]">
                {lineas.map((l) => (
                  <li key={l.sku} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-[7px]">
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12px] text-[var(--ls-t2)]">{l.sku}</span>
                      <span className="block truncate text-[12px] text-[var(--ls-t3)]">
                        {[l.referencia, l.nombre, l.variante].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">{l.unidades}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialogo>
    </EnPortal>
  )
}

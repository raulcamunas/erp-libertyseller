'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Database, Save, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { LineaDePanel } from '@/lib/fba/datos'
import { Segmentado } from './comun/ui'
import { EditorDesplegables, type EstadoEditor } from './catalogo/EditorDesplegables'
import { SelectorProductos, type Elegido } from './SelectorProductos'

/**
 * DIBUJAR EL BOCETO: sumar referencias, cambiar cantidades y quitar.
 *
 * Es lo que convierte una remesa en borrador en un boceto de verdad. Hasta ahora
 * las líneas solo se escribían al crear la remesa y después no se podían tocar:
 * para cambiar una cantidad había que borrar el envío entero y volver a montarlo.
 *
 *
 * ============ DOS FORMAS DE ELEGIR ============
 *
 * Un cliente con base de datos de referencias (ShoesF) monta el envío con
 * DESPLEGABLES —REF, color, talla—, que es como lo hacía en su hoja de cálculo. Sigue
 * disponible el catálogo de Amazon, por si hay que mandar algo que no está en la base
 * de datos. Cambiar de una a otra no pierde lo elegido: la lista pasa de una a otra.
 *
 *
 * ============ EL CLIENTE TAMBIÉN, Y ES EL PUNTO ============
 *
 * Quien sabe qué hay en el almacén es él. La agencia propone, él corrige, y
 * cuando los dos están de acuerdo se aprueba. El permiso lo decide el servidor
 * —fba_accesos.puede_editar— y aquí solo llega dicho en `puedeEditar`.
 *
 *
 * ============ SE GUARDA ENTERO, NO LÍNEA A LÍNEA ============
 *
 * No hay autoguardado. Se toca lo que haga falta y se pulsa Guardar.
 *
 * Con guardado por línea, dos personas editando el mismo boceto a la vez se
 * pisan sin enterarse: cada una manda su cambio, los dos se aplican, y el
 * resultado no es lo que vio ninguna de las dos. Mandando la lista entera, el
 * último que guarda está viendo lo que guarda — y el servidor, además, bloquea
 * la remesa mientras escribe.
 *
 * El botón solo se enciende cuando hay algo distinto que guardar: así «Guardar»
 * no es un gesto que se repite por costumbre sin saber si cambió algo. Y no se
 * enciende con líneas a medias: guardar sin ellas las perdería en silencio.
 */
export function EditorBoceto({
  clienteId,
  clienteNombre,
  esAdmin,
  puedeEditar,
  conCatalogo = false,
  remesaId,
  lineas,
  version = null,
  onGuardado,
}: {
  clienteId: string
  clienteNombre: string
  esAdmin: boolean
  puedeEditar: boolean
  /** El cliente trabaja con base de datos de referencias: se eligen con desplegables */
  conCatalogo?: boolean
  remesaId: string
  lineas: LineaDePanel[]
  /** La versión de las líneas cargada (bloqueo optimista, migración 309). null = sin comprobar */
  version?: number | null
  onGuardado: () => void
}) {
  const inicial = useMemo<Elegido[]>(
    () =>
      lineas.map((l) => ({
        sku: l.sku,
        titulo: l.nombre,
        // El FNSKU de verdad, no null: si no, toda referencia ya guardada salía
        // marcada como «sin FNSKU» aunque lo tuviera, y ese aviso es el que dice
        // de cuáles no van a salir etiquetas.
        asin: l.asin,
        fnsku: l.fnsku,
        stock: null,
        vendible: null,
        unidades: l.enviadas,
        /**
         * LO QUE EL CATÁLOGO DE AMAZON NO ENSEÑA PERO TAMPOCO PUEDE BORRAR.
         *
         * `variante`, `referencia` y `ean` los rellena el alta por «Pegar una
         * tabla» o la base de datos de referencias. El selector de Amazon no los
         * edita — y al guardar se mandaba la línea sin ellos, así que la ruta
         * los escribía a null y se perdían al primer cambio de cantidad.
         *
         * Viajan de vuelta tal cual: este editor cambia QUÉ y CUÁNTO, no la
         * ficha de la referencia.
         */
        variante: l.variante,
        referencia: l.referencia,
        ean: l.ean,
      })),
    [lineas]
  )

  const [elegidos, setElegidos] = useState<Elegido[]>(inicial)
  const [guardando, setGuardando] = useState(false)
  const [modo, setModo] = useState<'desplegables' | 'amazon'>(conCatalogo ? 'desplegables' : 'amazon')
  /** Se sube para que el editor de desplegables vuelva a montarse con lo que toque */
  const [reinicio, setReinicio] = useState(0)
  const [estado, setEstado] = useState<EstadoEditor>({ sinTerminar: 0, fueraDeLaBase: 0 })

  /**
   * «RECARGAR» TRAS UN 409 TRAE LO DE LA BASE AL EDITOR.
   *
   * `elegidos` se inicia una vez: sin esto, recargar dejaba en pantalla la lista vieja con la versión nueva
   * y el siguiente «Guardar» pisaba sin aviso lo que el cliente había cambiado desde su enlace.
   */
  const recargando = useRef(false)
  useEffect(() => {
    if (!recargando.current) return
    recargando.current = false
    setElegidos(inicial)
    setReinicio((n) => n + 1)
  }, [inicial])

  /**
   * ¿Hay algo distinto? Se compara SKU y unidades, que es lo único que se manda.
   *
   * Por contenido y no por un «se ha tocado»: quien sube una cantidad y la vuelve
   * a bajar no ha cambiado nada, y encender el botón ahí invita a guardar por si
   * acaso. Ordenado por SKU para que mover una fila de sitio no cuente.
   */
  const hayCambios = useMemo(() => {
    const huella = (xs: Elegido[]) =>
      xs
        .map((x) => `${x.sku}\u0000${x.unidades}`)
        .sort()
        .join('\u0001')
    return huella(elegidos) !== huella(inicial)
  }, [elegidos, inicial])

  const totalUnidades = elegidos.reduce((s, e) => s + (e.unidades || 0), 0)
  const sinUnidades = elegidos.filter((e) => !Number.isInteger(e.unidades) || e.unidades < 1)
  const aMedias = modo === 'desplegables' ? estado.sinTerminar : 0

  async function guardar() {
    if (aMedias > 0) {
      toast.error(`Hay ${aMedias} línea${aMedias === 1 ? '' : 's'} sin terminar (falta la talla o las unidades). Termínalas o quítalas: si no, no se guardarían.`)
      return
    }
    if (elegidos.length === 0) {
      toast.error('Un envío sin ninguna referencia no se puede guardar. Si quieres descartarlo, bórralo entero.')
      return
    }
    if (sinUnidades.length > 0) {
      toast.error(`«${sinUnidades[0].sku}» no lleva unidades. Para no mandar una referencia, quítala de la lista.`)
      return
    }

    setGuardando(true)
    let res: Response
    try {
      res = await fetch(`/api/fba/remesas/${remesaId}/lineas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        lineas: elegidos.map((e) => ({
          sku: e.sku,
          unidades: e.unidades,
          nombre: e.titulo,
          asin: e.asin,
          fnsku: e.fnsku,
          // Se devuelven aunque no se editen: la ruta reescribe la línea entera,
          // así que lo que no viaje se guarda como null.
          variante: e.variante ?? null,
          referencia: e.referencia ?? null,
          ean: e.ean ?? null,
        })),
      }),
      })
    } catch {
      setGuardando(false)
      toast.error('Se ha cortado la conexión con el servidor. Lo que has cambiado sigue aquí: vuelve a guardar.')
      return
    }
    setGuardando(false)

    if (!res.ok) {
      // El servidor manda frases que se pueden enseñar tal cual: que el envío ha
      // dejado de estar en borrador mientras se editaba, que falta la migración…
      const cuerpo = (await res.json().catch(() => null)) as { error?: string; conflicto?: boolean } | null
      // Alguien (el cliente desde su enlace, u otra persona de la agencia) guardó entre medias: no se pisa
      if (res.status === 409 && cuerpo?.conflicto) {
        toast.error(cuerpo.error ?? 'Alguien ha cambiado esto. Recarga.', {
          action: {
            label: 'Recargar',
            onClick: () => {
              recargando.current = true
              onGuardado()
            },
          },
          duration: 10000,
        })
        return
      }
      toast.error(cuerpo?.error ?? 'No se han podido guardar las referencias')
      return
    }

    toast.success(`Boceto guardado: ${elegidos.length} referencia${elegidos.length === 1 ? '' : 's'}, ${totalUnidades} unidades.`)
    onGuardado()
  }

  function deshacer() {
    setElegidos(inicial)
    setReinicio((n) => n + 1)
  }

  function cambiarModo(nuevo: 'desplegables' | 'amazon') {
    if (nuevo === modo) return
    // Lo elegido pasa de un modo al otro: el editor de desplegables se monta con ello
    setReinicio((n) => n + 1)
    setModo(nuevo)
  }

  if (!puedeEditar) {
    return (
      <div className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4 py-3">
        <p className="text-[13px] leading-[1.55] text-[var(--ls-t3)]">Este envío todavía es un boceto: la agencia lo está montando. Cuando esté, te llegará para aprobarlo.</p>
      </div>
    )
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]">
      <header className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--ls-linea)] px-4 py-[10px]">
        <div className="min-w-0 flex-1 basis-[220px]">
          <h3 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Qué se manda</h3>
          <p className="text-[12px] leading-[1.45] text-[var(--ls-t3)]">
            {modo === 'desplegables' ? 'Elige REF, color y talla, y pon las unidades. Los códigos se rellenan solos.' : 'Busca referencias, pon cuántas van de cada una y quita las que no.'}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {conCatalogo && (
            <Segmentado
              valor={modo}
              onCambio={cambiarModo}
              etiqueta="Cómo elegir las referencias"
              opciones={[
                { id: 'desplegables', texto: <>Desplegables</>, titulo: 'REF, color y talla de la base de datos' },
                { id: 'amazon', texto: <>Catálogo de Amazon</>, titulo: 'Los productos de FBA que Amazon tiene de este cliente' },
              ]}
            />
          )}
          {hayCambios && (
            <Boton variante="secundario" tamano="sm" icono={Undo2} disabled={guardando} onClick={deshacer}>
              Deshacer
            </Boton>
          )}
          <Boton variante="primario" tamano="sm" icono={Save} cargando={guardando} disabled={!hayCambios || aMedias > 0} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Guardar el boceto'}
          </Boton>
        </div>
      </header>

      <div className="min-w-0 p-3 sm:p-4">
        {modo === 'desplegables' ? (
          <EditorDesplegables
            key={`d${reinicio}`}
            clienteId={clienteId}
            clienteNombre={clienteNombre}
            puedeAnadir={puedeEditar}
            inicial={elegidos.map((e) => ({ ...e, variante: e.variante ?? null, referencia: e.referencia ?? null, ean: e.ean ?? null }))}
            onCambio={(lineasNuevas, est) => {
              setElegidos(lineasNuevas)
              setEstado(est)
            }}
            variante="panel"
            alturaMaxima="min(58vh, 560px)"
            onUsarOtroModo={() => cambiarModo('amazon')}
          />
        ) : (
          <SelectorProductos clienteId={clienteId} esAdmin={esAdmin} elegidos={elegidos} onCambio={setElegidos} />
        )}
      </div>

      {/* Lo que se va a guardar, dicho antes de pulsar y no después */}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--ls-linea)] px-4 py-[9px] text-[12px]">
        <span className="text-[var(--ls-t3)]">
          <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{elegidos.length}</b> referencia{elegidos.length === 1 ? '' : 's'} ·{' '}
          <b className="font-semibold tabular-nums text-[var(--ls-t1)]">{totalUnidades.toLocaleString('es-ES')}</b> unidades
        </span>
        {hayCambios && <span className="text-[var(--ls-acc)]">sin guardar</span>}
        {aMedias > 0 && (
          <span className="flex items-center gap-1" style={{ color: COLOR_ESTADO.ambar }}>
            <AlertTriangle className="h-3 w-3" />
            {aMedias} línea{aMedias === 1 ? '' : 's'} sin terminar
          </span>
        )}
        {modo === 'desplegables' && estado.fueraDeLaBase > 0 && (
          <span className="flex items-center gap-1 text-[var(--ls-t3)]" title="Líneas guardadas cuyo SKU no está en la base de datos. Se mandan igual">
            <Database className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
            {estado.fueraDeLaBase} fuera de la base de datos
          </span>
        )}
        {modo === 'amazon' && sinUnidades.length > 0 && (
          <span className="flex items-center gap-1" style={{ color: COLOR_ESTADO.ambar }}>
            <AlertTriangle className="h-3 w-3" />
            {sinUnidades.length} sin unidades
          </span>
        )}
      </footer>
    </section>
  )
}

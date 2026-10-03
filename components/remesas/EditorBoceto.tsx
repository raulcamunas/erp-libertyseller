'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Save, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { SelectorProductos, type Elegido } from './SelectorProductos'
import type { LineaDePanel } from '@/lib/fba/datos'

/**
 * DIBUJAR EL BOCETO: sumar referencias, cambiar cantidades y quitar.
 *
 * Es lo que convierte una remesa en borrador en un boceto de verdad. Hasta ahora
 * las líneas solo se escribían al crear la remesa y después no se podían tocar:
 * para cambiar una cantidad había que borrar el envío entero y volver a montarlo.
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
 * no es un gesto que se repite por costumbre sin saber si cambió algo.
 */
export function EditorBoceto({
  clienteId,
  esAdmin,
  puedeEditar,
  remesaId,
  lineas,
  onGuardado,
}: {
  clienteId: string
  esAdmin: boolean
  puedeEditar: boolean
  remesaId: string
  lineas: LineaDePanel[]
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
      })),
    [lineas]
  )

  const [elegidos, setElegidos] = useState<Elegido[]>(inicial)
  const [guardando, setGuardando] = useState(false)

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

  async function guardar() {
    if (elegidos.length === 0) {
      toast.error('Un envío sin ninguna referencia no se puede guardar. Si quieres descartarlo, bórralo entero.')
      return
    }
    if (sinUnidades.length > 0) {
      toast.error(
        `«${sinUnidades[0].sku}» no lleva unidades. Para no mandar una referencia, quítala de la lista.`
      )
      return
    }

    setGuardando(true)
    const res = await fetch(`/api/fba/remesas/${remesaId}/lineas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineas: elegidos.map((e) => ({
          sku: e.sku,
          unidades: e.unidades,
          nombre: e.titulo,
          asin: e.asin,
          fnsku: e.fnsku,
        })),
      }),
    })
    setGuardando(false)

    if (!res.ok) {
      // El servidor manda frases que se pueden enseñar tal cual: que el envío ha
      // dejado de estar en borrador mientras se editaba, que falta la migración…
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null
      toast.error(cuerpo?.error ?? 'No se han podido guardar las referencias')
      return
    }

    toast.success(
      `Boceto guardado: ${elegidos.length} referencia${elegidos.length === 1 ? '' : 's'}, ${totalUnidades} unidades.`
    )
    onGuardado()
  }

  if (!puedeEditar) {
    return (
      <div className="glass-card px-3 py-2.5">
        <p className="text-[11.5px] leading-relaxed text-white/45">
          Este envío todavía es un boceto: la agencia lo está montando. Cuando esté, te llegará para
          aprobarlo.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card flex flex-col gap-2.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-white/60">
          Monta el envío: busca referencias, pon cuántas van de cada una y quita las que no.
        </p>

        <div className="ml-auto flex items-center gap-2">
          {hayCambios && (
            <button
              type="button"
              onClick={() => setElegidos(inicial)}
              disabled={guardando}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[11px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80 disabled:opacity-40"
            >
              <Undo2 className="h-3 w-3" />
              Deshacer
            </button>
          )}
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={!hayCambios || guardando}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-[#FF6600]/50 bg-[#FF6600]/15 px-3 text-[11px] font-semibold text-[#FFA366] transition-colors hover:bg-[#FF6600]/25 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {guardando ? 'Guardando…' : 'Guardar el boceto'}
          </button>
        </div>
      </div>

      <SelectorProductos
        clienteId={clienteId}
        esAdmin={esAdmin}
        elegidos={elegidos}
        onCambio={setElegidos}
      />

      {/* Lo que se va a guardar, dicho antes de pulsar y no después */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-2 text-[11px]">
        <span className="text-white/50">
          {elegidos.length} referencia{elegidos.length === 1 ? '' : 's'} · {totalUnidades} unidades
        </span>
        {hayCambios && <span className="text-[#FFA366]">sin guardar</span>}
        {sinUnidades.length > 0 && (
          <span className="flex items-center gap-1 text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            {sinUnidades.length} sin unidades
          </span>
        )}
      </div>
    </div>
  )
}

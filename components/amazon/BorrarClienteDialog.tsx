'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AmazonClient } from '@/lib/types/amazon'
import { deleteAmazon, getAmazon, type AmazonMutation, type AmazonView } from '@/lib/amazon/client'
import { Dialogo } from './Dialogo'
import { dangerButton, errorBox, fieldInput, formatInt, ghostButton, warnBox } from './shared'

/**
 * BORRAR UN CLIENTE. NO SE PUEDE DESHACER Y NO HAY PAPELERA.
 *
 * Todo lo que cuelga de `amazon_clients` está en ON DELETE CASCADE, así que
 * borrar la fila del cliente se lleva su catálogo, sus trabajos, sus costes, su
 * configuración de Buy Box y SU HISTÓRICO DE BSR.
 *
 * Ese último es el único que importa de verdad, y por eso sale con su número:
 * los demás se vuelven a leer de Amazon en una noche. El BSR no. Es una serie
 * que se construye día a día y que Amazon no sirve hacia atrás — el día que se
 * borra, se acabó.
 *
 *
 * LOS DOS FRENOS, Y POR QUÉ SON DOS
 * ---------------------------------
 *   1. Si todavía tiene una cuenta de Amazon conectada, el servidor se niega.
 *      Esa fila guarda el refresh token del vendedor: borrar el cliente
 *      destruiría la llave de acceso a su tienda sin que nadie haya pulsado
 *      «Desconectar». Son dos actos distintos y mezclarlos hace que uno ocurra
 *      sin querer.
 *   2. Hay que escribir el nombre. Es lo que separa un borrado de un clic mal
 *      dado en una lista de dieciséis filas.
 *
 * Los dos están TAMBIÉN en el servidor (lib/amazon/data.ts). Aquí se repiten
 * para poder decirlo antes de que alguien lo intente, no como la comprobación
 * de verdad: un freno que solo vive en el navegador no es un freno.
 */

interface QueSePierde {
  conexiones: number
  referencias: number
  observacionesBsr: number
  trabajos: number
}

export function BorrarClienteDialog({
  cliente,
  conexiones,
  onDone,
  onClose,
}: {
  cliente: AmazonClient
  conexiones: number
  onDone: (view: AmazonView) => void
  onClose: () => void
}) {
  const [escrito, setEscrito] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [perdido, setPerdido] = useState<QueSePierde | null>(null)

  /**
   * Se piden los recuentos al abrir, no se calculan de lo que ya hay en
   * pantalla. La vista de Cuentas solo trae el catálogo por conexión: no sabe
   * cuántas observaciones de BSR hay, que es justo el número que decide si esto
   * se puede borrar tranquilo o no.
   */
  useEffect(() => {
    void (async () => {
      const res = await getAmazon<{ perdido: QueSePierde }>(`/api/amazon/clients/${cliente.id}`)
      if (res.ok) setPerdido(res.data.perdido)
    })()
  }, [cliente.id])

  const bloqueadoPorConexion = conexiones > 0
  const nombreOk = escrito.trim() === cliente.name.trim()

  async function borrar() {
    setBorrando(true)
    const res = await deleteAmazon<AmazonMutation>(`/api/amazon/clients/${cliente.id}`, {
      nombre: escrito,
    })
    setBorrando(false)

    if (!res.ok) {
      toast.error(res.error, { duration: 10_000 })
      return
    }
    toast.success(res.data.message ?? 'Cliente borrado')
    onDone(res.data)
    onClose()
  }

  return (
    <Dialogo title={`Borrar ${cliente.name}`} subtitle="No se puede deshacer" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3">
        {bloqueadoPorConexion ? (
          <div className={errorBox}>
            Este cliente todavía tiene {conexiones === 1 ? 'una cuenta' : `${conexiones} cuentas`} de
            Amazon conectada{conexiones === 1 ? '' : 's'}. Desconéctala primero: ahí es donde se
            destruye la llave de acceso a su tienda, y eso tiene que ser una decisión aparte.
          </div>
        ) : (
          <div className={warnBox}>
            Se borra el cliente y todo lo que cuelga de él. No hay papelera y no se puede deshacer
            desde aquí.
          </div>
        )}

        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/35 mb-1.5">Se borra</p>
          {perdido === null ? (
            <p className="text-[12px] text-white/40">Contando lo que hay…</p>
          ) : (
            <ul className="space-y-1 text-[12px] text-white/60">
              <li className="flex gap-2">
                <span className="text-white/25">·</span>
                <span>
                  <span className="text-white/80">{formatInt(perdido.referencias)}</span> referencias
                  del espejo del catálogo. Se vuelven a leer de Amazon si algún día se reconecta.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-white/25">·</span>
                <span>
                  <span className="text-white/80">{formatInt(perdido.trabajos)}</span> trabajos con
                  su historial de ejecuciones.
                </span>
              </li>
              {/* EL ÚNICO QUE NO SE PUEDE RECONSTRUIR, y por eso va aparte y en
                  rojo. Todo lo demás se vuelve a pedir; una serie de BSR no:
                  Amazon no la sirve hacia atrás. */}
              <li className="flex gap-2">
                <span className="text-white/25">·</span>
                <span>
                  <span className="text-red-300">
                    {formatInt(perdido.observacionesBsr)} observaciones de BSR
                  </span>
                  {perdido.observacionesBsr > 0 ? (
                    <>
                      {' '}
                      — esto <span className="text-white/80">no se puede recuperar</span>. Amazon no
                      sirve el ranking hacia atrás: la serie se construye día a día y se pierde
                      entera.
                    </>
                  ) : (
                    <> — todavía no hay ninguna, así que no se pierde historia.</>
                  )}
                </span>
              </li>
            </ul>
          )}
        </div>

        {!bloqueadoPorConexion && (
          <div>
            <label
              htmlFor="confirmar-nombre"
              className="block text-[11px] uppercase tracking-wider text-white/35 mb-1.5"
            >
              Escribe «{cliente.name}» para confirmar
            </label>
            <input
              id="confirmar-nombre"
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              placeholder={cliente.name}
              autoComplete="off"
              className={fieldInput}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={ghostButton}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={borrar}
            disabled={borrando || bloqueadoPorConexion || !nombreOk}
            className={dangerButton}
          >
            {borrando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Borrar para siempre
          </button>
        </div>
      </div>
    </Dialogo>
  )
}

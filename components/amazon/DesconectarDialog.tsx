'use client'

import { useState } from 'react'
import { Loader2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import type { AmazonConnection } from '@/lib/types/amazon'
import { postAmazon, type AmazonMutation, type AmazonView } from '@/lib/amazon/client'
import { Dialogo } from './Dialogo'
import { dangerButton, formatInt, ghostButton, infoBox, warnBox } from './shared'

/**
 * CONFIRMAR UNA DESCONEXIÓN.
 *
 * Existe este diálogo, y no un botón que hace la cosa directamente, porque
 * desconectar NO se puede deshacer desde aquí: se destruye la llave de acceso a
 * la tienda, y volver a tenerla exige que el CLIENTE vuelva a autorizar. Si eso
 * se hace por error un viernes por la tarde, el catálogo de ese cliente se
 * queda congelado hasta que alguien consiga hablar con él.
 *
 * Y por eso el diálogo dice las tres cosas con un número delante, en vez de
 * «¿seguro?»: qué se borra, qué NO se borra y qué hace falta para volver atrás.
 */
export function DesconectarDialog({
  connection,
  clientName,
  listings,
  submissions,
  onDone,
  onClose,
}: {
  connection: AmazonConnection
  clientName: string
  listings: number
  submissions: number
  onDone: (view: AmazonView) => void
  onClose: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function desconectar() {
    setSaving(true)
    const res = await postAmazon<AmazonMutation>(
      `/api/amazon/connections/${connection.id}/disconnect`
    )
    setSaving(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.message ?? 'Cuenta desconectada')
    onDone(res.data)
    onClose()
  }

  return (
    <Dialogo
      title={`Desconectar ${connection.name}`}
      subtitle={clientName}
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      <div className="space-y-3">
        <div className={warnBox}>
          Se borra la llave con la que entramos a su tienda. Para volver a tenerla, el cliente
          tiene que autorizar otra vez desde un enlace nuevo: no se puede deshacer desde aquí.
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/35 mb-1.5">Se borra</p>
          <ul className="space-y-1 text-[12px] text-white/60">
            <li className="flex gap-2">
              <span className="text-white/25">·</span>
              <span>El acceso a la tienda {connection.selling_partner_id}.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-white/25">·</span>
              <span>
                La copia que tenemos de su catálogo ({formatInt(listings)} referencias). Es un
                espejo de lo que hay en Amazon; si vuelve a conectarse se lee entera otra vez.
              </span>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wider text-white/35 mb-1.5">NO se borra</p>
          <div className={infoBox}>
            {submissions > 0 ? (
              <>
                Los <span className="text-white/80">{formatInt(submissions)}</span> cambios que le
                hemos enviado siguen guardados, con su valor anterior, el nuevo, quién lo mandó y
                qué contestó Amazon. Quedan asociados al identificador de su tienda, así que el día
                que pregunte por qué un producto salió a otro precio se puede contestar igual.
              </>
            ) : (
              <>
                Todavía no le hemos enviado ningún cambio, así que no hay historial que conservar.
                Si lo hubiera, se quedaría: el registro de lo que tocamos en la tienda de un
                cliente no se borra al desconectarlo.
              </>
            )}
          </div>
        </div>

        <p className="text-[11px] text-white/35 leading-relaxed">
          La ficha de {clientName} se queda en la pantalla, lista para volver a conectarse cuando
          haga falta.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={ghostButton}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={desconectar}
            disabled={saving}
            className={dangerButton}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Unplug className="h-3.5 w-3.5" />
            )}
            Desconectar
          </button>
        </div>
      </div>
    </Dialogo>
  )
}

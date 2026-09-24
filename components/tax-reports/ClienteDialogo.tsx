'use client'

import { useMemo, useState } from 'react'
import { CircleAlert, Info, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteAmazon, patchAmazon, postAmazon } from '@/lib/amazon/client'
import { AVISO, BOTON, CAMPO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { Aviso, Dialogo } from '@/components/plataforma/comun'
import {
  TIPOS_FICHERO_HABITUALES,
  TIPO_FICHERO_POR_DEFECTO,
} from '@/lib/tax-reports/tipos'
import type { ClienteTax, VistaTaxReports } from '@/lib/tax-reports/tipos'

/**
 * ALTA Y EDICIÓN DE UN CLIENTE DE TAX REPORTS.
 *
 * Un cliente de esta pantalla es SOLO un nombre y qué fichero se le manda. No
 * hereda de la lista de comisiones ni escribe en ella: la migración 200 siembra
 * esta tabla desde `public.clients` una vez, y a partir de ahí son dos listas
 * distintas a propósito.
 *
 * POR QUÉ SON DOS LISTAS. Porque aquí hace falta poder teclear un cliente que no
 * está en comisiones —a alguien a quien no le cobramos comisión también hay que
 * mandarle su informe— y porque `public.clients` exige un porcentaje de comisión
 * y alimenta facturación y tarifas: una fila inventada ahí aparece en tres
 * pantallas que no tienen nada que ver con esto.
 *
 *
 * ============ CÓMO SE LLAMA SU FICHERO ES TEXTO LIBRE, NO UNA ELECCIÓN ========
 *
 * Era un interruptor de dos posiciones —«Tax report» o «Sellerboard»— y ahora es
 * un campo de texto con sugerencias. El motivo es el de siempre en este ERP: una
 * lista cerrada en el código convierte «llamarle de otra manera a lo que le
 * mandamos a un cliente» en un despliegue. Con dos valores fijos, el primer
 * cliente al que haya que colgarle el informe de su proveedor —o el resumen de
 * un tercero que todavía no existe— entra en la lista con la etiqueta de otro, y
 * a partir de ahí la pantalla miente sobre lo que hay colgado.
 *
 * ES UN `datalist`, NO UN `select`. La diferencia es exactamente esa: el select
 * solo deja elegir de la lista y el input con datalist la ofrece pero admite
 * cualquier cosa. Las sugerencias salen de lo que YA se usa en los demás
 * clientes, no de una constante: así el segundo cliente con el mismo trato lo
 * encuentra escrito igual, que es lo que evita tener «Sellerboard» y
 * «sellerboard» como dos cosas distintas en la lista de la izquierda.
 *
 * NO SE DEDUCE DE COMISIONES, aunque se parezca. Allí van con Sellerboard DIRU,
 * SAUSI, Creative Toys y —por la lógica antigua— Lenobotics, pero esa es otra
 * pregunta: «con qué fichero calculamos lo que nos llevamos» no es «qué fichero
 * le mandamos al cliente». Se siembra lo que dijo Raúl y lo demás se pregunta.
 *
 *
 * ============ DAR DE BAJA NO ES BORRAR ============
 *
 * Un cliente que se va se desmarca de «sigue activo»: deja de contar en lo que
 * falta cada mes y sigue enseñando los meses que ya se le mandaron. Borrarlo se
 * puede, pero solo mientras no tenga ni un fichero colgado; si lo tiene, la ruta
 * contesta que no y hay que quitarlos uno a uno. Es deliberado: el historial de
 * lo que se le mandó a un cliente no se va por pulsar un botón.
 */

/**
 * Lo que se propone cuando no hay nada escrito en ningún cliente todavía.
 *
 * Son SUGERENCIAS y no valores: el campo admite cualquier texto. Están aquí por
 * lo que resuelven el primer día, cuando la lista de clientes está recién
 * sembrada y no hay de dónde copiar cómo se escribe cada uno.
 *
 * SE IMPORTAN Y NO SE ESCRIBEN AQUÍ. Estaban duplicadas, y el valor con el que
 * nace un cliente nuevo tiene que ser el mismo que el DEFAULT de la columna en
 * la migración 200: si se separan, los clientes dados de alta desde la pantalla
 * y los sembrados por el .sql se llaman distinto y la lista se ve desordenada
 * sin que nadie entienda por qué.
 */
const SUGERENCIAS_BASE: readonly string[] = TIPOS_FICHERO_HABITUALES

export function ClienteDialogo({
  cliente,
  anio,
  sugerencias = [],
  onCerrar,
  onGuardado,
}: {
  /** null = alta */
  cliente: ClienteTax | null
  /**
   * Los clientes que ya hay, SOLO para sacar de ellos cómo se llaman los
   * ficheros que se usan. No se lee nada más de esta lista.
   */
  sugerencias?: readonly ClienteTax[]
  /**
   * El año que se está viendo en el panel, que viaja en cada escritura.
   *
   * Estas rutas contestan la vista YA RECARGADA, y el año que recargan lo leen
   * de la dirección: si no se les dice, cogen el del reloj del contenedor. Sin
   * esto, cambiarle el nombre a un cliente mientras se mira 2025 devolvería la
   * vista de 2026 y la pantalla saltaría de año sola, con todo vacío.
   */
  anio: number | null
  onCerrar: () => void
  onGuardado: (vista: VistaTaxReports) => void
}) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? '')
  /**
   * Cadena suelta, no una unión de dos valores.
   *
   * Un cliente nuevo nace con «Tax report» escrito porque es lo que lleva la
   * mayoría y porque el campo es obligatorio: dejarlo vacío obligaría a teclear
   * lo mismo en todas las altas menos dos.
   */
  const [tipoFichero, setTipoFichero] = useState<string>(
    cliente?.tipoFichero ?? TIPO_FICHERO_POR_DEFECTO
  )
  const [notas, setNotas] = useState(cliente?.notas ?? '')
  const [activo, setActivo] = useState(cliente?.activo ?? true)

  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  /** El borrado pide una segunda pulsación. No hay deshacer al otro lado. */
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  /** Lo que se le pega a las tres escrituras para que devuelvan el año que se está viendo */
  const sufijoAnio = anio === null ? '' : `?anio=${anio}`

  /**
   * Las sugerencias: lo que ya se usa en los demás clientes, más las dos de
   * siempre, sin repetir y en orden alfabético.
   *
   * Se comparan en minúsculas para NO ofrecer «Sellerboard» y «sellerboard» como
   * dos opciones distintas —que es lo que pasaría con un Set a secas— pero lo
   * que se propone es el texto tal y como está escrito.
   */
  const opciones = useMemo(() => {
    const vistos = new Map<string, string>()
    for (const s of SUGERENCIAS_BASE) vistos.set(s.toLowerCase(), s)
    for (const c of sugerencias) {
      const texto = (c.tipoFichero ?? '').trim()
      if (texto === '') continue
      if (!vistos.has(texto.toLowerCase())) vistos.set(texto.toLowerCase(), texto)
    }
    return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
  }, [sugerencias])

  async function guardar() {
    const limpio = nombre.trim()
    if (limpio === '') {
      setAviso('Ponle nombre: es lo que se lee en la lista de la izquierda.')
      return
    }

    const fichero = tipoFichero.trim()
    if (fichero === '') {
      setAviso(
        'Escribe cómo se llama su fichero: es lo que se lee debajo del cliente y lo que dice qué hay que ir a buscar el día 3.'
      )
      return
    }

    setAviso(null)
    setGuardando(true)

    // El nombre viaja recortado: «DIRU » y «DIRU» son dos clientes distintos
    // para la restricción de único de la base, y dos filas para el empleado.
    const res = cliente
      ? await patchAmazon<VistaTaxReports>(`/api/tax-reports/clientes/${cliente.id}${sufijoAnio}`, {
          nombre: limpio,
          tipoFichero: fichero,
          notas: notas.trim() === '' ? null : notas.trim(),
          activo,
        })
      : await postAmazon<VistaTaxReports>(`/api/tax-reports/clientes${sufijoAnio}`, {
          nombre: limpio,
          tipoFichero: fichero,
          notas: notas.trim() === '' ? null : notas.trim(),
        })

    setGuardando(false)
    if (!res.ok) {
      // Se queda EN EL DIÁLOGO con lo tecleado dentro: un toast y el diálogo
      // cerrado obliga a volver a escribirlo todo para reintentar.
      setAviso(res.error)
      return
    }

    onGuardado(res.data)
    toast.success(cliente ? `«${limpio}» actualizado.` : `«${limpio}» añadido.`)
  }

  async function borrar() {
    if (!cliente) return
    setAviso(null)
    setBorrando(true)
    const res = await deleteAmazon<VistaTaxReports>(
      `/api/tax-reports/clientes/${cliente.id}${sufijoAnio}`
    )
    setBorrando(false)
    if (!res.ok) {
      setAviso(res.error)
      setConfirmando(false)
      return
    }
    onGuardado(res.data)
    toast.success(`«${cliente.nombre}» borrado.`)
  }

  return (
    <Dialogo
      titulo={cliente ? `Cliente «${cliente.nombre}»` : 'Añadir un cliente'}
      entradilla={
        cliente
          ? 'Los cambios se ven en la lista al cerrar. Los meses ya subidos no se tocan.'
          : 'Sale en la lista desde este mismo momento, con todos los meses del año vacíos.'
      }
      onCerrar={onCerrar}
      ancho="max-w-[560px]"
      pie={
        <>
          {cliente && (
            <button
              type="button"
              onClick={() => (confirmando ? void borrar() : setConfirmando(true))}
              disabled={borrando || guardando}
              className={`${BOTON.base} ${BOTON.secundario} mr-auto`}
              title="Solo se puede borrar mientras no tenga ningún fichero colgado"
            >
              {borrando ? (
                <Loader2 className="h-[13px] w-[13px] animate-spin" />
              ) : (
                <Trash2 className="h-[13px] w-[13px]" />
              )}
              {confirmando ? 'Pulsa otra vez para borrarlo' : 'Borrar'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando || borrando}
            className={`${BOTON.base} ${BOTON.primario}`}
          >
            {guardando && <Loader2 className="h-[13px] w-[13px] animate-spin" />}
            {cliente ? 'Guardar' : 'Añadir'}
          </button>
          <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario}`}>
            Cancelar
          </button>
        </>
      }
    >
      {aviso && (
        <Aviso tono="rojo" icono={CircleAlert}>
          {aviso}
        </Aviso>
      )}

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>
          Nombre<span className={CAMPO.obligatorio}> *</span>
        </label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Bodegas Valhalla"
          autoFocus
          className={CAMPO.input}
        />
        <p className={CAMPO.nota}>
          Como lo escribes aquí es como sale en la lista y como lo vas a buscar el día 3.
        </p>
      </div>

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta} htmlFor="tax-tipo-fichero">
          Cómo se llama su fichero<span className={CAMPO.obligatorio}> *</span>
        </label>
        {/* Input con datalist y NO un select: la lista se ofrece, no se impone.
            Escribir «Informe del proveedor» tiene que valer sin tocar el código,
            que es justo lo que pidió Raúl. */}
        <input
          id="tax-tipo-fichero"
          list="tax-tipos-fichero"
          value={tipoFichero}
          onChange={(e) => setTipoFichero(e.target.value)}
          placeholder="Tax report"
          // 60 porque es lo que guarda la ruta: `readText(body.tipoFichero, 60)`
          // RECORTA en silencio lo que pase de ahí, así que dejar teclear más
          // aquí es dejar que alguien escriba un nombre y se guarde otro.
          maxLength={60}
          className={CAMPO.input}
        />
        <datalist id="tax-tipos-fichero">
          {opciones.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        <p className={CAMPO.nota}>
          Es lo que se lee debajo del nombre en la lista y lo que dice qué hay que ir a buscar el día
          3: «Tax report» es el fiscal de Seller Central y «Sellerboard» es el de Sellerboard, pero
          puedes escribir lo que quieras. Si otro cliente ya lleva ese fichero, elígelo de la lista
          en vez de volver a teclearlo.
        </p>
      </div>

      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Nota</label>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          placeholder="A quién se le manda, o qué tiene de particular esta cuenta"
          className={`${CAMPO.input} h-auto py-[5px] leading-[1.5]`}
        />
        <p className={CAMPO.nota}>
          Es la nota permanente de la cuenta y se lee en su pestaña «Notas del cliente». Lo que
          caduca con el mes va en la nota de ese mes. Aquí NO van datos de compradores.
        </p>
      </div>

      {cliente && (
        <div className={CAMPO.contenedor}>
          <label className={`flex cursor-pointer items-center gap-[6px] ${TIPO.m} ${TEXTO.t2}`}>
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="h-[13px] w-[13px] accent-[var(--ls-acc)]"
            />
            Sigue siendo cliente
          </label>
          <p className={CAMPO.nota}>
            Al desmarcarlo deja de contar en lo que falta cada mes y sale apagado, pero sus meses ya
            subidos siguen ahí. Es lo que hay que hacer cuando un cliente se va: borrarlo se lleva
            por delante el historial de lo que se le mandó.
          </p>
        </div>
      )}

      {cliente && confirmando && (
        <Aviso tono="ambar" icono={Info}>
          <span className={AVISO.fuerte}>Se va a borrar «{cliente.nombre}» de Tax Reports.</span> Si
          tiene algún fichero colgado, el servidor no dejará: quítalos primero uno a uno, o dalo de
          baja en vez de borrarlo.
        </Aviso>
      )}
    </Dialogo>
  )
}

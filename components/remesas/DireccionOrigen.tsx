'use client'

import { useEffect, useState } from 'react'
import { Check, MapPin, Pencil, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, EsqueletoTexto, Tarjeta } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'

/**
 * DESDE DÓNDE ENVÍA ESTE CLIENTE.
 *
 * Amazon la exige para crear el plan y no la da por API: en Seller Central te
 * la rellena la interfaz desde tu libreta de direcciones, pero esa libreta no
 * está expuesta. Se mete una vez y no se vuelve a tocar hasta que cambien de
 * almacén.
 *
 * Los dos campos que más se equivocan llevan su aviso al lado: el país en dos
 * letras y la provincia en código. Escribir «España» y «Madrid» hace que Amazon
 * rechace el plan con un mensaje que no señala a la causa.
 *
 * Quién: la agencia que edita el cliente (antes, solo el administrador; spec remesas-pro §1.4). La ruta
 * /api/fba/direccion ya pedía editar ese cliente.
 */

interface Direccion {
  nombre: string
  empresa: string
  linea1: string
  linea2: string | null
  ciudad: string
  provincia: string
  codigoPostal: string
  pais: string
  telefono: string
  email: string
}

const VACIA: Direccion = {
  nombre: '',
  empresa: '',
  linea1: '',
  linea2: '',
  ciudad: '',
  provincia: '',
  codigoPostal: '',
  pais: 'ES',
  telefono: '',
  email: '',
}

const CAMPO =
  'h-9 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[10px] text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] ' +
  'hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] [@media(pointer:coarse)]:h-11'

export function DireccionOrigen({
  clienteId,
  clienteNombre,
  puedeEditar,
  onGuardada,
}: {
  clienteId: string
  clienteNombre: string
  puedeEditar: boolean
  /** Tras guardar (la pantalla del envío vuelve a leer su estado) */
  onGuardada?: () => void
}) {
  const [dir, setDir] = useState<Direccion | null>(null)
  const [borrador, setBorrador] = useState<Direccion>(VACIA)
  const [editando, setEditando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/fba/direccion?cliente=${clienteId}`)
        const p = (await res.json().catch(() => ({ direccion: null }))) as { direccion: Direccion | null }
        if (!vivo) return
        setDir(p.direccion)
        setBorrador(p.direccion ?? VACIA)
        // Sin dirección se abre directamente en edición: es lo que hay que
        // hacer, y obligar a pulsar «editar» sobre un hueco vacío es un clic
        // que no decide nada.
        setEditando(!p.direccion)
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [clienteId])

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch('/api/fba/direccion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente: clienteId, ...borrador }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? 'No se ha podido guardar')
        return
      }
      toast.success('Dirección guardada')
      setDir(borrador)
      setEditando(false)
      onGuardada?.()
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Vuelve a probar.')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <Tarjeta icono={MapPin} acento="remesas" titulo="Se envía desde">
        <EsqueletoTexto lineas={3} />
      </Tarjeta>
    )
  }

  if (!editando && dir) {
    return (
      <Tarjeta
        icono={MapPin}
        acento="remesas"
        titulo="Se envía desde"
        subtitulo={`${dir.empresa} · ${dir.nombre}`}
        acciones={
          puedeEditar ? <Boton variante="fantasma" tamano="sm" soloIcono icono={Pencil} aria-label="Cambiar la dirección" title="Cambiar la dirección" onClick={() => setEditando(true)} /> : undefined
        }
      >
        <p className="text-[13px] leading-[1.55] text-[var(--ls-t2)]">
          {dir.linea1}
          {dir.linea2 ? `, ${dir.linea2}` : ''} · {dir.codigoPostal} {dir.ciudad}{dir.provincia ? ` (${dir.provincia})` : ''} · {dir.pais}
        </p>
        <p className="mt-[2px] break-words text-[12.5px] text-[var(--ls-t3)]">
          {dir.telefono} · {dir.email}
        </p>
      </Tarjeta>
    )
  }

  if (!puedeEditar) {
    return (
      <div className="flex items-start gap-2 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-3 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}>
        <TriangleAlert className="mt-[2px] h-[14px] w-[14px] shrink-0" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
        Falta la dirección desde la que envía {clienteNombre}. Amazon la exige para crear el envío, y no tienes permiso para meterla.
      </div>
    )
  }

  const campo = (k: keyof Direccion) => ({
    value: (borrador[k] ?? '') as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setBorrador({ ...borrador, [k]: e.target.value }),
  })

  return (
    <Tarjeta
      icono={MapPin}
      acento="remesas"
      titulo="Desde dónde se envía"
      subtitulo={`El almacén de ${clienteNombre}`}
      pie={
        <div className="flex flex-wrap justify-end gap-2">
          {dir && (
            <Boton
              variante="fantasma"
              tamano="sm"
              onClick={() => {
                setBorrador(dir)
                setEditando(false)
              }}
            >
              Cancelar
            </Boton>
          )}
          <Boton variante="primario" tamano="sm" icono={Check} cargando={guardando} onClick={() => void guardar()}>
            Guardar dirección
          </Boton>
        </div>
      }
    >
      <p className="mb-3 text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">
        Amazon la exige para crear el envío y no la da por su API, así que se mete una vez. Es el almacén de {clienteNombre}, no la dirección de Liberty Seller.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Empresa">
          <input {...campo('empresa')} autoComplete="organization" className={CAMPO} />
        </Campo>
        <Campo etiqueta="Persona de contacto">
          <input {...campo('nombre')} autoComplete="name" className={CAMPO} />
        </Campo>

        <Campo etiqueta="Dirección" ancho>
          <input {...campo('linea1')} placeholder="Calle y número" autoComplete="address-line1" className={CAMPO} />
        </Campo>
        <Campo etiqueta="Piso, nave, puerta" pista="Opcional" ancho>
          <input {...campo('linea2')} autoComplete="address-line2" className={CAMPO} />
        </Campo>

        <Campo etiqueta="Ciudad">
          <input {...campo('ciudad')} autoComplete="address-level2" className={CAMPO} />
        </Campo>
        <Campo etiqueta="Código postal">
          <input {...campo('codigoPostal')} inputMode="numeric" autoComplete="postal-code" className={CAMPO} />
        </Campo>

        <Campo etiqueta="Provincia" pista="Opcional. Vacía si en Seller Central no la tiene">
          <input
            value={borrador.provincia}
            onChange={(e) => setBorrador({ ...borrador, provincia: e.target.value.toUpperCase() })}
            placeholder="—"
            maxLength={4}
            className={`${CAMPO} uppercase`}
          />
        </Campo>
        <Campo etiqueta="País" pista="Dos letras: ES, FR, PT…">
          <input
            value={borrador.pais}
            onChange={(e) => setBorrador({ ...borrador, pais: e.target.value.toUpperCase() })}
            placeholder="ES"
            maxLength={2}
            className={`${CAMPO} uppercase`}
          />
        </Campo>

        <Campo etiqueta="Teléfono" pista="Solo números, puede llevar +">
          <input {...campo('telefono')} type="tel" placeholder="+34600000000" autoComplete="tel" className={CAMPO} />
        </Campo>
        <Campo etiqueta="Correo">
          <input {...campo('email')} type="email" autoComplete="email" className={CAMPO} />
        </Campo>
      </div>
    </Tarjeta>
  )
}

function Campo({ etiqueta, pista, ancho, children }: { etiqueta: string; pista?: string; ancho?: boolean; children: React.ReactNode }) {
  return (
    <label className={ancho ? 'block sm:col-span-2' : 'block'}>
      <span className="mb-1 block text-[12px] font-semibold text-[var(--ls-t3)]">
        {etiqueta}
        {pista && <span className="ml-[6px] font-normal text-[var(--ls-t4)]">{pista}</span>}
      </span>
      {children}
    </label>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, MapPin, Pencil } from 'lucide-react'
import { toast } from 'sonner'

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
  'w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/20 focus:border-[#FF6600]/40 focus:outline-none'

export function DireccionOrigen({
  clienteId,
  clienteNombre,
  puedeEditar,
}: {
  clienteId: string
  clienteNombre: string
  puedeEditar: boolean
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
        const p = (await res.json()) as { direccion: Direccion | null }
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
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <div className="glass-card flex items-center gap-2 p-3 text-[12px] text-white/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando la dirección…
      </div>
    )
  }

  if (!editando && dir) {
    return (
      <div className="glass-card flex items-start gap-3 p-3">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#FF6600]" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-white/35">Se envía desde</p>
          <p className="mt-0.5 text-[12px] text-white">
            {dir.empresa} · {dir.nombre}
          </p>
          <p className="text-[11px] text-white/50">
            {dir.linea1}
            {dir.linea2 ? `, ${dir.linea2}` : ''} · {dir.codigoPostal} {dir.ciudad} ({dir.provincia}
            ) · {dir.pais}
          </p>
          <p className="text-[11px] text-white/35">
            {dir.telefono} · {dir.email}
          </p>
        </div>
        {puedeEditar && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            title="Cambiar la dirección"
            className="rounded p-1.5 text-white/40 hover:bg-white/[0.06] hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  if (!puedeEditar) {
    return (
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[11px] text-amber-200/90">
        Falta la dirección desde la que envía {clienteNombre}. Amazon la exige para crear el envío, y
        no tienes permiso para meterla.
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-[#FF6600]" />
        <p className="text-[12px] font-semibold text-white">Desde dónde se envía</p>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-white/40">
        Amazon la exige para crear el envío y no la da por su API, así que se mete una vez. Es el
        almacén de {clienteNombre}, no la dirección de Liberty Seller.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Campo etiqueta="Empresa">
          <input
            value={borrador.empresa}
            onChange={(e) => setBorrador({ ...borrador, empresa: e.target.value })}
            className={CAMPO}
          />
        </Campo>
        <Campo etiqueta="Persona de contacto">
          <input
            value={borrador.nombre}
            onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
            className={CAMPO}
          />
        </Campo>

        <Campo etiqueta="Dirección" ancho>
          <input
            value={borrador.linea1}
            onChange={(e) => setBorrador({ ...borrador, linea1: e.target.value })}
            placeholder="Calle y número"
            className={CAMPO}
          />
        </Campo>
        <Campo etiqueta="Piso, nave, puerta" pista="Opcional" ancho>
          <input
            value={borrador.linea2 ?? ''}
            onChange={(e) => setBorrador({ ...borrador, linea2: e.target.value })}
            className={CAMPO}
          />
        </Campo>

        <Campo etiqueta="Ciudad">
          <input
            value={borrador.ciudad}
            onChange={(e) => setBorrador({ ...borrador, ciudad: e.target.value })}
            className={CAMPO}
          />
        </Campo>
        <Campo etiqueta="Código postal">
          <input
            value={borrador.codigoPostal}
            onChange={(e) => setBorrador({ ...borrador, codigoPostal: e.target.value })}
            className={CAMPO}
          />
        </Campo>

        <Campo etiqueta="Provincia" pista="En código: MD, B, V, SE…">
          <input
            value={borrador.provincia}
            onChange={(e) => setBorrador({ ...borrador, provincia: e.target.value.toUpperCase() })}
            placeholder="MD"
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
          <input
            value={borrador.telefono}
            onChange={(e) => setBorrador({ ...borrador, telefono: e.target.value })}
            placeholder="+34600000000"
            className={CAMPO}
          />
        </Campo>
        <Campo etiqueta="Correo">
          <input
            type="email"
            value={borrador.email}
            onChange={(e) => setBorrador({ ...borrador, email: e.target.value })}
            className={CAMPO}
          />
        </Campo>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {dir && (
          <button
            type="button"
            onClick={() => {
              setBorrador(dir)
              setEditando(false)
            }}
            className="rounded-lg px-3 py-1.5 text-[12px] text-white/50 hover:text-white"
          >
            Cancelar
          </button>
        )}
        <motion.button
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={guardar}
          disabled={guardando}
          className="flex items-center gap-1.5 rounded-lg bg-[#FF6600] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Guardar dirección
        </motion.button>
      </div>
    </motion.div>
  )
}

function Campo({
  etiqueta,
  pista,
  ancho,
  children,
}: {
  etiqueta: string
  pista?: string
  ancho?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={ancho ? 'col-span-2' : ''}>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
        {etiqueta}
        {pista && <span className="ml-1.5 normal-case tracking-normal text-white/25">{pista}</span>}
      </label>
      {children}
    </div>
  )
}

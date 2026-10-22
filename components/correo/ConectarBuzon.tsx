'use client'

import { AlertCircle, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { DIAS_DE_HISTORICO, DIAS_POR_DEFECTO } from '@/lib/correo/proveedores'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { enviarJson } from './api'
import { BOTON_PRIMARIO, CAMPO } from './ui'

/**
 * CONECTAR MI CORREO.
 *
 * Cada persona escribe su dirección y la contraseña de SU buzón de Hostinger. La contraseña sale del navegador una sola
 * vez, hacia nuestra ruta, que la comprueba contra el servidor de correo y la guarda cifrada; no se vuelve a mostrar ni
 * se puede leer desde aquí (ni por su dueño ni por quien supervisa).
 *
 * LO QUE SE LE DICE A LA PERSONA, SIN LETRA PEQUEÑA: que quien supervisa al equipo comercial puede leer este buzón,
 * que es de solo lectura y que ella puede ver cuándo lo han mirado. Conectar el correo de trabajo a una herramienta de la
 * empresa es una decisión que se toma sabiendo eso.
 */

interface Respuesta {
  ok: boolean
  buzonId: string
  buzones: BuzonVisible[]
  lectura: { importados?: number; quedan?: number; completo?: boolean; error?: string | null }
}

type Proveedor = 'auto' | 'hostinger' | 'titan' | 'personalizado'

interface Props {
  /** Nombre con el que se firma por defecto */
  nombre: string
  /** Un administrador puede conectar un servidor que no sea de Hostinger */
  esAdmin: boolean
  /** La tarjeta grande de bienvenida o la versión sin marco (dentro de un diálogo) */
  variante?: 'tarjeta' | 'plana'
  onConectado: (buzones: BuzonVisible[], buzonId: string) => void
}

export function ConectarBuzon({ nombre, esAdmin, variante = 'tarjeta', onConectado }: Props) {
  const [direccion, setDireccion] = useState('')
  const [password, setPassword] = useState('')
  const [firmaNombre, setFirmaNombre] = useState(nombre)
  const [dias, setDias] = useState<number>(DIAS_POR_DEFECTO)
  const [proveedor, setProveedor] = useState<Proveedor>('auto')
  const [imapHost, setImapHost] = useState('')
  const [imapPuerto, setImapPuerto] = useState('993')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPuerto, setSmtpPuerto] = useState('465')
  const [comprobando, setComprobando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function conectar(e: FormEvent) {
    e.preventDefault()
    if (comprobando || !direccion.trim() || !password) return
    const escrita = password
    // La contraseña no se queda en pantalla ni en el estado más de lo necesario: se suelta en cuanto se toma
    setPassword('')
    setError(null)
    setComprobando(true)

    const cuerpo: Record<string, unknown> = { direccion: direccion.trim(), password: escrita, nombre: firmaNombre.trim() || undefined, desdeDias: dias }
    if (proveedor !== 'auto') cuerpo.proveedor = proveedor
    if (proveedor === 'personalizado') {
      cuerpo.imap = { host: imapHost.trim(), puerto: Number(imapPuerto) }
      cuerpo.smtp = { host: smtpHost.trim(), puerto: Number(smtpPuerto) }
    }

    const r = await enviarJson<Respuesta>('/api/correo/buzones', 'POST', cuerpo)
    setComprobando(false)
    if (!r.ok) {
      setError(r.mensaje)
      // El dominio no se reconoce: se pide que la persona diga el proveedor
      if (r.extra.necesitaProveedor === true) setProveedor('hostinger')
      return
    }
    toast.success('Correo conectado. Trayendo tus mensajes…')
    onConectado(r.datos.buzones, r.datos.buzonId)
  }

  const formulario = (
    <form onSubmit={conectar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--ls-t3)]">Tu correo</span>
          <input
            type="email"
            name="correo-direccion"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder="nombre@tuempresa.es"
            disabled={comprobando}
            className={CAMPO}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--ls-t3)]">Contraseña del buzón</span>
          <input
            type="password"
            name="correo-contrasena"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            data-1p-ignore
            data-lpignore="true"
            data-bwignore="true"
            disabled={comprobando}
            className={CAMPO}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--ls-t3)]">Tu nombre al enviar</span>
          <input type="text" value={firmaNombre} onChange={(e) => setFirmaNombre(e.target.value)} disabled={comprobando} className={CAMPO} maxLength={120} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-[var(--ls-t3)]">Traer los correos de los últimos</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} disabled={comprobando} className={CAMPO}>
            {DIAS_DE_HISTORICO.map((d) => (
              <option key={d} value={d}>
                {d === 365 ? '12 meses' : `${d} días`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(proveedor !== 'auto' || esAdmin) && (
        <label className="block space-y-1 sm:max-w-xs">
          <span className="text-[11px] font-medium text-[var(--ls-t3)]">Proveedor del correo</span>
          <select value={proveedor} onChange={(e) => setProveedor(e.target.value as Proveedor)} disabled={comprobando} className={CAMPO}>
            <option value="auto">Detectarlo solo</option>
            <option value="hostinger">Hostinger</option>
            <option value="titan">Titan (Hostinger)</option>
            {esAdmin && <option value="personalizado">Otro servidor</option>}
          </select>
        </label>
      )}

      {proveedor === 'personalizado' && (
        <div className="grid gap-3 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--ls-t3)]">Servidor de entrada (IMAP)</span>
            <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.midominio.es" className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--ls-t3)]">Puerto IMAP</span>
            <select value={imapPuerto} onChange={(e) => setImapPuerto(e.target.value)} className={CAMPO}>
              <option value="993">993 (TLS)</option>
              <option value="143">143 (STARTTLS)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--ls-t3)]">Servidor de salida (SMTP)</span>
            <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.midominio.es" className={CAMPO} />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-[var(--ls-t3)]">Puerto SMTP</span>
            <select value={smtpPuerto} onChange={(e) => setSmtpPuerto(e.target.value)} className={CAMPO}>
              <option value="465">465 (TLS)</option>
              <option value="587">587 (STARTTLS)</option>
            </select>
          </label>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={comprobando || !direccion.trim() || !password} className={BOTON_PRIMARIO}>
          {comprobando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
          {comprobando ? 'Comprobando…' : 'Conectar mi correo'}
        </button>
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--ls-t4)]">
          La contraseña es la del buzón (la que usas en el webmail de Hostinger), no la de tu cuenta de Hostinger. Se guarda cifrada y no se vuelve a mostrar.
        </p>
      </div>

      <p className="flex items-start gap-2 rounded-[8px] bg-[var(--ls-sup2)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--ls-t3)]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
        <span>
          Quien supervisa al equipo comercial puede leer tu buzón desde el ERP, en solo lectura. Cada vez que lo mira queda anotado, y tú puedes ver quién y cuándo en los ajustes de tu buzón.
        </span>
      </p>
    </form>
  )

  if (variante === 'plana') return formulario

  return (
    <div className="rounded-[10px] border border-[var(--ls-acc-graf)] bg-[linear-gradient(135deg,var(--ls-acc-suave),transparent_65%)] bg-[var(--ls-sup)] p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ls-acc-suave)]">
          <Mail className="h-5 w-5 text-[var(--ls-acc)]" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--ls-t1)]">Conecta tu correo</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--ls-t3)]">
            Verás aquí tus correos, podrás contestarlos y enviar los nuevos, y cada conversación queda agrupada en su hilo.
          </p>
        </div>
      </div>
      {formulario}
    </div>
  )
}

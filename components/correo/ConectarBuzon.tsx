'use client'

import { AlertCircle, ArrowLeft, Mail, ShieldCheck } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls'
import { DIAS_DE_HISTORICO, DIAS_POR_DEFECTO } from '@/lib/correo/proveedores'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { cn } from '@/lib/utils'
import { enviarJson } from './api'
import { CAMPO } from './ui'

/**
 * CONECTAR MI CORREO.
 *
 * Cada persona escribe su dirección y la contraseña de SU buzón de Hostinger. La contraseña sale del navegador una sola
 * vez, hacia nuestra ruta, que la comprueba contra el servidor de correo y la guarda cifrada; no se vuelve a mostrar ni
 * se puede leer desde aquí (ni por su dueño ni por quien supervisa).
 *
 * LO QUE SE LE DICE A LA PERSONA, SIN LETRA PEQUEÑA: que quien supervisa el correo del equipo puede leer este buzón y que es de
 * solo lectura. Conectar el correo de trabajo a una herramienta de la empresa es una decisión que se toma sabiendo eso. (Ya NO se le
 * dice que ve quién lo ha mirado y cuándo: ese rastro lo lee solo un administrador. Ese aviso es lo que informa a la persona de que su
 * correo puede revisarse; quitarlo es una decisión de la empresa, no un detalle de la pantalla.)
 *
 * Rediseño «Correo Pro» (spec 1.5 y flujo 4): el estilo del kit (tarjeta de 14 px, el Mail en el acento, Boton), campos de 16 px en el móvil
 * (CAMPO) y controles de 44 px. LA LÓGICA ES LA DE SIEMPRE: el mismo POST /api/correo/buzones, el proveedor lo eligen los admin o un dominio
 * desconocido (`necesitaProveedor`), «Otro servidor» es solo admin y el máximo de buzones lo comprueba la ruta.
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
  /** OPCIONAL. «Volver» al pie del formulario (cuando se abre desde «Conectar buzón» y ya hay algo que ver). Sin él no sale */
  onVolver?: () => void
  /** OPCIONAL (por defecto true). false = falta AMAZON_TOKEN_KEY en el servidor: sale el aviso dentro de la tarjeta (la ruta lo rechazaría igual) */
  cifradoConfigurado?: boolean
}

function Campo({ etiqueta, children, className }: { etiqueta: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId()
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[12.5px] font-medium text-[var(--ls-t2)]">
        {etiqueta}
      </label>
      {children(id)}
    </div>
  )
}

export function ConectarBuzon({ nombre, esAdmin, variante = 'tarjeta', onConectado, onVolver, cifradoConfigurado = true }: Props) {
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
  const idTitulo = useId()

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
    <form onSubmit={conectar} className="space-y-4" aria-busy={comprobando || undefined}>
      {!cifradoConfigurado && (
        <p className="flex items-start gap-2 rounded-[10px] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2 text-[13px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>
            El servidor no tiene la clave con la que se cifran las contraseñas (<span className="font-mono">AMAZON_TOKEN_KEY</span>), así que de momento no puede guardar la de
            ningún buzón. Avisa a Liberty Seller.
          </span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tu correo">
          {(id) => (
            <input
              id={id}
              type="email"
              name="correo-direccion"
              inputMode="email"
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
          )}
        </Campo>
        <Campo etiqueta="Contraseña del buzón">
          {(id) => (
            <input
              id={id}
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
          )}
        </Campo>
        <Campo etiqueta="Tu nombre al enviar">
          {(id) => <input id={id} type="text" value={firmaNombre} onChange={(e) => setFirmaNombre(e.target.value)} disabled={comprobando} className={CAMPO} maxLength={120} />}
        </Campo>
        <Campo etiqueta="Traer los correos de los últimos">
          {(id) => (
            <select id={id} value={dias} onChange={(e) => setDias(Number(e.target.value))} disabled={comprobando} className={CAMPO}>
              {DIAS_DE_HISTORICO.map((d) => (
                <option key={d} value={d}>
                  {d === 365 ? '12 meses' : `${d} días`}
                </option>
              ))}
            </select>
          )}
        </Campo>
      </div>

      {(proveedor !== 'auto' || esAdmin) && (
        <Campo etiqueta="Proveedor del correo" className="sm:max-w-xs">
          {(id) => (
            <select id={id} value={proveedor} onChange={(e) => setProveedor(e.target.value as Proveedor)} disabled={comprobando} className={CAMPO}>
              <option value="auto">Detectarlo solo</option>
              <option value="hostinger">Hostinger</option>
              <option value="titan">Titan (Hostinger)</option>
              {esAdmin && <option value="personalizado">Otro servidor</option>}
            </select>
          )}
        </Campo>
      )}

      {proveedor === 'personalizado' && (
        <fieldset className="grid gap-3 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-4 sm:grid-cols-2">
          <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">Otro servidor</legend>
          <Campo etiqueta="Servidor de entrada (IMAP)">
            {(id) => <input id={id} value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.midominio.es" autoCapitalize="off" spellCheck={false} className={CAMPO} />}
          </Campo>
          <Campo etiqueta="Puerto IMAP">
            {(id) => (
              <select id={id} value={imapPuerto} onChange={(e) => setImapPuerto(e.target.value)} className={CAMPO}>
                <option value="993">993 (TLS)</option>
                <option value="143">143 (STARTTLS)</option>
              </select>
            )}
          </Campo>
          <Campo etiqueta="Servidor de salida (SMTP)">
            {(id) => <input id={id} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.midominio.es" autoCapitalize="off" spellCheck={false} className={CAMPO} />}
          </Campo>
          <Campo etiqueta="Puerto SMTP">
            {(id) => (
              <select id={id} value={smtpPuerto} onChange={(e) => setSmtpPuerto(e.target.value)} className={CAMPO}>
                <option value="465">465 (TLS)</option>
                <option value="587">587 (STARTTLS)</option>
              </select>
            )}
          </Campo>
        </fieldset>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-[10px] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-3 py-2 text-[13px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0">{error}</span>
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onVolver && (
            <Boton variante="fantasma" icono={ArrowLeft} onClick={onVolver} disabled={comprobando}>
              Volver
            </Boton>
          )}
          <Boton type="submit" variante="primario" icono={Mail} cargando={comprobando} disabled={comprobando || !direccion.trim() || !password} className="w-full sm:w-auto">
            {comprobando ? 'Comprobando…' : 'Conectar mi correo'}
          </Boton>
        </div>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-[var(--ls-t4)]">
          La contraseña es la del buzón (la que usas en el webmail de Hostinger), no la de tu cuenta de Hostinger. Se guarda cifrada y no se vuelve a mostrar.
        </p>
      </div>

      <p className="flex items-start gap-2.5 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2.5 text-[12.5px] leading-relaxed text-[var(--ls-t3)]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-t4)]" aria-hidden />
        <span>Quien supervisa el correo del equipo (administración y las personas a las que se les da ese permiso) puede leer tu buzón desde el ERP, en solo lectura.</span>
      </p>
    </form>
  )

  if (variante === 'plana') return formulario

  return (
    <section
      aria-labelledby={idTitulo}
      className="relative overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 shadow-[var(--ls-sombra-1)] sm:p-6"
    >
      {/* La luz del acento arriba, como en el kit */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(60%_100%_at_15%_0%,var(--ls-acc-suave),transparent)]" />
      <div className="relative mb-5 flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[var(--ls-acc-suave)] shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]">
          <Mail className="h-5 w-5 text-[var(--ls-acc)]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id={idTitulo} className="text-[17px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">
            Conecta tu correo
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--ls-t3)]">
            Verás aquí tus correos, podrás contestarlos y enviar los nuevos, y cada conversación queda agrupada en su hilo.
          </p>
        </div>
      </div>
      <div className="relative">{formulario}</div>
    </section>
  )
}

'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { AlertCircle, ArrowRight, CalendarDays, Clock, Eye, EyeOff, Gauge, Loader2, Lock, Mail, PhoneCall } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/ui/Logo'
import { useRouter } from 'next/navigation'
import { destinoTrasLogin } from '@/lib/mcp/consentimiento'
import { enviarLote, idDeSesion } from '@/lib/actividad/cliente'
import { mensajeDeErrorDeAcceso } from '@/lib/inicio/acceso'

/**
 * La pantalla de inicio de sesión: a la izquierda (solo en pantallas anchas) qué hay dentro del ERP, a la derecha el formulario.
 * Todo el aspecto y el movimiento es CSS (clases `acceso-*` en el bloque «Inicio y acceso» de app/globals.css); aquí solo hay estructura. El escalón de
 * cada pieza al entrar se pone con `--d`, igual que en el resto del ERP.
 */
const MODULOS = [
  { icono: PhoneCall, titulo: 'Cold Calling', texto: 'Cartera, llamadas y resumen automático' },
  { icono: CalendarDays, titulo: 'Agenda', texto: 'Citas sincronizadas con Google Calendar' },
  { icono: Mail, titulo: 'Correo', texto: 'Tu bandeja dentro del ERP' },
  { icono: Gauge, titulo: 'Rendimiento', texto: 'Tus cifras del día, al momento' },
]

const paso = (n: number) => ({ '--d': n }) as CSSProperties

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Por qué se ha vuelto aquí: si es que la sesión se cerró por llevar un rato sin hacer nada (lib/actividad/inactividad.ts).
  // Se lee en un efecto y no en el primer pintado para que servidor y navegador pinten lo mismo
  const [porInactividad, setPorInactividad] = useState(false)
  useEffect(() => {
    setPorInactividad(new URLSearchParams(window.location.search).get('motivo') === 'inactividad')
  }, [])
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError

      if (data.user) {
        // Se apunta la hora del inicio de sesión (la ruta solo guarda la de los empleados y calla siempre: no cambia nada aquí)
        enviarLote(idDeSesion().id, [{ t: 'login', ruta: '/auth/login' }])
        // Si se llegó desde la pantalla de consentimiento del conector MCP, se vuelve
        // a ella; cualquier otro destino se ignora (lista cerrada, ver destinoTrasLogin).
        // Se lee de la dirección y no con useSearchParams para no obligar a esta
        // página a envolverse en Suspense.
        const siguiente = new URLSearchParams(window.location.search).get('next')
        router.push(destinoTrasLogin(siguiente))
        router.refresh()
      }
    } catch (err: any) {
      setError(mensajeDeErrorDeAcceso(err.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="acceso-escena">
      <div className="acceso-fondo" aria-hidden>
        <div className="acceso-rejilla" />
        <div className="acceso-luz acceso-luz-1" />
        <div className="acceso-luz acceso-luz-2" />
      </div>

      {/* Qué hay dentro: solo en pantallas anchas. En el móvil se ve el formulario y su logo */}
      <section className="acceso-hero">
        <div className="acceso-entra" style={paso(0)}>
          <Logo width={200} height={32} />
        </div>
        <div>
          <p className="acceso-titular acceso-entra" style={paso(1)}>
            Todo el equipo, <span className="acceso-acento">un solo sitio.</span>
          </p>
          <p className="acceso-sub acceso-entra" style={paso(2)}>
            Llamadas, citas, correo y resultados en el mismo lugar. Entra y sigue donde lo dejaste.
          </p>
          <ul className="acceso-modulos">
            {MODULOS.map((m, i) => {
              const Icono = m.icono
              return (
                <li key={m.titulo} className="acceso-entra" style={paso(3 + i)}>
                  <div className="acceso-modulo acceso-flota" style={paso(i)}>
                    <span className="acceso-modulo-icono">
                      <Icono className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div>
                      <b>{m.titulo}</b>
                      <span>{m.texto}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="acceso-pie acceso-entra" style={paso(8)}>
          Acceso solo para el equipo de Liberty Seller
        </p>
      </section>

      <section className="acceso-panel">
        <div className="acceso-tarjeta acceso-entra" style={paso(2)}>
          <div className="acceso-logo-movil">
            <Logo width={180} height={28} />
          </div>
          <div className="acceso-sello" aria-hidden>
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="acceso-h1">Iniciar sesión</h1>
          <p className="acceso-lead">Accede a tu cuenta de Liberty Seller Hub</p>

          {porInactividad && (
            <div className="acceso-aviso acceso-aviso-ambar" role="status">
              <Clock className="h-4 w-4 shrink-0" aria-hidden />
              <span>Tu sesión se ha cerrado por llevar un rato sin actividad. Inicia sesión para seguir.</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="acceso-form">
            <div className="acceso-campo">
              <label htmlFor="email" className="acceso-etiqueta">
                Email
              </label>
              <div className="acceso-caja">
                <Mail className="acceso-icono" aria-hidden />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="tu@email.com"
                  className="acceso-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="acceso-campo">
              <label htmlFor="password" className="acceso-etiqueta">
                Contraseña
              </label>
              <div className="acceso-caja">
                <Lock className="acceso-icono" aria-hidden />
                <Input
                  id="password"
                  type={verClave ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="acceso-input acceso-input-clave"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="acceso-ojo"
                  onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                  aria-pressed={verClave}
                >
                  {verClave ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            {/* `key={error}`: cada error nuevo vuelve a montar el aviso y por eso vuelve a sacudirse */}
            {error && (
              <div key={error} className="acceso-aviso acceso-aviso-rojo acceso-sacude" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="acceso-boton w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Iniciando sesión...
                </>
              ) : (
                <>
                  Iniciar sesión
                  <ArrowRight className="acceso-flecha h-4 w-4" aria-hidden />
                </>
              )}
            </Button>
          </form>
        </div>
      </section>
    </div>
  )
}

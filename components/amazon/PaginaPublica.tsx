import Image from 'next/image'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { CONTACTO } from '@/lib/amazon/oauth'

/**
 * LA PÁGINA QUE VE UN CLIENTE DE LA AGENCIA
 * =========================================
 * La abren /connect y /callback, que son PÚBLICAS: quien está delante es un
 * vendedor de Amazon que no tiene sesión en el ERP, que no sabe lo que es el
 * ERP, y que a veces está al teléfono con nosotros mientras lo hace.
 *
 * De ahí las tres reglas de este fichero:
 *
 *   1. NADA DE JSON, ni de códigos sueltos, ni de pantallas en blanco. Lo que
 *      salga tiene que leerse como una frase: qué ha pasado, y qué hace ahora.
 *   2. SIEMPRE hay una salida. Cada estado termina con a quién escribir. Un
 *      cliente que se queda mirando un error sin saber a quién preguntar acaba
 *      llamando para decir que «lo de Amazon no funciona».
 *   3. Sin componentes de cliente. Aquí no hace falta ni un estado ni una
 *      animación, y esta página tiene que pintar a la primera aunque el
 *      JavaScript no llegue: es lo único que ese cliente va a ver de nosotros.
 *
 * Sin 'use client' a propósito, como components/vacaciones/shared.ts: la abren
 * dos Server Components.
 */

export type TonoPagina = 'ok' | 'error' | 'info'

const TONOS: Record<
  TonoPagina,
  { icono: typeof Info; anillo: string; color: string }
> = {
  // Clases COMPLETAS, nunca construidas concatenando: Tailwind purga lo que no
  // puede leer literalmente en el fichero.
  ok: {
    icono: CheckCircle2,
    anillo: 'border-green-500/30 bg-green-500/[0.08]',
    color: 'text-green-300',
  },
  error: {
    icono: AlertTriangle,
    anillo: 'border-red-500/30 bg-red-500/[0.08]',
    color: 'text-red-300',
  },
  info: {
    icono: Info,
    anillo: 'border-white/10 bg-white/[0.04]',
    color: 'text-white/60',
  },
}

export function PaginaPublica({
  tono,
  title,
  children,
}: {
  tono: TonoPagina
  title: string
  children: React.ReactNode
}) {
  const { icono: Icono, anillo, color } = TONOS[tono]

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-8">
          <Image
            src="/logos/logo.png"
            alt="Liberty Seller"
            width={180}
            height={45}
            priority
            className="object-contain"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
          <div
            className={`h-11 w-11 rounded-full border flex items-center justify-center mb-5 ${anillo}`}
          >
            <Icono className={`h-5 w-5 ${color}`} />
          </div>

          <h1 className="text-white text-xl font-semibold leading-snug mb-3">{title}</h1>

          <div className="space-y-3 text-[13px] leading-relaxed text-white/65">{children}</div>
        </div>

        <p className="text-center text-[12px] text-white/35 mt-6 leading-relaxed">
          Liberty Seller · ¿Alguna duda?{' '}
          <a href={`mailto:${CONTACTO}`} className="text-[#FF6600] hover:underline">
            {CONTACTO}
          </a>
        </p>
      </div>
    </main>
  )
}

/** Una línea de datos dentro de la tarjeta: «Tienda — Mi Tienda SL» */
export function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-[11px] uppercase tracking-wider text-white/35">{label}</span>
      <span className="text-[13px] text-white/85">{value}</span>
    </div>
  )
}

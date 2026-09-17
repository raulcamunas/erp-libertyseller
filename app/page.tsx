import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/Logo'

/**
 * LA PORTADA: EL LOGO Y LA PUERTA.
 *
 * Nada más. Aquí había un recuadro con el título «Liberty Seller Hub», el
 * subtítulo «ERP interno · Sistema de gestión empresarial» y un botón de «Más
 * información» que no llevaba a ninguna parte.
 *
 * Sobraba todo: quien llega aquí es alguien del equipo que viene a entrar, ya
 * sabe qué es esto y no necesita que se lo presenten. El título repetía lo que
 * el logo ya dice, y un botón que no hace nada gasta la confianza en los que sí.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-12 p-8">
      <Logo width={300} height={96} />

      <Link href="/auth/login">
        <Button>Iniciar Sesión</Button>
      </Link>
    </main>
  )
}

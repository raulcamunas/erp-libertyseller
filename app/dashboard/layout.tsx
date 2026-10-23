import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppsPersistentes } from '@/components/layout/AppsPersistentes'
import { AvisosEnVivo } from '@/components/avisos/AvisosEnVivo'
import { Toaster } from '@/components/ui/sonner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  return (
    <div className="min-h-screen bg-[var(--bg-color)] flex relative">
      <AppSidebar />
      {/* min-w-0: sin esto, un hijo ancho (una tabla de muchas columnas)
          estira el main y arrastra toda la página en horizontal, barra
          lateral incluida. Con esto, quien scrollea es la propia tabla. */}
      <main className="flex-1 min-w-0 lg:ml-64 transition-all duration-500 ease-in-out min-h-screen pt-16 lg:pt-0 relative z-10 [&:has([data-app-persistente])_.pagina-de-ruta]:hidden">
        {/* LA PÁGINA DE LA RUTA, con su entrada animada. Esa animación deja puestos `transform` y `filter` para siempre (la animación termina
            `forwards`), y eso tiene dos costes: todo lo que cuelga de aquí se pinta en una capa aparte con un filtro por encima (en el móvil
            se nota al hacer scroll en una lista larga) y los elementos `fixed` de dentro se colocan respecto a este recuadro y no respecto a
            la ventana. Por eso Cold Calling y Correo NO viven aquí dentro sino en AppsPersistentes, justo debajo: cuando una de las dos
            está a la vista, este recuadro (vacío, porque su página devuelve null) se esconde con CSS y no deja ni el hueco del relleno. */}
        <div className="pagina-de-ruta p-6 lg:p-8 w-full min-w-0 page-transition animate-fadeInUp">
          {children}
        </div>
        {/* Las aplicaciones que se quedan abiertas (Cold Calling, Correo): se ocultan colocándolas en absoluto dentro de `main`, sin altura ni
            espacio, para conservar la posición del scroll. Ver components/layout/AppsPersistentes.tsx */}
        <AppsPersistentes perfil={profile} />
      </main>
      <Toaster position="top-right" richColors />
      {/* Correo nuevo y noticias del equipo, abajo a la derecha, en cualquier pantalla. Fuera del recuadro animado de arriba a propósito:
          ahí dentro `fixed` sería relativo a ese recuadro y no a la ventana */}
      <AvisosEnVivo perfil={profile} />
    </div>
  )
}

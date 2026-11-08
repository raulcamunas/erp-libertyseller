import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppsPersistentes } from '@/components/layout/AppsPersistentes'
import { AvisosEnVivo } from '@/components/avisos/AvisosEnVivo'
import { DockDelChat } from '@/components/chat/DockDelChat'
import { exigirChat } from '@/lib/chat/acceso'
import { AparienciaProvider } from '@/components/tareas-clientes/AparienciaProvider'
import { leerApariencias } from '@/lib/tareas-clientes/apariencia-servidor'
import { RegistroDeActividad } from '@/components/actividad/RegistroDeActividad'
import { debeCerrarseLaSesion, limiteDeInactividadMin } from '@/lib/actividad/inactividad'
import { ultimoEventoDe } from '@/lib/actividad/inactividad-servidor'
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

  // LA SESIÓN DE UN EMPLEADO CADUCA POR INACTIVIDAD (lib/actividad/inactividad.ts). Esta es la capa del servidor: la de un
  // navegador que se cerró, o de un ordenador que durmió, y la persona vuelve a abrir el ERP. Si pasó más del límite desde su
  // última actividad real, no entra: /auth/inactividad le cierra la sesión y le lleva al inicio de sesión. Solo a empleados, y
  // si no se sabe cuándo fue la última actividad (la tabla no existe, la base no contesta) no se echa a nadie.
  const limiteInactividadMin = limiteDeInactividadMin(process.env.INACTIVIDAD_MINUTOS)
  if (profile.role === 'employee') {
    const ultimoEventoMs = await ultimoEventoDe(user.id)
    const inicio = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : Number.NaN
    if (
      debeCerrarseLaSesion({
        rol: profile.role,
        ahoraMs: Date.now(),
        ultimoEventoMs,
        inicioDeSesionMs: Number.isFinite(inicio) ? inicio : null,
        limiteMin: limiteInactividadMin,
      })
    ) {
      redirect('/auth/inactividad')
    }
  }

  // El chat a mano en cualquier pantalla (un dock pequeño y ampliable): solo para quien tiene el chat
  const [puedeChat, apariencias] = await Promise.all([exigirChat().then((p) => p.ok), leerApariencias()])

  return (
    <AparienciaProvider inicial={apariencias.mapa} disponibleAlInicio={apariencias.disponible} nombresIniciales={apariencias.nombres}>
      <div className="min-h-screen bg-[var(--bg-color)] flex relative">
        {/* El rol y el nombre ya los tiene el servidor: con ellos la barra pinta desde el primer momento el menú de quien es, sin esperar a preguntarlo */}
        <AppSidebar perfil={{ id: profile.id, role: profile.role, email: profile.email, full_name: profile.full_name }} />
        {/* min-w-0: sin esto, un hijo ancho (una tabla de muchas columnas)
            estira el main y arrastra toda la página en horizontal, barra
            lateral incluida. Con esto, quien scrollea es la propia tabla.
            El margen izquierdo es lo que ocupa la barra: `--lat-ancho` lo escribe ella (16rem abierta, 4,5rem plegada) y, hasta que lo escribe, vale 16rem. */}
        <main className="flex-1 min-w-0 lg:ml-[var(--lat-ancho,16rem)] lg:mr-[var(--dock-ancho,0px)] transition-all duration-500 ease-in-out min-h-screen pt-16 lg:pt-0 relative z-10 [&:has([data-app-persistente])_.pagina-de-ruta]:hidden">
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
        {puedeChat && <DockDelChat />}
        {/* El registro de actividad: no pinta nada y solo se monta para los empleados. Lo lee quien supervisa en /dashboard/actividad */}
        {profile.role === 'employee' && <RegistroDeActividad limiteMin={limiteInactividadMin} />}
      </div>
    </AparienciaProvider>
  )
}

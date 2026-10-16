import { redirect } from 'next/navigation'
import { Logo } from '@/components/ui/Logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { identificadorValido, redireccionPermitida } from '@/lib/mcp/consentimiento'
import { ROLES_PERMITIDOS } from '@/lib/mcp/auth'
import { BotonesConsentimiento } from './BotonesConsentimiento'

/**
 * LA PANTALLA EN LA QUE UN ADMINISTRADOR AUTORIZA A CLAUDE A USAR EL ERP.
 *
 * Supabase manda aquí a la persona (con `?authorization_id=`) cuando Claude pide
 * conectarse al conector MCP. Vive bajo /auth/ porque middleware.ts deja pasar esa
 * carpeta sin sesión: si no hay sesión, la propia página manda a iniciarla y
 * vuelve después a esta misma dirección.
 *
 * TRES COSAS QUE SE COMPRUEBAN ANTES DE OFRECER «PERMITIR»:
 *
 *   1. Que quien está delante es administrador. El conector es solo del equipo; a
 *      cualquier otro rol se le enseña por qué no, y solo puede cancelar.
 *   2. Que la aplicación vuelve a Claude. Supabase deja registrarse a cualquier
 *      aplicación con el nombre que quiera, así que el nombre no prueba nada: lo
 *      que cuenta es a dónde se devuelve el código.
 *   3. Que la solicitud existe. Caduca a los diez minutos.
 *
 * Qué se concede lo dice la pantalla con todas las letras: de momento, LEER.
 */
export const dynamic = 'force-dynamic'

function Marco({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="mb-8">
        <Logo width={200} height={60} />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="heading-medium text-white">{titulo}</CardTitle>
          {descripcion && <CardDescription>{descripcion}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  )
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const id = identificadorValido(searchParams.authorization_id)
  if (!id) {
    return (
      <Marco titulo="Enlace no válido">
        <p className="text-sm text-white/70">
          Esta dirección no es una solicitud de conexión. Vuelve a Claude y pulsa «Conectar» otra vez.
        </p>
      </Marco>
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent(`/auth/consent?authorization_id=${id}`)}`)
  }

  const { data: perfil } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const rol = (perfil as { role: string } | null)?.role ?? null
  const esDelEquipo = rol !== null && ROLES_PERMITIDOS.includes(rol)

  const { data: detalles, error } = await supabase.auth.oauth.getAuthorizationDetails(id)
  if (error || !detalles) {
    return (
      <Marco titulo="Esta solicitud ya no vale">
        <p className="text-sm text-white/70">
          Ha caducado o ya se ha usado. Vuelve a Claude y pulsa «Conectar» otra vez.
        </p>
      </Marco>
    )
  }

  // Si ya había consentido antes, Supabase devuelve a dónde volver: se vuelve, pero
  // solo si es Claude
  if (typeof detalles.redirect_url === 'string' && detalles.redirect_url !== '') {
    if (redireccionPermitida(detalles.redirect_url, { conConsulta: true }).permitida) {
      redirect(detalles.redirect_url)
    }
  }

  // El tipo de la versión instalada no declara `redirect_uri`, pero la respuesta lo
  // trae (lo documenta Supabase). Si no viniera, NO se puede comprobar a dónde se
  // devuelve el código, y sin comprobarlo no se ofrece «Permitir».
  const redirectUri = (detalles as { redirect_uri?: string }).redirect_uri
  const destino = redireccionPermitida(redirectUri)

  if (!esDelEquipo) {
    return (
      <Marco titulo="Solo para el equipo" descripcion={`Has iniciado sesión como ${user.email ?? 'otro usuario'}`}>
        <p className="text-sm text-white/70">
          Este conector es solo para los administradores de Liberty Seller. Tu cuenta no puede usarlo.
        </p>
        <BotonesConsentimiento authorizationId={id} puedeAprobar={false} />
      </Marco>
    )
  }

  if (!destino.permitida) {
    return (
      <Marco titulo="Esta aplicación no es Claude">
        <p className="text-sm text-white/70">{destino.motivo}</p>
        <p className="text-sm text-white/70">
          No se ha dado ningún acceso. Si no esperabas esta solicitud, cancélala y avisa al equipo.
        </p>
        <BotonesConsentimiento authorizationId={id} puedeAprobar={false} />
      </Marco>
    )
  }

  return (
    <Marco
      titulo="Conectar Claude con el ERP"
      descripcion={`Sesión de ${user.email ?? 'tu cuenta'} · la aplicación se llama «${detalles.client.name}»`}
    >
      <div className="text-sm text-white/80 space-y-2">
        <p>
          Claude podrá <strong>consultar</strong> el ERP de Liberty Seller con tu usuario:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-white/70">
          <li>la lista de clientes y el catálogo de cada uno</li>
          <li>las incidencias de cumplimiento que pone Amazon a sus listings</li>
          <li>el historial de cambios de precio y stock enviados</li>
          <li>el estado de los procesos automáticos</li>
        </ul>
        <p>
          <strong>No podrá cambiar nada</strong> en el ERP ni en las cuentas de Amazon de los clientes.
        </p>
        <p className="text-white/50">Volverás a: {destino.destino}</p>
      </div>
      <BotonesConsentimiento authorizationId={id} puedeAprobar />
    </Marco>
  )
}

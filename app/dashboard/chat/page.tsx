import { ChatApp } from '@/components/chat/ChatApp'

export const dynamic = 'force-dynamic'

/** `?canal=<id>` abre ese canal (los avisos de la campana y del móvil llevan aquí) */
export default function PaginaDelChat({ searchParams }: { searchParams: { canal?: string } }) {
  const canal = typeof searchParams.canal === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.canal) ? searchParams.canal : null
  return <ChatApp canalInicial={canal} />
}

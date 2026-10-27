import { createServiceClient } from '@/lib/supabase/service'
import { publicarBriefing } from '@/lib/briefing/servidor'
import { diaDeMadrid } from '@/lib/correo/secuencias/fechas'
import { urlBaseApp } from '@/lib/url-app'
import { HERRAMIENTAS_BRIEFING, INSTRUCCIONES_BRIEFING, type ContextoBriefing } from './briefing'
import { crearLimitador } from './limite'
import { crearManejadorMcp } from './manejador'
import type { UsuarioMcp } from './auth'

/**
 * EL CONECTOR DEL BRIEFING, CON SUS DEPENDENCIAS DE VERDAD.
 * SOLO SERVIDOR. Lo importa app/api/mcp/briefing/[enlace]/route.ts, que es quien comprueba el enlace secreto ANTES de llegar aquí: este manejador ya no
 * autentica a nadie (el enlace es la llave), solo frena el ritmo, mira el origen y el tamaño y habla MCP. Lo explicado de la herramienta está en briefing.ts.
 */

export const VERSION_CONECTOR_BRIEFING = '1.0.0'

/** Quien llama por el enlace no es una persona: no hay sesión ni rol, y el freno de ritmo cuenta todas las llamadas del enlace juntas */
const USUARIO_DEL_ENLACE: UsuarioMcp = { id: 'enlace-del-briefing', email: null, rol: 'enlace', clienteOAuth: 'enlace' }

/** 30 llamadas por minuto: la rutina hace tres (initialize, tools/list y publicar) una vez al día */
const limitador = crearLimitador({ maximo: 30, ventanaMs: 60_000 })

export const manejadorDelBriefing = crearManejadorMcp<ContextoBriefing>({
  baseUrl: urlBaseApp,
  supabaseUrl: () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  autenticar: async () => ({ ok: true, usuario: USUARIO_DEL_ENLACE }),
  limitador,
  entornoDe: () => ({
    ctx: {
      publicar: (dia, briefing) => publicarBriefing(createServiceClient(), { dia, briefing }),
      hoy: () => diaDeMadrid(Date.now()),
    },
    entorno: {
      nombreServidor: 'liberty-seller-briefing',
      tituloServidor: 'Briefing de Liberty Seller',
      version: VERSION_CONECTOR_BRIEFING,
      instrucciones: INSTRUCCIONES_BRIEFING,
      herramientas: HERRAMIENTAS_BRIEFING,
      // Solo qué herramienta y cómo salió: nunca el enlace ni lo que se publicó
      alTerminarHerramienta: (info) => console.info(`[mcp-briefing] ${info.nombre} ${info.esError ? 'ERROR' : 'ok'} ${info.ms}ms`),
    },
  }),
})

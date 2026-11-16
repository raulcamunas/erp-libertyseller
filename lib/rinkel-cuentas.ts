import { decryptToken, encryptToken } from '@/lib/amazon/crypto'

/** Para qué se cifra: una contraseña de Rinkel no se descifra si se pega donde se espera otra cosa (el AAD de GCM) */
export const PROPOSITO_RINKEL_CUENTAS = 'rinkel-cuentas-v1'

export const cifrarClave = (plano: string): string => encryptToken(plano, PROPOSITO_RINKEL_CUENTAS)
export const descifrarClave = (guardado: string): string => decryptToken(guardado, PROPOSITO_RINKEL_CUENTAS)

export interface CuentaRinkel {
  id: string
  email: string
  /** Nunca viaja la contraseña en la lista: solo si hay una guardada */
  tiene_clave: boolean
  notas: string | null
  position: number | null
}

const texto = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.trim().slice(0, max) : null)

/** PURA. Valida lo que llega de la pantalla. La clave: undefined = no tocarla; '' = borrarla */
export function validarCuenta(c: Record<string, unknown>, nueva: boolean): { ok: true; email?: string; notas?: string | null; clave?: string } | { ok: false; error: string } {
  const out: { email?: string; notas?: string | null; clave?: string } = {}
  if (nueva || 'email' in c) {
    const email = texto(c.email, 320)
    if (!email || email.length < 3 || !email.includes('@')) return { ok: false, error: 'Pon un correo válido' }
    out.email = email
  }
  if ('notas' in c) out.notas = texto(c.notas, 500) || null
  if (typeof c.clave === 'string') {
    if (c.clave.length > 200) return { ok: false, error: 'La contraseña es demasiado larga' }
    out.clave = c.clave
  }
  return { ok: true, ...out }
}

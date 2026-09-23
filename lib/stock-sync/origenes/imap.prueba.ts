import { conectorImap } from '@/lib/stock-sync/origenes/imap'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

console.log('\n=== ESTA REGISTRADO ===')
ok('su id es imap', conectorImap.id, 'imap')
ok('esta construido', conectorImap.construido, true)
ok('declara secreto', Boolean(conectorImap.secreto), true)
ok('es explorador de mensajes', conectorImap.explorador, 'mensajes')

console.log('\n=== LOS CAMPOS OBLIGATORIOS SON LOS QUE NO SE PUEDEN ADIVINAR ===')
const req = conectorImap.campos.filter((c) => c.requerido).map((c) => c.clave)
ok('solo host y usuario', req, ['host', 'usuario'])
ok('todos tienen ayuda', conectorImap.campos.every((c) => c.ayuda.length > 10), true)

console.log('\n=== NINGUN CAMPO GUARDA LA CONTRASENA ===')
// origen_config es texto plano y viaja al navegador: una contrasena ahi seria
// una contrasena publicada.
const sospechosos = conectorImap.campos.filter((c) =>
  /contrase|password|secreto|clave/i.test(c.clave + c.etiqueta)
)
ok('ningun campo de contrasena', sospechosos.map((c) => c.clave), [])

async function main() {
  console.log('\n=== FALLA BIEN SIN CONFIGURACION ===')
  for (const [nombre, config, esperado] of [
    ['sin host', {}, 'servidor'],
    ['sin usuario', { host: 'imap.hostinger.com' }, 'usuario'],
  ] as Array<[string, Record<string, unknown>, string]>) {
    try {
      await conectorImap.comprobar({ config, perfil: 'prueba' } as never)
      fallos++; console.log(`  FALLA ${nombre}: no ha protestado`)
    } catch (e) {
      const m = (e as Error).message.toLowerCase()
      const bien = m.includes(esperado)
      if (!bien) fallos++
      console.log(`  ${bien ? 'OK  ' : 'FALLA'} ${nombre}: «${(e as Error).message.slice(0, 60)}»`)
    }
  }

  console.log('\n=== SIN CONTRASENA NO REVIENTA, LO DICE ===')
  {
    const r = await conectorImap.comprobar({
      config: { host: 'imap.hostinger.com', usuario: 'stock@libertyseller.com' },
      perfil: 'prueba',
    } as never)
    ok('no ok', r.ok, false)
    ok('dice que falta la contrasena', r.mensaje.toLowerCase().includes('contraseña'), true)
    ok('candidatos vacio, no undefined', r.candidatos, [])
  }

    console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
    process.exit(fallos === 0 ? 0 : 1)
  }

  main()

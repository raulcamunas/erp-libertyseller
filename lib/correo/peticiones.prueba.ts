import { alEnviarseCorreoDeLead, avisarCorreoEnviadoALead, escucharPeticiones, pedirAlCorreo, reiniciarPeticiones, type PeticionAlCorreo } from './peticiones'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const redactar = (para: string): PeticionAlCorreo => ({ tipo: 'redactar', para })

console.log('\n=== con la pantalla de Correo ya montada, el encargo llega al momento ===')
{
  reiniciarPeticiones()
  const recibidas: PeticionAlCorreo[] = []
  const parar = escucharPeticiones((p) => recibidas.push(p))
  pedirAlCorreo(redactar('a@x.es'))
  ok('lo recibe', recibidas.length === 1 && recibidas[0].tipo === 'redactar')
  parar()
  pedirAlCorreo(redactar('b@x.es'))
  ok('si deja de escuchar, ya no le llegan', recibidas.length === 1)
}

console.log('\n=== si todavía no está montada, el encargo espera ===')
{
  reiniciarPeticiones()
  pedirAlCorreo(redactar('a@x.es'))
  const recibidas: PeticionAlCorreo[] = []
  const parar = escucharPeticiones((p) => recibidas.push(p))
  ok('lo recibe al ponerse a escuchar', recibidas.length === 1 && recibidas[0].tipo === 'redactar' && recibidas[0].para === 'a@x.es')
  parar()
  const otras: PeticionAlCorreo[] = []
  const parar2 = escucharPeticiones((p) => otras.push(p))
  ok('y solo una vez: no se repite al volver a montarse', otras.length === 0)
  parar2()
}

console.log('\n=== de varios encargos sin pantalla, vale el último ===')
{
  reiniciarPeticiones()
  pedirAlCorreo(redactar('a@x.es'))
  pedirAlCorreo({ tipo: 'hilo', buzonId: 'b', hiloId: 'h' })
  const recibidas: PeticionAlCorreo[] = []
  escucharPeticiones((p) => recibidas.push(p))
  ok('llega el último', recibidas.length === 1 && recibidas[0].tipo === 'hilo')
}

console.log('\n=== el camino de vuelta ===')
{
  reiniciarPeticiones()
  const vistos: string[] = []
  const parar = alEnviarseCorreoDeLead((e) => vistos.push(e.leadId))
  avisarCorreoEnviadoALead({ leadId: 'l1', asunto: 'Hola', cuando: new Date().toISOString() })
  ok('Cold Calling se entera', vistos.length === 1 && vistos[0] === 'l1')
  parar()
  avisarCorreoEnviadoALead({ leadId: 'l2', asunto: 'Hola', cuando: new Date().toISOString() })
  ok('y deja de enterarse al desmontarse', vistos.length === 1)
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)

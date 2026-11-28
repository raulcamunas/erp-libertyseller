import { cambioDeValoracion } from './valoraciones'
let f = 0
const ok = (n: string, c: boolean, x?: unknown) => (c ? console.log('✓', n) : (f++, console.error('✗', n, x ?? '')))
ok('baja 0,2', /baja de 4.5 a 4.3/.test(cambioDeValoracion({ valoracion: 4.3, num: 100 }, { valoracion: 4.5, num: 100 }) ?? ''))
ok('nuevas y baja un poco', /negativa/.test(cambioDeValoracion({ valoracion: 4.45, num: 102 }, { valoracion: 4.5, num: 100 }) ?? ''))
ok('sube: nada', cambioDeValoracion({ valoracion: 4.6, num: 102 }, { valoracion: 4.5, num: 100 }) === null)
ok('sin dato: nada', cambioDeValoracion({ valoracion: null, num: 1 }, { valoracion: 4.5, num: 1 }) === null)
if (f) process.exit(1)

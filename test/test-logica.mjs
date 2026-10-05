/* Tests del núcleo de cálculo — corre con: node test/test-logica.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const L = require('../logica.js');

let pass = 0, fail = 0;
function eq(desc, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pass++; console.log('  ok  ' + desc); }
  else { fail++; console.log('FAIL  ' + desc + '\n      esperado: ' + JSON.stringify(esperado) + '\n      real:     ' + JSON.stringify(real)); }
}

const R = L.REGLAS_POR_DEFECTO;

console.log('\n— subsidio de hijos (1→200k, 2→400k, ≥3→600k) —');
eq('1 hijo', L.subsidioHijos(1, R), 200000);
eq('2 hijos', L.subsidioHijos(2, R), 400000);
eq('3 hijos', L.subsidioHijos(3, R), 600000);
eq('5 hijos (tope)', L.subsidioHijos(5, R), 600000);
eq('0 hijos', L.subsidioHijos(0, R), 0);

console.log('\n— roles —');
eq('Gerente general', L.interpretarRol('Gerente general'), 'gerente');
eq('ADMINISTRATIVO', L.interpretarRol('ADMINISTRATIVO'), 'admin');
eq('Operario de limpieza', L.interpretarRol('Operario de limpieza'), 'operario');
eq('Operador de cámara', L.interpretarRol('Operador de cámara'), 'operario');
eq('Cajero (desconocido)', L.interpretarRol('Cajero'), null);
eq('vacío', L.interpretarRol(''), null);

console.log('\n— números es-CO —');
eq('"1.500.000"', L.aNumero('1.500.000'), 1500000);
eq('"$ 200.000"', L.aNumero('$ 200.000'), 200000);
eq('"8,5"', L.aNumero('8,5'), 8.5);
eq('"8.5"', L.aNumero('8.5'), 8.5);
eq('"(50.000)" negativo', L.aNumero('(50.000)'), -50000);
eq('número 160', L.aNumero(160), 160);
eq('vacío', L.aNumero(''), 0);

console.log('\n— liquidación gerente 40h, 1 hijo —');
const ger = L.liquidarEmpleado(
  { nombre: 'Ana Pérez', cc: '100000001', rol: 'gerente', hijos: 1, horas: 40 }, R);
eq('valor hora', ger.valorHora, 100000);
eq('base', ger.base, 4000000);
eq('subsidio', ger.subsidio, 200000);
eq('total ingresos', ger.totalIngresos, 4200000);
eq('salud 4%', ger.salud, 160000);
eq('pensión 4%', ger.pension, 160000);
eq('total descuentos', ger.totalDescuentos, 320000);
eq('neto', ger.neto, 3880000);

console.log('\n— recargos (valores por defecto: extra 25%, domingo 50%, feriado 100%, nocturno 35%) —');
const ext = L.liquidarEmpleado({ nombre: 'X', rol: 'gerente', horas: 40, extras: 2 }, R);
eq('2h extra gerente = 250.000', ext.extras, 250000);
const dom = L.liquidarEmpleado({ nombre: 'X', rol: 'operario', horas: 160, domingos: 1 }, R);
eq('1 domingo operario = 720.000', dom.dominicales, 720000);
const fer = L.liquidarEmpleado({ nombre: 'X', rol: 'admin', horas: 160, feriados: 1 }, R);
eq('1 feriado admin = 1.280.000', fer.festivos, 1280000);
const noc = L.liquidarEmpleado({ nombre: 'X', rol: 'admin', horas: 160, nocturnas: 10 }, R);
eq('10h nocturnas admin = 1.080.000', noc.nocturnas, 1080000);

console.log('\n— cesantías por salida —');
const ces = L.clonarReglas(R); ces.cesantias.incluir = true;
const c1 = L.liquidarEmpleado({ nombre: 'X', rol: 'gerente', hijos: 1, horas: 40 }, ces);
eq('8,33% de 4.000.000 = 333.200', c1.cesantias, 333200);
eq('cesantías suman al neto', c1.neto, 3880000 + 333200);
const c2 = L.liquidarEmpleado({ nombre: 'X', rol: 'gerente', horas: 40 }, R);
eq('cesantías desactivadas = 0', c2.cesantias, 0);

console.log('\n— descuentos de libranza/vivienda —');
const lib = L.liquidarEmpleado(
  { nombre: 'X', rol: 'operario', horas: 160, vivienda: 350000, libranza: 200000, otros: 50000 }, R);
eq('base operario 160h = 9.600.000', lib.base, 9600000);
eq('salud', lib.salud, 384000);
eq('pensión', lib.pension, 384000);
eq('total descuentos = 384k+384k+350k+200k+50k', lib.totalDescuentos, 1368000);

console.log('\n— detección de encabezados —');
const h1 = ['Nombre Completo', 'C.C.', 'Cargo', 'N° Hijos', 'Horas Trabajadas', 'Horas extras'];
const d1 = L.detectarTabla([h1, ['Ana', '1', 'Gerente', 2, 160, 4]]);
eq('detecta nombre', d1.mapeo.nombre, 0);
eq('detecta cc', d1.mapeo.cc, 1);
eq('detecta rol', d1.mapeo.rol, 2);
eq('detecta hijos', d1.mapeo.hijos, 3);
eq('detecta horas', d1.mapeo.horas, 4);
eq('detecta extras (sin confundir con horas)', d1.mapeo.extras, 5);
eq('sin faltantes', d1.faltantes, []);

const h2 = ['APELLIDOS Y NOMBRES', 'N° DOCUMENTO', 'CARGO', 'HRS', 'HIJOS A CARGO'];
const d2 = L.detectarTabla([[], [], h2, ['Luis', '2', 'Administrador', 160, 3]]);
eq('encabezado en fila 3', d2.filaEncabezado, 2);
eq('detecta apellidos y nombres', d2.mapeo.nombre, 0);
eq('detecta cargo → rol', d2.mapeo.rol, 2);
eq('faltantes vacíos', d2.faltantes, []);

const d3 = L.detectarTabla([['Cualquier cosa', 'Otra'], ['a', 'b']]);
eq('sin encabezados reconocidos → faltan nombre y rol', d3.faltantes, ['nombre', 'rol']);

console.log('\n— procesamiento de filas —');
const filas = [
  ['Ana Pérez', '100000001', 'Gerente', 1, 40],
  ['EJEMPLO — borrar', '0', 'Admin', 0, 0],
  ['', '', 'Admin', 0, 0],
  ['Pedro Ruiz', '100000002', 'Cajero', 1, 80],
  ['Luisa Mora', '100000003', 'Operario', 4, 160]
];
const mapeo = { nombre: 0, cc: 1, rol: 2, hijos: 3, horas: 4 };
const res = L.procesarFilas(filas, mapeo, R);
eq('liquidados: Ana + Luisa', res.empleados.length, 2);
eq('Ana neto', res.empleados[0].neto, 3880000);
eq('Luisa subsidio tope 600k', res.empleados[1].subsidio, 600000);
eq('fila de ejemplo omitida', res.omitidas, 1);
eq('2 observaciones (fila vacía + rol Cajero)', res.observaciones.length, 2);

console.log('\n— hoja de salida —');
const hoja = L.hojaSalida(res.empleados, { origen: 'test.xlsx', fecha: '01/01/2026' });
eq('fila encabezados = 23 columnas', hoja[3].length, 23);
eq('fila de totales existe', hoja[hoja.length - 1][0], 'TOTALES');
eq('neto total = suma', hoja[hoja.length - 1][22],
  res.empleados[0].neto + res.empleados[1].neto);
eq('columnas dinero: total ingresos', hoja[hoja.length - 1][14],
  res.empleados[0].totalIngresos + res.empleados[1].totalIngresos);

console.log('\n— resumen —');
const r = L.resumen(res.empleados);
eq('empleados', r.empleados, 2);
eq('neto coincide con hoja', r.neto, hoja[hoja.length - 1][22]);

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLAS: ' + fail) + ' · pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);

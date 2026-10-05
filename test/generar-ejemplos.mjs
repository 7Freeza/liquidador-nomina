/* Genera archivos de ejemplo para probar el sistema — node test/generar-ejemplos.mjs */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const XLSX = require('../libs/xlsx.full.min.js');

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const carpeta = path.join(raiz, 'ejemplos');
fs.mkdirSync(carpeta, { recursive: true });

function guardar(wb, nombre) {
  const out = path.join(carpeta, nombre);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(out, buf);
  console.log('  creado:', nombre);
}

/* 1) Formato estándar (igual que la plantilla) — 8 trabajadores */
{
  const filas = [
    ['Nombre completo', 'Cédula', 'Rol', 'Hijos', 'Horas', 'Horas extras',
      'Domingos', 'Festivos', 'Nocturnas', 'Primas', 'Vivienda',
      'Libranza / préstamo', 'Otros descuentos'],
    ['Ana Lucía Pérez', '100000001', 'Gerente', 1, 160, 4, 1, 0, 0, 0, 0, 0, 0],
    ['Carlos Andrés Gómez', '100000002', 'Admin', 3, 176, 0, 0, 1, 10, 150000, 350000, 200000, 0],
    ['Marta Ruiz', '100000003', 'Operario', 4, 160, 8, 2, 0, 20, 0, 0, 0, 50000],
    ['Jorge Iván Castro', '100000004', 'Operario', 0, 152, 0, 0, 0, 0, 0, 0, 0, 0],
    ['EJEMPLO — borrar fila', '0', 'Admin', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Diana Marcela Ortiz', '100000005', 'Gerente', 2, 168, 12, 1, 1, 30, 200000, 0, 0, 0],
    ['Pedro Nel Sánchez', '100000006', 'ADMINISTRATIVO', 5, 160, 0, 0, 0, 0, 0, 0, 0, 0],
    ['Laura Sofía Mejía', '100000007', 'Operario', 2, '160', '4', '1', 0, 0, 0, 0, 0, 0],
    ['Sin Cédula Aquí', '', 'Operario', 1, 80, 0, 0, 0, 0, 0, 0, 0, 0]
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 7 }, { wch: 7 }, { wch: 8 },
    { wch: 10 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  guardar(wb, 'nomina_marzo_2026.xlsx');
}

/* 2) Encabezados de banco (distintos a la plantilla) — prueba la detección */
{
  const filas = [
    ['EMPLEADO', 'IDENTIFICACIÓN', 'CARGO', 'HRS LABORADAS', 'HIJOS A CARGO',
      'HORAS EXTRAS', 'DOM. TRABAJADOS', 'FESTIVOS', 'NOCTURNAS',
      'PRIMA SERVICIOS', 'CUOTA VIVIENDA', 'DESCUENTO PRESTAMO', 'OTROS DESCUENTOS'],
    ['Roberto Fuentes', '80000001', 'Gerente General', '160', 2, 6, 1, 1, 8, 0, 0, 0, 0],
    ['Claudia Herrera', '80000002', 'Auxiliar Administrativo', 176, 1, 0, 0, 0, 0, 0, 180000, 0, 0],
    ['Óscar Villalba', '80000003', 'Operario de mantenimiento', 160, 0, 16, 2, 0, 40, 0, 0, 120000, 30000],
    ['Patricia Díaz', '80000004', 'Operador', 144, 3, 0, 0, 1, 0, 90000, 0, 0, 0],
    ['Alfonso Méndez', '80000005', 'Jefe de área', 160, 4, 4, 1, 0, 12, 0, 0, 0, 0]
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 26 }, { wch: 13 }, { wch: 14 },
    { wch: 13 }, { wch: 14 }, { wch: 10 }, { wch: 11 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Nómina');
  guardar(wb, 'banco_enero_2026.xlsx');
}

/* 3) Archivo roto a propósito (encabezados que no son de nómina) */
{
  const filas = [
    ['Concepto', 'Valor', 'Fecha'],
    ['Ingresos', 1000, '2026-01-01'],
    ['Egresos', 400, '2026-01-02']
  ];
  const ws = XLSX.utils.aoa_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  guardar(wb, 'reporte_caja_no_es_nomina.xlsx');
}

console.log('\nListos en:', carpeta);

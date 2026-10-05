/* =====================================================================
   logica.js — Núcleo de cálculo de nómina
   Corre en el navegador (script clásico) y en Node (module.exports).
   Sin dependencias: solo funciones puras.
   ===================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NominaLogica = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- Reglas por defecto (las del problema) ---------------- */
  var REGLAS_POR_DEFECTO = {
    tarifas: { gerente: 100000, admin: 80000, operario: 60000 },
    subsidio_hijo: 200000,   // por hijo
    tope_hijos: 3,           // 3 o más hijos => tope
    jornada_diaria: 8,       // horas que equivalen 1 domingo / 1 feriado trabajado
    recargos: { extra: 25, domingo: 50, feriado: 100, nocturno: 35 }, // %
    descuentos: { salud: 4, pension: 4, solidaridad: 0 },             // % sobre salario base
    cesantias: { incluir: false, porcentaje: 8.33 }                   // por salida
  };

  /* -------- Sinónimos de encabezados (cómo puede venir el Excel) --------- */
  var COLUMNAS = {
    nombre: ['nombre', 'nombres', 'nombre completo', 'apellidos y nombres',
      'apellidos nombres', 'trabajador', 'empleado', 'persona', 'nombre del empleado'],
    cc: ['cc', 'c c', 'cedula', 'cedula de ciudadania', 'identificacion', 'documento',
      'numero de documento', 'n documento', 'nro documento', 'no documento',
      'num documento', 'doc', 'identificacion documento'],
    rol: ['rol', 'cargo', 'posicion', 'funcion', 'grado', 'categoria'],
    hijos: ['hijos', 'numero de hijos', 'num hijos', 'n hijos', 'cantidad de hijos',
      'hijos a cargo', 'nhijos', 'hijos mayores'],
    horas: ['horas', 'horas trabajadas', 'horas normales', 'horas base', 'horas laboradas',
      'hr', 'hrs', 'horas del mes'],
    extras: ['horas extras', 'horas extra', 'extra', 'extras', 'h extra', 'h extras',
      'he', 'horas extras trabajadas'],
    domingos: ['domingos', 'domingos trabajados', 'dom', 'dominical', 'dominicales',
      'domingos laborados'],
    feriados: ['feriados', 'festivos', 'feriados trabajados', 'festivos trabajados',
      'feriado', 'festivo'],
    nocturnas: ['nocturnas', 'horas nocturnas', 'nocturno', 'nocturnas trabajadas',
      'nocturnidad', 'horas de noche'],
    prima: ['prima', 'primas', 'prima de servicios', 'primas pagadas', 'prima extralegal'],
    vivienda: ['vivienda', 'prestamo vivienda', 'credito vivienda', 'hipoteca',
      'cuota vivienda', 'descuento vivienda'],
    libranza: ['libranza', 'prestamo', 'prestamo bancario', 'credito personal', 'banco',
      'cuota banco', 'descuento prestamo', 'libranzas'],
    otros: ['otros descuentos', 'otros', 'descuentos varios', 'descuento otros',
      'varios', 'otro descuento']
  };

  var CAMPOS_REQUERIDOS = ['nombre', 'rol'];

  /* -------------------------- Utilidades -------------------------- */

  function normalizar(txt) {
    if (txt === null || txt === undefined) return '';
    return String(txt)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // quita tildes
      .replace(/[^\w\s]/g, ' ')          // quita puntuación
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Interpreta números como los escribe Excel en es-CO: "1.500.000", "$ 200.000", "8,5", "(50.000)"
  function aNumero(valor) {
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
    if (valor === null || valor === undefined) return 0;
    var original = String(valor);
    var negativo = /\(.*\)/.test(original);
    var s = original.replace(/[^\d.,-]/g, '').trim();
    if (!s) return 0;

    var tieneComa = s.indexOf(',') !== -1;
    var tienePunto = s.indexOf('.') !== -1;

    if (tieneComa && tienePunto) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (tieneComa) {
      var pc = s.split(',');
      s = (pc.length === 2 && pc[1].length <= 2) ? pc[0] + '.' + pc[1] : s.replace(/,/g, '');
    } else if (tienePunto) {
      // "1.234.567" o "1.500" (miles es-CO) vs "8.5" (decimal)
      if (s.split('.').length > 2) s = s.replace(/\./g, '');
      else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    }

    var n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return negativo ? -Math.abs(n) : n;
  }

  function interpretarRol(valor) {
    var v = normalizar(valor);
    if (!v) return null;
    if (v.indexOf('gerent') !== -1) return 'gerente';
    if (v.indexOf('admin') !== -1) return 'admin';
    if (v.indexOf('operar') !== -1 || v.indexOf('operad') !== -1 || v === 'ope' ||
        v.indexOf('operativ') !== -1 || v.indexOf('operario') !== -1) return 'operario';
    return null;
  }

  function subsidioHijos(hijos, reglas) {
    var n = Math.max(0, Math.floor(aNumero(hijos)));
    var tope = Math.max(0, Math.floor(aNumero(reglas.tope_hijos)));
    var valor = aNumero(reglas.subsidio_hijo);
    return Math.min(n, tope) * valor;
  }

  function num(v) { var n = aNumero(v); return n < 0 ? 0 : n; } // cantidades nunca negativas

  /* ------------------ Detección de encabezado/columnas ------------------ */

  function puntuarEncabezado(fila) {
    var puntos = 0;
    for (var i = 0; i < fila.length; i++) {
      var celda = normalizar(fila[i]);
      if (!celda) continue;
      var celdaLarga = celda.length >= 3; // "a", "b" no cuentan como contención
      for (var campo in COLUMNAS) {
        if (!COLUMNAS.hasOwnProperty(campo)) continue;
        var sin = COLUMNAS[campo];
        var coincide = false;
        for (var j = 0; j < sin.length; j++) {
          var s = sin[j];
          if (celda === s) { coincide = true; break; }
          if (celdaLarga && s.length >= 3 &&
              (celda.indexOf(s) !== -1 || s.indexOf(celda) !== -1)) { coincide = true; break; }
        }
        if (coincide) { puntos++; break; } // cada celda suma como máximo 1
      }
    }
    return puntos;
  }

  // Busca en los primeros renglones cuál es el de encabezados y qué columna es cada campo.
  function detectarTabla(aoa) {
    var mejor = { fila: -1, puntos: -1 };
    var limite = Math.min(aoa.length, 15);
    for (var f = 0; f < limite; f++) {
      var p = puntuarEncabezado(aoa[f] || []);
      if (p > mejor.puntos) mejor = { fila: f, puntos: p };
    }
    // Si ningún renglón se reconoce, se toma el primero como posible encabezado:
    // así el mapeo manual del usuario sigue teniendo columnas contra dónde elegir.
    var fila = mejor.puntos >= 2 ? mejor.fila : 0;
    var headers = aoa[fila] || [];
    var mapeo = mapeoPorEncabezado(headers);
    return {
      filaEncabezado: fila,
      headers: headers.map(function (h) { return h === null || h === undefined ? '' : String(h).trim(); }),
      mapeo: mapeo,
      faltantes: faltantesDe(mapeo)
    };
  }

  function mapeoPorEncabezado(headers) {
    var mapeo = {};
    var usado = {};
    var norm = headers.map(normalizar);
    var campos = Object.keys(COLUMNAS);

    // PASO 1: igualdad exacta (evita que "Horas extras" caiga en "Horas")
    campos.forEach(function (campo) {
      var sin = COLUMNAS[campo];
      for (var i = 0; i < norm.length; i++) {
        if (usado[i] || !norm[i]) continue;
        if (sin.indexOf(norm[i]) !== -1) { mapeo[campo] = i; usado[i] = true; return; }
      }
    });

    // PASO 2: contención (el encabezado contiene el sinónimo o al revés)
    // Solo aplica con textos de 3+ caracteres: evita falsos positivos ("a", "b").
    campos.forEach(function (campo) {
      if (mapeo[campo] !== undefined) return;
      var sin = COLUMNAS[campo];
      for (var i = 0; i < norm.length; i++) {
        if (usado[i] || !norm[i] || norm[i].length < 3) continue;
        var ok = false;
        for (var s = 0; s < sin.length; s++) {
          if (sin[s].length < 3) continue;
          if (norm[i].indexOf(sin[s]) !== -1 || sin[s].indexOf(norm[i]) !== -1) { ok = true; break; }
        }
        if (ok) { mapeo[campo] = i; usado[i] = true; return; }
      }
    });

    return mapeo;
  }

  function faltantesDe(mapeo) {
    var faltan = [];
    for (var i = 0; i < CAMPOS_REQUERIDOS.length; i++) {
      var c = CAMPOS_REQUERIDOS[i];
      if (mapeo[c] === undefined || mapeo[c] === null || mapeo[c] === -1) faltan.push(c);
    }
    return faltan;
  }

  // Mapeo manual del usuario: {campo: 'Encabezado tal cual'} → índice en ESTE archivo
  function mapeoManualAIndice(mapeoManual, headers) {
    var mapeo = {}, faltan = [];
    var normalizados = headers.map(normalizar);
    for (var campo in COLUMNAS) {
      if (!COLUMNAS.hasOwnProperty(campo)) continue;
      var nombre = mapeoManual[campo];
      if (!nombre) continue;
      var idx = normalizados.indexOf(normalizar(nombre));
      if (idx !== -1) mapeo[campo] = idx;
    }
    faltan = faltantesDe(mapeo);
    return { mapeo: mapeo, faltantes: faltan };
  }

  /* ------------------------- Liquidación ------------------------- */

  function liquidarEmpleado(datos, reglas) {
    var R = clonarReglas(reglas);
    var rol = datos.rol;
    var tarifa = R.tarifas[rol];
    if (tarifa === undefined || tarifa === null) throw new Error('Rol sin tarifa: ' + rol);
    var vh = aNumero(tarifa);

    var horas = num(datos.horas);
    var extras = num(datos.extras);
    var domingos = num(datos.domingos);
    var feriados = num(datos.feriados);
    var nocturnas = num(datos.nocturnas);
    var hijos = Math.max(0, Math.floor(aNumero(datos.hijos)));

    var base = horas * vh;
    var vExtras = extras * vh * (1 + aNumero(R.recargos.extra) / 100);
    var vDomingos = domingos * aNumero(R.jornada_diaria) * vh * (1 + aNumero(R.recargos.domingo) / 100);
    var vFeriados = feriados * aNumero(R.jornada_diaria) * vh * (1 + aNumero(R.recargos.feriado) / 100);
    var vNocturnas = nocturnas * vh * (1 + aNumero(R.recargos.nocturno) / 100);
    var prima = num(datos.prima);
    var subsidio = subsidioHijos(hijos, R);
    var cesantias = R.cesantias.incluir ? base * (aNumero(R.cesantias.porcentaje) / 100) : 0;

    var ingresos = base + vExtras + vDomingos + vFeriados + vNocturnas + prima + subsidio + cesantias;

    var salud = base * (aNumero(R.descuentos.salud) / 100);
    var pension = base * (aNumero(R.descuentos.pension) / 100);
    var solidaridad = base * (aNumero(R.descuentos.solidaridad) / 100);
    var vivienda = num(datos.vivienda);
    var libranza = num(datos.libranza);
    var otros = num(datos.otros);
    var totalDesc = salud + pension + solidaridad + vivienda + libranza + otros;

    var neto = ingresos - totalDesc;

    return {
      nombre: String(datos.nombre || '').trim(),
      cc: String(datos.cc === undefined || datos.cc === null ? '' : datos.cc).trim(),
      rol: rol,
      rolTexto: rol.charAt(0).toUpperCase() + rol.slice(1),
      hijos: hijos,
      horas: horas,
      valorHora: r(vh),
      base: r(base),
      extras: r(vExtras),
      dominicales: r(vDomingos),
      festivos: r(vFeriados),
      nocturnas: r(vNocturnas),
      prima: r(prima),
      subsidio: r(subsidio),
      cesantias: r(cesantias),
      totalIngresos: r(ingresos),
      salud: r(salud),
      pension: r(pension),
      solidaridad: r(solidaridad),
      vivienda: r(vivienda),
      libranza: r(libranza),
      otros: r(otros),
      totalDescuentos: r(totalDesc),
      neto: r(neto)
    };
  }

  function r(n) { return Math.round(n); }

  function clonarReglas(reglas) {
    var base = JSON.parse(JSON.stringify(REGLAS_POR_DEFECTO));
    var R = reglas || base;
    var out = {
      tarifas: Object.assign({}, base.tarifas, R.tarifas || {}),
      subsidio_hijo: R.subsidio_hijo !== undefined ? R.subsidio_hijo : base.subsidio_hijo,
      tope_hijos: R.tope_hijos !== undefined ? R.tope_hijos : base.tope_hijos,
      jornada_diaria: R.jornada_diaria !== undefined ? R.jornada_diaria : base.jornada_diaria,
      recargos: Object.assign({}, base.recargos, R.recargos || {}),
      descuentos: Object.assign({}, base.descuentos, R.descuentos || {}),
      cesantias: Object.assign({}, base.cesantias, R.cesantias || {})
    };
    return out;
  }

  /* --------- Procesa las filas de datos de un Excel (después del encabezado) --------- */
  function procesarFilas(filas, mapeo, reglas) {
    var empleados = [];
    var observaciones = [];
    var omitidas = 0;

    if (mapeo.horas === undefined) {
      observaciones.push({ fila: 0, mensaje: 'No se encontró la columna de horas: se toman 0 para todos los trabajadores.' });
    }

    function val(fila, campo) {
      var i = mapeo[campo];
      if (i === undefined || i === null || i === -1) return '';
      return fila[i];
    }

    for (var f = 0; f < filas.length; f++) {
      var fila = filas[f] || [];
      var filaNum = f + 1; // relativa a los datos
      var vacia = fila.every(function (c) {
        return c === null || c === undefined || String(c).trim() === '';
      });
      if (vacia) continue;

      var nombre = String(val(fila, 'nombre') || '').trim();

      if (/^ejemplo/i.test(nombre)) { omitidas++; continue; }
      if (!nombre) {
        observaciones.push({ fila: filaNum, mensaje: 'Fila ' + filaNum + ': sin nombre, se omitió.' });
        continue;
      }

      var rolCrudo = val(fila, 'rol');
      var rol = interpretarRol(rolCrudo);
      if (!rol) {
        observaciones.push({
          fila: filaNum,
          mensaje: 'Fila ' + filaNum + ' (' + nombre + '): rol "' + String(rolCrudo || '').trim() + '" no reconocido, se omitió.'
        });
        continue;
      }

      var cc = val(fila, 'cc');
      if (cc === '' || cc === null || cc === undefined) {
        observaciones.push({ fila: filaNum, mensaje: 'Fila ' + filaNum + ' (' + nombre + '): sin cédula.' });
      }

      var datos = {
        nombre: nombre,
        cc: typeof cc === 'number' ? String(cc) : cc,
        rol: rol,
        hijos: val(fila, 'hijos'),
        horas: val(fila, 'horas'),
        extras: val(fila, 'extras'),
        domingos: val(fila, 'domingos'),
        feriados: val(fila, 'feriados'),
        nocturnas: val(fila, 'nocturnas'),
        prima: val(fila, 'prima'),
        vivienda: val(fila, 'vivienda'),
        libranza: val(fila, 'libranza'),
        otros: val(fila, 'otros')
      };

      empleados.push(liquidarEmpleado(datos, reglas));
    }

    return { empleados: empleados, observaciones: observaciones, omitidas: omitidas };
  }

  /* ------------------ Encabezados y hoja de salida ------------------ */

  var SALIDA_COLUMNAS = [
    'Nombre completo', 'Cédula', 'Rol', 'Hijos', 'Horas', 'Valor hora',
    'Salario base', 'Horas extras', 'Dominicales', 'Festivos', 'Nocturnas',
    'Primas', 'Subsidio hijos', 'Cesantías', 'Total ingresos',
    'Salud EPS', 'Pensión', 'Solidaridad', 'Vivienda', 'Libranza / préstamo',
    'Otros descuentos', 'Total descuentos', 'Neto a pagar'
  ];

  // columnas que llevan formato de miles en el Excel
  var SALIDA_DINERO = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

  function filaSalida(e) {
    return [
      e.nombre, e.cc, e.rolTexto, e.hijos, e.horas, e.valorHora,
      e.base, e.extras, e.dominicales, e.festivos, e.nocturnas,
      e.prima, e.subsidio, e.cesantias, e.totalIngresos,
      e.salud, e.pension, e.solidaridad, e.vivienda, e.libranza,
      e.otros, e.totalDescuentos, e.neto
    ];
  }

  // Fila de totales (misma forma que una fila de datos)
  function filaTotales(empleados) {
    var totales = new Array(SALIDA_COLUMNAS.length).fill(0);
    for (var i = 0; i < empleados.length; i++) {
      var fila = filaSalida(empleados[i]);
      for (var c = 0; c < SALIDA_DINERO.length; c++) {
        var col = SALIDA_DINERO[c];
        var v = fila[col];
        if (typeof v === 'number') totales[col] += v;
      }
      totales[3] += fila[3] || 0; // hijos
      totales[4] += fila[4] || 0; // horas
    }
    var total = SALIDA_COLUMNAS.map(function (_, i) { return totales[i]; });
    total[0] = 'TOTALES';
    total[1] = '';
    total[2] = '';
    return total;
  }

  // Construye la matriz (array de arrays) del extracto de nómina.
  function hojaSalida(empleados, meta) {
    meta = meta || {};
    var filas = [];
    filas.push(['EXTRACTO DE NÓMINA — ' + (meta.origen || 'archivo')]);
    filas.push(['Generado: ' + (meta.fecha || '') + '   ·   Empleados: ' + empleados.length]);
    filas.push([]);
    filas.push(SALIDA_COLUMNAS.slice());
    for (var i = 0; i < empleados.length; i++) {
      filas.push(filaSalida(empleados[i]));
    }
    filas.push(filaTotales(empleados));
    return filas;
  }

  function anchosColumnas() {
    return [
      { wch: 30 }, { wch: 14 }, { wch: 11 }, { wch: 7 }, { wch: 8 }, { wch: 13 },
      { wch: 15 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 13 },
      { wch: 12 }, { wch: 15 }, { wch: 13 }, { wch: 16 },
      { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 20 },
      { wch: 17 }, { wch: 17 }, { wch: 16 }
    ];
  }

  function resumen(empleados) {
    var res = { empleados: empleados.length, ingresos: 0, descuentos: 0, neto: 0, cesantias: 0 };
    for (var i = 0; i < empleados.length; i++) {
      res.ingresos += empleados[i].totalIngresos;
      res.descuentos += empleados[i].totalDescuentos;
      res.neto += empleados[i].neto;
      res.cesantias += empleados[i].cesantias;
    }
    return res;
  }

  var PLANTILLA_FILAS = [
    ['Nombre completo', 'Cédula', 'Rol', 'Hijos', 'Horas', 'Horas extras',
      'Domingos', 'Festivos', 'Nocturnas', 'Primas', 'Vivienda',
      'Libranza / préstamo', 'Otros descuentos'],
    ['EJEMPLO — Ana Pérez', '100000001', 'Gerente', 2, 160, 4, 1, 0, 10, 0, 350000, 200000, 0],
    ['EJEMPLO — Luis Gómez', '100000002', 'Admin', 1, 160, 0, 0, 1, 0, 150000, 0, 0, 50000],
    ['EJEMPLO — Marta Ruiz', '100000003', 'Operario', 4, 160, 8, 2, 0, 20, 0, 0, 0, 0]
  ];

  return {
    REGLAS_POR_DEFECTO: REGLAS_POR_DEFECTO,
    COLUMNAS: COLUMNAS,
    SALIDA_COLUMNAS: SALIDA_COLUMNAS,
    PLANTILLA_FILAS: PLANTILLA_FILAS,
    normalizar: normalizar,
    aNumero: aNumero,
    interpretarRol: interpretarRol,
    subsidioHijos: subsidioHijos,
    detectarTabla: detectarTabla,
    mapeoPorEncabezado: mapeoPorEncabezado,
    mapeoManualAIndice: mapeoManualAIndice,
    clonarReglas: clonarReglas,
    liquidarEmpleado: liquidarEmpleado,
    procesarFilas: procesarFilas,
    filaSalida: filaSalida,
    filaTotales: filaTotales,
    SALIDA_DINERO: SALIDA_DINERO,
    hojaSalida: hojaSalida,
    anchosColumnas: anchosColumnas,
    resumen: resumen
  };
});

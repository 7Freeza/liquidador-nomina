/* =====================================================================
   app.js — interfaz del Liquidador de Nómina
   Vistas, cola de archivos, proceso simultáneo, descargas.
   ===================================================================== */
(function () {
  'use strict';

  var L = window.NominaLogica;
  var MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Errores inesperados: que nunca se pierdan en silencio (se registra ANTES de todo)
  window.addEventListener('error', function (ev) {
    var caja = document.getElementById('avisos');
    if (caja) {
      var el = document.createElement('div');
      el.className = 'aviso error';
      el.textContent = 'Error inesperado: ' + ev.message;
      caja.appendChild(el);
    }
  });
  var CLAVE_REGLAS = 'nomina.reglas.v1';
  var CLAVE_MAPEO = 'nomina.mapeo.v1';
  var MAX_SIMULTANEOS = 3; // archivos procesados a la vez

  var ETIQUETAS_CAMPO = {
    nombre: 'Nombre completo', cc: 'Cédula', rol: 'Rol', hijos: 'Hijos', horas: 'Horas',
    extras: 'Horas extras', domingos: 'Domingos', feriados: 'Festivos',
    nocturnas: 'Nocturnas', prima: 'Primas', vivienda: 'Vivienda',
    libranza: 'Libranza / préstamo', otros: 'Otros descuentos'
  };
  var ORDEN_CAMPOS = Object.keys(ETIQUETAS_CAMPO);

  var estado = {
    archivos: [],
    reglas: mezclarReglas(leerJSON(CLAVE_REGLAS)),
    mapeoManual: leerJSON(CLAVE_MAPEO) || {},
    headersVistos: null,
    procesando: 0,
    siguienteId: 1
  };

  /* ------------------------------ Utilidades ------------------------------ */

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }

  function esc(txt) {
    return String(txt === null || txt === undefined ? '' : txt)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtCOP(n) {
    var v = Math.round(Number(n) || 0);
    return '$ ' + v.toLocaleString('es-CO');
  }

  function fmtNum(n) {
    return (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }

  function fmtTam(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function hoy() {
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fechaCorta() {
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function leerJSON(clave) {
    try {
      var bruto = localStorage.getItem(clave);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) { return null; }
  }

  function guardarJSON(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  function mezclarReglas(guardadas) {
    var base = JSON.parse(JSON.stringify(L.REGLAS_POR_DEFECTO));
    if (!guardadas) return base;
    base.tarifas = Object.assign(base.tarifas, guardadas.tarifas || {});
    base.recargos = Object.assign(base.recargos, guardadas.recargos || {});
    base.descuentos = Object.assign(base.descuentos, guardadas.descuentos || {});
    base.cesantias = Object.assign(base.cesantias, guardadas.cesantias || {});
    ['subsidio_hijo', 'tope_hijos', 'jornada_diaria'].forEach(function (k) {
      if (guardadas[k] !== undefined) base[k] = guardadas[k];
    });
    return base;
  }

  function aviso(texto, tipo) {
    var caja = $('#avisos');
    var el = document.createElement('div');
    el.className = 'aviso' + (tipo ? ' ' + tipo : '');
    el.textContent = texto;
    caja.appendChild(el);
    while (caja.children.length > 4) caja.firstElementChild.remove(); // nunca más de 4 a la vez
    setTimeout(function () {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, tipo === 'error' ? 6500 : 3800);
  }

  function descargar(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function baseNombre(nombre) {
    return String(nombre).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-');
  }

  /* -------------------------------- Vistas -------------------------------- */

  function irA(vista) {
    $$('.nav-btn').forEach(function (b) { b.classList.toggle('activo', b.dataset.vista === vista); });
    $$('.vista').forEach(function (s) { s.classList.toggle('activo', s.id === 'vista-' + vista); });
    if (vista === 'resultados') renderResultados();
    if (vista === 'reglas') renderMapeo();
  }

  /* ------------------------------ Agregar files --------------------------- */

  var EXTENSIONES = ['xlsx', 'xls', 'xlsm', 'csv'];

  function agregarArchivos(lista) {
    var agregados = 0, rechazados = 0;
    Array.prototype.forEach.call(lista, function (file) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (EXTENSIONES.indexOf(ext) === -1) { rechazados++; return; }
      estado.archivos.push({
        id: estado.siguienteId++,
        file: file,
        nombre: file.name,
        ext: ext,
        tamano: file.size,
        estado: 'pendiente',
        detalle: '',
        empleados: null,
        obs: [],
        resumen: null,
        salida: null,
        salidaNombre: null
      });
      agregados++;
    });
    if (rechazados) aviso(rechazados + ' archivo(s) ignorados: solo se aceptan .xlsx, .xls y .csv', 'error');
    if (agregados) {
      renderCola();
      irA('carga');
      procesarCola();
    }
  }

  /* --------------------------- Proceso en cola ---------------------------- */

  function procesarCola() {
    while (estado.procesando < MAX_SIMULTANEOS) {
      var sig = null;
      for (var i = 0; i < estado.archivos.length; i++) {
        if (estado.archivos[i].estado === 'pendiente') { sig = estado.archivos[i]; break; }
      }
      if (!sig) break;
      procesarArchivo(sig);
    }
    actualizarBotones();
  }

  async function procesarArchivo(item) {
    item.estado = 'procesando';
    item.detalle = 'Leyendo archivo…';
    estado.procesando++;
    renderCola();

    try {
      await pausa(30);

      var buffer = await item.file.arrayBuffer();
      var wb;
      try {
        wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      } catch (e) {
        throw new Error('No se pudo leer el archivo. ¿Está dañado o protegido con contraseña?');
      }
      if (!wb.SheetNames || !wb.SheetNames.length) throw new Error('El archivo no tiene hojas.');

      item.detalle = 'Buscando columnas…';
      renderCola();
      await pausa(20);

      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
        header: 1, raw: true, blankrows: false, defval: null
      });
      if (!aoa.length) throw new Error('La primera hoja del archivo está vacía.');

      var det = L.detectarTabla(aoa);
      item.headers = det.headers;
      estado.headersVistos = det.headers;

      // El mapeo manual (si existe) manda sobre la detección automática
      var mapeo = Object.assign({}, det.mapeo);
      if (Object.keys(estado.mapeoManual).length) {
        var mm = L.mapeoManualAIndice(estado.mapeoManual, det.headers);
        mapeo = Object.assign(mapeo, mm.mapeo);
      }
      var faltantes = ['nombre', 'rol'].filter(function (c) { return mapeo[c] === undefined; });
      if (faltantes.length) {
        throw new Error(
          'No reconozco la columna de ' +
          faltantes.map(function (c) { return '"' + ETIQUETAS_CAMPO[c] + '"'; }).join(' ni ') +
          '. Encabezados leídos: ' + (det.headers.filter(Boolean).join(', ') || '(ninguno)') +
          '. Asignalos en Reglas → Columnas del Excel.'
        );
      }

      item.detalle = 'Liquidando…';
      renderCola();
      await pausa(20);

      var filas = aoa.slice(det.filaEncabezado + 1);
      var res = L.procesarFilas(filas, mapeo, estado.reglas);

      if (!res.empleados.length) {
        var extra = res.observaciones.length ? ' (' + res.observaciones[0].mensaje + ')' : '';
        throw new Error('No encontré ningún trabajador para liquidar' + extra);
      }

      item.empleados = res.empleados;
      item.obs = res.observaciones;
      item.resumen = L.resumen(res.empleados);
      item.salida = construirSalida(item);
      item.salidaNombre = 'Nomina_' + baseNombre(item.nombre) + '_' + hoy() + '.xlsx';
      item.estado = 'listo';
      item.detalle = '';

      if (res.omitidas) {
        item.obs = item.obs.concat([{ fila: 0, mensaje: res.omitidas + ' fila(s) de ejemplo (EJEMPLO) ignoradas.' }]);
      }
      if (res.observaciones.length) {
        aviso(item.nombre + ': ' + res.observaciones.length + ' observación(es). Revísalas en Resultados.');
      }
    } catch (e) {
      item.estado = 'error';
      item.detalle = (e && e.message) ? e.message : 'No se pudo procesar el archivo.';
      item.empleados = null;
      item.salida = null;
    } finally {
      estado.procesando--;
      renderCola();
      renderResultados();
      renderContadores();
      if (estado.procesando === 0 && !hayPendientes()) {
        var listos = contarListos();
        if (listos) aviso('Listo: ' + listos + ' extracto(s) generados. Están en Resultados.', 'ok');
      }
      procesarCola();
    }
  }

  function hayPendientes() {
    return estado.archivos.some(function (a) { return a.estado === 'pendiente' || a.estado === 'procesando'; });
  }

  function contarListos() {
    return estado.archivos.filter(function (a) { return a.estado === 'listo'; }).length;
  }

  function reprocesarTodo() {
    var n = 0;
    estado.archivos.forEach(function (a) {
      a.estado = 'pendiente'; a.detalle = '';
      a.empleados = null; a.salida = null; a.resumen = null; a.obs = [];
      n++;
    });
    if (n) {
      renderCola(); renderResultados();
      irA('carga');
      procesarCola();
      aviso('Reprocesando ' + n + ' archivo(s) con las reglas actuales…');
    }
  }

  /* ------------------------ Construcción del extracto ---------------------- */

  function construirSalida(item) {
    var aoa = L.hojaSalida(item.empleados, { origen: item.nombre, fecha: fechaCorta() });
    var ws = XLSX.utils.aoa_to_sheet(aoa);

    // formato de miles en columnas de dinero (filas de datos y de totales)
    for (var r = 4; r < aoa.length; r++) {
      L.SALIDA_DINERO.forEach(function (c) {
        var ref = XLSX.utils.encode_cell({ r: r, c: c });
        if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '#,##0';
      });
      var refHoras = XLSX.utils.encode_cell({ r: r, c: 4 });
      if (ws[refHoras] && typeof ws[refHoras].v === 'number') ws[refHoras].z = '#,##0';
    }

    ws['!cols'] = L.anchosColumnas();
    var wbNuevo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbNuevo, ws, 'Nómina');
    var salida = XLSX.write(wbNuevo, { bookType: 'xlsx', type: 'array' });
    return new Blob([salida], { type: MIME_XLSX });
  }

  /* ------------------------------ Render cola ----------------------------- */

  function renderCola() {
    var cola = $('#cola');
    var hay = estado.archivos.length > 0;
    cola.hidden = !hay;
    $('#vacio-carga').hidden = hay;
    $('#btn-limpiar').hidden = !hay;
    $('#btn-reprocesar-carga').hidden = !estado.archivos.some(function (a) {
      return a.estado === 'listo' || a.estado === 'error';
    });

    cola.innerHTML = estado.archivos.map(filaArchivo).join('');
    renderContadores();
    actualizarBotones();
  }

  function filaArchivo(item) {
    var etiqueta = {
      pendiente: 'En espera', procesando: 'Procesando', listo: 'Listo', error: 'Con error'
    }[item.estado];

    var detalles;
    if (item.estado === 'error') {
      detalles = '<span class="mal">' + esc(item.detalle) + '</span>';
    } else if (item.estado === 'listo') {
      var nObs = item.obs.length;
      detalles = fmtTam(item.tamano) + ' · ' + item.empleados.length + ' empleado(s)' +
        (nObs ? ' · ' + nObs + ' observación(es)' : '');
    } else if (item.estado === 'procesando') {
      detalles = fmtTam(item.tamano) + ' · ' + esc(item.detalle || 'Procesando…');
    } else {
      detalles = fmtTam(item.tamano) + ' · en espera';
    }

    var botones = '';
    if (item.estado === 'listo') {
      botones +=
        '<button class="icono" data-accion="descargar" data-id="' + item.id + '" title="Descargar extracto">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"></path><path d="m7 11 5 5 5-5"></path><path d="M4 20h16"></path></svg>' +
        '</button>';
    }
    botones +=
      '<button class="icono peligro" data-accion="quitar" data-id="' + item.id + '" title="Quitar de la cola">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg>' +
      '</button>';

    return '' +
      '<div class="archivo ' + item.estado + '" data-id="' + item.id + '">' +
      '  <span class="archivo-icono' + (item.ext === 'csv' ? ' es-csv' : '') + '">' + esc(item.ext.toUpperCase()) + '</span>' +
      '  <div class="archivo-info">' +
      '    <div class="archivo-nombre" title="' + esc(item.nombre) + '">' + esc(item.nombre) + '</div>' +
      '    <div class="archivo-detalles">' + detalles + '</div>' +
      '    <div class="progreso"><i></i></div>' +
      '  </div>' +
      '  <span class="etiqueta ' + item.estado + '">' + etiqueta + '</span>' +
      '  <div class="archivo-botones">' + botones + '</div>' +
      '</div>';
  }

  function renderContadores() {
    var cCarga = $('#cuenta-carga');
    cCarga.hidden = estado.archivos.length === 0;
    cCarga.textContent = estado.archivos.length;

    var listos = contarListos();
    var cRes = $('#cuenta-resultados');
    cRes.hidden = listos === 0;
    cRes.textContent = listos;

    $('#btn-reprocesar-reglas').hidden = estado.archivos.length === 0;
  }

  function actualizarBotones() {
    $('#btn-zip').disabled = contarListos() === 0 || estado.procesando > 0;
  }

  /* ---------------------------- Render resultados -------------------------- */

  function renderResultados() {
    var listos = estado.archivos.filter(function (a) { return a.estado === 'listo'; });
    var vacio = $('#vacio-resultados');
    var lista = $('#lista-resultados');

    vacio.hidden = listos.length > 0;
    lista.hidden = listos.length === 0;

    if (!listos.length) {
      if (estado.archivos.some(function (a) { return a.estado === 'error'; })) {
        vacio.querySelector('.vacio-titulo').textContent = 'Hay archivos con error';
        vacio.querySelector('.vacio-texto').textContent = 'Revísalos en la sección Cargar archivos: el detalle del error aparece ahí.';
      } else {
        vacio.querySelector('.vacio-titulo').textContent = 'Sin resultados todavía';
        vacio.querySelector('.vacio-texto').textContent = 'Carga un archivo en la sección anterior y el extracto aparecerá listo acá.';
      }
      lista.innerHTML = '';
    } else {
      lista.innerHTML = listos.map(tarjetaResultado).join('');
    }

    // tarjetas de resumen
    var empleados = 0, neto = 0, descuentos = 0;
    listos.forEach(function (a) {
      empleados += a.resumen.empleados;
      neto += a.resumen.neto;
      descuentos += a.resumen.descuentos;
    });
    $('#dato-archivos').textContent = listos.length;
    $('#dato-empleados').textContent = empleados.toLocaleString('es-CO');
    $('#dato-neto').textContent = fmtCOP(neto);
    $('#dato-descuentos').textContent = fmtCOP(descuentos);

    actualizarBotones();
  }

  function tarjetaResultado(item) {
    var obsHTML = '';
    if (item.obs.length) {
      obsHTML = '<div class="obs-detalles" hidden><ul>' +
        item.obs.map(function (o) { return '<li>' + esc(o.mensaje) + '</li>'; }).join('') +
        '</ul></div>';
    }

    return '' +
      '<div class="resultado" data-id="' + item.id + '">' +
      '  <button class="resultado-cab" data-accion="toggle" data-id="' + item.id + '">' +
      '    <span class="resultado-nombre" title="' + esc(item.nombre) + '">' + esc(item.nombre) + '</span>' +
      '    <span class="resultado-datos"><b>' + item.empleados.length + '</b> empleados · Neto <b>' +
      fmtCOP(item.resumen.neto) + '</b> · Descuentos <b>' + fmtCOP(item.resumen.descuentos) + '</b></span>' +
      '    <span class="etiqueta listo">Listo</span>' +
      '    <span class="flecha"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg></span>' +
      '  </button>' +
      '  <div class="resultado-cuerpo">' +
      '    <div class="resultado-acciones">' +
      '      <button class="btn" data-accion="descargar" data-id="' + item.id + '">Descargar este extracto</button>' +
      (item.obs.length
        ? '<button class="aviso-obs' + (item.obs.length ? '' : ' ok') + '" data-accion="obs" data-id="' + item.id + '" style="border:none;cursor:pointer">' +
          item.obs.length + ' observación(es) — ver</button>'
        : '<span class="aviso-obs ok">Sin observaciones</span>') +
      '    </div>' +
      obsHTML +
      tablaHTML(item) +
      '  </div>' +
      '</div>';
  }

  function tablaHTML(item) {
    var cols = L.SALIDA_COLUMNAS;
    var dinero = L.SALIDA_DINERO;

    var head = cols.map(function (c, i) {
      var clase = i >= 3 ? ' class="num"' : '';
      return '<th' + clase + '>' + esc(c) + '</th>';
    }).join('');

    var filas = item.empleados.map(function (e) {
      var datos = L.filaSalida(e);
      return '<tr>' + datos.map(function (v, i) {
        var clase = i >= 3 ? ' class="num"' : '';
        var txt = i >= 3
          ? (dinero.indexOf(i) !== -1 ? fmtCOP(v) : fmtNum(v))
          : esc(v);
        return '<td' + clase + '>' + txt + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var totales = L.filaTotales(item.empleados);
    var filaTot = '<tr class="totales">' + totales.map(function (v, i) {
      var clase = i >= 3 ? ' class="num"' : '';
      if (i < 3) return '<td>' + esc(v) + '</td>';
      var txt = dinero.indexOf(i) !== -1 ? fmtCOP(v) : fmtNum(v);
      return '<td' + clase + '>' + txt + '</td>';
    }).join('') + '</tr>';

    return '<div class="tabla-envoltura"><table class="tabla">' +
      '<thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + filas + filaTot + '</tbody></table></div>';
  }

  /* ------------------------------ Descargas ------------------------------- */

  function descargarUno(item) {
    if (!item || !item.salida) return;
    descargar(item.salida, item.salidaNombre);
  }

  async function descargarTodo() {
    var listos = estado.archivos.filter(function (a) { return a.estado === 'listo' && a.salida; });
    if (!listos.length) return;

    var btn = $('#btn-zip');
    var textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparando…';

    try {
      if (typeof JSZip === 'undefined') {
        // respaldo: descarga una tras otra
        for (var i = 0; i < listos.length; i++) {
          descargar(listos[i].salida, listos[i].salidaNombre);
          await pausa(400);
        }
        aviso('Se descargaron ' + listos.length + ' extracto(s).', 'ok');
      } else {
        var zip = new JSZip();
        var nombresVistos = {};
        listos.forEach(function (it) {
          var nombre = it.salidaNombre;
          if (nombresVistos[nombre]) {
            nombre = nombre.replace(/\.xlsx$/, '') + '_' + it.id + '.xlsx';
          }
          nombresVistos[nombre] = true;
          zip.file(nombre, it.salida);
        });
        var blob = await zip.generateAsync({ type: 'blob' });
        descargar(blob, 'Extractos_Nomina_' + hoy() + '.zip');
        aviso('Zip listo con ' + listos.length + ' extracto(s).', 'ok');
      }
    } catch (e) {
      aviso('No se pudo generar la descarga: ' + e.message, 'error');
    } finally {
      btn.textContent = textoOriginal;
      btn.disabled = false;
    }
  }

  function descargarPlantilla() {
    var ws = XLSX.utils.aoa_to_sheet(L.PLANTILLA_FILAS);
    ws['!cols'] = [
      { wch: 30 }, { wch: 14 }, { wch: 11 }, { wch: 7 }, { wch: 8 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 17 }
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    descargar(new Blob([out], { type: MIME_XLSX }), 'Plantilla_Nomina.xlsx');
    aviso('Plantilla descargada. Llena las columnas y súbela acá.', 'ok');
  }

  /* --------------------------------- Reglas -------------------------------- */

  function nDe(id) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : 0;
  }

  function llenarFormulario(reglas) {
    $('#r-gerente').value = reglas.tarifas.gerente;
    $('#r-admin').value = reglas.tarifas.admin;
    $('#r-operario').value = reglas.tarifas.operario;
    $('#r-hijo').value = reglas.subsidio_hijo;
    $('#r-tope').value = reglas.tope_hijos;
    $('#r-jornada').value = reglas.jornada_diaria;
    $('#r-extra').value = reglas.recargos.extra;
    $('#r-domingo').value = reglas.recargos.domingo;
    $('#r-feriado').value = reglas.recargos.feriado;
    $('#r-nocturno').value = reglas.recargos.nocturno;
    $('#r-salud').value = reglas.descuentos.salud;
    $('#r-pension').value = reglas.descuentos.pension;
    $('#r-solidaridad').value = reglas.descuentos.solidaridad;
    $('#r-cesantias').checked = !!reglas.cesantias.incluir;
    $('#r-cesantias-pct').value = reglas.cesantias.porcentaje;
  }

  function reglasDesdeFormulario() {
    return {
      tarifas: { gerente: nDe('#r-gerente'), admin: nDe('#r-admin'), operario: nDe('#r-operario') },
      subsidio_hijo: nDe('#r-hijo'),
      tope_hijos: nDe('#r-tope'),
      jornada_diaria: nDe('#r-jornada'),
      recargos: { extra: nDe('#r-extra'), domingo: nDe('#r-domingo'), feriado: nDe('#r-feriado'), nocturno: nDe('#r-nocturno') },
      descuentos: { salud: nDe('#r-salud'), pension: nDe('#r-pension'), solidaridad: nDe('#r-solidaridad') },
      cesantias: { incluir: $('#r-cesantias').checked, porcentaje: nDe('#r-cesantias-pct') }
    };
  }

  function guardarReglas() {
    estado.reglas = reglasDesdeFormulario();
    guardarJSON(CLAVE_REGLAS, estado.reglas);
    aviso('Reglas guardadas.' + (estado.archivos.length ? ' Pulsa "Reprocesar archivos" para aplicarlas.' : ''), 'ok');
    renderContadores();
  }

  function renderMapeo() {
    var caja = $('#mapeo');
    var headers = estado.headersVistos;

    if (!headers || !headers.filter(Boolean).length) {
      caja.innerHTML = '<p class="nota" style="grid-column:1/-1;margin-top:0">' +
        'Todavía no se ha leído ningún archivo. Sube uno y las columnas que traiga aparecerán acá para poder asignarlas.</p>';
      return;
    }

    var opciones = function (seleccion) {
      var opts = '<option value="">— detección automática —</option>';
      headers.forEach(function (h, i) {
        if (!h) return;
        opts += '<option value="' + esc(h) + '"' + (seleccion === h ? ' selected' : '') + '>' + esc(h) + '</option>';
      });
      return opts;
    };

    var html = '<p class="nota" style="grid-column:1/-1;margin-top:0">' +
      'Columnas leídas: <strong>' + headers.filter(Boolean).map(esc).join(' · ') + '</strong>. ' +
      'Deja "automática" si el sistema ya las reconoce. Los cambios se aplican al reprocesar.</p>';

    html += ORDEN_CAMPOS.map(function (campo) {
      var actual = estado.mapeoManual[campo] || '';
      return '<div class="map-campo">' +
        '<label for="map-' + campo + '">' + ETIQUETAS_CAMPO[campo] + '</label>' +
        '<select id="map-' + campo + '" data-campo="' + campo + '">' + opciones(actual) + '</select>' +
        '</div>';
    }).join('');

    caja.innerHTML = html;

    caja.querySelectorAll('select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var campo = sel.dataset.campo;
        if (sel.value) estado.mapeoManual[campo] = sel.value;
        else delete estado.mapeoManual[campo];
        guardarJSON(CLAVE_MAPEO, estado.mapeoManual);
      });
    });
  }

  /* -------------------------------- Eventos -------------------------------- */

  function idDeEvento(ev) {
    var el = ev.target.closest('[data-accion]');
    return el ? { accion: el.dataset.accion, id: Number(el.dataset.id), el: el } : null;
  }

  function porId(id) {
    return estado.archivos.find(function (a) { return a.id === id; });
  }

  function init() {
    // navegación
    $$('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { irA(btn.dataset.vista); });
    });

    // zona de carga
    var zona = $('#zona');
    var entrada = $('#entrada');

    $('#btn-seleccionar').addEventListener('click', function () { entrada.click(); });
    zona.addEventListener('click', function () { entrada.click(); });
    zona.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); entrada.click(); }
    });
    entrada.addEventListener('change', function () {
      agregarArchivos(entrada.files);
      entrada.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (tipo) {
      zona.addEventListener(tipo, function (ev) {
        ev.preventDefault();
        zona.classList.add('arrastrando');
      });
    });
    ['dragleave', 'drop'].forEach(function (tipo) {
      zona.addEventListener(tipo, function (ev) {
        ev.preventDefault();
        zona.classList.remove('arrastrando');
      });
    });
    zona.addEventListener('drop', function (ev) {
      if (ev.dataTransfer && ev.dataTransfer.files.length) agregarArchivos(ev.dataTransfer.files);
    });

    // acciones de la cola
    $('#cola').addEventListener('click', function (ev) {
      var ref = idDeEvento(ev);
      if (!ref) return;
      var item = porId(ref.id);
      if (ref.accion === 'descargar') descargarUno(item);
      if (ref.accion === 'quitar') {
        estado.archivos = estado.archivos.filter(function (a) { return a.id !== ref.id; });
        renderCola();
        renderResultados();
      }
    });

    $('#btn-limpiar').addEventListener('click', function () {
      if (!estado.archivos.length) return;
      if (!window.confirm('¿Vaciar la cola? Se quitan los archivos y sus extractos de esta sesión.')) return;
      estado.archivos = [];
      renderCola();
      renderResultados();
    });

    $('#btn-reprocesar-carga').addEventListener('click', reprocesarTodo);
    $('#btn-reprocesar-reglas').addEventListener('click', reprocesarTodo);

    // resultados
    $('#lista-resultados').addEventListener('click', function (ev) {
      var ref = idDeEvento(ev);
      if (!ref) return;
      var item = porId(ref.id);
      if (ref.accion === 'toggle') {
        ref.el.closest('.resultado').classList.toggle('abierto');
      }
      if (ref.accion === 'descargar') descargarUno(item);
      if (ref.accion === 'obs') {
        var cuerpo = ref.el.closest('.resultado').querySelector('.obs-detalles');
        if (cuerpo) cuerpo.hidden = !cuerpo.hidden;
      }
    });

    $('#btn-zip').addEventListener('click', descargarTodo);

    // reglas
    $('#btn-guardar').addEventListener('click', guardarReglas);
    $('#btn-restaurar').addEventListener('click', function () {
      llenarFormulario(JSON.parse(JSON.stringify(L.REGLAS_POR_DEFECTO)));
      aviso('Valores del problema en el formulario. Pulsa "Guardar reglas" para aplicarlos.');
    });

    // plantilla
    $('#btn-plantilla').addEventListener('click', descargarPlantilla);

    // estado inicial
    llenarFormulario(estado.reglas);
    renderCola();
    renderResultados();
    renderMapeo();
    renderContadores();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

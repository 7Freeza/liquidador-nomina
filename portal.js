(() => {
  'use strict';
  const $ = (selector, base = document) => base.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = value => '$ ' + Number(value || 0).toLocaleString('es-CO');
  const state = { user: null, view: 'employees', employees: [], roles: [], payrolls: [], settings: null, query: '', roleId: '', selectedEmployee: null };
  const adminNav = [['employees', 'Empleados'], ['payroll', 'Liquidar'], ['dashboard', 'Entregas'], ['users', 'Usuarios'], ['roles', 'Roles'], ['settings', 'Reglas'], ['account', 'Mi cuenta']];
  const liquidatorNav = [['employees', 'Empleados'], ['payroll', 'Liquidar'], ['dashboard', 'Entregas'], ['account', 'Mi cuenta']];

  async function api(url, options = {}) {
    const response = await fetch('/api' + url, { credentials: 'same-origin', ...options });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No fue posible completar la solicitud.');
    return data;
  }
  function notify(message, error = false) {
    const box = $('#portal-notice');
    box.textContent = message;
    box.className = 'portal-notice' + (error ? ' error' : '');
  }
  function showLogin() {
    $('#portal').hidden = true;
    $('#auth-screen').hidden = false;
    $('#legacy-app').hidden = true;
  }
  function showPortal() {
    $('#auth-screen').hidden = true;
    $('#legacy-app').hidden = true;
    $('#portal').hidden = false;
    $('#portal-user').textContent = `${state.user.name} · ${state.user.role === 'admin' ? 'Administrador' : 'Liquidador'}`;
    const nav = state.user.passwordChangeRequired ? [['account', 'Cambiar contraseña']]
      : state.user.role === 'admin' ? adminNav : liquidatorNav;
    $('#portal-nav').innerHTML = nav.map(([key, label]) => `<button class="nav-btn${state.view === key ? ' activo' : ''}" data-view="${key}">${label}</button>`).join('');
    render();
  }
  async function loadBase() {
    const [roles, employees, payrolls, settings] = await Promise.all([api('/roles'), api('/employees'), api('/payrolls'), api('/settings')]);
    state.roles = roles.roles;
    state.employees = employees.employees;
    state.payrolls = payrolls.payrolls;
    state.settings = settings.settings;
  }
  async function refresh() {
    await loadBase();
    render();
  }
  function header(title, copy, action = '') {
    return `<header class="portal-header"><div><p class="eyebrow">${state.user.role === 'admin' ? 'ADMINISTRACIÓN' : 'LIQUIDACIÓN'}</p><h1>${title}</h1><p>${copy}</p></div>${action}</header>`;
  }
  function render() {
    $('#portal-nav').querySelectorAll('[data-view]').forEach(button => button.classList.toggle('activo', button.dataset.view === state.view));
    const view = $('#portal-view');
    if (state.view === 'employees') view.innerHTML = renderEmployees();
    if (state.view === 'payroll') view.innerHTML = renderPayroll();
    if (state.view === 'dashboard') view.innerHTML = renderDashboard();
    if (state.view === 'users') view.innerHTML = renderUsers();
    if (state.view === 'roles') view.innerHTML = renderRoles();
    if (state.view === 'settings') view.innerHTML = renderSettings();
    if (state.view === 'account') view.innerHTML = renderAccount();
  }
  function renderEmployees() {
    const admin = state.user.role === 'admin';
    const people = state.employees.filter(person => {
      const query = state.query.toLocaleLowerCase();
      return (!query || [person.name, person.nationalId, person.phone, person.email].some(value => String(value || '').toLocaleLowerCase().includes(query))) && (!state.roleId || person.roleId === state.roleId);
    });
    const roleOptions = `<option value="">Todos los roles</option>` + state.roles.map(role => `<option value="${role.id}"${state.roleId === role.id ? ' selected' : ''}>${esc(role.name)}</option>`).join('');
    const rows = people.map(person => `<tr><td>${esc(person.name)}</td><td>${esc(person.nationalId)}</td><td>${esc(person.roleName)}</td><td>${person.children}</td><td>${esc(person.phone || '—')}</td><td>${esc(person.email || '—')}</td>${admin ? `<td><button class="btn small" data-edit-employee="${person.id}">Editar</button><button class="btn small danger" data-delete-employee="${person.id}">Eliminar</button></td>` : ''}</tr>`).join('');
    const form = admin ? `<section class="portal-section"><h2 id="employee-form-title">Nuevo empleado</h2><form id="employee-form" class="form-grid"><input type="hidden" name="id"><label>Nombre completo<input name="name" maxlength="120" required></label><label>Cédula<input name="nationalId" maxlength="40" required></label><label>Teléfono<input name="phone" type="tel" maxlength="40"></label><label>Correo<input name="email" type="email" maxlength="254"></label><label>Rol<select name="roleId" required>${state.roles.map(role => `<option value="${role.id}">${esc(role.name)}</option>`).join('')}</select></label><label>Número de hijos<input name="children" type="number" min="0" step="1" value="0" required></label><div class="form-actions"><button class="btn primario" type="submit">Guardar empleado</button><button class="btn" type="reset" id="employee-cancel" hidden>Cancelar edición</button></div></form></section>
      <section class="portal-section"><h2>Importar empleados</h2><form id="import-form" class="inline-form"><input name="file" type="file" accept=".xlsx,.xls,.csv" required><button class="btn" type="submit">Importar Excel/CSV</button><button class="btn" type="button" id="employee-template">Descargar plantilla</button></form><p class="muted">La importación actualiza registros existentes cuando coincide la cédula. Teléfono y correo son opcionales.</p></section>` : '';
    return `${header('Empleados', admin ? 'Crea, modifica, importa y organiza el directorio.' : 'Consulta empleados por nombre, identificación o rol.')}${form}<section class="portal-section"><div class="filter-row"><label>Buscar<input id="employee-search" type="search" placeholder="Nombre, cédula, teléfono o correo" value="${esc(state.query)}"></label><label>Clasificar<select id="employee-role-filter">${roleOptions}</select></label><span class="muted">${people.length} empleado(s)</span></div><div class="table-scroll"><table class="tabla"><thead><tr><th>Nombre</th><th>Cédula</th><th>Rol</th><th>Hijos</th><th>Teléfono</th><th>Correo</th>${admin ? '<th>Acciones</th>' : ''}</tr></thead><tbody>${rows || `<tr><td colspan="${admin ? 7 : 6}" class="empty-cell">No hay empleados que coincidan.</td></tr>`}</tbody></table></div></section>`;
  }
  function renderPayroll() {
    const options = state.employees.map(person => `<option value="${person.id}"${state.selectedEmployee === person.id ? ' selected' : ''}>${esc(person.name)} · ${esc(person.roleName)} · ${esc(person.nationalId)}</option>`).join('');
    const current = state.payrolls.find(item => item.id === state.lastPayrollId);
    return `${header('Liquidar nómina', 'Selecciona un empleado, captura el periodo y las horas. Se aplican las reglas vigentes del motor de nómina.')}<section class="portal-section"><form id="payroll-form" class="form-grid"><label class="wide">Empleado<select name="employeeId" required><option value="">Seleccionar empleado</option>${options}</select></label><label>Periodo<input name="period" type="month" value="${new Date().toISOString().slice(0, 7)}" required></label><label>Horas<input name="horas" type="number" min="0" step="0.01" value="0" required></label><label>Horas extra<input name="extras" type="number" min="0" step="0.01" value="0"></label><label>Domingos<input name="domingos" type="number" min="0" step="1" value="0"></label><label>Festivos<input name="feriados" type="number" min="0" step="1" value="0"></label><label>Horas nocturnas<input name="nocturnas" type="number" min="0" step="0.01" value="0"></label><label>Primas ($)<input name="prima" type="number" min="0" step="1" value="0"></label><label>Vivienda ($)<input name="vivienda" type="number" min="0" step="1" value="0"></label><label>Libranza ($)<input name="libranza" type="number" min="0" step="1" value="0"></label><label>Otros descuentos ($)<input name="otros" type="number" min="0" step="1" value="0"></label><div class="form-actions"><button class="btn primario" type="submit">Calcular y guardar</button></div></form></section>${current ? `<section class="portal-section payroll-result"><h2>${esc(current.employee_name)} · ${esc(current.period)}</h2><p>Neto a pagar <strong>${money(current.result.neto)}</strong></p><p>Ingresos: ${money(current.result.totalIngresos)} · Descuentos: ${money(current.result.totalDescuentos)}</p><button class="btn primario" data-send-email="${current.id}">Enviar comprobante por correo</button></section>` : ''}<section class="portal-section"><h2>Liquidaciones recientes</h2>${payrollTable(state.payrolls.slice(0, 8))}</section>`;
  }
  function payrollTable(rows) {
    return `<div class="table-scroll"><table class="tabla"><thead><tr><th>Periodo</th><th>Empleado</th><th>Rol</th><th>Neto</th><th>Fecha</th></tr></thead><tbody>${rows.map(item => `<tr><td>${esc(item.period)}</td><td>${esc(item.employee_name)}</td><td>${esc(item.role_name)}</td><td>${money(item.result.neto)}</td><td>${new Date(item.created_at).toLocaleDateString('es-CO')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-cell">Todavía no hay liquidaciones.</td></tr>'}</tbody></table></div>`;
  }
  function renderDashboard() {
    const events = state.payrolls.flatMap(payroll => (payroll.deliveries || []).map(delivery => ({ ...delivery, employee: payroll.employee_name, period: payroll.period, net: payroll.result.neto })));
    const sent = events.filter(item => item.status === 'sent').length;
    const confirmed = events.filter(item => item.status === 'confirmed').length;
    const rows = events.map(item => `<tr><td>${esc(item.employee)}</td><td>${esc(item.period)}</td><td>${esc(item.channel === 'email' ? 'Correo' : 'WhatsApp')}</td><td>${esc(item.destination)}</td><td><span class="status ${esc(item.status)}">${item.status === 'confirmed' ? 'Confirmado' : item.status === 'sent' ? 'Enviado · pendiente' : item.status === 'failed' ? 'Error' : 'Respondido'}</span></td><td>${item.confirmedAt ? new Date(item.confirmedAt).toLocaleString('es-CO') : '—'}</td></tr>`).join('');
    return `${header('Seguimiento de entregas', 'Confirmaciones explícitas de recepción. La apertura del correo no se considera una lectura verificada.')}<div class="metric-row"><div><span>Pendientes</span><strong>${sent}</strong></div><div><span>Confirmados</span><strong>${confirmed}</strong></div><div><span>Total de envíos</span><strong>${events.length}</strong></div></div><section class="portal-section"><div class="table-scroll"><table class="tabla"><thead><tr><th>Empleado</th><th>Periodo</th><th>Canal</th><th>Destino</th><th>Estado</th><th>Confirmación</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty-cell">No hay envíos registrados todavía.</td></tr>'}</tbody></table></div><p class="muted">WhatsApp requiere activar WhatsApp Business Platform y su webhook; los envíos por ese canal no están habilitados en esta versión.</p></section>`;
  }
  async function renderUsersAsync() {
    const { users } = await api('/users');
    const rows = users.map(user => `<tr><td>${esc(user.name)}</td><td>${esc(user.email)}</td><td>${user.role === 'admin' ? 'Administrador' : 'Liquidador'}</td><td>${user.active ? 'Activo' : 'Desactivado'}</td><td><button class="btn small" data-toggle-user="${user.id}" data-active="${user.active}">${user.active ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('');
    $('#portal-view').innerHTML = `${header('Usuarios', 'Crea cuentas y asigna permisos de administrador o liquidador.')}<section class="portal-section"><h2>Crear cuenta</h2><form id="user-form" class="form-grid"><label>Nombre<input name="name" required></label><label>Correo<input name="email" type="email" required></label><label>Rol<select name="role"><option value="liquidador">Liquidador</option><option value="admin">Administrador</option></select></label><label>Contraseña temporal<input name="password" type="password" minlength="12" required></label><div class="form-actions"><button class="btn primario">Crear usuario</button></div></form></section><section class="portal-section"><h2>Cuentas registradas</h2><div class="table-scroll"><table class="tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Permiso</th><th>Estado</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  function renderRoles() {
    return `${header('Roles laborales', 'Administra categorías y tarifas por hora. Los roles asignados no se pueden eliminar.')}<section class="portal-section"><form id="role-form" class="inline-form"><label>Nombre del rol<input name="name" required maxlength="80"></label><label>Tarifa por hora ($)<input name="hourlyRate" type="number" min="0" step="1000" required></label><button class="btn primario">Crear rol</button></form></section><section class="portal-section"><div class="table-scroll"><table class="tabla"><thead><tr><th>Rol</th><th>Tarifa por hora</th><th></th></tr></thead><tbody>${state.roles.map(role => `<tr><td>${esc(role.name)}</td><td>${money(role.hourlyRate)}</td><td><button class="btn small danger" data-delete-role="${role.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div></section>`;
  }
  function renderSettings() {
    const rules = state.settings;
    return `${header('Reglas de cálculo', 'Valores compartidos por todos los liquidadores. Las tarifas por rol se administran en la sección Roles.')}<section class="portal-section"><form id="settings-form" class="form-grid"><label>Subsidio por hijo ($)<input name="subsidio_hijo" type="number" min="0" step="1000" value="${rules.subsidio_hijo}"></label><label>Tope de hijos<input name="tope_hijos" type="number" min="0" step="1" value="${rules.tope_hijos}"></label><label>Jornada diaria (horas)<input name="jornada_diaria" type="number" min="1" step="1" value="${rules.jornada_diaria}"></label><label>Recargo extra (%)<input name="extra" type="number" min="0" step="0.1" value="${rules.recargos.extra}"></label><label>Recargo domingo (%)<input name="domingo" type="number" min="0" step="0.1" value="${rules.recargos.domingo}"></label><label>Recargo festivo (%)<input name="feriado" type="number" min="0" step="0.1" value="${rules.recargos.feriado}"></label><label>Recargo nocturno (%)<input name="nocturno" type="number" min="0" step="0.1" value="${rules.recargos.nocturno}"></label><label>Salud EPS (%)<input name="salud" type="number" min="0" step="0.1" value="${rules.descuentos.salud}"></label><label>Pensión (%)<input name="pension" type="number" min="0" step="0.1" value="${rules.descuentos.pension}"></label><label>Fondo solidaridad (%)<input name="solidaridad" type="number" min="0" step="0.1" value="${rules.descuentos.solidaridad}"></label><label class="check-label">Incluir cesantías<input name="cesantiasIncluir" type="checkbox"${rules.cesantias.incluir ? ' checked' : ''}></label><label>Cesantías (%)<input name="cesantiasPorcentaje" type="number" min="0" step="0.01" value="${rules.cesantias.porcentaje}"></label><div class="form-actions"><button class="btn primario">Guardar reglas</button></div></form></section>`;
  }
  function renderAccount() {
    return `${header('Mi cuenta', 'Cambia la contraseña temporal por una personal. Se requieren al menos 12 caracteres.')}<section class="portal-section"><form id="password-form" class="form-grid"><label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Nueva contraseña<input name="newPassword" type="password" autocomplete="new-password" minlength="12" required></label><label>Confirmar contraseña<input name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></label><div class="form-actions"><button class="btn primario">Actualizar contraseña</button></div></form></section>`;
  }
  function renderUsers() {
    renderUsersAsync().catch(error => notify(error.message, true));
    return `${header('Usuarios', 'Cuentas de acceso del sistema.')}`;
  }
  function employeeFormData(form) {
    const data = Object.fromEntries(new FormData(form));
    data.children = Number(data.children);
    return data;
  }
  function resetEmployeeForm() {
    const form = $('#employee-form');
    if (!form) return;
    form.reset();
    form.elements.id.value = '';
    $('#employee-form-title').textContent = 'Nuevo empleado';
    $('#employee-cancel').hidden = true;
  }
  function downloadTemplate() {
    const rows = [['Nombre completo','Cédula','Teléfono','Correo','Rol','Hijos'], ['Ejemplo Persona','100000001','3000000000','persona@empresa.com','Operario',1]];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Empleados');
    XLSX.writeFile(book, 'Plantilla_Empleados.xlsx');
  }
  async function submitImport(form) {
    const body = new FormData(form);
    const result = await api('/employees/import', { method: 'POST', body });
    notify(`Importados/actualizados: ${result.imported}. Filas omitidas: ${result.skipped.length}.`);
    await refresh();
  }
  async function handleClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (button.dataset.view) {
        state.view = button.dataset.view;
        state.lastPayrollId = null;
        render();
      } else if (button.dataset.editEmployee) {
        const person = state.employees.find(item => item.id === button.dataset.editEmployee);
        const form = $('#employee-form');
        Object.entries({ id: person.id, name: person.name, nationalId: person.nationalId, phone: person.phone, email: person.email, roleId: person.roleId, children: person.children }).forEach(([key, value]) => { form.elements[key].value = value ?? ''; });
        $('#employee-form-title').textContent = `Editar ${person.name}`;
        $('#employee-cancel').hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (button.dataset.deleteEmployee) {
        if (!confirm('¿Eliminar este empleado?')) return;
        await api(`/employees/${button.dataset.deleteEmployee}`, { method: 'DELETE' });
        await refresh(); notify('Empleado eliminado.');
      } else if (button.id === 'employee-cancel') resetEmployeeForm();
      else if (button.id === 'employee-template') downloadTemplate();
      else if (button.dataset.deleteRole) {
        if (!confirm('¿Eliminar este rol?')) return;
        await api(`/roles/${button.dataset.deleteRole}`, { method: 'DELETE' });
        await refresh(); notify('Rol eliminado.');
      } else if (button.dataset.toggleUser) {
        await api(`/users/${button.dataset.toggleUser}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: button.dataset.active !== 'true' }) });
        render(); notify('Estado de usuario actualizado.');
      } else if (button.dataset.sendEmail) {
        await api(`/payrolls/${button.dataset.sendEmail}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await refresh(); notify('Comprobante enviado; queda pendiente la confirmación del empleado.');
      }
    } catch (error) { notify(error.message, true); }
  }
  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    try {
      if (form.id === 'login-form') {
        const body = Object.fromEntries(new FormData(form));
        const data = await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        state.user = data.user;
        state.view = data.user.passwordChangeRequired ? 'account' : 'employees';
        if (!data.user.passwordChangeRequired) await loadBase();
        showPortal();
      } else if (form.id === 'employee-form') {
        const data = employeeFormData(form);
        const id = data.id;
        delete data.id;
        await api(id ? `/employees/${id}` : '/employees', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        await refresh(); notify(id ? 'Empleado actualizado.' : 'Empleado creado.');
      } else if (form.id === 'import-form') await submitImport(form);
      else if (form.id === 'payroll-form') {
        const raw = Object.fromEntries(new FormData(form));
        const { employeeId, period, ...inputs } = raw;
        const data = await api('/payrolls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, period, inputs }) });
        state.lastPayrollId = data.payroll.id;
        await refresh(); notify('Liquidación calculada y guardada.');
      } else if (form.id === 'role-form') {
        await api('/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        await refresh(); notify('Rol creado.');
      } else if (form.id === 'user-form') {
        await api('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
        form.reset(); render(); notify('Usuario creado.');
      } else if (form.id === 'settings-form') {
        const values = Object.fromEntries(new FormData(form));
        const settings = state.settings;
        settings.subsidio_hijo = Number(values.subsidio_hijo);
        settings.tope_hijos = Number(values.tope_hijos);
        settings.jornada_diaria = Number(values.jornada_diaria);
        settings.recargos = { extra: Number(values.extra), domingo: Number(values.domingo), feriado: Number(values.feriado), nocturno: Number(values.nocturno) };
        settings.descuentos = { salud: Number(values.salud), pension: Number(values.pension), solidaridad: Number(values.solidaridad) };
        settings.cesantias = { incluir: form.elements.cesantiasIncluir.checked, porcentaje: Number(values.cesantiasPorcentaje) };
        const data = await api('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
        state.settings = data.settings;
        notify('Reglas guardadas y disponibles para el próximo cálculo.');
      } else if (form.id === 'password-form') {
        const values = Object.fromEntries(new FormData(form));
        if (values.newPassword !== values.confirmPassword) throw new Error('La nueva contraseña y su confirmación no coinciden.');
        await api('/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
        form.reset();
        state.user.passwordChangeRequired = false;
        state.view = 'employees';
        await loadBase();
        showPortal();
        notify('Contraseña actualizada.');
      }
    } catch (error) {
      if (form.id === 'login-form') $('#login-error').textContent = error.message;
      else notify(error.message, true);
    }
  }
  async function init() {
    $('#legacy-app').hidden = true;
    $('#login-form').addEventListener('submit', handleSubmit);
    $('#portal').addEventListener('submit', handleSubmit);
    $('#portal').addEventListener('click', handleClick);
    $('#portal').addEventListener('input', event => {
      if (event.target.id === 'employee-search') {
        state.query = event.target.value;
        const position = event.target.selectionStart;
        render();
        const input = $('#employee-search');
        input.focus(); input.setSelectionRange(position, position);
      }
    });
    $('#portal').addEventListener('change', event => {
      if (event.target.id === 'employee-role-filter') {
        state.roleId = event.target.value;
        render();
      }
    });
    $('#portal-nav').addEventListener('click', handleClick);
    $('#logout-button').addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      showLogin();
    });
    try {
      const { user } = await api('/auth/me');
      if (user) {
        state.user = user;
        state.view = user.passwordChangeRequired ? 'account' : 'employees';
        if (!user.passwordChangeRequired) await loadBase();
        showPortal();
      } else showLogin();
    } catch { showLogin(); }
  }
  document.addEventListener('DOMContentLoaded', init, { once: true });
})();

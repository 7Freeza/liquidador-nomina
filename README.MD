# Sistema de Gestión y Liquidación de Nómina

Aplicación web empresarial multiusuario diseñada para gestionar el directorio de empleados, estructurar roles laborales, parametrizar reglas salariales y ejecutar la liquidación de nómina con generación y confirmación de comprobantes vía correo electrónico.

Desarrollada sobre **Node.js/Express**, **PostgreSQL** y un motor de liquidación matemática autónomo (`logica.js`).

---

## 1. Arquitectura y Modelo de Roles

El sistema implementa control de acceso basado en roles (**RBAC** - *Role-Based Access Control*) con segregación estricta de privilegios tanto a nivel de interfaz de usuario como de endpoints en la API REST.

```
                             ┌─────────────────────────────────┐
                             │       PANTALLA DE ACCESO        │
                             │       (/api/auth/login)         │
                             └────────────────┬────────────────┘
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
         ┌─────────────────────────┐                     ┌─────────────────────────┐
         │   ROL: ADMINISTRADOR    │                     │     ROL: LIQUIDADOR     │
         │  (Gestión y Estructura) │                     │ (Operación y Entrega)   │
         └────────────┬────────────┘                     └────────────┬────────────┘
                      │                                               │
     ┌────────────────┼────────────────┐             ┌────────────────┼────────────────┐
     ▼                ▼                ▼             ▼                ▼                ▼
[Directorio]    [Configuración]   [Operación]   [Directorio]    [Liquidación]     [Entregas]
- Crear/Editar  - Usuarios        - Liquidar    - Consulta      - Carga de horas  - Monitoreo
- Eliminar      - Roles/Tarifas   - Entregas      (Lectura)     - Cálculo neto    - Trazabilidad
- Importar      - Reglas cálculo                                - Enviar email
```

### Matriz Detallada de Permisos (RBAC)

| Módulo / Acción | Endpoint API | Método | Administrador | Liquidador | Descripción funcional |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Autenticación** | `/api/auth/login` | `POST` | ✅ | ✅ | Validación de credenciales y regeneración de sesión. |
| **Cambiar Contraseña** | `/api/auth/password` | `POST` | ✅ | ✅ | Modificación de clave personal (mín. 12 caracteres). |
| **Consultar Directorio** | `/api/employees` | `GET` | ✅ | ✅ | Búsqueda por texto (nombre, CC, correo) y filtro de rol. |
| **Crear Empleado** | `/api/employees` | `POST` | ✅ | ❌ (403) | Registro individual con validación de rol y dependientes. |
| **Editar Empleado** | `/api/employees/:id` | `PUT` | ✅ | ❌ (403) | Actualización de datos demográficos y rol asignado. |
| **Eliminar Empleado** | `/api/employees/:id` | `DELETE` | ✅ | ❌ (403) | Borrado protegido (impide borrar con nóminas históricas). |
| **Importar Excel/CSV** | `/api/employees/import` | `POST` | ✅ | ❌ (403) | Carga masiva por documento de identidad. |
| **Consultar Roles** | `/api/roles` | `GET` | ✅ | ✅ | Lectura de cargos laborales y tarifas por hora. |
| **Crear Rol** | `/api/roles` | `POST` | ✅ | ❌ (403) | Definición de cargo y tarifa horaria estándar. |
| **Eliminar Rol** | `/api/roles/:id` | `DELETE` | ✅ | ❌ (403) | Desactivación (impide borrar si tiene empleados activos). |
| **Consultar Reglas** | `/api/settings` | `GET` | ✅ | ✅ | Lectura de recargos, subsidios y deducciones de ley. |
| **Modificar Reglas** | `/api/settings` | `PUT` | ✅ | ❌ (403) | Ajuste de subsidio por hijo, recargos y aportes EPS/Pensión. |
| **Gestión Usuarios** | `/api/users` | `GET/POST`| ✅ | ❌ (403) | Creación y listado de administradores y liquidadores. |
| **Activar/Desactivar Usuario**| `/api/users/:id` | `PATCH`| ✅ | ❌ (403) | Bloqueo o reactivación de accesos al sistema. |
| **Liquidar Nómina** | `/api/payrolls` | `POST` | ✅ | ✅ | Aplicación de fórmulas matemáticas y registro histórico. |
| **Historial Nóminas** | `/api/payrolls` | `GET` | ✅ | ✅ | Consulta de liquidaciones y trazabilidad de comprobantes. |
| **Enviar Comprobante** | `/api/payrolls/:id/email` | `POST` | ✅ | ✅ | Generación de archivo Excel y despacho SMTP. |
| **Confirmación Receptor** | `/confirmar/:token` | `GET/POST`| Público | Público | Verificación explícita de recepción por parte del trabajador. |

---

## 2. Diagramas de Casos de Uso

```mermaid
flowchart LR
    subgraph Actores
        Admin["Administrador"]
        Liq["Liquidador"]
        Emp["Empleado Destinatario"]
    end

    subgraph Casos_Administrador["Casos de Uso: Administrador"]
        CU_Users["Gestionar Usuarios y Roles"]
        CU_Rules["Parametrizar Reglas Salariales"]
        CU_Import["Importar Directorio Excel"]
        CU_CRUD_Emp["Crear / Editar Empleados"]
    end

    subgraph Casos_Comunes["Casos de Uso Compartidos"]
        CU_Search["Consultar Empleados"]
        CU_Calc["Liquidar Horas de Trabajo"]
        CU_Send["Emitir Comprobante por Email"]
        CU_Dash["Monitorear Estado de Entregas"]
        CU_Pass["Gestionar Clave Propia"]
    end

    subgraph Casos_Receptor["Casos de Uso: Empleado"]
        CU_Receive["Descargar Archivo Nómina"]
        CU_Confirm["Confirmar Recepción Vía Token"]
    end

    Admin --> CU_Users
    Admin --> CU_Rules
    Admin --> CU_Import
    Admin --> CU_CRUD_Emp
    Admin --> CU_Search
    Admin --> CU_Calc
    Admin --> CU_Send
    Admin --> CU_Dash
    Admin --> CU_Pass

    Liq --> CU_Search
    Liq --> CU_Calc
    Liq --> CU_Send
    Liq --> CU_Dash
    Liq --> CU_Pass

    Emp --> CU_Receive
    Emp --> CU_Confirm
```

---

## 3. Diagramas de Flujo del Proceso

### Flujo A: Ciclo Operativo de Liquidación y Confirmación

```mermaid
sequenceDiagram
    autonumber
    actor L as Liquidador / Admin
    participant S as Servidor (Express)
    participant DB as PostgreSQL
    participant M as Servidor SMTP (Gmail)
    actor E as Empleado

    L->>S: POST /api/payrolls (ID Empleado, Periodo, Horas trabajadas)
    S->>DB: Consultar empleado, tarifa por hora y reglas vigentes
    S->>S: Ejecutar logica.liquidarEmpleado(...)
    S->>DB: INSERT INTO payrolls (inputs, resultado_neto)
    S-->>L: 201 Created (Detalle de ingresos, deducciones y neto)

    opt Despacho del Comprobante
        L->>S: POST /api/payrolls/:id/email
        S->>S: Generar libro Excel (.xlsx) en memoria
        S->>S: Generar token criptográfico SHA-256 de confirmación
        S->>DB: INSERT INTO delivery_events (status='sent', token_hash)
        S->>M: Enviar correo con extracto adjunto y enlace de confirmación
        M-->>E: Entrega en buzón institucional/personal
        S-->>L: 202 Accepted (Notificación despachada)
    end

    opt Confirmación del Empleado
        E->>S: GET /confirmar/:token
        S-->>E: Pantalla web de confirmación
        E->>S: POST /confirmar/:token
        S->>DB: UPDATE delivery_events SET status='confirmed', confirmed_at=now()
        S-->>E: 200 OK ("Recepción confirmada con éxito")
    end
```

### Flujo B: Lógica Matemática del Motor de Nómina

```mermaid
flowchart TD
    Start(["Inicio: Datos del Empleado y Horas"]) --> Base["Salario Base = Horas * Tarifa_Por_Hora"]
    
    Base --> Extras["Recargo Horas Extra = Extras * Tarifa * (1 + %Extra)"]
    Extras --> Dominicales["Recargo Domingos = Domingos * Jornada * Tarifa * (1 + %Domingo)"]
    Dominicales --> Festivos["Recargo Festivos = Festivos * Jornada * Tarifa * (1 + %Feriado)"]
    Festivos --> Nocturnas["Recargo Nocturno = Horas_Nocturnas * Tarifa * (1 + %Nocturno)"]
    
    Nocturnas --> Subsidio{"Hijos a cargo > 0?"}
    Subsidio -- Sí --> CalcSub["Subsidio = Min(Hijos, Tope) * Valor_Subsidio_Hijo"]
    Subsidio -- No --> NoSub["Subsidio = $0"]
    
    CalcSub --> TotalIngresos["Total Ingresos = Base + Recargos + Subsidio + Primas"]
    NoSub --> TotalIngresos
    
    TotalIngresos --> Descuentos["Descuentos Obligatorios:\n- Salud = Base * %Salud\n- Pensión = Base * %Pensión\n- Fondo Solidaridad = Base * %Solidaridad"]
    Descuentos --> OtrosDesc["Otras Deducciones:\nLibranzas + Vivienda + Descuentos Varios"]
    OtrosDesc --> TotalDeducciones["Total Deducciones = Descuentos_Ley + Otras_Deducciones"]
    
    TotalDeducciones --> Neto["Neto a Pagar = Total Ingresos - Total Deducciones"]
    Neto --> Fin(["Guardar Liquidación e Histórico"])
```

---

## 4. Requisitos del Entorno

- **Node.js**: Versión 22 o superior con npm.
- **PostgreSQL**: Versión 13 o superior.
- **Google Workspace / Gmail**: Cuenta con verificación en dos pasos y contraseña de aplicación habilitada para el servicio SMTP saliente.

---

## 5. Guía de Instalación y Puesta en Marcha

Sigue estos pasos en orden para iniciar la aplicación correctamente desde cero:

### Paso 1. Clonar el repositorio e instalar dependencias

```bash
git clone <url-del-repositorio>
cd liquidador-nomina
npm install
```

### Paso 2. Preparar la base de datos PostgreSQL

Asegúrate de tener el motor de PostgreSQL en ejecución y crea la base de datos:

```bash
# Opción A (rápida): Con el usuario del sistema o postgres
sudo -u postgres createdb liquidador_nomina

# Opción B (recomendada para entornos compartidos): Usuario dedicado
sudo -u postgres psql -c "CREATE USER liquidador WITH PASSWORD 'tu_clave_segura';"
sudo -u postgres psql -c "CREATE DATABASE liquidador_nomina OWNER liquidador;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE liquidador_nomina TO liquidador;"
```

### Paso 3. Configurar variables de entorno (`.env`)

Copia la plantilla base:

```bash
cp -n .env.example .env
```

Edita el archivo `.env` recién creado con los valores correspondientes a tu entorno:

```env
# Conexión a PostgreSQL
DATABASE_URL=postgres://liquidador:tu_clave_segura@localhost:5432/liquidador_nomina

# Secreto criptográfico de sesión (mínimo 32 caracteres aleatorios)
SESSION_SECRET=a8f9c2d1e0b4a7c3f5e9d2b8a1c7e4f0a2d9c3b8e7f1a5b9c0d3e6f2a8b4c7d1
NODE_ENV=development
PORT=8080
APP_BASE_URL=http://localhost:8080

# Credenciales iniciales: ADMINISTRADOR (gestión completa)
ADMIN_NAME=Administrador
ADMIN_EMAIL=admin@empresa.com
ADMIN_PASSWORD=lmao090908!!!

# Credenciales iniciales: LIQUIDADOR (operación y nómina)
LIQUIDATOR_NAME=Liquidador
LIQUIDATOR_EMAIL=liquidador@empresa.com
LIQUIDATOR_PASSWORD=lmao090908!!!

# Parámetros SMTP para emisión de comprobantes (Google Workspace)
GMAIL_USER=nomina@empresa.com
GMAIL_APP_PASSWORD=tu_clave_de_aplicacion_google
GMAIL_FROM=Nómina Administrativa <nomina@empresa.com>
```

> [!NOTE]
> **Inicialización automática (Bootstrap):**
> Al arrancar el servidor por primera vez, el sistema:
> 1. Crea las tablas de base de datos (`users`, `job_roles`, `employees`, `payrolls`, `payroll_settings`, `delivery_events`, `session`).
> 2. Siembra los roles base: `Gerente`, `Admin` y `Operario`.
> 3. Registra de inmediato las dos cuentas de acceso (`ADMIN_EMAIL` y `LIQUIDATOR_EMAIL`).
> 4. Si el directorio está vacío, registra empleados de prueba para permitir liquidaciones inmediatas.

### Paso 4. Arrancar la aplicación

- **Modo Desarrollo** (con reinicio ante cambios de código):
  ```bash
  npm run dev
  ```
- **Modo Estándar / Producción**:
  ```bash
  npm start
  ```

El servicio quedará disponible en <http://localhost:8080>.

---

## 6. Manual de Uso según Perfil

### Acceso como Administrador (`admin@empresa.com`)
1. **Directorio y Empleados:** Permite ingresar nuevos colaboradores manualmente o cargarlos por lote mediante archivos `.xlsx`, `.xls` o `.csv`.
2. **Roles y Tarifas:** Permite dar de alta cargos salariales y modificar el costo de hora base.
3. **Reglas de Cálculo:** Permite ajustar porcentajes de aportes parafiscales, recargos por trabajo dominical/nocturno y subsidios familiares.
4. **Gestión de Usuarios:** Permite crear nuevos colaboradores con rol de *Administrador* o *Liquidador*, así como deshabilitar accesos.

### Acceso como Liquidador (`liquidador@empresa.com`)
1. **Consulta de Empleados:** Directorio en modo solo lectura para consultar documentos, cargos y datos de contacto (sin botones de edición ni eliminación).
2. **Liquidar Horas:** Formulario de captura para seleccionar el empleado, definir el mes (`AAAA-MM`), registrar horas diurnas, extras, festivos y deducciones extraordinarias.
3. **Emisión de Comprobantes:** Con un clic sobre la liquidación reciente, el sistema compila el archivo Excel y lo remite al correo del empleado.
4. **Seguimiento de Entregas:** Panel de control con métricas en tiempo real de correos enviados, pendientes de lectura y recepciones confirmadas.

---

## 7. Referencia de Comandos del Proyecto

| Comando | Función |
| :--- | :--- |
| `npm run dev` | Inicia el servidor Node.js en modo observador (`--watch`). |
| `npm start` | Inicia el servidor de producción. |
| `npm test` | Ejecuta la batería de 90 pruebas automatizadas (fórmulas, casos límite y pipeline). |
| `npm run build` | Empaqueta la interfaz y lógica en el archivo independiente `Liquidador_Nomina.html`. |
| `npm run ejemplos` | Genera libros de prueba en la carpeta `ejemplos/`. |

---

## 8. Seguridad y Buenas Prácticas

- **Cifrado de contraseñas:** Todas las claves se procesan con `bcrypt` (12 rondas de salteo).
- **Protección de sesiones:** Sesiones persistentes en PostgreSQL (`connect-pg-simple`) con cookies `httpOnly`, `sameSite: strict` y regeneración de ID contra ataques de fijación de sesión.
- **Seguridad perimetral:** Cabeceras HTTP endurecidas vía `helmet` y limitación de tasa de solicitudes (`rate-limit`) en el inicio de sesión.
- **Protección contra inyección SQL:** Todas las consultas a PostgreSQL están estrictamente parametrizadas con marcadores de posición (`$1, $2, ...`).
- **Trazabilidad:** Confirmación de recepción basada en tokens únicos de un solo uso con función hash unidireccional SHA-256.

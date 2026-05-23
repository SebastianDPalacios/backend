# Documentacion de Servicios - Backend Panaderia

Este documento describe para que sirve cada servicio dentro de la carpeta services y como encaja en el flujo del backend.

## 1) auth.service.js
Responsabilidad principal:
- Gestionar autenticacion y sesiones (login, refresh, logout).

Funciones:
- login: valida credenciales con SP de inicio de sesion, verifica password con bcrypt, registra intento fallido o exitoso, genera access token y refresh token.
- refreshSession: renueva sesion con rotacion de refresh token y emite nuevo access token.
- logout: cierra la sesion activa.

SP involucrados:
- sp_auth_login_start
- sp_auth_login_fail
- sp_auth_login_success
- sp_permission_list_by_user
- sp_auth_refresh_session
- sp_auth_logout

Notas:
- Usa hash SHA-256 para almacenar/validar refresh token.
- Usa JWT mediante signToken del middleware de auth.

## 2) users.service.js
Responsabilidad principal:
- Consultas de usuarios para lectura de detalle y listado.

Funciones:
- getUserById: obtiene un usuario por id.
- listUsers: lista usuarios con filtros de estado, busqueda y paginacion.

SP involucrados:
- sp_user_get_by_id
- sp_user_list

## 3) catalog.service.js
Responsabilidad principal:
- Consultas de catalogos generales del negocio.

Funciones:
- listBranches: lista sucursales.
- listCustomers: lista clientes con filtros/paginacion.
- listRoutes: en esta version retorna respuesta controlada indicando que no hay SP disponible.
- listProducts: lista productos con filtros/paginacion.
- listRawMaterials: lista materias primas con filtros/paginacion.

SP involucrados:
- sp_branch_list
- sp_customer_list
- sp_product_list
- sp_raw_material_list

Notas:
- listRoutes no ejecuta base de datos actualmente porque el SP no esta habilitado en esta version.

## 4) orders.service.js
Responsabilidad principal:
- Armar datos base para flujo de ordenes.

Funciones:
- listOrderBaseData: devuelve catalogos necesarios para crear/gestionar ordenes (clientes y productos); rutas se retorna vacio en esta version.

SP involucrados:
- sp_customer_list
- sp_product_list

Notas:
- Se ejecutan llamadas en paralelo con Promise.all para mejorar tiempo de respuesta.

## 5) production.service.js
Responsabilidad principal:
- Armar datos base para flujo de produccion.

Funciones:
- listProductionBaseData: devuelve productos y materias primas para operaciones de produccion.

SP involucrados:
- sp_product_list
- sp_raw_material_list

Notas:
- Ejecuta consultas en paralelo para reducir latencia.

## 6) inventory.service.js
Responsabilidad principal:
- Armar datos base para flujo de inventario.

Funciones:
- listInventoryBaseData: devuelve sucursales, productos y materias primas para pantallas/procesos de inventario.

SP involucrados:
- sp_branch_list
- sp_product_list
- sp_raw_material_list

Notas:
- Ejecuta consultas en paralelo y corta temprano ante errores de algun SP.

## 7) admin-auth.service.js
Responsabilidad principal:
- Operaciones administrativas de usuarios y contrasena.

Funciones:
- createUser, updateUserProfile, assignUserRoles, setUserStatus.
- forceUserPasswordReset, logoutAllUserSessions, resetUserPasswordByAdmin, changeOwnPassword.

## 8) commercial.service.js
Responsabilidad principal:
- CRUD comercial de clientes y rutas.

Funciones:
- createCustomer, updateCustomer, setCustomerStatus.
- createRoute, updateRoute, setRouteStatus, assignRouteDriver.

## 9) rbac.service.js
Responsabilidad principal:
- CRUD de roles, permisos y asignacion de permisos a rol.

Funciones:
- createRole, updateRole, createPermission, setRolePermissions.

## 10) recipes.service.js
Responsabilidad principal:
- CRUD operativo de recetas y versionado.

Funciones:
- createRecipe, addRecipeItem, removeRecipeItem, publishRecipeVersion.

## 11) standard.service.js
Responsabilidad principal:
- Consultas estandar de configuracion y catalogo de errores.

Funciones:
- lookupError.
- getConfig.

## 12) sp-response.js
Responsabilidad principal:
- Estandarizar salida de procedimientos almacenados al contrato interno del backend.

Funciones:
- mapSpResult: convierte o_code, o_message y o_data_json al formato comun { code, message, data }.
- parseJsonSafe: parsea JSON de forma segura y evita romper flujo ante payload invalido.

Impacto:
- Garantiza consistencia de respuestas entre todos los servicios que llaman SP.

## Flujo comun entre servicios
1. El router recibe request y delega al servicio.
2. El servicio llama SP via callProcedure.
3. El resultado se transforma con mapSpResult.
4. La respuesta vuelve al router en formato estandar: code, message, data.

## Recomendaciones de mantenimiento
- Mantener cada llamada SP dentro del servicio de su dominio.
- Cuando se habilite un SP nuevo en BD, agregarlo en el servicio del dominio correspondiente y luego exponer endpoint.
- Si un SP se deshabilita temporalmente, retornar respuesta controlada (sin lanzar error 500) para no romper integraciones existentes.

## Donde esta el CRUD actualmente
El CRUD esta segregado por dominio: cada router usa su propio service de dominio para lectura y escritura.

### Usuarios
- Read: GET /api/users, GET /api/users/:id en api/users.router.js.
- Create: POST /api/admin-auth/users en api/admin-auth.router.js.
- Update: PUT /api/admin-auth/users/:id/profile y PUT /api/admin-auth/users/:id/roles en api/admin-auth.router.js.
- Cambios de estado/acciones: PATCH /api/admin-auth/users/:id/status, POST /api/admin-auth/users/:id/force-password-reset, POST /api/admin-auth/users/:id/reset-password, POST /api/admin-auth/users/:id/logout-all.

### Catalogos
- Branches: GET /api/catalog/branches, POST /api/catalog/branches, PUT /api/catalog/branches/:id.
- Products: GET /api/catalog/products, POST /api/catalog/products, PUT /api/catalog/products/:id, PATCH /api/catalog/products/:id/status.
- Raw materials: GET /api/catalog/raw-materials, POST /api/catalog/raw-materials, PUT /api/catalog/raw-materials/:id, PATCH /api/catalog/raw-materials/:id/status.
- Customers (lectura en catalog + escritura en commercial):
	- Read: GET /api/catalog/customers
	- Create/Update/Status: POST /api/commercial/customers, PUT /api/commercial/customers/:id, PATCH /api/commercial/customers/:id/status
- Routes (lectura deshabilitada por SP no disponible, escritura en commercial):
	- Read: GET /api/catalog/routes (respuesta controlada)
	- Create/Update/Status/Assign driver: POST /api/commercial/routes, PUT /api/commercial/routes/:id, PATCH /api/commercial/routes/:id/status, POST /api/commercial/routes/:id/assign-driver

### Ordenes
- Base read: GET /api/orders/base-data.
- Create: POST /api/orders/.
- Update de items: POST /api/orders/:id/items (upsert de item de orden).
- Acciones de ciclo de vida: POST /api/orders/:id/confirm, POST /api/orders/:id/cancel, POST /api/orders/:id/dispatch.

### Produccion
- Base read: GET /api/production/base-data.
- Create/registro: POST /api/production/results.
- Cierre: POST /api/production/orders/:id/close.

### Inventario
- Base read: GET /api/inventory/base-data.
- Create/ajuste de movimiento: POST /api/inventory/movements.

### RBAC
- Roles: POST /api/rbac/roles, PUT /api/rbac/roles/:id.
- Permissions: POST /api/rbac/permissions.
- Asignacion rol-permisos: PUT /api/rbac/roles/:id/permissions.

### Recipes
- Create receta: POST /api/recipes.
- Update de detalle: POST /api/recipes/:id/items, DELETE /api/recipes/:id/items/:rawMaterialId.
- Publicar version: POST /api/recipes/:id/publish.

## Regla actual de arquitectura
- Read/listado y write/update/acciones: todo vive en servicios de dominio.
- No existe capa generica de ejecucion de SP expuesta para todos los modulos.

## Estandar de implementacion de servicios
La arquitectura objetivo de este backend es limpia y sencilla:
- La logica de negocio vive en la base de datos (Stored Procedures).
- El service en Node.js solo orquesta llamada a SP, mapea parametros y retorna el resultado.
- Evitar validaciones complejas, reglas de negocio o transformaciones pesadas en services.

Patron esperado en services:
1. Recibir parametros del router.
2. Preparar inputs para SP (normalizar null/number/string cuando aplique).
3. Ejecutar SP.
4. Retornar respuesta estandar.


```

Decision practica para este repo:
- Mantener servicios delgados por dominio y evitar capas genericas que mezclen modulos.
- Cualquier nueva funcionalidad debe intentar resolverse con un SP dedicado antes de agregar logica al service.

## Regla de orden por dominio
- No existe endpoint generico para ejecutar procedimientos (por ejemplo /api/procedures/:name).
- Cada CRUD vive en su router de dominio: inventory, orders, catalog, commercial, production, rbac, recipes, admin-auth.
- No existe procedures.service; la ejecucion de SP esta segregada por servicios de dominio.

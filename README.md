# Backend Panaderia

Arquitectura replicada desde plantar-back:

- index.js como entrypoint central
- api/ para routers
- services/ para acceso a procedimientos almacenados
- middlewares/ para auth y errores
- data-access.js como capa de conexion

## Ejecutar

1. Copiar .env.example a .env y ajustar credenciales.
2. Instalar dependencias:
   npm install
3. Iniciar en desarrollo:
   npm start

## Endpoints iniciales

- POST /api/auth/login
- POST /api/auth/refresh
- POST /api/auth/logout
- GET /api/users
- GET /api/users/:id
- GET /api/catalog/branches
- GET /api/catalog/customers
- GET /api/catalog/routes
- GET /api/catalog/products
- GET /api/catalog/raw-materials
- GET /api/orders/base-data
- GET /api/production/base-data
- GET /api/inventory/base-data

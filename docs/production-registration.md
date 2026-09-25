# Registro protegido de producción realizada

`Producción realizada` es un registro libre e independiente de las listas informativas.

## Flujo

1. El usuario selecciona sucursal, panadero (solo administradores), producto y unidades completas.
2. La pantalla muestra la receta vigente y su versión.
3. El backend exige que ese ID exacto continúe activo y vigente. No lo sustituye silenciosamente por otra versión.
4. En una sola transacción se bloquean existencias, se valida materia prima, se crea el lote pendiente de empaque, se descuentan materias primas y se crean movimientos.
5. El lote conserva `recipe_id`, `baker_employee_id` y `created_by`; la auditoría conserva además versión, ejecutor y motivo retroactivo.

## Permisos

- Un panadero registra únicamente por el empleado panadero activo asociado a su usuario. Cualquier ID enviado por el cliente es reemplazado por el suyo.
- Un administrador puede seleccionar cualquier panadero activo.

## Fechas

- No se permiten fechas futuras.
- El panadero normal solo registra la fecha actual del servidor.
- El administrador puede registrar una fecha anterior si incluye un motivo de al menos cinco caracteres, almacenado en auditoría.

## Idempotencia

Cada intento lógico envía `p_client_request_key`. La columna `production_batches.client_request_key` tiene índice único mediante la migración `077_production_batch_idempotency.sql`.

- Doble clic o reintento con la misma clave devuelve el lote ya creado.
- Una clave nueva solo se genera cuando cambia el contenido del registro o después de un éxito.
- Una colisión concurrente revierte la segunda transacción antes de devolver el lote existente.

La migración debe aplicarse antes de publicar backend y frontend. Este bloque no la ejecuta ni despliega.


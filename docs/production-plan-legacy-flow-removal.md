# Retiro del flujo operativo antiguo del plan

La lista de producción es exclusivamente informativa. Este bloque retira la posibilidad de iniciar, avanzar, omitir, finalizar, corregir o crear lotes desde una lista.

## Endpoints retirados

- `POST /production/plans/items/:id/start`
- `POST /production/plans/items/:id/finish`
- `POST /production/plans/products/:id/start`
- `PATCH /production/plans/products/:id/progress`
- `POST /production/plans/products/:id/skip`
- `POST /production/plans/products/:id/finish`
- `PATCH /production/plans/products/:id/correction`

## Frontend retirado

- Página `/production/work/[id]`.
- Diálogo `ProductionWorkDialog`.
- Tarjeta operativa `AssignedProductionPlanCard`.
- Botones, estado local y llamadas para iniciar o finalizar producción desde planificación.
- Métodos del servicio y definiciones de URL de los endpoints anteriores.

## Compatibilidad histórica conservada

No se eliminaron tablas ni columnas. En particular se conservan:

- `production_plan_items.production_batch_id`, `started_at` y `finished_at`.
- `production_plan_product_details` y sus estados históricos.
- `production_plan_product_corrections`.
- Las relaciones históricas con lotes, reservas, movimientos, pedidos y reportes.

La consulta de listas continúa leyendo esos campos para proteger la edición o cancelación de registros antiguos que sí llegaron a generar producción. Esa lectura no habilita nuevas operaciones desde la lista.

## Flujos vigentes no modificados

- Crear, editar, cancelar y consultar listas informativas.
- Registrar libremente la producción en `Producción realizada` mediante `/production/my-batches`.
- Consultar lotes pendientes y registrar conteo/empaque.
- Consultar reportes e historial de empaque.


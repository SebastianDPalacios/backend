# Flujo oficial de producción

El módulo conserva tres registros independientes. Ninguno sustituye a otro.

## Lista informativa del administrador

Comunica al panadero qué productos se espera elaborar, en qué fecha y para qué sucursal.

- No crea lotes.
- No descuenta materias primas.
- No modifica inventario terminado.
- No obliga al panadero a reportar la cantidad informada.
- Sus únicos estados visibles son `informed`, `viewed`, `cancelled` (Informada, Vista y Cancelada).
- La consulta personal del panadero cambia Informada a Vista; la consulta administrativa no altera el estado.
- Los valores históricos `assigned` y `completed` se normalizan al consultar y nunca se muestran como estados operativos.

## Producción reportada por el panadero

Es la declaración libre de las unidades completas realmente elaboradas.

- Usa una versión concreta de receta.
- Descuenta materias primas al registrar la producción.
- Crea un lote pendiente de conteo y empaque.
- No incrementa inventario terminado.

Estados del lote: `pending_packaging`, `partially_packed`, `packed`, `cancelled`.

## Conteo de la máquina empaquetadora

El contador registra la cantidad indicada por la máquina y los daños encontrados.

- Antes del cierre no recibe la cantidad reportada por el panadero.
- Su reporte no depende de que coincida con el reporte del panadero.
- Solo la cantidad empacada puede ingresar al inventario terminado.
- Cada daño conserva cantidad y motivo.
- El campo principal es la cantidad empacada indicada por la máquina.
- El conteo no consulta ni limita sus cantidades usando el reporte del panadero.
- Un resultado mayor o menor al reporte del panadero se guarda sin bloquearse.
- Cada daño se registra por separado con cantidad, motivo y detalle opcional.
- Solo la cantidad empacada incrementa inventario; los daños nunca ingresan.

## Conciliación posterior

La comparación ocurre únicamente después de cerrar el conteo:

`total encontrado = empacados + dañados`

`diferencia = producido por el panadero - total encontrado`

- Diferencia positiva: faltante.
- Diferencia igual a cero: conciliado.
- Diferencia negativa: sobrante.

La conciliación se persiste por producto junto al conteo, pero nunca lo bloquea. Se guardan por separado la cantidad producida, empacada, dañada, total encontrado, faltante y sobrante. El contador recibe únicamente la confirmación del guardado; el detalle conciliado se entrega solo a usuarios con administración de producción.

## Cierre idempotente

Cada envío de conteo utiliza una `client_request_key` estable y única. El cierre bloquea el lote y sus productos con `FOR UPDATE`, vuelve a comprobar `counted_at` dentro de la transacción y solo entonces registra conteo, daños e inventario. Un doble clic, un reintento de red o un segundo usuario reciben el reporte ya creado y no vuelven a sumar inventario. Esta protección detecta duplicados; nunca compara ni limita el conteo con la cantidad producida.

## Correcciones administrativas

Solo un administrador puede corregir una producción o un conteo cerrado. Cada cambio exige motivo y conserva el valor original, el corregido, fecha, hora y usuario. Una corrección de conteo genera un movimiento compensatorio de producto terminado y recalcula la conciliación. Una corrección de producción siempre recalcula faltante o sobrante; las materias primas solo cambian cuando el administrador corrige explícitamente también la cantidad de receta/lote, dejando movimientos compensatorios por ingrediente. El historial se consulta desde el detalle administrativo del empaque.

## Responsabilidades

- Administrador: administra listas informativas y puede actuar por un panadero autorizado.
- Panadero: consulta su lista y registra libremente lo producido.
- Contador/empaquetador: registra el resultado de la máquina sin conocer previamente el reporte del panadero.

## Compatibilidad temporal

Los endpoints y tablas históricos permanecen disponibles hasta los bloques posteriores. No se elimina código histórico en esta etapa.

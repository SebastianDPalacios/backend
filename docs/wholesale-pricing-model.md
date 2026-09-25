# Modelo comercial de Mayoristas

## Alcance del Bloque 14

Mayoristas se define como una condición comercial del cliente. No es una categoría de producto ni crea una segunda existencia física.

Este bloque formaliza las reglas y su resolución en dominio. No crea tablas, no modifica productos duplicados, no mueve inventario y no integra todavía el precio resuelto en la creación de pedidos.

## Conceptos

- **Producto físico:** producto único usado por producción, conteo, daños e inventario.
- **Precio regular:** precio comercial predeterminado del producto.
- **Precio mayorista general:** precio disponible para todos los clientes mayoristas durante su vigencia.
- **Precio especial del cliente:** excepción aplicable a un cliente mayorista y producto determinados.
- **Fotografía del precio:** valores resueltos al crear el pedido que deben persistirse en el detalle para impedir recálculos históricos.

## Prioridad oficial

Para un cliente mayorista:

1. Precio especial del cliente activo y vigente.
2. Precio mayorista general activo y vigente.
3. Precio regular.

Para un cliente que no es mayorista siempre se utiliza el precio regular, aunque existan configuraciones mayoristas.

## Estados de una configuración de precio

- `active`: activa y vigente para la fecha efectiva.
- `scheduled`: su fecha inicial todavía no llegó.
- `expired`: su fecha final ya pasó.
- `inactive`: fue desactivada administrativamente.
- `missing`: no existe una configuración en ese nivel.

Solamente `active` participa en la resolución. Los demás estados continúan con el siguiente nivel de prioridad.

## Flujo

```text
Seleccionar cliente y producto
        |
        v
¿El cliente es mayorista?
   | No                 | Sí
   v                    v
Precio regular     ¿Hay precio especial activo y vigente?
                         | Sí              | No
                         v                 v
                 Precio especial     ¿Hay precio general activo y vigente?
                                           | Sí              | No
                                           v                 v
                                    Precio mayorista    Precio regular
```

## Fotografía requerida para el pedido

Cuando se integre esta regla al flujo de pedidos, cada detalle deberá conservar como mínimo:

- Precio regular de referencia.
- Precio unitario aplicado.
- Origen: `customer_special`, `wholesale_general` o `regular`.
- Identificador de la configuración, cuando exista.
- Fecha efectiva de resolución.

Modificar una configuración posteriormente no debe recalcular detalles históricos.

## Inventario físico

La resolución de precios no crea ni selecciona inventarios diferentes. Las variantes comerciales futuras deberán apuntar al mismo producto físico. La consolidación de duplicados y cualquier movimiento de existencias quedan expresamente fuera de este bloque.

## Venta + vendaje

Este bloque no modifica `sales-rules.js`. La regla existente continúa recibiendo el precio unitario comercial que corresponda y conserva su cálculo:

```text
(valor facturado + valor generado por el porcentaje de vendaje) / precio del producto
```

La integración con pedidos y la persistencia de componentes se realizará en un bloque posterior.

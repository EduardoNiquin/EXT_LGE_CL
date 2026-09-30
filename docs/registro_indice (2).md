---
registro: acciones-de-usuario
version: 1
archivo: indice
sesion: 2026-09-30_12-40-07
inicio: 2026-09-30 12:40:07
fin: 2026-09-30 12:41:32
duracion: 1m 25s
eventos: 72
paginas: 4
partes: 1
---

# Registro de acciones - resumen

Grabacion de lo que hizo una persona en el navegador, paso a paso, pensada para
reconstruir el flujo y evaluar como automatizarlo.

**Fin de la grabacion:** usuario.

## Partes

| archivo | eventos | desde | hasta |
|---|---|---|---|
| `registro_1.md` | 31 | 12:40:13 | 12:41:26 |

## Recorrido

| # | pagina | URL | entro | acciones |
|---|---|---|---|---|
| P1 | - | about:blank | 12:40:07 | 3 |
| P2 | Global Shipping Rule Management / Magento Admin | https://shop.lg.com/obsadm/global_shippingrule/management/index/key/5c7312680da72ca78c299424c4a92ffaaefed43f8ea30fa3d1c21e1dae6d196b/ | 12:40:17 | 6 |
| P3 | Edit Shipping Method Rule / Magento Admin | https://shop.lg.com/obsadm/global_shippingrule/management/edit/entity_id/1424/key/8bb89fb3b66e61743cd493b1e385ea67666a955ad486e83e1b2d30c6b10ef04b/ | 12:40:39 | 4 |
| P4 | Global Shipping Rule Management / Magento Admin | https://shop.lg.com/obsadm/global_shippingrule/management/index/key/5c7312680da72ca78c299424c4a92ffaaefed43f8ea30fa3d1c21e1dae6d196b/ | 12:41:03 | 15 |

## Acciones por tipo

| tipo | cantidad |
|---|---|
| clic | 24 |
| pagina.visita | 19 |
| pagina.inventario | 13 |
| pagina.oculta | 3 |
| navegacion | 3 |
| desaparecio | 2 |
| aparecio | 2 |
| sesion.inicio | 1 |
| tecla | 1 |
| pestana.abierta | 1 |
| pestana.activada | 1 |
| campo.cambio | 1 |
| sesion.fin | 1 |

## Como leer estos archivos

- Cada `## P<n>` es una **pagina visitada**: primero su inventario (que habia disponible) y despues las acciones que se hicieron ahi.
- Cada `#### #<id>` es una **accion**, con la hora, el selector del elemento y el efecto que tuvo.
- `Causado por #<id>` enlaza una navegacion con el clic o el envio que la provoco, aunque esten en partes distintas.
- Los valores marcados como *(enmascarado)* se omitieron a proposito: solo se guardo el largo.

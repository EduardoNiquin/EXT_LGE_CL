# Magento (apartado paraguas)
Apartado paraguas para herramientas del admin de Magento que no encajan en una feature propia. Router de 2 niveles: `popup/view.js` lista los módulos (`MODULES`) y monta el elegido. Sub-secciones: **Buscar orden**, **Informacion de Orden**, **Crear Softbundles**, **Global Shipping Rules**, **Editar Shipping Rules** y **Ventas en vivo**.
**Cada módulo trae su propio run en storage y su propia state machine**; `magento/content/index.js` las engancha todas con una sola llamada desde `src/content/index.js`, y `magento/debug.js` importa los `debug.js` de los módulos para que un único import registre todos los comandos. Al sumar un módulo hay que tocar los dos, o queda escrito pero muerto (le pasó a Buscar orden: existía completo y no aparecía en ningún lado).


Módulos: [Buscar orden](magento-buscar-orden.md) · [Informacion de Orden](magento-informacion-de-orden.md) · [Crear Softbundles](magento-softbundles.md) · [Global Shipping Rules](magento-global-shipping-rules.md) · [Editar Shipping Rules](magento-editar-shipping-rules.md) · [Ventas en vivo](magento-ventas-en-vivo.md).
**Ventas en vivo** es el unico modulo que corre en el **service worker** (alarma) y no en la pestana: ademas de `view.js`, `debug.js` y `content/index.js` se cablea en `src/background/service-worker.js` (`wireVentasEnVivoBackground()`).
El bridge del mundo MAIN (`content/bridge.js`) es compartido por todo el apartado; está documentado en el doc de Global Shipping Rules.

# Magento — Editar Shipping Rules
Activa o desactiva Global Shipping Rules en lote. **Solo cambia el campo `is_active`** ("Active this shipping rule") y el unico boton que pulsa es **Save** (`#save`). Nunca "Delete" (ni la accion masiva "Delete", la unica que trae la grilla). Cada corrida guarda el estado **antes y despues** de cada rule, se exporta a Excel/CSV y queda en un historial desde el que se puede **revertir**.

```
src/features/magento/editar-shipping-rules/
├── constants.js   STORAGE_KEYS (run/catalog/history), MESSAGES (load-catalog, claim), ACTION, ITEM_STATUS, SAVED_RE, timeouts
├── catalog.js     puro: buildRulesGridUrl, parseRulesGrid, slimRule, filterRules/parseTerms/missingIds
├── export.js      puro: changeRows (una fila por rule), buildChangesCsv, exportFilename
├── state.js       run store + catalogo + historial (cap 30) + makeRun/historyEntryOf
├── debug.js       __extLgeCl.magentoEditarShippingRules.*
├── content/ detector.js · catalog-fetch.js · index.js · flows/run.js
└── popup/section.js
```
Ademas usa la operacion `shipping-rule-active` del bridge MAIN compartido (`magento/content/bridge.js`).

## Flujo
1. **Leer rules** (popup → content, one-shot `load-catalog`): un GET a `mui/index/render` con `namespace=shipping_rule_management_listing`, 500 por pagina, ordenado por ID. La key del endpoint se resuelve con `resolveGridEndpoint` de Informacion de Orden (la key de `mui/index/render` es la misma para todos los grids). Se guarda en `magento:editar-shipping-rules:catalog`.
2. **Elegir**: busqueda por nombre FE/BE, codigo, carrier o descripcion (sin tildes); varios terminos separados por coma o linea; un numero calza con el ID exacto o como numero completo en el nombre ("66" trae las `[Rule 66]`, no la #1466). Filtros Todas/Activas/Inactivas y carrier. Avisa los IDs pegados que no existen.
3. **Activar / Desactivar** con confirmacion en linea que lista el antes → despues; las que ya estan en el estado pedido se revisan pero no se guardan.
4. **Corrida** (tick-por-reload, `wireReloadTickLifecycle`): el popup escribe el run y manda `claim` a la pestana activa, que guarda el id del run en **sessionStorage** (por pestana, sobrevive a sus navegaciones). Solo esa pestana ejecuta: otra pestana del admin abierta no corre la misma cola.
   - **EDIT** con rule en APPLYING: el bridge lee `is_active` y el `entity_id` del data source (si no coincide con la rule esperada, error sin tocar nada). Ya en el estado pedido → `UNCHANGED`. Si no, el bridge fija el valor, se marca SAVING (con `navigating` levantado ANTES de escribir) y se pulsa Save.
   - Vuelta del Save (EDIT o LISTING con rule en SAVING): `"The rule has been saved."` → OK; mensaje de error → ERROR.
   - Al vaciar la cola: **verificacion** con un GET al grid; `verified` = el listado muestra el estado pedido. Si no, la rule pasa a ERROR. El catalogo del popup se actualiza con esa lectura y la corrida va al historial.
5. **Exportar**: Excel (`xlsx`, hoja "Cambios" con autofiltro) o CSV (BOM, protegido contra formulas). Columnas: Fecha, Corrida, Accion, ID, nombres FE/BE, Carrier, Estado anterior, Estado nuevo, Resultado, Verificado en listado, Detalle, URL. El historial tambien exporta todo junto.
6. **Revertir**: toma solo las rules que la corrida cambio de verdad (OK y `before !== target`) y arma una corrida nueva con `target = before`.

**Estado (`magento:editar-shipping-rules:run`):** `{ id, active, phase: running|verifying|done, action: activate|deactivate|revert, revertOf, startedAt, finishedAt, finishReason, error, listingUrl, currentIndex, redirects, items:[{ id, nameFe, nameBe, carrier, editHref, catalogActive, target, before, after, status: pending|applying|saving|ok|unchanged|error, error, note, verified, changedAt }], log }`.

## Quirks (medidos en el admin real, 30-09-2026)
- **Con la pestana en segundo plano Magento no dibuja nada con Knockout**: el listado tiene 200 `<tr>` vacios y el formulario no tiene ni un checkbox en el DOM. Los UI components si estan en el `uiRegistry`. Por eso el catalogo va por el endpoint del grid y el campo se lee/fija en el componente `single-checkbox` (`valueMap {true:'1', false:'0'}`) via bridge; el `#save` si existe en el DOM y funciona.
- **La grilla recuerda la ultima pagina vista** (bookmark): quedo en la pagina 2 con 200 por pagina y 267 rules ⇒ "0 records found". Es lo que se ve en la grabacion del usuario. Leer por el endpoint con `paging[current]=1` lo evita. (Global Shipping Rules, que lee el DOM y vuelve a la primera pagina con el boton "anterior", probablemente cae en esto: con total 0 el "anterior" esta deshabilitado.)
- **Tras el Save Magento vuelve al MISMO formulario** (abierto desde el enlace de edicion), no al listado como en la grabacion. Se aceptan los dos destinos; lo que decide es el mensaje.
- **Arriba se acumulan mensajes de exito de otras tareas** ("Task \"Trigger recollect totals...\" ... successfully updated"): el exito se reconoce con `SAVED_RE`, no con cualquier `.message-success`.
- **Sin la `key` en la URL Magento redirige al dashboard**: las URLs de edicion salen del grid (`actions.edit.href`); la del listado, de `location.href` o del menu lateral.
- **El formulario tarda en registrar sus componentes** con la pestana oculta: la lectura reintenta hasta `FORM_READY_TIMEOUT_MS` (30 s).
- **Save que no sale del formulario** en `SAVE_TIMEOUT_MS` ⇒ validacion del navegador ⇒ ERROR. Si la navegacion YA arranco (`beforeunload`/`pagehide`), no se toca nada aunque tarde: navegar a otro lado cancelaria el guardado.
- Verificado con un diff del data source del formulario antes/despues del guardado real de la #1424: solo cambiaron `is_active` (0→1) y `updated_at`.

**Debug `__extLgeCl.magentoEditarShippingRules.`:** `diagnose()`, `field()` (lee `is_active` sin tocarlo), `rules()` (GET al grid), `catalog()`, `history()`, `state()`, `stop()`, `reset()`, `tick()`.
**Tests:** `tests/unit/magento-editar-shipping-rules.test.js` (catalogo, filtros, run, export).
**Pendientes:** solo `is_active` (otros campos: mismo patron, un op de bridge por campo); una sola pestana por corrida; la corrida se cancela desde el popup pero la rule que estaba en SAVING queda "sin confirmar".

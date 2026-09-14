# Package Rule / Soft Bundle — referencia técnica para automatizar

Adobe Commerce **2.4.5-p16** · admin `https://shop.lg.com/obsadm` · módulo *Package Rule*
(menú **Catalog → Package Rule**).

Este documento está escrito para que una IA o una extensión de navegador pueda **crear Package Rules
de principio a fin sin intervención humana**. Todo lo que hay aquí está verificado ejecutándolo contra
el admin real el **2026-09-14**, no deducido de la documentación de Magento.

Índice:

1. [Modelo de datos](#1-modelo-de-datos)
2. [Requisitos de red](#2-requisitos-de-red)
3. [URLs, `key` y `form_key`](#3-urls-key-y-form_key)
4. [El scope de website](#4-el-scope-de-website)
5. [La grilla de reglas](#5-la-grilla-de-reglas)
6. [Crear el padre](#6-crear-el-padre-cabecera)
7. [Los dos selectores de SKU](#7-los-dos-selectores-de-sku-la-clave-de-todo)
8. [Añadir hijos](#8-añadir-hijos-ofertas)
9. [Endpoints y payloads](#9-endpoints-y-payloads)
10. [Errores y recuperación](#10-errores-y-recuperación)
11. [Helpers de DOM](#11-helpers-de-dom-imprescindibles)
12. [Guion completo](#12-guion-completo-de-referencia)
13. [Paralelismo](#13-paralelismo-con-varias-ventanas)
14. [Pruebas ejecutadas](#14-pruebas-ejecutadas)
15. [Anexo: reglas borradas](#anexo-respaldo-de-las-reglas-borradas)

---

## 1. Modelo de datos

```
Package Rule (el "padre")
├── package_id          identificador de la regla
├── product_sku         SKU del producto padre        ← 1 por regla, único en todo el sistema
├── store_id            store view al que aplica
├── vigencia, estado, flags
└── Offers (los "hijos")                              ← N por regla
    ├── id              identificador de la oferta
    ├── product_sku     SKU del producto hijo
    ├── descuento por grupo de cliente
    └── reparto del descuento entre padre e hijo
```

Dos hechos que gobiernan toda la automatización:

- **Un SKU padre sólo puede tener una regla.** Intentar una segunda da `This sku has been existed.`
- **Un padre admite varios hijos.** Cada hijo es una *offer* independiente, con su propio POST y su
  propio ID. Se añaden en bucle sobre la misma regla ya guardada.

---

## 2. Requisitos de red

El admin sólo responde desde la red de LG. Con el túnel de este repositorio:

```powershell
Start-Process .\dist\enlace-lg.exe                             # SOCKS5 en 127.0.0.1:1080
curl -s --socks5-hostname 127.0.0.1:1080 https://ifconfig.me   # debe responder 136.166.250.99
```

Chrome instrumentable (CDP en el 9222, que es donde se engancha el MCP de DevTools):

```
chrome.exe --remote-debugging-port=9222
           --proxy-server=socks5://127.0.0.1:1080
           --proxy-bypass-list=<-loopback>
           --user-data-dir=%LOCALAPPDATA%\enlace-lg\chrome
           --no-first-run --no-default-browser-check
```

`--user-data-dir` aparte es obligatorio: desde Chrome 136 la depuración remota no funciona sobre el
perfil por defecto, y el flag de proxy se ignora en silencio si se adjunta a una instancia ya abierta.
`<-loopback>` deja el loopback fuera del proxy para que el 9222 no entre en el túnel.

---

## 3. URLs, `key` y `form_key`

Todas las rutas del admin llevan `/key/<hash>/`. Dos propiedades **verificadas** que simplifican mucho:

- La `key` depende de **la ruta (controlador/acción), no del registro**. Las tres filas de la grilla
  comparten la misma `key` de Edit, y es la misma que se usó con `package_id` 124315, 124318, 125442,
  125445 y 125448. Basta capturarla una vez por sesión y construir las URLs cambiando el id.
- El `form_key` es **constante durante toda la sesión** (`PzlpckBdgvFvwWXN` en las pruebas). Se lee de
  `input[name="form_key"]` o de la cookie del mismo nombre.

| Acción | Ruta |
|---|---|
| Grilla | `packagerule/package/index/website/111/key/<K_INDEX>/` |
| Nueva regla | `packagerule/package/new/website/111/key/<K_NEW>/` |
| Editar regla | `packagerule/package/edit/package_id/<id>/website/111/key/<K_EDIT>/` |
| Borrar regla | `packagerule/package/delete/package_id/<id>/website/111/key/<K_DEL>/` |
| Duplicar regla | `packagerule/package/duplicate/package_id/<id>/website/111/key/<K_DUP>/` |
| Borrar oferta | `packagerule/packageproductitem/delete/id/<offer_id>/package_id/<id>/key/<K_ITEMDEL>/` |

Cómo capturarlas al arrancar, desde la grilla:

```js
const keys = {};
document.querySelectorAll('tbody tr[data-repeat-index] a').forEach(a => {
  const t = a.textContent.trim();
  const m = a.href && a.href.match(/\/(\w+)\/(?:package_id|id)\/\d+.*?\/key\/([a-f0-9]+)/);
  if (m) keys[t] = m[2];               // Edit / Delete / Duplicate
});
const formKey = document.querySelector('input[name="form_key"]').value;
```

> No intentes inventar una `key`: sin ella el admin responde con un error y redirige.

---

## 4. El scope de website

**La grilla no muestra nada hasta que se fija el website.** Sin `/website/111/` en la URL, el botón
dice `Select Website` y la tabla marca `0 records found` aunque haya miles de reglas.

Dos formas de fijarlo:

- **Recomendada para automatizar:** incluir `/website/111/` en la URL. Directo, sin interacción.
- Por interfaz: botón `Select Website` → enlace `Chile Website` → **modal de confirmación**
  *«Please confirm scope switching. All data that hasn't been saved will be lost.»* → botón `OK`
  (`.modal-popup button` con texto `OK`). La página recarga con `/form_key/<fk>/website/111/`.

`111` = Chile Website. El store view de Chile es `123` = *Chile Default Store View*.

El modal tarda en aparecer: hay que esperar a que exista en el DOM, no buscarlo inmediatamente.

---

## 5. La grilla de reglas

### 5.1 Filtros

Botón `Filters` → campos dentro de `.admin__data-grid-filters` → botón `Apply Filters`.

| Filtro | `name` |
|---|---|
| ID desde/hasta | `package_id[from]` · `package_id[to]` |
| From desde/hasta | `from_date[from]` · `from_date[to]` |
| To desde/hasta | `to_date[from]` · `to_date[to]` |
| Main Product | `product_sku` |
| Apply to | `store_id` (select) |
| Description | `descriptions` |
| Marketing text | `marketing_text` |
| Status | `is_active` (select) |
| Show related product when out of stock | `is_show_out_of_stock` (select) |
| Related Product | `related_product_sku` |

`product_sku` y `related_product_sku` son los dos que sirven para localizar una regla por SKU.

Los filtros **persisten**: tras `Save` se vuelve a la grilla con el filtro puesto, y se mantienen al
navegar por URL dentro de la misma sesión. Para limpiarlos, pulsar las `x` de
`.admin__current-filters-list`.

### 5.2 Columnas

`ID` · `Main Product` · `Apply to` · `Description` · `Marketing text` · `Status` ·
`Show related product when out of stock` · `Related Product` · `From` · `To` · `Action`

`Related Product` lista los hijos separados por coma — útil para verificar sin abrir la regla.

### 5.3 Borrar una regla

1. En la fila, el enlace `Delete` (ya existe en el DOM aunque el menú `Select` esté cerrado)
2. Modal *«Delete — Are you sure you want to delete selected item?»* → `OK`
3. Recarga con **`The package has been deleted.`**

Borrar la regla borra sus ofertas en cascada.

---

## 6. Crear el padre (cabecera)

Botón `Add New Package` → formulario `packagerule/package/new/website/111/key/<K_NEW>/`.

Todos los campos viven bajo el componente
`packagerule_package_form.packagerule_package_form.general.<data-index>`, accesible por `uiRegistry`.

| Campo | `data-index` / `name` | Tipo | Notas |
|---|---|---|---|
| Apply To | `store_id` | `select[multiple]` | `123` = Chile Default Store View. **Obligatorio y primero**: hasta elegirlo, *Main Product* no carga |
| Main Product | `product_sku` | ui-select | ver §7 |
| Descriptions | `descriptions` | texto | opcional |
| Marketing text | `marketing_text` | tabla con botón `Add` | lleva `*` pero **guarda vacío** (verificado) |
| Active | `is_active` | switch | `"1"` / `"0"` |
| Combinable discount with normal coupon | `combinable_coupon` | switch | por defecto No |
| Active From | `from_date` + hora | datepicker | **obligatorio**, formato `mm/d/yy` |
| Active To | `to_date` + hora | datepicker | vacío = sin fin |
| Maximum number of related products can be added to cart | `maximum_related_add_to_cart` | número | opcional |
| Show related product when out of stock | `is_show_out_of_stock` | switch | **por defecto Yes** |

Campos que viajan en el modelo aunque no se editen: `package_id`, `website_code` (`cl`),
`is_discount_on_total_package`, `total_package_discount_rate`, `parent_id`, `is_hide_split_on_frontend`,
`can_hide_split`, `can_edit_duplicate_rule`.

### 6.1 Fechas

`input[name="from_date"]` y `input[name="to_date"]`, jQuery UI datepicker con formato **`mm/d/yy`**:
mes con dos dígitos, día sin cero a la izquierda, año de cuatro → `09/13/2026`. Las horas van en
inputs aparte y vienen `00:00` y `23:59`. Escribir el texto y disparar `change` es suficiente; no hay
que abrir el calendario.

### 6.2 Switches

El `input[type=checkbox]` está **oculto** tras el switch: un `click()` directo falla con *«element did
not become interactive»*. Hay que pulsar su etiqueta:

```js
const cb = document.querySelector('input[name="is_active"]');
if (cb.checked !== deseado) cb.parentElement.querySelector(`label[for="${cb.id}"]`).click();
```

### 6.3 Guardar

| Botón | Efecto |
|---|---|
| `Save and Continue Edit` | guarda y **se queda en la regla**, con la grilla de ofertas ya disponible. Es el que hay que usar antes de añadir hijos |
| `Save` | guarda y **vuelve a la grilla**, conservando los filtros que hubiera |
| `Back` · `Reset` | salir sin guardar / limpiar |

Éxito: mensaje `The rule has been saved.`, título `Edit <SKU>` y URL

```
packagerule/package/edit/package_id/<nuevo_id>/website/111/key/<K_EDIT>/back/edit/form_key/<fk>/
```

El id nuevo se lee de la URL o del modelo:

```js
registry.get('packagerule_package_form.packagerule_package_form.general.package_id').value()
```

---

## 7. Los dos selectores de SKU (la clave de todo)

El formulario tiene **dos** `ui-select` de producto que se parecen pero se comportan al revés. Es el
punto donde más se atasca la automatización.

| | **Main Product** (padre) | **Related Product SKU** (hijo) |
|---|---|---|
| Dónde | formulario principal | modal de oferta |
| Origen de datos | ~100 opciones precargadas | **consulta al servidor en cada tecla** |
| Buscar | filtra **sólo lo ya cargado** (`filterOptionsList`) | `POST searchrelatedproducts` |
| Crece con scroll | sí (`onScrollDown`) | no hace falta |
| Oculta SKUs ya usados | **sí** | no |
| Hay que forzar | a veces (ver abajo) | nunca en las pruebas |

Estructura DOM de ambos:

```
[data-index="product_sku"] .admin__action-multiselect-wrap
  ├── [data-role="advanced-select"]        ← la caja que se pulsa para desplegar
  ├── [data-role="selected-option"]        ← el texto «Select...» / el SKU elegido
  ├── input[data-role="advanced-select-text"]   ← el buscador (id = <uid>+"2")
  └── ul.admin__action-multiselect-menu-inner   ← la lista
```

### 7.1 Por qué un SKU no aparece en *Main Product*

Dos causas distintas, y conviene no confundirlas:

1. **Ya tiene un Package Rule.** El selector sólo ofrece productos libres.
   *Verificado dos veces:* `CL.43NU800BPSC.AWHQ` y `CL.43NU855BPSA.AWH` no aparecían; tras borrar sus
   reglas (124315 y 124318) el mismo buscador los encontró a la primera.
2. **Su lote aún no se ha descargado.** Como el filtro es local, un producto libre tampoco aparece si
   está fuera de las ~100 opciones cargadas. Aquí sí es una limitación del widget.

Para distinguirlas: filtrar la grilla por ese SKU en *Main Product*. Si sale una regla, es el caso 1.

### 7.2 Forzar un SKU en *Main Product*

Sirve para el caso 2 y como camino único para la automatización (funciona en ambos casos, y el error
de duplicado se detecta luego al guardar):

```js
const ko = await new Promise(r => require(['ko'], r));
const c  = ko.dataFor(document.querySelector('[data-index="product_sku"] .admin__action-multiselect-wrap'));
const o  = { value: SKU, label: SKU, level: 1, path: '', isVisited: false };
c.options([o, ...c.options()]);      // inyectar en la lista
c.cacheOptions.plain.unshift(o);     // y en la caché
c.toggleOptionSelected(o);           // seleccionar con la API propia del componente
// comprobar: c.value() === SKU && c.setCaption() === SKU && c.error() === ''
```

Usar `toggleOptionSelected` y **no** asignar `c.value(...)` a pelo: así quedan sincronizados el valor,
el caption visible y el provider del formulario.

El backend **acepta el valor inyectado**: valida contra el catálogo, no contra el desplegable. Por eso
esto sirve para SKUs legítimos que el widget no alcanza a listar, y no sirve —ni debe— para saltarse
el control de duplicados.

**Estrategia recomendada:** intentar primero el buscador; si no devuelve el SKU, forzarlo.

```js
c.filterInputValue(SKU);
await esperar(1500);
let op = c.options().find(o => o.value === SKU);
if (!op) { /* forzar como arriba */ }
```

---

## 8. Añadir hijos (ofertas)

Requiere la regla **ya guardada** (`Save and Continue Edit`). Se repite este bloque por cada hijo.

Botón `Add New Offer` (`span[data-index="modal_button"]`) → modal **New Package Offer**
(`.modal-slide._show`). Botones: `Close` · `Save` · `Add`.

### 8.1 Elegir el hijo

1. Clic en `[data-role="advanced-select"]` del `[data-index="product_sku"]` **dentro del modal**
2. Escribir en el buscador — **sin el prefijo `CL.`**: se teclea `S20A.CCHLLLK` y devuelve
   `CL.S20A.CCHLLLK`. Cada pulsación dispara `POST searchrelatedproducts`
3. Seleccionar la opción → dispara `POST loaddatabysku`, que **rellena la tabla de precios por grupo
   de cliente**. Hay que esperar a que exista `input[class*="discount-rate-"]` antes de seguir

### 8.2 Campos del modal

`name` = `general_item[offer_package_modal][packageruleitem][<data-index>]`

| Campo | `data-index` | Tipo | Por defecto |
|---|---|---|---|
| Active | `is_active` | switch | **Yes** |
| Related Product SKU | `product_sku` | ui-select remoto | vacío |
| Maximum Qty to Offer | `limited_qty` | texto | `1` |
| Display promotion text | `is_display_promotion_text` | switch | No |
| Promotion Text | `promotion_text` | texto | vacío |
| Display promotion description | `is_display_promotion_desc` | switch | No |
| Promotion Description | `promotion_desc` | texto | vacío |
| Priority | `priority` | texto | `0` |
| Customer group | `customer_group` | oculto | se rellena con `loaddatabysku` |
| Display discount rate of 0% | `is_display_discount_rate_zero_percent` | switch | ver aviso |
| (precios y descuentos) | `discount_rate_group` | oculto JSON | `{}` |
| Enable splitting discount to main product | `is_split` | switch | No |
| Discount percentage applied on main product | `main_discount_rate` | número | `1` |
| Discount percentage applied on related product | `discount_related` | texto | `99` |

El porcentaje de descuento se teclea en la tabla de grupos de cliente:
`input[name="general_item_edit[edit_modal][packageruleitem][discount-rate-<n>]"]`
(clase `discount-rate-<n>`), **uno por grupo**. Con un solo grupo (`B2C`) el sufijo es `1`.

> ⚠ **`Display discount rate of 0%` se pone en Yes al cargar el SKU.** En el modal vacío figura como
> No, pero después de `loaddatabysku` queda en Yes. Si se quiere No hay que **apagarlo explícitamente**
> — comprobado: una oferta creada sin tocarlo quedó en Yes y hubo que editarla.

### 8.3 El reparto del descuento

`main_discount_rate` y `discount_related` son los **porcentajes en que se reparte el importe del
descuento** entre padre e hijo. Por defecto `1` / `99` (suman 100).

Con `is_split` = Yes, `main_discount_rate` = 50, hijo de `$67.218,49` al `5 %`:

| Concepto | Valor | Cálculo |
|---|---|---|
| Normal Price | $67.218,49 | precio del hijo |
| Discount Rate | 5,00 % | lo tecleado en `discount-rate-1` |
| Discount Amount | $3.360,92 | 5 % de 67.218,49 |
| Discount Amount on main product | $1.680,46 | 50 % del importe |
| Discount Amount on related product | $1.680,46 | el resto |
| **Package Price** | **$65.538,03** | 67.218,49 − 1.680,46 |

`discount_related` **se recalcula solo** a `100 − main_discount_rate` cuando el cambio se asienta,
pero en una captura del alta manual viajó `main=50` con `discount_related=99` (se guardó antes del
recálculo) y el resultado fue igualmente 50/50: el servidor manda sobre `main_discount_rate`.
Aun así, **al automatizar conviene leer `discount_related` antes de guardar y verificar que suma 100**.

### 8.4 Guardar la oferta

Botón `Save` del modal → `POST packagerule/packageproductitem/save/...` (§9). El modal se cierra y la
grilla se recarga sola con `GET mui/index/render/?namespace=packagerule_packageproductitem_listing`.

**Al terminar todos los hijos, pulsar `Save` en la cabecera** para volver a la grilla.

### 8.5 La tabla de hijos

`ID` · `Related Product SKU` · `Maximum Qty to Offer` · `Status` · `Display promotion text` ·
`Promotion Text` · `Display promotion description` · `Promotion Description` · `Priority` ·
`Normal Price` · `Discount Rate` · `Discount Amount` · `Discount Amount on main product` ·
`Discount Amount on related product` · `Display discount rate of 0%` · `Package Price` · `Action`

Los importes van prefijados por grupo de cliente (`B2C: $67.218,49`). En `Action`, el `Select` abre
`Edit` (modal *Edit Package Offer*, mismo formulario) y `Delete` (URL directa).

---

## 9. Endpoints y payloads

Todos con `?isAjax=true`, `Content-Type: application/x-www-form-urlencoded`, y la cookie de sesión del
admin.

### Buscar productos hijo

```
POST packagerule/package/searchrelatedproducts/key/<key>/?isAjax=true
package_id=<id>&sku=<texto tecleado>&form_key=<fk>
```

### Cargar precios de un hijo

```
POST packagerule/packageproductitem/loaddatabysku/sku/<SKU>?isAjax=true
form_key=<fk>
```

### Guardar una oferta

```
POST packagerule/packageproductitem/save/key/<key>/?isAjax=true
```

Cuerpo real capturado (urldecodificado):

```
form_key=<fk>
data[package_id]=125442
data[is_active]=1
data[product_sku]=CL.S20A.CCHLLLK
data[limited_qty]=1
data[is_display_promotion_text]=0
data[promotion_text]=
data[is_display_promotion_desc]=0
data[promotion_desc]=
data[priority]=0
data[customer_group]={"1":"B2C"}
data[is_display_discount_rate_zero_percent]=0
data[discount_rate_group]={"normal_price":"{\"B2C\":67218.49}","discount_rate":"{\"B2C\":\"5.00\"}"}
data[is_split]=1
data[main_discount_rate]=50
data[discount_related]=99
data[promotion_multi_text]=[]
data[is_discount_on_total_package]=0
data[total_package_discount_rate]=
```

> `discount_rate_group` es **JSON con JSON anidado en forma de cadena**: `normal_price` y
> `discount_rate` son strings que contienen JSON. Hay que replicar ese formato exacto.

### Recargar la grilla de ofertas

```
GET mui/index/render/key/<key>/?namespace=packagerule_packageproductitem_listing&...
```

> **Sobre atacar la API directamente:** los endpoints están documentados por si sirven para verificar
> o para diagnosticar. Para la extensión es más seguro conducir la interfaz, porque el formulario
> calcula `discount_rate_group` y `customer_group` a partir de lo que devuelve `loaddatabysku`, y
> replicar ese cálculo a mano es frágil.

---

## 10. Errores y recuperación

| Mensaje | Dónde | Significado | Qué hacer |
|---|---|---|---|
| `This sku has been existed.` | tras `Save`/`Save and Continue Edit` | ya hay una regla con ese padre | localizar y borrar la regla existente, reintentar |
| `The rule has been saved.` | idem | éxito | seguir |
| `The package has been deleted.` | tras borrar | éxito | — |

**Nunca es un fallo del SKU:** el servidor lo reconoció y lo validó contra el catálogo. Los mensajes se
leen de `.messages .message`; el tipo va en la clase (`message-error` / `message-success`).

Rutina de recuperación, ya probada de extremo a extremo:

```
crear(padre, hijos):
    r = intentarCrear(padre)
    si r.error == "This sku has been existed.":
        id = buscarEnGrilla(padre)          # Filters → product_sku → Apply
        respaldar(id)                       # opcional pero recomendable
        borrar(id)                          # Delete → modal OK
        r = intentarCrear(padre)            # ahora el buscador incluso lo encuentra solo
    para cada hijo: añadirOferta(r.package_id, hijo)
    guardarCabecera()
```

**Mejor aún: comprobarlo antes.** Filtrar la grilla por el SKU padre *antes* de abrir el formulario
ahorra el intento fallido y deja decidir entre borrar, saltar o avisar.

---

## 11. Helpers de DOM imprescindibles

```js
const esperar = ms => new Promise(r => setTimeout(r, ms));

// esperar por condición, mejor que dormir a ciegas
async function esperarA(cond, timeout = 20000, paso = 250) {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    const v = cond();
    if (v) return v;
    await esperar(paso);
  }
  throw new Error('timeout esperando condición');
}

// escribir en un input de forma que Knockout se entere
function escribir(el, valor) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// switches: el checkbox está oculto, se pulsa la etiqueta
function conmutar(nameParcial, deseado, raiz = document) {
  const cb = raiz.querySelector(`input[name*="${nameParcial}"]`);
  if (cb.checked !== deseado) cb.parentElement.querySelector(`label[for="${cb.id}"]`).click();
  return cb.checked;
}

// botón por texto exacto
const boton = (txt, raiz = document) =>
  [...raiz.querySelectorAll('button, span')].find(b => b.textContent.trim() === txt);

const mensajes = () =>
  [...document.querySelectorAll('.messages .message')].map(m => ({
    error: m.className.includes('error'), texto: m.textContent.trim()
  }));
```

Una asignación directa (`el.value = x`) **no** actualiza el modelo de Knockout: el campo parece
relleno y se guarda vacío. Por eso el setter nativo.

---

## 12. Guion completo de referencia

Secuencia verificada para `crear(padreSKU, [hijos], opciones)`. Cada bloque separado por navegación
tiene que ejecutarse en un contexto nuevo (la navegación destruye el anterior).

```
FASE 0 — preparación (una vez por sesión)
  ir a  packagerule/package/index/website/111/key/<K_INDEX>/
  capturar form_key y las keys de Edit/Delete/Duplicate de cualquier fila

FASE 1 — comprobación previa (opcional pero recomendada)
  Filters → product_sku = padreSKU → Apply Filters
  si hay fila:  respaldar, Delete → modal OK, esperar "The package has been deleted."

FASE 2 — cabecera
  clic Add New Package                            → navega a /new/
  select[name=store_id] → option 123, disparar change
  esperar 2 s (se habilita Main Product)
  Main Product: filterInputValue(padreSKU)
      si no aparece → forzar (§7.2)
      toggleOptionSelected(opcion)
  escribir from_date = <mm/d/yyyy>, to_date = <mm/d/yyyy>
  conmutar is_active → Yes
  conmutar is_show_out_of_stock → según se quiera (viene Yes)
  clic Save and Continue Edit                     → navega a /edit/package_id/<id>/
  leer mensajes:
      "This sku has been existed."  → ir a FASE 1 con borrado y repetir FASE 2
      "The rule has been saved."    → seguir, guardar package_id

FASE 3 — por cada hijo (sin navegación, todo AJAX)
  clic Add New Offer                              → modal
  abrir el ui-select, filterInputValue(hijoSKU sin "CL.")
  esperar a que la opción exista, toggleOptionSelected
  esperar a que aparezca input[class*="discount-rate-"]   ← loaddatabysku terminó
  escribir discount-rate-1 = <porcentaje>
  si reparto:  conmutar is_split → Yes; escribir main_discount_rate = <n>
               verificar discount_related == 100 - n
  conmutar is_display_discount_rate_zero_percent → No   ← ¡se puso Yes solo!
  clic Save (del modal)
  esperar a que el modal cierre y la fila aparezca en la tabla

FASE 4 — cierre
  clic Save (cabecera)                            → vuelve a la grilla con los filtros puestos
  verificar "The rule has been saved."
```

**Verificación final recomendada:** filtrar la grilla por `product_sku` y comprobar que la columna
`Related Product` lista todos los hijos esperados. Es la comprobación más barata de que la regla
quedó completa.

### Tiempos observados

| Punto | Espera típica |
|---|---|
| Carga del formulario nuevo | 5-6 s |
| Tras elegir store view | 2-3 s |
| Filtro del ui-select | 1,5-2 s |
| `loaddatabysku` (precios) | 3-4 s |
| Guardar cabecera u oferta | 6-8 s |
| Recarga de la grilla | 4-6 s |

Son referencias, no garantías: **esperar por condición** (que exista el elemento, que aparezca el
mensaje) en vez de por tiempo fijo.

---

## 13. Paralelismo con varias ventanas

Lo que **se comparte** entre todas las ventanas del mismo perfil de Chrome:

- La **cookie de sesión** del admin, y con ella el `form_key` y todas las `key`. Capturarlos una vez
  y repartirlos a todas las ventanas es válido.
- El **scope de website** que fija el store switcher. Por eso conviene **no usar el switcher** y poner
  siempre `/website/111/` en la URL: cada ventana queda explícita y ninguna depende de lo que hizo
  otra.
- Los **filtros de la grilla** (Magento los guarda por usuario/namespace). Dos ventanas filtrando la
  misma grilla **se pisan los filtros**. Es la interferencia más probable.

Recomendaciones:

1. **Una regla por ventana, sin solapar padres.** Nada obliga a que dos ventanas toquen la misma regla;
   repartir la lista de padres entre N ventanas es seguro.
2. **Evitar la grilla en paralelo.** La fase de comprobación/borrado usa filtros compartidos. Dos
   opciones: hacer esa fase en serie al principio (barrer toda la lista, borrar lo que estorbe) y
   luego paralelizar sólo la creación; o dar a cada ventana su turno sobre la grilla con un mutex.
3. **El formulario y el modal de ofertas sí son seguros en paralelo:** trabajan sobre `package_id`
   distintos y no comparten estado de interfaz.
4. **Concurrencia moderada.** Esto es producción: 3-5 ventanas es un buen punto de partida. Cada
   creación son ~4 navegaciones y varias peticiones AJAX.
5. **Si la sesión caduca, caen todas a la vez.** Ante una redirección al login o un `form_key`
   inválido, parar todo, renovar sesión y recapturar keys: reintentar en paralelo sólo multiplica los
   errores.
6. **Registrar por regla** (padre, resultado, package_id, ids de ofertas, mensaje del servidor) para
   poder reanudar una tanda a medias sin repetir lo hecho.

Con CDP, cada ventana es un *target* independiente; el aislamiento real está en que cada una navegue
con su propia URL con `/website/111/` y no comparta la grilla.

---

## 14. Pruebas ejecutadas

Todo lo anterior sale de estas ejecuciones reales del **2026-09-14**.

### Recorrido de aprendizaje

| # | Acción | Resultado |
|---|---|---|
| 1 | Catalog → Package Rule | grilla vacía, `Select Website` |
| 2 | `Select Website` → `Chile Website` → modal `OK` | `20 records found` |
| 3 | `Filters` → `product_sku` = `CL.43NU800BPSC.AWHQ` | 1 fila: regla **124315** |
| 4 | Crear con ese padre (SKU forzado) | ❌ `This sku has been existed.` |
| 5 | Borrar 124315 → modal `OK` | `The package has been deleted.` |
| 6 | Crear de nuevo — el buscador **ya encontraba el SKU** | ✅ regla **125442** |
| 7 | `Add New Offer` con `S20A.CCHLLLK`, 5 %, split 50 | oferta **88602**, Package Price $65.538,03 |
| 8 | `Save` | vuelve a la grilla con el filtro puesto |

### Tanda final (las dos reglas pedidas)

| Padre | Hijo | Resultado |
|---|---|---|
| `CL.43NU800BPSC.AWHQ` | `CL.S20A.CCHLLLK` | ✅ regla **125445**, oferta **88605** |
| `CL.43NU855BPSA.AWH` | `CL.S20A.CCHLLLK` | ⚠ `This sku has been existed.` → borrada la **124318** → ✅ regla **125448**, oferta **88608** |

Ambas con: store view 123, Active **Yes**, `09/13/2026` → `09/14/2026`,
*Show related product when out of stock* **No**, hijo al **5 %** con `is_split` y reparto **50/50**
(Package Price B2C **$65.538,03**).

El segundo caso reprodujo el ciclo completo de recuperación por duplicado, que es justo lo que la
extensión tiene que saber hacer sola.

---

## Anexo: respaldo de las reglas borradas

Por si hay que reponerlas. Ambas eran del store view `123`, website `cl` (111), `Active`,
`07/20/2026` → `12/31/9999`, `maximum_related_add_to_cart` 0, `parent_id` 0,
`is_discount_on_total_package` 0, `descriptions` vacío, y marketing text
`CL — OMD: Combinación perfecta para tu producto.` / `OMV: Combinación perfecta para tu producto.`

### 124315 — `CL.43NU800BPSC.AWHQ` (`is_show_out_of_stock` = 1)

| Oferta | SKU hijo | Qty | Estado | Normal Price | Descuento | Package Price |
|---|---|---|---|---|---|---|
| 84289 | CL.4430JA2010B | 1 | Active | B2C: $54.613,00 | 0 % | B2C: $54.613,00 |
| 84286 | CL.MAZ65396435 | 1 | Active | B2C: $30.244,00 | 0 % | B2C: $30.244,00 |

### 124318 — `CL.43NU855BPSA.AWH` (`is_show_out_of_stock` = 0)

| Oferta | SKU hijo | Qty | Estado | Normal Price | Descuento | Package Price |
|---|---|---|---|---|---|---|
| 84295 | CL.4430JA2010B | 1 | Active | B2C: $54.613,00 | 0 % | B2C: $54.613,00 |
| 84292 | CL.MAZ65396435 | 1 | Active | B2C: $30.244,00 | 0 % | B2C: $30.244,00 |

Ninguna tenía promotion text ni description, y todas las ofertas con
`Display discount rate of 0%` en No.

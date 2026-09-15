# Magento LG (OBS) — Especificación para automatizar la captura de órdenes

Documento de referencia para construir un proceso que, dado un **número de orden**,
obtenga toda la información interna de esa orden desde el admin de Magento de LG.

Levantado el 2026-09-14 navegando el admin real con Chrome DevTools sobre la VPN de LG.
Instancia observada: **Chile** (`store_id=123`), Magento **2.4.5-p16**.

> **Datos personales:** los ejemplos de este documento van enmascarados (nombres, correos,
> RUT, teléfonos y direcciones). La estructura, las claves y los formatos son reales; los
> valores identificatorios, no. Ver §9.

---

## 1. Entorno de acceso

| Pieza | Valor |
|---|---|
| Base admin | `https://shop.lg.com/obsadm/` |
| Red | Sólo accesible desde la red LG. Aquí se usó el túnel `enlace-lg.exe` (SOCKS5 `127.0.0.1:1080`), IP de salida `136.166.250.99` |
| Navegador | Chrome con `--remote-debugging-port=9222 --proxy-server=socks5://127.0.0.1:1080 --proxy-bypass-list=<-loopback> --user-data-dir=<perfil aparte>` |
| Sesión | Login manual de un usuario del admin. Todo lo demás reutiliza la cookie de sesión |
| Storefront | `https://shop.lg.com/cl/` |

La automatización **no puede autenticarse sola** con lo documentado aquí: parte de una sesión
de admin ya iniciada (cookie viva) o necesita credenciales propias. Todo endpoint de abajo
usa `credentials: 'include'`.

---

## 2. Identificadores: el "match"

Son dos y **no** son intercambiables:

| Nombre | Ejemplo | Qué es | Dónde |
|---|---|---|---|
| `increment_id` | `123001427905` | **Número de orden**. Es la llave de negocio, la que se usa para cruzar con otros sistemas | Título de la página, columna `ID` del grid, `external_reference` / `buyOrder` en la pasarela |
| `entity_id` | `35732098` | Id interno de la fila en `sales_order` | Sólo en la URL (`order_id/<entity_id>`) y en el JSON del grid |

**El proceso recibe el `increment_id`.** Para abrir la ficha hace falta el `entity_id`, que se
obtiene consultando el grid (§4). No se puede derivar uno del otro.

```
increment_id 123001427905  →  entity_id 35732098
increment_id 123001427943  →  entity_id 35738148
```

### Patrón de URL de la ficha

```
https://shop.lg.com/obsadm/sales/order/view/order_id/<entity_id>/key/<SECRET_KEY>/
```

`<SECRET_KEY>` es la *admin secret key*: cambia por sesión y por ruta, y **no se puede
codificar fija**. Se obtiene en tiempo de ejecución (§4.2) o, si se navega con un navegador
controlado, basta con seguir el enlace `View` de la fila del grid, que ya la trae:

```json
"actions": { "view": { "href": "https://shop.lg.com/obsadm/sales/order/view/order_id/35732098/key/0e4ff.../", "label": "View" } }
```

---

## 3. Las dos vías para obtener los datos

| Vía | Qué da | Coste | Cuándo usarla |
|---|---|---|---|
| **A. Grid** (§4) | Ficha casi completa en JSON, incluido el detalle **crudo** del pago (`additional_information`) | 1 petición | Por defecto. Es la vía recomendada |
| **B. Ficha HTML** (§5) | Lo que ve el operador, ya formateado; datos del cliente **sin enmascarar** | 1 petición + parseo de DOM | Cuando se necesita el dato completo del cliente o las secciones que el grid no trae (ítems, totales, historial, log ERP) |

**Diferencia crítica:** el grid **enmascara** los datos personales y la ficha no.

| Campo | En el grid | En la ficha |
|---|---|---|
| `customer_name` | `su** alva***` | nombre completo |
| `customer_email` | `fqpra**@gmail.com` | correo completo |
| `billing_address` | calle, comuna, región (sin número ni depto) | dirección completa + teléfono |

Pero ojo: **`additional_information` del grid NO está enmascarado** y sí trae correo del pagador,
RUT, nombre del tarjetahabiente y BIN. El enmascaramiento es sólo de las columnas, no del blob.

---

## 4. Vía A — El grid de órdenes

### 4.1 Endpoint

```
GET https://shop.lg.com/obsadm/mui/index/render/key/<GRID_KEY>/
```

Componente UI: `sales_order_grid` (personalizado por LG: `LgCore_OrderManagement/js/grid`).

### 4.2 Cómo obtener `<GRID_KEY>` en tiempo de ejecución

Abrir `https://shop.lg.com/obsadm/sales/order/index/key/.../` y leer el registro de componentes:

```js
require(['uiRegistry'], r => {
  const ds = r.get('sales_order_grid.sales_order_grid_data_source');
  console.log(ds.update_url);   // → .../mui/index/render/key/<GRID_KEY>/
});
```

Si se automatiza sin navegador, el `update_url` también viaja dentro del HTML de esa página,
en un `<script type="text/x-magento-init">`.

### 4.3 Parámetros

```
namespace=sales_order_grid
search=
filters[placeholder]=true
filters[created_at][from]=9/01/2026      ← OBLIGATORIO   (formato M/DD/YYYY)
filters[created_at][to]=9/15/2026        ← OBLIGATORIO
filters[store_id][]=123                  ← OBLIGATORIO   (Purchase Point)
filters[increment_id]=123001427905       ← el filtro que interesa
paging[pageSize]=10
paging[current]=1
sorting[field]=created_at
sorting[direction]=desc
isAjax=true
```

Cabecera: `X-Requested-With: XMLHttpRequest`.

### 4.4 Reglas propias de LG (validadas contra el servidor)

Estas tres reglas son **personalizaciones de LG**, no de Magento estándar. Se comprobaron
una por una; el servidor responde `200` con un cuerpo de texto plano que empieza por
`ORDER_FILTER_ERROR` (no es un error HTTP, hay que detectarlo por el contenido):

| Situación | Respuesta |
|---|---|
| Cualquier filtro de columna sin rango de fechas | `ORDER_FILTER_ERROR The "Purchase Date" date filter is required when applying column filters to the orders grid.` |
| Fechas puestas pero sin store view | `ORDER_FILTER_ERROR The "Purchase Point" is required when applying column filters to the orders grid.` |
| Rango de fechas demasiado largo | `ORDER_FILTER_ERROR Date range cannot exceed 1 month. Please adjust your filters.` |
| Sin ningún filtro | `{"items": [],"totalRecords": 0}` — devuelve vacío, **no** todas las órdenes |

Sobre el largo del rango: el mensaje dice "1 mes"; en la prueba **29 días pasó y 60 falló**.
La regla operativa segura es **no pasar de 28 días**.

**Consecuencia para el diseño del proceso:** buscar una orden por su número exige conocer
ya una ventana de fecha que la contenga. Si sólo se tiene el `increment_id`, hay que
iterar ventanas de ≤28 días hacia atrás hasta encontrarla, o guardar la fecha junto al número.

### 4.5 Formato de la respuesta

**No devuelve JSON.** Devuelve el HTML del grid (~185 KB) con el JSON embebido dentro de un
`<script type="text/x-magento-init">`. Hay que extraerlo:

```js
const doc = new DOMParser().parseFromString(html, 'text/html');
const dig = (o, acc=[]) => {                       // busca {items:[...], totalRecords:n}
  if (o && typeof o === 'object') {
    if (Array.isArray(o.items) && o.totalRecords !== undefined) acc.push(o);
    for (const k in o) dig(o[k], acc);
  }
  return acc;
};
let data = null;
doc.querySelectorAll('script[type="text/x-magento-init"]').forEach(s => {
  try { const h = dig(JSON.parse(s.textContent)); if (h.length && h[0].items.length) data = h[0]; } catch {}
});
// data.items[0]  →  la orden;  data.totalRecords  →  1
```

### 4.6 Campos que devuelve cada ítem

Vienen **todos** los campos, independientemente de las columnas que el usuario tenga visibles
(ver §4.8). Los relevantes:

**Identificación y estado**
`entity_id` · `increment_id` · `status` (código, p.ej. `picking_for_delivery`) · `store_id` (HTML) ·
`store_name` · `order_store_code` (`cl`) · `created_at` · `updated_at` · `local_time` · `time_zone` ·
`customer_id` (null si invitado) · `is_test` · `devices` (`PC`/`Mobile`) · `x_forwarded_for` (IP)

**Cliente** (enmascarados)
`customer_name` · `customer_email` · `customer_group` · `billing_name` · `shipping_name` ·
`billing_address` · `shipping_address` · `shipping_user_phone`

**Importes**
`base_grand_total` · `grand_total` · `base_total_paid` · `total_paid` · `subtotal` ·
`shipping_and_handling` · `total_refunded` · `refunded_to_store_credit` · `discount_amount` ·
`base_currency_code` · `order_currency_code` · `shipping_fee` · `installation_fee` · `haulaway_fee`

**Pago** ← lo importante
`payment_method` / `method` (mismo valor, código interno) · `pg_method` · `payment_method_type` ·
`three_ds_verification` · `installment_month` · `months` · `payment_transaction_number` ·
**`additional_information`** (string JSON con el detalle crudo de la pasarela — §6)

**Producto / ERP**
`item_models` (SKU, con `<b>`) · `description` · `sku_price` · `serial_number` · `erp_type` ·
`erp_order_no` · `warehouse_code` · `gerp_invoice_number` · `gerp_return_number` ·
`gerp_unit_selling_price` · `price_source` · `product_level1_code`..`product_level4_code`
(y sus `_filter`) · `item_gerp_grid_data` (string JSON con el detalle ERP por línea)

**Marketplace**
`sale_channel` (`Magento` / `Marketplace`) · `marketplace_name` (p.ej. `FALABELLA`) ·
`marketplace_order_id` · `marketplace_pack_id` · `integration_hub_name` · `3p_hub_name`

**Otros** `coupon_code` · `coupon_rule_name` · `utm_source` · `cancellation_reason` ·
`canceled_by` · `require_invoice` · `fih_*` (facturación) · `tax_info_1..3` · `osms_*` ·
`reward_earn` · `reward_spent` · `vip_key` · `opt_in_status` · `is_thinq` · `rad_flag` ·
`requested_date` · `fad_flag` · `shipping_rule_name` · `allocated_sources` · `actions`

`item_gerp_grid_data` desanidado trae: `warehouse_code`, `ship_to_code`, `bill_to_code`,
`carrier`, `delivery_type`, `gerp_unit_selling_price`, `line_status_code`, `erp_order_no`,
`order_header_id`, `order_line_id`, `pick_no`, `pick_release_date`, `item_type_code`,
`sales_order_line_no`, `tracking_no`, `shipment_date`.

Varios campos vienen **con HTML dentro** (`item_models`, `description`, `shipping_fee`,
`store_id`, `gerp_unit_selling_price`…). Hay que limpiar etiquetas antes de usarlos.

### 4.7 Catálogo de columnas (index interno → etiqueta visible)

El nombre interno es el que va en `filters[...]`; la etiqueta es lo que se ve en pantalla.

| index | Etiqueta | Filtro |
|---|---|---|
| `increment_id` | ID | text |
| `store_id` | Purchase Point | ui-select **(obligatorio)** |
| `created_at` | Purchase Date | dateRange **(obligatorio)** |
| `status` | Status | multiselect |
| `payment_method` | Payment Method | multiselect |
| `pg_method` | Payment Gateway Method | multiselect |
| `payment_method_type` | Payment Method Type | text |
| `billing_name` / `shipping_name` | Bill-to / Ship-to Name | text |
| `customer_name` · `customer_email` · `customer_group` | Customer name / Email / Group | text, text, select |
| `billing_address` · `shipping_address` · `shipping_information` | direcciones y envío | text |
| `shipping_user_phone` | User Phone (Shipping) | text |
| `base_grand_total` · `grand_total` · `subtotal` · `shipping_and_handling` · `total_refunded` | importes | textRange |
| `item_models` | SKU | text |
| `serial_number` | Serial Number | text |
| `erp_type` | ERP Type | multiselect |
| `erp_order_no` · `warehouse_code` · `gerp_invoice_number` · `gerp_return_number` | ERP | text |
| `product_level1_code`..`4` | Level 1..4 Code | text |
| `sale_channel` | Sale Channel | select |
| `marketplace_name` · `marketplace_order_id` · `marketplace_pack_id` | Marketplace | text |
| `integration_hub_name` · `3p_hub_name` | hubs de integración | text |
| `coupon_code` · `coupon_rule_name` | Coupon | text |
| `cancellation_reason` · `canceled_by` | cancelación | select / text |
| `three_ds_verification` · `easy_checkout` · `is_pre_order` · `is_test` · `is_recurring` · `is_thinq` · `is_smart_exchange` | banderas | select |
| `x_forwarded_for` | IP Address | text |
| `error_code` · `error_status` · `description` | error | text / select / text |
| `fih_require_invoice` · `fih_customer_type` · `fih_company_name` · `fih_vat_id` · `tax_info_1..3` | facturación | select / text |
| `osms_sync_status` · `osms_est_no` · `osms_ord_no` · `osms_customer_no` · `osms_customer_id` | OSMS | select / text |
| `niubiz_purchase_number` · `niubiz_transaction_id` | Niubiz (otros países) | text |
| `dr_order_id` · `dr_payment_method` | DigitalRiver | text |
| `months` · `tenure_in_month` · `installment_month` | cuotas | range / text |
| `reward_earn` · `reward_spent` | puntos | range |
| `utm_source` | Order Referral Source | text |
| `vip_key` · `partner_name` · `company_name` · `smb_referrer_email` | B2B / VipKey | text |
| `has_free_gift_item` · `free_gift_item_id` · `free_gift_item_name` | regalo | select / text |
| `request_arrival_date` (RAD) · `rad_flag` · `requested_date` · `fad_flag` | fechas de entrega | dateRange / select |
| `local_time` · `ecss_transfer_date` | fechas auxiliares | text |
| `price_source` · `sku_price` · `gerp_unit_selling_price` · `discount_amount` | precios | text |
| `knout_status` · `aggregator_domain` · `razer_payment_type` · `gst_id` · `special_request` · `feedback_purchase` · `feedback_message` · `opt_in_status` · `included_pto_v2` · `is_addon_bundle` · `add_on_product` · `frm_receipt_number` · `pickup_location_code` · `allocated_sources` | varios | — |

### 4.8 Las columnas visibles NO son fiables

Cada usuario del admin configura qué columnas ve (son *bookmarks* por usuario), así que
**leer el grid raspando `<th>`/`<td>` del HTML da resultados distintos según quién esté logueado.**

La automatización debe trabajar **siempre contra el JSON** (`items[i].<index>`), que trae los
~130 campos completos sin importar la configuración visual. Nunca contra posiciones de columna.

### 4.9 Exportaciones disponibles

Por si conviene un volcado masivo en vez de orden por orden:

| Formato | URL |
|---|---|
| CSV | `/obsadm/mui/export/gridToCsv/key/<K>/` |
| Excel XML | `/obsadm/mui/export/gridToXml/key/<K>/` |
| Custom Export | `/obsadm/lgat_ordermanagement/export/gridtocsv/key/<K>/` |
| Export NERP | `/obsadm/nerp_order_grid_export/export/queue/key/<K>/` |

Se obtienen igual que el `update_url`:
`r.get('sales_order_grid.sales_order_grid.listing_top.export_button').options`.
Respetan los mismos filtros y las mismas reglas obligatorias.

---

## 5. Vía B — La ficha de la orden

`GET /obsadm/sales/order/view/order_id/<entity_id>/key/<KEY>/` → HTML completo.

### 5.1 Secciones y selectores

| Sección | Selector raíz |
|---|---|
| Order & Account Information | `.order-view-account-information` |
| └ Datos de la orden | `table.order-information-table` |
| └ Datos de la cuenta | `table.order-account-information-table` |
| Address Information | `.order-addresses` |
| Payment & Shipping Method | `.order-view-billing-shipping` |
| └ Pago | `.order-payment-method` |
| └ Envío | `.order-shipping-method` |
| Items Ordered | `table.edit-order-table` |
| Order Total | `.order-totals` |
| Comentarios (form) | `#history_comment`, `#history_status`, `#history_notify`, `#history_visible` |
| Historial | `.note-list-item` |
| Invoices / Credit Memos | `.dr_invoice_and_refunds_section` |
| ERP Export Log | `.gerp-export-log` |
| OSMS Export Log | `.osms-export-log` |

Las dos tablas de cabecera son pares `<th>`/`<td>` — se leen genéricamente:

```js
const kv = t => [...t.querySelectorAll('tr')]
  .filter(tr => tr.querySelector('th') && tr.querySelector('td'))
  .map(tr => [tr.querySelector('th').innerText.trim(), tr.querySelector('td').innerText.trim()]);
```

**`table.order-information-table`** — número de orden en el título
(`.order-information .admin__page-section-item-title .title` → `Order # 123001427905`), y filas:
`Order Date` · `Order Date (<zona>)` · `Order Status` (también en `#order_status`) ·
`Purchased From` · `Placed from IP` · `USD / CLP rate:` · `Devices` · a veces
`Feedback the Purchase Experience`.

**`table.order-account-information-table`**: `Customer Name` · `Email` (dentro de `<a mailto:>`) ·
`Customer Group` · `Last Name` · `Additional email`.

> Las filas **varían entre órdenes**: la de marketplace no trae `Placed from IP`, y el nombre de
> la zona horaria cambia (`America/Santiago`, `Europe/London`). Leer por etiqueta, nunca por índice.

### 5.2 Direcciones

```js
[...document.querySelectorAll('.order-addresses .admin__page-section-item')].map(a => ({
  tipo: a.querySelector('.admin__page-section-item-title .title').innerText.trim(), // Billing / Shipping Address
  texto: a.querySelector('address').innerText.trim(),
  editHref: a.querySelector('a')?.href          // contiene address_id
}));
```

El `editHref` expone el `address_id` (`/sales/order/address/address_id/61398535/key/...`).
Billing y Shipping tienen **ids distintos** aunque el contenido sea idéntico.

### 5.3 Ítems (`table.edit-order-table`)

44 columnas. Estructura: **un `<tbody>` por ítem** (clases `even`/`odd`), y dentro varias `<tr>`
(la primera lleva los datos; las siguientes, subfilas de cantidades). Columnas, en orden:

`Original Price` · `Price` · `Qty` (texto multilínea: `Ordered 1 Invoiced 1`) · `Subtotal` ·
`Tax Amount` · `Tax Percent` · `Discount Amount` · `Row Total` · `Model` (SKU) · `Serial Number` ·
`Item ID` · `Export Item ID` · `Pre-Order` · `ERP Sales #` · `ERP Type` · `Item Status` ·
`ERP Status` · `ERP Status 2` · `Ship to code` · `ERP Header ID` · `ERP Line ID` ·
`ERP Hold Flag` · `ERP Pick #` · `Pick Release Date` · `Sales Date` · `Warehouse Code` ·
`Description` · `Delivery Type` · `Carrier` · `Item Type Code` · `unit List Price` ·
`ERP Selling Price` · `Shipping Method` · `Advance Shipping` · `Recurring Benefit` ·
`Price Source` · `Global Shipping Info` · `Tracking Url` · `Tracking Number` ·
`Commission per Qty` · `Estimated Delivery Date` · `SDDI` · `Free Gift ID` · `Free Gift Name`

Algunas celdas tienen clase propia (`col-price-original`, `col-price`, `col-ordered-qty`,
`col-subtotal`), el resto no. **Mapear leyendo los `<thead> th` y casando por posición dentro
de cada `tbody`**, no por clase.

`Global Shipping Info` viene como texto compuesto:
`Rule Name: Entrega agendada | Expected delivery date: 16-09-2026 | Installation Service: N/A`.

### 5.4 Totales (`.order-totals`)

No es tabla `th`/`td`: son filas con clases `col-0`, `col-1`… y el texto en el `<td>`.
Etiquetas observadas: `Grand Total` · `Total Paid` · `Total Refunded` · `Total Due` ·
`Subtotal (Price source: ERP)` · `Discount (<nombre de la regla>)` · `Tax` · `Shipping & Handling`,
más una fila con el detalle del cupón (`1059350 - LGSANTANDER10 - 559779`).

El texto de `Discount` **incluye el nombre de la promoción**, que varía por orden. Emparejar
con `startsWith`, no con igualdad exacta.

### 5.5 Pestañas

Cada pestaña es un bloque con id propio. Unas están embebidas en el HTML y otras se cargan
por AJAX con su **propia key y `form_key`**:

| Pestaña | id | Carga |
|---|---|---|
| Information | `sales_order_view_tabs_order_info` | embebida |
| Invoices | `..._order_invoices` | embebida (grid UI) |
| Credit Memos | `..._order_creditmemos` | embebida |
| Shipments | `..._order_shipments` | embebida |
| Comments History | `..._order_history` | AJAX → `/sales/order/commentsHistory/key/<K>/order_id/<id>/form_key/<FK>/` |
| Transactions | `..._order_transactions` | embebida (tabla `order_transactions_table`) |
| ERP Export Log | `..._gerp_export_log` | AJAX → `/sales/order/gerpExportLog/key/<K>/order_id/<id>/form_key/<FK>/` |
| OSMS Contract Info | `..._osms_contract_info` | embebida |
| OSMS Export Log | `..._osms_export_log` | AJAX → `/sales/order/osmsExportLog/key/<K>/order_id/<id>/form_key/<FK>/` |

La pestaña **Transactions** tiene filtros propios (`order_transactions_filter_txn_id`,
`..._method`, `..._txn_type`, `..._is_closed`) y es la fuente para conciliación con la pasarela.

El **ERP Export Log** trae el payload que se le mandó al ERP:
`Action Type: order` · `Cust PO NO: ORDER_123001427905` · `Order Increment ID` · `Status: success` ·
`Created At` · `Request Body` (JSON con `SYSTEM_CODE: OBS`, `PROCESS_NAME: SALES_ORDER_CREATION`,
`STORE_CODE: CL`, `ERP_SYSTEM: GERP`…).

### 5.6 Historial

`.note-list-item` → fecha, estado, si se notificó al cliente, y el comentario. Los cambios
automáticos de estado se registran como JSON: `{"holded":"picking_for_delivery","global":null}`.

---

## 6. Los métodos de pago

Aquí es donde las órdenes difieren de verdad. El bloque `.order-payment-method` **no tiene un
conjunto fijo de campos**: cambia según el método e incluso según el submétodo.

**Regla de oro: leer los pares `<th>`/`<td>` dinámicamente y quedarse con `additional_information`
del grid como fuente de verdad.** No asumir posiciones ni presencia de campos.

### 6.1 Resumen

| Caso | `payment_method` / `method` | Título en la ficha | `payment_method_type` | `pg_method` |
|---|---|---|---|---|
| **Webpay** | `transbank_webpay` | `Webpay – Crédito, Débito, Prepago y OnePay` | `BankTransfer` | `null` |
| **MercadoPago pasarela** | `fih_mercadopago_basic` | `Otras formas de pago - Mercado Pago` | `CreditCard` / `ETC` | `visa`, `account_money`… |
| **MercadoPago incrustado** | `mercadopago_global_credit_card` | `Tarjeta de crédito - Mercado Pago` | `CreditCard` | `null` |
| **Marketplace** | `marketplace_payment` | `Marketplace Payment - ecommPay` | `ETC` | `null` |

Nótese que `payment_method_type` de Webpay dice `BankTransfer` aunque sea tarjeta de crédito:
**no es un campo de confianza** para clasificar. Clasificar por `payment_method`.

### 6.2 Webpay (`transbank_webpay`)

Ficha — 3 filas fijas: `Payment Type Code:` · `Transaction Status:` · `Installments:`.

`additional_information`:
```json
{"raw_details_info":{
  "vci":"TSY","status":"AUTHORIZED","responseCode":0,"amount":453981,
  "authorizationCode":"464143","paymentTypeCode":"VN","accountingDate":"0914",
  "installmentsNumber":0,"installmentsAmount":null,"sessionId":"1304809849",
  "buyOrder":"123001427943","cardNumber":"1043",
  "cardDetail":{"card_number":"1043"},
  "transactionDate":"2026-09-14T13:12:20.221Z","balance":null}}
```

- `buyOrder` = el `increment_id`. Sirve para validar el match.
- `cardNumber` son **sólo los últimos 4 dígitos**.
- `paymentTypeCode` observados: `VN` (venta normal, sin cuotas → `installmentsNumber: 0`),
  `SI` (cuotas sin interés → `installmentsNumber: 3`, `installmentsAmount: 18662`),
  `VD` (débito). La ficha muestra `Installments: N/A` cuando es 0.
- `authorizationCode` es el código de autorización de Transbank.
- No hay datos del tarjetahabiente.

### 6.3 MercadoPago pasarela / basic (`fih_mercadopago_basic`)

El cliente sale del sitio hacia MercadoPago (`checkout: "pro"`, `checkout_type: "redirect"`).
Es el que **más datos** devuelve.

Ficha — filas variables: `Payment id (Mercado Pago):` · `Card Number:` · `Card Holder Name:` ·
`Payment Method:` · `Payment Method Type:` · `Installments:` · `Statement Descriptor:` ·
`Payment Status:` · `Payment Status Detail:`.

**Con `account_money` (saldo MP) desaparecen `Card Number`, `Card Holder Name` y
`Statement Descriptor`, y `card` llega como array vacío `[]` en vez de objeto.** Ésta es la
variación que más rompe los parsers.

`additional_information` (recortado y enmascarado):
```json
{
 "method_title":"Otras formas de pago - Mercado Pago",
 "mercadopagopro_url":"https://www.mercadopago.cl/checkout/v1/redirect?pref_id=...",
 "paymentResponse":{
   "id":177954021141,
   "external_reference":"123001427928",
   "status":"approved","status_detail":"accredited","captured":true,
   "currency_id":"CLP","transaction_amount":1164801,"installments":1,
   "payment_method_id":"visa","payment_type_id":"credit_card",
   "payment_method":{"id":"visa","type":"credit_card","issuer_id":"168",
                     "data":{"threeds":"AUTHENTICATED"}},
   "authorization_code":"1Q6XQ5",
   "card":{"bin":"41913202","first_six_digits":"419132","last_four_digits":"0884",
           "expiration_month":null,"expiration_year":null,"tags":["credit"],"country":"BRA",
           "cardholder":{"name":"<NOMBRE>","identification":{"type":"Otro","number":"<ID>"}}},
   "payer":{"email":"<EMAIL>","id":"3689967316",
            "identification":{"type":"RUT","number":"<RUT>"}},
   "additional_info":{"ip_address":"<IP>","items":[ /* líneas con id, title, quantity, unit_price */ ],
                      "payer":{"address":{},"phone":{}},
                      "shipments":{"receiver_address":{}}},
   "fee_details":[{"amount":31916,"fee_payer":"collector","type":"mercadopago_fee"}],
   "charges_details":[{"name":"mercadopago_fee","amounts":{"original":31916,"refunded":0}}],
   "transaction_details":{"installment_amount":1164801,"net_received_amount":1132885,
                          "total_paid_amount":1164801,"overpaid_amount":0},
   "statement_descriptor":"MERPAGO*LGELECTRONICS    ",
   "date_created":"...","date_approved":"...","money_release_date":"...","money_release_status":"pending",
   "order":{"id":"44463720760","type":"mercadopago"},
   "metadata":{"checkout":"pro","checkout_type":"redirect","site":"MLC",
               "platform":"Magento2","platform_version":"2.4.5-p16","sponsor_id":222570571},
   "notification_url":"https://shop.lg.com/cl/fih_mercadopago/notifications/basic/?source_news=ipn",
   "live_mode":true,"processing_mode":"aggregator","refunds":[]
 },
 "status":"approved","status_detail":"accredited","id":177954021141,
 "payment_method":"visa","merchant_order_id":"44463720760","payment_id_detail":177954021141
}
```

Con `account_money` aparece además `"RUT":"<RUT>"` en la raíz, y `statement_descriptor` es `null`.

- `external_reference` = `increment_id`.
- `items[]` de `additional_info` trae el desglose que se le mandó a MP, **incluidas líneas
  sintéticas**: `Store discount coupon` (negativa), `Store taxes`, `Shipment cost`.
- `transaction_amount` es el total cobrado; `net_received_amount`, lo que recibe LG tras comisión.

### 6.4 MercadoPago incrustado (`mercadopago_global_credit_card`)

El formulario de tarjeta va dentro del checkout de LG; se tokeniza la tarjeta.

Ficha: `Payment id (Mercado Pago):` · `Card Number:` · **`Expiration Date:`** · `Card Holder Name:` ·
`Payment Method:` · `Installments:` · `Statement Descriptor:` · `Payment Status:` ·
`Payment Status Detail:` · **`3DS verification:`**.

Se distingue del basic por esos dos campos extra y por la **ausencia** de `Payment Method Type`.

`additional_information` (recortado y enmascarado):
```json
{
 "method_title":"Tarjeta de crédito - Mercado Pago",
 "installments":"12","issuer_id":"1040","payment_method_id":"master",
 "token":"12bb1538219150da6488812314481d7d",
 "pg_status":"approved","payment_id":178904668430,
 "paymentResponse":{
   "id":178904668430,"external_reference":"123001427905",
   "status":"approved","status_detail":"accredited","captured":true,
   "transaction_amount":453981,"installments":12,"currency_id":"CLP",
   "authorization_code":"307840",
   "payment_method_id":"master","payment_type_id":"credit_card",
   "payment_method":{"id":"master","type":"credit_card","issuer_id":"1040",
                     "data":{"routing_data":{"merchant_account_id":"4006"}}},
   "card":{"bin":"54874250","first_six_digits":"548742","last_four_digits":"4805",
           "expiration_month":12,"expiration_year":2029,"country":"CHL","tags":["credit"],
           "cardholder":{"name":"<NOMBRE>","identification":{"type":"RUT","number":"<RUT>"}}},
   "payer":{"email":"<EMAIL>","id":"2146828420"},
   "additional_info":{"payer":{"first_name":"<NOMBRE>","last_name":"<APELLIDO>",
                               "address":{},"phone":{}},
                      "shipments":{"receiver_address":{}}},
   "transaction_details":{"installment_amount":37831.75,"net_received_amount":441542,
                          "total_paid_amount":453981},
   "fee_details":[{"amount":12439,"fee_payer":"collector","type":"mercadopago_fee"}],
   "description":"Order # 123001427905 in store Chile Default Store View",
   "statement_descriptor":"MERCADOPAGO *LGELECTR",
   "notification_url":"https://shop.lg.com/cl/rest/V1/mercadopago_global/webhook",
   "metadata":[],"order":[],"point_of_interaction":{"type":"UNSPECIFIED"}
 },
 "status":"approved","status_detail":"accredited",
 "redirect_payment_gateway_url":"https://shop.lg.com/cl/mpg_creditcard/payment/start/id/123001427905/",
 "cc_type":"MC","bin":"54874250","capture_flag":0,"last_invoice_amount":453981
}
```

Diferencias contra el basic, útiles para detectarlo sin mirar `payment_method`:
tiene `token`, `cc_type`, `bin`, `capture_flag`, `last_invoice_amount`,
`redirect_payment_gateway_url` y `pg_status`; `metadata` y `order` llegan como **arrays vacíos**;
`point_of_interaction.type` es `UNSPECIFIED` (en basic es `CHECKOUT`); el `notification_url`
apunta a `/rest/V1/mercadopago_global/webhook` (en basic, a `/fih_mercadopago/notifications/basic/`).

### 6.5 Marketplace (`marketplace_payment`)

La venta entra desde un marketplace; LG no procesa el pago.

Ficha: `.order-payment-method` **no tiene tabla de campos**, sólo el título
`Marketplace Payment - ecommPay`. Un parser que espere filas devuelve vacío — hay que
contemplarlo explícitamente.

`additional_information`:
```json
{"card_operator":"","reference_code":null,"payer_doc_number":null,
 "payment_name":"ecommPay","payment_completed_date":""}
```

Los datos útiles están en las **columnas del grid**, no en el pago:
`sale_channel: "Marketplace"` · `marketplace_name: "FALABELLA"` ·
`marketplace_order_id: "3251641874"` · `marketplace_pack_id`.

Otras señas: la cuenta suele ser genérica (grupo `NOT LOGGED IN`), no hay `Placed from IP`,
la zona horaria puede venir en `Europe/London` y el envío aparece como `Shipping` plano en
vez de `Item ID <n> - <regla>`.

### 6.6 Otros métodos configurados

El filtro `payment_method` ofrece **~380 métodos** (la plataforma es global). Los de Chile son
los cuatro de arriba. Si aparecen otros, tener presentes al menos:
`transbank_oneclick` (Oneclick) · `mercadopago_custom` · `mercadopago_basic` ·
`mercadopago_adbpayment_*` · `mercadopago_global_*` (wallet, pix, boleto, ticket) ·
`marketplace_payment` · `free` (sin pago).

Valores posibles de `pg_method`: `visa`, `master`, `debvisa`, `debmaster`, `redcompra`,
`account_money`, `consumer_credits`, `diners`, `amex`, `pse`, `efecty`, `oxxo`, `paycash`,
`clabe`, `banamex`, `bancomer`, `codensa`, `konbini`, `ideal`, `multibanco`, `mbway`, `eps`,
`paynow`, `grabpay`, `klarna*`, `apple_pay`/`applepay`, `google_pay`/`googlepay`, `blik`, `p24`, `billie`.

### 6.7 Estados de orden

`status` viaja como código; la etiqueta se traduce aparte. Hay ~65. Los vistos y los que
más importan:

`processing` (Place Order) · `picking_for_delivery` (Picking for Delivery) ·
`preparing_for_delivery` · `on_delivery` (On Delivery) · `delivery_completed` ·
`complete` (**Delivery Completed (Invoiced)**) · `holded` (On Hold) · `canceled` ·
`customer_canceled` · `closed` / `return_refund` (Return Refund) · `refunded` ·
`partial_refund` · `payment_review` · `payment_declined` · `payment_fail` · `fraud` ·
`pending` · `pending_payment` · `authorized` · `captured` · `declined` · `voided`.

Ojo con dos trampas: `complete` **no** significa "completada" sino *facturada*, y existe
`delivery_completed` como estado distinto; y tanto `closed` como `return_refund` muestran la
misma etiqueta "Return Refund".

---

## 7. Estrategia recomendada para el proceso

Dado un `increment_id` (y preferentemente una fecha aproximada):

1. **Sesión.** Partir de una cookie de admin válida. Si no, login previo.
2. **Resolver la key del grid.** Cargar `/obsadm/sales/order/index/key/.../` una vez y sacar
   `update_url` del `uiRegistry` (o del HTML). Cachearla mientras dure la sesión.
3. **Consultar el grid** con `increment_id` + `store_id` + ventana de fechas ≤28 días que
   contenga la orden. Si no se sabe la fecha, iterar ventanas hacia atrás.
4. **Verificar la respuesta** antes de parsear: si el cuerpo empieza por `ORDER_FILTER_ERROR`,
   es un fallo de filtros (llega con HTTP 200). Si `totalRecords === 0`, la orden no está en
   esa ventana o el store view es otro.
5. **Extraer `items[0]`** del `x-magento-init`. De ahí salen el `entity_id`, todos los campos
   de negocio y el `additional_information` (`JSON.parse` de un string).
6. **Clasificar por `payment_method`** y normalizar el pago con el mapa de §6 a un modelo
   propio (id de transacción, código de autorización, marca, últimos 4, cuotas, estado,
   monto, comisión).
7. **Sólo si hace falta** el dato sin enmascarar del cliente, o ítems / totales / historial /
   log ERP: abrir la ficha con el `entity_id` y el `href` de `actions.view`, y parsear con
   los selectores de §5.

**Campo mínimo de validación cruzada:** que `buyOrder` (Webpay) o `external_reference`
(MercadoPago) coincida con el `increment_id` pedido. En marketplace no existe: usar
`marketplace_order_id`.

### Trampas que romperán el parser si no se contemplan

- `ORDER_FILTER_ERROR` llega con **HTTP 200** y `Content-Type: text/html`.
- El endpoint del grid devuelve **HTML, no JSON**; el JSON va embebido.
- Las **columnas visibles cambian por usuario** → trabajar sólo con el JSON.
- El bloque de pago **no tiene campos fijos**; marketplace no tiene ninguno.
- `card` es objeto o **array vacío** según el submétodo de MP.
- `additional_information` es un **string** que hay que parsear, y dentro hay más strings JSON
  (`item_gerp_grid_data`).
- Varios campos del grid **traen HTML** dentro.
- Las **keys de las URLs caducan** y cambian por sesión: resolverlas siempre en runtime.
- Los importes del grid vienen **formateados** (`"$453,981.00"`); los crudos están en
  campos paralelos (`base_total_paid`: `"453981.0000"`).
- Las fechas del grid van en UTC (`created_at`) y la ficha muestra además la hora local
  (`local_time`, `time_zone`).

---

## 8. Ejemplos verificados

| # Orden | entity_id | Método | Estado | Seña particular |
|---|---|---|---|---|
| 123001427943 | 35738148 | `transbank_webpay` | picking_for_delivery | `paymentTypeCode: VN`, sin cuotas |
| 123001426338 | 35683779 | `transbank_webpay` | complete | `paymentTypeCode: SI`, 3 cuotas |
| 123001427928 | 35737440 | `fih_mercadopago_basic` | picking_for_delivery | tarjeta Visa, `threeds: AUTHENTICATED` |
| 123001426389 | 35684634 | `fih_mercadopago_basic` | complete | `account_money`, `card: []` |
| 123001427905 | 35732098 | `mercadopago_global_credit_card` | picking_for_delivery | Master, 12 cuotas, con token |
| 123001426401 | 35684793 | `mercadopago_global_credit_card` | complete | Master, 12 cuotas |
| 123001427216 | 35713340 | `marketplace_payment` | delivery_completed | FALABELLA, `marketplace_order_id` |

---

## 9. Advertencias

- **Datos personales.** `additional_information` contiene correo, RUT, nombre del
  tarjetahabiente, BIN, últimos 4 dígitos, teléfono, dirección e IP — **sin enmascarar**, aunque
  las columnas del grid sí lo estén. Cualquier proceso que los almacene o los mande a otro
  sistema (incluido un modelo de lenguaje) debe filtrarlos o tratarlos como datos sensibles.
- **Nunca hay PAN completo.** Sólo BIN (6-8 dígitos) y últimos 4. No intentar reconstruirlo.
- **Las keys de sesión son secretos.** Las de los ejemplos de este documento ya caducaron y no
  sirven; se resuelven en runtime. No fijarlas en código ni publicarlas.
- **El grid es pesado**: cada consulta devuelve ~185 KB aunque se pida una sola orden.
  Con volumen, conviene `pageSize` grande y una sola pasada por ventana, o la exportación CSV (§4.9).
- Todo lo de aquí es **lectura**. Escribir (comentarios, cambios de estado, facturas) exige
  además el `form_key` y queda registrado en el historial a nombre del usuario del admin.

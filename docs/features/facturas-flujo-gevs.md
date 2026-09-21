# Facturas - flujo de carga en GEVS (Complex Voucher Entry)

Recorrido de pantalla reconstruido del registro `docs/features/Facturas/registro_*.md` (grabado con **Registro de
acciones** el 2026-09-15, 11:30 a 12:15, factura de Mercado Pago 2943361). Es la referencia para el driver de la
feature: selectores, valores, efectos y quirks. Todo lo que el usuario hizo en el portal de Mercado Pago (descargar el
PDF y el reporte) se ignora: en la automatizacion esos archivos ya estan listos.

Complemento: `facturas-datos.md` (de donde sale cada valor) y `facturas.md` (la feature).

## Donde vive la pantalla

| Cosa | Valor |
|---|---|
| Portal | `http://lgegltase9q.lge.com:8032/OA_HTML/jsp/xxevf/common/main/epMain.jsp?parameter=gevseptop=full` (Global Easy Voucher System, GEVS). Se llega por SSO (`sso.lge.com`), desde la red de LG (en la oficina no hace falta VPN; fuera, la VPN de la extension) |
| Entrada | GEVS > My Form List > **Complex Voucher** (`#myFormList table.table_line_complex ... span`, fila "Personal Expense Claim / Complex Voucher"). Abre una pestaña nueva con `RF.jsp?function_id=43271&resp_id=76103&resp_appl_id=20056&...params2=formId=55071&batchId=0` |
| Pantalla de carga | `OA.jsp?page=/lge/oracle/apps/xxevf/xxevf20061/webui/ComplexVoucherEntryPG&formId=55071&batchId=0&initMode=C&ListOption=G&_ti=1512028276&oapc=N&oas=...` titulo "Complex Voucher Entry(LGECL)" |
| Tras Save | la misma pagina con `batchId=<asignado>&initMode=U` (`50150561` en el registro). El encabezado muestra `Batch No : ESCL-EV-20163-20260915-0001` |
| Tras Submit | `ComplexVoucherInquiryPG` (titulo "Complex Voucher Inquiry(LGECL)") con "Submitted Successfully. (Reference=XXEVFXX001_...)" |
| Frames | el formulario `#DefaultFormName` vive dentro de un iframe (el registro lo ve como `frame 37`, `587`, `644`, `712`...). Los reloads por `form_submit` a veces se registran en el frame principal. La extension inyecta en todos los frames; el detector decide por DOM, no por frame |
| Upload de adjuntos | iframe de **otro host**: `http://lgegltase1q.lge.com:8032/OA_HTML/jsp/xxlge/com/upload.jsp?module_code=XXEVF&user_id=<id>&close_button_flag=off&req_number=<n>` |
| Ventanas hijas | LOV "Search and Select" y calendario "Pick a Date" abren **pestañas/ventanas nuevas** (`cabo/jsps/a.jsp?_t=fredRC...` que redirige a `OA.jsp?region=...`), no iframes |

Motor: Oracle OA Framework (OAF). Casi cada blur dispara un PPR (partial page render). Unas veces es un refresco parcial
("aparece tabla ..." en el registro, +0.7 a +2.5 s), otras termina en una **navegacion `form_submit` real** con `oapc`
incrementado (en el registro `oapc` fue de 3 a 31). Un clic durante un PPR se pierde (el usuario pulso `#AddBtn` 16
veces para obtener 9 filas nuevas).

## Elementos de la pantalla

### Cabecera (Invoice Information)

| Campo | Selector | Valor en el registro | Notas |
|---|---|---|---|
| Invoice Type | `#InvoiceTypeId` (select) | `55001` = "Vendor Invoice(CHL)" | opciones: Vendor Invoice(CHL), Vendor Invoice(IQQ), Cash Receipt, Foreign Invoice, Internal Back-Up, Vendor Invoice(EPG). Cambiarlo provoca `form_submit` (oapc=3) |
| Invoice No | `#InvoiceNo` | `2943361` | texto libre |
| Invoice Date | `#InvoiceDate` (+ icono `#InvoiceDate__xc_ > tbody > tr > td:nth-of-type(3) > a > img`) | `25/08/2026` | formato `dd/MM/yyyy`. El usuario uso el calendario; **probar tipeo directo** |
| Accounting Date | `#AccountingDate` | `15/09/2026` | default = hoy; se deja |
| Invoice Currency | `#EviCurrencyCode` (select) | `CLP` | default |
| Exchange Rate Type / Rate | `#EviCurrExchangeRateTypeCode` / `#EviCurrExchangeRate` | `LGECL_TTM` / `1` | default |
| Description | `#Description` | `F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026` | ver `facturas-datos.md` |
| Pestañas de la seccion | `#__InvoiceInfoInvoiceDetailCL` (Invoice Detail), `#__PaymentContentsCL1` (Payment Detail) | | el usuario alterna entre ambas |

### Payment Detail

| Campo | Selector | Valor | Notas |
|---|---|---|---|
| Payee Code | `#PayeeCode` | `CL005108` | al salir del campo, el PPR (+1.3 s) rellena todo lo demas |
| Payee Biz-No | `#PayeeNo` | `76516950-K` | autocompletado (RUT) |
| Payee Name | `#PayeeName` | `ESCL_Mercado Pago Operadora S.A_CL005108` | autocompletado; sirve para **validar** que el payee es el esperado |
| Payment Group | `#PaymentGroupCode` (select) | Payments on Regular Dates | autocompletado |
| Payment Method | `#PaymentMethodCode` (select) | Mass Payment | autocompletado |
| Payment Term | `#PaymentTermsName` | Domestic 90 Days From Invoice Date | autocompletado |
| Terms Date / Due Date | `#PTermsDate` / `#PDueDate` | `25/08/2026` / `22/11/2026` | se copian de Invoice Date (+90 dias) |

### Credit (una fila, indice 0)

| Campo | Selector | Valor | Notas |
|---|---|---|---|
| Accounting Unit | `input[name="CreditTable:AccountingUnitCode:0"]` | `SAL` | default |
| Department | `input[name="CreditTable:DepartmentCode:0"]` | `20163` | default del usuario; se deja |
| Account | `input[name="CreditTable:AccountCode:0"]` | `21117701` | tras el PPR el Project pasa de "Demand Generation Part" a "Other Payable_Others(Outside)" |
| Project | `input[name="CreditTable:ProjectCode:0"]` | (oculto, 13 caracteres) | lo resuelve OAF |
| Amount / Book Amount | `input[name="CreditTable:Amount:0"]` / `BookAmount:0` | `8634097` (se muestra `8.634.097`) | Book Amount se copia solo. El paste no quedo en el registro pero el inventario posterior lo muestra |

### Debit (tabla `#DebitTable > table.x1o`, una fila por linea)

Columnas: `Select | No. | Line_Type Tax_Code | Tax Group | Accounting Unit | Department | Account | Project | Amount |
Book Amount | Q-Cost Code | Product | Buyer | Description | DFF`. La tabla nace con **una** fila (indice 0).

| Campo (fila i) | Selector | Valor | Notas |
|---|---|---|---|
| Select | `input[name="DebitTable:selected:i"]` | | para Delete |
| Line Type | `select[name="DebitTable:DLineTypeLookupCode:i"]` | `ITEM` (default) / `VAT` en la ultima | opciones ITEM, VAT, WHT. Cambiarlo dispara PPR (+1.7 s) |
| Tax Code | `input[name="DebitTable:DVatRateCode:i"]` (LOV, lupa `td:nth-of-type(3) > span > a > img`) | `CLIDD19` solo en la fila VAT | ver "LOV" abajo |
| Tax Group | `input[name="DebitTable:DTaxGroup:i"]` | vacio | |
| Accounting Unit | `input[name="DebitTable:DAccountingUnitCode:i"]` | `SAL` | default |
| Department | `input[name="DebitTable:DDepartmentCode:i"]` | `20148` | la fila 0 nace con `20163`; se cambia **antes** de Add y las nuevas filas heredan `20148` |
| Account | `input[name="DebitTable:DAccountCode:i"]` | `51357755` en filas ITEM; `11330101` en la fila VAT (lo pone el LOV) | tras el PPR el Project pasa a "Selling Exp_Commission & Charge_Others(OBS Platform, PG Fee - Variable)"; en la VAT queda "Prepaid Taxes_Purchase VAT(Assessment)" |
| Project | `input[name="DebitTable:DProject:i"]` | (oculto, 13 caracteres) | lo resuelve OAF |
| Amount / Book Amount | `input[name="DebitTable:DAmount:i"]` / `DBookAmount:i` | montos por BU; IVA en la ultima | Book Amount se copia solo. **Cada paste + blur provoco `form_submit`** (oapc 5..14) |
| Q-Cost | `input[name="DebitTable:DQCost:i"]` | vacio | |
| Product (tipo) | `select[name="DebitTable:DirImposProductTypeCode:i"]` | `DIV` = "DIV/DIV Group" en filas ITEM; vacio en VAT | opciones DIV/DIV Group, PRODUCT1-4, PRODUCT5-7 |
| Product (valor) | `input[name="DebitTable:DirImposProductLOV:i"]` | `DIV:CNT`, `DIV:CVT`, ... (GBU de la BU) | vacio en la fila VAT |
| Buyer | `select[name="DebitTable:DirImposBuyerTypeCode:i"]` + `input[name="DebitTable:DirImposBuyerCode:i"]` | vacio | |
| Description | `input[name="DebitTable:DDescription:i"]` | la misma Description de la cabecera, en **todas** las filas (incluida VAT) | |
| DFF | `a[name="DebitTable:DebitDff:i"] > img` | se abre **solo en la fila VAT** | ver "Account DFF" |

Botones de la tabla: `#AddBtn`, `#DelBtn`, `#ImportBtn`, `#AllBudgetBtn` (y duplicados `_uixr`). "Select All / Select
None" en `table.x1r`.

### Barra de acciones (`#__ActionButtonBar` / `#__ActionButtonTL`)

`#ABReloadBtn` Reload, `#ABSaveBtn` Save, `#ABSubmitBtn` Submit, `#ABDeleteBtn` Delete (aparece cuando hay `batchId`),
`#ABDummyBtn`. Mensajes de OAF en `#FwkErrorBeanId` (caja "Information" con texto en `div.x46 > b`).

### Otras secciones que aparecen tras Save

- Adjuntos: `#__FileAttachListTable` con `#NewFAAddFileBtn` (Add File) y `#FARefreshBtn`; los archivos subidos quedan como
  enlaces `download.jsp?file_id=...&rand_id=...` con el nombre del archivo.
- Aprobadores: `#__AppTL` con `#AIResetBtn` (Reset), `#AIAddFirstBtn` (Add First), "Related Dept."; lista
  `#__ApprovalListRN` con "Add Next"/"Delete" por fila.
- Modal de confirmacion al enviar: tabla `ConfirmMsgResultAT` (`#ConfirmMsgTL`), botones `#ConfirmApplyBtn` (Apply) y
  `#ConfirmCloseBtn` (Close).

### Ventana LOV "Search and Select: Vat Rate Id"

URL: `OA.jsp?region=/lge/oracle/apps/xxevf/common/lov/webui/TaxCodeLovRN&regionCode=DVatRateCode&lovTableName=DebitTable
&RowNum=<i>&lovMainCriteria=TaxRateCode&PassiveCriteria=DLineTypeLookupCode.TaxTypeCode&event=lovFilter
&source=DebitTable:DVatRateCode:<i>&searchText=<texto>...` (la ventana carga `cabo/jsps/a.jsp?_t=fredRC&redirect=...`
y luego el region). Formulario `#_LOVResFrm`: `#categoryChoice` (Tax Rate Code), `input[name="searchText"]`, boton "Go";
resultados en `#InquiryTable > table.x1o` con un radio por fila (`tr:nth-of-type(k) > td.x1w.x57 > input`); botones
"Cancel" y "Select" (`button.x7n`). Fila elegida: `CLIDD19 / VAT 19% Purchase Invoice / 19 % / 11330101 /
Prepaid Taxes_Purchase VAT(Assessment)`. Al pulsar Select la ventana se cierra y la fila del Debit recibe el codigo y el
Account `11330101`.

En el registro se abrio dos veces: la primera sola (al salir del campo con `CLIDD19` escrito: `event=lovFilter`), la
segunda porque el usuario pulso la lupa. Queda por verificar si con el texto exacto OAF resuelve sin abrirla.

### Ventana "Pick a Date"

URL `cabo/jsps/a.jsp?_t=cd&value=<epoch ms>&maxValue=...&tzId=Asia/Seoul&loc=en-DE-ORACLE9I...`. Formulario `#a` con
`#month` (select, value = epoch del mes) y `#year`; dias en `table.x3m` (`tr > td > a`, texto del dia). Al hacer clic en
un dia la ventana se cierra y el campo recibe `dd/MM/yyyy`. Se uso para Invoice Date (mes September -> August, dia 25) y
para ISSUE_DATE del DFF. Objetivo: evitarla tipeando la fecha.

### Panel "Account DFF" (fila VAT)

Se abre con `a[name="DebitTable:DebitDff:<i>"] > img` (provoca `form_submit`, oapc=15 -> 17). Titulo `#titleBar`
"Account DFF"; tabla `#LineDffItem`; boton Apply `#hideDffBtn` (`#__dffTL`). Campos (todos marcados con `*`):

| Orden | Campo | Selector | Valor |
|---|---|---|---|
| 1 | ISSUE_DATE | `#LineDffItem1` (+ calendario `#LineDffItem1__xc_ > td:nth-of-type(3) > a > img`) | `25/08/2026` (= Invoice Date) |
| 2 | SUPPLY_PRICE | `#LineDffItem2` | `7255544` (NET redondeado) |
| 3 | ORIGINAL_TAX_AMOUNT | `#LineDffItem3` | `1378553` (IVA) |
| 4 | SUPPLIER | `#LineDffItem4` | `CL005108`; el PPR (+2.1 s) muestra "ESCL_Mercado Pago Operadora S.A_CL005108" |
| 5 | DECLR_CURRENCY_EXCHANGE_RATE | `#LineDffItem5` | vacio |
| 6 | NON_DEDUCTIBLE_TYPE_CODE | `#LineDffItem6` | vacio |
| 7 | TAX_RATE_CODE | `#LineDffItem7` | `CLIDD19` |

Apply (`#hideDffBtn`) cierra el panel con PPR (+1.9 s) y deja la pantalla completa otra vez.

### Iframe de upload (host `lgegltase1q`)

`form[fileupload]` (POST a `./uploadResult.jsp`): `#cbo_attachFileUpFCnt` (cantidad de archivos, 1..10),
`input[name="txt_attachFileKey"]` (**type=file**), `input[name="txt_attachFileDesc"]` (descripcion, vacio),
`input[name="save"]` (Upload), `input[name="reset"]`. Tras Upload el iframe navega a `uploadResult.jsp` y en la pagina
padre hay que pulsar **Apply** `#__NewFileAttachCloseBTN` (`#__NewFileAttachTL`), que provoca `form_submit` y agrega el
enlace al listado de adjuntos.

## Secuencia completa (ids `#n` del registro)

| # | Hora | Accion | Efecto |
|---|---|---|---|
| 127 | 11:31:36 | Clic "Complex Voucher" en My Form List | pestaña nueva con la pantalla (`batchId=0`) |
| 168 | 11:32:47 | `#InvoiceTypeId` = Vendor Invoice(CHL) | `form_submit` (oapc=3) |
| 265-268 | 11:42:09 | `#InvoiceNo` = `2943361` | |
| 270-288 | 11:42:11 | Calendario Invoice Date: mes August, dia 25 | `#InvoiceDate` = `25/08/2026`; `#PTermsDate` igual |
| 292-297 | 11:42:30 | `#PayeeCode` = `CL005108` + clic fuera | PPR +1.3 s: Biz-No, Name, Group, Method, Term, Due Date |
| 312-325 | 11:43:48 | `#Description` = `F 2943361 - PG Commission MERCADO PAGO, 1.0%-2.3% - August 2026` | armado en tres pegados |
| 327-331 | 11:45:37 | Credit Account = `21117701` + clic fuera | PPR +1.8 s: Project "Other Payable_Others(Outside)" |
| 339-343 | 11:45:55 | Debit fila 0 Department `20163` -> `20148` | PPR +1.1 s |
| 351-410 | 11:46:53 | `#AddBtn` x16 (varios perdidos por PPR) | quedan 10 filas (indices 0..9) |
| 417-419 | 11:50:55 | fila 9 Line Type = `VAT` | PPR +1.7 s |
| 426-430 | 11:51:04 | fila 9 Tax Code = `CLIDD19` + clic fuera | se abre la ventana LOV |
| 447-454 | 11:51:10 | LOV: radio fila CLIDD19 + Select | ventana se cierra; fila 9 Account = 11330101 |
| 458-602 | 11:51:47 | filas 0..8 Account = `51357755` (con reloads intercalados) | Project "Selling Exp_Commission..." |
| 538-558 | 11:53:12 | (lupa: el LOV se abre de nuevo y se vuelve a elegir CLIDD19) | sin cambios |
| 609-1451 | 11:54:20 | filas 0..8 Amount = 1508792, 550, 64185, 3153039, 1999165, 159502, 211101, 151983, 7227 | cada una `form_submit` (oapc 5..14) |
| 1687-1692 | 11:55:30 | fila 9 Amount = `1378553` | `form_submit` (oapc=14) |
| 1811-1908 | 11:55:52 | filas 0..8 Product tipo = DIV/DIV Group | PPR ocasional |
| 1917-2122 | 11:58:26 | filas 0..8 Product valor = DIV:CNT, DIV:CVT, DIV:CDT, DIV:DFT, DIV:GLT, DIV:PNT, DIV:GTT, DIV:DGT, DIV:DLT | |
| 2126-2170 | 12:00:44 | Description en filas 0..9 (copia de `#Description`) | |
| 2172 | 12:01:09 | DFF fila 9 (icono) | `form_submit` (oapc=15); panel "Account DFF" |
| 2242-2262 | 12:01:17 | ISSUE_DATE por calendario = `25/08/2026` | |
| 2263-2288 | 12:01:24 | SUPPLY_PRICE `7255544`, ORIGINAL_TAX_AMOUNT `1378553`, SUPPLIER `CL005108`, TAX_RATE_CODE `CLIDD19` | PPR en SUPPLIER +2.1 s |
| 2297 | 12:02:03 | Apply `#hideDffBtn` | PPR +1.9 s |
| 2307 | 12:02:11 | **Save** `#ABSaveBtn` | `form_submit` (oapc=17); "Saved Successfully. (Reference=XXEVF20061_0002...)"; URL con `batchId=50150561&initMode=U` |
| 2353-2380 | 12:03:52 | Add File -> iframe upload -> PDF -> Upload -> Apply | `form_submit` (oapc 20 -> 21); enlace "F 2943361- Mercado Pago Commission - August 2026.pdf" |
| 2494-2527 | 12:11:07 | Add File -> XLSX -> Upload -> Apply | oapc 22 -> 23; enlace "Reporte_Facturacion_MercadoPago_Ago2026 (1).xlsx" |
| 2555 | 12:11:37 | Save | oapc=24; "Saved Successfully" |
| 2578 | 12:12:09 | Submit | oapc=27; mensaje "Please click the reset button of approval info." |
| 2596 | 12:12:28 | Reset `#AIResetBtn` | |
| 2600 | 12:12:38 | Submit | oapc=30; modal `ConfirmMsgResultAT`: "Bank account is not registered / This supplier code has no Bank Account r..." |
| 2620-2622 | 12:12:45 | check `input[name="ConfirmMsgResultAT:selected:0"]` + Apply `#ConfirmApplyBtn` | oapc=31; pagina Inquiry: "Submitted Successfully. (Reference=XXEVFXX001_...)" |

Duracion neta en GEVS: ~30 min (11:42 a 12:13) para una factura de 10 lineas.

## Quirks y decisiones para el driver

- **Clics perdidos durante PPR.** Contar filas (`input[name^="DebitTable:DAmount:"]`) en vez de contar clics en Add, y
  esperar a que el conteo suba antes del siguiente.
- **Reload real tras escribir montos.** El documento viejo sigue vivo cientos de ms tras pedir la navegacion. Cada paso se
  persiste como "en curso" antes de tocar el DOM y solo se da por hecho cuando el documento nuevo muestra el valor.
- **Formato de montos.** OAF muestra `1.508.792` (puntos de miles) y acepta `1508792` al escribir. Comparar normalizando.
- **Valores que resuelve OAF** (Project, Payee Name, Account de la fila VAT, Terms/Due Date) sirven como verificacion de
  que el PPR termino y de que el dato es el esperado.
- **Department de las filas Debit.** Se hereda de la fila 0 al pulsar Add: fijar `20148` (o el de la receta) antes.
- **Fila VAT.** Line Type `VAT`, Tax Code `CLIDD19`, sin Product, con Description y con el DFF. Su Account lo pone el LOV.
- **DFF solo en la fila VAT**, con SUPPLIER = Payee Code y TAX_RATE_CODE = Tax Code de la linea.
- **Submit.** Primera vez pide Reset de aprobadores; segunda vez abre el modal de avisos: hay que marcar la fila y Apply.
  El aviso "Bank account is not registered" es normal para este proveedor. **Lo hace la persona, no la extension**
  (decision 2026-09-20): la extension entrega la pantalla guardada con adjuntos, y solo lee el "Submitted Successfully
  (Reference=...)" de la pagina Inquiry para cerrar la corrida.
- **Ventanas hijas.** Reciben el content script (mismo host, `all_frames`), pero son pestañas distintas: se coordinan
  por `chrome.storage` (el run), nunca por `window.opener`.
- **Upload cross-host.** El iframe de `lgegltase1q` no es accesible desde la pagina padre; el content script del iframe
  pone el `File` (DataTransfer) y pulsa Upload; el del padre pulsa Apply y verifica el enlace por nombre.
- **onbeforeunload.** Antes de acciones que navegan, anular `window.onbeforeunload` (mismo cuidado que en Magento).

## Verificado en el navegador real (2026-09-19, Chrome for Testing + VPN de la extension)

Con el MCP de chrome-devtools sobre un Complex Voucher nuevo (sin guardar nada) y despues con una corrida completa de la
extension en modo paso a paso hasta el freno previo al Save (los 19 pasos anteriores quedaron exactamente como el plan):

1. **Frame.** El formulario vive en el **top frame**. Arranca en `RF.jsp?...params2=formId=55071&batchId=0` y desde el
   primer cambio pasa a `OA.jsp?page=...ComplexVoucherEntryPG&batchId=0&oapc=N`. El detector reconoce ENTRY por DOM
   (`#DefaultFormName` + `#ABSubmitBtn` + `#DebitTable`) y solo en el top frame: **cada PPR carga la pagina entera dentro
   del iframe `_pprIFrame`**, y el content script de ese iframe tambien "veia" la pantalla (duplicaba pasos).
2. **Invoice Type** arranca vacio; los demas campos no existen hasta elegirlo (`submitForm` -> navegacion).
3. **Fechas:** tipear `25/08/2026` en `#InvoiceDate` basta; el PPR (~2.3 s) copia Terms Date y Due Date (+90 dias). Lo
   mismo en `#LineDffItem1` del DFF. No hace falta el calendario.
4. **Eventos sinteticos:** setter nativo + `change` + `blur()` disparan los handlers inline de OAF (`onchange`). Payee
   Code resuelve por PPR (~2.7 s) nombre, RUT, grupo, metodo, plazo y vencimiento sin abrir ventana.
5. **Fin del PPR:** no hay spinner visible; `_pprBlocking` existe pero solo en el mundo MAIN. La señal observable desde
   el content script es el evento `load` del iframe `_pprIFrame` (coincide con el fin al milisegundo). Tiempos medidos:
   1.4 a 3.7 s. Que hace cada control se lee de su `onchange`/`onclick`: `submitForm(` = navegacion real (Invoice Type,
   montos Debit, icono DFF, Save, Submit, Add File); `_uixspu(` / `_LovInputVTF(` = PPR (fechas, payee, cuentas,
   departamento, line type, product type, Add, Apply del DFF, Reset); sin handler = nada (Invoice No, Description,
   montos del DFF, Credit Amount).
6. **Tax code CLIDD19:** la validacion por PPR no rellena nada porque el LOV busca por prefijo y `CLIDD19` casa con 10
   codigos (CLIDD19, CLIDD19NE, ..._NC, ..._ND). OAF quiere abrir la ventana LOV con `window.open`, y **sin gesto de
   usuario Chrome la bloquea** (por eso al usuario se le abrio sola y a la extension no). Solucion: el service worker
   permite emergentes en los dos hosts de GEVS con el permiso `contentSettings`; con eso la ventana se abre sola tras el
   blur, `content/lov.js` elige la fila exacta (`CLIDD19 | VAT 19% Purchase Invoice | 19 % | 11330101`) y al cerrarse
   la fila queda con cuenta `11330101`. La ventana es un frameset: el frame con `#InquiryTable` es el que actua.
7. **Add:** PPR de 1.5 a 2.5 s por fila; las filas nuevas heredan el Department de la fila 0. La fila VAT vuelve al
   departamento por defecto del usuario (20163) al cambiar el line type, igual que en la carga manual: no se compara.
8. **Montos Debit:** cada uno navega (`changeDebitAmount`), 9 navegaciones de ~4 s. Al volver, GEVS muestra `1.508.792`
   (puntos de miles) y **recalcula el Credit Amount con la suma de los debitos**: por eso el monto del credito se
   asegura al final (paso `credito-amount`), no al principio.
9. **DFF:** el icono navega; el panel tiene `#LineDffItem1..10` (ISSUE_DATE, SUPPLY_PRICE, ORIGINAL_TAX_AMOUNT,
   SUPPLIER, DECLR_CURRENCY_EXCHANGE_RATE, NON_DEDUCTIBLE_TYPE_CODE, TAX_RATE_CODE, BUSINESS_PLACE_CODE,
   NOTIFICATION_NO, VAT_NO); SUPPLIER y TAX_RATE_CODE validan por PPR sin abrir LOV; Apply (`#hideDffBtn`) es PPR.
10. **Product:** el select DIV es PPR; `DIV:CNT` en el LOV de producto valida sin ventana.

11. **Save y borrador (corrida real, batch 50165725, borrado despues):** Save asigna `batchId` y navega; **Delete**
    (`#ABDeleteBtn`, sin confirm) deja "Deleted Successfully. (Reference=XXEVFXX003_...)" en Voucher Inquiry. Es la
    via segura para deshacer un borrador de prueba.
12. **Adjuntos (corrida real):** Add File navega y muestra el iframe `upload.jsp` (host 1q); el content script del
    iframe deja el `File` por DataTransfer en `txt_attachFileKey` y pulsa Upload; `uploadResult.jsp` hace
    **`alert("File is Uploaded.")`**, un dialogo nativo que bloquea la pagina entera (en la grabacion el usuario lo
    cerraba a mano). Lo neutraliza `content/upload-alert.js` (content script del mundo MAIN en esa URL). Apply agrega el
    enlace `download.jsp?file_id=` con el nombre del archivo.
13. **Factura duplicada:** GEVS rechaza el Save de un Invoice No ya cargado para el mismo payee: "Please check and
    re-enter the invoice no. Invoice No Duplication with EVS Invoice. (Duplicate Voucher: ESCL-EV-...)". La corrida lo
    detecta (`mensajeDeError`) y se detiene con ese texto en vez de reintentar. Es tambien la red de seguridad contra
    cargar dos veces la misma factura.

# Facturas

Carga automatica de facturas de comision en **GEVS** (Global Easy Voucher System de LG, Oracle OA Framework), pantalla
**Complex Voucher Entry(LGECL)**: cabecera, credito, N lineas de debito por BU + IVA, DFF, adjuntos y Save. El **Submit
lo hace la persona** en GEVS; la extension se lo indica y anota la Reference cuando GEVS lo confirma. La fuente de datos
es el **Invoice Master File** (Excel) que mantiene Finanzas. Opcionalmente la corrida entera (lo que hizo la extension y
lo que hizo la persona) queda en una **bitacora descargable** (Registro de acciones).

**Estado: implementada y probada contra GEVS real hasta el Save y los adjuntos (2026-09-19/20).** Con la factura MP
2943361 (ya cargada por Finanzas, forzada para la prueba) la extension recorrio los 21 pasos previos al Submit: la
pantalla quedo identica al plan, el Save asigno batchId, los dos adjuntos se subieron y el borrador de prueba se borro
con Delete. El **Submit no lo hace la extension** (decision del usuario, 2026-09-20): la corrida termina en "guardada
con adjuntos" y se lo dice a la persona. Sin probar todavia en GEVS real: la bitacora y la lectura de la Reference en
Inquiry tras un Submit manual (ambas agregadas el 2026-09-20). Detalle de lo medido en `facturas-flujo-gevs.md`, seccion
"Verificado". Los archivos crudos (registro de acciones y Excel) estan en `docs/features/Facturas/`.

| Doc | Que tiene |
|---|---|
| `facturas-flujo-gevs.md` | la pantalla paso a paso: selectores, valores, PPR/reloads, ventanas LOV y calendario, iframe de upload, Submit y sus modales, quirks, lista de verificacion en navegador real |
| `facturas-datos.md` | el Excel: hojas, columnas, agrupacion en documentos, elegibilidad, receta por cliente, reglas de redondeo/IVA/N filas, Description, mapeo columna -> campo |
| `Facturas/registro_*.md` | grabacion original (Registro de acciones, 2026-09-15, factura MP 2943361, 46 min) |
| `Facturas/Invoice Master File 260831.xlsx` | copia del Excel analizado (datos financieros: no distribuir) |

Es un proceso **delicado**: el Submit crea un documento contable real. Todo el diseño prioriza verificar antes de
escribir, idempotencia ante reloads y puntos de parada explicitos.

## Alcance v1 (acordado)

- Solo `Doc Type = Invoice` de clientes con `System Module = Complex voucher`: Falabella (Direct), Paris, Walmart, Ripley
  (Fullkom), Transbank y Mercado Pago. Notas de credito = etapa 2 (todo en negativo, prefijo `CN`).
- Solo `Invoice Status = Pending`. `Draft`, `Pending Report`, `Approving` y `AP Completed` se listan con motivo.
- Una factura por corrida. La extension llena todo, adjunta y hace **Save** (queda Draft con `batchId`); el **Submit**
  (Reset + Submit + modal de avisos) **lo hace la persona en GEVS**. La extension lo indica en el popup, no toca mas la
  pantalla, y si la persona envia, lee "Submitted Successfully (Reference=...)" en Inquiry y cierra la corrida con la
  Reference; si no, "Terminar" la cierra como guardada.
- **Bitacora** (checkbox "Grabar bitacora", activa por defecto): la corrida se graba con Registro de acciones y al
  terminar se descarga sola en `Descargas/registro-acciones/<fecha>_facturas-<cliente>-<numero>/` (indice + partes). Es
  el material para darle a una IA si algo salio mal.
- Adjuntos: factura (PDF) y detalle obligatorios, subidos por el usuario en el popup y emparejados por numero de factura
  en el nombre (o `Invoice URL`); distribution se ignora por ahora.
- **Como entran los archivos (Excel y adjuntos): pegando con Ctrl+V.** Dentro de la red de LG la politica de DLP deja el
  dialogo de "Subir archivo" sin devolver nada, asi que la via buena es copiar el archivo en el Explorador (Ctrl+C) y
  pegarlo en el popup; el navegador entrega los bytes sin abrir ningun dialogo. Mismo truco que en el modulo
  DevolucionesSeller del portal. La zona (`shared/ui/file-intake.js`) acepta las tres vias -pegar, arrastrar y el
  selector de siempre- y el selector sigue ahi para los equipos sin el bloqueo. Ojo con el orden: al pasar al Explorador
  el popup se cierra, asi que se copia primero y se pega al reabrirlo (el portapapeles sobrevive).
- Description: `F <num> - <title> - <Mes en ingles> <Year>` a partir del `Impact Month`.
- Redondeo al entero mas cercano; IVA = round(NET' * 0.19); Credit = NET' + IVA' (cuadre garantizado).

## Patron

Hibrido **tick-por-reload en cualquier frame** + claim con token (heartbeat). La pantalla vive en un iframe y hace
`form_submit` tras casi cada blur, asi que `wireReloadTickLifecycle` se usa con `topFrameOnly: false` (opcion nueva) y el
tick solo actua en el frame cuyo detector reconoce la pantalla. Cada paso escribe `pasoEnCurso` en storage **antes** de
tocar el DOM y solo se da por hecho cuando `verificar()` lo lee en el documento nuevo. Las ventanas LOV y el iframe de
upload (otro host) reciben el content script y se coordinan por el run en `chrome.storage`.

## Estructura

```
src/features/facturas/
├── constants.js        ids, STORAGE_KEYS, MESSAGES, SELECTORS de la pantalla, GEVS (codigos fijos), PASOS (orden y
│                       rotulo de cada paso), FASE, FINISH_REASON, tiempos
├── state.js            run store + draft (documentos del Excel, sin el workbook) + plan + resultados
├── debug.js            __extLgeCl.facturas.{diagnose, leerPantalla, run, plan, mensajes, huella, procesando, escribir, elegir}
├── reglas/             CAPA PURA (tests/unit/facturas-reglas.test.js, facturas-excel.test.js):
│   ├── hojas.js        matrices (header:1) -> filas de Master 1 / Master 2 / Map; fechas como 'yyyy-mm-dd'
│   ├── excel.js        frontera con SheetJS: leerMasterFile(ArrayBuffer) -> { master1, master2, mapa }
│   ├── agrupar.js      filas -> documentos (12 filas = 1 factura con lineas por BU + TOTAL)
│   ├── receta.js       Map (fuente) + Master 2 (titulo, cuentas, tax code) -> receta por cliente; avisa si difieren
│   ├── calculo.js      redondeo ROUND de Excel, NET', IVA', CREDIT, N filas
│   ├── descripcion.js  "F <num> - <titulo> - <Mes> <Year>" y fechas dd/MM/yyyy
│   ├── validar.js      elegibilidad con motivos legibles
│   └── plan.js         plan de carga (valor exacto de cada campo) + emparejado de adjuntos
├── adjuntos/store.js   IndexedDB del origen de la extension (popup escribe, SW lee): guardar/listar/leer/rol/borrar
├── background/index.js wireFacturasBackground(): INICIAR (abre la bitacora y despues el run), ADJUNTO_GET ->
│                       { nombre, tipo, contenido base64 } (tope 25 MB), y al ver el run inactivo cierra/descarga la bitacora
├── content/
│   ├── upload-alert.js content script del MUNDO MAIN en uploadResult.jsp: anula el alert("File is Uploaded.")
│   ├── detector.js     tipoPantalla(): ENTRY por DOM y solo top frame; LOV/UPLOAD/INQUIRY; batchIdDe(); diagnose()
│   ├── index.js        GET_PAGE_DATA (responde sincrono el frame ENTRY) + wireReloadTickLifecycle({ topFrameOnly:false })
│   ├── bitacora.js     anotar(mensaje, datos) -> MESSAGES.ANOTAR de Registro de acciones (solo si run.bitacora);
│   │                   registrar(level, msg) = appendLog del popup + anotar
│   ├── gevs/campos.js  leerValor, escribir (setter nativo + input/change + blur real), elegir, clic, lupaDe,
│   │                   normalizarMonto, mensajes, mensajeDeError (rechazos de GEVS)
│   ├── gevs/ppr.js     tipoDeAccion(el) por su onchange/onclick (navega | ppr | nada) y esperarAccion(el): pagehide,
│   │                   `load` del iframe _pprIFrame, o nada
│   ├── gevs/lectura.js leerPantalla(): cabecera, credit, filas debit, DFF, adjuntos, batchId, mensajes
│   ├── lov.js          en la ventana LOV: elige la fila con match EXACTO de run.esperaLov y pulsa Select
│   ├── upload.js       en el iframe upload.jsp: pide el adjunto al SW, DataTransfer -> input, Upload; en
│   │                   uploadResult.jsp marca run.adjuntoSubido
│   └── flows/run.js    motor: token por pestana (sessionStorage) + heartbeat, guardia de batchId, maquina de pasos
│       flows/pasos.js  los 22 pasos {verificar, ejecutar, progreso?, esperando?}; diferencias(pantalla, plan);
│                       actuar() anota cada escritura/clic en la bitacora ANTES de hacerla
└── popup/
    ├── view.js         tabs Datos | Adjuntos | Plan | Ejecutar
    ├── contexto.js     cargarContexto(): draft + adjuntos + receta + elegibilidad + plan de la factura elegida
    └── sections/       datos.js (Excel y tabla de facturas) - adjuntos.js - plan.js (previsualizacion) -
                        ejecutar.js (requisitos -la VPN es solo una nota, no bloquea-, paso a paso, bitacora,
                        Iniciar/Continuar/Terminar/Detener, aviso "te toca el Submit", progreso y registro)
                        datos.js y adjuntos.js cargan con la zona de pegado (Ctrl+V) de shared/ui/file-intake.js
```
Fuera de la feature: `wireReloadTickLifecycle({ topFrameOnly })` en `shared/run-store` (default `true`, sin cambio de
comportamiento), `shared/ui/format.js` (escapeHtml/formatTime/formatBytes/formatClp),
`shared/ui/file-intake.js` (zona pegar/arrastrar/selector, estilos `.fi-zone` en `popup.css`), wiring en `service-worker.js`,
`content/index.js` y `popup/features.js`, dependencia `xlsx` (SheetJS CE 0.20.3 desde cdn.sheetjs.com; sin eval,
compatible con el CSP; lee los valores cacheados de las formulas). Manifest: permiso **`contentSettings`** (el SW
permite emergentes solo en los dos hosts de GEVS, porque OAF abre el LOV con `window.open` y sin gesto Chrome lo
bloquea) y un content script `world: MAIN` en `uploadResult.jsp` (`upload-alert.js`).

## Maquina de pasos

Motor (`flows/run.js`): en cada tick del frame ENTRY (top frame) reclama la corrida con un token por pestana
(sessionStorage: sobrevive a los reloads; otra pestana se abstiene mientras el heartbeat tenga menos de 20 s), comprueba
que el `batchId` de la URL sea el de la corrida (0 hasta el Save), y recorre PASOS: `verificar()` siempre primero; si
falta, `ejecutar()` (cada escritura espera lo que su handler haga: navegacion, PPR o nada) y otra vez `verificar()`. Un
mensaje de rechazo de GEVS detiene la corrida con ese texto. Cada paso admite 3 intentos sin avance (`progreso`) y no
gasta intentos mientras espera a otro frame (`esperando`). Con "paso a paso" se pausa tras cada paso.

precondiciones -> invoice-type (navega) -> payee (PPR; valida nombre y Biz-No) -> invoice-no -> invoice-date (tipeada)
-> description -> credito (solo la cuenta) -> debito-dept (fila 0, antes de Add) -> debito-add (hasta N filas contando)
-> iva-line-type -> iva-tax-code (la validacion abre el LOV; `lov.js` elige la fila exacta; si no se abrio, lupa) ->
debito-account -> debito-amount (cada monto navega; se retoma por reload) -> iva-amount -> credito-amount (GEVS lo
recalcula con la suma: se asegura al final) -> producto -> descripcion-filas -> dff (icono navega; 5 campos; Apply) ->
verificar (pantalla vs plan, cuadre) -> guardar (Save; batchId) -> adjuntos (Add File, iframe, Apply, por archivo) ->
guardar-2 -> **LISTO_PARA_ENVIAR**: el motor para el heartbeat y no vuelve a tocar la pantalla (el tick de ENTRY solo
corre en fase CARGANDO); el popup dice "te toca el Submit". Si la persona envia, el tick de la pantalla **Inquiry** lee
"Submitted Successfully (Reference=...)" y cierra la corrida (DONE + `resultados`); "Terminar" en el popup la cierra
como GUARDADO. Tiempo medido de la carga completa hasta el Save: ~3.5 min para 10 filas.

`reclamar()` solo escribe el run cuando cambia el token o el heartbeat tiene mas de HEARTBEAT_MS: cada escritura
dispara un tick en todos los frames, y un tick que siempre escribe se llama a si mismo para siempre.

## Bitacora (Registro de acciones)

Con `config.bitacora` el SW (`MESSAGES.INICIAR`) arranca una grabacion de Registro de acciones con etiqueta
`facturas-<cliente>-<numero>` **antes** de escribir el run, y la cierra y descarga cuando el run deja de estar activo
(`storage.onChanged`), sea por fin, error, Detener o Terminar. Si la persona ya tenia una grabacion andando, la corrida
se anota ahi (`bitacora.propia = false`) y no la cierra. Que se anota (`content/bitacora.js`):
- cada escritura/eleccion/clic de la extension, ANTES de hacerla (si navega no hay despues), con selector, valor y que
  respuesta se espera de OAF (`navega | ppr | nada`); tras un PPR, cuanto tardo;
- inicio/intento/fin de cada paso, Save y batchId, LOV (fila elegida o no encontrada), upload y su confirmacion,
  errores, la entrega a la persona y la Reference;
- y, por la captura normal del grabador, **todo lo que hace la persona** (Submit, Reset, modal, correcciones a mano) y
  cada navegacion de GEVS. Las escrituras sinteticas de la extension no aparecen como acciones del usuario (no son
  `isTrusted`).
El popup muestra el `sesionId` y, al terminar, la carpeta.

## Salvaguardas

- La extension **no tiene codigo que pulse Submit**: `SELECTORS.botones.submit` solo se usa para reconocer la pantalla.
- `resultados` guarda `{customer, invoiceNumber, batchId, reference, fecha}`; reprocesar requiere override explicito.
- Parar (sin reintentos a ciegas) si el `batchId` de la URL no es el esperado, el Payee resuelto no coincide, o
  `#FwkErrorBeanId` muestra un error. Cualquier discrepancia en `verificar` detiene antes de Save.
- Modo paso a paso para las primeras corridas reales; "Simular" = previsualizacion del plan en el popup.

## Fases

0. Docs. **Hecho** (2026-09-19).
1. Capa pura `reglas/*` + tests con el fixture MP 2943361. **Hecho** (27 tests; el de `excel` lee el .xlsx real si esta).
2. Popup + store de adjuntos + SW + wiring. **Hecho**, sin probar en el navegador.
3. Content: detector, lectura y debug. **Hecho y verificado** en GEVS real (2026-09-19).
4. Driver hasta Save + LOV. **Hecho y verificado** con dos corridas reales (borrador borrado despues).
5. Adjuntos (SW + `upload.js`): **verificado**. Submit: **a cargo de la persona** (2026-09-20); la extension solo lee la Reference.
7. Bitacora (Registro de acciones) y Submit manual. **Escrito** (2026-09-20), sin probar en GEVS real.
8. Carga por Ctrl+V en Datos y Adjuntos (`shared/ui/file-intake.js`) + la VPN como nota y no como requisito.
   **Hecho y verificado en el popup real** (2026-09-21, Chrome for Testing): pegar un `.png` en Datos avisa que no es
   un Excel, pegar un `.xlsx` llega al parser, pegar texto no se intercepta y en Adjuntos lo pegado se guarda en
   IndexedDB y se borra desde la tabla. Falta probarlo con el bloqueo de DLP real en un PC de la red de LG.
6. Cierre: docs, CLAUDE.md, memoria. Hecho.

## Como probar

1. `npm run browser` (o el MCP chrome-devtools con `reload_extension`), llegar a la red de LG (si el PC no esta ya en
   ella, conectar la VPN desde la extension), loguearse en GEVS y abrir Complex Voucher (My Form List > Complex
   Voucher).
2. En DevTools del iframe del formulario (o `npm run browser:eval -- --page=active --expr="..."`):
   `__extLgeCl.facturas.diagnose()` debe dar `pantalla: "entry"` y `batchId: 0`; `leerPantalla()` sobre un Draft
   existente debe devolver los valores de la tabla del flujo.
3. Las 9 verificaciones de `facturas-flujo-gevs.md` con `escribir(selector, valor)` / `elegir(selector, value)`, que
   devuelven cuanto tardo en asentarse la pantalla y si hubo PPR. Ajustar `campos.js` (como disparar el PPR) y
   `ppr.js` (como detectar su fin) con lo medido.
4. Popup: Datos (Excel) -> Adjuntos (PDF + detalle) -> Plan (revisar) -> Ejecutar con "paso a paso" hasta Save;
   comparar `leerPantalla()` con el plan; si algo no cuadra, el paso "verificar" detiene antes del Save. Un Draft se
   borra con `#ABDeleteBtn` ("Deleted Successfully") para no dejar basura.
5. Con el voucher guardado, el popup avisa: la persona revisa y pulsa Submit en GEVS. Con "Grabar bitacora" marcado, al
   cerrar la corrida se descarga `Descargas/registro-acciones/<sesion>/` con todo el recorrido.

## Pendientes / limitaciones

- Sin probar en GEVS real: la bitacora (arranque/cierre desde el SW, anotaciones) y la lectura de la Reference en
  Inquiry tras el Submit manual. Se prueban con la primera factura real.
- Automatizar el Submit (Reset, Submit, modal de avisos) queda fuera a proposito; los selectores medidos estan en
  `facturas-flujo-gevs.md` por si algun dia se decide.
- El alert de `uploadResult.jsp` se anula con `upload-alert.js`; en la corrida de prueba el alert se cerro a mano (el
  script se agrego despues), asi que la primera factura real confirmara que ya no bloquea.
- Con un Invoice No repetido GEVS rechaza el Save ("Invoice No Duplication with EVS Invoice"): la corrida se detiene
  con ese mensaje. No hay forma (ni intencion) de saltarlo.
- Notas de credito, lote de varias facturas, `Debit Note`, ajuste `E19` de Round: etapa 2.
- Fuente de datos por API (sistema propio en vez del Excel): el parser queda aislado en `reglas/excel.js` para cambiarlo.

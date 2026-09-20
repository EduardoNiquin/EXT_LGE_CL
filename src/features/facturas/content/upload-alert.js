// Corre en el MUNDO PRINCIPAL de `uploadResult.jsp` (el iframe de adjuntos de
// GEVS), antes que cualquier script de la pagina. Esa pagina hace
// `alert("File is Uploaded.")`, que es modal: bloquea el frame, la pagina padre
// y sus content scripts hasta que alguien pulsa Aceptar, y la carga automatica
// se quedaria colgada ahi. Se reemplaza por un aviso en consola. No se toca
// nada mas de la pagina.
window.alert = (mensaje) => {
  console.info('[EXT_LGE_CL][facturas] alert suprimido en uploadResult.jsp:', mensaje);
};

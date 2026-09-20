// Frontera con SheetJS: del .xlsx a las tres tablas que usa la feature. Todo lo
// demas (agrupar, receta, calculo) trabaja sobre lo que devuelve esto y no sabe
// que existe un Excel: si un dia los datos llegan por API, se cambia solo aqui.

import { read, utils } from 'xlsx';
import { leerMapa, leerMaster1, leerMaster2, normalizar } from './hojas.js';

// Las hojas se ubican por nombre "aproximado": Finanzas las ha llamado
// "Master 1_BU v2" y "Master 1_BUv2" indistintamente.
const HOJAS = {
  master1: (n) => n.startsWith('master1bu'),
  master2: (n) => n.startsWith('master2'),
  mapa: (n) => n === 'map',
};

function nombreCompacto(nombre) {
  return normalizar(nombre).replace(/[\s_]/g, '');
}

function buscarHoja(libro, criterio) {
  // Si hay varias que casan (Master 1_BU y Master 1_BU v2), gana la ultima:
  // la mas nueva se agrega al final.
  const candidatas = libro.SheetNames.filter((n) => criterio(nombreCompacto(n)));
  const nombre = candidatas[candidatas.length - 1];
  return nombre ? libro.Sheets[nombre] : null;
}

function matriz(hoja) {
  return hoja ? utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null }) : [];
}

/**
 * @param {ArrayBuffer} buffer contenido del .xlsx
 * @returns {{ master1: object[], master2: object[], mapa: object[], hojas: string[] }}
 */
export function leerMasterFile(buffer) {
  const libro = read(buffer, { type: 'array', cellDates: true });
  const master1 = buscarHoja(libro, HOJAS.master1);
  if (!master1) throw new Error('El archivo no tiene la hoja "Master 1_BU v2".');
  return {
    master1: leerMaster1(matriz(master1)),
    master2: leerMaster2(matriz(buscarHoja(libro, HOJAS.master2))),
    mapa: leerMapa(matriz(buscarHoja(libro, HOJAS.mapa))),
    hojas: [...libro.SheetNames],
  };
}

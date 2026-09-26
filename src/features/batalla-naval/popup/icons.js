// Iconos SVG (perfil lateral) de la bandeja de despliegue. Replican a los
// modelos 3D de assets/ (mismos colores y aparejo), asi el jugador reconoce en
// la bandeja el barco que va a colocar. Sin estilos inline ni scripts (CSP).

const SPECS = {
  s4: { name: 'Navio de linea', hull: '#23201d', band: '#d9a441', masts: [0.24, 0.52, 0.8], rig: 'square', ports: 2 },
  s3: { name: 'Fragata', hull: '#3b2a1e', band: '#e8e2d0', masts: [0.33, 0.7], rig: 'square', ports: 1 },
  s2a: { name: 'Balandra roja', hull: '#6b4428', band: '#8a2b22', masts: [0.45], rig: 'gaff', ports: 0 },
  s2b: { name: 'Balandra azul', hull: '#54432f', band: '#2c4f8a', masts: [0.45], rig: 'gaff', ports: 0 },
};

const SAIL = '#efe6cf';
const MAST = '#6a4a2c';
const H = 40;
const WATER = 31;

/** Nombre legible del barco (tooltip / etiqueta). */
export function shipName(id) {
  return SPECS[id]?.name || 'Barco';
}

/** Perfil del barco `id` de `size` casillas. El ancho escala con el tamano. */
export function shipIconSvg(id, size) {
  const s = SPECS[id] || SPECS.s2a;
  const W = size * 26;
  const top = 22;          // borda
  const stern = top - 5;   // toldilla (popa alta)
  const hull = `M2 ${stern} L${W * 0.18} ${stern} L${W * 0.2} ${top} L${W - 7} ${top} L${W - 1} ${top - 3} `
    + `L${W - 8} ${WATER + 2} L7 ${WATER + 2} Z`;
  const parts = [`<path fill="${s.hull}" d="${hull}"/>`];
  parts.push(`<rect fill="${s.band}" x="3" y="${top + 1}" width="${W - 11}" height="3"/>`);
  for (let row = 0; row < s.ports; row++) {
    for (let x = W * 0.24; x < W * 0.78; x += 7) {
      parts.push(`<rect fill="#111" x="${x.toFixed(1)}" y="${top + 1 + row * 4}" width="2.4" height="2"/>`);
    }
  }
  // Bauprés
  parts.push(`<path stroke="${MAST}" stroke-width="1.4" d="M${W - 4} ${top - 2} L${W + 0} ${top - 8}"/>`);

  const mastH = size >= 3 ? 20 : 17;
  s.masts.forEach((f, i) => {
    const x = (W * f).toFixed(1);
    const h = i === Math.floor(s.masts.length / 2) ? mastH : mastH - 3;
    const y0 = top - h;
    parts.push(`<path stroke="${MAST}" stroke-width="1.3" d="M${x} ${top} L${x} ${y0 - 2}"/>`);
    if (s.rig === 'square') {
      const w = Math.min(15, W / (s.masts.length + 0.8));
      const tiers = [[y0 + 1, 6], [y0 + 8, 7]];
      for (const [y, hh] of tiers) {
        parts.push(`<path fill="${SAIL}" stroke="#bfb49a" stroke-width="0.5" d="M${x - w / 2} ${y} L${+x + w / 2} ${y} `
          + `Q${+x + w / 2 + 1.5} ${y + hh / 2} ${+x + w / 2} ${y + hh} L${x - w / 2} ${y + hh} Q${x - w / 2 + 1.5} ${y + hh / 2} ${x - w / 2} ${y}Z"/>`);
      }
    } else {
      // Cangreja a popa + foque a proa.
      parts.push(`<path fill="${SAIL}" stroke="#bfb49a" stroke-width="0.5" d="M${+x - 1} ${y0 + 1} L${x - W * 0.34} ${y0 + 5} L${x - W * 0.36} ${top - 2} L${+x - 1} ${top - 2}Z"/>`);
      parts.push(`<path fill="${SAIL}" stroke="#bfb49a" stroke-width="0.5" d="M${+x + 1} ${y0 + 1} L${W - 3} ${top - 3} L${+x + 1} ${top - 3}Z"/>`);
    }
    if (i === Math.floor(s.masts.length / 2)) {
      parts.push(`<path fill="#b3261e" d="M${x} ${y0 - 2} L${x - 7} ${y0} L${x} ${y0 + 1.5}Z"/>`);
    }
  });
  // Olas bajo el casco.
  parts.push(`<path fill="none" stroke="#4fc3f7" stroke-width="1.3" stroke-linecap="round" d="M1 ${WATER + 4} q3 -2 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0"/>`);
  return `<svg class="bn-ship-icon" viewBox="-1 0 ${W + 2} ${H}" width="${W}" height="${H}" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Mina marina (esfera con puas, como el modelo 3D). */
export function mineIconSvg(px = 26) {
  const spikes = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const r = (a * Math.PI) / 180;
    const x1 = 13 + Math.cos(r) * 7;
    const y1 = 13 + Math.sin(r) * 7;
    const x2 = 13 + Math.cos(r) * 11.5;
    const y2 = 13 + Math.sin(r) * 11.5;
    return `<path stroke="#3a3f44" stroke-width="2.2" stroke-linecap="round" d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
  }).join('');
  return `<svg class="bn-mine-icon" viewBox="0 0 26 26" width="${px}" height="${px}" aria-hidden="true">${spikes}`
    + '<circle cx="13" cy="13" r="7.5" fill="#3a3f44"/><path fill="none" stroke="#8a4b2a" stroke-width="1.4" d="M5.6 13h14.8"/>'
    + '<circle cx="10.5" cy="10.5" r="1.8" fill="#6b737a"/><circle cx="13" cy="2.2" r="1.6" fill="#b3261e"/></svg>';
}

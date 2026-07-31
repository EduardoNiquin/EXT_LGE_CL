// Helpers de UI compartidos por las plataformas del apartado Devoluciones.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Copia texto al portapapeles, con respaldo para contextos sin permiso. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Acuse visual de "copiado" en un boton, sin tocar su texto original. */
export function marcarCopiado(boton, etiqueta = 'Copiado') {
  if (!boton) return;
  const original = boton.dataset.original ?? boton.textContent;
  boton.dataset.original = original;
  boton.textContent = etiqueta;
  boton.classList.add('is-copied');
  clearTimeout(Number(boton.dataset.timer));
  boton.dataset.timer = String(setTimeout(() => {
    boton.textContent = original;
    boton.classList.remove('is-copied');
  }, 1200));
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Copia texto al portapapeles con fallback para contextos sin clipboard API.
export async function copyToClipboard(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* cae al fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Serializa los grupos a texto plano legible (label: value por línea).
export function groupsToText(groups) {
  return groups
    .map((g) => {
      const lines = g.fields.map((f) => `  ${f.label}: ${f.raw}`).join('\n');
      return `# ${g.label}\n${lines}`;
    })
    .join('\n\n');
}

export function groupToText(group) {
  return groupsToText([group]);
}

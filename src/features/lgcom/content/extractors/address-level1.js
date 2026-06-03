// Extractor de la operación `getAddressLevel1` (lista de regiones de Chile).
//
// Devuelve la misma forma de grupos que el resto de extractores: cada región es
// un campo label=nombre, value/raw=id, para que sea fácil de buscar y copiar.

export function extractAddressLevel1(response) {
  const root = response?.data?.getAddressLevel1;
  if (!root) return null;

  const regions = Array.isArray(root.addressLevel1) ? root.addressLevel1 : [];
  if (regions.length === 0) return [];

  const fields = regions.map((r) => ({
    label: String(r.name ?? r.code ?? r.id ?? ''),
    value: `id ${r.id}`,
    raw: String(r.id ?? ''),
  }));

  const total = root.total_count != null ? root.total_count : regions.length;
  return [
    { id: 'regiones', label: `Regiones (${total})`, fields },
  ];
}

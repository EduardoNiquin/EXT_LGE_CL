// Extractor de la operación `getAddressLevel2` (comunas de una región).
// Misma forma que getAddressLevel1: cada comuna es un campo nombre → id.

export function extractAddressLevel2(response) {
  const root = response?.data?.getAddressLevel2;
  if (!root) return null;

  const comunas = Array.isArray(root.addressLevel2) ? root.addressLevel2 : [];
  if (comunas.length === 0) return [];

  const fields = comunas.map((c) => ({
    label: String(c.name ?? c.id ?? ''),
    value: `id ${c.id}`,
    raw: String(c.id ?? ''),
  }));

  const total = root.total_count != null ? root.total_count : comunas.length;
  return [
    { id: 'comunas', label: `Comunas (${total})`, fields },
  ];
}

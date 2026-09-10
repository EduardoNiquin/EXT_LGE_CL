// Abre Magento > Crear Softbundles en el popup y deja escrita una lista de
// ejemplo. Se ejecuta con:
//   npm run browser:eval -- --file=scripts/snippets/abrir-softbundles.js --keep
//
// `--keep` deja la pestana abierta, asi las llamadas siguientes siguen sobre la
// misma vista (el popup se reusa mientras su contexto siga vivo).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// El home del popup son <li>, no <button>.
const magento = Array.from(document.querySelectorAll('.feature-name'))
  .find((el) => el.textContent.trim() === 'Magento');
if (!magento) throw new Error('No se encontro la feature Magento en el home del popup.');
magento.closest('li').click();
await wait(1200);

const modulo = document.querySelector('[data-module="softbundles"]');
if (!modulo) throw new Error('No se encontro el modulo Crear Softbundles.');
modulo.click();
await wait(1500);

const textarea = document.querySelector('#sb-text');
textarea.value = 'CL.86MRGB95BSA.AWH,RNC7:10,CL.S30A.ACHLLLK\nOTRO.SKU,HIJO1';
textarea.dispatchEvent(new Event('input', { bubbles: true }));
await wait(500);

return {
  titulo: document.querySelector('.lt-section-title').textContent,
  previsualizacion: document.querySelector('#sb-preview').textContent.replace(/\s+/g, ' ').trim(),
  simulacion: document.querySelector('#sb-dry-run').checked,
  omitirExistentes: document.querySelector('#sb-skip-existing').checked,
};

import { getStorage, setStorage } from '../shared/storage/storage.js';

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getStorage('settings');
  console.log('[options] Loaded settings:', settings);
});

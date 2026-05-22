import { SELECTORS } from '../constants.js';

export function isMarketingInfoMappingPage() {
  return Boolean(
    document.querySelector(SELECTORS.searchForm) &&
    document.querySelector(SELECTORS.searchPanel) &&
    document.querySelector(SELECTORS.tabView) &&
    document.querySelector(SELECTORS.gridStg)
  );
}

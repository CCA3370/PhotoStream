const dataSaverSelector = '[data-photostream-data-saver="true"]';

export function isAlbumDataSaverActive(): boolean {
  return typeof document !== "undefined" && document.querySelector(dataSaverSelector) !== null;
}

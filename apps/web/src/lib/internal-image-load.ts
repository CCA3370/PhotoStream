interface InternalImageLoad {
  readonly resolvedStrategy: string | undefined;
  readonly currentStrategy: string;
  readonly displayedSource: string;
  readonly requestedSource: string;
}

export function notifyCurrentInternalImageLoad(
  image: InternalImageLoad,
  onLoaded: () => void,
): void {
  if (
    image.resolvedStrategy !== image.currentStrategy ||
    image.displayedSource.length === 0 ||
    image.displayedSource !== image.requestedSource
  ) {
    return;
  }
  onLoaded();
}

interface InternalImageLoad {
  readonly resolvedStrategy: string | undefined;
  readonly currentStrategy: string;
  readonly resolvedSource: string | undefined;
  readonly displayedSource: string;
  readonly requestedSource: string;
}

export function notifyCurrentInternalImageLoad(
  image: InternalImageLoad,
  onLoaded: () => void,
): void {
  if (
    image.resolvedStrategy !== image.currentStrategy ||
    image.resolvedSource !== image.displayedSource ||
    image.displayedSource.length === 0 ||
    image.displayedSource !== image.requestedSource
  ) {
    return;
  }
  onLoaded();
}

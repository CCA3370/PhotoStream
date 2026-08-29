export function selectMediaRange(
  orderedMediaIds: readonly string[],
  selected: ReadonlySet<string>,
  anchorId: string,
  targetId: string,
): ReadonlySet<string> {
  const anchorIndex = orderedMediaIds.indexOf(anchorId);
  const targetIndex = orderedMediaIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return new Set(selected);
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const next = new Set(selected);
  for (let index = start; index <= end; index += 1) {
    const mediaId = orderedMediaIds[index];
    if (mediaId !== undefined) next.add(mediaId);
  }
  return next;
}

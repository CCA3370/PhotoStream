export function reviewLightboxQueue<T extends { readonly key: string }>(
  items: readonly T[],
  queueKeys: readonly string[],
  activeKey: string | null,
  matchesFilters: (item: T) => boolean,
): readonly T[] {
  if (activeKey === null) return [];
  const byKey = new Map(items.map((item) => [item.key, item]));
  const keys = new Set(queueKeys);
  if (byKey.has(activeKey)) keys.add(activeKey);
  return [...keys]
    .map((key) => byKey.get(key))
    .filter((item): item is T => item !== undefined)
    .filter((item) => item.key === activeKey || matchesFilters(item));
}

export interface CategoryShortcutKeyboardEvent {
  readonly altKey: boolean;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

function keyForCode(code: string): string | null {
  if (/^Digit[0-9]$/u.test(code)) return code.slice("Digit".length);
  if (/^Numpad[0-9]$/u.test(code)) return code.slice("Numpad".length);
  if (/^Key[A-Z]$/u.test(code)) return code.slice("Key".length);
  if (/^F(?:[1-9]|1[0-2])$/u.test(code)) return code;
  return null;
}

export function categoryShortcutFromKeyboardEvent(
  event: CategoryShortcutKeyboardEvent,
): string | null {
  const key = keyForCode(event.code);
  if (key === null) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  if (modifiers.length === 0) return null;

  return [...modifiers, key].join("+");
}

export function categoryShortcutMatches(
  event: CategoryShortcutKeyboardEvent,
  shortcut: string,
): boolean {
  const parts = shortcut.split("+");
  const expectedKey = parts.at(-1);
  if (expectedKey === undefined || keyForCode(event.code) !== expectedKey) return false;

  return (
    event.ctrlKey === parts.includes("Ctrl") &&
    event.altKey === parts.includes("Alt") &&
    event.shiftKey === parts.includes("Shift") &&
    event.metaKey === parts.includes("Meta")
  );
}

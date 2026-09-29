import { describe, expect, it } from "vitest";

import { categoryShortcutFromKeyboardEvent, categoryShortcutMatches } from "./category-shortcut";

function keyboard(
  code: string,
  modifiers: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) {
  return {
    altKey: false,
    code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("category shortcuts", () => {
  it("captures canonical modifier shortcuts from physical key codes", () => {
    expect(categoryShortcutFromKeyboardEvent(keyboard("Digit3", { ctrlKey: true }))).toBe("Ctrl+3");
    expect(
      categoryShortcutFromKeyboardEvent(keyboard("KeyK", { ctrlKey: true, shiftKey: true })),
    ).toBe("Ctrl+Shift+K");
  });

  it("requires at least one modifier and ignores unsupported keys", () => {
    expect(categoryShortcutFromKeyboardEvent(keyboard("Digit3"))).toBeNull();
    expect(categoryShortcutFromKeyboardEvent(keyboard("ArrowLeft", { ctrlKey: true }))).toBeNull();
  });

  it("matches exact modifier combinations", () => {
    expect(categoryShortcutMatches(keyboard("Digit1", { ctrlKey: true }), "Ctrl+1")).toBe(true);
    expect(
      categoryShortcutMatches(keyboard("Digit1", { ctrlKey: true, shiftKey: true }), "Ctrl+1"),
    ).toBe(false);
  });
});

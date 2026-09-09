/** A deliberate horizontal drag starts loading while the transition is still under the finger. */
export function swipeIntentDirection(deltaX: number, deltaY: number): -1 | 1 | null {
  if (Math.abs(deltaX) < 16 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.5) return null;
  return deltaX < 0 ? 1 : -1;
}

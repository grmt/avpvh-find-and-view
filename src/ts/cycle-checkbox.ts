// Clicking a tree checkbox normally just toggles it (check/uncheck this
// branch, cascading to its own descendants, same as native behavior).
// A 4-click cycle on the *same* checkbox: click 1/2 are the normal
// toggle; click 3 solos the branch (it and its descendants checked,
// everything else within the same top-level tree unchecked); click 4
// restores every checkbox in that tree to exactly what it was before
// click 1 — undoing the whole cycle rather than just toggling again.
// Click 5 then starts a fresh cycle from that restored state.
export function attachCycleCheckbox(
  cb: HTMLInputElement,
  li: HTMLElement,
  hasChildren: boolean,
  scopeRoot: () => HTMLElement | null,
  onFilterChange: () => void,
  updateParents: (el: HTMLElement) => void,
): void {
  let phase = 0;
  let snapshot: Map<HTMLInputElement, boolean> | null = null;
  cb.addEventListener('change', () => {
    const root = scopeRoot();
    if (phase === 0 && root) {
      // Starting a new cycle: remember every checkbox in scope so click 4
      // can restore it. The native click already toggled `cb` itself, so
      // its pre-click value is the opposite of its current one.
      snapshot = new Map(
        [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
          .map(c => [c, c === cb ? !c.checked : c.checked]),
      );
    }
    phase = (phase + 1) % 4;

    if (phase === 3 && root) {
      // Solo: this branch checked, everything else in the tree unchecked.
      const mine = new Set(li.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
      mine.add(cb);
      root.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => {
        c.checked = mine.has(c);
        c.indeterminate = false;
      });
      root.querySelectorAll<HTMLElement>('.fav-col-tree-leaf').forEach(leaf => updateParents(leaf));
    } else if (phase === 0 && root && snapshot) {
      // Restore: undo the whole cycle.
      snapshot.forEach((checked, c) => { c.checked = checked; c.indeterminate = false; });
      root.querySelectorAll<HTMLElement>('.fav-col-tree-leaf').forEach(leaf => updateParents(leaf));
      snapshot = null;
    } else {
      if (hasChildren) {
        li.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => {
          c.checked = cb.checked;
          c.indeterminate = false;
        });
      }
      updateParents(li);
    }
    onFilterChange();
  });
}

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { attachCycleCheckbox } from '../../src/ts/cycle-checkbox';

// root
// ├── a (folder)  ── a1, a2
// └── b
let root: HTMLElement;
let onFilterChange: Mock<() => void>;
let updateParents: Mock<(el: HTMLElement) => void>;
const box = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)!;
const state = () => ['a', 'a1', 'a2', 'b'].map(id => box(id).checked);

// A user click: the browser toggles the box, then fires change.
function click(id: string) {
  box(id).checked = !box(id).checked;
  box(id).dispatchEvent(new Event('change'));
}

beforeEach(() => {
  document.body.innerHTML = `
    <ul id="root">
      <li id="li-a"><input type="checkbox" id="a">
        <ul>
          <li class="fav-col-tree-leaf"><input type="checkbox" id="a1"></li>
          <li class="fav-col-tree-leaf"><input type="checkbox" id="a2"></li>
        </ul>
      </li>
      <li id="li-b" class="fav-col-tree-leaf"><input type="checkbox" id="b"></li>
    </ul>`;
  root = document.getElementById('root')!;
  onFilterChange = vi.fn<() => void>();
  updateParents = vi.fn<(el: HTMLElement) => void>();
  attachCycleCheckbox(box('a'), document.getElementById('li-a')!, true, () => root, onFilterChange, updateParents);
  attachCycleCheckbox(box('b'), document.getElementById('li-b')!, false, () => root, onFilterChange, updateParents);
});

describe('attachCycleCheckbox', () => {
  it('cascades a normal toggle to the branch', () => {
    click('a');
    expect(state()).toEqual([true, true, true, false]);
    expect(updateParents).toHaveBeenCalledWith(document.getElementById('li-a'));
    expect(onFilterChange).toHaveBeenCalledOnce();

    click('a');
    expect(state()).toEqual([false, false, false, false]);
  });

  it('solos the branch on the third click and restores on the fourth', () => {
    click('b');
    expect(state()).toEqual([false, false, false, true]);

    click('a');
    click('a');
    click('a');
    expect(state()).toEqual([true, true, true, false]);
    expect(box('a').indeterminate).toBe(false);

    click('a');
    expect(state()).toEqual([false, false, false, true]);
    expect(onFilterChange).toHaveBeenCalledTimes(5);
  });

  it('toggles only itself when it has no children', () => {
    click('b');
    expect(state()).toEqual([false, false, false, true]);
    expect(updateParents).toHaveBeenCalledWith(document.getElementById('li-b'));
  });

  it('just toggles when the tree is not there', () => {
    document.body.innerHTML = '<li id="li-x"><input type="checkbox" id="x"></li>';
    const x = document.getElementById('x') as HTMLInputElement;
    const changed = vi.fn();
    attachCycleCheckbox(x, document.getElementById('li-x')!, false, () => null, changed, vi.fn());

    for (let n = 0; n < 4; n++) {
      x.checked = !x.checked;
      x.dispatchEvent(new Event('change'));
    }
    expect(x.checked).toBe(false);
    expect(changed).toHaveBeenCalledTimes(4);
  });
});

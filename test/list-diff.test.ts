import { apply, create } from '../src';
import { Operation } from '../src/interface';

test('patches should be minimal', () => {
  const data = { list: [1, 2] };
  const [state, patches, inversePatches] = create(
    data,
    (draft) => {
      draft.list.splice(0, 1);
    },
    {
      enablePatches: {
        pathAsArray: true,
        arrayLengthAssignment: false,
      },
      createListDiff: (params) => {
        const arrayDiff = computeArrayDiff(params.original, params.copy);
        const inverseArrayDiff = computeArrayDiff(params.copy, params.original);

        function convert(item: ArrayDiffItem<any>) {
          switch (item[0]) {
            case 'a':
              const [, value, to] = item;
              return {
                op: Operation.Add,
                path: params.concatPath(to ?? '~'),
                value: params.cloneIfNeeded(value),
              };
            case 'r':
              return {
                op: Operation.Remove,
                path: params.concatPath(item[1]),
              };
            case 'm':
              return {
                op: Operation.Move,
                path: params.concatPath(item[1]),
                from: params.concatPath(item[2]),
              };
          }
        }

        const patches = arrayDiff.map(convert);
        const inversePatches = inverseArrayDiff.map(convert);

        return {
          patches,
          inversePatches,
        };
      },
    }
  );

  expect(state).toEqual({ list: [2] });
  expect(apply(data, patches)).toEqual({ list: [2] });
  expect(apply(state, inversePatches)).toEqual(data);

  console.log(patches);
  console.log(inversePatches);
});

export type ArrayDiffAddItem<T> =
  | [type: 'a', item: T]
  | [type: 'a', item: T, to: number];

export type ArrayDiffItem<T> =
  | ArrayDiffAddItem<T>
  | [type: 'r', from: number | string]
  | [type: 'm', from: number, to: number];

export function added<T>(item: T, to?: number): ArrayDiffItem<T> {
  if (to === undefined) {
    return ['a', item];
  }

  return ['a', item, to];
}

export function removed<T>(from: number | string): ArrayDiffItem<T> {
  return ['r', from];
}

export function moved<T>(from: number, to: number): ArrayDiffItem<T> {
  return ['m', from, to];
}

function filterDuplicates<T>(
  a: T[],
  identity: (item: T) => unknown = (item) => item
): T[] {
  const map = new Map(a.map((item, index) => [identity(item), index]));

  return [...map.values()].map((index) => a[index]);
}

export function computeArrayDiff(
  a: string[],
  b: string[]
): ArrayDiffItem<string>[];
export function computeArrayDiff<T>(
  a: T[],
  b: T[],
  identity: (item: T) => string,
  options?: { removalMode?: 'key' | 'index' }
): ArrayDiffItem<T>[];
export function computeArrayDiff<T>(
  a: T[],
  b: T[],
  identity: (item: T) => string = (item) => item as string,
  options: { removalMode?: 'key' | 'index' } = {}
): ArrayDiffItem<T>[] {
  const items: ArrayDiffItem<T>[] = [];
  const aMap = new Map(a.map((item, index) => [identity(item), index]));
  const bMap = new Map(b.map((item, index) => [identity(item), index]));
  let result: T[] = [...a];

  // Detect duplicates by comparing array length vs map size.
  if (aMap.size !== a.length || bMap.size !== b.length) {
    return computeArrayDiff(
      filterDuplicates(a, identity),
      filterDuplicates(b, identity),
      identity,
      options
    );
  }

  // Check for removed items.
  let removalOffset = 0;
  for (let i = 0; i < a.length; i++) {
    const item = a[i];
    const itemIdentity = identity(item);
    if (!bMap.has(itemIdentity)) {
      items.push(
        removed(
          options.removalMode === 'key' ? itemIdentity : i - removalOffset
        )
      );
      applyArrayDiffItemMutable(result, items[items.length - 1], identity);
      removalOffset++;
    }
  }

  // Check for added items.
  for (let i = 0; i < b.length; i++) {
    const item = b[i];
    if (!aMap.has(identity(item))) {
      // Check if i is the last index in the current result.
      if (i === result.length) {
        items.push(added(item));
        // console.log('yes');
      } else {
        items.push(added(item, i));
      }

      // items.push(added(item, i));
      applyArrayDiffItemMutable(result, items[items.length - 1], identity);
    }
  }

  items.push(...computeArrayMoves(result, b, identity));

  return items;
}

function getIndex<T>(
  items: T[],
  indexOrKey: number | string,
  identity: (item: T) => string
): number {
  return typeof indexOrKey === 'number'
    ? indexOrKey
    : items.findIndex((item) => indexOrKey === identity(item));
}

function applyArrayDiffItemMutable<T>(
  a: T[],
  item: ArrayDiffItem<T>,
  identity: (item: T) => string
): void {
  switch (item[0]) {
    case 'a':
      if (item.length === 3) {
        a.splice(item[2], 0, item[1]);
      } else {
        a.push(item[1]);
      }
      break;
    case 'r':
      a.splice(getIndex(a, item[1], identity), 1);
      break;
    case 'm':
      const [movedItem] = a.splice(item[1], 1);
      a.splice(item[2], 0, movedItem);
      break;
  }
}

export function applyArrayDiff(
  a: string[],
  items: ArrayDiffItem<string>[]
): string[];
export function applyArrayDiff<T>(
  a: T[],
  items: ArrayDiffItem<T>[],
  identity: (item: T) => string
): T[];
export function applyArrayDiff<T>(
  a: T[],
  items: ArrayDiffItem<T>[],
  identity: (item: T) => string = (item) => item as string
): T[] {
  let result = [...a];

  for (const item of items) {
    applyArrayDiffItemMutable(result, item, identity);
  }

  return result;
}

export function mapArrayDiff<T, K>(
  items: ArrayDiffItem<T>[],
  map: (item: T) => K
): ArrayDiffItem<K>[] {
  return items.map((item) => {
    switch (item[0]) {
      case 'a':
        if (item.length === 3) {
          return added(map(item[1]), item[2]);
        } else {
          return added(map(item[1]));
        }
      case 'r':
        return removed(item[1]);
      case 'm':
        return moved(item[1], item[2]);
      default:
        throw new Error(`Invalid diff item type: ${item[0]}`);
    }
  });
}

export function describeDiffItem<T>(
  item: ArrayDiffItem<T>,
  getLabel: (item: T) => string
): string {
  switch (item[0]) {
    case 'a':
      return `+${getLabel(item[1])}`;
    case 'r':
      return `-${item[1]}`;
    case 'm':
      return `-${item[1]} -> +${item[2]}`;
  }
}

export function getAddedItems<T>(items: ArrayDiffItem<T>[]): T[] {
  return items.flatMap((item) => (item[0] === 'a' ? [item[1]] : []));
}

function computeArrayMoves<T>(
  a: T[],
  b: T[],
  identity: (item: T) => string = (item) => item as string
): ArrayDiffItem<T>[] {
  const items: ArrayDiffItem<T>[] = [];
  const indexMap = new Map<string, number>();
  const result = [...a];

  // Prepare a map from item identity to its target index in array b
  b.forEach((item, index) => {
    indexMap.set(identity(item), index);
  });

  // Iterate over the array and move each item to its correct position
  for (let i = 0; i < result.length; i++) {
    const currentId = identity(result[i]);
    const targetIndex = indexMap.get(currentId)!;

    if (i !== targetIndex) {
      const itemToMoveIndex = result.findIndex(
        (item, idx) => idx >= i && identity(item) === identity(b[i])
      );
      if (itemToMoveIndex > i) {
        // Move operation: item needs to be moved to the current index i
        const move = moved<T>(itemToMoveIndex, i);
        items.push(move);

        // Perform the move
        const [movedItem] = result.splice(itemToMoveIndex, 1); // Remove the item from its current position
        result.splice(i, 0, movedItem); // Insert it at the target position
      }
    }
  }

  return items;
}

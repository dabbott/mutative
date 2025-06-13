import { apply, create } from '../src';
import { CreateListDiffParams, Operation } from '../src/interface';

function identity<T>(item: T): string {
  // return item as string;
  return typeof item === 'object' && item !== null && 'id' in item
    ? (item.id as string)
    : (item as string);
}

function createListDiff(params: CreateListDiffParams) {
  const arrayDiff = computeArrayDiff(params.original, params.copy, identity);
  const inverseArrayDiff = computeArrayDiff(
    params.copy,
    params.original,
    identity
  );

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
          from: params.concatPath(item[1]),
          path: params.concatPath(item[2]),
        };
    }
  }

  const patches = arrayDiff.map(convert);
  const inversePatches = inverseArrayDiff.map(convert);

  return {
    patches,
    inversePatches,
  };
}

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
      createListDiff,
    }
  );

  expect(state).toEqual({ list: [2] });
  expect(apply(data, patches)).toEqual(state);
  expect(apply(state, inversePatches)).toEqual(data);
  expect(patches.length).toBe(1);
  expect(inversePatches.length).toBe(1);
});

test('patches should detect moves', () => {
  const data = {
    todos: [
      { id: 1, title: 'Buy groceries' },
      { id: 2, title: 'Buy groceries' },
      { id: 3, title: 'Buy groceries' },
    ],
  };
  const [state, patches, inversePatches] = create(
    data,
    (draft) => {
      const last = draft.todos.pop();
      draft.todos.unshift(last!);
    },
    {
      enablePatches: {
        pathAsArray: true,
        arrayLengthAssignment: false,
      },
      createListDiff,
    }
  );

  console.log(patches);
  console.log(inversePatches);

  expect(state).toEqual({
    todos: [
      { id: 3, title: 'Buy groceries' },
      { id: 1, title: 'Buy groceries' },
      { id: 2, title: 'Buy groceries' },
    ],
  });
  expect(apply(data, patches)).toEqual(state);
  expect(apply(state, inversePatches)).toEqual(data);
  expect(patches.length).toBe(1);
  expect(inversePatches.length).toBe(2);
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
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0)
    return b.map((item, i) =>
      i === b.length - 1 ? added<T>(item) : added<T>(item, i)
    );
  if (b.length === 0)
    return a
      .map((_, i) =>
        removed<T>(options.removalMode === 'key' ? identity(a[i]) : i)
      )
      .reverse();

  const aIdentities = a.map(identity);
  const bIdentities = b.map(identity);

  if (
    a.length === b.length &&
    aIdentities.every((id, i) => id === bIdentities[i])
  ) {
    return [];
  }

  const operations: ArrayDiffItem<T>[] = [];

  const aContentMap = new Map<string, number[]>();
  const bContentMap = new Map<string, number[]>();

  for (let i = 0; i < aIdentities.length; i++) {
    const content = aIdentities[i];
    if (!aContentMap.has(content)) aContentMap.set(content, []);
    aContentMap.get(content)!.push(i);
  }

  for (let i = 0; i < bIdentities.length; i++) {
    const content = bIdentities[i];
    if (!bContentMap.has(content)) bContentMap.set(content, []);
    bContentMap.get(content)!.push(i);
  }

  const aUsed = new Set<number>();
  const bUsed = new Set<number>();

  for (let bIndex = 0; bIndex < b.length; bIndex++) {
    const content = bIdentities[bIndex];
    const availableAIndices =
      aContentMap.get(content)?.filter((aIndex) => !aUsed.has(aIndex)) || [];

    if (availableAIndices.length > 0) {
      const bestAIndex = availableAIndices[0];
      aUsed.add(bestAIndex);
      bUsed.add(bIndex);
    }
  }

  let result = [...a];
  let resultIdentities = [...aIdentities];

  let removalCount = 0;

  for (let i = 0; i < a.length; i++) {
    if (!aUsed.has(i)) {
      operations.push(
        removed(
          options.removalMode === 'key' ? aIdentities[i] : i - removalCount
        )
      );

      result.splice(i - removalCount, 1);
      resultIdentities.splice(i - removalCount, 1);

      removalCount++;
    }
  }

  const addOperations: ArrayDiffItem<T>[] = [];
  const moveOperations: ArrayDiffItem<T>[] = [];

  for (let targetPos = 0; targetPos < b.length; targetPos++) {
    const targetItem = b[targetPos];

    if (!bUsed.has(targetPos)) {
      if (targetPos === result.length) {
        addOperations.push(added(targetItem));
      } else {
        addOperations.push(added(targetItem, targetPos));
      }

      result.splice(targetPos, 0, targetItem);
      resultIdentities.splice(targetPos, 0, bIdentities[targetPos]);
    }
  }

  for (let targetPos = 0; targetPos < b.length; targetPos++) {
    if (bUsed.has(targetPos)) {
      const targetContent = bIdentities[targetPos];

      let currentPos = -1;
      for (let i = targetPos; i < resultIdentities.length; i++) {
        if (resultIdentities[i] === targetContent) {
          currentPos = i;
          break;
        }
      }

      if (currentPos > targetPos) {
        moveOperations.push(moved(currentPos, targetPos));
        const [item] = result.splice(currentPos, 1);
        result.splice(targetPos, 0, item);

        const [movedIdentity] = resultIdentities.splice(currentPos, 1);
        resultIdentities.splice(targetPos, 0, movedIdentity);
      }
    }
  }

  operations.push(...addOperations, ...moveOperations);

  return operations;
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

export function diffItemToJsonPatch<T>(item: ArrayDiffItem<T>) {
  switch (item[0]) {
    case 'a':
      const [, value, to] = item;
      return {
        op: 'add',
        path: to ?? '~',
        value: value,
      } as const;
    case 'r':
      return {
        op: 'remove',
        path: item[1],
      } as const;
    case 'm':
      return {
        op: 'move',
        path: item[1],
        from: item[2],
      } as const;
  }
}

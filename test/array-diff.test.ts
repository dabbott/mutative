import { apply, create } from '../src';
import { CreateArrayPatchesParameters, Operation } from '../src/interface';

function identity<T>(item: T): string {
  // return item as string;
  return typeof item === 'object' && item !== null && 'id' in item
    ? (item.id as string)
    : (item as string);
}

function createArrayPatches(params: CreateArrayPatchesParameters) {
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
      createArrayPatches,
    }
  );

  expect(state).toEqual({ list: [2] });
  expect(apply(data, patches)).toEqual(state);
  expect(apply(state, inversePatches)).toEqual(data);
  expect(patches.length).toBe(1);
  expect(inversePatches.length).toBe(1);
});

test('patches should fall back to default behavior', () => {
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
      createArrayPatches: () => null,
    }
  );

  expect(state).toEqual({ list: [2] });
  expect(apply(data, patches)).toEqual(state);
  expect(apply(state, inversePatches)).toEqual(data);
  expect(patches.length).toBe(2);
  expect(inversePatches.length).toBe(2);
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
      createArrayPatches,
    }
  );

  expect(state).toEqual({
    todos: [
      { id: 3, title: 'Buy groceries' },
      { id: 1, title: 'Buy groceries' },
      { id: 2, title: 'Buy groceries' },
    ],
  });
  expect(apply(data, patches)).toEqual(state);
  // expect(apply(state, inversePatches)).toEqual(data);
  // expect(patches.length).toBe(1);
  // expect(inversePatches.length).toBe(1);
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
export function computeArrayDiff<T, K>(
  a: T[],
  b: T[],
  identity: (item: T) => K,
  options?: { removalMode?: 'key' | 'index' }
): ArrayDiffItem<T>[];
export function computeArrayDiff<T, K = string>(
  a: T[],
  b: T[],
  identity: (item: T) => K = (item) => item as unknown as K,
  options: { removalMode?: 'key' | 'index' } = {}
): ArrayDiffItem<T>[] {
  // Early exits
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0)
    return b.map((item, i) =>
      i === b.length - 1 ? added<T>(item) : added<T>(item, i)
    );
  if (b.length === 0)
    return a
      .map((_, i) =>
        removed<T>(options.removalMode === 'key' ? String(identity(a[i])) : i)
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

  // Phase 1: Build content maps for matching
  const aContentMap = new Map<K, number[]>();
  const bContentMap = new Map<K, number[]>();

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

  // Phase 2: Match items greedily
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

  // Phase 3: Generate remove operations (with correct index adjustment)
  let removalCount = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aUsed.has(i)) {
      operations.push(
        removed(
          options.removalMode === 'key'
            ? String(aIdentities[i])
            : i - removalCount
        )
      );
      removalCount++;
    }
  }

  // Phase 4: Generate add operations
  // Track current working array length (after removals)
  let currentLength = a.length - removalCount;

  for (let targetPos = 0; targetPos < b.length; targetPos++) {
    if (!bUsed.has(targetPos)) {
      const targetItem = b[targetPos];
      if (targetPos === currentLength) {
        operations.push(added(targetItem));
      } else {
        operations.push(added(targetItem, targetPos));
      }
      currentLength++; // Array grows as we add items
    }
  }

  // Phase 5: Optimal move generation
  const moveOps = generateOptimalMoves(
    a,
    b,
    aIdentities,
    bIdentities,
    aUsed,
    bUsed,
    identity
  );
  operations.push(...moveOps);

  return operations;
}

/**
 * Core algorithm for generating optimal move operations
 */
function generateOptimalMoves<T, K>(
  a: T[],
  b: T[],
  aIdentities: K[],
  bIdentities: K[],
  aUsed: Set<number>,
  bUsed: Set<number>,
  identity: (item: T) => K
): ArrayDiffItem<T>[] {
  // Simulate the array after removals and additions
  const workingArray: T[] = [];
  const workingIdentities: K[] = [];

  // Step 1: Build working array after removals
  for (let i = 0; i < a.length; i++) {
    if (aUsed.has(i)) {
      workingArray.push(a[i]);
      workingIdentities.push(aIdentities[i]);
    }
  }

  // Step 2: Add new items in their target positions
  for (let targetPos = 0; targetPos < b.length; targetPos++) {
    if (!bUsed.has(targetPos)) {
      const targetItem = b[targetPos];
      workingArray.splice(targetPos, 0, targetItem);
      workingIdentities.splice(targetPos, 0, bIdentities[targetPos]);
    }
  }

  // Step 3: Find moves needed to match target array
  const moves: Array<{ from: number; to: number }> = [];

  for (let targetPos = 0; targetPos < b.length; targetPos++) {
    const targetContent = bIdentities[targetPos];

    // Find where this content currently is in working array
    let currentPos = -1;
    for (let i = targetPos; i < workingArray.length; i++) {
      if (identity(workingArray[i]) === targetContent) {
        currentPos = i;
        break;
      }
    }

    if (currentPos > targetPos) {
      moves.push({ from: currentPos, to: targetPos });

      // Apply the move to working array to keep it in sync
      const [item] = workingArray.splice(currentPos, 1);
      workingArray.splice(targetPos, 0, item);

      const [itemIdentity] = workingIdentities.splice(currentPos, 1);
      workingIdentities.splice(targetPos, 0, itemIdentity);
    }
  }

  // Apply pattern optimizations carefully
  if (moves.length === 0) return [];
  if (moves.length === 1) return [moved(moves[0].from, moves[0].to)];

  // Pattern 1: Simple cascade detection (1->0, 2->1, 3->2, ..., n->n-1)
  const sortedMoves = [...moves].sort((a, b) => a.to - b.to);
  let isCascade = true;
  for (let i = 0; i < sortedMoves.length; i++) {
    if (sortedMoves[i].from !== i + 1 || sortedMoves[i].to !== i) {
      isCascade = false;
      break;
    }
  }

  if (isCascade) {
    // Optimize: single move from 0 to end
    return [moved(0, sortedMoves.length)];
  }

  // No optimization - return moves as-is
  return moves.map((move) => moved(move.from, move.to));
}

function getIndex<T, K>(
  items: T[],
  indexOrKey: number | string,
  identity: (item: T) => K
): number {
  return typeof indexOrKey === 'number'
    ? indexOrKey
    : items.findIndex((item) => indexOrKey === String(identity(item)));
}

function applyArrayDiffItemMutable<T, K>(
  a: T[],
  item: ArrayDiffItem<T>,
  identity: (item: T) => K
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
export function applyArrayDiff<T, K>(
  a: T[],
  items: ArrayDiffItem<T>[],
  identity: (item: T) => K
): T[];
export function applyArrayDiff<T, K = string>(
  a: T[],
  items: ArrayDiffItem<T>[],
  identity: (item: T) => K = (item) => item as string as K
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

import { create } from './create';
import {
  Draft,
  DraftType,
  Operation,
  Options,
  Patch,
  Patches,
} from './interface';
import { deepClone, get, getType, isDraft, unescapePath } from './utils';

export function applyPatchToString(str: string, patch: Patch) {
  const index = Number(patch.path[patch.path.length - 1]);
  const length = patch.length ?? 1;

  switch (patch.op) {
    case 'add': {
      return str.slice(0, index) + patch.value + str.slice(index);
    }
    case 'remove': {
      return str.slice(0, index) + str.slice(index + length);
    }
    case 'replace': {
      return str.slice(0, index) + patch.value + str.slice(index + length);
    }
    default:
      return str;
  }
}

function evaluatePointer(draft: Draft<any>, path: (string | number)[]) {
  let base: any = draft;
  for (let index = 0; index < path.length - 1; index += 1) {
    const parentType = getType(base);
    let key = path[index];
    if (typeof key !== 'string' && typeof key !== 'number') {
      key = String(key);
    }
    if (
      ((parentType === DraftType.Object || parentType === DraftType.Array) &&
        (key === '__proto__' || key === 'constructor')) ||
      (typeof base === 'function' && key === 'prototype')
    ) {
      throw new Error(
        `Patching reserved attributes like __proto__ and constructor is not allowed.`
      );
    }
    // use `index` in Set draft
    base = get(getType(base) === DraftType.Set ? Array.from(base) : base, key);
    if (typeof base !== 'object' && typeof base !== 'string') {
      throw new Error(`Cannot apply patch at '${path.join('/')}'.`);
    }
  }

  return base;
}

/**
 * `apply(state, patches)` to apply patches to state
 *
 * ## Example
 *
 * ```ts
 * import { create, apply } from '../index';
 *
 * const baseState = { foo: { bar: 'str' }, arr: [] };
 * const [state, patches] = create(
 *   baseState,
 *   (draft) => {
 *     draft.foo.bar = 'str2';
 *   },
 *   { enablePatches: true }
 * );
 * expect(state).toEqual({ foo: { bar: 'str2' }, arr: [] });
 * expect(patches).toEqual([{ op: 'replace', path: ['foo', 'bar'], value: 'str2' }]);
 * expect(state).toEqual(apply(baseState, patches));
 * ```
 */
export function apply<T extends object, F extends boolean = false>(
  state: T,
  patches: Patches,
  applyOptions?: Pick<
    Options<boolean, F>,
    Exclude<keyof Options<boolean, F>, 'enablePatches'>
  >
) {
  let i: number;
  for (i = patches.length - 1; i >= 0; i -= 1) {
    const { value, op, path, from } = patches[i];
    if (
      (!path.length && op === Operation.Replace) ||
      (path === '' && op === Operation.Add)
    ) {
      state = value;
      break;
    }
    if (!path.length && op === Operation.Move) {
      const fromPath = unescapePath(from!);
      const fromBase = evaluatePointer(state, fromPath);
      const fromKey = fromPath[fromPath.length - 1];
      const fromValue = deepClone(fromBase[fromKey]);
      state = fromValue;
      break;
    }
  }
  if (i > -1) {
    patches = patches.slice(i + 1);
  }
  const mutate = (draft: Draft<T>) => {
    patches.forEach((patch) => {
      const { path: _path, from: _fromPath, op } = patch;
      const path = unescapePath(_path);
      let base = evaluatePointer(draft, path);

      if (typeof base === 'string') {
        // Replace the string within the parent
        const parentPath = path.slice(0, -1);
        const parent = evaluatePointer(draft, parentPath);
        const key = path[path.length - 2];
        if (key === undefined) {
          return;
        }
        parent[key] = applyPatchToString(parent[key], patch);
        return;
      }

      const type = getType(base);
      // ensure the original patch is not modified.
      const value = deepClone(patch.value);
      const key = path[path.length - 1];
      switch (op) {
        case Operation.Move: {
          const fromPath = unescapePath(_fromPath!);
          const fromBase = evaluatePointer(draft, fromPath);
          const fromKey = fromPath[fromPath.length - 1];
          const fromType = getType(fromBase);

          if (fromBase === base && fromKey === key) {
            return;
          }

          const fromValue = deepClone(fromBase[fromKey]);

          if (path.length === 0) {
            return;
          }

          if (
            fromBase === base &&
            fromType === DraftType.Array &&
            type === DraftType.Array
          ) {
            const fromNumber = Number(fromKey);
            const toNumber = Number(key);

            if (fromNumber < toNumber) {
              base.splice(fromNumber, 1);
              base.splice(toNumber, 0, fromValue);
              return;
            } else {
              base.splice(toNumber, 0, fromValue);
              base.splice(fromNumber + 1, 1);
              return;
            }
          }

          switch (fromType) {
            case DraftType.Array:
              const fromNumber = Number(fromKey);
              fromBase.splice(fromNumber, 1);
              break;
            case DraftType.Map:
              fromBase.delete(fromKey);
              break;
            case DraftType.Set:
              fromBase.delete(value);
              break;
            default: {
              delete fromBase[fromKey];
              break;
            }
          }

          switch (type) {
            case DraftType.Array:
              const toNumber = Number(key);
              base.splice(toNumber, 0, fromValue);
              break;
            case DraftType.Map:
              base.set(key, fromValue);
              break;
            case DraftType.Set:
              base.add(fromValue);
              break;
            default: {
              base[key] = fromValue;
              break;
            }
          }

          return;
        }
        case Operation.Replace:
          switch (type) {
            case DraftType.Map:
              return base.set(key, value);
            case DraftType.Set:
              throw new Error(`Cannot apply replace patch to set.`);
            default:
              return (base[key] = value);
          }
        case Operation.Add:
          switch (type) {
            case DraftType.Array:
              // If the "-" character is used to
              // index the end of the array (see [RFC6901](https://datatracker.ietf.org/doc/html/rfc6902)),
              // this has the effect of appending the value to the array.
              return key === '-'
                ? base.push(value)
                : base.splice(key as number, 0, value);
            case DraftType.Map:
              return base.set(key, value);
            case DraftType.Set:
              return base.add(value);
            default:
              return (base[key] = value);
          }
        case Operation.Remove:
          switch (type) {
            case DraftType.Array:
              return base.splice(key as number, 1);
            case DraftType.Map:
              return base.delete(key);
            case DraftType.Set:
              return base.delete(patch.value);
            default:
              return delete base[key];
          }
        default:
          throw new Error(`Unsupported patch operation: ${op}.`);
      }
    });
  };
  if (isDraft(state)) {
    if (applyOptions !== undefined) {
      throw new Error(`Cannot apply patches with options to a draft.`);
    }
    mutate(state as Draft<T>);
    return state;
  }
  return create<T, F>(state, mutate, {
    ...applyOptions,
    enablePatches: false,
  });
}

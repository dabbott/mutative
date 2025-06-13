import { create } from '../src';

test('patches should not contain `array.length` - arrayLengthAssignment: false, pathAsArray: true', () => {
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
        console.log('params', params);
        return {
          patches: [],
          inversePatches: [],
        };
      },
    }
  );

  expect(state).toEqual({ list: [2] });
  expect(patches).toEqual([
    { op: 'replace', path: ['list', 0], value: 2 },
    { op: 'remove', path: ['list', 1] },
  ]);
});

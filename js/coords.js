// Coordinate helpers: edge labels (A1..) and spiral cell numbering.
(function (G) {
  'use strict';

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const spiralCache = new Map();

  // Edge label of a cell: column letter + row number, row 1 at the bottom.
  function label(x, y, size) {
    return LETTERS[x] + (size - y);
  }

  // Numbers every cell 1..size*size, spiralling clockwise out from the centre
  // (centre, right, down, left, left, up, up, ...). Returns an array indexed by y*size+x.
  function spiral(size) {
    if (spiralCache.has(size)) return spiralCache.get(size);
    const nums = new Array(size * size).fill(0);
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let x = Math.floor((size - 1) / 2);
    let y = x;
    let n = 1;
    const put = () => {
      if (x >= 0 && y >= 0 && x < size && y < size) nums[y * size + x] = n++;
    };
    put();
    for (let len = 1, d = 0; n <= size * size; len++) {
      for (let leg = 0; leg < 2; leg++, d = (d + 1) % 4) {
        for (let i = 0; i < len; i++) {
          x += dirs[d][0];
          y += dirs[d][1];
          put();
        }
      }
    }
    spiralCache.set(size, nums);
    return nums;
  }

  G.coords = { LETTERS, label, spiral };
})(window.Gomoku = window.Gomoku || {});

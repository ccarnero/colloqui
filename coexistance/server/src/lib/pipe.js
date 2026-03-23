// Left-to-right function composition.
// pipe(f, g, h)(x) === h(g(f(x)))
// Works with sync functions only — for async, use pipeAsync.

const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x)

// Async pipe — each function can be async, awaited in sequence.
// Passes the resolved value of each step to the next.
const pipeAsync = (...fns) => async (x) => {
  let acc = x
  for (const fn of fns) {
    acc = await fn(acc)
  }
  return acc
}

export { pipe, pipeAsync }

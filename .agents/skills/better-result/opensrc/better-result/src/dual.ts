/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Creates data-first/data-last dual function.
 *
 * @template DataLast Curried (data-last) signature.
 * @template DataFirst Uncurried (data-first) signature.
 * @param arity Number of args for data-first form.
 * @param body Implementation function.
 * @returns Function supporting both calling conventions.
 *
 * @example
 * const add: {
 *   (a: number, b: number): number;
 *   (b: number): (a: number) => number;
 * } = dual(2, (a: number, b: number) => a + b);
 *
 * add(1, 2);  // 3 (data-first)
 * add(2)(1);  // 3 (data-last)
 */
export function dual<
  DataLast extends (...args: Array<any>) => any,
  DataFirst extends (...args: Array<any>) => any,
>(arity: Parameters<DataFirst>["length"], body: DataFirst): DataLast & DataFirst {
  if (arity === 2) {
    return ((...args: Array<any>) => {
      if (args.length >= 2) {
        return body(args[0], args[1]);
      }
      return (self: any) => body(self, args[0]);
    }) as DataLast & DataFirst;
  }

  if (arity === 3) {
    return ((...args: Array<any>) => {
      if (args.length >= 3) {
        return body(args[0], args[1], args[2]);
      }
      return (self: any) => body(self, args[0], args[1]);
    }) as DataLast & DataFirst;
  }

  if (arity === 4) {
    return ((...args: Array<any>) => {
      if (args.length >= 4) {
        return body(args[0], args[1], args[2], args[3]);
      }
      return (self: any) => body(self, args[0], args[1], args[2]);
    }) as DataLast & DataFirst;
  }

  return ((...args: Array<any>) => {
    if (args.length >= arity) {
      return body(...args);
    }
    return (self: any) => body(self, ...args);
  }) as DataLast & DataFirst;
}

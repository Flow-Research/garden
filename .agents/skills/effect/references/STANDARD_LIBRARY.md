# Standard Library Discovery

Read this before adding a generic helper, coercion utility, manual collection loop, or custom option/result traversal.

VCOS should use Effect's standard library broadly instead of rebuilding its operations. Existing code currently demonstrates only part of that library, so nearby patterns are not a reliable inventory. Search the project-pinned package exports and source before implementing a generic transformation yourself.

## Choose By Data Type

| Data held | Start with | Typical operations |
| --- | --- | --- |
| Arrays and lists | `effect/Array` | filter-map, partition, grouping, dedupe, zip, chunks, first match |
| Records and dictionaries | `effect/Record` | map, filter, collect, entries, partition |
| Optional values | `effect/Option` | nullable conversion, map/flatMap, match, fallback, first present value |
| Success or failure values | `effect/Result` | map, mapError, match, aggregate |
| Strings | `effect/String` | split, trim, replace, emptiness, casing |
| Numbers | `effect/Number` | clamp, aggregate, round, ranges |
| Predicates and guards | `effect/Predicate` | type guards and boolean composition |
| Ordering | `effect/Order` | comparators and sorting |
| Object structure | `effect/Struct` | pick, omit, evolve |
| Tagged decisions | `effect/Match` or tagged-union helpers | exhaustive matching |
| Function composition | `effect/Function` | pipe, flow, identity, constant |

## Discovery Workflow

1. Name the operation in plain language.
2. Pick the module for the value you already hold.
3. Inspect that module's exports in the installed Effect package.
4. Search by common TypeScript, Rust, or Haskell names for the operation.
5. Use the standard operation when its semantics match; otherwise create a named helper only for a real domain concept.

Examples:

- “Map values and keep successful ones” → look for `filterMap` or map plus collection of present values.
- “Drop absent options” → look for an Option-aware array collector.
- “Split values into two groups” → look for `partition`.
- “Transform selected object fields” → inspect `effect/Struct` before writing spreads.

## Red Flags

Stop and search the pinned package when you see:

- a `for` loop that only pushes transformed values;
- `flatMap` returning `[]` to imitate filtering;
- repeated manual `Option.isSome` / `Option.isNone` unwrapping;
- helpers named `asRecord`, `stringValue`, `optionalStringValue`, `toX`, or `normalizeX` that only coerce generic data;
- a custom map/filter/partition/grouping implementation.

A helper is justified when it names product behavior or enforces a domain invariant. It is not justified merely because the matching Effect module is unfamiliar.

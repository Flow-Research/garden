# Dependency patches

pnpm applies these through `pnpm.patchedDependencies` in the root
`package.json`. Each patch pins one exact version, so bumping that package
requires regenerating or dropping its patch (`pnpm patch <pkg>@<version>`).
Check the removal condition first: a patch that is no longer needed should be
deleted, not carried forward.

| Patch | What it changes | Why | Remove when |
| --- | --- | --- | --- |
| `@executor-js__sdk@1.5.40.patch` | Renames `Schema.TaggedErrorClass` to `Schema.TaggedError` across the SDK's error classes | Executor 1.5.40 is built against an Effect beta that had `TaggedErrorClass`; the workspace runs Effect `4.0.0-rc.111` (see the root `pnpm.overrides` and `third_party/executor/PATCHES.md`), where it is `TaggedError` | Executor publishes a release built against the Effect release the workspace uses |
| `@executor-js__config@1.5.40.patch` | Same rename for `ConfigParseError` and `LoadPluginsError` | Same as above | Same as above |
| `@executor-js__plugin-graphql@1.5.40.patch` | Same rename for the GraphQL plugin errors | Same as above | Same as above |
| `@executor-js__plugin-mcp@1.5.40.patch` | Same rename for the MCP plugin errors | Same as above | Same as above |
| `@executor-js__plugin-openapi@1.5.40.patch` | Same rename for the OpenAPI plugin errors | Same as above | Same as above |
| `@helix-db__helix-db@3.0.2.patch` | Replaces `new Function("specifier", "return import(specifier)")` with a plain `import()` in `graph.js` and `index.js` | Cloudflare Workers forbid code generation from strings (`new Function`/`eval`), so the client cannot load in the Worker unpatched | The Helix client stops constructing functions from strings |
| `mammoth@1.12.0.patch` | Makes `lib/xml/xmldom.js` throw xmldom's `ParseError` at the first parser diagnostic instead of recording it and throwing after the parse | Mammoth already rejects a part with any diagnostic, but xmldom 0.8 recovers from each malformed tag by stepping one character and rescanning, so crafted DOCX XML took seconds of Worker CPU before the rejection (issue #449). xmldom rethrows `ParseError` instead of recovering. Accepted documents are unchanged | Mammoth stops collecting diagnostics through a recovering parse, or moves to a parser without quadratic recovery |
| `@xmldom__xmldom@0.8.15.patch` | Reports unclosed processing instructions and CDATA sections as errors, and re-indexes `childNodes` once per parent in `normalize()` | These three paths did quadratic work without a diagnostic, so the Mammoth patch could not stop them: 48 KB of `<?x` took about 16 seconds (issue #449) | Mammoth supports an xmldom release with linear handling of these inputs; 0.9 has it, but Mammoth 1.12 requires `^0.8.6` and calls `parseFromString` without the MIME type 0.9 requires |

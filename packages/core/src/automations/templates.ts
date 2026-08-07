import { z } from 'zod'

export const automationCapabilitySchema = z
  .object({ browser: z.boolean(), sandbox: z.boolean(), github: z.boolean() })
  .strict()

export const automationRunContractSchema = z
  .object({ input: z.string(), output: z.string() })
  .strict()

export const automationExecutionConfigSchema = z
  .object({
    templateId: z.string(),
    templateVersion: z.number().int().positive(),
    capabilities: automationCapabilitySchema,
    requiredSkills: z.array(z.string()),
    requiredConnectors: z.array(
      z.enum(['github', 'slack', 'gmail', 'google-drive']),
    ),
    runContract: automationRunContractSchema,
  })
  .strict()

export const qaSweepExecutionConfigSchema =
  automationExecutionConfigSchema.extend({
    templateId: z.literal('qa-sweep'),
    qaLoop: z
      .object({
        discovery: z.literal('agent-driven'),
        execution: z
          .object({
            staticReview: z.literal('always'),
            repoCommands: z.literal('safe-discovered'),
            browser: z.literal('when-url-available'),
            generatedTests: z.literal('draft-only-unless-approved'),
          })
          .strict(),
        verification: z
          .object({
            rerunChecks: z.boolean(),
            validateEvidence: z.boolean(),
            falseGreenReview: z.boolean(),
          })
          .strict(),
        rca: z
          .object({
            required: z.boolean(),
            includeConfidence: z.boolean(),
            citeEvidence: z.boolean(),
          })
          .strict(),
        triage: z
          .object({
            severity: z.boolean(),
            reproducibility: z.boolean(),
            ownerHints: z.boolean(),
          })
          .strict(),
        closure: z
          .object({
            defaultMode: z.literal('report-only'),
            allowedActions: z.array(
              z.enum([
                'garden-issue',
                'github-issue',
                'draft-pr',
                'qa-artifact-update',
              ]),
            ),
            requireExplicitIntent: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    browserProvider: z.literal('cloudflare-browser-run'),
    repoAccess: z.literal('github-connector'),
    destructivePolicy: z.literal('explicit-opt-in'),
  })

export const automationOutputConfigSchema = z
  .object({
    contractId: z.string(),
    contractVersion: z.number().int().positive(),
  })
  .strict()

export const qaSweepOutputConfigSchema = automationOutputConfigSchema.extend({
  contractId: z.literal('qa-sweep-report'),
})

export const qaSweepClosureActionSchema = z.enum([
  'report-only',
  'garden-issue',
  'github-issue',
  'draft-pr',
  'qa-artifact-update',
])

export const qaSweepRunPayloadSchema = z
  .object({
    closureAction: qaSweepClosureActionSchema.default('report-only'),
    allowSourceMutation: z.boolean().default(false),
    targetRepository: z.string().optional(),
    targetBranch: z.string().optional(),
    deployedUrl: z.string().url().optional(),
    instructions: z.string().optional(),
  })
  .strict()

export type AutomationExecutionConfig = z.infer<
  typeof automationExecutionConfigSchema
>
export type AutomationOutputConfig = z.infer<
  typeof automationOutputConfigSchema
>
export type QaSweepExecutionConfig = z.infer<
  typeof qaSweepExecutionConfigSchema
>
export type QaSweepOutputConfig = z.infer<typeof qaSweepOutputConfigSchema>
export type QaSweepClosureAction = z.infer<typeof qaSweepClosureActionSchema>
export type QaSweepRunPayload = z.infer<typeof qaSweepRunPayloadSchema>

export const QA_GUIDANCE_SKILL_SLUGS = [
  'qa-runtime',
  'qa-sweep',
  'browser-qa',
  'test-quality-validator',
  'qa-feature-catalog',
  'qa-security-sweep',
  'browser-integration-codegen',
  'api-integration-codegen',
  'spec-to-regression',
] as const

export const QA_SWEEP_INPUT_CONTRACT_ID = 'qa-sweep-input'
export const QA_SWEEP_OUTPUT_CONTRACT_ID = 'qa-sweep-report'

export const QA_SWEEP_EXECUTION_CONFIG = qaSweepExecutionConfigSchema.parse({
  templateId: 'qa-sweep',
  templateVersion: 1,
  capabilities: { browser: true, sandbox: true, github: true },
  requiredSkills: [...QA_GUIDANCE_SKILL_SLUGS],
  requiredConnectors: ['github'],
  runContract: {
    input: QA_SWEEP_INPUT_CONTRACT_ID,
    output: QA_SWEEP_OUTPUT_CONTRACT_ID,
  },
  qaLoop: {
    discovery: 'agent-driven',
    execution: {
      staticReview: 'always',
      repoCommands: 'safe-discovered',
      browser: 'when-url-available',
      generatedTests: 'draft-only-unless-approved',
    },
    verification: {
      rerunChecks: true,
      validateEvidence: true,
      falseGreenReview: true,
    },
    rca: { required: true, includeConfidence: true, citeEvidence: true },
    triage: { severity: true, reproducibility: true, ownerHints: true },
    closure: {
      defaultMode: 'report-only',
      allowedActions: [
        'garden-issue',
        'github-issue',
        'draft-pr',
        'qa-artifact-update',
      ],
      requireExplicitIntent: true,
    },
  },
  browserProvider: 'cloudflare-browser-run',
  repoAccess: 'github-connector',
  destructivePolicy: 'explicit-opt-in',
} satisfies QaSweepExecutionConfig)

export const QA_SWEEP_OUTPUT_CONFIG = qaSweepOutputConfigSchema.parse({
  contractId: QA_SWEEP_OUTPUT_CONTRACT_ID,
  contractVersion: 1,
} satisfies QaSweepOutputConfig)

export function createAutomationExecutionConfig(input: {
  templateId: string
  templateVersion?: number
  capabilities: z.infer<typeof automationCapabilitySchema>
  requiredSkills?: string[]
  requiredConnectors?: z.infer<
    typeof automationExecutionConfigSchema
  >['requiredConnectors']
  inputContract?: string
  outputContract?: string
}) {
  return automationExecutionConfigSchema.parse({
    templateId: input.templateId,
    templateVersion: input.templateVersion ?? 1,
    capabilities: input.capabilities,
    requiredSkills: input.requiredSkills ?? [],
    requiredConnectors: input.requiredConnectors ?? [],
    runContract: {
      input: input.inputContract ?? 'automation-run-input',
      output: input.outputContract ?? 'automation-run-report',
    },
  })
}

export const automationTemplateIdSchema = z.enum(['qa-sweep'])

export const automationTemplateDefinitionSchema = z
  .object({
    id: automationTemplateIdSchema,
    version: z.number().int().positive(),
    title: z.string(),
    summary: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    templateSource: z.string(),
    prompt: z.string(),
    systemPrompt: z.string(),
    executionConfig: qaSweepExecutionConfigSchema,
    outputConfig: qaSweepOutputConfigSchema,
  })
  .strict()

export type AutomationTemplateDefinition = z.infer<
  typeof automationTemplateDefinitionSchema
>

/**
 * Canonical built-in automation templates.
 *
 * Automation config used to be assembled ad hoc in the UI and then loosely
 * reinterpreted in the runtime. This registry is the single shape source for
 * template prompts, capabilities, skill requirements, connector requirements,
 * and output contracts. UI, API writes, and runtime checks should import these
 * definitions instead of inventing JSON blobs.
 */
export const QA_SWEEP_TEMPLATE = automationTemplateDefinitionSchema.parse({
  id: 'qa-sweep',
  version: 1,
  title: 'QA sweep',
  summary: 'Discover, verify, RCA, and triage codebase quality risks',
  category: 'qa',
  tags: ['qa', 'quality', 'browser-run'],
  templateSource: 'builtin:qa-sweep@1',
  systemPrompt:
    'You are a QA automation agent. Close the loop: discover the repo, understand what the product is supposed to do, map code surfaces to tests, measure and reason about coverage, run the safest useful checks, verify evidence in browser when a URL exists, do root cause analysis, triage impact, and recommend follow-up. Existing QA tools and artifacts are hints, not requirements. One deployed domain is enough: discover routes and flows from the codebase, then use the browser to verify representative user paths. Default to report-only. Create issues, draft PRs, update QA artifacts, or change code only when the run payload explicitly asks for that closure action.',
  prompt: `Run an agent-driven QA sweep for the configured repository.

1. Discover the repository first. Identify package manager, scripts, frameworks, routes, entrypoints, user roles, app state, test files, CI commands, changed files, and any usable deployed domain.
2. Build a product-surface map from code and docs. Include routes/pages, components, API/mock-data boundaries, stateful flows, role-gated paths, persistence, and error/empty states. Do not rely on the user listing every route.
3. Build a coverage map. Connect each surface to existing unit, integration, browser, API, or e2e tests. Use coverage reports when available, but also inspect test intent: a covered file is not the same as a covered behavior.
4. Identify coverage gaps and false greens. Flag tests that only check smoke-level rendering, overmock the behavior, skip assertions, use brittle selectors, or miss persistence/auth/error paths.
5. Plan from evidence. Choose the strongest safe checks the repo already supports. Use focused lint/type/test/coverage/browser/API commands when discovered. If no useful tests exist, perform static review, browser observation, and draft concrete regression scenarios.
6. Execute safely. Prefer read-only checks. Avoid destructive flows and production mutations unless explicitly approved.
7. Use Browser Run when a domain is available. Discover linked routes where safe, verify representative user journeys, capture console/network/DOM evidence, and connect browser findings back to source surfaces.
8. Self-verify. Rerun focused failures when cheap, validate browser findings with evidence, and review tests or proposed tests for false-green risk.
9. Do RCA. For each real failure or high-risk gap, explain likely cause, files or surfaces involved, confidence, alternatives considered, and what evidence supports the claim.
10. Triage. Assign severity, reproducibility, affected user path, and likely owner area when possible.
11. Close the loop when requested. The default output is a report. If the run payload explicitly asks, prepare a Garden issue, GitHub issue, draft PR plan, or QA artifact update with rich evidence and a verification checklist. Do not silently mutate source or trackers.
12. Treat imported QA skills as examples of proven workflows. Borrow their ideas for coverage, drift, browser checks, test quality, and scenario drafting, but do not assume any specific tool or file layout.
13. Obey the run payload closureAction. report-only is the default and forbids Garden issue creation, GitHub issue writes, PR drafting, QA artifact updates, and source mutation. github-issue may write only GitHub issues/comments. draft-pr or qa-artifact-update require allowSourceMutation=true before changing repository files or branches.
14. Return a concise QA report with discovered repo shape, surface coverage map, checks run, checks skipped with reasons, browser evidence, verification results, RCA, triage, artifacts, and recommended closure actions.`,
  executionConfig: QA_SWEEP_EXECUTION_CONFIG,
  outputConfig: QA_SWEEP_OUTPUT_CONFIG,
} satisfies AutomationTemplateDefinition)

export const BUILTIN_AUTOMATION_TEMPLATES = [QA_SWEEP_TEMPLATE] as const

export function parseAutomationExecutionConfig(value: unknown) {
  return automationExecutionConfigSchema.safeParse(value)
}

export function parseQaSweepRunPayload(value: unknown) {
  const objectValue =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const nested =
    objectValue.qa && typeof objectValue.qa === 'object'
      ? objectValue.qa
      : objectValue
  return qaSweepRunPayloadSchema.safeParse(nested)
}

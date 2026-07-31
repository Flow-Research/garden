import { defineConnector } from '../sdk.ts'
import { nativeToolClassifications } from '../effect/native.ts'
import { githubHostedMcpExtraClassifications } from './mcp-tools.ts'
import { githubNativeTools } from './tools.ts'

export default defineConnector({
  id: 'github',
  kind: 'native',
  label: 'GitHub',
  description:
    'Repository-scoped issues, pull requests, code, releases, and Actions through the Garden GitHub App.',
  icon: './icon.svg',
  native: {
    availability: 'installation',
    tools: githubNativeTools,
  },
  tools: {
    ...nativeToolClassifications(githubNativeTools),
    ...githubHostedMcpExtraClassifications,
  },
})

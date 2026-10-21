export type IntegrationSkill = {
  id: string
  name: string
  description: string
  examples: readonly string[]
  mediaTypes: readonly RegExp[]
  requiredCapabilities: readonly string[]
  instructions: readonly string[]
}

export const integrationSkills = [
  {
    id: 'analyze-structured-data',
    name: 'Analyze structured data',
    description:
      'Analyze a dataset, find trends and unusual values, create charts, and generate a report.',
    examples: [
      'Analyze this sales CSV.',
      'Find the strongest monthly trend in this spreadsheet.',
      'Test whether two columns are related and create an Excel report.',
    ],
    mediaTypes: [/csv/i, /spreadsheet/i, /excel/i, /ms-excel/i],
    requiredCapabilities: [
      'analyze structured data',
      'identify trends and unusual values',
      'create charts and reports',
    ],
    instructions: [
      'Use the selected integration for the analysis.',
      'When the request includes an uploaded file, read the complete file before analysis and pass the full raw content to the integration. Do not pass a summary, sample, or truncated content.',
      'Return the key findings in chat.',
      'Return a link when the integration generates a report.',
    ],
  },
  {
    id: 'work-with-email',
    name: 'Work with email',
    description:
      'Search, read, summarize, draft, label, or send email messages.',
    examples: [
      'Summarize my unread email.',
      'Find the invoice that Ada sent.',
      'Draft an email about the launch.',
    ],
    mediaTypes: [],
    requiredCapabilities: ['search and read email', 'draft and send email'],
    instructions: [
      'Use the selected email integration.',
      'Ask for approval before an external send when policy requires it.',
    ],
  },
  {
    id: 'work-with-source-control',
    name: 'Work with source control',
    description:
      'Read repositories, inspect code, and work with issues and pull requests.',
    examples: [
      'Review this pull request.',
      'Find open issues in the repository.',
      'Read the implementation for this feature.',
    ],
    mediaTypes: [],
    requiredCapabilities: [
      'read source code repositories',
      'manage issues and pull requests',
      'review code changes',
    ],
    instructions: ['Use the selected source-control integration.'],
  },
] as const satisfies readonly IntegrationSkill[]

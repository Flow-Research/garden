import { Building2, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
import { Badge } from '@garden/ui/components/ui/badge'

type MockAccessTool = {
  readonly name: string
  readonly approval: 'Allowed' | 'Approval required'
}

type MockAccessAssignment = {
  readonly id: string
  readonly integration: string
  readonly account: string
  readonly owner: 'Personal' | 'Workspace'
  readonly pattern: `${string}.${'user' | 'org'}.${string}.*`
  readonly tools: readonly MockAccessTool[]
}

const MOCK_ACCESS_ASSIGNMENTS: readonly MockAccessAssignment[] = [
  {
    id: 'workspace-github',
    integration: 'GitHub',
    account: 'Workspace repositories',
    owner: 'Workspace',
    pattern: 'github.org.workspace-demo.*',
    tools: [
      { name: 'Browse repositories and pull requests', approval: 'Allowed' },
      { name: 'Create or merge changes', approval: 'Approval required' },
    ],
  },
  {
    id: 'personal-gmail',
    integration: 'Gmail',
    account: 'Personal inbox',
    owner: 'Personal',
    pattern: 'google_gmail.user.personal-demo.*',
    tools: [
      { name: 'Search and read messages', approval: 'Allowed' },
      { name: 'Send messages', approval: 'Approval required' },
    ],
  },
]

export function AgentAccessTab({ agentId }: { agentId: string }) {
  return (
    <section aria-labelledby={`agent-access-${agentId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2
              id={`agent-access-${agentId}`}
              className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
            >
              Agent access
            </h2>
            <Badge variant="outline" className="text-[10px]">
              Preview
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Choose which connected accounts and tools this agent may use. These
            sample assignments are not active yet.
          </p>
        </div>
        <Badge
          variant="outline"
          className="gap-1.5 border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        >
          <LockKeyhole className="size-3" />
          Runtime off
        </Badge>
      </div>

      <ul className="mt-4 divide-y divide-border/60 rounded-md border">
        {MOCK_ACCESS_ASSIGNMENTS.map((assignment) => (
          <li key={assignment.id} className="px-3 py-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
                {assignment.owner === 'Workspace' ? (
                  <Building2 className="size-4" />
                ) : (
                  <UserRound className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {assignment.integration}
                  </p>
                  <Badge variant="outline" className="text-[10px]">
                    {assignment.owner}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {assignment.account}
                </p>
                <code className="mt-2 block truncate rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
                  {assignment.pattern}
                </code>
                <ul className="mt-2 space-y-1.5">
                  {assignment.tools.map((tool) => (
                    <li
                      key={tool.name}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <span className="flex items-center gap-1.5 text-foreground">
                        <ShieldCheck className="size-3.5 text-muted-foreground" />
                        {tool.name}
                      </span>
                      <span className="text-muted-foreground">
                        {tool.approval}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

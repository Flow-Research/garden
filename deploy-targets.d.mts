export interface DeploymentTarget {
  readonly key: 'production' | 'preview'
  readonly appName: string
  readonly stage: string
  readonly workerId: string
  readonly workerName: string
  readonly tailWorkerId: string
  readonly tailWorkerName: string
  readonly filesId: string
  readonly filesBucket: string
  readonly databaseId: string
  readonly databaseName: string
  readonly databaseUrlEnv: string
  readonly executorDatabaseId: string
  readonly executorDatabaseName: string
  readonly executorBlobsId: string
  readonly executorBlobsBucket: string
  readonly agentDoId: string
  readonly automationTriggerId: string
  readonly workflowId: string
  readonly workflowName: string
  readonly mailWorkflowId: string
  readonly mailWorkflowName: string
  readonly gmailImportWorkflowId: string
  readonly gmailImportWorkflowName: string
  readonly mailAgentWorkflowId: string
  readonly mailAgentWorkflowName: string
  readonly sandboxId: string
  readonly sandboxName: string
  readonly aiGatewayId: string
  readonly stateWorkerName: string
  readonly environment: 'production' | 'development'
  readonly bindConfiguredBetterAuthUrl: boolean
  readonly emptyBucketsOnDestroy: boolean
}

export const deploymentTargets: Readonly<
  Record<'production' | 'preview', DeploymentTarget>
>

export function deploymentTargetFromEnv(value?: string): DeploymentTarget

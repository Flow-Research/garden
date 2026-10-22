export interface DeploymentTarget {
  readonly key: 'staging' | 'dev' | 'preview'
  readonly branch: 'main' | 'dev' | null
  readonly stackName: string
  readonly stage: string
  readonly workerId: string
  readonly workerName: string
  readonly tailWorkerId: string
  readonly tailWorkerName: string
  readonly filesId: string
  readonly filesBucket: string
  readonly brainFilesId: string
  readonly brainFilesBucket: string
  readonly databaseId: string
  readonly databaseName: string
  readonly databaseUrlEnv: string
  readonly executorDatabaseId: string
  readonly executorDatabaseName: string
  readonly executorBlobsId: string
  readonly executorBlobsBucket: string
  readonly agentDoId: string
  readonly workspaceRealtimeId: string
  readonly automationTriggerId: string
  readonly workflowId: string
  readonly workflowName: string
  readonly sandboxId: string
  readonly sandboxName: string
  readonly aiGatewayId: string
  readonly environment: 'production' | 'development'
  readonly bindConfiguredBetterAuthUrl: boolean
  readonly emptyBucketsOnDestroy: boolean
}

export const deploymentTargets: Readonly<
  Record<'staging' | 'dev' | 'preview', DeploymentTarget>
>

export function deploymentTargetFromEnv(value?: string): DeploymentTarget

export function deploymentTargetFromBranch(branch?: string): DeploymentTarget

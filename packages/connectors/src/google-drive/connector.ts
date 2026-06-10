import { defineConnector } from '../sdk.ts'

const driveFileScope = 'https://www.googleapis.com/auth/drive.file'
const driveReadonlyScope = 'https://www.googleapis.com/auth/drive.readonly'

export default defineConnector({
  id: 'google-drive',
  label: 'Google Drive',
  description:
    'Find files, inspect permissions, read content, and create new docs through Google Drive MCP.',
  icon: './icon.svg',
  upstream: {
    mcpServerUrl: 'https://drivemcp.googleapis.com/mcp/v1',
    transport: 'streamable-http',
  },
  oauth: {
    kind: 'oauth',
    providerId: 'google-drive',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [driveReadonlyScope, driveFileScope],
    apiHosts: [
      'drivemcp.googleapis.com',
      'drive.googleapis.com',
      'www.googleapis.com',
    ],
  },
  tools: {
    create_file: {
      riskClass: 'write',
      requiredScopes: [driveFileScope],
    },
    download_file_content: {
      riskClass: 'read',
      requiredScopes: [driveReadonlyScope],
    },
    get_file_metadata: {
      riskClass: 'read',
      requiredScopes: [driveReadonlyScope],
    },
    get_file_permissions: {
      riskClass: 'read',
      requiredScopes: [driveReadonlyScope],
    },
    list_recent_files: {
      riskClass: 'read',
      requiredScopes: [driveReadonlyScope],
    },
    read_file_content: {
      riskClass: 'read',
      requiredScopes: [driveReadonlyScope],
    },
    search_files: {
      riskClass: 'read',
      requiredScopes: [driveReadonlyScope],
    },
  },
})

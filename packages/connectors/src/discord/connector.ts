import { nativeToolClassifications } from '../effect/native.ts'
import { defineConnector } from '../sdk.ts'
import { discordNativeTools } from './tools.ts'

export default defineConnector({
  id: 'discord',
  label: 'Discord',
  description:
    'Read channels and messages, search server history, create threads, react, and send messages through Garden’s shared Discord bot.',
  icon: './icon.svg',
  kind: 'native',
  native: {
    availability: 'installation',
    tools: discordNativeTools,
  },
  tools: nativeToolClassifications(discordNativeTools),
})

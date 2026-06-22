import { Effect, Schema } from 'effect'
import { defineNativeConnectorTool } from '../effect/native.ts'
import { DiscordRestClient } from './rest-client.ts'
import {
  DiscordChannel,
  DiscordChannels,
  DiscordGuilds,
  DiscordMessage,
  DiscordMessages,
} from './schemas.ts'

const EmptyInput = Schema.Struct({})
const GuildInput = Schema.Struct({ guildId: Schema.String })
const ChannelInput = Schema.Struct({ channelId: Schema.String })
const ReadMessagesInput = Schema.Struct({
  channelId: Schema.String,
  limit: Schema.optional(Schema.Number),
  before: Schema.optional(Schema.String),
  after: Schema.optional(Schema.String),
  around: Schema.optional(Schema.String),
})
const SearchMessagesInput = Schema.Struct({
  guildId: Schema.String,
  query: Schema.String,
  channelId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
})
const SendMessageInput = Schema.Struct({
  channelId: Schema.String,
  content: Schema.String,
})
const ReplyToMessageInput = Schema.Struct({
  channelId: Schema.String,
  messageId: Schema.String,
  content: Schema.String,
})
const CreateThreadInput = Schema.Struct({
  channelId: Schema.String,
  name: Schema.String,
  messageId: Schema.optional(Schema.String),
})
const AddReactionInput = Schema.Struct({
  channelId: Schema.String,
  messageId: Schema.String,
  emoji: Schema.String,
})

const GuildListOutput = Schema.Struct({ items: DiscordGuilds })
const ChannelListOutput = Schema.Struct({ items: DiscordChannels })
const MessageListOutput = Schema.Struct({ items: DiscordMessages })
const EmptyOutput = Schema.Struct({})

/**
 * Discord native tools are typed Effect programs: unknown runtime arguments are
 * decoded by `defineNativeConnectorTool`, then each handler delegates to the
 * Discord REST service supplied by a Layer.
 */
export const discordNativeTools = [
  defineNativeConnectorTool({
    name: 'discord_list_servers',
    description: 'List Discord servers where the shared Garden bot is installed.',
    riskClass: 'read',
    requiredScopes: ['bot:guilds:read'],
    input: EmptyInput,
    output: GuildListOutput,
    handler: () =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        const items = yield* client.listServers()
        return { items }
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_list_channels',
    description: 'List channels in a Discord server visible to the Garden bot.',
    riskClass: 'read',
    requiredScopes: ['bot:channels:read'],
    input: GuildInput,
    output: ChannelListOutput,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        const items = yield* client.listChannels(input.guildId)
        return { items }
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_get_channel',
    description: 'Get metadata for one Discord channel.',
    riskClass: 'read',
    requiredScopes: ['bot:channels:read'],
    input: ChannelInput,
    output: DiscordChannel,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        return yield* client.getChannel(input.channelId)
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_read_messages',
    description: 'Read recent messages from a Discord channel.',
    riskClass: 'read',
    requiredScopes: ['bot:messages:read'],
    input: ReadMessagesInput,
    output: MessageListOutput,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        const items = yield* client.readMessages(input)
        return { items }
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_search_messages',
    description: 'Search messages in a Discord server visible to the Garden bot.',
    riskClass: 'read',
    requiredScopes: ['bot:messages:search'],
    input: SearchMessagesInput,
    output: MessageListOutput,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        const items = yield* client.searchMessages(input)
        return { items }
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_read_thread',
    description: 'Read recent messages from a Discord thread channel.',
    riskClass: 'read',
    requiredScopes: ['bot:threads:read'],
    input: ChannelInput,
    output: MessageListOutput,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        const items = yield* client.readMessages({ channelId: input.channelId })
        return { items }
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_list_active_threads',
    description: 'List active threads in a Discord server.',
    riskClass: 'read',
    requiredScopes: ['bot:threads:read'],
    input: GuildInput,
    output: ChannelListOutput,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        const items = yield* client.listActiveThreads(input.guildId)
        return { items }
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_send_message',
    description: 'Send a Discord message as the shared Garden bot.',
    riskClass: 'send_external',
    requiredScopes: ['bot:messages:send'],
    input: SendMessageInput,
    output: DiscordMessage,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        return yield* client.sendMessage(input)
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_reply_to_message',
    description: 'Reply to a Discord message as the shared Garden bot.',
    riskClass: 'send_external',
    requiredScopes: ['bot:messages:send'],
    input: ReplyToMessageInput,
    output: DiscordMessage,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        return yield* client.sendMessage({
          channelId: input.channelId,
          content: input.content,
          replyToMessageId: input.messageId,
        })
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_create_thread',
    description: 'Create a Discord thread, optionally from an existing message.',
    riskClass: 'send_external',
    requiredScopes: ['bot:threads:create'],
    input: CreateThreadInput,
    output: DiscordChannel,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        return yield* client.createThread(input)
      }),
  }),
  defineNativeConnectorTool({
    name: 'discord_add_reaction',
    description: 'Add a reaction to a Discord message as the shared Garden bot.',
    riskClass: 'write',
    requiredScopes: ['bot:reactions:add'],
    input: AddReactionInput,
    output: EmptyOutput,
    handler: (input) =>
      Effect.gen(function* () {
        const client = yield* DiscordRestClient
        yield* client.addReaction(input)
        return {}
      }),
  }),
] as const

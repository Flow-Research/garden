import { Schema } from 'effect'

export const DiscordGuild = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.optional(Schema.NullOr(Schema.String)),
  owner: Schema.optional(Schema.Boolean),
  permissions: Schema.optional(Schema.String),
  approximate_member_count: Schema.optional(Schema.Number),
})

export const DiscordGuilds = Schema.Array(DiscordGuild)

export const DiscordChannel = Schema.Struct({
  id: Schema.String,
  type: Schema.Number,
  guild_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  topic: Schema.optional(Schema.NullOr(Schema.String)),
  parent_id: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.Number),
  last_message_id: Schema.optional(Schema.NullOr(Schema.String)),
})

export const DiscordChannels = Schema.Array(DiscordChannel)

export const DiscordUser = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  global_name: Schema.optional(Schema.NullOr(Schema.String)),
  bot: Schema.optional(Schema.Boolean),
})

export const DiscordMessage = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
  guild_id: Schema.optional(Schema.String),
  content: Schema.String,
  timestamp: Schema.String,
  edited_timestamp: Schema.optional(Schema.NullOr(Schema.String)),
  author: DiscordUser,
  thread: Schema.optional(DiscordChannel),
})

export const DiscordMessages = Schema.Array(DiscordMessage)

export const DiscordSearchMessages = Schema.Struct({
  messages: Schema.Array(Schema.Array(DiscordMessage)),
})

export const DiscordSendMessageResponse = DiscordMessage

export type DiscordGuild = typeof DiscordGuild.Type
export type DiscordChannel = typeof DiscordChannel.Type
export type DiscordMessage = typeof DiscordMessage.Type

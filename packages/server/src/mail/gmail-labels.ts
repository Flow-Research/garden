export type GmailConversationStateAction =
  | 'mark-read'
  | 'mark-unread'
  | 'archive'
  | 'unarchive'
  | 'pin'
  | 'unpin'

/** Maps Garden's conversation actions to idempotent Gmail thread labels. */
export const gmailLabelMutation = (
  action: GmailConversationStateAction,
): { readonly addLabelIds: string[]; readonly removeLabelIds: string[] } => {
  switch (action) {
    case 'mark-read':
      return { addLabelIds: [], removeLabelIds: ['UNREAD'] }
    case 'mark-unread':
      return { addLabelIds: ['UNREAD'], removeLabelIds: [] }
    case 'archive':
      return { addLabelIds: [], removeLabelIds: ['INBOX'] }
    case 'unarchive':
      return { addLabelIds: ['INBOX'], removeLabelIds: [] }
    case 'pin':
      return { addLabelIds: ['STARRED'], removeLabelIds: [] }
    case 'unpin':
      return { addLabelIds: [], removeLabelIds: ['STARRED'] }
  }
}

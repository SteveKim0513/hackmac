import type { Vendor } from '../account/cli.ts';
import { ClaudeConversation } from './claude.ts';
import { CodexConversation } from './codex.ts';
import type { Conversation, ConversationOptions } from './types.ts';

export type { Conversation, ConversationEvent, ConversationOptions } from './types.ts';

export const createConversation = (vendor: Vendor, o: ConversationOptions): Conversation =>
  vendor === 'claude' ? new ClaudeConversation(o) : new CodexConversation(o);

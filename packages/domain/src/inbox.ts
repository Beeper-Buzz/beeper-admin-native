import { z } from 'zod';
import { Id, tolerantEnum } from './common';
import { Money } from './money';

/**
 * The customer inbox (companion gem 0.7, capability `inbox`; docs/superpowers/specs/
 * 2026-11-28-menus-inbox-visitors.md §2). Every key but the ids is optional or tolerant: a status,
 * direction or channel the app doesn't know parses as `unknown` (or as the raw channel name)
 * instead of failing the whole list.
 */

export const CONVERSATION_STATUSES = ['open', 'snoozed', 'closed'] as const;
export const ConversationStatus = tolerantEnum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

/** `note` is an internal staff note, never sent to the customer. */
export const MESSAGE_DIRECTIONS = ['inbound', 'outbound', 'note'] as const;
export const MessageDirection = tolerantEnum(MESSAGE_DIRECTIONS);
export type MessageDirection = z.infer<typeof MessageDirection>;

export const AUTHOR_KINDS = ['customer', 'staff', 'system'] as const;
export const AuthorKind = tolerantEnum(AUTHOR_KINDS);
export type AuthorKind = z.infer<typeof AuthorKind>;

export const DELIVERY_STATUSES = ['sent', 'delivered', 'failed'] as const;
export const DeliveryStatus = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : v),
  tolerantEnum(DELIVERY_STATUSES).nullable(),
);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

const Text = z.string().nullable().default(null);
const Count = z.number().int().nonnegative().catch(0).default(0);

/** Who wrote in, as the conversation names them. */
export const ConversationCustomer = z.object({
  name: Text,
  email: Text,
  avatarUrl: Text,
  contactId: Id.nullable().default(null),
  userId: Id.nullable().default(null),
});
export type ConversationCustomer = z.infer<typeof ConversationCustomer>;

export const StaffMember = z.object({ id: Id, email: Text });
export type StaffMember = z.infer<typeof StaffMember>;

export const LastMessage = z.object({
  body: z.string().default(''),
  direction: MessageDirection,
  at: Text,
});
export type LastMessage = z.infer<typeof LastMessage>;

export const Conversation = z.object({
  id: Id,
  status: ConversationStatus,
  /** `web`, `email`, … as the host names it. */
  channel: z.string().default('web'),
  subject: Text,
  customer: ConversationCustomer.default({
    name: null,
    email: null,
    avatarUrl: null,
    contactId: null,
    userId: null,
  }),
  assignee: StaffMember.nullable().default(null),
  /** Inbound messages staff haven't read. */
  unread: Count,
  lastMessage: LastMessage.nullable().default(null),
  updatedAt: Text,
  snoozedUntil: Text,
});
export type Conversation = z.infer<typeof Conversation>;

export const MessageAttachment = z.object({
  url: z.string().min(1),
  filename: z.string().default('Attachment'),
  contentType: Text,
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

export const Message = z.object({
  id: Id,
  direction: MessageDirection,
  body: z.string().default(''),
  channel: Text,
  author: z
    .object({ kind: AuthorKind, name: Text })
    .default({ kind: 'unknown', name: null } as { kind: AuthorKind; name: string | null }),
  attachments: z.array(MessageAttachment).default([]),
  createdAt: Text,
  readAt: Text,
  delivery: DeliveryStatus.default(null),
});
export type Message = z.infer<typeof Message>;

export const ContextCartItem = z.object({
  name: z.string().default('Item'),
  quantity: Count,
  imageUrl: Text,
});
export type ContextCartItem = z.infer<typeof ContextCartItem>;

/** What the inbox knows about the person behind a conversation (`GET conversations/:id`). */
export const CustomerContext = z.object({
  contact: z
    .object({ id: Id.nullable().default(null), name: Text, email: Text, phone: Text })
    .nullable()
    .default(null),
  user: z.object({ id: Id, email: Text }).nullable().default(null),
  /** Their storefront visit, when the store tracks visitors. */
  session: z
    .object({ id: Id, currentUrl: Text, lastSeenAt: Text, online: z.boolean().default(false) })
    .nullable()
    .default(null),
  cart: z
    .object({
      orderNumber: z.string().min(1),
      itemCount: Count,
      /** null when the store sent no total, or one that isn't money. */
      total: Money.nullable().default(null),
      items: z.array(ContextCartItem).default([]),
    })
    .nullable()
    .default(null),
  recentOrders: z
    .array(
      z.object({
        number: z.string().min(1),
        state: Text,
        total: Money.nullable().default(null),
        completedAt: Text,
      }),
    )
    .default([]),
});
export type CustomerContext = z.infer<typeof CustomerContext>;

/** One conversation with the customer context; null context when the store sent none. */
export type ConversationDetail = Conversation & { customerContext: CustomerContext | null };

/** Badge numbers (`GET inbox/summary`). */
export const InboxSummary = z.object({ open: Count, unassigned: Count, unread: Count });
export type InboxSummary = z.infer<typeof InboxSummary>;

/** A customer's display name: their name, else their email, else "Visitor". */
export function customerName(customer: Pick<ConversationCustomer, 'name' | 'email'> | null): string {
  return customer?.name?.trim() || customer?.email?.trim() || 'Visitor';
}

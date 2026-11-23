import { sql, type SQL } from 'drizzle-orm'
import {
  bigint,
  date,
  customType,
  doublePrecision,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core'
import type { ChatTraceStep, ChatTurn, ProcessingStep } from '../archive/types'

/** Postgres' own type for a text prepared for full-text search. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

/** The most of a document's content that goes into the search index; a `tsvector` holds 1 MB at most. */
const INDEXED_CONTENT_CHARACTERS = 500_000

export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** What belongs here, in the administrator's words; the decision model reads it when it picks a category. */
  description: text('description').notNull().default(''),
  /** Colour of the index tab that marks the category in every view. */
  color: text('color').notNull(),
  position: integer('position').notNull(),
  /** Exactly one category receives the documents of a removed category. */
  isFallback: boolean('is_fallback').notNull().default(false),
})

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    originalFilename: text('original_filename').notNull(),
    title: text('title').notNull(),
    /** Where the name came from; a name the administrator typed is never replaced by processing. */
    titleSource: text('title_source', { enum: ['filename', 'auto', 'manual'] })
      .notNull()
      .default('filename'),
    format: text('format', { enum: ['pdf', 'image'] }).notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Content fingerprint; the unique index is what refuses a duplicate upload. */
    sha256: text('sha256').notNull().unique(),
    /** Where the original lives in file storage — a path on disk or a blob address. */
    storageKey: text('storage_key').notNull(),
    /** Small WebP copy of an image, shown in lists; `null` for a PDF or when it could not be made. */
    thumbnailKey: text('thumbnail_key'),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    /**
     * Who chose the category: nobody yet (`default`, the fallback category),
     * processing (`auto`) or the administrator (`manual`, never replaced by processing).
     */
    categorySource: text('category_source', { enum: ['default', 'auto', 'manual'] })
      .notNull()
      .default('default'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    issuedYear: integer('issued_year'),
    /**
     * The day the document itself is dated, when its content says so. Lists are
     * ordered by it. When only the year is known, this is `null` and `issuedYear` holds the year.
     */
    issuedOn: date('issued_on'),
    issuedYearSource: text('issued_year_source', { enum: ['auto', 'manual'] }),
    customDescription: text('custom_description').notNull().default(''),
    /** Written by processing: the whole text of a PDF, or a paragraph about an image. */
    autoDescription: text('auto_description').notNull().default(''),
    /** Written by processing: one or two sentences shown to visitors. */
    shortDescription: text('short_description').notNull().default(''),
    /** Only a `ready` document is public. */
    status: text('status', { enum: ['queued', 'processing', 'ready', 'failed'] })
      .notNull()
      .default('queued'),
    /** When the current processing run began; lets a run that died be started again. */
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    /** `null` until processing has looked for text in the document. */
    hasText: boolean('has_text'),
    errorReason: text('error_reason'),
    pageCount: integer('page_count'),
    /**
     * What the search looks into, kept by the database itself: the name weighs
     * most, then the file name and the descriptions, then the content. The
     * `cs_simple` configuration ignores diacritics and letter case.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL => sql`(
        setweight(to_tsvector('cs_simple', ${documents.title}), 'A') ||
        setweight(to_tsvector('cs_simple', regexp_replace(${documents.originalFilename}, '[^[:alnum:]]+', ' ', 'g')), 'B') ||
        setweight(to_tsvector('cs_simple', ${documents.customDescription} || ' ' || ${documents.shortDescription}), 'B') ||
        setweight(to_tsvector('cs_simple', left(${documents.autoDescription}, ${sql.raw(String(INDEXED_CONTENT_CHARACTERS))})), 'D')
      )`,
    ),
  },
  (table) => [
    index('documents_added_at_idx').on(table.addedAt),
    index('documents_search_idx').using('gin', table.searchVector),
  ],
)

/**
 * One row per call to a model: what was asked, what came back and what it
 * cost. The calls of one processing run form a session the administrator can
 * read. Rows outlive their document: the
 * money was spent even if the document is removed later.
 */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: serial('id').primaryKey(),
    /** All calls of one processing run share this id. */
    runId: text('run_id').notNull(),
    documentId: text('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Name of the document at the time, kept for when the document is gone. */
    documentTitle: text('document_title').notNull(),
    /** `null` for a call that did not read a document, i.e. the optimizer. */
    format: text('format', { enum: ['pdf', 'image'] }),
    operation: text('operation', {
      enum: [
        'read-page',
        'read-mixed-page',
        'describe-image',
        'summarize',
        'categorize',
        'optimize',
        'embed',
        'chat',
        'weigh',
        'rerank',
        'glossary',
      ],
    }).notNull(),
    /** The place the call was made at (see `SkillUse`); older rows hold the key of one skill here. */
    skillKey: text('skill_key'),
    skillVersion: integer('skill_version').notNull().default(0),
    /** Every skill the call was told, with the version of its text; 0 is the starting text. */
    skills: jsonb('skills').$type<{ key: string; version: number }[]>(),
    /** Page of a PDF the call read. */
    page: integer('page'),
    /** The text sent to the model. A page or an image itself is not stored, only named. */
    input: text('input').notNull().default(''),
    output: text('output').notNull().default(''),
    /** Why the call failed; `null` when it went well. */
    error: text('error'),
    durationMs: integer('duration_ms').notNull().default(0),
    /** As written in `.env`: provider:model. */
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    /** In US dollars at the price valid when the call was made; `null` when the price was not known. */
    costUsd: doublePrecision('cost_usd'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_usage_created_at_idx').on(table.createdAt)],
)

/**
 * One processing run of a document, step by step: what processing did itself,
 * where its model calls belong and what it stored. The administrator reads it
 * in the debug panel. The calls themselves are in `ai_usage` under the same id.
 */
export const processingRuns = pgTable(
  'processing_runs',
  {
    /** The same id as `run_id` of the run's rows in `ai_usage`. */
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    outcome: text('outcome', { enum: ['ready', 'failed'] }).notNull(),
    /** Why the run failed; `null` when it went well. */
    error: text('error'),
    steps: jsonb('steps').$type<ProcessingStep[]>().notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('processing_runs_document_idx').on(table.documentId)],
)

/** Numbers in one embedding. Fixed by the column type, so every embedding model must give this many. */
export const EMBEDDING_DIMENSIONS = 1536

/**
 * A document cut into pieces the chat searches in and quotes from. Written by
 * processing, all pieces of a document at once.
 *
 * One index is not declared here because Drizzle cannot express it; it is in
 * migration 0006: `document_chunks_bm25_idx`, a BM25 index over `indexed`.
 */
export const documentChunks = pgTable(
  'document_chunks',
  {
    id: serial('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** Page of a PDF the piece is from; `null` for an image. */
    page: integer('page'),
    /** Order of the piece inside its document, from zero. */
    position: integer('position').notNull(),
    /** What the model reads and what a trace shows. */
    text: text('text').notNull(),
    /** The name of the document and the text; the word search (BM25) looks here. */
    indexed: text('indexed').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    /** As written in `.env`. Vectors of different models cannot be compared. */
    embeddingModel: text('embedding_model'),
  },
  (table) => [
    index('document_chunks_document_idx').on(table.documentId),
    index('document_chunks_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
)

/**
 * One question to the chat with everything that happened on the way to the
 * answer. The administrator reads it to see why the chat answered as it did.
 * The questions of one conversation share a `session_id`.
 */
export const chatTraces = pgTable(
  'chat_traces',
  {
    /** The same id as `run_id` of the question's rows in `ai_usage`. */
    id: text('id').primaryKey(),
    /** A random UUID; whoever has it may continue the conversation. Traces older than sessions carry their own id. */
    sessionId: text('session_id').notNull(),
    question: text('question').notNull(),
    /** The earlier turns of the session exactly as the model received them; empty for the first question. */
    history: jsonb('history').$type<ChatTurn[]>().notNull().default([]),
    answer: text('answer').notNull().default(''),
    /** Why the question got no answer; `null` when it went well. */
    error: text('error'),
    // `shown` and `document` are in traces older than the choice of documents.
    scope: text('scope', { enum: ['archive', 'documents', 'shown', 'document'] }).notNull(),
    /** As written in `.env`: provider:model. */
    model: text('model').notNull(),
    /** Model calls and searches in the order they happened. */
    steps: jsonb('steps').$type<ChatTraceStep[]>().notNull(),
    /** The instructions and the numbers that were in force. */
    setup: jsonb('setup').$type<Record<string, string | number>>().notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    costUsd: doublePrecision('cost_usd'),
    /** Who asked, as a hash; only for the hourly limit. `null` for the administrator. */
    askerHash: text('asker_hash'),
    /** Whether the visitor found in the answer what they were looking for; `null` until they say. */
    helpful: boolean('helpful'),
    /** When the visitor last said it; they may change their mind. */
    ratedAt: timestamp('rated_at', { withTimezone: true }),
    /** The id of the question's trace in MLflow; `null` when MLflow was not set up. */
    mlflowTraceId: text('mlflow_trace_id'),
    /** The visitor's word as feedback in MLflow, so a changed word updates it; `null` until it is there. */
    mlflowFeedbackId: text('mlflow_feedback_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('chat_traces_created_at_idx').on(table.createdAt),
    index('chat_traces_session_idx').on(table.sessionId, table.createdAt),
  ],
)

/**
 * What the administrator set about a skill besides its text. For a skill the
 * administrator added (id "vlastni/<name>") this row is the skill: its name,
 * its places and whether it is on. For a starting skill (id of its file) a
 * row is there only when its places were changed, and holds those places.
 * The text of every skill is in `skill_versions`.
 */
export const customSkills = pgTable('custom_skills', {
  /** Never changes: stored records point at it. */
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  group: text('group', { enum: ['zpracovani', 'chat'] }).notNull(),
  /** Places the skill is attached at (see `SkillUse`). */
  uses: jsonb('uses').$type<string[]>().notNull(),
  /** A skill that is switched off stays here but no call gets it. */
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A text of a skill other than the starting one in the code: what the
 * administrator saved. At most one text of a skill is `active`; the texts
 * before it stay as `retired`. (`proposed` and `rejected` are in rows from the
 * time a model proposed texts.)
 */
export const skillVersions = pgTable(
  'skill_versions',
  {
    id: serial('id').primaryKey(),
    skillKey: text('skill_key').notNull(),
    /** Counts approved wordings of a skill from 1; `null` until approved. */
    version: integer('version'),
    /** `{ content }`: the whole Markdown text. Rows from before skills were Markdown hold other keys and are ignored. */
    parts: jsonb('parts').$type<Record<string, string>>().notNull(),
    /** Who wrote the text, in words. */
    rationale: text('rationale').notNull(),
    status: text('status', { enum: ['proposed', 'active', 'retired', 'rejected'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [index('skill_versions_key_idx').on(table.skillKey, table.status)],
)

/** Failed sign-in attempts, kept only to slow down password guessing. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: serial('id').primaryKey(),
    ipHash: text('ip_hash').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_attempts_ip_idx').on(table.ipHash, table.attemptedAt)],
)

export type DocumentRow = typeof documents.$inferSelect
export type CategoryRow = typeof categories.$inferSelect

CREATE TABLE "retrieval_chunks" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"message_id" text NOT NULL,
	"message_seq" bigint NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"content" text NOT NULL,
	"search_text" text NOT NULL,
	"token_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_embeddings" (
	"chunk_id" text,
	"model" text,
	"dimensions" integer,
	"embedding" vector,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retrieval_embeddings_pkey" PRIMARY KEY("chunk_id","model","dimensions"),
	CONSTRAINT "retrieval_embeddings_status_check" CHECK (("status" = 'ready' AND "embedding" IS NOT NULL) OR ("status" IN ('pending', 'failed') AND "embedding" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "session_compactions" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"through_seq" bigint NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_messages" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"message" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"next_message_seq" bigint DEFAULT 1 NOT NULL,
	"sources" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source_search_text" text DEFAULT '' NOT NULL,
	"source_token_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_space_id_check" CHECK (length(trim("space_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_chunks_message_chunk_unique" ON "retrieval_chunks" ("message_id","chunk_index");--> statement-breakpoint
CREATE INDEX "retrieval_chunks_session_seq_idx" ON "retrieval_chunks" ("session_id","message_seq");--> statement-breakpoint
CREATE INDEX "retrieval_chunks_fts_idx" ON "retrieval_chunks" USING gin (to_tsvector('simple', "token_text"));--> statement-breakpoint
CREATE INDEX "retrieval_chunks_trgm_idx" ON "retrieval_chunks" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "retrieval_embeddings_model_dimensions_idx" ON "retrieval_embeddings" ("model","dimensions");--> statement-breakpoint
CREATE INDEX "retrieval_embeddings_jobs_idx" ON "retrieval_embeddings" ("model","dimensions","status");--> statement-breakpoint
CREATE UNIQUE INDEX "session_compactions_session_through_unique" ON "session_compactions" ("session_id","through_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "session_messages_session_seq_unique" ON "session_messages" ("session_id","seq");--> statement-breakpoint
CREATE INDEX "sessions_space_updated_idx" ON "sessions" ("space_id","updated_at");--> statement-breakpoint
CREATE INDEX "sessions_sources_idx" ON "sessions" USING gin ("sources");--> statement-breakpoint
CREATE INDEX "sessions_source_fts_idx" ON "sessions" USING gin (to_tsvector('simple', "source_token_text"));--> statement-breakpoint
CREATE INDEX "sessions_source_trgm_idx" ON "sessions" USING gin ("source_search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "retrieval_chunks" ADD CONSTRAINT "retrieval_chunks_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "retrieval_chunks" ADD CONSTRAINT "retrieval_chunks_message_id_session_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "session_messages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ADD CONSTRAINT "retrieval_embeddings_chunk_id_retrieval_chunks_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "retrieval_chunks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_compactions" ADD CONSTRAINT "session_compactions_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;
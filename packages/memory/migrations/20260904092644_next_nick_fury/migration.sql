CREATE TABLE "memories" (
	"id" text PRIMARY KEY,
	"layer" text NOT NULL,
	"space_id" text,
	"date" date,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "memories_layer_space_check" CHECK (("layer" = 'global.long_term' AND "space_id" IS NULL) OR ("layer" IN ('space.long_term', 'space.daily') AND length(trim("space_id")) > 0)),
	CONSTRAINT "memories_layer_date_check" CHECK (("layer" = 'space.daily' AND "date" IS NOT NULL) OR ("layer" IN ('global.long_term', 'space.long_term') AND "date" IS NULL)),
	CONSTRAINT "memories_kind_check" CHECK ("kind" IN ('event', 'fact', 'preference', 'summary')),
	CONSTRAINT "memories_status_check" CHECK ("status" IN ('active', 'archived')),
	CONSTRAINT "memories_content_check" CHECK (length(trim("content")) > 0),
	CONSTRAINT "memories_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "memory_chunks" (
	"id" text PRIMARY KEY,
	"memory_id" text NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"search_text" text NOT NULL,
	"token_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"chunk_id" text,
	"model" text,
	"dimensions" integer,
	"embedding" vector,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY("chunk_id","model","dimensions"),
	CONSTRAINT "memory_embeddings_dimensions_check" CHECK ("dimensions" BETWEEN 1 AND 16000 AND ("embedding" IS NULL OR vector_dims("embedding") = "dimensions")),
	CONSTRAINT "memory_embeddings_status_check" CHECK (("status" = 'ready' AND "embedding" IS NOT NULL) OR ("status" IN ('pending', 'failed') AND "embedding" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "memory_sources" (
	"memory_id" text,
	"position" integer,
	"source" jsonb NOT NULL,
	CONSTRAINT "memory_sources_pkey" PRIMARY KEY("memory_id","position")
);
--> statement-breakpoint
CREATE INDEX "memories_space_layer_date_idx" ON "memories" ("space_id","layer","date") WHERE "layer" <> 'global.long_term';--> statement-breakpoint
CREATE UNIQUE INDEX "memory_chunks_position_idx" ON "memory_chunks" ("memory_id","position");--> statement-breakpoint
CREATE INDEX "memory_chunks_fts_idx" ON "memory_chunks" USING gin (to_tsvector('simple', "token_text"));--> statement-breakpoint
CREATE INDEX "memory_chunks_trgm_idx" ON "memory_chunks" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "memory_embeddings_jobs_idx" ON "memory_embeddings" ("model","dimensions","status");--> statement-breakpoint
ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_memory_id_memories_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_chunk_id_memory_chunks_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "memory_chunks"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_memory_id_memories_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE;
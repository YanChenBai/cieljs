DROP INDEX "retrieval_embeddings_hnsw_idx";--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ADD COLUMN "dimensions" integer;--> statement-breakpoint
-- 先回填旧向量维数，再将维数加入主键，保留已有索引数据。
UPDATE "retrieval_embeddings" SET "dimensions" = vector_dims("embedding");--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" DROP CONSTRAINT "retrieval_embeddings_pkey";--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ADD PRIMARY KEY ("chunk_id","model","dimensions");--> statement-breakpoint
ALTER TABLE "retrieval_embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector USING "embedding"::vector;--> statement-breakpoint
CREATE INDEX "retrieval_embeddings_model_dimensions_idx" ON "retrieval_embeddings" ("model","dimensions");

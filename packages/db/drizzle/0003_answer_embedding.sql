ALTER TABLE "answer" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
CREATE INDEX "answer_embedding_idx" ON "answer" USING hnsw ("embedding" vector_cosine_ops);
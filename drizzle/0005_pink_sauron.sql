CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION cs_simple (COPY = simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION cs_simple ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part, numword, numhword, hword_numpart WITH unaccent, simple;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS ((
        setweight(to_tsvector('cs_simple', "title"), 'A') ||
        setweight(to_tsvector('cs_simple', regexp_replace("original_filename", '[^[:alnum:]]+', ' ', 'g')), 'B') ||
        setweight(to_tsvector('cs_simple', "custom_description" || ' ' || "short_description"), 'B') ||
        setweight(to_tsvector('cs_simple', left("auto_description", 500000)), 'D')
      )) STORED;--> statement-breakpoint
CREATE INDEX "documents_search_idx" ON "documents" USING gin ("search_vector");
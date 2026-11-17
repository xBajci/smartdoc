# Postgres 17 with the two extensions the chat needs on top of the stock image:
# pgvector (embeddings) and pg_textsearch (BM25 ranking).
FROM pgvector/pgvector:pg17

ARG TARGETARCH
ARG PG_TEXTSEARCH_VERSION=1.5.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && curl -fsSL -o /tmp/pg-textsearch.zip \
    "https://github.com/timescale/pg_textsearch/releases/download/v${PG_TEXTSEARCH_VERSION}/pg-textsearch-v${PG_TEXTSEARCH_VERSION}-pg17-${TARGETARCH}.zip" \
  && unzip /tmp/pg-textsearch.zip -d /tmp/pg-textsearch \
  && dpkg -i /tmp/pg-textsearch/*.deb \
  && rm -rf /tmp/pg-textsearch /tmp/pg-textsearch.zip /var/lib/apt/lists/*

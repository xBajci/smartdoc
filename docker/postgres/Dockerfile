# Postgres 17 with the two extensions the chat needs on top of the stock image:
# pgvector (embeddings) and pg_textsearch (BM25 ranking).
# Complete on its own: Openship builds it as a service without docker-compose.yml.
FROM pgvector/pgvector:0.8.7-pg17

# The architecture comes from dpkg, not TARGETARCH: the legacy builder (no BuildKit,
# as on Openship servers without buildx) leaves TARGETARCH empty.
ARG PG_TEXTSEARCH_VERSION=1.5.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl unzip \
  && curl -fsSL -o /tmp/pg-textsearch.zip \
    "https://github.com/timescale/pg_textsearch/releases/download/v${PG_TEXTSEARCH_VERSION}/pg-textsearch-v${PG_TEXTSEARCH_VERSION}-pg17-$(dpkg --print-architecture).zip" \
  && unzip /tmp/pg-textsearch.zip -d /tmp/pg-textsearch \
  && dpkg -i /tmp/pg-textsearch/*.deb \
  && rm -rf /tmp/pg-textsearch /tmp/pg-textsearch.zip /var/lib/apt/lists/*

# pg_textsearch must be loaded when the server starts. The migrations create the extensions.
CMD ["postgres", "-c", "shared_preload_libraries=pg_textsearch"]

HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD pg_isready -U "${POSTGRES_USER:-postgres}" || exit 1

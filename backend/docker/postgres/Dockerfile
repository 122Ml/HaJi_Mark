FROM postgres:18.1-alpine3.23 AS vector-build
ARG ALPINE_MIRROR=""
RUN if [ -n "$ALPINE_MIRROR" ]; then sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR}|g" /etc/apk/repositories; fi \
    && apk add --no-cache build-base
ADD --checksum=sha256:cac0b10c360f05b2d521200105ba3697e773d4cd3731f5a915a7e37ebe0bea85 https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v0.8.7 /tmp/pgvector.tar.gz
RUN tar -xzf /tmp/pgvector.tar.gz -C /tmp \
    && cd /tmp/pgvector-0.8.7 && make with_llvm=no OPTFLAGS="" && make install with_llvm=no

FROM postgres:18.1-alpine3.23
COPY --from=vector-build /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=vector-build /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
HEALTHCHECK --interval=5s --timeout=3s --retries=12 CMD pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" || exit 1

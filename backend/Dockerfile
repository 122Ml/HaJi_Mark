FROM golang:1.26.1-alpine AS build
ENV GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS=-p=2
WORKDIR /src
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY
COPY go.mod go.sum ./
RUN go mod download -x
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker && CGO_ENABLED=0 go build -trimpath -o /out/seed-s1 ./cmd/seed-s1

FROM golang:1.26.1-alpine AS migration-tools
ENV GOMAXPROCS=2 GOMEMLIMIT=768MiB
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY
RUN GOBIN=/out go install -tags='no_clickhouse no_mssql no_mysql no_sqlite3 no_vertica no_ydb no_libsql' github.com/pressly/goose/v3/cmd/goose@v3.26.0

FROM alpine:3.22 AS runtime
ENV MALLOC_ARENA_MAX=2
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.ustc.edu.cn/alpine|g' /etc/apk/repositories \
    && apk add --no-cache ca-certificates && addgroup -S -g 1000 app && adduser -S -u 1000 -G app app
WORKDIR /app
COPY --from=build /out/api /out/worker /out/seed-s1 ./
COPY --from=migration-tools /out/goose ./
COPY db/migrations ./db/migrations
COPY config ./config
RUN mkdir -p /data/materials && chown app:app /data/materials
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/api/v1/health/live || exit 1
CMD ["./api"]

FROM python:3.12-slim-bookworm AS rag-worker
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PYTHONUNBUFFERED=1 MALLOC_ARENA_MAX=2
WORKDIR /app
COPY tools/parser/requirements.txt /tmp/requirements.txt
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm -f /tmp/requirements.txt
RUN python -c "from rapidocr import RapidOCR; RapidOCR(); print('Chinese OCR models ready')"
COPY --from=build /out/worker ./worker
COPY config ./config
COPY tools/parser ./tools/parser
RUN useradd -u 1000 -m app && mkdir -p /data/materials && chown app:app /data/materials
USER app
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=6 CMD sh -c 'test -e /proc/1/stat && grep -q worker /proc/1/comm'
CMD ["./worker"]

FROM runtime AS default

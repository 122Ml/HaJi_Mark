FROM golang:1.26.1-alpine AS build
ENV GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS=-p=2
WORKDIR /src
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY
COPY go.mod go.sum ./
RUN go mod download -x
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker && CGO_ENABLED=0 go build -trimpath -o /out/seed-s1 ./cmd/seed-s1

FROM build AS migration-tools
RUN GOBIN=/out go install -tags='no_clickhouse no_mssql no_mysql no_sqlite3 no_vertica no_ydb no_libsql' github.com/pressly/goose/v3/cmd/goose@v3.26.0

FROM alpine:3.22 AS runtime
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.ustc.edu.cn/alpine|g' /etc/apk/repositories \
    && apk add --no-cache ca-certificates && addgroup -S -g 1000 app && adduser -S -u 1000 -G app app
WORKDIR /app
COPY --from=build /out/api /out/worker /out/seed-s1 ./
COPY --from=migration-tools /out/goose ./
COPY db/migrations ./db/migrations
COPY config ./config
RUN mkdir -p /data/materials && chown app:app /data/materials
USER app
CMD ["./api"]

FROM python:3.12-slim-bookworm AS rag-worker
ENV OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY tools/parser/requirements.txt /tmp/requirements.txt
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN python -c "from rapidocr import RapidOCR; RapidOCR(); print('Chinese OCR models ready')"
COPY --from=build /out/worker ./worker
COPY config ./config
COPY tools/parser ./tools/parser
RUN useradd -u 1000 -m app && mkdir -p /data/materials && chown -R app:app /data/materials /app
USER app
CMD ["./worker"]

FROM runtime AS default

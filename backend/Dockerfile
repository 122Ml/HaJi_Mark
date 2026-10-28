FROM golang:1.26.1-alpine AS build
ENV GOMAXPROCS=2 GOMEMLIMIT=768MiB GOFLAGS=-p=2
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && CGO_ENABLED=0 go build -trimpath -o /out/worker ./cmd/worker

FROM build AS migration-tools
RUN GOBIN=/out go install -tags='no_clickhouse no_mssql no_mysql no_sqlite3 no_vertica no_ydb no_libsql' github.com/pressly/goose/v3/cmd/goose@v3.26.0

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates && addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build /out/api /out/worker ./
COPY --from=migration-tools /out/goose ./
COPY db/migrations ./db/migrations
USER app
CMD ["./api"]

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/122Ml/HaJi_Mark/backend/internal/platform"
	"github.com/122Ml/HaJi_Mark/backend/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	config := platform.LoadConfig()
	db, err := pgxpool.New(ctx, config.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	cache := redis.NewClient(&redis.Options{Addr: config.RedisAddr})
	defer cache.Close()
	app := &http.Server{Addr: config.HTTPAddr, Handler: server.New(db, cache), ReadHeaderTimeout: 5 * time.Second}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- app.ListenAndServe() }()
	log.Printf("api listening on %s", config.HTTPAddr)
	select {
	case err := <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	case <-ctx.Done():
		shutdownCtx, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if err := app.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}
}

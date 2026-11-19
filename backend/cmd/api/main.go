package main

import (
	"context"
	"log"
	"net"
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

func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	config, err := platform.LoadConfigStrict()
	if err != nil {
		return err
	}
	poolCfg, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		return err
	}
	poolCfg.MaxConns = 16
	poolCfg.MinConns = 1
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	db, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return err
	}
	defer db.Close()
	cache := redis.NewClient(&redis.Options{Addr: config.RedisAddr})
	defer cache.Close()
	handler, waitBg := server.NewApp(ctx, db, cache, config)
	app := &http.Server{
		Addr:              config.HTTPAddr,
		Handler:           handler,
		BaseContext:       func(net.Listener) context.Context { return ctx },
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       300 * time.Second,
		WriteTimeout:      300 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- app.ListenAndServe() }()
	log.Printf("api listening on %s", config.HTTPAddr)
	select {
	case err := <-serverErrors:
		cancel()
		bgCtx, done := context.WithTimeout(context.Background(), 10*time.Second)
		waitBg(bgCtx)
		done()
		if err != nil && err != http.ErrServerClosed {
			return err
		}
	case <-ctx.Done():
		shutdownCtx, done := context.WithTimeout(context.Background(), 12*time.Second)
		if err := app.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown: %v", err)
		}
		done()
		bgCtx, bgDone := context.WithTimeout(context.Background(), 10*time.Second)
		waitBg(bgCtx)
		bgDone()
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

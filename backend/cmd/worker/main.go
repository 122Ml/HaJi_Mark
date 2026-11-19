package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/122Ml/HaJi_Mark/backend/internal/platform"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

func run() error {
	config, err := platform.LoadConfigStrict()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if !rag.Enabled() {
		log.Printf("worker idle (RAG disabled)")
		<-ctx.Done()
		return nil
	}
	poolCfg, err := pgxpool.ParseConfig(config.DatabaseURL)
	if err != nil {
		return err
	}
	poolCfg.MaxConns = 8
	poolCfg.MinConns = 1
	db, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return err
	}
	defer db.Close()
	models, err := rag.LoadModels(db)
	if err != nil {
		return fmt.Errorf("invalid model profiles: %w", err)
	}
	service := rag.New(models)
	defer service.Close()

	worker := asynq.NewServer(asynq.RedisClientOpt{Addr: config.RedisAddr}, asynq.Config{Concurrency: config.WorkerConcurrency})
	mux := asynq.NewServeMux()
	rag.RegisterWorker(mux, service)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		service.Recover(ctx)
	}()

	log.Printf("worker ready (concurrency=%d)", config.WorkerConcurrency)
	err = worker.Run(mux)
	cancel()
	wg.Wait()
	return err
}

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

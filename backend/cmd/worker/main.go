package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/122Ml/HaJi_Mark/backend/internal/platform"
	"github.com/122Ml/HaJi_Mark/backend/internal/rag"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	config := platform.LoadConfig()
	worker := asynq.NewServer(asynq.RedisClientOpt{Addr: config.RedisAddr}, asynq.Config{Concurrency: config.WorkerConcurrency})
	mux := asynq.NewServeMux()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if rag.Enabled() {
		db, err := pgxpool.New(ctx, config.DatabaseURL)
		if err != nil {
			log.Fatal(err)
		}
		defer db.Close()
		models, err := rag.LoadModels(db)
		if err != nil {
			log.Fatalf("invalid model profiles: %v", err)
		}
		service := rag.New(models)
		defer service.Close()
		rag.RegisterWorker(mux, service)
		go service.Recover(ctx)
	}
	log.Printf("worker ready (concurrency=%d)", config.WorkerConcurrency)
	if err := worker.Run(mux); err != nil {
		log.Fatal(err)
	}
}

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
	worker := asynq.NewServer(asynq.RedisClientOpt{Addr: config.RedisAddr}, asynq.Config{Concurrency: 1})
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
			log.Fatal("invalid model profiles")
		}
		service := rag.New(models)
		rag.RegisterWorker(mux, service)
		go service.Recover(ctx)
	}
	log.Print("worker ready")
	if err := worker.Run(mux); err != nil {
		log.Fatal(err)
	}
}

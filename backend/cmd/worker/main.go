package main

import (
	"log"

	"github.com/122Ml/HaJi_Mark/backend/internal/platform"
	"github.com/hibiken/asynq"
)

func main() {
	config := platform.LoadConfig()
	worker := asynq.NewServer(asynq.RedisClientOpt{Addr: config.RedisAddr}, asynq.Config{Concurrency: 1})
	mux := asynq.NewServeMux()
	// No business producers or handlers are registered in Sprint 0.
	log.Print("worker infrastructure ready; grading handlers are not implemented")
	if err := worker.Run(mux); err != nil {
		log.Fatal(err)
	}
}

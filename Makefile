SHELL := /bin/bash

PUBLIC_HOST ?= localhost

.PHONY: help up build down restart ps logs logs-gateway health urls

help:
	@echo "ShardWorld commands"
	@echo "  make up            Build and start all services in detached mode"
	@echo "  make build         Rebuild all services"
	@echo "  make down          Stop all services"
	@echo "  make restart       Restart all services"
	@echo "  make ps            Show running services"
	@echo "  make logs          Follow all logs"
	@echo "  make logs-gateway  Follow gateway logs only"
	@echo "  make health        Check gateway health endpoint"
	@echo "  make urls          Print player/admin URLs"

up:
	docker compose up --build -d

build:
	docker compose build

down:
	docker compose down

restart:
	docker compose down
	docker compose up --build -d

ps:
	docker compose ps

logs:
	docker compose logs -f

logs-gateway:
	docker compose logs -f gateway

health:
	curl -fsS http://localhost:8080/healthz || true
	@echo

urls:
	@echo "Player: http://$(PUBLIC_HOST):8080"
	@echo "Admin:  http://$(PUBLIC_HOST):8080/admin"

.PHONY: help up down build restart ps logs logs-backend logs-frontend logs-worker logs-beat shell backend-shell frontend-shell beat-shell makemigrations migrate createsuperuser seed check test-backend test-frontend api-generate api-check clean prod-up prod-down prod-build

PROD_ENV_FILE ?= .env.prod
PROD_COMPOSE = docker compose $(if $(strip $(PROD_ENV_FILE)),--env-file $(PROD_ENV_FILE)) -f docker-compose.prod.yml

# Default target: show help
help:
	@echo "======================================================================="
	@echo "                      Mobser Modular Platform                          "
	@echo "======================================================================="
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development Stack:"
	@echo "  up                - Start development containers in background"
	@echo "  down              - Stop and remove development containers"
	@echo "  build             - Build or rebuild development containers"
	@echo "  restart           - Restart development containers"
	@echo "  ps                - List running development containers"
	@echo "  logs              - Tail all container logs"
	@echo "  logs-backend      - Tail backend container logs"
	@echo "  logs-frontend     - Tail frontend container logs"
	@echo ""
	@echo "Background Jobs:"
	@echo "  logs-worker       - Tail Celery worker logs"
	@echo "  logs-beat         - Tail Celery Beat scheduler logs"
	@echo "  beat-shell        - Open bash shell inside the Celery Beat container"
	@echo ""
	@echo "Platform & Database:"
	@echo "  migrate           - Apply database migrations across platform apps"
	@echo "  makemigrations    - Create new database migrations"
	@echo "  seed              - Seed database with demo admin, organization & plans"
	@echo "  createsuperuser   - Create a superuser interactively"
	@echo "  check             - Run Django system configuration checks"
	@echo "  shell             - Open Django interactive Python shell"
	@echo "  backend-shell     - Open bash shell inside backend container"
	@echo ""
	@echo "Frontend Operations:"
	@echo "  frontend-shell    - Open sh shell inside frontend container"
	@echo ""
	@echo "Testing & Quality:"
	@echo "  test-backend      - Run Django unit tests"
	@echo "  test-frontend     - Run frontend ESLint checks"
	@echo "  api-generate      - Export OpenAPI and regenerate frontend API types"
	@echo "  api-check         - Fail if generated API artifacts have drifted"
	@echo ""
	@echo "Production Stack:"
	@echo "  prod-up           - Start production containers in background (.env.prod by default)"
	@echo "  prod-down         - Stop and remove production containers (.env.prod by default)"
	@echo "  prod-build        - Build or rebuild production containers (.env.prod by default)"
	@echo "  PROD_ENV_FILE=    - Use deployment-injected environment variables instead"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean             - Stop containers, remove volumes and temporary caches"
	@echo "======================================================================="

# Development Commands
up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

restart:
	docker compose restart

ps:
	docker compose ps

logs:
	docker compose logs -f

logs-backend:
	docker compose logs -f backend

logs-frontend:
	docker compose logs -f frontend

logs-worker:
	docker compose logs -f celery_worker

logs-beat:
	docker compose logs -f celery_beat

beat-shell:
	docker compose exec celery_beat bash

# Django Operations
migrate:
	docker compose exec backend python manage.py migrate

makemigrations:
	docker compose exec backend python manage.py makemigrations

seed:
	docker compose exec backend python scripts/seed_dev_data.py

createsuperuser:
	docker compose exec backend python manage.py createsuperuser

check:
	docker compose exec backend python manage.py check

shell:
	docker compose exec backend python manage.py shell

backend-shell:
	docker compose exec backend bash

# Frontend Commands
frontend-shell:
	docker compose exec frontend sh

# Testing Commands
test-backend:
	docker compose exec backend python manage.py test

test-frontend:
	docker compose exec frontend npm run lint

api-generate:
	bash scripts/api-contract.sh generate

api-check:
	bash scripts/api-contract.sh check

# Production Commands
prod-up:
	$(PROD_COMPOSE) up -d

prod-down:
	$(PROD_COMPOSE) down

prod-build:
	$(PROD_COMPOSE) build

# Clean caching and volumes
clean:
	docker compose down -v
	docker compose rm -f
	find . -type d -name "__pycache__" -exec rm -r {} + 2>/dev/null || true
	find . -type d -name ".next" -exec rm -r {} + 2>/dev/null || true
	find . -type d -name "node_modules" -exec rm -r {} + 2>/dev/null || true

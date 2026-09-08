# Product Modules Directory (`backend/product/`)

This directory is reserved for **domain-specific product modules and business logic** of Mobser, keeping them cleanly decoupled from the reusable platform foundations located in `backend/apps/`.

## Architectural Guidelines

* **Platform Modules (`backend/apps/`)**:
  * Horizontal, cross-cutting SaaS capabilities: `accounts`, `organizations`, `billing`, `notifications`, `audit`, and `common`.
  * Can be reused across multiple products or platforms.
* **Product Modules (`backend/product/`)**:
  * Vertical, domain-specific features unique to Mobser (e.g. computer vision pipelines, inspection workflows, edge sync, or custom product models).
  * Product models should inherit from `apps.common.models.BaseModel` and reference `apps.organizations.models.Organization` for tenant scoping.

## Creating a new product app

1. Create your app folder: `backend/product/<feature_name>/`
2. Define `apps.py` with `name = 'product.<feature_name>'` and `label = '<feature_name>'`.
3. Register `'product.<feature_name>.apps.<FeatureName>Config'` in `INSTALLED_APPS` inside `backend/core/settings/base.py`.
4. Include its URLs in `backend/core/urls.py` under `path('api/product/<feature_name>/', include('product.<feature_name>.urls'))`.

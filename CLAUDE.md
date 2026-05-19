# Hivemind AI Engine Configuration (Planning & Prototyping Phase)

## 1. Core Mandate: Prototype Over Production
* This project is an academic thesis prototype bounded strictly to a 9-week development lifecycle.
* DO NOT write enterprise-scale, deeply nested microservices, or over-engineered architectures unless explicitly ordered. 
* Prioritize rapid feature deployment, modular components, clean data-fetching layers, and high-fidelity UI targets.
* Security frameworks must be functional (e.g., standard Auth tokens/rules) but do not need commercial penetration hardening or production audits.

## 2. Shared Domain Patterns
Regardless of which final thesis title or stack is chosen, conform to these universal system models when assisting with code or planning architectures:

### A. The "Listing/Asset" Entity Lifecycle
All three potential proposals revolve around creating, updating, and filtering localized assets (Material Listings, Hydrant Pins, or Ride Events).
* Ensure data structures maintain a clear flat layout: `id`, `created_by` (UID), `timestamp`, `geoloc_coords` (or regional strings), `status`, and `metadata_tags`.
* Keep query management decoupled from the UI rendering layer so switching database drivers (Firebase, Supabase, or MongoDB) requires minimal friction.

### B. Spatial & Parametric Discovery
* All primary user flows rely heavily on search filtering (filtering items by category/condition, sorting hydrants by proximity, or finding rides by region/difficulty).
* When structuring search filters, prioritize robust client-side array sorting methods for prototype velocity before offloading to native backend index pipelines.

### C. UI/UX Assertions
* User interfaces must prioritize high visibility, explicit touch-targets, and responsive, straightforward layouts.
* Code should be structured cleanly to facilitate rapid user-testing adaptations, aligning with System Usability Scale (SUS) evaluation goals.

## 3. Claude Operational Instructions
* **Self-Verification:** Before finalizing any code modules or structure changes, verify completeness against the accelerated 9-week timeline sprint targets.
* **Context Preservation:** If asked to pivot layouts or refactor database collections, preserve core reference metadata fields (`id`, `created_at`, `owner_id`) to prevent data breaks during rapid transitions.
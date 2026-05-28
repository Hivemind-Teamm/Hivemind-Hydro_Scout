````md
# 🧠 Hydro-Scout Development Workspace

Welcome to the official development repository for **Hydro-Scout** — a centralized web-based mapping system for hydrant status and emergency water resources.

This repository serves as the primary workspace for planning, development, testing, documentation, and collaboration throughout the thesis development cycle.

---

# 🚒 About Hydro-Scout

Hydro-Scout is a web-based Geographic Information System (GIS) designed to help emergency responders:

- Locate operational fire hydrants in real time
- Monitor hydrant status updates
- Identify alternative emergency water sources
- Improve water-source response efficiency during fire incidents

The system is being developed using:

- Next.js
- React.js
- Firebase Firestore
- Mapbox GL JS
- Tailwind CSS

Development follows the Agile Scrum methodology within a limited academic development timeline.

---

# 📁 Repository Structure

```txt
/app            → Main application source code
/components     → Reusable UI components
/lib            → Firebase, utilities, helper functions
/public         → Static assets
/docs           → Documentation and research files
````

---

# 🌿 Branching & Contribution Rules

## 🚫 Never Push Directly to `main`

The `main` branch is protected.

All development must be done through separate branches and merged using Pull Requests (PRs).

---

# 🌱 Branch Naming Convention

Use the following format when creating branches:

```bash
type/short-description
```

Examples:

```bash
feature/hydrant-map
feature/auth-system
feature/otw-mode
feature/heatmap-overlay

fix/login-bug
fix/map-loading

ui/dashboard-redesign
ui/mobile-navbar

docs/readme-update
```

---

# 🛠️ Contribution Workflow

## 1. Pull Latest Changes

Before starting work:

```bash
git checkout main
git pull origin main
```

---

## 2. Create a Branch

Example:

```bash
git checkout -b feature/hydrant-map
```

---

## 3. Commit Changes Properly

Use clear commit messages.

Examples:

```bash
git commit -m "Added hydrant marker clustering"
git commit -m "Implemented OTW routing mode"
git commit -m "Fixed Firebase auth redirect issue"
```

---

## 4. Push Your Branch

```bash
git push origin feature/hydrant-map
```

---

## 5. Open a Pull Request

After pushing:

1. Open the repository on GitHub
2. Create a Pull Request into `main`
3. Wait for review and approval
4. Merge only after approval

---

# 📌 Development Guidelines

* Keep components modular and reusable
* Avoid unnecessary dependencies
* Prioritize mobile responsiveness
* Write readable and maintainable code
* Test features before pushing
* Keep commits focused and concise

---

# 🔒 Repository Rules

* No force pushing to `main`
* No direct commits to `main`
* Pull Requests are required before merging
* Keep branch names readable and organized

---

# 👥 Team Hivemind

* Mark Luis Barican
* Jabez Zecariah Tan
* John Patrick Yusingco
* Karl Andrei Manangan

CIIT College of Innovation and Integrated Technology
Bachelor of Science in Computer Science

```
```

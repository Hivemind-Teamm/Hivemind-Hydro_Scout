# 💧 Hydro-Scout

> Web-based GIS for emergency hydrant mapping & water resource management

![Agile Scrum](https://img.shields.io/badge/methodology-Agile%20Scrum-blue)
![Status](https://img.shields.io/badge/status-In%20Development-yellow)
![Branch](https://img.shields.io/badge/main-protected-red)

---

## About

Hydro-Scout is a web-based Geographic Information System (GIS) designed to help emergency responders:

- 📍 Locate operational fire hydrants in real time
- 📡 Monitor hydrant status updates
- 💧 Identify alternative emergency water sources
- ⚡ Improve water-source response efficiency during fire incidents

---

## Tech Stack

| Technology | Role |
|---|---|
| **Next.js** | Frontend framework |
| **React.js** | UI library |
| **Firebase Firestore** | Database |
| **Mapbox GL JS** | Interactive mapping |
| **Tailwind CSS** | Styling |

---

## Repository Structure

```
/app          → Main application source code
/components   → Reusable UI components
/lib          → Firebase, utilities, helper functions
/public       → Static assets
/docs         → Documentation and research files
```

---

## Branch Naming Convention

Format: `type/short-description`

| Prefix | Use case |
|---|---|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `ui/` | UI/UX changes |
| `docs/` | Documentation updates |

**Examples:**
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

## Contribution Workflow

### 1. Pull latest changes
Always sync before starting work:
```bash
git checkout main
git pull origin main
```

### 2. Create a branch
```bash
git checkout -b feature/hydrant-map
```

### 3. Commit with clear messages
```bash
git commit -m "Added hydrant marker clustering"
git commit -m "Implemented OTW routing mode"
git commit -m "Fixed Firebase auth redirect issue"
```

### 4. Push your branch
```bash
git push origin feature/hydrant-map
```

### 5. Open a Pull Request
1. Open the repository on GitHub
2. Create a Pull Request into `main`
3. Wait for review and approval
4. Merge only after approval

---

## Development Guidelines

- Keep components modular and reusable
- Avoid unnecessary dependencies
- Prioritize mobile responsiveness
- Write readable and maintainable code
- Test features before pushing
- Keep commits focused and concise

---

## Repository Rules

> ⚠️ **The `main` branch is protected. Never push directly to it.**

- ❌ No force pushing to `main`
- ❌ No direct commits to `main`
- ✅ Pull Requests are required before merging
- ✅ Keep branch names readable and organized

---

## Team Hivemind

| Name | Initials |
|---|---|
| Mark Luis Barican | MLB |
| Jabez Zecariah Tan | JZT |
| John Patrick Yusingco | JPY |
| Karl Andrei Manangan | KAM |

**CIIT College of Innovation and Integrated Technology**
Bachelor of Science in Computer Science

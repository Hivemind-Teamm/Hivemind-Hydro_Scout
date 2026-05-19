# 🧠 Hivemind Thesis Repository (Planning Workspace)

Welcome to the central repository for Team Hivemind! 

Right now, our team has three incredible thesis proposals on the table (**ReLoop**, **Hydro-Scout**, and **Throttle**). While we wait to lock in the final topic, we are using this "Planning Phase" to establish a highly optimized, AI-assisted development workspace. 

By setting this up now, the exact hour our topic is greenlit, our workspace will be ready to sprint instantly.

---

## 🚀 Why are we optimizing Claude Code right now?
Even though our three proposals have different topics, they share **80% of the same software DNA**. They are all:
1. **Location-aware, community-driven CRUD applications.**
2. **Strictly bounded by a 9-week academic timeline.**
3. **Prototypes designed to be evaluated using the System Usability Scale (SUS).**

We have pre-programmed these constraints into a file called `CLAUDE.md`. Because of this file, Claude Code acts less like a generic chatbot and more like a senior engineer who explicitly understands our thesis deadlines, architectural goals, and testing criteria.

---

## 🛠️ Repository Architecture (What's in here?)

* `CLAUDE.md` — **DO NOT DELETE.** This is the configuration blueprint that tells Claude Code how to behave. It restricts Claude from writing over-engineered, enterprise-scale structures so we can focus strictly on rapid prototyping.
* `README.md` — This file! The guide for the team.

---

## 💻 How to Use Claude Code on This Project (Step-by-Step)

If you want to use Anthropic's official terminal-based assistant (`claude`) to help you draft database models, map out UI directories, or plan agile sprints, follow these instructions:

### 1. Install Claude Code Globally
Open your machine's terminal (or PowerShell on Windows) and run the installer:
* **Mac / Linux / WSL:** `curl -fsSL https://claude.ai/install.sh | bash`
* **Windows (PowerShell):** `irm https://claude.ai/install.ps1 | iex`

### 2. Enter the Workspace
Navigate into this repository directory on your computer:
```bash
cd path/to/Hivemind-Prototype

### 3. Wake Up Claude
Open terminal and type in claude


# 🎯 What to ask Claude during this Planning Phase
Since we don't have active project code yet, you can use Claude to handle the heavy academic planning lift. Try typing these commands directly into your claude session terminal:

## For Database Planning: 
"Based on our CLAUDE.md, draft a universal data model blueprint for our core asset entity. Show me how it looks as a relational table for Supabase vs. a flexible document for MongoDB."

## For UI/UX Planning:
"Let's map out a universal UI component directory layout for our thesis. What core reusable component files will we need to satisfy high System Usability Scale (SUS) marks?"

## For Sprint Planning:
"Act as our Agile project manager. Based on our 9-week deadline, break down Sprint 1 (Weeks 1-2) into concrete user stories and tasks for a 4-person development team."
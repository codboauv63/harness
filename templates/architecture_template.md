# Architecture Globale (Technical Vision)

Ce document centralise les décisions d'architecture majeures et les choix technologiques pour l'ensemble du projet.

## 1. Principes Fondamentaux
- **Pattern Global** : (ex: Clean Architecture, Hexagonale, MVC...)
- **Paradigme** : (ex: Domain-Driven Design, API First...)

## 2. Choix Technologiques (Stack)
- **Frontend** : Vue 3, Pinia, MSW, Bootstrap 5...
- **Backend** : Node.js, Express, TypeScript, Inversify...
- **Base de données** : PostgreSQL, Redis, etc.

## 3. Structure des Bounded Contexts (Modules / Plugins)
Liste des grands modules du système et leur domaine de responsabilité.
- `plugin_core` : Sécurité, gestion des utilisateurs, infrastructure partagée.
- `plugin_xxx` : ...

## 4. Règles et Conventions
- Conventions de nommage.
- Stratégie de gestion des erreurs.
- Règles de sécurité transverses.

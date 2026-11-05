# Livraison S1 — Dev 1 → Dev 2

**Projet :** VC LOW Coworking SaaS — Pilote 33S  
**Semaine :** S1 (6–10 juillet)  
**Responsable :** Dev 1 (Membres, Réservations, Sessions, Portail)

---

## Vérification Supabase (07/07/2026)

| Élément | Statut |
|---------|--------|
| Connexion Supabase (`fgqwtbbxtgvnpxtmauua.supabase.co`) | ✅ OK |
| Tables `profiles`, `abonnements`, `espaces`, `reservations`, `sessions`, `paiements` | ✅ OK |
| Données seed `espaces` (7 espaces) | ✅ OK |
| Utilisateurs Auth + profils auto-créés | ✅ 2 utilisateurs |
| Colonnes `profiles.email`, `profiles.statut_compte` | ✅ Appliqué (`s1_migration.sql`) |
| Trigger anti-conflit réservations | ✅ Appliqué (`s1_migration.sql`) |

### Configuration `.env` (déjà en place)

**Frontend** (`frontend/.env`) :
- `VITE_SUPABASE_URL` ✅
- `VITE_SUPABASE_ANON_KEY` ✅
- `VITE_API_URL=http://localhost:5000` ✅

**Backend** (`backend/.env`) :
- `SUPABASE_URL` ✅
- `SUPABASE_ANON_KEY` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅
- `PORT=5000` ✅

### Action requise avant livraison Dev 2

Dans **Supabase → SQL Editor**, exécuter le fichier :

```
database/s1_migration.sql
```

---

## Périmètre S1 Dev 1 (planning uniquement)

| Tâche S1 | Fichier / livrable |
|----------|-------------------|
| Setup DB + Auth JWT (rôles) | `database/schema.sql` + `s1_migration.sql` |
| Module A backend : profils, abonnements | `backend/server.js` |
| Livrer schéma Membres + Réservations | Ce document + tables ci-dessous |

**Pas inclus S1** (Dev 2 ou semaines suivantes) : paiements UI, notifications, KPIs, QR code, minuteur WebSocket, UI réservation complète (S2).

---

## Ce qui est livré pour Dev 2

### Schéma base de données (`database/schema.sql`)

| Table | Statut | Usage Dev 2 |
|-------|--------|-------------|
| `profiles` | ✅ Complet + RLS | Référence membres |
| `abonnements` | ✅ Complet + RLS | Lier paiements abonnement |
| `espaces` | ✅ Complet + RLS | Tarification réservations |
| `reservations` | ✅ Complet + RLS + anti-conflit | Lier `paiements.reservation_id` |
| `sessions` | ✅ Complet + RLS | Hors scope paiement |
| `paiements` | ⚠️ Structure seule | **Dev 2 : ajouter RLS + APIs Module C** |
| `notifications` | ⚠️ Structure seule | **Dev 2 : Module F (S3)** |

### Rôles JWT (Supabase Auth)

`super_admin` | `admin` | `staff` | `formateur` | `member` | `guest`

Le profil est créé automatiquement via le trigger `on_auth_user_created`.

### API Backend Dev 1 (`backend/server.js`)

Toutes les routes protégées exigent `Authorization: Bearer <jwt_supabase>`.

#### Module A — Membres
- `GET /api/members/me` — profil connecté
- `PUT /api/members/me` — mise à jour profil
- `GET /api/members` — liste (admin/staff)
- `GET /api/members/:id` — détail (soi-même ou admin/staff)

#### Module A — Abonnements
- `GET /api/subscriptions/me` — mes abonnements
- `GET /api/subscriptions/me/active` — abonnement actif du jour
- `POST /api/subscriptions` — création (admin/staff)
- `PATCH /api/subscriptions/:id` — mise à jour statut (admin/staff)
- `GET /api/subscriptions` — liste globale (admin/staff)

#### Module B — Réservations (préparation S2)
- `POST /api/bookings/check-availability` — détection conflits créneaux
- `GET /api/bookings/calendar?from=&to=` — agenda réservations (membre ou admin)
- `POST /api/bookings` — créer réservation (statut `pending`, anti-conflit)

---

## Hors périmètre Dev 1 (à faire par Dev 2)

- Module C : encaissements, reçus PDF, relances J+3/J+7/J+15
- Module D : KPIs, exports
- Module F : notifications email/SMS
- Module G : formateurs

Le frontend `BookingStep3` crée une réservation en `pending` **sans paiement** — Dev 2 branchera le flux de paiement.

---

## Démarrage

```bash
# 1. Exécuter schema.sql dans Supabase SQL Editor

# 2. Backend Dev 1
cd backend
cp .env.example .env   # renseigner les clés Supabase
npm install
npm run dev

# 3. Frontend
cd frontend
cp .env.example .env
npm install
npm run dev
```

---

## Point de synchronisation S1

Dev 2 peut démarrer dès que `schema.sql` est appliqué sur Supabase.  
Tables prioritaires : `profiles`, `abonnements`, `reservations`, `paiements` (structure).

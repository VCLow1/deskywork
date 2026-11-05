# Livraison S2 — Dev 1

**Projet :** VC LOW Coworking SaaS — Pilote 33S  
**Semaine :** S2 (13–17 juillet)  
**Responsable :** Dev 1 (Modules A + B)  
**Statut Dev 2 (S2) :** Module C (paiements, reçus PDF, relances) — voir `DEV2_TRAVAIL_COMPLETE.md`

---

## Périmètre S2 Dev 1 (planning)

| Tâche S2 | Statut |
|----------|--------|
| Module A UI : tarification flexible & codes promo (CDC A3) | ✅ |
| Module B backend : calendrier, gestion conflits, rapport occupation | ✅ |
| Module B UI : réservation membre (3 étapes) + annulation | ✅ |
| Admin : gestion tarifs, codes promo, validation réservations | ✅ |

**Hors S2 (semaines suivantes) :**
- S3 : Agenda admin calendrier interactif, UI réservation avancée
- S3–S4 : Module B+ (WebSocket, minuteur live)
- S4–S5 : Module E (portail membre complet, QR code option)

---

## Migration SQL obligatoire

Dans **Supabase → SQL Editor**, exécuter :

```
database/s2_dev1_tarifs_promo.sql
```

Crée les tables : `tarifs_abonnements`, `codes_promo`, `historique_tarifs` + données seed (CDC A2/A3).

---

## API Backend Dev 1 (S2)

### Module A — Tarification (CDC A3)

| Méthode | Route | Rôle |
|---------|-------|------|
| GET | `/api/pricing` | Membre — tarifs selon son plan |
| GET | `/api/pricing/all` | Admin — tous les tarifs |
| POST | `/api/pricing` | Admin — créer tarif |
| PATCH | `/api/pricing/:id` | Admin — modifier tarif |
| POST | `/api/promo-codes/validate` | Membre — valider code promo |
| GET | `/api/promo-codes` | Admin — liste codes |
| POST | `/api/promo-codes` | Admin — créer code |
| PATCH | `/api/promo-codes/:id` | Admin — modifier code |
| GET | `/api/pricing/history/me` | Membre — historique tarifs appliqués |

`POST /api/subscriptions` accepte désormais `code_promo` et `plan_tarifaire` → enregistre dans `historique_tarifs`.

### Module B — Réservations (CDC B2)

| Méthode | Route | Rôle |
|---------|-------|------|
| GET | `/api/espaces` | Liste espaces |
| GET | `/api/bookings/calendar?from=&to=` | Calendrier réservations |
| GET | `/api/bookings` | Liste (membre ou admin) |
| POST | `/api/bookings` | Créer réservation (anti-conflit) |
| POST | `/api/bookings/check-availability` | Vérifier disponibilité |
| PATCH | `/api/bookings/:id` | Modifier / confirmer (admin) |
| DELETE | `/api/bookings/:id` | Annuler (membre ou admin) |
| GET | `/api/bookings/occupation?from=&to=` | Rapport taux occupation |

---

## Frontend Dev 1 (S2)

| Page | Route | Description |
|------|-------|-------------|
| `MemberSubscription.jsx` | `/dashboard/abonnement` | Grille tarifaire + codes promo |
| `AdminPricing.jsx` | `/admin/pricing` | Tarifs, promo, réservations, occupation |
| `BookingStep1.jsx` | `/book/step1` | Choix espace |
| `BookingStep2.jsx` | `/book/step2` | Choix créneau + vérif dispo |
| `BookingStep3.jsx` | `/book/step3` | Confirmation (statut `pending`) |
| `Dashboard.jsx` | `/dashboard` | Profil + abonnements + **mes réservations** |

---

## Intégration avec Dev 2

- Réservation créée en `pending` → Dev 2 peut créer le paiement via `POST /api/payments`
- Confirmation réservation → notification auto (Module F, Dev 2)
- Annulation → notification auto (Module F, Dev 2)
- Paiement Flouci / reçus PDF → pages `/member/payments`, `/admin/payments` (Dev 2)

---

## Démarrage

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

**Test rapide S2 :**
1. Se connecter comme membre → `/dashboard/abonnement` → tester code `WELCOME10`
2. Réserver un espace → `/book/step1` → étapes 1-2-3
3. Se connecter comme admin → `/admin/pricing` → confirmer une réservation pending
4. Vérifier rapport occupation (onglet « Rapport occupation »)

---

## Prochaine étape (S3 Dev 1)

- Agenda admin calendrier interactif (vue semaine/jour)
- Module B+ : WebSocket + minuteur serveur
- Check-in / check-out (table `sessions` déjà en place depuis S1)

-- =========================================================================
-- DESKYWORK v3.0 — SEED OFFICIEL : COMPTES & ESPACES PRÉDÉFINIS
-- Partenaires Exclusifs : Nero Coworking Space & Thirty Three Space
-- À exécuter directement dans le SQL Editor de Supabase
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- 1. TENANTS : NERO COWORKING SPACE & THIRTY THREE SPACE (PACK PREMIUM)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (
    "id", "nom", "slug", "description", "adresse", "ville", "pays",
    "email", "telephone", "site_web", "logo_url", "cover_url",
    "statut", "plan", "tier", "montant_mensuel",
    "limite_membres", "limite_espaces", "settings", "created_at", "updated_at"
) VALUES (
    'a1111111-1111-4111-8111-111111111111',
    'Nero Coworking Space',
    'nero-coworking',
    'Espace de travail moderne et calme situé à Ennasr 2, pensé pour les freelances, startups et équipes en quête de productivité.',
    'Avenue Hédi Nouira, Ennasr 2',
    'Tunis',
    'Tunisie',
    'contact@nerocoworking.tn',
    '+216 71 888 999',
    'https://nerocoworking.tn',
    'https://deskywork-jet.vercel.app/partners/nero-logo.png',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80',
    'actif',
    'enterprise',
    'A',
    220.00,
    999999,
    999999,
    '{"saas_pack":"premium","onboarding_completed":true,"limite_staff":10,"partenaire_officiel":true}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    adresse = EXCLUDED.adresse,
    ville = EXCLUDED.ville,
    email = EXCLUDED.email,
    telephone = EXCLUDED.telephone,
    logo_url = EXCLUDED.logo_url,
    cover_url = EXCLUDED.cover_url,
    statut = 'actif',
    plan = 'enterprise',
    tier = 'A',
    montant_mensuel = 220.00,
    limite_membres = 999999,
    limite_espaces = 999999,
    settings = '{"saas_pack":"premium","onboarding_completed":true,"limite_staff":10,"partenaire_officiel":true}'::jsonb,
    updated_at = NOW();

INSERT INTO public.tenants (
    "id", "nom", "slug", "description", "adresse", "ville", "pays",
    "email", "telephone", "site_web", "logo_url", "cover_url",
    "statut", "plan", "tier", "montant_mensuel",
    "limite_membres", "limite_espaces", "settings", "created_at", "updated_at"
) VALUES (
    'a3333333-3333-4333-8333-333333333333',
    'Thirty Three Space',
    'thirty-three-space',
    'Lieu collaboratif d''exception conçu pour le coworking quotidien, les ateliers et les sessions de formation professionnelles.',
    'Les Berges du Lac 2',
    'Tunis',
    'Tunisie',
    'contact@thirtythreespace.com',
    '+216 71 999 333',
    'https://thirtythreespace.com',
    'https://deskywork-jet.vercel.app/partners/thirtythree-logo.png',
    'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=1600&q=80',
    'actif',
    'enterprise',
    'A',
    220.00,
    999999,
    999999,
    '{"saas_pack":"premium","onboarding_completed":true,"limite_staff":10,"partenaire_officiel":true}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    adresse = EXCLUDED.adresse,
    ville = EXCLUDED.ville,
    email = EXCLUDED.email,
    telephone = EXCLUDED.telephone,
    logo_url = EXCLUDED.logo_url,
    cover_url = EXCLUDED.cover_url,
    statut = 'actif',
    plan = 'enterprise',
    tier = 'A',
    montant_mensuel = 220.00,
    limite_membres = 999999,
    limite_espaces = 999999,
    settings = '{"saas_pack":"premium","onboarding_completed":true,"limite_staff":10,"partenaire_officiel":true}'::jsonb,
    updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ORGANIZATIONS (SYNCHRONISÉES AVEC STATUT = 'valide')
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.organizations (
    id, type, nom, slug, email, telephone, adresse, ville, pays, description, statut, logo_url, cover_url, settings, created_at, updated_at
)
SELECT
    t.id,
    'coworking',
    t.nom,
    t.slug,
    COALESCE(t.email, 'contact@deskywork.tn'),
    t.telephone,
    COALESCE(t.adresse, 'Tunis, Tunisie'),
    COALESCE(t.ville, 'Tunis'),
    'Tunisie',
    t.description,
    'valide',
    t.logo_url,
    t.cover_url,
    '{"onboarding_completed": true}'::jsonb,
    NOW(),
    NOW()
FROM public.tenants t
WHERE t.id IN ('a1111111-1111-4111-8111-111111111111', 'a3333333-3333-4333-8333-333333333333')
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    slug = EXCLUDED.slug,
    email = EXCLUDED.email,
    telephone = EXCLUDED.telephone,
    adresse = EXCLUDED.adresse,
    ville = EXCLUDED.ville,
    description = EXCLUDED.description,
    statut = 'valide',
    logo_url = EXCLUDED.logo_url,
    cover_url = EXCLUDED.cover_url,
    settings = '{"onboarding_completed": true}'::jsonb,
    updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. ESPACES PRÉDÉFINIS : NERO COWORKING SPACE
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.espaces (
    "id", "nom", "type", "capacite", "tarif_horaire", "tarif_journalier", "tarif_mensuel",
    "description", "photo_url", "equipements", "actif", "created_at", "tenant_id"
) VALUES (
    'e1111111-1111-4111-8111-000000000001',
    'Open Space Nomade',
    'open_space',
    30,
    5.000,
    25.000,
    250.000,
    'Poste de travail flexible en open space lumineux avec ambiance propice à la concentration.',
    'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=900&q=80',
    ARRAY['Wi-Fi Fibre', 'Café & Thé inclus', 'Prises dédiées', 'Climatisation'],
    TRUE,
    NOW(),
    'a1111111-1111-4111-8111-111111111111'
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    type = EXCLUDED.type,
    capacite = EXCLUDED.capacite,
    tarif_horaire = EXCLUDED.tarif_horaire,
    tarif_journalier = EXCLUDED.tarif_journalier,
    tarif_mensuel = EXCLUDED.tarif_mensuel,
    description = EXCLUDED.description,
    photo_url = EXCLUDED.photo_url,
    equipements = EXCLUDED.equipements,
    actif = TRUE;

INSERT INTO public.espaces (
    "id", "nom", "type", "capacite", "tarif_horaire", "tarif_journalier", "tarif_mensuel",
    "description", "photo_url", "equipements", "actif", "created_at", "tenant_id"
) VALUES (
    'e1111111-1111-4111-8111-000000000002',
    'Bureau Privé 4 Personnes',
    'private_office',
    4,
    20.000,
    90.000,
    950.000,
    'Bureau fermé haut standing, idéal pour une équipe projet ou une startup.',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=80',
    ARRAY['Wi-Fi Fibre', 'Clé sécurisée', 'Écran de présentation', 'Tableau blanc', 'Climatisation'],
    TRUE,
    NOW(),
    'a1111111-1111-4111-8111-111111111111'
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    type = EXCLUDED.type,
    capacite = EXCLUDED.capacite,
    tarif_horaire = EXCLUDED.tarif_horaire,
    tarif_journalier = EXCLUDED.tarif_journalier,
    tarif_mensuel = EXCLUDED.tarif_mensuel,
    description = EXCLUDED.description,
    photo_url = EXCLUDED.photo_url,
    equipements = EXCLUDED.equipements,
    actif = TRUE;

INSERT INTO public.espaces (
    "id", "nom", "type", "capacite", "tarif_horaire", "tarif_journalier", "tarif_mensuel",
    "description", "photo_url", "equipements", "actif", "created_at", "tenant_id"
) VALUES (
    'e1111111-1111-4111-8111-000000000003',
    'Salle de Réunion Prestige',
    'meeting_room',
    12,
    30.000,
    150.000,
    0.000,
    'Salle de réunion moderne équipée pour vos présentations clients et comités de direction.',
    'https://images.unsplash.com/photo-1517502884422-41eaead166d4?auto=format&fit=crop&w=900&q=80',
    ARRAY['Visioconférence 4K', 'Grand écran TV', 'Tableau blanc interactif', 'Machine à café Nespresso'],
    TRUE,
    NOW(),
    'a1111111-1111-4111-8111-111111111111'
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    type = EXCLUDED.type,
    capacite = EXCLUDED.capacite,
    tarif_horaire = EXCLUDED.tarif_horaire,
    tarif_journalier = EXCLUDED.tarif_journalier,
    tarif_mensuel = EXCLUDED.tarif_mensuel,
    description = EXCLUDED.description,
    photo_url = EXCLUDED.photo_url,
    equipements = EXCLUDED.equipements,
    actif = TRUE;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ESPACES PRÉDÉFINIS : THIRTY THREE SPACE
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.espaces (
    "id", "nom", "type", "capacite", "tarif_horaire", "tarif_journalier", "tarif_mensuel",
    "description", "photo_url", "equipements", "actif", "created_at", "tenant_id"
) VALUES (
    'e3333333-3333-4333-8333-000000000001',
    'Espace Collaboratif Lac',
    'open_space',
    25,
    6.000,
    28.000,
    280.000,
    'Cadre d''exception au Lac 2 alliant design contemporain et productivité partagée.',
    'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=900&q=80',
    ARRAY['Wi-Fi Haute Performance', 'Espace Lounge & Détente', 'Boissons chaudes à volonté', 'Accès terrasse'],
    TRUE,
    NOW(),
    'a3333333-3333-4333-8333-333333333333'
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    type = EXCLUDED.type,
    capacite = EXCLUDED.capacite,
    tarif_horaire = EXCLUDED.tarif_horaire,
    tarif_journalier = EXCLUDED.tarif_journalier,
    tarif_mensuel = EXCLUDED.tarif_mensuel,
    description = EXCLUDED.description,
    photo_url = EXCLUDED.photo_url,
    equipements = EXCLUDED.equipements,
    actif = TRUE;

INSERT INTO public.espaces (
    "id", "nom", "type", "capacite", "tarif_horaire", "tarif_journalier", "tarif_mensuel",
    "description", "photo_url", "equipements", "actif", "created_at", "tenant_id"
) VALUES (
    'e3333333-3333-4333-8333-000000000002',
    'Salle de Formation & Workshop',
    'training_room',
    18,
    35.000,
    180.000,
    0.000,
    'Espace pédagogique polyvalent conçu pour les formateurs professionnels et ateliers pratiques.',
    'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=80',
    ARRAY['Vidéoprojecteur HD', 'Disposition modulable en U ou classe', 'Système audio & micros', 'Paperboard'],
    TRUE,
    NOW(),
    'a3333333-3333-4333-8333-333333333333'
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    type = EXCLUDED.type,
    capacite = EXCLUDED.capacite,
    tarif_horaire = EXCLUDED.tarif_horaire,
    tarif_journalier = EXCLUDED.tarif_journalier,
    tarif_mensuel = EXCLUDED.tarif_mensuel,
    description = EXCLUDED.description,
    photo_url = EXCLUDED.photo_url,
    equipements = EXCLUDED.equipements,
    actif = TRUE;

INSERT INTO public.espaces (
    "id", "nom", "type", "capacite", "tarif_horaire", "tarif_journalier", "tarif_mensuel",
    "description", "photo_url", "equipements", "actif", "created_at", "tenant_id"
) VALUES (
    'e3333333-3333-4333-8333-000000000003',
    'Espace Événementiel & Conférence',
    'event_space',
    50,
    70.000,
    350.000,
    0.000,
    'Grand espace privatisable pour vos meetups tech, lancements de produit et conférences d''entreprise.',
    'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80',
    ARRAY['Sonorisation complète', 'Micro sans fil', 'Scène & pupitre', 'Écran géant', 'Service traiteur possible'],
    TRUE,
    NOW(),
    'a3333333-3333-4333-8333-333333333333'
)
ON CONFLICT (id) DO UPDATE SET
    nom = EXCLUDED.nom,
    type = EXCLUDED.type,
    capacite = EXCLUDED.capacite,
    tarif_horaire = EXCLUDED.tarif_horaire,
    tarif_journalier = EXCLUDED.tarif_journalier,
    tarif_mensuel = EXCLUDED.tarif_mensuel,
    description = EXCLUDED.description,
    photo_url = EXCLUDED.photo_url,
    equipements = EXCLUDED.equipements,
    actif = TRUE;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. COMPTES UTILISATEURS PRÉDÉFINIS DANS AUTH.USERS (AVEC MOTS DE PASSE)
-- ─────────────────────────────────────────────────────────────────────────
-- Note : Si l'utilisateur existe déjà dans auth.users, on met à jour son mot de passe
-- et son profil. S'il n'existe pas, on l'insère directement dans auth.users.

DO $$
DECLARE
    nero_uid UUID := 'u1111111-1111-4111-8111-111111111111';
    thirty_uid UUID := 'u3333333-3333-4333-8333-333333333333';
    existing_nero_id UUID;
    existing_thirty_id UUID;
BEGIN
    -- 1. NERO COWORKING SPACE ADMIN (admin@nerocoworking.tn)
    SELECT id INTO existing_nero_id FROM auth.users WHERE LOWER(email) = 'admin@nerocoworking.tn';
    IF existing_nero_id IS NOT NULL THEN
        nero_uid := existing_nero_id;
        UPDATE auth.users
        SET encrypted_password = crypt('Nero@2026!Desky', gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            raw_user_meta_data = jsonb_build_object('prenom', 'Nero', 'nom', 'Admin', 'role', 'admin', 'telephone', '+216 71 888 999'),
            updated_at = NOW()
        WHERE id = nero_uid;
    ELSE
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
            nero_uid,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            'admin@nerocoworking.tn',
            crypt('Nero@2026!Desky', gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('prenom', 'Nero', 'nom', 'Admin', 'role', 'admin', 'telephone', '+216 71 888 999'),
            NOW(),
            NOW()
        );
    END IF;

    -- Profil Nero
    INSERT INTO public.profiles (
        id, email, nom, prenom, telephone, role, statut_compte,
        email_verifie, is_super_admin, tenant_id, langue
    ) VALUES (
        nero_uid,
        'admin@nerocoworking.tn',
        'Nero',
        'Admin',
        '+216 71 888 999',
        'admin',
        'actif',
        TRUE,
        FALSE,
        'a1111111-1111-4111-8111-111111111111',
        'fr'
    )
    ON CONFLICT (id) DO UPDATE SET
        role = 'admin',
        statut_compte = 'actif',
        email_verifie = TRUE,
        tenant_id = 'a1111111-1111-4111-8111-111111111111',
        updated_at = NOW();

    -- Membership Nero
    INSERT INTO public.memberships (user_id, organization_id, role, statut)
    VALUES (nero_uid, 'a1111111-1111-4111-8111-111111111111', 'admin', 'actif')
    ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'admin', statut = 'actif';


    -- 2. THIRTY THREE SPACE ADMIN (admin@thirtythreespace.com)
    SELECT id INTO existing_thirty_id FROM auth.users WHERE LOWER(email) = 'admin@thirtythreespace.com';
    IF existing_thirty_id IS NOT NULL THEN
        thirty_uid := existing_thirty_id;
        UPDATE auth.users
        SET encrypted_password = crypt('ThirtyThree@2026!Desky', gen_salt('bf')),
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            raw_user_meta_data = jsonb_build_object('prenom', 'Thirty Three', 'nom', 'Admin', 'role', 'admin', 'telephone', '+216 71 999 333'),
            updated_at = NOW()
        WHERE id = thirty_uid;
    ELSE
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) VALUES (
            thirty_uid,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            'admin@thirtythreespace.com',
            crypt('ThirtyThree@2026!Desky', gen_salt('bf')),
            NOW(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('prenom', 'Thirty Three', 'nom', 'Admin', 'role', 'admin', 'telephone', '+216 71 999 333'),
            NOW(),
            NOW()
        );
    END IF;

    -- Profil Thirty Three
    INSERT INTO public.profiles (
        id, email, nom, prenom, telephone, role, statut_compte,
        email_verifie, is_super_admin, tenant_id, langue
    ) VALUES (
        thirty_uid,
        'admin@thirtythreespace.com',
        'Thirty Three',
        'Admin',
        '+216 71 999 333',
        'admin',
        'actif',
        TRUE,
        FALSE,
        'a3333333-3333-4333-8333-333333333333',
        'fr'
    )
    ON CONFLICT (id) DO UPDATE SET
        role = 'admin',
        statut_compte = 'actif',
        email_verifie = TRUE,
        tenant_id = 'a3333333-3333-4333-8333-333333333333',
        updated_at = NOW();

    -- Membership Thirty Three
    INSERT INTO public.memberships (user_id, organization_id, role, statut)
    VALUES (thirty_uid, 'a3333333-3333-4333-8333-333333333333', 'admin', 'actif')
    ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'admin', statut = 'actif';

END $$;

NOTIFY pgrst, 'reload schema';


-- S4 Dev 1 — Messagerie temps réel (Module E)
-- À exécuter dans Supabase SQL Editor

-- Table conversations
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL DEFAULT 'Support 33S',
    type TEXT NOT NULL DEFAULT 'support' CHECK (type IN ('support', 'group', 'direct')),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table messages
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id),
    content TEXT NOT NULL,
    read_by UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages (sender_id);

-- Table conversation_members
CREATE TABLE IF NOT EXISTS public.conversation_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON public.conversation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON public.conversation_members (conversation_id);

-- RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conversations: members read" ON public.conversations;
CREATE POLICY "Conversations: members read" ON public.conversations
    FOR SELECT USING (
        id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Conversations: staff full" ON public.conversations;
CREATE POLICY "Conversations: staff full" ON public.conversations
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff'))
    );

DROP POLICY IF EXISTS "Messages: members read own conv" ON public.messages;
CREATE POLICY "Messages: members read own conv" ON public.messages
    FOR SELECT USING (
        conversation_id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Messages: members insert own conv" ON public.messages;
CREATE POLICY "Messages: members insert own conv" ON public.messages
    FOR INSERT WITH CHECK (
        sender_id = auth.uid()
        AND conversation_id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Messages: staff full" ON public.messages;
CREATE POLICY "Messages: staff full" ON public.messages
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff'))
    );

DROP POLICY IF EXISTS "Conv members: read own" ON public.conversation_members;
CREATE POLICY "Conv members: read own" ON public.conversation_members
    FOR SELECT USING (
        user_id = auth.uid()
        OR conversation_id IN (SELECT conversation_id FROM public.conversation_members WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Conv members: staff full" ON public.conversation_members;
CREATE POLICY "Conv members: staff full" ON public.conversation_members
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('super_admin', 'admin', 'staff'))
    );

-- Créer conversation support par défaut pour chaque membre existant
DO $$
DECLARE
    member RECORD;
    conv_id UUID;
BEGIN
    FOR member IN SELECT id FROM public.profiles WHERE role = 'member' LOOP
        INSERT INTO public.conversations (title, type, created_by)
        VALUES ('Support 33S', 'support', member.id)
        RETURNING id INTO conv_id;

        INSERT INTO public.conversation_members (conversation_id, user_id)
        VALUES (conv_id, member.id);
    END LOOP;
END $$;

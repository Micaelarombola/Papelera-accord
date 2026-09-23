
-- =====================================================
-- PAPELERA ACCORD
-- BASE DE DATOS ONLINE
-- =====================================================

-- Ejecutar en Supabase SQL Editor.
-- No colocar contraseñas en este archivo.


-- =====================================================
-- 1. ESQUEMA PRIVADO
-- =====================================================

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;

GRANT USAGE ON SCHEMA private TO authenticated;


-- =====================================================
-- 2. USUARIOS AUTORIZADOS
-- =====================================================

CREATE TABLE IF NOT EXISTS private.inventory_members (

    user_id UUID PRIMARY KEY
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    display_name TEXT NOT NULL DEFAULT ''

);

REVOKE ALL
ON private.inventory_members
FROM PUBLIC, anon, authenticated;


-- =====================================================
-- 3. VERIFICAR SI EL USUARIO ESTÁ AUTORIZADO
-- =====================================================

CREATE OR REPLACE FUNCTION private.inventory_allowed()

RETURNS BOOLEAN

LANGUAGE sql

STABLE

SECURITY DEFINER

SET search_path = ''

AS $$

    SELECT EXISTS (

        SELECT 1

        FROM private.inventory_members m

        WHERE m.user_id = (
            SELECT auth.uid()
        )

    );

$$;


REVOKE ALL
ON FUNCTION private.inventory_allowed()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION private.inventory_allowed()
TO authenticated;


-- =====================================================
-- 4. INVENTARIO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.inventory_documents (

    id UUID PRIMARY KEY,

    payload JSONB NOT NULL,

    revision INTEGER NOT NULL DEFAULT 0
        CHECK (revision >= 0),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    CONSTRAINT inventory_payload_shape CHECK (

        jsonb_typeof(payload) = 'object'

        AND jsonb_typeof(
            payload -> 'products'
        ) = 'array'

        AND jsonb_typeof(
            payload -> 'customers'
        ) = 'array'

        AND jsonb_typeof(
            payload -> 'movements'
        ) = 'array'

        AND jsonb_typeof(
            payload -> 'sales'
        ) = 'array'

    )

);


-- =====================================================
-- 5. CREAR INVENTARIO INICIAL VACÍO
-- =====================================================

INSERT INTO public.inventory_documents (

    id,

    payload,

    revision

)

VALUES (

    '00000000-0000-0000-0000-000000000001',

    '{
        "products": [],
        "customers": [],
        "movements": [],
        "sales": []
    }'::jsonb,

    0

)

ON CONFLICT (id) DO NOTHING;


-- =====================================================
-- 6. SEGURIDAD DE LA BASE DE DATOS
-- =====================================================

ALTER TABLE public.inventory_documents
ENABLE ROW LEVEL SECURITY;


REVOKE ALL
ON public.inventory_documents
FROM PUBLIC, anon, authenticated;


GRANT SELECT
ON public.inventory_documents
TO authenticated;


-- =====================================================
-- 7. PERMISO PARA LEER EL INVENTARIO
-- =====================================================

DROP POLICY IF EXISTS inventory_read
ON public.inventory_documents;


CREATE POLICY inventory_read

ON public.inventory_documents

FOR SELECT

TO authenticated

USING (

    (SELECT private.inventory_allowed())

);


-- =====================================================
-- 8. FUNCIÓN PARA GUARDAR CAMBIOS
-- =====================================================

-- Comprueba que el usuario está autorizado.
-- También evita sobrescribir una versión más reciente
-- del inventario cuando se usa otro dispositivo.

CREATE OR REPLACE FUNCTION public.commit_inventory(

    expected_revision INTEGER,

    new_payload JSONB

)

RETURNS INTEGER

LANGUAGE plpgsql

SECURITY DEFINER

SET search_path = ''

AS $$

DECLARE

    next_revision INTEGER;

BEGIN

    -- Verificar usuario autorizado

    IF NOT private.inventory_allowed() THEN

        RAISE EXCEPTION
            'Usuario no autorizado';

    END IF;


    -- Verificar datos recibidos

    IF expected_revision IS NULL
       OR new_payload IS NULL THEN

        RAISE EXCEPTION
            'Se requiere revisión y contenido';

    END IF;


    -- Guardar únicamente si la versión coincide

    UPDATE public.inventory_documents

    SET

        payload = new_payload,

        revision = revision + 1,

        updated_at = NOW()

    WHERE

        id =
        '00000000-0000-0000-0000-000000000001'::UUID

        AND revision = expected_revision

    RETURNING revision
    INTO next_revision;


    RETURN next_revision;

END;

$$;


REVOKE ALL
ON FUNCTION public.commit_inventory(INTEGER, JSONB)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.commit_inventory(INTEGER, JSONB)
TO authenticated;


-- =====================================================
-- 9. AUTORIZAR A LAS DOS PERSONAS
-- =====================================================

-- IMPORTANTE:
--
-- Primero creá las dos cuentas desde:
--
-- Supabase > Authentication > Users
--
-- Después copiá el UUID de cada cuenta.
--
-- Reemplazá los UUID de ejemplo y ejecutá
-- SOLAMENTE el INSERT siguiente, quitando los --.
--
-- INSERT INTO private.inventory_members (
--
--     user_id,
--     display_name
--
-- )
--
-- VALUES
--
-- (
--     'UUID_DE_TU_CUENTA',
--     'Webmic administradora'
-- ),
--
-- (
--     'UUID_DE_TU_CLIENTA',
--     'Clienta Papelera Accord'
-- )
--
-- ON CONFLICT (user_id)
--
-- DO UPDATE SET
--
--     display_name = EXCLUDED.display_name;


-- =====================================================
-- 10. QUITAR EL ACCESO A UNA PERSONA
-- =====================================================

-- Si alguna vez necesitás quitar un acceso:
--
-- DELETE FROM private.inventory_members
-- WHERE user_id = 'UUID_DE_LA_CUENTA';

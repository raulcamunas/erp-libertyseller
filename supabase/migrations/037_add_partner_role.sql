-- =====================================================
-- AÑADIR ROL "PARTNER" AL ENUM user_role
-- =====================================================

-- Añadir 'partner' al enum user_role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'partner';


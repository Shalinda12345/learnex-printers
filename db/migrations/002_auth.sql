-- =====================================================================
-- Authentication & authorization
--
--   auth_users ──< auth_user_roles >── auth_roles ──< auth_role_permissions
--        └──< auth_sessions
--   audit_log  (who did what, when)
--
-- Permissions are capability keys defined in code (lib/auth/permissions.ts),
-- e.g. "pos.use", "inventory.manage", "data.reset". Roles are data: new roles
-- can be created and edited in the app without code changes. A user can hold
-- several roles; their permissions are the union. The "owner" role always has
-- every permission, including ones added in future versions.
-- Default roles are created with the first owner account (see setup).
-- =====================================================================

CREATE TABLE auth_users (
  id                   bigserial PRIMARY KEY,
  username             text NOT NULL,
  name                 text NOT NULL,
  email                text,
  password_hash        text NOT NULL,          -- "scrypt$N$r$p$salt$hash"
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT false,
  failed_login_count   integer NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_by           bigint REFERENCES auth_users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_users_username_key ON auth_users (lower(username));
CREATE UNIQUE INDEX auth_users_email_key ON auth_users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE auth_roles (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL UNIQUE,            -- stable identifier ("owner", "sales", custom-...)
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system   boolean NOT NULL DEFAULT false,  -- system roles can't be edited or deleted
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX auth_roles_name_key ON auth_roles (lower(name));

CREATE TABLE auth_role_permissions (
  role_id    bigint NOT NULL REFERENCES auth_roles (id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE auth_user_roles (
  user_id    bigint NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  role_id    bigint NOT NULL REFERENCES auth_roles (id) ON DELETE RESTRICT,
  granted_by bigint REFERENCES auth_users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX auth_user_roles_role_idx ON auth_user_roles (role_id);

-- The cookie holds a random token; only its SHA-256 is stored here, so a
-- leaked database copy can't be used to log in.
CREATE TABLE auth_sessions (
  id                  text PRIMARY KEY,        -- sha256(token), hex
  user_id             bigint NOT NULL REFERENCES auth_users (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,    -- idle timeout, slides with use
  absolute_expires_at timestamptz NOT NULL,    -- hard limit, never extended
  user_agent          text
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);

CREATE TABLE audit_log (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  user_id  bigint REFERENCES auth_users (id) ON DELETE SET NULL,
  username text,                               -- kept even if the user is deleted later
  action   text NOT NULL,                      -- auth.login, user.create, data.save, ...
  target   text,
  details  jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);
CREATE INDEX audit_log_action_idx ON audit_log (action);

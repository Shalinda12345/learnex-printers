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
-- Text lengths match the limits checked in lib/server/auth/*.
-- =====================================================================

CREATE TABLE IF NOT EXISTS auth_users (
  id                   bigint       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username             varchar(64)  NOT NULL,
  name                 varchar(100) NOT NULL,
  email                varchar(254),
  password_hash        varchar(255) NOT NULL,           -- "scrypt$N$r$p$salt$hash"
  status               varchar(16)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean      NOT NULL DEFAULT false,
  failed_login_count   int          NOT NULL DEFAULT 0,
  locked_until         datetime(6),
  last_login_at        datetime(6),
  password_changed_at  datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_by           bigint,
  created_at           datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at           datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- Usernames and emails are unique regardless of upper/lower case.
  -- (Several accounts may have no email: NULLs don't clash.)
  username_key         varchar(64)  GENERATED ALWAYS AS (lower(username)) STORED,
  email_key            varchar(254) GENERATED ALWAYS AS (lower(email)) STORED,
  UNIQUE KEY auth_users_username_key (username_key),
  UNIQUE KEY auth_users_email_key (email_key),
  CONSTRAINT auth_users_created_by_fk FOREIGN KEY (created_by) REFERENCES auth_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS auth_roles (
  id          bigint       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `key`       varchar(64)  NOT NULL,                    -- stable identifier ("owner", "sales", custom-...)
  name        varchar(60)  NOT NULL,
  description varchar(300) NOT NULL DEFAULT '',
  is_system   boolean      NOT NULL DEFAULT false,      -- system roles can't be edited or deleted
  created_at  datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  name_key    varchar(60)  GENERATED ALWAYS AS (lower(name)) STORED,
  UNIQUE KEY auth_roles_key_key (`key`),
  UNIQUE KEY auth_roles_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS auth_role_permissions (
  role_id    bigint      NOT NULL,
  permission varchar(64) NOT NULL,
  PRIMARY KEY (role_id, permission),
  CONSTRAINT auth_role_permissions_role_fk FOREIGN KEY (role_id) REFERENCES auth_roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id    bigint      NOT NULL,
  role_id    bigint      NOT NULL,
  granted_by bigint,
  granted_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id, role_id),
  KEY auth_user_roles_role_idx (role_id),
  CONSTRAINT auth_user_roles_user_fk FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE CASCADE,
  CONSTRAINT auth_user_roles_role_fk FOREIGN KEY (role_id) REFERENCES auth_roles (id) ON DELETE RESTRICT,
  CONSTRAINT auth_user_roles_granted_by_fk FOREIGN KEY (granted_by) REFERENCES auth_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- The cookie holds a random token; only its SHA-256 is stored here, so a
-- leaked database copy can't be used to log in.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                  varchar(64)  NOT NULL PRIMARY KEY, -- sha256(token), hex
  user_id             bigint       NOT NULL,
  created_at          datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at        datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at          datetime(6)  NOT NULL,             -- idle timeout, slides with use
  absolute_expires_at datetime(6)  NOT NULL,             -- hard limit, never extended
  user_agent          varchar(300),
  KEY auth_sessions_user_idx (user_id),
  KEY auth_sessions_expires_idx (expires_at),
  CONSTRAINT auth_sessions_user_fk FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS audit_log (
  id       bigint      NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at       datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  user_id  bigint,
  username varchar(64),                                 -- kept even if the user is deleted later
  action   varchar(64) NOT NULL,                        -- auth.login, user.create, data.save, ...
  target   text,
  details  json        NOT NULL DEFAULT ('{}'),
  KEY audit_log_at_idx (at),
  KEY audit_log_user_idx (user_id),
  KEY audit_log_action_idx (action),
  CONSTRAINT audit_log_user_fk FOREIGN KEY (user_id) REFERENCES auth_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

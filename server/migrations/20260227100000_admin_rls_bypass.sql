-- Admin bypass for connection_metrics and connection_sessions RLS.
-- Command Center needs cluster-wide aggregate access.
--
-- TRUST BOUNDARY: These policies rely on the application layer to set
-- `app.admin_bypass = 'true'` only for verified admin sessions (via
-- `set_admin_bypass()` in db/mod.rs). Direct database connections do NOT
-- have this setting enabled, so the bypass is inactive by default.
-- The `current_setting(..., true)` call returns NULL (not 'true') when
-- the variable is unset, keeping the policy restrictive.
CREATE POLICY admin_all_metrics ON connection_metrics
    FOR SELECT USING (current_setting('app.admin_bypass', true) = 'true');

CREATE POLICY admin_all_sessions ON connection_sessions
    FOR SELECT USING (current_setting('app.admin_bypass', true) = 'true');

-- Admin bypass for connection_metrics and connection_sessions RLS.
-- Command Center needs cluster-wide aggregate access.
CREATE POLICY admin_all_metrics ON connection_metrics
    FOR SELECT USING (current_setting('app.admin_bypass', true) = 'true');

CREATE POLICY admin_all_sessions ON connection_sessions
    FOR SELECT USING (current_setting('app.admin_bypass', true) = 'true');

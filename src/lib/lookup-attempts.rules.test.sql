-- © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
-- Rollback-only database regression tests; no fixture rows are retained.
BEGIN;
INSERT INTO public.locker_lookup_attempts(ip_address,locker_number,success,attempted_at,entered_badge,failure_reason)
VALUES ('198.51.100.201','TEST-A',false,now()-interval '59 minutes','A','badge_mismatch'),
('198.51.100.201','TEST-A',false,now()-interval '30 minutes','A','badge_mismatch');
DO $$ BEGIN IF public.lookup_ip_needs_review('198.51.100.201',now()) THEN RAISE EXCEPTION 'Two failures must not flag'; END IF; END $$;
INSERT INTO public.locker_lookup_attempts(ip_address,locker_number,success,attempted_at) VALUES ('198.51.100.201','TEST-A',false,now());
DO $$ BEGIN IF NOT public.lookup_ip_needs_review('198.51.100.201',now()) THEN RAISE EXCEPTION 'Three failures within one hour must flag'; END IF; IF public.lookup_ip_needs_review('198.51.100.201',now()+interval '61 minutes') THEN RAISE EXCEPTION 'Failures outside one hour must not flag'; END IF; END $$;
INSERT INTO public.locker_lookup_attempts(ip_address,locker_number,success,attempted_at) SELECT '198.51.100.202','TEST-'||i,true,now() FROM generate_series(1,4)i;
DO $$ BEGIN IF public.lookup_ip_needs_review('198.51.100.202',now()) THEN RAISE EXCEPTION 'Four distinct lockers must not flag'; END IF; END $$;
INSERT INTO public.locker_lookup_attempts(ip_address,locker_number,success,attempted_at) VALUES ('198.51.100.202','TEST-5',true,now());
DO $$ BEGIN IF NOT public.lookup_ip_needs_review('198.51.100.202',now()) THEN RAISE EXCEPTION 'Five distinct lockers within one hour must flag'; END IF; END $$;
INSERT INTO public.locker_lookup_attempts(ip_address,success,attempted_at) VALUES ('198.51.100.203',false,now()-interval '91 days'),('198.51.100.203',false,now()-interval '89 days');
DELETE FROM public.locker_lookup_attempts WHERE attempted_at < now()-interval '90 days';
DO $$ BEGIN IF (SELECT count(*) FROM public.locker_lookup_attempts WHERE ip_address='198.51.100.203')<>1 THEN RAISE EXCEPTION '90-day retention must delete only old logs'; END IF; END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.locker_lookup_attempts) THEN RAISE EXCEPTION 'Non-admin must not read logs'; END IF;
 BEGIN PERFORM public.search_lookup_attempts(); RAISE EXCEPTION 'Non-admin RPC must reject'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN IF has_table_privilege('anon','public.locker_lookup_attempts','SELECT') OR has_function_privilege('anon','public.search_lookup_attempts(text,text,timestamptz,timestamptz,integer)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous access forbidden'; END IF; END $$;
ROLLBACK;

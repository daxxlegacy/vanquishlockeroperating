-- © 2026 Farid Asnawi. All rights reserved. Proprietary. See LICENSE.
-- One concrete check per approved range; every failed_rules value must be zero.
WITH rules(lo,hi,destination,expected) AS (VALUES
 (1,411,'Location C',1548),(412,915,'Location B',1278),
 (916,1466,'Location A',2316),(1467,1476,'Location B',60),
 (1477,1508,'Old HR Office',192),(1509,1514,'Walkway Security',36),
 (1515,1515,'Walkway ToCan',6),(6001,6018,'Walkway ToCan',108),
 (6055,6072,'Location A',108),(6073,6075,'Location B',18)
), checks AS (
 SELECT r.*,count(l.id) AS actual,
 count(l.id) FILTER (WHERE l.location IS DISTINCT FROM r.destination) AS wrong_destination
 FROM rules r LEFT JOIN public.lockers l ON l.deleted_at IS NULL
 AND CASE WHEN l.locker_number ~ '^[0-9]+[A-Z]+$'
 THEN substring(l.locker_number from '^[0-9]+')::integer END BETWEEN r.lo AND r.hi
 GROUP BY r.lo,r.hi,r.destination,r.expected
)
SELECT lo,hi,destination,expected,actual,wrong_destination,
 CASE WHEN actual=expected AND wrong_destination=0 THEN 0 ELSE 1 END AS failed_rules
FROM checks ORDER BY lo;
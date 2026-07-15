DO $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = '0012 is not SQL-reversible: retired helpers depend on the old database',
    HINT = 'Stop Counselle and restore the pre-cutover DSNs/old database per the db-rewire rollback runbook.';
END
$$;

-- Creates the e2e test database alongside the dev database.
-- Mounted as /docker-entrypoint-initdb.d/init-test-db.sql so it runs on first container start.

SELECT 'CREATE DATABASE tironet_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tironet_test')\gexec

\c tironet_test
CREATE PUBLICATION powersync FOR ALL TABLES;

import { column, Schema, Table } from "@powersync/web";

// Local SQLite schema mirroring the synced subset of the PostgreSQL schema.
// Booleans are stored as integers (0/1); dates as ISO text strings.

const cycles = new Table({
  name: column.text,
  is_active: column.integer,
  sort_order: column.integer,
});

const companies = new Table({
  cycle_id: column.text,
  name: column.text,
  sort_order: column.integer,
});

const platoons = new Table({
  company_id: column.text,
  name: column.text,
  sort_order: column.integer,
});

const squads = new Table({
  platoon_id: column.text,
  name: column.text,
  sort_order: column.integer,
});

const activity_types = new Table({
  name: column.text,
  icon: column.text,
  is_active: column.integer,
  sort_order: column.integer,
});

const soldiers = new Table({
  cycle_id: column.text,
  squad_id: column.text,
  given_name: column.text,
  family_name: column.text,
  rank: column.text,
  status: column.text,
  profile_image: column.text,
});

const activities = new Table({
  platoon_id: column.text,
  cycle_id: column.text,
  activity_type_id: column.text,
  name: column.text,
  date: column.text,
  is_required: column.integer,
  status: column.text,
});

const activity_reports = new Table({
  activity_id: column.text,
  soldier_id: column.text,
  result: column.text,
  grade: column.real,
  note: column.text,
});

export const AppSchema = new Schema({
  cycles,
  companies,
  platoons,
  squads,
  activity_types,
  soldiers,
  activities,
  activity_reports,
});

export type Database = (typeof AppSchema)["types"];

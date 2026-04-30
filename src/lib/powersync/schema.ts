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
  logo: column.text,
  sort_order: column.integer,
});

const platoons = new Table({
  company_id: column.text,
  name: column.text,
  logo: column.text,
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
  score_config: column.text,
  display_configuration: column.text,
});

const soldiers = new Table({
  cycle_id: column.text,
  squad_id: column.text,
  given_name: column.text,
  family_name: column.text,
  id_number: column.text,
  civilian_id: column.text,
  rank: column.text,
  status: column.text,
  profile_image: column.text,
  phone: column.text,
  emergency_phone: column.text,
  street: column.text,
  apt: column.text,
  city: column.text,
  notes: column.text,
  date_of_birth: column.text,
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
  failed: column.integer,
  grade1: column.real,
  grade2: column.real,
  grade3: column.real,
  grade4: column.real,
  grade5: column.real,
  grade6: column.real,
  note: column.text,
});

const requests = new Table({
  cycle_id: column.text,
  soldier_id: column.text,
  type: column.text,
  status: column.text,
  assigned_role: column.text,
  created_by_user_id: column.text,
  description: column.text,
  // Leave fields
  place: column.text,
  departure_at: column.text,
  return_at: column.text,
  transportation: column.text,
  // Medical fields
  urgent: column.integer,
  paramedic_date: column.text,
  medical_appointments: column.text,
  sick_days: column.text,
  // Hardship fields
  special_conditions: column.integer,
  created_at: column.text,
  updated_at: column.text,
});

const request_actions = new Table({
  request_id: column.text,
  user_id: column.text,
  action: column.text,
  note: column.text,
  user_name: column.text,
  created_at: column.text,
});

const commander_events = new Table({
  cycle_id: column.text,
  user_id: column.text,
  user_name: column.text,
  platoon_id: column.text,
  type: column.text,
  description: column.text,
  start_date: column.text,
  end_date: column.text,
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
  requests,
  request_actions,
  commander_events,
});

export type Database = (typeof AppSchema)["types"];

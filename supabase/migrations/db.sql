-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.activity_logs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  action text,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamp without time zone DEFAULT now(),
  ip_address text,
  user_agent text,
  status text,
  error_message text,
  CONSTRAINT activity_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.allowed_networks (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  ip_address text,
  label text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT allowed_networks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.approval_history (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  request_id uuid NOT NULL,
  approver_id uuid,
  decision USER-DEFINED NOT NULL,
  level integer DEFAULT 1,
  comments text,
  decided_at timestamp without time zone DEFAULT now(),
  CONSTRAINT approval_history_pkey PRIMARY KEY (id),
  CONSTRAINT approval_history_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.supply_requests(id),
  CONSTRAINT approval_history_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id)
);
CREATE TABLE public.approval_workflows (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  category_id uuid,
  min_amount numeric DEFAULT 0,
  max_amount numeric,
  approver_user_id uuid,
  approver_role text,
  level integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT approval_workflows_pkey PRIMARY KEY (id),
  CONSTRAINT approval_workflows_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.supply_categories(id),
  CONSTRAINT approval_workflows_approver_user_id_fkey FOREIGN KEY (approver_user_id) REFERENCES public.users(id)
);
CREATE TABLE public.attachments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  file_url text,
  file_name text,
  file_size bigint,
  uploaded_by uuid,
  task_id uuid,
  comment_id uuid,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT attachments_pkey PRIMARY KEY (id),
  CONSTRAINT attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id),
  CONSTRAINT attachments_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id)
);
CREATE TABLE public.attendance_logs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  status text CHECK (status = ANY (ARRAY['present'::text, 'late'::text, 'absent'::text])),
  check_in_time timestamp without time zone,
  check_out_time timestamp without time zone,
  date date NOT NULL,
  ip_address text,
  latitude numeric,
  longitude numeric,
  device_info text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT attendance_logs_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  task_id uuid,
  user_id uuid,
  content text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  team_id uuid,
  CONSTRAINT comments_pkey PRIMARY KEY (id),
  CONSTRAINT comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id)
);
CREATE TABLE public.email_queue (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  to_email text NOT NULL,
  to_name text,
  cc_emails ARRAY,
  bcc_emails ARRAY,
  subject text NOT NULL,
  template_key text NOT NULL,
  template_data jsonb DEFAULT '{}'::jsonb,
  status USER-DEFINED DEFAULT 'queued'::email_status,
  send_after timestamp without time zone DEFAULT now(),
  sent_at timestamp without time zone,
  failed_at timestamp without time zone,
  retry_count integer DEFAULT 0,
  error_message text,
  reference_id uuid,
  reference_type text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT email_queue_pkey PRIMARY KEY (id)
);
CREATE TABLE public.email_templates (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  variables ARRAY,
  is_active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT email_templates_pkey PRIMARY KEY (id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  title text,
  message text,
  is_read boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
CREATE TABLE public.permissions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text UNIQUE,
  CONSTRAINT permissions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  team_id uuid,
  name text NOT NULL,
  description text,
  status text DEFAULT 'active'::text,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  deleted_at timestamp without time zone,
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);
CREATE TABLE public.purchase_orders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  po_number text UNIQUE,
  request_id uuid,
  supplier_id uuid,
  raised_by uuid,
  supply_id uuid,
  quantity integer NOT NULL,
  unit_price numeric NOT NULL,
  total_amount numeric DEFAULT ((quantity)::numeric * unit_price),
  tax_amount numeric DEFAULT 0,
  grand_total numeric,
  notes text,
  expected_delivery_date date,
  status text DEFAULT 'draft'::text CHECK (status = ANY (ARRAY['draft'::text, 'sent'::text, 'acknowledged'::text, 'fulfilled'::text, 'cancelled'::text])),
  sent_at timestamp without time zone,
  acknowledged_at timestamp without time zone,
  fulfilled_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT purchase_orders_pkey PRIMARY KEY (id),
  CONSTRAINT purchase_orders_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.supply_requests(id),
  CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id),
  CONSTRAINT purchase_orders_raised_by_fkey FOREIGN KEY (raised_by) REFERENCES public.users(id),
  CONSTRAINT purchase_orders_supply_id_fkey FOREIGN KEY (supply_id) REFERENCES public.supplies(id)
);
CREATE TABLE public.recurring_tasks (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  task_id uuid,
  frequency text,
  next_run timestamp without time zone,
  CONSTRAINT recurring_tasks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.reports_cache (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  type text,
  data jsonb,
  generated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT reports_cache_pkey PRIMARY KEY (id)
);
CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id),
  CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id)
);
CREATE TABLE public.roles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text UNIQUE,
  CONSTRAINT roles_pkey PRIMARY KEY (id)
);
CREATE TABLE public.stock_transactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  supply_id uuid NOT NULL,
  transaction_type USER-DEFINED NOT NULL,
  quantity integer NOT NULL,
  stock_before integer NOT NULL,
  stock_after integer NOT NULL,
  unit_cost numeric,
  reference_id uuid,
  reference_type text,
  notes text,
  performed_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT stock_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT stock_transactions_supply_id_fkey FOREIGN KEY (supply_id) REFERENCES public.supplies(id),
  CONSTRAINT stock_transactions_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id)
);
CREATE TABLE public.suppliers (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  address text,
  website text,
  account_number text,
  bank_name text,
  notes text,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT suppliers_pkey PRIMARY KEY (id),
  CONSTRAINT suppliers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.supplies (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  sku text UNIQUE,
  category_id uuid,
  supplier_id uuid,
  unit text NOT NULL DEFAULT 'Piece'::text,
  unit_price numeric NOT NULL DEFAULT 0,
  current_stock integer NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  max_stock integer DEFAULT 100,
  reorder_level integer DEFAULT 10,
  storage_location text,
  icon text DEFAULT 'mdi-package-variant'::text,
  image_url text,
  is_active boolean DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  deleted_at timestamp without time zone,
  CONSTRAINT supplies_pkey PRIMARY KEY (id),
  CONSTRAINT supplies_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.supply_categories(id),
  CONSTRAINT supplies_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id),
  CONSTRAINT supplies_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.supply_attachments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  request_id uuid,
  payment_id uuid,
  delivery_id uuid,
  file_url text NOT NULL,
  file_name text,
  file_size bigint,
  uploaded_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT supply_attachments_pkey PRIMARY KEY (id),
  CONSTRAINT supply_attachments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.supply_requests(id),
  CONSTRAINT supply_attachments_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.supply_payments(id),
  CONSTRAINT supply_attachments_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.supply_deliveries(id),
  CONSTRAINT supply_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id)
);
CREATE TABLE public.supply_categories (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  description text,
  color text DEFAULT '#0f4c81'::text,
  icon text DEFAULT 'mdi-package-variant'::text,
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT supply_categories_pkey PRIMARY KEY (id),
  CONSTRAINT supply_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE public.supply_deliveries (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  purchase_order_id uuid,
  request_id uuid,
  delivery_status USER-DEFINED DEFAULT 'not_shipped'::delivery_status,
  tracking_number text,
  courier text,
  shipped_date date,
  expected_date date,
  actual_delivery_date date,
  quantity_ordered integer,
  quantity_received integer,
  quantity_damaged integer DEFAULT 0,
  received_by uuid,
  delivery_address text,
  delivery_notes text,
  proof_of_delivery_url text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT supply_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT supply_deliveries_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id),
  CONSTRAINT supply_deliveries_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.supply_requests(id),
  CONSTRAINT supply_deliveries_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(id)
);
CREATE TABLE public.supply_payments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  purchase_order_id uuid,
  request_id uuid,
  payment_status USER-DEFINED DEFAULT 'unpaid'::payment_status,
  amount_due numeric NOT NULL CHECK (amount_due > 0::numeric),
  amount_paid numeric DEFAULT 0,
  balance numeric DEFAULT (amount_due - amount_paid),
  currency text DEFAULT 'NGN'::text,
  payment_method text,
  payment_reference text,
  payment_date date,
  paid_by uuid,
  approved_by uuid,
  receipt_url text,
  notes text,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT supply_payments_pkey PRIMARY KEY (id),
  CONSTRAINT supply_payments_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id),
  CONSTRAINT supply_payments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.supply_requests(id),
  CONSTRAINT supply_payments_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(id),
  CONSTRAINT supply_payments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id)
);
CREATE TABLE public.supply_request_comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  request_id uuid NOT NULL,
  user_id uuid,
  content text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT supply_request_comments_pkey PRIMARY KEY (id),
  CONSTRAINT supply_request_comments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.supply_requests(id),
  CONSTRAINT supply_request_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.supply_requests (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  request_number text UNIQUE,
  requester_id uuid NOT NULL,
  team_id uuid,
  supply_id uuid NOT NULL,
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_approved integer,
  unit_price_at_request numeric NOT NULL,
  estimated_total numeric DEFAULT ((quantity_requested)::numeric * unit_price_at_request),
  approved_total numeric,
  priority USER-DEFINED DEFAULT 'normal'::supply_request_priority,
  status USER-DEFINED DEFAULT 'pending_approval'::supply_request_status,
  needed_by_date date,
  reason text,
  rejection_reason text,
  current_approver_id uuid,
  workflow_id uuid,
  current_level integer DEFAULT 1,
  submitted_at timestamp without time zone DEFAULT now(),
  approved_at timestamp without time zone,
  rejected_at timestamp without time zone,
  cancelled_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  deleted_at timestamp without time zone,
  CONSTRAINT supply_requests_pkey PRIMARY KEY (id),
  CONSTRAINT supply_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES public.users(id),
  CONSTRAINT supply_requests_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT supply_requests_supply_id_fkey FOREIGN KEY (supply_id) REFERENCES public.supplies(id),
  CONSTRAINT supply_requests_current_approver_id_fkey FOREIGN KEY (current_approver_id) REFERENCES public.users(id),
  CONSTRAINT supply_requests_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES public.approval_workflows(id)
);
CREATE TABLE public.task_assignees (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  task_id uuid,
  user_id uuid,
  CONSTRAINT task_assignees_pkey PRIMARY KEY (id),
  CONSTRAINT task_assignees_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id)
);
CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  project_id uuid,
  title text NOT NULL,
  description text,
  status USER-DEFINED DEFAULT 'todo'::task_status,
  priority USER-DEFINED DEFAULT 'medium'::task_priority,
  start_date date,
  due_date date,
  created_by uuid,
  created_at timestamp without time zone DEFAULT now(),
  assigned_count integer DEFAULT 0,
  completed_at timestamp without time zone,
  deleted_at timestamp without time zone,
  team_id uuid,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.team_members (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  team_id uuid,
  user_id uuid,
  role USER-DEFINED DEFAULT 'member'::user_role,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT team_members_pkey PRIMARY KEY (id),
  CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);
CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,
  owner_id uuid,
  created_at timestamp without time zone DEFAULT now(),
  description text,
  CONSTRAINT teams_pkey PRIMARY KEY (id)
);
CREATE TABLE public.time_logs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  task_id uuid,
  start_time timestamp without time zone,
  end_time timestamp without time zone,
  duration integer,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT time_logs_pkey PRIMARY KEY (id),
  CONSTRAINT time_logs_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id)
);
CREATE TABLE public.user_devices (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  device_name text,
  device_fingerprint text,
  last_used_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT user_devices_pkey PRIMARY KEY (id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  auth_user_id uuid UNIQUE,
  email text NOT NULL,
  first_name text,
  last_name text,
  avatar_url text,
  created_at timestamp without time zone DEFAULT now(),
  deleted_at timestamp without time zone,
  team_id uuid,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);
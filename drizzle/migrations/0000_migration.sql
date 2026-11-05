CREATE TABLE public.saved_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  link_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_batches_device_idx ON public.saved_batches (device_key, created_at DESC);
GRANT ALL ON public.saved_batches TO service_role;
ALTER TABLE public.saved_batches ENABLE ROW LEVEL SECURITY;
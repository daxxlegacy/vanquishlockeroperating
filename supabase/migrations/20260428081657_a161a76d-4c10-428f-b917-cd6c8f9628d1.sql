-- Roles enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'viewer');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer to check role without RLS recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- Lockers main table
CREATE TYPE public.locker_status AS ENUM ('active', 'empty', 'repair', 'unknown');
CREATE TYPE public.key_status AS ENUM ('available', 'missing', 'with_employee', 'damaged', 'unknown');

CREATE TABLE public.lockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locker_number TEXT NOT NULL UNIQUE,
  unit_type TEXT,
  key_lock TEXT,
  location TEXT NOT NULL,
  row_label TEXT,
  badge_number TEXT,
  employee_name TEXT,
  status locker_status NOT NULL DEFAULT 'empty',
  physical_key_status key_status DEFAULT 'unknown',
  spare_key_status key_status DEFAULT 'unknown',
  remark TEXT,
  batch_intake TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lockers_location ON public.lockers(location);
CREATE INDEX idx_lockers_status ON public.lockers(status);
CREATE INDEX idx_lockers_badge ON public.lockers(badge_number);

ALTER TABLE public.lockers ENABLE ROW LEVEL SECURITY;

-- Upload history
CREATE TABLE public.upload_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID REFERENCES auth.users(id),
  filename TEXT,
  rows_processed INTEGER,
  resigned_count INTEGER,
  active_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Profiles viewable by self" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Profiles updatable by self" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Profiles insert self" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Roles viewable by self or admin" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read lockers" ON public.lockers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert lockers" ON public.lockers
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update lockers" ON public.lockers
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete lockers" ON public.lockers
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read upload history" ON public.upload_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert upload history" ON public.upload_history
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER lockers_updated_at BEFORE UPDATE ON public.lockers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile + assign first user as admin on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  user_count INTEGER;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
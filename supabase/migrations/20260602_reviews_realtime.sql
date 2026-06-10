-- Publish reviews for realtime so member ratings/reviews update live everywhere.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'reviews')
     and not exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews')
  then
    alter publication supabase_realtime add table public.reviews;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'reviews')
  then
    alter table public.reviews replica identity full;
  end if;
end $$;

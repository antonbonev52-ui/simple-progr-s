-- My Fitness Log: lets each user delete their OWN account from inside the app
-- (required by GDPR). Run once in Supabase → SQL Editor → New query → Run.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not logged in';
  end if;
  delete from public.user_data where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

-- only logged-in users may call it, and it only ever deletes the caller
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

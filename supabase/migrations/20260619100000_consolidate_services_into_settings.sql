-- Consolidate Service-Statuses configuration under `settings.manage`.
--
-- The services.view/services.edit permissions only ever gated the Service
-- Statuses settings page (nothing operational). Folding them into
-- `settings.manage` gives one clear "manage lab configuration" permission and
-- removes the misleading `services.*` pair.

-- 1) Preserve capability: any role that could edit service statuses
--    (services.edit) keeps managing lab config → grant settings.manage.
--    (Side effect: such a role also gains Work Stages, the other lab-config
--    section. Acceptable — both are lab-manager tasks.)
insert into public.role_permissions (role_id, permission)
select distinct rp.role_id, 'settings.manage'
from public.role_permissions rp
where rp.permission = 'services.edit'
on conflict do nothing;

-- 2) Retire the services.* permissions from every role.
delete from public.role_permissions where permission in ('services.view', 'services.edit');

-- 3) Repoint the service_statuses write policy from services.edit to settings.manage.
drop policy if exists service_statuses_write on public.service_statuses;
create policy service_statuses_write on public.service_statuses for all to authenticated
  using (public.auth_has_permission('settings.manage'))
  with check (public.auth_has_permission('settings.manage'));

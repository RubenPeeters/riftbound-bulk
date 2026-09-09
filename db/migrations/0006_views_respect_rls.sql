-- Make the derived views enforce row-level security.
--
-- A PostgreSQL view executes with the privileges of its OWNER unless security_invoker is
-- set, and these were created by the owner role, which bypasses RLS. So `holding`,
-- `copy_location` and `outstanding_loan` were reading transfer_event with RLS switched
-- off, for anyone holding SELECT on the view.
--
-- In practice nothing leaked yet: every application query filters on me(), which is null
-- for a caller who is not an approved member, so the rows came back empty anyway. But the
-- protection was the query's, not the database's, and the next query written without a
-- me() filter would have exposed every holding in the group to a pending account. Group
-- ownership is exactly such a query.
--
-- With security_invoker the views apply the caller's policies: an approved member sees
-- everything, as member_read intends, and a pending or suspended one sees nothing.

alter view holding          set (security_invoker = true);
alter view copy_location    set (security_invoker = true);
alter view outstanding_loan set (security_invoker = true);

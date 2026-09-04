import { useState } from 'react';
import { useCreateUser, useLocations, useUpdateUser, useUsers } from '../hooks/useData';
import { DataTable } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { Select, TextInput } from '../components/fields';
import { EmptyState, ErrorState, LoadingRows } from '../components/states';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { USER_ROLES, label } from '../lib/constants';
import { useAuth } from '../auth/AuthContext';

function UserFormDialog({ onClose, editing }) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const locations = useLocations();
  const { notify, notifyError } = useToast();
  const isEdit = Boolean(editing);

  const [form, setForm] = useState({
    name: editing?.name ?? '',
    email: editing?.email ?? '',
    role: editing?.role ?? 'field_tech',
    assigned_location_id: editing?.assigned_location_id ? String(editing.assigned_location_id) : '',
    password: '',
  });
  const [errors, setErrors] = useState({});
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  // A field tech must sit in a tech_van, because that is how the mobile app
  // resolves "my stock".
  const eligibleLocations = (locations.data ?? []).filter((l) =>
    form.role === 'field_tech' ? l.type === 'tech_van' : true
  );

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = 'Required';
    if (!form.email.includes('@')) next.email = 'Must be an email address';
    if (!isEdit && form.password.length < 8) next.password = 'At least 8 characters';
    if (isEdit && form.password && form.password.length < 8) {
      next.password = 'At least 8 characters';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    const payload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      assigned_location_id:
        form.assigned_location_id === '' ? null : Number(form.assigned_location_id),
    };

    try {
      if (isEdit) {
        await update.mutateAsync({
          id: editing.id,
          ...payload,
          ...(form.password ? { password: form.password } : {}),
        });
        notify(`${payload.name} updated`);
      } else {
        await create.mutateAsync({ ...payload, password: form.password });
        notify(`${payload.name} added`);
      }
      onClose();
    } catch (err) {
      notifyError(err);
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Modal
      title={isEdit ? `Edit ${editing.name}` : 'New user'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit}>
        <TextInput id="u-name" label="Name" value={form.name} onChange={set('name')} error={errors.name} />
        <TextInput
          id="u-email"
          label="Email"
          type="email"
          autoCapitalize="none"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
        />
        <Select
          id="u-role"
          label="Role"
          value={form.role}
          onChange={(value) => {
            set('role')(value);
            // A location valid for one role may not be valid for another.
            set('assigned_location_id')('');
          }}
          options={USER_ROLES.map((r) => ({ value: r, label: label(r) }))}
        />
        <Select
          id="u-location"
          label="Assigned location"
          value={form.assigned_location_id}
          onChange={set('assigned_location_id')}
          placeholder="None"
          options={eligibleLocations.map((l) => ({
            value: String(l.id),
            label: `${l.name} (${label(l.type)})`,
          }))}
          hint={
            form.role === 'field_tech'
              ? 'This is the van the field app shows as "my stock". A tech without one sees an empty van.'
              : 'Optional for warehouse staff and managers.'
          }
        />
        <TextInput
          id="u-password"
          label={isEdit ? 'New password' : 'Password'}
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint={isEdit ? 'Leave blank to keep the current password.' : 'At least 8 characters.'}
        />
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const users = useUsers();
  const update = useUpdateUser();
  const { notify, notifyError } = useToast();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  async function toggleActive(row) {
    try {
      await update.mutateAsync({ id: row.id, is_active: !row.is_active });
      notify(`${row.name} ${row.is_active ? 'deactivated' : 'reactivated'}`);
    } catch (err) {
      notifyError(err);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'User',
      render: (row) => (
        <>
          <div className="item-name">{row.name}</div>
          <div className="item-meta">{row.email}</div>
        </>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => <Badge value={row.role} /> },
    {
      key: 'assigned_location_name',
      header: 'Assigned to',
      render: (row) => row.assigned_location_name ?? '—',
    },
    {
      key: 'is_active',
      header: 'Active',
      render: (row) =>
        row.is_active ? <Badge variant="ok">Active</Badge> : <Badge variant="danger">Disabled</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="btn-row">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(row)}>
            Edit
          </button>
          <button
            type="button"
            className={row.is_active ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => toggleActive(row)}
            // Deactivating yourself would lock you out mid-session, since
            // requireAuth re-reads is_active on every request.
            disabled={row.id === me.id && row.is_active}
            title={row.id === me.id && row.is_active ? 'You cannot deactivate yourself' : undefined}
          >
            {row.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        sub="Deactivating someone takes effect on their very next request, not at token expiry"
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            New user
          </button>
        }
      />

      {users.isPending ? (
        <LoadingRows />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={users.refetch} />
      ) : (
        <DataTable
          columns={columns}
          rows={users.data}
          rowKey={(row) => row.id}
          rowClassName={(row) => (row.is_active ? '' : 'low')}
          empty={<EmptyState title="No users" />}
        />
      )}

      {creating ? <UserFormDialog onClose={() => setCreating(false)} /> : null}
      {editing ? <UserFormDialog editing={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

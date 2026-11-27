import type { AdminAction, AdminActionResult, AdminRecord, AdminResource } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Button } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useTRPC } from '@/trpc/trpc';
import { forgetAction, openActionSheet } from './action-sheet';
import { FieldEditor, GeneralErrors } from './field-editor';
import { formErrors, isConflict, type MutationError, NO_ERRORS, type ServerErrors } from './form-errors';
import {
  canDestroy,
  changedValues,
  createValues,
  type Draft,
  type Drafts,
  defaultDrafts,
  draftsFor,
  validateAll,
  writableFields,
} from './values';

/**
 * The detail and edit form for one record of a host-described type, or a new one when `record`
 * is null. Fields come from the manifest; a new record starts from the fields' defaults; Save
 * sends only what changed, with the record's version; member actions appear when the record lists
 * them, and those with inputs open a form sheet. A record the store won't let this admin edit
 * (gem 0.5 `can`) is shown read-only, without Delete when it can't be deleted.
 */
export function RecordForm({
  type,
  record,
  types,
}: {
  type: AdminResource;
  record: AdminRecord | null;
  types: readonly AdminResource[];
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const mode = record ? 'update' : 'create';
  const canUpdate = record?.can.update ?? true;
  const writable = useMemo(() => writableFields(type, mode, canUpdate), [type, mode, canUpdate]);
  const writableNames = useMemo(() => new Set(writable.map((f) => f.name)), [writable]);
  // A new record shows only what can be filled in; an existing one shows everything.
  const shown = record ? type.fields : writable;

  const [base, setBase] = useState<Drafts>(() =>
    record ? draftsFor(type.fields, record.values) : defaultDrafts(type.fields),
  );
  const [drafts, setDrafts] = useState<Drafts>(base);
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<ServerErrors>(NO_ERRORS);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const dirty = Object.keys(changedValues(writable, base, drafts)).length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const sheet = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (sheet.current) forgetAction(sheet.current);
    },
    [],
  );

  const reset = (next: AdminRecord) => {
    const fresh = draftsFor(type.fields, next.values);
    setBase(fresh);
    setDrafts(fresh);
  };
  // A record refreshed underneath (pull to refresh, an action) replaces the form unless it's being edited.
  useEffect(() => {
    if (!record) return;
    const fresh = draftsFor(type.fields, record.values);
    setBase(fresh);
    if (!dirtyRef.current) setDrafts(fresh);
  }, [record, type.fields]);

  const getKey = (id: string) => trpc.resources.get.queryKey({ key: type.key, id });
  const listChanged = () => void qc.invalidateQueries(trpc.resources.list.pathFilter());
  const toList = () => router.dismissTo({ pathname: '/more/admin/[key]', params: { key: type.key } });
  const failed = (title: string) => (e: MutationError) => {
    setServer(formErrors(type.fields, e));
    setTouched(true);
    Alert.alert(title, e.message);
  };

  /** Someone else saved first: Reload fetches their version and starts the form again from it. */
  const conflicted = (e: MutationError) => {
    if (!record) return;
    Alert.alert('Someone else changed this', e.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reload',
        onPress: () =>
          void qc
            .fetchQuery({
              ...trpc.resources.get.queryOptions({ key: type.key, id: record.id }),
              staleTime: 0,
            })
            .then((fresh) => {
              reset(fresh);
              setServer(NO_ERRORS);
              setTouched(false);
              setNotice('Reloaded with their changes.');
            })
            .catch((err: unknown) =>
              Alert.alert("Couldn't reload", err instanceof Error ? err.message : 'Try again.'),
            ),
      },
    ]);
  };

  const create = useMutation(
    trpc.resources.create.mutationOptions({
      onSuccess: (created) => {
        qc.setQueryData(getKey(created.id), created);
        listChanged();
        router.replace({ pathname: '/more/admin/[key]/[id]', params: { key: type.key, id: created.id } });
      },
      onError: failed("Couldn't create it"),
    }),
  );
  const update = useMutation(
    trpc.resources.update.mutationOptions({
      onSuccess: (updated) => {
        qc.setQueryData(getKey(updated.id), updated);
        listChanged();
        reset(updated);
        setServer(NO_ERRORS);
        setNotice('Saved.');
      },
      onError: (e) => (isConflict(e) ? conflicted(e) : failed("Couldn't save")(e)),
    }),
  );
  const remove = useMutation(
    trpc.resources.remove.mutationOptions({
      onSuccess: (_, input) => {
        qc.removeQueries({ queryKey: getKey(input.id) });
        listChanged();
        router.back();
      },
      onError: (e) => Alert.alert("Couldn't delete it", e.message),
    }),
  );

  const actionLabel = (name: string) => type.actions.find((a) => a.name === name)?.label ?? name;
  /** An action's result, whether it ran here or in its input sheet. */
  const done = (action: string, result: AdminActionResult) => {
    listChanged();
    const message = result.message ?? `${actionLabel(action)}: done.`;
    if (result.removed || !result.record) {
      if (record) qc.removeQueries({ queryKey: getKey(record.id) });
      Alert.alert(message);
      toList();
      return;
    }
    qc.setQueryData(getKey(result.record.id), result.record);
    if (!dirtyRef.current) reset(result.record);
    setNotice(message);
  };
  const perform = useMutation(
    trpc.resources.perform.mutationOptions({
      onSuccess: (result, input) => done(input.action, result),
      onError: (e, input) => Alert.alert(`Couldn't ${actionLabel(input.action).toLowerCase()}`, e.message),
    }),
  );

  const clientErrors = validateAll(writable, drafts);
  const errorFor = (name: string) => server.byField[name] ?? (touched ? clientErrors[name] : null) ?? null;
  const set = (name: string) => (draft: Draft) => {
    setDrafts((d) => ({ ...d, [name]: draft }));
    setNotice(null);
    if (server.byField[name]) {
      const { [name]: _, ...rest } = server.byField;
      setServer({ ...server, byField: rest });
    }
  };
  const busyUploading = Object.values(uploading).some(Boolean);

  const save = () => {
    setTouched(true);
    setNotice(null);
    if (Object.keys(clientErrors).length) return;
    if (!record) return create.mutate({ key: type.key, values: createValues(writable, drafts) });
    const values = changedValues(writable, base, drafts);
    if (!Object.keys(values).length) return setNotice('No changes to save.');
    update.mutate({
      key: type.key,
      id: record.id,
      values,
      ...(record.version !== null ? { version: record.version } : {}),
    });
  };

  const run = (action: AdminAction) => {
    if (!record) return;
    setNotice(null);
    if (action.inputs.length) {
      // The sheet asks for the inputs (and shows the confirm text) before it runs.
      sheet.current = openActionSheet({ key: type.key, id: record.id, action: action.name }, (result) => {
        sheet.current = null;
        done(action.name, result);
      });
      return;
    }
    const go = () => perform.mutate({ key: type.key, id: record.id, action: action.name });
    if (!action.confirm) return go();
    Alert.alert(action.label, action.confirm, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.label, style: action.destructive ? 'destructive' : 'default', onPress: go },
    ]);
  };
  const confirmDelete = () => {
    if (!record) return;
    Alert.alert(`Delete “${record.title}”?`, 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => remove.mutate({ key: type.key, id: record.id }),
      },
    ]);
  };

  const actions = record ? type.actions.filter((a) => record.actions.includes(a.name)) : [];
  const busy = create.isPending || update.isPending || remove.isPending || perform.isPending;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: layout.gutter, gap: space[4], paddingBottom: space[8] }}
    >
      {record?.subtitle ? <Text tone="muted">{record.subtitle}</Text> : null}
      {record && type.update && !canUpdate ? (
        <Text size="footnote" tone="muted">
          The store doesn't allow editing this one from the app.
        </Text>
      ) : null}
      <GeneralErrors messages={server.general} />
      {shown.map((field) => (
        <FieldEditor
          key={field.name}
          field={field}
          value={record?.values[field.name]}
          draft={drafts[field.name] ?? null}
          onChange={set(field.name)}
          editable={writableNames.has(field.name)}
          error={errorFor(field.name)}
          types={types}
          onBusy={(on) => setUploading((u) => (u[field.name] === on ? u : { ...u, [field.name]: on }))}
        />
      ))}
      {!shown.length ? <Text tone="muted">This type has no fields the app can show.</Text> : null}

      {notice ? (
        <Text size="footnote" tone="muted" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {writable.length ? (
        <Button
          title={record ? 'Save' : 'Create'}
          loading={create.isPending || update.isPending}
          disabled={busyUploading || (busy && !(create.isPending || update.isPending))}
          onPress={save}
        />
      ) : null}

      {actions.length ? (
        <View style={{ gap: space[2] }}>
          <Label>Actions</Label>
          {actions.map((action) => (
            <Button
              key={action.name}
              title={action.label}
              variant={action.destructive ? 'destructive' : 'tonal'}
              loading={perform.isPending && perform.variables?.action === action.name}
              disabled={busy}
              accessibilityHint={action.confirm ?? undefined}
              onPress={() => run(action)}
            />
          ))}
        </View>
      ) : null}

      {record && canDestroy(type, record) ? (
        <Button
          title="Delete"
          variant="destructive"
          loading={remove.isPending}
          disabled={busy}
          onPress={confirmDelete}
        />
      ) : null}
    </ScrollView>
  );
}

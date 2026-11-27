import type { AdminAction, AdminRecord, AdminResource } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Button } from '@/components/primitives';
import { Label, Text } from '@/components/text';
import { useTRPC } from '@/trpc/trpc';
import { FieldEditor } from './field-editor';
import {
  changedValues,
  createValues,
  type Draft,
  type Drafts,
  draftsFor,
  serverFieldErrors,
  validateAll,
  writableFields,
} from './values';

type ServerErrors = ReturnType<typeof serverFieldErrors>;
const NO_ERRORS: ServerErrors = { byField: {}, general: [] };

interface MutationError {
  message: string;
  data?: { fieldErrors?: Record<string, string[]> | null } | null;
}

/**
 * The detail and edit form for one record of a host-described type, or a new one when `record`
 * is null. Fields come from the manifest; Save sends only what changed; member actions appear
 * when the record lists them.
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
  const writable = useMemo(() => writableFields(type, mode), [type, mode]);
  const writableNames = useMemo(() => new Set(writable.map((f) => f.name)), [writable]);
  // A new record shows only what can be filled in; an existing one shows everything.
  const shown = record ? type.fields : writable;

  const [base, setBase] = useState<Drafts>(() => draftsFor(type.fields, record?.values ?? {}));
  const [drafts, setDrafts] = useState<Drafts>(base);
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<ServerErrors>(NO_ERRORS);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = Object.keys(changedValues(writable, base, drafts)).length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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
  const failed = (title: string) => (e: MutationError) => {
    const errors = serverFieldErrors(type.fields, e.data?.fieldErrors);
    setServer(errors);
    setTouched(true);
    Alert.alert(title, e.message);
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
      onError: failed("Couldn't save"),
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
  const perform = useMutation(
    trpc.resources.perform.mutationOptions({
      onSuccess: (result, input) => {
        qc.setQueryData(getKey(result.record.id), result.record);
        listChanged();
        if (!dirtyRef.current) reset(result.record);
        const label = type.actions.find((a) => a.name === input.action)?.label ?? input.action;
        setNotice(result.message ?? `${label}: done.`);
      },
      onError: (e, input) => {
        const label = type.actions.find((a) => a.name === input.action)?.label ?? input.action;
        Alert.alert(`Couldn't ${label.toLowerCase()}`, e.message);
      },
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

  const save = () => {
    setTouched(true);
    setNotice(null);
    if (Object.keys(clientErrors).length) return;
    if (!record) return create.mutate({ key: type.key, values: createValues(writable, drafts) });
    const values = changedValues(writable, base, drafts);
    if (!Object.keys(values).length) return setNotice('No changes to save.');
    update.mutate({ key: type.key, id: record.id, values });
  };

  const run = (action: AdminAction) => {
    if (!record) return;
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
        />
      ))}
      {!shown.length ? <Text tone="muted">This type has no fields the app can show.</Text> : null}

      {server.general.map((message) => (
        <Text key={message} size="footnote" tone="critical" accessibilityLiveRegion="polite">
          {message}
        </Text>
      ))}
      {notice ? (
        <Text size="footnote" tone="muted" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}
      {writable.length ? (
        <Button
          title={record ? 'Save' : 'Create'}
          loading={create.isPending || update.isPending}
          disabled={busy && !(create.isPending || update.isPending)}
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

      {record && type.destroy ? (
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

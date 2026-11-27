import type { AdminAction, AdminResource } from '@instincts/spree-domain';
import { space } from '@instincts/spree-ui';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Sheet } from '@/components/primitives';
import { Text } from '@/components/text';
import { useTRPC } from '@/trpc/trpc';
import { forgetAction, resolveAction } from './action-sheet';
import { FieldEditor, GeneralErrors } from './field-editor';
import { formErrors, NO_ERRORS, type ServerErrors } from './form-errors';
import { type Draft, defaultDrafts, editableFields, inputValues, validateAll } from './values';

/**
 * The form sheet for a member action with inputs (gem 0.5): the inputs with the same editors as
 * a record's fields, prefilled with their defaults, validated before sending, and the store's 422
 * errors shown on them. The result goes back to the record form that opened it.
 */
export function ActionForm({
  type,
  action,
  recordId,
  request,
  types,
}: {
  type: AdminResource;
  action: AdminAction;
  recordId: string;
  request: string;
  types: readonly AdminResource[];
}) {
  const trpc = useTRPC();
  const inputs = useMemo(() => editableFields(action.inputs), [action.inputs]);
  const [drafts, setDrafts] = useState(() => defaultDrafts(action.inputs));
  const [touched, setTouched] = useState(false);
  const [server, setServer] = useState<ServerErrors>(NO_ERRORS);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  // Closing the sheet without running the action leaves the record as it was.
  useEffect(() => () => forgetAction(request), [request]);

  const perform = useMutation(
    trpc.resources.perform.mutationOptions({
      onSuccess: (result) => {
        if (!result.removed) router.back();
        // A removed record's form takes everyone back to the list; without the form, do it here.
        if (!resolveAction(request, result) && result.removed)
          router.dismissTo({ pathname: '/more/admin/[key]', params: { key: type.key } });
      },
      onError: (e) => {
        setServer(formErrors(action.inputs, e, true));
        setTouched(true);
      },
    }),
  );

  const clientErrors = validateAll(inputs, drafts);
  const errorFor = (name: string) => server.byField[name] ?? (touched ? clientErrors[name] : null) ?? null;
  const set = (name: string) => (draft: Draft) => {
    setDrafts((d) => ({ ...d, [name]: draft }));
    if (server.byField[name]) {
      const { [name]: _, ...rest } = server.byField;
      setServer({ ...server, byField: rest });
    }
  };
  const busyUploading = Object.values(uploading).some(Boolean);

  const submit = () => {
    setTouched(true);
    if (Object.keys(clientErrors).length) return;
    setServer(NO_ERRORS);
    perform.mutate({
      key: type.key,
      id: recordId,
      action: action.name,
      input: inputValues(inputs, drafts),
    });
  };

  return (
    <Sheet>
      <Text size="title3" font="uiSemibold" accessibilityRole="header">
        {action.label}
      </Text>
      {action.confirm ? <Text tone="muted">{action.confirm}</Text> : null}
      <GeneralErrors messages={server.general} />
      {inputs.map((field) => (
        <FieldEditor
          key={field.name}
          field={field}
          value={undefined}
          draft={drafts[field.name] ?? null}
          onChange={set(field.name)}
          editable
          error={errorFor(field.name)}
          types={types}
          onBusy={(busy) => setUploading((u) => (u[field.name] === busy ? u : { ...u, [field.name]: busy }))}
        />
      ))}
      <View style={{ flexDirection: 'row', gap: space[2], justifyContent: 'flex-end' }}>
        <Button
          title="Cancel"
          variant="plain"
          disabled={perform.isPending}
          accessibilityLabel={`Cancel ${action.label.toLowerCase()}`}
          onPress={() => router.back()}
        />
        <Button
          title={action.label}
          variant={action.destructive ? 'destructive' : 'primary'}
          loading={perform.isPending}
          disabled={busyUploading}
          onPress={submit}
        />
      </View>
    </Sheet>
  );
}

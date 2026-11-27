import { type AdminField, type AdminReference, type AdminResource, adminFile } from '@instincts/spree-domain';
import { radius, space } from '@instincts/spree-ui';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import { Button, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { fileSummary, useAttachmentUpload } from './attachments';
import { forgetPick, openReferencePicker } from './picker';
import {
  type Draft,
  displayValue,
  editorKind,
  isAttachment,
  isHexColor,
  isoFromLocal,
  localDateTime,
  localDay,
} from './values';

export interface FieldEditorProps {
  field: AdminField;
  /** The record's current value, for read-only display and images. */
  value: unknown;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** False shows the value read-only (the field is read-only, or the type can't be edited). */
  editable: boolean;
  error?: string | null;
  /** The manifest, so a reference can open its target type's picker. */
  types: readonly AdminResource[];
  /** Told while an image or file is being picked and uploaded, so the form can wait for it. */
  onBusy?: (busy: boolean) => void;
}

/** One field of a host-described admin type, with the editor its type calls for. */
export function FieldEditor(props: FieldEditorProps) {
  const { field, editable } = props;
  const kind = editorKind(field);
  if (kind === 'image') return editable ? <EditableImageField {...props} /> : <ImageField {...props} />;
  if (kind === 'file') return <FileField {...props} />;
  if (!editable || kind === 'readonly') return <ReadOnlyField {...props} />;
  switch (kind) {
    case 'boolean':
      return <BooleanField {...props} />;
    case 'enum':
      return <EnumField {...props} />;
    case 'reference':
      return <ReferenceField {...props} />;
    case 'date':
    case 'datetime':
      return <DateField {...props} />;
    case 'color':
      return <ColorField {...props} />;
    default:
      return <TextEditor {...props} />;
  }
}

function Hint({ text }: { text: string | null | undefined }) {
  return text ? (
    <Text size="footnote" tone="muted">
      {text}
    </Text>
  ) : null;
}

function ErrorText({ text }: { text: string | null | undefined }) {
  return text ? (
    <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
      {text}
    </Text>
  ) : null;
}

/** Errors that belong to no field (`base`), shown above a form. */
export function GeneralErrors({ messages }: { messages: readonly string[] }) {
  return messages.length ? (
    <View style={{ gap: space[1] }} accessibilityLiveRegion="polite">
      {messages.map((message) => (
        <Text key={message} size="footnote" tone="critical">
          {message}
        </Text>
      ))}
    </View>
  ) : null;
}

function FieldLabel({ field }: { field: AdminField }) {
  return (
    <Text size="footnote" font="uiMedium" tone="muted">
      {field.required ? `${field.label} *` : field.label}
    </Text>
  );
}

const a11yLabel = (field: AdminField) => (field.required ? `${field.label}, required` : field.label);
const text = (draft: Draft) => (typeof draft === 'string' ? draft : '');

function ReadOnlyField({ field, value }: FieldEditorProps) {
  const shown = displayValue(field, value);
  const mono = field.type === 'json' || field.type === 'unknown';
  return (
    <View style={{ gap: space[1] }} accessible accessibilityLabel={`${field.label}: ${shown}`}>
      <Text size="footnote" font="uiMedium" tone="muted">
        {field.label}
      </Text>
      <Text font={mono ? 'mono' : 'ui'} size={mono ? 'footnote' : 'body'} selectable>
        {shown}
      </Text>
      <Hint text={field.hint} />
    </View>
  );
}

function ImageField({ field, value }: FieldEditorProps) {
  const { colors } = useTheme();
  const url = typeof value === 'string' && value ? value : null;
  return (
    <View style={{ gap: space[1] }}>
      <Text size="footnote" font="uiMedium" tone="muted">
        {field.label}
      </Text>
      {url ? (
        <Image
          source={{ uri: url }}
          accessibilityLabel={field.label}
          contentFit="cover"
          style={imageStyle(colors)}
        />
      ) : (
        <Text tone="muted">No image</Text>
      )}
      <Hint text={field.hint} />
    </View>
  );
}

const imageStyle = (colors: ReturnType<typeof useTheme>['colors']) => ({
  width: 120,
  height: 120,
  borderRadius: radius.card,
  backgroundColor: colors.surface,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.line,
});

/** Reports the upload state of an attachment field to the form. */
function useReportBusy(busy: boolean, onBusy: FieldEditorProps['onBusy']) {
  const report = useRef(onBusy);
  report.current = onBusy;
  useEffect(() => {
    report.current?.(busy);
  }, [busy]);
  useEffect(() => () => report.current?.(false), []);
}

/** An image the store will attach: Choose photo uploads one, Remove clears the field. */
function EditableImageField({ field, draft, onChange, error, onBusy }: FieldEditorProps) {
  const { colors } = useTheme();
  const upload = useAttachmentUpload(field.label);
  useReportBusy(upload.busy, onBusy);
  const current = isAttachment(draft) ? draft : null;
  const choose = async () => {
    const attached = await upload.choose('image');
    if (attached) onChange(attached);
  };
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      {current?.url ? (
        <Image
          source={{ uri: current.url }}
          accessibilityLabel={field.label}
          contentFit="cover"
          style={imageStyle(colors)}
        />
      ) : (
        <Text tone="muted">No image</Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button
          size="small"
          variant="tonal"
          title="Choose photo"
          disabled={upload.busy}
          accessibilityLabel={`Choose a photo for ${field.label}`}
          onPress={() => void choose()}
        />
        {current ? (
          <Button
            size="small"
            variant="destructive"
            title="Remove"
            disabled={upload.busy}
            accessibilityLabel={`Remove ${field.label}`}
            onPress={() => onChange(null)}
          />
        ) : null}
        {upload.busy ? <ActivityIndicator accessibilityLabel={`Uploading ${field.label}`} /> : null}
      </View>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

/** A file field (gem 0.5): its name and size, Open, and when editable Replace and Remove. */
function FileField(props: FieldEditorProps) {
  const { field, draft, value, editable, error } = props;
  // Editable shows the draft (a new upload, or removed); read-only shows the record's value.
  const shown = editable ? (isAttachment(draft) ? draft : null) : adminFile(value);
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      {shown ? (
        <View style={{ gap: space[2] }}>
          <Text accessibilityLabel={`${field.label}: ${fileSummary(shown)}`} numberOfLines={2}>
            {fileSummary(shown)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            {shown.url ? (
              <Button
                size="small"
                variant="tonal"
                title="Open"
                accessibilityLabel={`Open ${shown.filename ?? field.label}`}
                onPress={() => void Linking.openURL(shown.url as string)}
              />
            ) : null}
            {editable ? <FileWriteButtons {...props} hasFile /> : null}
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
          <Text tone="muted" style={editable ? undefined : { flex: 1 }}>
            No file
          </Text>
          {editable ? <FileWriteButtons {...props} hasFile={false} /> : null}
        </View>
      )}
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

function FileWriteButtons({ field, onChange, onBusy, hasFile }: FieldEditorProps & { hasFile: boolean }) {
  const upload = useAttachmentUpload(field.label);
  useReportBusy(upload.busy, onBusy);
  const choose = async () => {
    const attached = await upload.choose('file');
    if (attached) onChange(attached);
  };
  return (
    <>
      <Button
        size="small"
        variant="tonal"
        title={hasFile ? 'Replace' : 'Choose file'}
        disabled={upload.busy}
        accessibilityLabel={`${hasFile ? 'Replace' : 'Choose'} the file for ${field.label}`}
        onPress={() => void choose()}
      />
      {hasFile ? (
        <Button
          size="small"
          variant="destructive"
          title="Remove"
          disabled={upload.busy}
          accessibilityLabel={`Remove ${field.label}`}
          onPress={() => onChange(null)}
        />
      ) : null}
      {upload.busy ? <ActivityIndicator accessibilityLabel={`Uploading ${field.label}`} /> : null}
    </>
  );
}

const KEYBOARD = {
  integer: 'number-pad',
  decimal: 'decimal-pad',
  url: 'url',
  email: 'email-address',
} as const;

function TextEditor({ field, draft, onChange, error }: FieldEditorProps) {
  const { fonts } = useTheme();
  const kind = editorKind(field);
  const multiline = kind === 'multiline' || kind === 'json';
  const plain = kind === 'url' || kind === 'email' || kind === 'json';
  return (
    <View style={{ gap: space[1] }}>
      <TextField
        label={field.label}
        required={field.required}
        value={text(draft)}
        onChangeText={onChange}
        error={error}
        multiline={multiline}
        keyboardType={KEYBOARD[kind as keyof typeof KEYBOARD] ?? 'default'}
        autoCapitalize={plain ? 'none' : 'sentences'}
        autoCorrect={!plain && kind !== 'integer' && kind !== 'decimal'}
        style={
          multiline
            ? {
                minHeight: 96,
                paddingTop: space[2],
                textAlignVertical: 'top',
                ...(kind === 'json' ? { fontFamily: fonts.mono, fontSize: 14 } : {}),
              }
            : undefined
        }
        placeholder={kind === 'url' ? 'https://' : kind === 'json' ? '{ }' : undefined}
      />
      <Hint text={field.hint} />
    </View>
  );
}

function ColorField({ field, draft, onChange, error }: FieldEditorProps) {
  const { colors } = useTheme();
  const value = text(draft).trim();
  const valid = isHexColor(value);
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={field.label}
            required={field.required}
            value={text(draft)}
            onChangeText={onChange}
            error={error}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="#1A2B3C"
          />
        </View>
        <View
          accessible
          accessibilityLabel={valid ? `Colour swatch ${value}` : 'No colour'}
          style={{
            width: 44,
            height: 44,
            marginBottom: error ? 24 : 0,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: valid ? value : colors.surface,
          }}
        />
      </View>
      <Hint text={field.hint} />
    </View>
  );
}

function BooleanField({ field, draft, onChange, error }: FieldEditorProps) {
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Text style={{ flex: 1 }}>{field.label}</Text>
        <Switch
          accessibilityLabel={field.label}
          value={draft === true}
          onValueChange={(on) => onChange(on)}
        />
      </View>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: space[3],
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: on ? colors.ink : colors.line,
        backgroundColor: on ? colors.ink : colors.surface,
      }}
    >
      <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

function EnumField({ field, draft, onChange, error }: FieldEditorProps) {
  const options = field.options ?? [];
  const current = typeof draft === 'string' ? draft : null;
  // A stored value the host no longer lists still shows, so saving doesn't silently change it.
  const unknown = current !== null && !options.some((o) => String(o.value) === current);
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={a11yLabel(field)}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}
      >
        {field.required ? null : <Chip label="None" on={current === null} onPress={() => onChange(null)} />}
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            on={current === String(o.value)}
            onPress={() => onChange(String(o.value))}
          />
        ))}
        {unknown ? <Chip label={current} on onPress={() => {}} /> : null}
      </View>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

function DateField({ field, draft, onChange, error }: FieldEditorProps) {
  const withTime = editorKind(field) === 'datetime';
  const value = text(draft);
  const iso = withTime ? isoFromLocal(value) : null;
  const preview = withTime
    ? iso
      ? displayValue(field, iso)
      : null
    : value
      ? displayValue(field, value)
      : null;
  return (
    <View style={{ gap: space[1] }}>
      <TextField
        label={field.label}
        required={field.required}
        value={value}
        onChangeText={onChange}
        error={error}
        placeholder={withTime ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD'}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        autoCapitalize="none"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button
          size="small"
          variant="tonal"
          title={withTime ? 'Now' : 'Today'}
          accessibilityLabel={`${field.label}: set to ${withTime ? 'now' : 'today'}`}
          onPress={() => onChange(withTime ? localDateTime(new Date().toISOString()) : localDay(new Date()))}
        />
        {value && !field.required ? (
          <Button
            size="small"
            variant="plain"
            title="Clear"
            accessibilityLabel={`Clear ${field.label}`}
            onPress={() => onChange('')}
          />
        ) : null}
        <Text size="footnote" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
          {!error && preview && preview !== '—' ? preview : withTime ? 'Your local time' : ''}
        </Text>
      </View>
      <Hint text={field.hint} />
    </View>
  );
}

function ReferenceField({ field, draft, onChange, error, types }: FieldEditorProps) {
  const { colors } = useTheme();
  const ref = draft && typeof draft === 'object' ? (draft as AdminReference) : null;
  const target = types.find((t) => t.key === field.resource);
  const request = useRef<string | null>(null);
  // Forget an open picker request when the form goes away.
  useEffect(
    () => () => {
      if (request.current) forgetPick(request.current);
    },
    [],
  );

  if (!target)
    // The host didn't register the target type, so there is nothing to list: take its id.
    return (
      <View style={{ gap: space[1] }}>
        <TextField
          label={`${field.label} (id)`}
          required={field.required}
          value={ref?.id ?? ''}
          onChangeText={(id) => onChange(id.trim() ? { id: id.trim(), title: `#${id.trim()}` } : null)}
          error={error}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Hint text={field.hint} />
      </View>
    );

  const open = () => {
    request.current = openReferencePicker(
      { resource: target.key, label: field.label, selected: ref?.id ?? null, optional: !field.required },
      (choice) => {
        request.current = null;
        onChange(choice);
      },
    );
  };
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${a11yLabel(field)}: ${ref ? ref.title : 'none chosen'}`}
        accessibilityHint={`Choose from ${target.label.toLowerCase()}`}
        onPress={open}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          paddingHorizontal: space[3],
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: error ? colors.critical : colors.line,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ flex: 1 }} tone={ref ? 'ink' : 'muted'} numberOfLines={1}>
          {ref ? ref.title : `Choose ${field.label.toLowerCase()}…`}
        </Text>
        <Text tone="muted">›</Text>
      </Pressable>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols';
import { View } from 'react-native';
import { useTheme } from '@/theme/theme';

/**
 * SF Symbols a host may name for an admin type (`r.icon 'bell'`), with the Material symbol shown on
 * Android. Hosts can name anything, so only these are drawn; others show no icon rather than a
 * blank box or a crash.
 */
const ICONS: Partial<Record<SFSymbol, AndroidSymbol>> = {
  bell: 'notifications',
  'bell.badge': 'notification_important',
  megaphone: 'campaign',
  house: 'home',
  'list.bullet': 'list',
  'list.number': 'format_list_numbered',
  'square.grid.2x2': 'grid_view',
  'rectangle.stack': 'stacks',
  menucard: 'menu_book',
  'line.3.horizontal': 'menu',
  photo: 'image',
  'photo.on.rectangle': 'photo_library',
  video: 'videocam',
  'play.rectangle': 'smart_display',
  'dot.radiowaves.left.and.right': 'podcasts',
  'music.note': 'music_note',
  'music.note.list': 'queue_music',
  waveform: 'graphic_eq',
  mic: 'mic',
  headphones: 'headphones',
  person: 'person',
  'person.2': 'group',
  'person.3': 'groups',
  'person.crop.circle': 'account_circle',
  star: 'star',
  heart: 'favorite',
  tag: 'sell',
  cart: 'shopping_cart',
  bag: 'shopping_bag',
  creditcard: 'credit_card',
  'dollarsign.circle': 'paid',
  gift: 'redeem',
  percent: 'percent',
  link: 'link',
  globe: 'public',
  map: 'map',
  mappin: 'location_on',
  'mappin.and.ellipse': 'location_on',
  calendar: 'calendar_month',
  clock: 'schedule',
  gear: 'settings',
  gearshape: 'settings',
  'slider.horizontal.3': 'tune',
  wrench: 'build',
  'wrench.and.screwdriver': 'construction',
  cpu: 'memory',
  memorychip: 'memory',
  'arrow.down.circle': 'download',
  'arrow.up.circle': 'upload',
  'arrow.uturn.backward': 'undo',
  shippingbox: 'package_2',
  'doc.text': 'description',
  doc: 'draft',
  folder: 'folder',
  newspaper: 'newspaper',
  book: 'book',
  'text.alignleft': 'notes',
  textformat: 'text_fields',
  paintbrush: 'brush',
  paintpalette: 'palette',
  sparkles: 'auto_awesome',
  bolt: 'bolt',
  flag: 'flag',
  'checkmark.seal': 'verified',
  shield: 'shield',
  lock: 'lock',
  key: 'key',
  envelope: 'mail',
  bubble: 'chat_bubble',
  'bubble.left.and.bubble.right': 'forum',
  'chart.bar': 'bar_chart',
  'chart.line.uptrend.xyaxis': 'trending_up',
  iphone: 'smartphone',
  desktopcomputer: 'computer',
  'app.badge': 'apps',
};

/** The known symbol for a host's icon name, plain or `.fill`, or null. */
export function knownIcon(name: string | null | undefined): { ios: SFSymbol; android: AndroidSymbol } | null {
  if (!name) return null;
  const base = name.replace(/\.fill$/, '');
  const android = ICONS[base as SFSymbol];
  return android ? { ios: name as SFSymbol, android } : null;
}

/** A 28pt tile with the type's icon; a same-sized blank when the icon isn't known, so labels line up. */
export function TypeIcon({ name }: { name: string | null }) {
  const { colors } = useTheme();
  const icon = knownIcon(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' }}
    >
      {icon ? <SymbolView name={icon} size={20} tintColor={colors.accentInk} /> : null}
    </View>
  );
}

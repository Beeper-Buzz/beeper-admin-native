import { parsePairingPayload } from '@instincts/spree-sdk';
import { layout, radius, space } from '@instincts/spree-ui';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/theme';
import { Button } from './primitives';
import { Text } from './text';

/** Full-screen QR scanner for the code shown in Spree admin → Mobile app devices → Pair a device. */
export function PairingScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (pairing: { url: string; code: string }) => void;
}) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      onShow={() => {
        handled.current = false;
      }}
    >
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (handled.current) return;
              const pairing = parsePairingPayload(data);
              if (!pairing) return;
              handled.current = true;
              onScanned(pairing);
            }}
          />
        ) : null}
        <SafeAreaView style={{ flex: 1, justifyContent: 'space-between', padding: layout.gutter }}>
          <View style={[styles.panel, { backgroundColor: colors.surface }]}>
            <Text font="uiSemibold" size="callout">
              Scan pairing code
            </Text>
            <Text tone="muted" size="footnote">
              In Spree admin, open Mobile app devices and tap Pair a device. Point the camera at the code.
            </Text>
          </View>
          <View style={{ gap: space[2] }}>
            {permission && !permission.granted ? (
              <Button title="Allow camera" onPress={requestPermission} />
            ) : null}
            <View style={[styles.panel, { backgroundColor: colors.surface }]}>
              <Button title="Cancel" variant="plain" onPress={onClose} />
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.card, padding: space[3], gap: space[1] },
});

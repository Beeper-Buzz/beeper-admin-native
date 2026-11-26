jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const mockStore = new Map();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: jest.fn(async (k) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k, v) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k) => void mockStore.delete(k)),
}));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: (component) => component,
  captureException: jest.fn(),
  setTag: jest.fn(),
}));

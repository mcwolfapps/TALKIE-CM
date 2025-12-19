
export const AppState = {
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  TRANSMITTING: 'TRANSMITTING',
  RECEIVING: 'RECEIVING',
  ERROR: 'ERROR'
} as const;

export type AppStateType = typeof AppState[keyof typeof AppState];

export interface UserPresence {
  user_id: string;
  username: string;
  is_transmitting: boolean;
  last_seen: string;
  coords?: {
    lat: number;
    lng: number;
  };
}

export interface IntercomConfig {
  roomName: string;
  username: string;
  voxEnabled: boolean;
}

export interface AppTheme {
  id: string;
  name: string;
  primary: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  isDark: boolean;
}

export interface LlamaContext {
  completion: (params: {
    prompt?: string;
    messages?: { role: string; content: string }[];
    jinja?: boolean;
    n_predict: number;
    temperature: number;
    top_p?: number;
    stop?: string[];
  }) => Promise<{ text: string }>;
  release: () => Promise<void>;
  embedding: (text: string) => Promise<any>;
}

// Optional structured data for tasks (if they need it)
export interface CalendarEvent {
  title: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  location?: string;
  notes?: string;
  reminder?: number;
}
// types.ts
export type RootTabParamList = {
  Models: undefined;
  Chat: undefined;
  Documents: undefined;
  Settings: undefined;
};
export interface AlarmEvent {
  Day?: string;
  Time?: string;
}

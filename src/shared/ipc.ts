// The contract between the main process, the preload script and the page.
// Every IPC channel name and payload type lives here, and all three sides import it,
// so a change to a channel is a compile error wherever it is not followed.
import type { ChatEvent, ChatInfo, PermissionAnswer } from './chat.ts';

export type Eol = 'lf' | 'crlf' | 'cr';

// What the editor reads and writes. The text uses "\n" for every line break; eol and bom restore the file's own on save.
export interface FileContents {
  text: string;
  eol: Eol;
  bom: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FinderResult {
  path: string;
  root: string;
  rel: string;
  positions: number[];
}

export interface RootsChanged {
  workspaceId: string;
  roots: string[];
}

export interface ChatEventPayload {
  workspaceId: string;
  event: ChatEvent;
}

// Keyboard actions the preload script sends to the page.
export type Action =
  | 'add'
  | 'next'
  | 'previous'
  | 'close'
  | 'toggle-panel'
  | 'focus-panel'
  | 'file-finder'
  | 'save'
  | 'close-tab'
  | 'open-folder'
  | 'open-recent'
  | 'new-chat'
  | 'add-folder'
  | 'recent-1'
  | 'recent-2'
  | 'recent-3'
  | 'recent-4'
  | 'recent-5';

// Page -> main requests that get an answer (ipcRenderer.invoke / ipcMain.handle).
export interface InvokeChannels {
  'project:roots': { args: [workspaceId: string]; result: string[] };
  'project:add-folders': { args: [workspaceId: string]; result: string[] };
  'project:pick-folders': { args: []; result: string[] };
  'project:add-paths': { args: [workspaceId: string, paths: string[]]; result: string[] };
  'recent:list': { args: []; result: string[] };
  'project:forget': { args: [workspaceId: string]; result: void };
  'project:read-dir': { args: [dir: string]; result: DirEntry[] };
  'project:open-file': { args: [workspaceId: string, file: string]; result: void };
  'finder:prepare': { args: [workspaceId: string]; result: void };
  'finder:query': { args: [workspaceId: string, text: string]; result: FinderResult[] };
  'chat:info': { args: [workspaceId: string]; result: ChatInfo };
  'chat:send': { args: [workspaceId: string, text: string]; result: void };
  'chat:permission': { args: [workspaceId: string, id: string, answer: PermissionAnswer]; result: void };
  'chat:interrupt': { args: [workspaceId: string]; result: void };
  'chat:open-link': { args: [url: string]; result: void };
  'editor:read': { args: [workspaceId: string, file: string]; result: FileContents };
  'editor:write': { args: [workspaceId: string, file: string, contents: FileContents]; result: void };
}

// Main -> page messages that need no answer (webContents.send / ipcRenderer.on). The value is the payload.
export interface EventChannels {
  'finder:rebuilt': string;                 // workspace id
  'chat:event': ChatEventPayload;
  'recent:changed': undefined;              // the recent folders list changed, ask for it again
  'project:roots-changed': RootsChanged;
  'quit:ask': number;                       // request id, answered on 'quit:answer'
}

// Page -> main messages that need no answer (ipcRenderer.send / ipcMain.on). The value is the argument list.
export interface SendChannels {
  'quit:answer': [id: number, answer: boolean];
}

export type InvokeChannel = keyof InvokeChannels;
export type InvokeArgs<K extends InvokeChannel> = InvokeChannels[K]['args'];
export type InvokeResult<K extends InvokeChannel> = InvokeChannels[K]['result'];

// The API the preload script exposes as window.cod.
export interface CodApi {
  // Registers the single action handler and replays anything queued before it existed.
  onAction(callback: (action: Action) => void): void;
  // The main process asks before quitting. The callback resolves true when quitting may go on.
  onQuitRequest(callback: () => Promise<boolean>): void;
  // The main process checks every path against the workspace folders.
  editor: {
    read(workspaceId: string, file: string): Promise<FileContents>;
    write(workspaceId: string, file: string, contents: FileContents): Promise<void>;
  };
  chat: {
    info(workspaceId: string): Promise<ChatInfo>;
    send(workspaceId: string, text: string): Promise<void>;
    interrupt(workspaceId: string): Promise<void>;
    // Opens an http, https or mailto link from a reply in the system browser.
    openLink(url: string): Promise<void>;
    permission(workspaceId: string, id: string, answer: PermissionAnswer): Promise<void>;
    onEvent(callback: (workspaceId: string, event: ChatEvent) => void): void;
  };
  project: {
    roots(workspaceId: string): Promise<string[]>;
    addFolders(workspaceId: string): Promise<string[]>;
    // Shows the folder dialog and only records the choice as recent. Nothing is added to a workspace.
    pickFolders(): Promise<string[]>;
    // Adds folders the person picked or opened before. The main process refuses any other path.
    addPaths(workspaceId: string, paths: string[]): Promise<string[]>;
    recent(): Promise<string[]>;
    onRecentChanged(callback: () => void): void;
    forget(workspaceId: string): Promise<void>;
    readDir(dir: string): Promise<DirEntry[]>;
    openFile(workspaceId: string, file: string): Promise<void>;
    finderPrepare(workspaceId: string): Promise<void>;
    finderQuery(workspaceId: string, text: string): Promise<FinderResult[]>;
    onFinderRebuilt(callback: (workspaceId: string) => void): void;
    onRootsChanged(callback: (payload: RootsChanged) => void): void;
  };
}

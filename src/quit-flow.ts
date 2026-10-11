// Quit and window close share one flow: ask the page about modified files, then let the chat cleanup run.
// After a yes the page keeps its editors read-only. Until the cleanup is done, window close stays prevented
// and further quit requests only wait for the same cleanup, so nothing typed after the yes can be lost.
//   askPage() -> Promise<boolean>, true when the page confirmed (Save all or Discard all)
//   chatGuard(event) -> the before-quit handler that cleans up chats and then calls cleanupFinished()
//   quit() -> app.quit()

export interface Preventable {
  preventDefault(): void;
}

export interface QuitFlowOptions {
  askPage: () => boolean | Promise<boolean>;
  chatGuard: (event: Preventable) => void;
  quit: () => void;
}

export interface QuitFlow {
  beforeQuit(event: Preventable): void;
  windowClose(event: Preventable): void;
  cleanupFinished(): void;
}

export function createQuitFlow({ askPage, chatGuard, quit }: QuitFlowOptions): QuitFlow {
  let asking = false;
  let confirmed = false;
  let finished = false;

  function request(): void {
    if (asking) return;
    asking = true;
    Promise.resolve().then(askPage).catch(() => false).then(ok => {
      asking = false;
      if (!ok) return;
      confirmed = true;
      quit();
    });
  }

  return {
    beforeQuit(event) {
      if (confirmed) return chatGuard(event);
      event.preventDefault();
      request();
    },
    windowClose(event) {
      if (finished) return;
      event.preventDefault();
      if (!confirmed) request();
    },
    cleanupFinished() { finished = true; },
  };
}

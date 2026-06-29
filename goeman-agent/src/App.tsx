import { useState } from "react";
import { getLink, type LinkState } from "./lib/setup";
import { Setup } from "./pages/Setup";
import { ChatPage } from "./pages/ChatPage";

export function App() {
  const [link, setLink] = useState<LinkState | null>(() => getLink());

  if (!link) return <Setup onLinked={setLink} />;
  return <ChatPage link={link} onUnlink={() => setLink(null)} />;
}

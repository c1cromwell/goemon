/** A chat message + (for agent turns) its token indicator and step trace. */
import type { ScopedToken, Step } from "../lib/agent";
import { TokenIndicator } from "./TokenIndicator";
import { ToolCallLog } from "./ToolCallLog";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  token?: ScopedToken;
  steps?: Step[];
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`bubble ${message.role}`}>
      {message.text}
      {message.steps && message.steps.length > 0 ? <ToolCallLog steps={message.steps} /> : null}
      {message.token ? <TokenIndicator token={message.token} /> : null}
    </div>
  );
}

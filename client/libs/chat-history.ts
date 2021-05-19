import { Chat } from '../core';

class ChatHistory {
  public messages: string[] = [];
  public cursor = -1;
  public temp: any = null;

  constructor(public chat: Chat) {}

  add = (message: string) => this.messages.unshift(message);

  previous = () => {
    // Already at top
    if (!this.messages[this.cursor + 1]) return null;

    if (typeof this.temp !== 'string') this.temp = this.chat.inputValue;

    this.cursor += 1;

    return this.messages[this.cursor];
  };

  next = () => {
    // Already at bottom
    if (!this.messages[this.cursor - 1]) {
      if (typeof this.temp !== 'string') {
        const { temp } = this;
        this.temp = null;
        this.cursor -= 1;
        return temp;
      }
      return null;
    }

    this.cursor -= 1;

    return this.messages[this.cursor];
  };

  reset = () => {
    this.temp = null;
    this.cursor = -1;
  };
}

export { ChatHistory };

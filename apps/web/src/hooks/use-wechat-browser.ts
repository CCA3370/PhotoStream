"use client";

import { useEffect, useState } from "react";

export function isWeChatBrowser(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

export function useWeChatBrowser(): boolean {
  const [weChat, setWeChat] = useState(false);

  useEffect(() => {
    setWeChat(isWeChatBrowser());
  }, []);

  return weChat;
}

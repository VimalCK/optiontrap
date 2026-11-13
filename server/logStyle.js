export const GREY = '\x1b[90m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const CYAN = '\x1b[36m';
export const RESET = '\x1b[0m';

export const ts = () => `${GREY}${new Date().toLocaleTimeString()}${RESET}`;

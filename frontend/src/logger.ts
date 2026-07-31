export function logError(component: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${component}]`, message, error instanceof Error ? error.stack : "");
}

const logger = { error: logError };

export default logger;
